// Module Communication (porté de myFLA, lib/communication/domain.ts) :
// publications, rubriques récurrentes, événements et tâches.
// Collections Firestore préfixées com_ (voir firestore.rules).

export const COM_COLLECTIONS = {
  publications: "com_publications",
  rubriques: "com_rubriques",
  events: "com_events",
  tasks: "com_tasks",
  partnerDetails: "com_partner_details",
  obligations: "com_obligations",
};

// Accès au module : l'organisation du meeting (gestionnaires) et les admins.
export const COMMUNICATION_ROLES = ["admin", "gestionnaire"];

/* ---------- Publications ---------- */

export const PUB_TYPES = ["post", "story", "video", "cp", "newsletter", "article"];
export const PUB_TYPE_LABELS = {
  post: "Post",
  story: "Story",
  video: "Vidéo / Reel",
  cp: "Communiqué de presse",
  newsletter: "Newsletter",
  article: "Article site",
};

export const CANAUX = ["fb", "ig", "li", "web", "presse", "email"];
export const CANAL_LABELS = {
  fb: { label: "Facebook", short: "FB" },
  ig: { label: "Instagram", short: "IG" },
  li: { label: "LinkedIn", short: "IN" },
  web: { label: "Site web", short: "WEB" },
  presse: { label: "Presse", short: "PRESSE" },
  email: { label: "E-mail", short: "MAIL" },
};

export const STATUTS = ["todo", "doing", "scheduled", "done"];
export const STATUT_LABELS = {
  todo: "À faire",
  doing: "En cours",
  scheduled: "Programmé",
  done: "Publié",
};

export const normalizeStatut = (statut) => (STATUTS.includes(statut) ? statut : "doing");

// Validation d'une publication : écrite uniquement par la Cloud Function
// comPublicationValidation (qui envoie aussi les e-mails).
export const VALIDATION_ETAT_LABELS = {
  demandee: "Validation demandée",
  validee: "Validée",
  a_revoir: "À revoir",
};

/* ---------- Tâches ---------- */

export const TASK_STATUTS = ["todo", "doing", "done"];
export const TASK_STATUT_LABELS = {
  todo: "À faire",
  doing: "En cours",
  done: "Fait",
};

// Limites de texte des réseaux (post Instagram, LinkedIn).
export const TEXT_LIMITS = { ig: 2200, li: 3000 };

export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 10000;
export const MAX_NOTES_LENGTH = 5000;

// Valeurs par défaut d'une publication enregistrée (champs optionnels compris).
export function normalizePublication(raw = {}) {
  return {
    id: raw.id,
    titre: String(raw.titre || ""),
    date: String(raw.date || ""),
    type: PUB_TYPES.includes(raw.type) ? raw.type : "post",
    canaux: Array.isArray(raw.canaux) ? raw.canaux.filter((c) => CANAUX.includes(c)) : [],
    statut: normalizeStatut(raw.statut),
    assigneUids: Array.isArray(raw.assigneUids) ? raw.assigneUids : [],
    notes: String(raw.notes || ""),
    rubriqueId: raw.rubriqueId || null,
    occurrenceDate: raw.occurrenceDate || null,
    annulee: Boolean(raw.annulee),
    eventId: raw.eventId || null,
    partnerIds: Array.isArray(raw.partnerIds) ? raw.partnerIds : [],
    checks: raw.checks && typeof raw.checks === "object" ? raw.checks : {},
    facebookPostId: raw.facebookPostId || null,
    instagramMediaId: raw.instagramMediaId || null,
    siteUrl: raw.siteUrl || null,
    texte: String(raw.texte || ""),
    heure: raw.heure || null,
    canvaUrl: raw.canvaUrl || null,
    visuelUrl: raw.visuelUrl || null,
    visuelPath: raw.visuelPath || null,
    validation: raw.validation || null,
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    createdBy: raw.createdBy || "",
  };
}
