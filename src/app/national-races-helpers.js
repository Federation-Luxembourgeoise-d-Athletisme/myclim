import { normalizeComparableValue } from "./u14-helpers";

// Courses nationales du pré-programme (adultes), pilotées par la commission
// des athlètes : l'inscription passe d'abord par MyCLIM, la commission
// sélectionne sur performance, puis l'organisation engage elle-même les
// athlètes retenus sur SELTEC.
const NATIONAL_RACE_REQUESTS_COLLECTION = "nationalRaceRequests";
const NATIONAL_RACE_ATHLETE_ROLE = "athlete_preprogram";
const NATIONAL_RACE_EVENTS = ["60 m", "800 m"];
const NATIONAL_RACE_MIN_AGE = 14;
const NATIONAL_RACE_ADULT_AGE = 18;

const NATIONAL_RACE_DEFINITIONS = [
  { code: "NAT60F", event: "60 m", gender: "femme", label: "60 m Femmes", quota: 8 },
  { code: "NAT60M", event: "60 m", gender: "homme", label: "60 m Hommes", quota: 8 },
  { code: "NAT800F", event: "800 m", gender: "femme", label: "800 m Femmes", quota: 6 },
  { code: "NAT800M", event: "800 m", gender: "homme", label: "800 m Hommes", quota: 6 },
];

const NATIONAL_RACE_STATUSES = ["submitted", "selected", "waitlist", "not_selected", "withdrawn"];

// Décisions qui donnent lieu à un mail. Changer une décision n'envoie rien :
// la demande passe « à envoyer » tant que notifiedStatus ne correspond pas,
// et la commission envoie au compte-goutte depuis le panneau d'envoi.
const NATIONAL_RACE_NOTIFIABLE_STATUSES = ["selected", "waitlist", "not_selected"];
const NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH = ["appSettings", "nationalRaceMailTemplates"];

const DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES = {
  selected: {
    subject: "Courses nationales : vous êtes retenu(e) pour le {course} / You have been selected",
    bodyFr:
      "Bonjour {prenom},\n\nLa commission des athlètes vous a retenu(e) pour le {course} du pré-programme du CMCM Luxembourg Indoor Meeting.\n\nL'organisation se charge de votre engagement et reviendra vers vous avec les informations pratiques.\n\n{message}Sportivement,\nLa commission des athlètes",
    bodyEn:
      "Hello {prenom},\n\nThe athletes' commission has selected you for the {course} of the CMCM Luxembourg Indoor Meeting pre-programme.\n\nThe organisers handle your entry and will contact you with the practical information.\n\nThe athletes' commission",
  },
  waitlist: {
    subject: "Courses nationales : vous êtes sur liste d'attente pour le {course} / Waiting list",
    bodyFr:
      "Bonjour {prenom},\n\nMerci pour votre demande. Pour le {course} du pré-programme, vous êtes sur liste d'attente : nous vous recontacterons si une place se libère.\n\n{message}Sportivement,\nLa commission des athlètes",
    bodyEn:
      "Hello {prenom},\n\nThank you for your request. For the {course} of the pre-programme, you are on the waiting list: we will contact you if a place becomes available.\n\nThe athletes' commission",
  },
  not_selected: {
    subject: "Courses nationales : votre demande pour le {course} / Your request",
    bodyFr:
      "Bonjour {prenom},\n\nMerci pour votre demande. Les places du {course} du pré-programme étant limitées, la commission des athlètes n'a malheureusement pas pu vous retenir cette année.\n\n{message}Sportivement,\nLa commission des athlètes",
    bodyEn:
      "Hello {prenom},\n\nThank you for your request. Places in the {course} of the pre-programme are limited and the athletes' commission was unfortunately unable to select you this year.\n\nThe athletes' commission",
  },
};

function getNationalRaceCode(event, gender) {
  const genderSuffix = normalizeComparableValue(gender).startsWith("f") ? "F" : "M";
  return `NAT${String(event || "").includes("800") ? "800" : "60"}${genderSuffix}`;
}

function getNationalRaceDefinition(raceCode) {
  return NATIONAL_RACE_DEFINITIONS.find((race) => race.code === raceCode) || null;
}

// "7.45", "7,45", "2:05.30", "2'05\"30" ou "125.3" → secondes. Une saisie
// illisible renvoie null pour être classée en fin de liste côté admin.
function parsePerformanceToSeconds(value) {
  const normalizedValue = String(value || "")
    .trim()
    .replace(/,/g, ".")
    .replace(/['’]/g, ":")
    .replace(/"/g, ".")
    .replace(/\s+/g, "");

  if (!normalizedValue) return null;

  const match = normalizedValue.match(/^(?:(\d{1,2}):)?(\d{1,3}(?:\.\d{1,2})?)$/);
  if (!match) return null;

  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;

  return Number.isFinite(total) && total > 0 ? total : null;
}

function getBestPerformanceSeconds(request) {
  const values = [request?.seasonBest, request?.personalBest]
    .map(parsePerformanceToSeconds)
    .filter((value) => value !== null);

  return values.length ? Math.min(...values) : null;
}

// Ordre de proposition à la commission : licenciés luxembourgeois d'abord
// (prioritaires), puis meilleure performance déclarée, puis ordre d'arrivée.
function compareNationalRaceRequests(left, right) {
  if (Boolean(left.isLuxLicensed) !== Boolean(right.isLuxLicensed)) {
    return left.isLuxLicensed ? -1 : 1;
  }

  const leftPerformance = getBestPerformanceSeconds(left);
  const rightPerformance = getBestPerformanceSeconds(right);

  if (leftPerformance !== rightPerformance) {
    if (leftPerformance === null) return 1;
    if (rightPerformance === null) return -1;
    return leftPerformance - rightPerformance;
  }

  return (left.submittedAtMs || 0) - (right.submittedAtMs || 0);
}

function getNationalRaceStatusKey(status) {
  switch (status) {
    case "selected":
      return "natStatusSelected";
    case "waitlist":
      return "natStatusWaitlist";
    case "not_selected":
      return "natStatusNotSelected";
    case "withdrawn":
      return "natStatusWithdrawn";
    default:
      return "natStatusSubmitted";
  }
}

function getNationalRaceStatusPillClass(status) {
  switch (status) {
    case "selected":
      return "status-pill status-pill--ok";
    case "waitlist":
      return "status-pill status-pill--warn";
    case "not_selected":
    case "withdrawn":
      return "status-pill status-pill--danger";
    default:
      return "status-pill status-pill--pending";
  }
}

function isNationalRaceMailPending(request) {
  return NATIONAL_RACE_NOTIFIABLE_STATUSES.includes(request?.status) && request?.notifiedStatus !== request?.status;
}

function normalizeNationalRaceMailTemplates(data) {
  return Object.fromEntries(
    NATIONAL_RACE_NOTIFIABLE_STATUSES.map((status) => [
      status,
      { ...DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES[status], ...(data?.[status] || {}) },
    ]),
  );
}

function fillTemplate(text, request, raceLabel, message) {
  return String(text || "")
    .replace(/\{prenom\}/g, request.firstName || "")
    .replace(/\{nom\}/g, request.lastName || "")
    .replace(/\{course\}/g, raceLabel)
    .replace(/\{message\}/g, message ? `${message}\n\n` : "");
}

// Mail bilingue d'une décision ; le message personnel n'est ajouté qu'en
// français (bloc {message}) puisqu'il est écrit par la commission.
function buildNationalRaceDecisionMail(request, templates) {
  const template = templates[request.status];
  const raceLabel = getNationalRaceDefinition(request.raceCode)?.label || request.event;
  const message = String(request.athleteMessage || "").trim();
  const body = `${fillTemplate(template.bodyFr, request, raceLabel, message)}\n\n---\n\n${fillTemplate(template.bodyEn, request, raceLabel, "")}`;

  return {
    type: `national-race-${request.status}`,
    to: request.email,
    ...(request.isMinor && request.guardianEmail ? { cc: request.guardianEmail } : {}),
    subject: fillTemplate(template.subject, request, raceLabel, ""),
    body,
    metadata: { requestId: request.id, raceCode: request.raceCode, status: request.status },
  };
}

function getBestTimeSummary(request) {
  const candidates = [
    { label: "PB", prefix: "personalBest" },
    { label: "SB 2026", prefix: "seasonBest" },
  ]
    .map((row) => ({ ...row, seconds: parsePerformanceToSeconds(request?.[row.prefix]) }))
    .filter((row) => row.seconds !== null)
    .sort((left, right) => left.seconds - right.seconds);
  const row = candidates[0] || (request?.otherTime ? { label: "Autre temps", prefix: "otherTime" } : null);

  return row
    ? {
        label: row.label,
        time: request[row.prefix],
        place: request[`${row.prefix}Place`] || "",
        date: request[`${row.prefix}Date`] || "",
      }
    : null;
}

function createEmptyNationalRaceEventEntry() {
  // Trois lignes temps / lieu / date : en indoor, beaucoup n'ont ni PB ni SB
  // sur la distance, d'où la ligne « autre temps » en texte libre.
  return {
    selected: false,
    personalBest: "",
    personalBestPlace: "",
    personalBestDate: "",
    seasonBest: "",
    seasonBestPlace: "",
    seasonBestDate: "",
    otherTime: "",
    otherTimePlace: "",
    otherTimeDate: "",
  };
}

function createEmptyNationalRaceForm() {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    birthDate: "",
    gender: "",
    isLuxLicensed: "oui",
    club: "",
    bibNumber: "",
    foreignCountry: "",
    foreignClub: "",
    foreignLicenceNumber: "",
    events: {
      "60 m": createEmptyNationalRaceEventEntry(),
      "800 m": createEmptyNationalRaceEventEntry(),
    },
    notes: "",
    guardianFirstName: "",
    guardianLastName: "",
    guardianEmail: "",
    guardianPhone: "",
    guardianConsent: false,
    imageConsent: false,
  };
}

export {
  DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES,
  NATIONAL_RACE_ADULT_AGE,
  NATIONAL_RACE_ATHLETE_ROLE,
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_EVENTS,
  NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH,
  NATIONAL_RACE_MIN_AGE,
  NATIONAL_RACE_NOTIFIABLE_STATUSES,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  NATIONAL_RACE_STATUSES,
  buildNationalRaceDecisionMail,
  compareNationalRaceRequests,
  getBestTimeSummary,
  isNationalRaceMailPending,
  normalizeNationalRaceMailTemplates,
  createEmptyNationalRaceForm,
  getBestPerformanceSeconds,
  getNationalRaceCode,
  getNationalRaceDefinition,
  getNationalRaceStatusKey,
  getNationalRaceStatusPillClass,
  parsePerformanceToSeconds,
};
