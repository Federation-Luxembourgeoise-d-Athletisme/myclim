/* global process, Buffer */

import admin from "firebase-admin";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { sendMail } from "./mailer.js";

// Module Communication : validation des publications (voir communication.js).
export * from "./communication.js";
export * from "./communication-social.js";


admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();
const REGION = "europe-west1";
const TEAM_CONFIGURATION_DOC_PATH = ["appSettings", "teamsConfiguration"];
const ACCREDITATION_CONFIGURATION_DOC_PATH = ["appSettings", "accreditationConfiguration"];

function buildHtmlFromText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

function setCorsHeaders(response) {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Upload-Path, X-File-Name");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sanitizePathSegment(value, fallback = "file") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, "_")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "") || fallback;
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function decodeHeaderValue(value = "") {
  try {
    return decodeURIComponent(String(value || "").trim());
  } catch {
    return String(value || "").trim();
  }
}

async function verifyBearerToken(request) {
  const header = String(request.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new HttpsError("unauthenticated", "Jeton Firebase manquant.");
  }

  return auth.verifyIdToken(match[1]);
}

export const uploadStorageFile = onRequest(
  {
    region: REGION,
    cors: false,
    memory: "1GiB",
  },
  async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ error: "method-not-allowed" });
      return;
    }

    try {
      const decodedToken = await verifyBearerToken(request);
      const uploadPath = sanitizePathSegment(request.get("x-upload-path"), "uploads");
      const originalFileName = sanitizeFileName(decodeHeaderValue(request.get("x-file-name")));
      const fileName = `${Date.now()}-${originalFileName}`;
      const filePath = `${uploadPath}/${fileName}`;
      const contentType = String(request.get("content-type") || "application/octet-stream").trim();
      const fileBuffer = request.rawBody;

      if (!decodedToken?.uid) {
        throw new HttpsError("unauthenticated", "Utilisateur Firebase introuvable.");
      }

      if (!fileBuffer?.length) {
        throw new HttpsError("invalid-argument", "Fichier vide.");
      }

      if (fileBuffer.length > 20 * 1024 * 1024) {
        throw new HttpsError("invalid-argument", "Le fichier dépasse la limite autorisée de 20 Mo.");
      }

      const downloadToken = randomUUID();
      const bucketFile = bucket.file(filePath);

      await bucketFile.save(fileBuffer, {
        metadata: {
          contentType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedByUid: decodedToken.uid,
          },
        },
        resumable: false,
        validation: "md5",
      });

      response.status(200).json({
        ok: true,
        fileName: originalFileName,
        filePath,
        mimeType: contentType,
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`,
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        response.status(error.httpErrorCode.status).json({
          error: error.code,
          message: error.message,
        });
        return;
      }

      logger.error("uploadStorageFile failed", error);
      response.status(500).json({
        error: "internal",
        message: "Le dépôt du fichier a échoué côté serveur.",
      });
    }
  },
);

export const processMailQueue = onDocumentCreated(
  {
    document: "mailQueue/{mailId}",
    region: "europe-west1",
    retry: false,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();
    if (!data?.to || !data?.subject || !data?.body) {
      await snapshot.ref.update({
        status: "error",
        errorMessage: "Missing required fields: to, subject, or body.",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    if (data.status && data.status !== "pending") {
      return;
    }

    try {
      const response = await sendMail({
        to: data.to,
        subject: data.subject,
        text: data.body,
        html: data.html || buildHtmlFromText(data.body),
      });

      await snapshot.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        providerMessageId: response?.messageId || "",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error("Mail queue send failed", error);

      await snapshot.ref.update({
        status: "error",
        errorMessage: error?.message || "Unknown mail sending error",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  },
);

async function assertAdminRequester(request) {
  const requesterUid = String(request.auth?.uid || "").trim();
  if (!requesterUid) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const requesterSnapshot = await db.collection("users").doc(requesterUid).get();
  const requesterProfile = requesterSnapshot.exists ? requesterSnapshot.data() : null;
  const requesterRoles = Array.isArray(requesterProfile?.userTypes) ? requesterProfile.userTypes : [];

  if (!requesterRoles.includes("admin")) {
    throw new HttpsError("permission-denied", "Seuls les administrateurs peuvent supprimer un utilisateur.");
  }

  return { requesterUid };
}

async function deleteCollectionByField(collectionName, fieldName, value) {
  if (!value) return 0;

  const snapshot = await db.collection(collectionName).where(fieldName, "==", value).get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  snapshot.docs.forEach((documentSnapshot) => {
    batch.delete(documentSnapshot.ref);
  });
  await batch.commit();
  return snapshot.size;
}

async function cleanupUserReferences(targetUserId) {
  const teamsRef = db.doc(TEAM_CONFIGURATION_DOC_PATH.join("/"));
  const teamsSnapshot = await teamsRef.get();
  let removedAssignments = 0;

  if (teamsSnapshot.exists) {
    const data = teamsSnapshot.data() || {};
    const teamAssignments = Array.isArray(data.teamAssignments) ? data.teamAssignments : [];
    const nextAssignments = teamAssignments.filter((assignment) => assignment?.id !== targetUserId);
    removedAssignments = teamAssignments.length - nextAssignments.length;

    if (removedAssignments > 0) {
      await teamsRef.set(
        {
          teamAssignments: nextAssignments,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  const accreditationRef = db.doc(ACCREDITATION_CONFIGURATION_DOC_PATH.join("/"));
  const accreditationSnapshot = await accreditationRef.get();
  let removedAccreditationOverride = false;

  if (accreditationSnapshot.exists) {
    const data = accreditationSnapshot.data() || {};
    const volunteerOverrides =
      data.volunteerOverrides && typeof data.volunteerOverrides === "object" ? data.volunteerOverrides : {};

    if (Object.prototype.hasOwnProperty.call(volunteerOverrides, targetUserId)) {
      const nextOverrides = { ...volunteerOverrides };
      delete nextOverrides[targetUserId];
      removedAccreditationOverride = true;

      await accreditationRef.set(
        {
          volunteerOverrides: nextOverrides,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  return {
    removedAssignments,
    removedAccreditationOverride,
  };
}

export const requestPasswordReset = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const email = String(request.data?.email || "").trim();
    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required.");
    }

    try {
      const actionCodeSettings = process.env.APP_BASE_URL
        ? {
            url: `${process.env.APP_BASE_URL.replace(/\/$/, "")}/login`,
            handleCodeInApp: false,
          }
        : undefined;
      const resetLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

      await sendMail({
        to: email,
        subject: "Réinitialisation de votre mot de passe MyCLIM",
        text: `Bonjour,

Vous avez demandé la réinitialisation de votre mot de passe MyCLIM.

Utilisez ce lien pour définir un nouveau mot de passe:
${resetLink}

Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.

L'équipe CMCM Luxembourg Indoor Meeting`,
        html: `
          <p>Bonjour,</p>
          <p>Vous avez demandé la réinitialisation de votre mot de passe MyCLIM.</p>
          <p><a href="${resetLink}">Définir un nouveau mot de passe</a></p>
          <p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>
          <p>L'équipe CMCM Luxembourg Indoor Meeting</p>
        `,
      });

      return { success: true };
    } catch (error) {
      logger.error("Password reset request failed", error);
      throw new HttpsError("internal", "Unable to send password reset email.");
    }
  },
);

function buildVipPortalUid(portalId) {
  return `vip-portal-${portalId}`;
}

async function ensureVipPortalUser(uid, portalId) {
  try {
    await auth.createUser({ uid });
  } catch (error) {
    if (error?.code !== "auth/uid-already-exists") {
      throw error;
    }
  }

  await auth.setCustomUserClaims(uid, { vipPortalId: portalId });
}

export const verifyVipPortalAccess = onCall({ region: REGION }, async (request) => {
  const portalId = String(request.data?.portalId || "").trim();
  const password = String(request.data?.password || "");

  if (!portalId) {
    throw new HttpsError("invalid-argument", "Identifiant de portail manquant.");
  }

  const portalSnapshot = await db.collection("vipPartnerPortals").doc(portalId).get();
  if (!portalSnapshot.exists) {
    throw new HttpsError("not-found", "Ce portail partenaire n'existe pas.");
  }

  const secretSnapshot = await db.collection("vipPartnerPortalSecrets").doc(portalId).get();
  const storedPassword = String(secretSnapshot.exists ? secretSnapshot.data()?.accessPassword || "" : "").trim();

  if (storedPassword && password !== storedPassword) {
    throw new HttpsError("permission-denied", "Mot de passe incorrect.");
  }

  const uid = buildVipPortalUid(portalId);
  await ensureVipPortalUser(uid, portalId);
  const token = await auth.createCustomToken(uid, { vipPortalId: portalId });

  return { token };
});

// ── Caisse jour J : accès des ordinateurs de caisse par code de poste ───────
// Le code n'est jamais stocké en clair : cashPostSecrets/{postId} garde un
// hash scrypt salé. Un poste ouvert obtient une session technique
// (uid cash-post-{postId}) portant les claims cashPostId + cashAccessVersion ;
// les règles Firestore comparent cette version à cashPosts/{postId}, donc
// régénérer le code ou incrémenter accessVersion coupe immédiatement les
// sessions ouvertes.
const CASH_POST_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CASH_POST_CODE_LENGTH = 8;
const CASH_ACCESS_MAX_FAILURES = 10;
const CASH_ACCESS_WINDOW_MS = 15 * 60 * 1000;

function normalizeCashPostCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generateCashPostCode() {
  const bytes = randomBytes(CASH_POST_CODE_LENGTH);
  return Array.from(bytes, (byte) => CASH_POST_CODE_ALPHABET[byte % CASH_POST_CODE_ALPHABET.length]).join("");
}

function hashCashPostCode(code, salt) {
  return scryptSync(normalizeCashPostCode(code), salt, 32).toString("hex");
}

async function assertManagerRequester(request) {
  const requesterUid = String(request.auth?.uid || "").trim();
  if (!requesterUid) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const requesterSnapshot = await db.collection("users").doc(requesterUid).get();
  const requesterRoles = Array.isArray(requesterSnapshot.data()?.userTypes) ? requesterSnapshot.data().userTypes : [];

  if (!requesterRoles.includes("admin") && !requesterRoles.includes("gestionnaire")) {
    throw new HttpsError("permission-denied", "Réservé aux administrateurs et gestionnaires.");
  }

  return { requesterUid };
}

export const setCashPostCode = onCall({ region: REGION }, async (request) => {
  const { requesterUid } = await assertManagerRequester(request);
  const postId = String(request.data?.postId || "").trim();
  if (!postId) {
    throw new HttpsError("invalid-argument", "Identifiant de poste manquant.");
  }

  const postRef = db.collection("cashPosts").doc(postId);
  const postSnapshot = await postRef.get();
  if (!postSnapshot.exists) {
    throw new HttpsError("not-found", "Ce poste de caisse n'existe pas.");
  }

  const code = generateCashPostCode();
  const salt = randomBytes(16).toString("hex");

  await db.collection("cashPostSecrets").doc(postId).set({
    codeHash: hashCashPostCode(code, salt),
    salt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: requesterUid,
  });

  await postRef.set(
    {
      hasCode: true,
      accessVersion: admin.firestore.FieldValue.increment(1),
      codeUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      codeUpdatedBy: requesterUid,
    },
    { merge: true },
  );

  return { code: `${code.slice(0, 4)}-${code.slice(4)}` };
});

async function registerCashAccessFailure(attemptRef) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const now = Date.now();
    const data = snapshot.exists ? snapshot.data() : {};
    const windowStart = Number(data.windowStartMs) || 0;
    const inWindow = now - windowStart < CASH_ACCESS_WINDOW_MS;

    transaction.set(attemptRef, {
      windowStartMs: inWindow ? windowStart : now,
      failures: inWindow ? (Number(data.failures) || 0) + 1 : 1,
    });
  });
}

export const openCashPostSession = onCall({ region: REGION }, async (request) => {
  const code = normalizeCashPostCode(request.data?.code);
  if (code.length !== CASH_POST_CODE_LENGTH) {
    throw new HttpsError("permission-denied", "Code incorrect.");
  }

  const clientIp = String(request.rawRequest?.ip || "unknown");
  const attemptRef = db
    .collection("cashAccessAttempts")
    .doc(createHash("sha256").update(clientIp).digest("hex"));
  const attemptSnapshot = await attemptRef.get();
  const attempts = attemptSnapshot.exists ? attemptSnapshot.data() : null;
  if (
    attempts &&
    Date.now() - (Number(attempts.windowStartMs) || 0) < CASH_ACCESS_WINDOW_MS &&
    (Number(attempts.failures) || 0) >= CASH_ACCESS_MAX_FAILURES
  ) {
    throw new HttpsError("resource-exhausted", "Trop d'essais. Réessaie dans quelques minutes.");
  }

  const secretsSnapshot = await db.collection("cashPostSecrets").get();
  const matchingSecret = secretsSnapshot.docs.find((secretDoc) => {
    const { codeHash, salt } = secretDoc.data() || {};
    if (!codeHash || !salt) return false;
    const expected = Buffer.from(String(codeHash), "hex");
    const actual = Buffer.from(hashCashPostCode(code, salt), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });

  if (!matchingSecret) {
    await registerCashAccessFailure(attemptRef);
    throw new HttpsError("permission-denied", "Code incorrect.");
  }

  const postId = matchingSecret.id;
  const postSnapshot = await db.collection("cashPosts").doc(postId).get();
  const post = postSnapshot.exists ? postSnapshot.data() : null;
  if (!post || post.active === false) {
    throw new HttpsError("failed-precondition", "Ce poste de caisse est fermé.");
  }

  const uid = `cash-post-${postId}`;
  const claims = { cashPostId: postId, cashAccessVersion: Number(post.accessVersion) || 0 };
  try {
    await auth.createUser({ uid, displayName: String(post.name || postId) });
  } catch (error) {
    if (error?.code !== "auth/uid-already-exists") {
      throw error;
    }
  }
  await auth.setCustomUserClaims(uid, claims);

  if (attemptSnapshot.exists) {
    await attemptRef.delete();
  }

  const token = await auth.createCustomToken(uid, claims);
  return { token, postId };
});

export const deletePlatformUser = onCall({ region: REGION }, async (request) => {
  const { requesterUid } = await assertAdminRequester(request);
  const targetUserId = String(request.data?.userId || "").trim();

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "Identifiant utilisateur manquant.");
  }

  if (targetUserId === requesterUid) {
    throw new HttpsError("failed-precondition", "Tu ne peux pas supprimer ton propre compte depuis cet écran.");
  }

  const userRef = db.collection("users").doc(targetUserId);
  const userSnapshot = await userRef.get();
  const userProfile = userSnapshot.exists ? userSnapshot.data() : null;
  const targetEmail = String(request.data?.email || userProfile?.email || "").trim();

  await db.collection("usersDeletionArchive").doc(targetUserId).set({
    originalDocId: targetUserId,
    deletedBy: requesterUid,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    email: targetEmail,
    userProfile: userProfile || null,
  });

  if (userSnapshot.exists) {
    await userRef.delete();
  }

  const [deletedVolunteerApplicationsByUid, deletedVolunteerApplicationsByEmail, deletedChildren, deletedRequests] =
    await Promise.all([
      deleteCollectionByField("volunteerApplications", "uid", targetUserId),
      deleteCollectionByField("volunteerApplications", "email", targetEmail),
      deleteCollectionByField("u14Children", "parentUserId", targetUserId),
      deleteCollectionByField("u14Requests", "parentUserId", targetUserId),
    ]);

  const referenceCleanup = await cleanupUserReferences(targetUserId);

  let authDeleted = false;
  let authMissing = false;
  try {
    await auth.deleteUser(targetUserId);
    authDeleted = true;
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      authMissing = true;
    } else {
      throw error;
    }
  }

  return {
    success: true,
    userId: targetUserId,
    authDeleted,
    authMissing,
    deletedVolunteerApplicationsByUid,
    deletedVolunteerApplicationsByEmail,
    deletedChildren,
    deletedRequests,
    ...referenceCleanup,
  };
});

export {
  bookPhysioSlot,
  cancelPhysioBooking,
  getAthleteHub,
  identifyAthlete,
  saveAthleteGuests,
} from "./athlete-hub.js";
