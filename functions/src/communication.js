// ── Module Communication : validation des publications ─────────────────────
// Porté de myFLA (app/api/communication/validation). Seul le serveur écrit le
// champ `validation` des com_publications (règles Firestore) : il vérifie qui
// peut répondre et prévient les personnes concernées (cloche, push, e-mail).

import admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { notifyUsers } from "./notifications.js";

const REGION = "europe-west1";
const COMMUNICATION_ROLES = ["admin", "gestionnaire"];

function firestore() {
  return admin.firestore();
}

function memberName(user = {}) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "Un membre de l'équipe";
}

// Messages d'erreur dans la langue de l'app de la personne (français ou anglais).
const translator = (request) => (fr, en) => (request.data?.lang === "fr" ? fr : en);

export const comPublicationValidation = onCall({ region: REGION }, async (request) => {
  const tr = translator(request);
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", tr("Authentification requise.", "Sign-in required."));

  const teamSnapshot = await firestore().collection("users").where("userTypes", "array-contains-any", COMMUNICATION_ROLES).get();
  // Seuls les vrais comptes de connexion (id du document = uid Auth) : une fiche de
  // candidature en double (champ uid différent de l'id) n'est pas un membre de l'équipe.
  const team = teamSnapshot.docs
    .filter((entry) => !entry.data().uid || entry.data().uid === entry.id)
    .map((entry) => ({ ...entry.data(), uid: entry.id }))
    .filter((user) => user.accountStatus !== "disabled");
  const teamById = new Map(team.map((user) => [user.uid, user]));
  const requester = teamById.get(uid);
  if (!requester) logger.warn("Validation requester not in team", { uid });
  if (!requester) throw new HttpsError("permission-denied", tr("Réservé à l'équipe d'organisation (admin, gestionnaire).", "Reserved for the organising team (admin, manager)."));

  const publicationId = String(request.data?.publicationId || "").trim();
  const action = request.data?.action;
  const message = String(request.data?.message || "").trim().slice(0, 1000);
  if (!publicationId || !["demande", "validee", "a_revoir"].includes(action)) {
    throw new HttpsError("invalid-argument", tr("Requête invalide.", "Invalid request."));
  }

  const ref = firestore().collection("com_publications").doc(publicationId);
  const { publication, validation } = await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", tr("Publication introuvable.", "Publication not found."));
    const current = snapshot.data().validation || null;
    const entry = { action, uid, nom: memberName(requester), at: Date.now(), message };
    let next;

    if (action === "demande") {
      const asked = Array.isArray(request.data?.demandeeA) ? request.data.demandeeA.filter((value) => typeof value === "string") : [];
      const chosen = asked.filter((memberUid) => teamById.has(memberUid) && memberUid !== uid);
      // Une personne choisie mais introuvable : on le dit plutôt que d'envoyer aux admins à sa place.
      if (asked.length && !chosen.length) {
        logger.warn("Validation target not in team", { publicationId, asked, uid });
        throw new HttpsError("failed-precondition", tr("La personne choisie n'a pas de compte actif dans l'équipe communication.", "The chosen person has no active account in the communication team."));
      }
      // Sans choix : les administrateurs.
      const admins = team.filter((user) => (user.userTypes || []).includes("admin") && user.uid !== uid).map((user) => user.uid);
      const demandeeA = chosen.length ? chosen : admins;
      if (!demandeeA.length) throw new HttpsError("failed-precondition", tr("Choisis au moins une personne à qui demander la validation.", "Choose at least one person to ask for approval."));
      next = { etat: "demandee", demandeePar: uid, demandeeA, history: [...(current?.history || []), entry] };
    } else {
      // Réponse à une demande en attente, ou changement d'une réponse déjà
      // donnée (on s'est trompé) : réservé aux personnes sollicitées.
      const answered = current && ["validee", "a_revoir"].includes(current.etat);
      if (!current || (current.etat !== "demandee" && !answered)) throw new HttpsError("failed-precondition", tr("Aucune demande de validation en attente pour cette publication.", "No pending approval request for this publication."));
      if (!current.demandeeA.includes(uid)) throw new HttpsError("permission-denied", tr("La validation de cette publication a été demandée à quelqu'un d'autre.", "Approval for this publication was requested from someone else."));
      if (answered && current.etat === action) throw new HttpsError("failed-precondition", tr("Cette réponse est déjà enregistrée.", "This answer is already recorded."));
      next = { ...current, etat: action, history: [...(current.history || []), answered ? { ...entry, changement: true } : entry] };
    }

    transaction.update(ref, { validation: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { publication: { ...snapshot.data(), id: snapshot.id }, validation: next };
  });

  logger.info("Validation updated", { publicationId, action, by: uid, demandeeA: validation.demandeeA });

  // Demande : aux personnes sollicitées. Réponse : au demandeur et aux autres personnes sollicitées.
  const recipients =
    action === "demande"
      ? validation.demandeeA
      : [...new Set([validation.demandeePar, ...validation.demandeeA])].filter((memberUid) => memberUid !== uid);

  const author = memberName(requester);
  const title = publication.titre;
  const titles = {
    demande: { fr: `${author} demande ta validation`, en: `${author} asks for your approval` },
    validee: { fr: `👍 ${author} a validé une publication`, en: `👍 ${author} approved a publication` },
    a_revoir: { fr: `👎 ${author} demande des corrections`, en: `👎 ${author} requests changes` },
  };
  const intros = {
    demande: { fr: `« ${title} », prévue le ${publication.date}, attend ta validation.`, en: `“${title}”, planned for ${publication.date}, is waiting for your approval.` },
    validee: { fr: `« ${title} », prévue le ${publication.date}, est validée.`, en: `“${title}”, planned for ${publication.date}, is approved.` },
    a_revoir: { fr: `« ${title} », prévue le ${publication.date}, est à revoir.`, en: `“${title}”, planned for ${publication.date}, needs changes.` },
  };
  const withMessage = (text, label) => (message ? `${text}
${label} ${message}` : text);
  // Réponse changée après coup : on le dit dans le titre.
  if (validation.history[validation.history.length - 1]?.changement) {
    titles.validee = { fr: `👍 ${author} a changé d'avis : publication validée`, en: `👍 ${author} changed their answer: approved` };
    titles.a_revoir = { fr: `👎 ${author} a changé d'avis : publication à revoir`, en: `👎 ${author} changed their answer: needs changes` };
  }

  // Cloche, push et e-mail selon les préférences de chacun (voir notifications.js).
  // Un envoi raté ne doit pas faire échouer la validation, déjà enregistrée.
  await notifyUsers({
    users: recipients.map((memberUid) => teamById.get(memberUid)).filter(Boolean),
    type: "com_validation",
    title: titles[action],
    body: { fr: withMessage(intros[action].fr, "Message :"), en: withMessage(intros[action].en, "Message:") },
    path: `/app/calendrier/publication/${encodeURIComponent(publication.id)}`,
    data: { publicationId: publication.id },
  }).catch((error) => logger.error("Validation notification failed", { publicationId: publication.id, error: error?.message }));

  return { validation };
});
