import { getAppBaseUrl } from "../services/app-url";

function normalizeComparableValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// Places protégées U12/U14 : des enfants invités par l'organisation, dont la
// famille choisit elle-même la course. Chaque catégorie a une réserve
// (U12 : 3 filles et 3 garçons, U14 : 6 et 6) bloquée dans toutes ses
// courses ; chaque enfant invité qui confirme prend sa place dans la course
// choisie et la réserve diminue d'autant. À la date limite, le reste de la
// réserve est rendu aux places générales.
const U14_PROTECTED_INVITES_COLLECTION = "u14ProtectedInvites";
const U14_PROTECTED_SETTINGS_DOC_PATH = ["appSettings", "u14ProtectedSettings"];
const DEFAULT_U14_PROTECTED_POOLS = { U12F: 3, U12M: 3, U14F: 6, U14M: 6 };
const U14_PROTECTED_POOL_LABELS = {
  U12F: "U12 filles",
  U12M: "U12 garçons",
  U14F: "U14 filles",
  U14M: "U14 garçons",
};

function getU14PoolKey(category, gender) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  if (!["U12", "U14"].includes(normalizedCategory)) return "";
  const normalizedGender = normalizeComparableValue(gender);
  if (normalizedGender.startsWith("f")) return `${normalizedCategory}F`;
  if (normalizedGender.startsWith("g") || normalizedGender.startsWith("m")) return `${normalizedCategory}M`;
  return "";
}

function normalizeU14ProtectedSettings(data) {
  const pools = { ...DEFAULT_U14_PROTECTED_POOLS };
  Object.keys(pools).forEach((key) => {
    const value = Number(data?.pools?.[key]);
    if (Number.isFinite(value) && value >= 0) pools[key] = Math.floor(value);
  });
  return { pools, deadline: String(data?.deadline || "") };
}

// La date limite est une date (AAAA-MM-JJ) valable jusqu'à la fin de la journée.
function getU14ProtectedDeadlineMs(deadline) {
  if (!deadline) return 0;
  const date = new Date(`${deadline}T23:59:59`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isU14ProtectedDeadlinePassed(deadline, now = Date.now()) {
  const deadlineMs = getU14ProtectedDeadlineMs(deadline);
  return Boolean(deadlineMs) && deadlineMs < now;
}

function getU14ProtectedInviteStatus(invite, now = Date.now()) {
  const status = String(invite?.status || "invited");
  if (status === "invited" && isU14ProtectedDeadlinePassed(invite?.deadline, now)) return "expired";
  return status;
}

const U14_PROTECTED_INVITE_STATUS_LABELS = {
  invited: "Invitation envoyée",
  claimed: "Inscrit et confirmé",
  expired: "Expirée — place libérée",
  cancelled: "Annulée",
};

// Liste collée depuis Excel : Nom, Prénom, Club, Mail, Bib (tabulations,
// points-virgules ou virgules). Une ligne d'en-tête éventuelle est ignorée.
function parseU14ProtectedInvitesPaste(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",").map((cell) => cell.trim()))
    .filter((cells) => !/^(nom|name)$/i.test(cells[0] || ""))
    .map(([lastName = "", firstName = "", club = "", parentEmail = "", bibNumber = ""]) => {
      const errors = [];
      if (!lastName || !firstName) errors.push("nom ou prénom manquant");
      if (!/^\S+@\S+\.\S+$/.test(parentEmail)) errors.push("mail invalide");
      if (!bibNumber) errors.push("dossard manquant");
      return { lastName, firstName, club, parentEmail: parentEmail.toLowerCase(), bibNumber, errors };
    });
}

function generateU14InviteToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function buildU14ProtectedInviteUrl(token) {
  return `${getAppBaseUrl()}/pre-programme?invitation=${token}`;
}

export {
  DEFAULT_U14_PROTECTED_POOLS,
  U14_PROTECTED_INVITES_COLLECTION,
  U14_PROTECTED_INVITE_STATUS_LABELS,
  U14_PROTECTED_POOL_LABELS,
  U14_PROTECTED_SETTINGS_DOC_PATH,
  buildU14ProtectedInviteUrl,
  generateU14InviteToken,
  getU14PoolKey,
  getU14ProtectedDeadlineMs,
  getU14ProtectedInviteStatus,
  isU14ProtectedDeadlinePassed,
  normalizeU14ProtectedSettings,
  parseU14ProtectedInvitesPaste,
};
