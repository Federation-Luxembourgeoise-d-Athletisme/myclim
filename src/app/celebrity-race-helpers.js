// Influencer vs Athletes Race (pré-programme) : liste des personnes qu'on
// invite de chaque côté et suivi de nos demandes (statut, date, relances,
// journal). Une fiche par personne dans celebrityRaceContacts, par édition.

const CELEBRITY_RACES = [
  { id: "influencer", fr: "Influencer Race", en: "Influencer Race" },
  { id: "athlete", fr: "Athletes Race", en: "Athletes Race" },
];

const CELEBRITY_GENDERS = [
  { id: "women", fr: "Femmes", en: "Women" },
  { id: "men", fr: "Hommes", en: "Men" },
];

// Ordre = avancement de la demande. tone : couleur de la puce.
const CELEBRITY_STATUSES = [
  { id: "idea", fr: "À demander", en: "To ask", tone: "idle" },
  { id: "asked", fr: "Demandé", en: "Asked", tone: "pending" },
  { id: "no_reply", fr: "Pas de réponse", en: "No reply", tone: "warn" },
  { id: "to_confirm", fr: "À confirmer", en: "To confirm", tone: "pending" },
  { id: "confirmed", fr: "Confirmé", en: "Confirmed", tone: "ok" },
  { id: "declined", fr: "Refusé", en: "Declined", tone: "off" },
];

// Demande en attente d'une réponse : on peut devoir relancer.
const WAITING_STATUSES = ["asked", "no_reply", "to_confirm"];
// Sans date de relance fixée, on relance une semaine après la demande.
const DEFAULT_FOLLOW_UP_DAYS = 7;

const STATUS_IDS = CELEBRITY_STATUSES.map((status) => status.id);

function getCelebrityStatus(statusId) {
  return CELEBRITY_STATUSES.find((status) => status.id === statusId) || CELEBRITY_STATUSES[0];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanIsoDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      at: cleanText(entry.at),
      status: STATUS_IDS.includes(entry.status) ? entry.status : "",
      note: cleanText(entry.note),
      by: cleanText(entry.by),
    }))
    .filter((entry) => entry.at && (entry.status || entry.note));
}

function normalizeCelebrityContact(raw = {}) {
  return {
    race: raw.race === "athlete" ? "athlete" : "influencer",
    gender: raw.gender === "men" ? "men" : "women",
    firstName: cleanText(raw.firstName),
    lastName: cleanText(raw.lastName),
    alias: cleanText(raw.alias),
    status: STATUS_IDS.includes(raw.status) ? raw.status : "idea",
    contact: cleanText(raw.contact),
    owner: cleanText(raw.owner),
    askedAt: cleanIsoDate(raw.askedAt),
    followUpAt: cleanIsoDate(raw.followUpAt),
    notes: cleanText(raw.notes),
    history: normalizeHistory(raw.history),
  };
}

// Nom affiché : prénom + nom, sinon le pseudo / compte Instagram.
function getCelebrityDisplayName(contact) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || contact.alias || "—";
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Date à laquelle relancer : celle fixée, sinon une semaine après la demande.
function getFollowUpDate(contact) {
  if (!WAITING_STATUSES.includes(contact.status)) return "";
  if (contact.followUpAt) return contact.followUpAt;
  return contact.askedAt ? addDays(contact.askedAt, DEFAULT_FOLLOW_UP_DAYS) : "";
}

// À relancer : demande en attente dont la date de relance est atteinte, ou
// demande « pas de réponse » sans aucune date.
function isFollowUpDue(contact, todayIso) {
  if (!WAITING_STATUSES.includes(contact.status)) return false;
  const due = getFollowUpDate(contact);
  if (!due) return contact.status === "no_reply";
  return due <= todayIso;
}

// Changement de statut : journal + date de demande posée au premier « Demandé ».
function applyStatusChange(contact, nextStatus, { todayIso, nowIso, by = "", note = "" }) {
  if (!STATUS_IDS.includes(nextStatus) || nextStatus === contact.status) return contact;
  const startsRequest = nextStatus !== "idea" && !contact.askedAt;
  return {
    ...contact,
    status: nextStatus,
    askedAt: startsRequest ? todayIso : contact.askedAt,
    // La relance prévue ne vaut plus une fois la réponse obtenue.
    followUpAt: WAITING_STATUSES.includes(nextStatus) ? contact.followUpAt : "",
    history: [...contact.history, { at: nowIso, status: nextStatus, note: cleanText(note), by }],
  };
}

// Relance faite aujourd'hui : notée au journal, prochaine relance dans une semaine.
function applyFollowUpDone(contact, { todayIso, nowIso, by = "", note = "" }) {
  return {
    ...contact,
    askedAt: contact.askedAt || todayIso,
    followUpAt: addDays(todayIso, DEFAULT_FOLLOW_UP_DAYS),
    history: [...contact.history, { at: nowIso, status: "", note: cleanText(note) || "Relance", by }],
  };
}

function summarizeCelebrityRace(contacts, race, todayIso) {
  const list = contacts.filter((contact) => contact.race === race);
  const count = (statusId) => list.filter((contact) => contact.status === statusId).length;
  return {
    total: list.length,
    confirmed: count("confirmed"),
    waiting: list.filter((contact) => WAITING_STATUSES.includes(contact.status)).length,
    toAsk: count("idea"),
    declined: count("declined"),
    followUpDue: list.filter((contact) => isFollowUpDue(contact, todayIso)).length,
    byGender: Object.fromEntries(
      CELEBRITY_GENDERS.map((gender) => [
        gender.id,
        list.filter((contact) => contact.gender === gender.id && contact.status === "confirmed").length,
      ]),
    ),
  };
}

// Tri : confirmés d'abord, puis par avancement, puis par nom.
function sortCelebrityContacts(contacts) {
  const rank = { confirmed: 0, to_confirm: 1, asked: 2, no_reply: 3, idea: 4, declined: 5 };
  return [...contacts].sort(
    (left, right) =>
      rank[left.status] - rank[right.status] ||
      getCelebrityDisplayName(left).localeCompare(getCelebrityDisplayName(right), "fr"),
  );
}

// Liste de départ (tableau de l'organisation, 18 novembre 2026).
// VRAI → confirmé, « ? » → à demander, « demandé », « à confirmer », « pas de réponse ».
const CELEBRITY_RACE_STARTER_LIST = [
  { race: "influencer", gender: "women", alias: "jf.socialpitstop", status: "confirmed" },
  { race: "influencer", gender: "women", firstName: "Taina", lastName: "Martins", status: "confirmed" },
  { race: "influencer", gender: "women", alias: "mariereneemarguerite", status: "confirmed" },
  { race: "influencer", gender: "women", alias: "followthemexicana", status: "to_confirm" },
  { race: "influencer", gender: "women", alias: "Jenni la b", status: "no_reply" },
  { race: "influencer", gender: "men", firstName: "Cédric", lastName: "Weyler", status: "confirmed" },
  { race: "influencer", gender: "men", firstName: "Chris", lastName: "Baris", status: "confirmed" },
  { race: "influencer", gender: "men", lastName: "Coutinho", status: "confirmed" },
  { race: "influencer", gender: "men", alias: "Argent difficile", status: "idea", notes: "Ligne « Argent difficile » de la liste d'origine, sans statut : à préciser." },
  { race: "influencer", gender: "men", firstName: "Max", lastName: "Feller", status: "asked" },
  { race: "athlete", gender: "women", firstName: "Christine", lastName: "Majerus", status: "confirmed" },
  { race: "athlete", gender: "women", firstName: "Vera", lastName: "Hoffmann", status: "idea" },
  { race: "athlete", gender: "women", firstName: "Mandy", lastName: "Minella", status: "idea" },
  { race: "athlete", gender: "women", firstName: "Amy", lastName: "Thompson", status: "idea" },
  { race: "athlete", gender: "women", firstName: "Nadia", lastName: "Mossong", status: "idea" },
  { race: "athlete", gender: "women", firstName: "Véronique", lastName: "Linster", status: "idea" },
  { race: "athlete", gender: "men", firstName: "Bob", lastName: "Bertemes", status: "asked" },
  { race: "athlete", gender: "men", firstName: "Bob", lastName: "Jungels", status: "asked" },
  { race: "athlete", gender: "men", alias: "Big Bob Bertemes", status: "confirmed", notes: "Aussi « Bob Bertemes » (demandé) dans la liste d'origine : doublon à vérifier." },
  { race: "athlete", gender: "men", firstName: "Gilles", lastName: "Müller", status: "asked" },
  { race: "athlete", gender: "men", firstName: "Michel", lastName: "Ries", status: "confirmed" },
];

export {
  CELEBRITY_GENDERS,
  CELEBRITY_RACES,
  CELEBRITY_RACE_STARTER_LIST,
  CELEBRITY_STATUSES,
  DEFAULT_FOLLOW_UP_DAYS,
  WAITING_STATUSES,
  addDays,
  applyFollowUpDone,
  applyStatusChange,
  getCelebrityDisplayName,
  getCelebrityStatus,
  getFollowUpDate,
  isFollowUpDue,
  normalizeCelebrityContact,
  sortCelebrityContacts,
  summarizeCelebrityRace,
};
