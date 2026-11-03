// ── Places protégées U12 / U14 ──────────────────────────────────────────────
// Les enfants invités par l'organisation reçoivent un lien personnel
// (/pre-programme?invitation=<jeton>). La famille s'inscrit et choisit la
// course ; claimU14ProtectedInvite confirme alors la place d'office, dans la
// limite de la réserve de la catégorie (appSettings/u14ProtectedSettings.pools).
// Chaque matin, u14ProtectedInvitesDaily envoie un rappel deux jours avant la
// date limite et, une fois la date passée, marque les invitations restantes
// comme expirées et prévient l'équipe (la liste d'attente se recalcule depuis
// le module U12 / U14). Logique miroir côté app : src/app/u14-protected.js.
/* global process */

import admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { notifyUsers, usersWithRoles } from "./notifications.js";
import { recalculateU14Edition } from "./u14-allocation.js";

const REGION = "europe-west1";
const TIME_ZONE = "Europe/Luxembourg";
const INVITES = "u14ProtectedInvites";
const DEFAULT_POOLS = { U12F: 3, U12M: 3, U14F: 6, U14M: 6 };
const DEFAULT_APP_BASE_URL = "https://cmcm-luxembourg-indoor-meeting.lu";
const ADMIN_ROLES = ["admin", "gestionnaire"];

const firestore = () => admin.firestore();

function appBaseUrl() {
  return String(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/$/, "");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function poolKeyFor(category, gender) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  if (!["U12", "U14"].includes(normalizedCategory)) return "";
  const normalizedGender = normalize(gender);
  if (normalizedGender.startsWith("f")) return `${normalizedCategory}F`;
  if (normalizedGender.startsWith("g") || normalizedGender.startsWith("m")) return `${normalizedCategory}M`;
  return "";
}

// Date du jour à Luxembourg, au format AAAA-MM-JJ.
function todayInLuxembourg(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatFrenchDate(isoDate) {
  if (!isoDate) return "";
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("fr-LU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Même service mail que l'app (fonction Netlify), comme les notifications.
async function sendTransactionalMail({ to, subject, body, html }) {
  const response = await fetch(`${appBaseUrl()}/.netlify/functions/send-transactional-mail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, body, html }),
  });
  if (!response.ok) throw new Error(`Mail service answered ${response.status}: ${await response.text()}`);
}

async function readPools() {
  const snapshot = await firestore().collection("appSettings").doc("u14ProtectedSettings").get();
  const pools = { ...DEFAULT_POOLS };
  const configured = snapshot.exists ? snapshot.data()?.pools || {} : {};
  Object.keys(pools).forEach((key) => {
    const value = Number(configured[key]);
    if (Number.isFinite(value) && value >= 0) pools[key] = Math.floor(value);
  });
  return pools;
}

export const claimU14ProtectedInvite = onCall({ region: REGION }, async (request) => {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Authentification requise.");

  const token = String(request.data?.token || "").trim();
  const requestId = String(request.data?.requestId || "").trim();
  if (!token || !requestId) throw new HttpsError("invalid-argument", "Invitation ou demande manquante.");

  const pools = await readPools();
  const db = firestore();
  const inviteRef = db.collection(INVITES).doc(token);
  const requestRef = db.collection("u14Requests").doc(requestId);

  const result = await db.runTransaction(async (transaction) => {
    const [inviteSnapshot, requestSnapshot] = await Promise.all([transaction.get(inviteRef), transaction.get(requestRef)]);
    if (!inviteSnapshot.exists) throw new HttpsError("not-found", "Invitation introuvable.");
    if (!requestSnapshot.exists) throw new HttpsError("not-found", "Demande introuvable.");

    const invite = inviteSnapshot.data();
    const entry = requestSnapshot.data();
    if (entry.parentUserId !== uid) throw new HttpsError("permission-denied", "Cette demande ne vous appartient pas.");
    if (invite.status === "claimed") {
      if (invite.claimedRequestId === requestId) return { raceCode: entry.raceCode, alreadyClaimed: true };
      throw new HttpsError("already-exists", "Cette invitation a déjà été utilisée.");
    }
    if (invite.status !== "invited") throw new HttpsError("failed-precondition", "Cette invitation n'est plus valable.");
    if (invite.deadline && todayInLuxembourg() > invite.deadline) {
      throw new HttpsError("deadline-exceeded", "La date limite de cette invitation est passée.");
    }
    if (entry.requestType === "porte_panier") {
      throw new HttpsError("failed-precondition", "Une place protégée concerne une course, pas le porte-panier.");
    }

    // L'année de naissance est sur la fiche enfant, pas sur la demande.
    const childSnapshot = invite.birthYear && entry.childId ? await transaction.get(db.collection("u14Children").doc(entry.childId)) : null;
    const childBirthYear = String(childSnapshot?.data()?.birthYear || String(childSnapshot?.data()?.birthDate || "").slice(0, 4));
    if (invite.birthYear && childBirthYear !== String(invite.birthYear)) {
      throw new HttpsError("failed-precondition", `Cette place est réservée à un enfant né en ${invite.birthYear}.`);
    }

    if (invite.gender && poolKeyFor("U12", entry.gender) !== poolKeyFor("U12", invite.gender)) {
      throw new HttpsError("failed-precondition", "Le sexe de l'enfant ne correspond pas à l'invitation.");
    }

    const poolKey = poolKeyFor(entry.category, entry.gender);
    if (!poolKey) throw new HttpsError("failed-precondition", "Catégorie U12 / U14 non reconnue pour cet enfant.");

    // Places de la réserve déjà utilisées dans la catégorie. Un désistement ne
    // rend pas la place à la réserve : elle va aux inscriptions générales.
    const claimedSnapshot = await transaction.get(
      db.collection(INVITES).where("status", "==", "claimed").where("claimedPool", "==", poolKey),
    );
    const usedPlaces = claimedSnapshot.docs.filter((entrySnapshot) => entrySnapshot.data().editionId === invite.editionId).length;
    if (usedPlaces >= (pools[poolKey] ?? 0)) {
      throw new HttpsError("resource-exhausted", "Toutes les places protégées de cette catégorie sont déjà prises.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    transaction.update(inviteRef, {
      status: "claimed",
      claimedRequestId: requestId,
      claimedChildId: entry.childId || "",
      claimedParentUserId: uid,
      claimedPool: poolKey,
      claimedRaceCode: entry.raceCode || "",
      claimedAt: now,
    });
    transaction.update(requestRef, {
      protectedInviteToken: token,
      allocationMode: "protected",
      status: "confirmed",
      adminApprovalStatus: "approved",
      adminApprovedAt: now,
      parentDecisionRequired: false,
      parentDecisionStatus: "confirmed",
      parentDecisionAt: now,
      waitlistPosition: null,
    });
    return {
      raceCode: entry.raceCode,
      alreadyClaimed: false,
      child: `${invite.firstName || ""} ${invite.lastName || ""}`.trim(),
      editionId: entry.editionId || invite.editionId,
    };
  });

  if (!result.alreadyClaimed) {
    await notifyUsers({
      users: await usersWithRoles(ADMIN_ROLES),
      type: "u14_request",
      title: { fr: "Place protégée confirmée", en: "Protected place confirmed" },
      body: { fr: `${result.child} a confirmé sa place protégée.`, en: `${result.child} confirmed their protected place.` },
      path: "/app/u14/places-protegees",
    }).catch((error) => logger.error("Protected place notification failed", error));

    // La réserve baisse d'une place dans les autres courses de la catégorie :
    // une place générale peut s'y ouvrir pour la liste d'attente.
    await recalculateU14Edition(result.editionId, `place protégée confirmée par ${result.child}`).catch((error) =>
      logger.error("Allocation after protected claim failed", error),
    );
  }

  return { ok: true, raceCode: result.raceCode };
});

export const u14ProtectedInvitesDaily = onSchedule(
  { region: REGION, schedule: "every day 08:00", timeZone: TIME_ZONE },
  async () => {
    const today = todayInLuxembourg();
    const snapshot = await firestore().collection(INVITES).where("status", "==", "invited").get();
    const expired = [];
    const expiredEditions = new Set();
    let reminders = 0;

    for (const entrySnapshot of snapshot.docs) {
      const invite = entrySnapshot.data();
      if (!invite.deadline) continue;

      if (today > invite.deadline) {
        await entrySnapshot.ref.update({ status: "expired", expiredAt: admin.firestore.FieldValue.serverTimestamp() });
        expired.push(`${invite.firstName || ""} ${invite.lastName || ""}`.trim());
        expiredEditions.add(invite.editionId);
        continue;
      }

      if (today === addDays(invite.deadline, -2) && !invite.reminderSentAt && invite.parentEmail) {
        const child = `${invite.firstName || ""} ${invite.lastName || ""}`.trim();
        const url = `${appBaseUrl()}/pre-programme?invitation=${entrySnapshot.id}`;
        const deadline = formatFrenchDate(invite.deadline);
        const body = [
          "Bonjour,",
          `Petit rappel : la place réservée pour ${child} au pré-programme du CMCM Luxembourg Indoor Meeting doit être confirmée avant le ${deadline}. Sans inscription à cette date, elle sera rendue aux autres enfants.`,
          `Confirmer la place : ${url}`,
          "L'équipe CMCM Luxembourg Indoor Meeting",
          "---",
          `Reminder: the place reserved for ${child} in the CMCM Luxembourg Indoor Meeting pre-programme must be confirmed by ${invite.deadline}. Without a registration by then, it goes back to other children.`,
          `Confirm the place: ${url}`,
        ].join("\n\n");
        const html = body
          .split("\n\n")
          .map((paragraph) => `<p>${escapeHtml(paragraph).replace(url, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)}</p>`)
          .join("");
        try {
          await sendTransactionalMail({
            to: invite.parentEmail,
            subject: `Rappel : place réservée pour ${child} à confirmer avant le ${deadline}`,
            body,
            html,
          });
          await entrySnapshot.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });
          reminders += 1;
        } catch (error) {
          logger.error("Protected place reminder failed", { invite: entrySnapshot.id, reason: error?.message });
        }
      }
    }

    if (expired.length) {
      await notifyUsers({
        users: await usersWithRoles(ADMIN_ROLES),
        type: "u14_request",
        title: { fr: "Places protégées libérées", en: "Protected places released" },
        body: {
          fr: `Date limite passée sans inscription : ${expired.join(", ")}. Les enfants en liste d'attente qui montent sont à valider dans le module U12 / U14.`,
          en: `Deadline passed without registration: ${expired.join(", ")}. Children moving up from the waiting list are to be approved in the U12 / U14 module.`,
        },
        path: "/app/u14",
      });
    }

    // Le lendemain de la date limite, la réserve restante revient aux places
    // générales : la liste d'attente avance (enfants « retenus », à valider).
    const settingsSnapshot = await firestore().collection("appSettings").doc("u14ProtectedSettings").get();
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
    if (settings?.deadline && today === addDays(settings.deadline, 1) && settings.editionId) {
      expiredEditions.add(settings.editionId);
    }
    for (const editionId of expiredEditions) {
      await recalculateU14Edition(editionId, "date limite des places protégées passée").catch((error) =>
        logger.error("Allocation after deadline failed", { editionId, reason: error?.message }),
      );
    }

    logger.info("Protected invites daily run", { today, reminders, expired: expired.length });
  },
);
