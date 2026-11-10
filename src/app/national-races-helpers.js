import { normalizeComparableValue } from "./u14-helpers";

// Courses nationales du pré-programme (adultes), pilotées par la commission
// des athlètes : l'inscription passe d'abord par MyCLIM, la commission
// sélectionne sur performance, puis l'organisation engage elle-même les
// athlètes retenus sur SELTEC.
// Règles 2027 (commission des athlètes, nov. 2026) :
// - 60 m : sur invitation uniquement, la commission ajoute les athlètes
//   depuis son module (pas dans le formulaire public) ;
// - 800 m : 8 places par course (7 + 1 lièvre, ou 8 sans lièvre), jusqu'à
//   3 places réservées aux licenciés luxembourgeois, sélection sur SB ;
// - sélection communiquée deux semaines avant le meeting ;
// - aucun paiement (ni inscription, ni lièvre).
const NATIONAL_RACE_REQUESTS_COLLECTION = "nationalRaceRequests";
const NATIONAL_RACE_ATHLETE_ROLE = "athlete_preprogram";
const NATIONAL_RACE_EVENTS = ["60 m", "800 m"];
// Épreuves ouvertes dans le formulaire public : le 60 m est sur invitation.
const NATIONAL_RACE_PUBLIC_EVENTS = ["800 m"];
const NATIONAL_RACE_SELECTION_DAYS_BEFORE = 14;
const NATIONAL_RACE_PACER_ROLE = "pacer";
const NATIONAL_RACE_MIN_AGE = 14;
const NATIONAL_RACE_ADULT_AGE = 18;

const NATIONAL_RACE_DEFINITIONS = [
  { code: "NAT60F", event: "60 m", gender: "femme", label: "60 m Femmes", quota: 8, invitationOnly: true, luxReserved: 0, allowsPacer: false },
  { code: "NAT60M", event: "60 m", gender: "homme", label: "60 m Hommes", quota: 8, invitationOnly: true, luxReserved: 0, allowsPacer: false },
  { code: "NAT800F", event: "800 m", gender: "femme", label: "800 m Femmes", quota: 8, invitationOnly: false, luxReserved: 3, allowsPacer: true },
  { code: "NAT800M", event: "800 m", gender: "homme", label: "800 m Hommes", quota: 8, invitationOnly: false, luxReserved: 3, allowsPacer: true },
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
      "Bonjour {prenom},\n\nLa commission des athlètes vous a retenu(e) pour le {course} du pré-programme du CMCM Luxembourg Indoor Meeting.\n\nL'organisation se charge de votre engagement. Le jour du meeting :\n- vous entrez par l'entrée des athlètes internationaux, par la salle d'échauffement (warm-up) ;\n- vous y récupérez votre accréditation ;\n- une entrée gratuite est prévue pour 1 accompagnateur : il donne votre nom à la caisse pour recevoir son ticket.\n\nMerci de nous prévenir au plus vite si vous ne pouvez plus participer.\n\n{message}Sportivement,\nLa commission des athlètes",
    bodyEn:
      "Hello {prenom},\n\nThe athletes' commission has selected you for the {course} of the CMCM Luxembourg Indoor Meeting pre-programme.\n\nThe organisers handle your entry. On meeting day:\n- you come in through the international athletes' entrance, via the warm-up area;\n- you collect your accreditation there;\n- one free entry is provided for 1 companion: they give your name at the ticket desk to receive their ticket.\n\nPlease let us know as soon as possible if you can no longer take part.\n\nThe athletes' commission",
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

// La sélection se fait sur le SB 2026/2027, à défaut le SB 2025 (accepté par
// la commission), puis le PB s'il n'y a aucun SB lisible.
function getBestPerformanceSeconds(request) {
  return (
    parsePerformanceToSeconds(request?.seasonBest) ??
    parsePerformanceToSeconds(request?.previousSeasonBest) ??
    parsePerformanceToSeconds(request?.personalBest)
  );
}

function isNationalRacePacer(request) {
  return request?.role === NATIONAL_RACE_PACER_ROLE;
}

// Classement proposé à la commission : meilleur SB, puis PB, puis ordre
// d'arrivée. Les places réservées aux Luxembourgeois sont gérées par
// getProposedNationalRaceSelection, pas par le tri.
function compareNationalRaceRequests(left, right) {
  const leftPerformance = getBestPerformanceSeconds(left);
  const rightPerformance = getBestPerformanceSeconds(right);

  if (leftPerformance !== rightPerformance) {
    if (leftPerformance === null) return 1;
    if (rightPerformance === null) return -1;
    return leftPerformance - rightPerformance;
  }

  return (left.submittedAtMs || 0) - (right.submittedAtMs || 0);
}

// Places d'athlètes d'une course : un lièvre retenu prend une des places.
function getNationalRaceAthleteQuota(race, raceRequests = []) {
  const pacers = raceRequests.filter((request) => isNationalRacePacer(request) && request.status === "selected").length;
  return Math.max(0, (race?.quota || 0) - pacers);
}

// Sélection proposée : d'abord les meilleurs licenciés luxembourgeois sur les
// places réservées (jusqu'à luxReserved), puis le reste au temps, tous
// confondus. Renvoie les demandes retenues dans l'ordre du classement.
function getProposedNationalRaceSelection(race, raceRequests = []) {
  const quota = getNationalRaceAthleteQuota(race, raceRequests);
  const candidates = raceRequests
    .filter((request) => request.status !== "withdrawn" && !isNationalRacePacer(request))
    .sort(compareNationalRaceRequests);
  const reserved = candidates.filter((request) => request.isLuxLicensed).slice(0, Math.min(race?.luxReserved || 0, quota));
  const reservedIds = new Set(reserved.map((request) => request.id));
  const open = candidates.filter((request) => !reservedIds.has(request.id)).slice(0, quota - reserved.length);
  const selectedIds = new Set([...reservedIds, ...open.map((request) => request.id)]);

  return {
    selection: candidates.filter((request) => selectedIds.has(request.id)),
    reservedIds,
  };
}

// Date à laquelle les athlètes sont prévenus : deux semaines avant le meeting.
function getNationalRaceSelectionDate(meetingDate) {
  const date = meetingDate?.toDate?.() || (meetingDate ? new Date(meetingDate) : null);
  if (!date || Number.isNaN(date.getTime())) return null;
  const selectionDate = new Date(date);
  selectionDate.setDate(selectionDate.getDate() - NATIONAL_RACE_SELECTION_DAYS_BEFORE);
  return selectionDate;
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
    { label: "SB", prefix: "seasonBest" },
    { label: "SB 2025", prefix: "previousSeasonBest" },
  ]
    .map((row) => ({ ...row, seconds: parsePerformanceToSeconds(request?.[row.prefix]) }))
    .filter((row) => row.seconds !== null);
  // Même ordre que le classement : SB 2026/2027, puis SB 2025, puis PB.
  const row =
    ["seasonBest", "previousSeasonBest", "personalBest"].map((prefix) => candidates.find((candidate) => candidate.prefix === prefix)).find(Boolean) ||
    (request?.otherTime ? { label: "Autre temps", prefix: "otherTime" } : null);

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
    previousSeasonBest: "",
    previousSeasonBestPlace: "",
    previousSeasonBestDate: "",
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
    // Information à part : les places réservées dépendent de la licence dans
    // un club luxembourgeois, pas de la nationalité.
    nationality: "",
    worldAthleticsUrl: "",
    // Question 8 du Forms de la commission : prêt(e) à payer un lièvre (oui /
    // non). Sans réponse « oui » suffisante, pas de lièvre garanti.
    pacerPayment: "",
    isLuxLicensed: "oui",
    club: "",
    bibNumber: "",
    foreignCountry: "",
    foreignClub: "",
    foreignLicenceNumber: "",
    events: {
      "60 m": createEmptyNationalRaceEventEntry(),
      // Seule épreuve du formulaire public : cochée d'office.
      "800 m": { ...createEmptyNationalRaceEventEntry(), selected: true },
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
  NATIONAL_RACE_PACER_ROLE,
  NATIONAL_RACE_PUBLIC_EVENTS,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  NATIONAL_RACE_SELECTION_DAYS_BEFORE,
  NATIONAL_RACE_STATUSES,
  buildNationalRaceDecisionMail,
  compareNationalRaceRequests,
  getBestTimeSummary,
  isNationalRaceMailPending,
  normalizeNationalRaceMailTemplates,
  createEmptyNationalRaceForm,
  getBestPerformanceSeconds,
  getNationalRaceAthleteQuota,
  getNationalRaceCode,
  getNationalRaceDefinition,
  getNationalRaceSelectionDate,
  getProposedNationalRaceSelection,
  isNationalRacePacer,
  getNationalRaceStatusKey,
  getNationalRaceStatusPillClass,
  parsePerformanceToSeconds,
};
