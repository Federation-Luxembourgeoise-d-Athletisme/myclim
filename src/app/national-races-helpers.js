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
  NATIONAL_RACE_ADULT_AGE,
  NATIONAL_RACE_ATHLETE_ROLE,
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_EVENTS,
  NATIONAL_RACE_MIN_AGE,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  NATIONAL_RACE_STATUSES,
  compareNationalRaceRequests,
  createEmptyNationalRaceForm,
  getBestPerformanceSeconds,
  getNationalRaceCode,
  getNationalRaceDefinition,
  getNationalRaceStatusKey,
  getNationalRaceStatusPillClass,
  parsePerformanceToSeconds,
};
