// ── Module Communication : validation des publications ─────────────────────
// Porté de myFLA (app/api/communication/validation). Seul le serveur écrit le
// champ `validation` des com_publications (règles Firestore) : il vérifie qui
// peut répondre et prévient les personnes concernées par e-mail (mailQueue).
/* global process */

import admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

const REGION = "europe-west1";
const COMMUNICATION_ROLES = ["admin", "gestionnaire"];
const DEFAULT_APP_BASE_URL = "https://cmcm-luxembourg-indoor-meeting.lu";

function firestore() {
  return admin.firestore();
}

function memberName(user = {}) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "Un membre de l'équipe";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appBaseUrl() {
  return String(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/$/, "");
}

export const comPublicationValidation = onCall({ region: REGION }, async (request) => {
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", "Authentification requise.");

  const teamSnapshot = await firestore().collection("users").where("userTypes", "array-contains-any", COMMUNICATION_ROLES).get();
  const team = teamSnapshot.docs
    .map((entry) => ({ ...entry.data(), uid: entry.id }))
    .filter((user) => user.accountStatus !== "disabled");
  const teamById = new Map(team.map((user) => [user.uid, user]));
  const requester = teamById.get(uid);
  if (!requester) throw new HttpsError("permission-denied", "Réservé à l'équipe d'organisation (admin, gestionnaire).");

  const publicationId = String(request.data?.publicationId || "").trim();
  const action = request.data?.action;
  const message = String(request.data?.message || "").trim().slice(0, 1000);
  if (!publicationId || !["demande", "validee", "a_revoir"].includes(action)) {
    throw new HttpsError("invalid-argument", "Requête invalide.");
  }

  const ref = firestore().collection("com_publications").doc(publicationId);
  const { publication, validation } = await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Publication introuvable.");
    const current = snapshot.data().validation || null;
    const entry = { action, uid, nom: memberName(requester), at: Date.now(), message };
    let next;

    if (action === "demande") {
      const asked = Array.isArray(request.data?.demandeeA) ? request.data.demandeeA.filter((value) => typeof value === "string") : [];
      const chosen = asked.filter((memberUid) => teamById.has(memberUid) && memberUid !== uid);
      // Sans choix : les administrateurs.
      const admins = team.filter((user) => (user.userTypes || []).includes("admin") && user.uid !== uid).map((user) => user.uid);
      const demandeeA = chosen.length ? chosen : admins;
      if (!demandeeA.length) throw new HttpsError("failed-precondition", "Choisis au moins une personne à qui demander la validation.");
      next = { etat: "demandee", demandeePar: uid, demandeeA, history: [...(current?.history || []), entry] };
    } else {
      if (!current || current.etat !== "demandee") throw new HttpsError("failed-precondition", "Aucune demande de validation en attente pour cette publication.");
      if (!current.demandeeA.includes(uid)) throw new HttpsError("permission-denied", "La validation de cette publication a été demandée à quelqu'un d'autre.");
      next = { ...current, etat: action, history: [...current.history, entry] };
    }

    transaction.update(ref, { validation: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { publication: { ...snapshot.data(), id: snapshot.id }, validation: next };
  });

  // Demande : aux personnes sollicitées. Réponse : au demandeur et aux autres personnes sollicitées.
  const recipients =
    action === "demande"
      ? validation.demandeeA
      : [...new Set([validation.demandeePar, ...validation.demandeeA])].filter((memberUid) => memberUid !== uid);

  const author = memberName(requester);
  const url = `${appBaseUrl()}/app/communication/publication/${encodeURIComponent(publication.id)}`;
  const subject =
    action === "demande"
      ? `${author} demande ta validation : « ${publication.titre} »`
      : action === "validee"
        ? `👍 ${author} a validé « ${publication.titre} »`
        : `👎 ${author} demande de revoir « ${publication.titre} »`;
  const intro =
    action === "demande"
      ? `${author} te demande de valider la publication « ${publication.titre} » prévue le ${publication.date}.`
      : action === "validee"
        ? `${author} a validé la publication « ${publication.titre} » prévue le ${publication.date}.`
        : `${author} demande des corrections sur la publication « ${publication.titre} » prévue le ${publication.date}.`;
  const body = [intro, message ? `Message : ${message}` : "", `Ouvrir la publication : ${url}`].filter(Boolean).join("\n\n");
  const html = `<p>${escapeHtml(intro)}</p>${message ? `<p><strong>Message :</strong> ${escapeHtml(message)}</p>` : ""}<p><a href="${escapeHtml(url)}">Ouvrir la publication dans MyCLIM</a></p>`;

  await Promise.all(
    recipients
      .map((memberUid) => teamById.get(memberUid))
      .filter((user) => user?.email)
      .map((user) =>
        firestore()
          .collection("mailQueue")
          .add({
            to: user.email,
            subject,
            body,
            html,
            status: "pending",
            source: "communication-validation",
            publicationId: publication.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .catch((error) => logger.error("Validation mail enqueue failed", { publicationId: publication.id, error: error?.message })),
      ),
  );

  return { validation };
});
