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

// Libellés : { fr, en }, choisis selon la langue de l'app (voir com-i18n.js).

/* ---------- Publications ---------- */

export const PUB_TYPES = ["post", "story", "video", "cp", "newsletter", "article"];
export const PUB_TYPE_LABELS = {
  post: { fr: "Post", en: "Post" },
  story: { fr: "Story", en: "Story" },
  video: { fr: "Vidéo / Reel", en: "Video / Reel" },
  cp: { fr: "Communiqué de presse", en: "Press release" },
  newsletter: { fr: "Newsletter", en: "Newsletter" },
  article: { fr: "Article site", en: "Website article" },
};

export const CANAUX = ["fb", "ig", "li", "web", "presse", "email"];
export const CANAL_LABELS = {
  fb: { label: { fr: "Facebook", en: "Facebook" }, short: "FB" },
  ig: { label: { fr: "Instagram", en: "Instagram" }, short: "IG" },
  li: { label: { fr: "LinkedIn", en: "LinkedIn" }, short: "IN" },
  web: { label: { fr: "Site web", en: "Website" }, short: "WEB" },
  presse: { label: { fr: "Presse", en: "Press" }, short: { fr: "PRESSE", en: "PRESS" } },
  email: { label: { fr: "E-mail", en: "Email" }, short: "MAIL" },
};

export const STATUTS = ["todo", "doing", "scheduled", "done"];
export const STATUT_LABELS = {
  todo: { fr: "À faire", en: "To do" },
  doing: { fr: "En cours", en: "In progress" },
  scheduled: { fr: "Programmé", en: "Scheduled" },
  done: { fr: "Publié", en: "Published" },
};

export const normalizeStatut = (statut) => (STATUTS.includes(statut) ? statut : "doing");

// Validation d'une publication : écrite uniquement par la Cloud Function
// comPublicationValidation (qui envoie aussi les e-mails).
export const VALIDATION_ETAT_LABELS = {
  demandee: { fr: "Validation demandée", en: "Approval requested" },
  validee: { fr: "Validée", en: "Approved" },
  a_revoir: { fr: "À revoir", en: "Needs changes" },
};

/* ---------- Tâches ---------- */

export const TASK_STATUTS = ["todo", "doing", "done"];
export const TASK_STATUT_LABELS = {
  todo: { fr: "À faire", en: "To do" },
  doing: { fr: "En cours", en: "In progress" },
  done: { fr: "Fait", en: "Done" },
};

// Limites de texte des réseaux (post Instagram, LinkedIn).
export const TEXT_LIMITS = { ig: 2200, li: 3000 };

export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 10000;
export const MAX_NOTES_LENGTH = 5000;

// Liens de travail d'une publication (visuels, SharePoint, Drive…) : { label, url }.
export const MAX_LIENS = 20;
const LINK_SOURCES = [
  [/sharepoint\.com|onedrive\.live\.com|1drv\.ms/i, "SharePoint"],
  [/drive\.google\.com|docs\.google\.com/i, "Google Drive"],
  [/canva\.com/i, "Canva"],
  [/dropbox\.com/i, "Dropbox"],
  [/wetransfer\.com|we\.tl/i, "WeTransfer"],
  [/flaphoto\.net/i, "Photos FLA"],
  [/figma\.com/i, "Figma"],
];

// Libellé par défaut d'un lien : le service reconnu, sinon le nom de domaine.
export function linkLabel(url) {
  const known = LINK_SOURCES.find(([re]) => re.test(url));
  if (known) return known[1];
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
    liens: Array.isArray(raw.liens) ? raw.liens.filter((l) => l && typeof l.url === "string") : [],
    createdBy: raw.createdBy || "",
  };
}
