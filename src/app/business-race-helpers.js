// Business Race (pré-programme) : chaque entreprise inscrite a un portail
// partenaire (vipPartnerPortals/{id}) marqué businessRace, avec un nombre
// d'équipes réglé par l'organisation. Ses invités VIP / normaux passent par
// les fiches du portail (entries) comme pour tout partenaire, donc ils
// arrivent d'eux-mêmes dans la liste VIP, la caisse et les badges VIP.
// Ses coureurs sont dans vipPartnerPortals/{id}/teams/team-{n} : relais mixte
// 4 × 200 m, 2 femmes et 2 hommes, plus 1 remplaçant facultatif.
// Règles pures, testées dans tests/business-race-helpers.test.js.

const RUNNERS_PER_TEAM = 4;
const RUNNERS_PER_GENDER = 2;
// 6 couloirs à la Coque : 6 équipes au maximum dans la course (toutes
// entreprises confondues). 2 équipes au plus par entreprise (Margot,
// 2026-11-19 : on préfère 6 entreprises différentes).
const BUSINESS_RACE_LANES = 6;
const BUSINESS_RACE_MAX_TEAMS = 2;

// Packs du site (/programme#business-race) : valeurs proposées à la création,
// toutes modifiables ensuite.
const BUSINESS_RACE_PACKS = [
  { id: "experience", labelFr: "Business Race Experience", labelEn: "Business Race Experience", teams: 1, vipPlacesCap: 4, standardPlacesCap: 8 },
  { id: "teambuilding", labelFr: "Business Team Building", labelEn: "Business Team Building", teams: 1, vipPlacesCap: 10, standardPlacesCap: 0 },
  { id: "custom", labelFr: "Sur mesure", labelEn: "Custom", teams: 1, vipPlacesCap: 0, standardPlacesCap: 0 },
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function getBusinessRacePack(packId) {
  return BUSINESS_RACE_PACKS.find((pack) => pack.id === packId) || null;
}

function isBusinessRacePortal(portal = {}) {
  return portal.businessRace === true;
}

// Nombre d'équipes réglé pour l'entreprise (0 si le portail n'est pas Business Race).
function getBusinessRaceTeamCount(portal = {}) {
  if (!isBusinessRacePortal(portal)) return 0;
  const count = Math.floor(Number(portal.businessRaceTeams));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, BUSINESS_RACE_MAX_TEAMS);
}

function buildBusinessRaceTeamId(teamNumber) {
  return `team-${teamNumber}`;
}

function normalizeGender(value) {
  return value === "F" || value === "M" ? value : "";
}

// Coordonnées demandées pour chaque coureur (relayeurs et remplaçant), en plus
// du nom et du genre : email, portable, année de naissance et règlement accepté
// (qui couvre aussi photos et vidéos : pas de refus possible). Le contact
// d'urgence est facultatif.
const RUNNER_DETAIL_FIELDS = ["email", "phone", "birthYear", "rules"];

function normalizeBirthYear(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 4);
}

function isValidBirthYear(value, now = new Date()) {
  const year = Number(value);
  return /^\d{4}$/.test(String(value)) && year >= 1920 && year <= now.getFullYear() - 10;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function createEmptyBusinessRaceRunner(overrides = {}) {
  return normalizeBusinessRaceRunner(overrides);
}

function normalizeBusinessRaceRunner(runner = {}) {
  return {
    firstName: cleanText(runner.firstName),
    lastName: cleanText(runner.lastName),
    gender: normalizeGender(runner.gender),
    // L'entreprise peut donner une de ses invitations VIP à un coureur :
    // il a alors deux badges (Business Race + VIP).
    vip: runner.vip === true,
    email: cleanText(runner.email).toLowerCase(),
    phone: cleanText(runner.phone),
    birthYear: normalizeBirthYear(runner.birthYear),
    emergencyFirstName: cleanText(runner.emergencyFirstName),
    emergencyLastName: cleanText(runner.emergencyLastName),
    emergencyPhone: cleanText(runner.emergencyPhone),
    // Le coureur est apte, accepte le règlement (photos et vidéos comprises)
    // et court sous sa propre responsabilité.
    rulesAccepted: runner.rulesAccepted === true,
  };
}

// Informations manquantes d'un coureur saisi (rien tant que son nom est vide).
function getRunnerMissingDetails(runner = {}) {
  if (!runnerIsFilled(runner)) return [];
  const normalized = normalizeBusinessRaceRunner(runner);
  const missing = [];
  if (!isValidEmail(normalized.email)) missing.push("email");
  if (!normalized.phone) missing.push("phone");
  if (!isValidBirthYear(normalized.birthYear)) missing.push("birthYear");
  if (!normalized.rulesAccepted) missing.push("rules");
  return missing;
}

function runnerIsFilled(runner = {}) {
  return Boolean(cleanText(runner.firstName) && cleanText(runner.lastName));
}

// Équipe telle qu'affichée / enregistrée : toujours 4 relayeurs dans l'ordre
// des passages, plus le remplaçant.
function normalizeBusinessRaceTeam(team = {}, teamNumber = 1) {
  const runners = Array.from({ length: RUNNERS_PER_TEAM }, (_, index) =>
    normalizeBusinessRaceRunner(Array.isArray(team.runners) ? team.runners[index] : undefined),
  );
  return {
    teamNumber: Math.max(1, Math.floor(Number(team.teamNumber) || teamNumber)),
    teamName: cleanText(team.teamName),
    runners,
    reserve: normalizeBusinessRaceRunner(team.reserve),
  };
}

// État d'une équipe : relayeurs saisis, répartition femmes / hommes.
// Le genre manquant ne bloque pas l'enregistrement, il est signalé.
function getBusinessRaceTeamStatus(team = {}) {
  const normalized = normalizeBusinessRaceTeam(team);
  const filledRunners = normalized.runners.filter(runnerIsFilled);
  const women = filledRunners.filter((runner) => runner.gender === "F").length;
  const men = filledRunners.filter((runner) => runner.gender === "M").length;
  const missingGender = filledRunners.filter((runner) => !runner.gender).length;
  const filled = filledRunners.length;
  const genderOk = women === RUNNERS_PER_GENDER && men === RUNNERS_PER_GENDER;
  // Coureurs saisis (remplaçant compris) à qui il manque des informations.
  const missingDetails = [...normalized.runners, normalized.reserve].filter((runner) => getRunnerMissingDetails(runner).length > 0).length;
  const detailsOk = missingDetails === 0;
  const complete = filled === RUNNERS_PER_TEAM && genderOk && detailsOk;
  let state = "empty";
  if (complete) state = "complete";
  else if (filled > 0 || normalized.teamName) state = "partial";
  return {
    filled,
    women,
    men,
    missingGender,
    genderOk,
    missingDetails,
    detailsOk,
    complete,
    hasReserve: runnerIsFilled(normalized.reserve),
    state,
  };
}

// Toutes les équipes d'un portail, des numéros 1 à N, en complétant les vides.
function buildBusinessRaceTeams(portal = {}, storedTeams = []) {
  const count = getBusinessRaceTeamCount(portal);
  const byNumber = new Map(
    storedTeams.map((team) => [Math.floor(Number(team.teamNumber)) || 0, team]),
  );
  return Array.from({ length: count }, (_, index) => {
    const teamNumber = index + 1;
    const stored = byNumber.get(teamNumber) || {};
    return { id: buildBusinessRaceTeamId(teamNumber), ...normalizeBusinessRaceTeam(stored, teamNumber) };
  });
}

// Nom d'équipe affiché : celui choisi, sinon l'entreprise (+ numéro s'il y en a plusieurs).
function getBusinessRaceTeamLabel(team = {}, organization = "", teamCount = 1) {
  const name = cleanText(team.teamName);
  if (name) return name;
  const base = cleanText(organization) || "Business Race";
  return teamCount > 1 ? `${base} ${team.teamNumber || 1}` : base;
}

// Clé du badge d'un coureur dans les suivis d'impression (volunteerOverrides).
function businessRaceBadgeKey(portalId, teamNumber, slot) {
  return `br-${portalId}-${teamNumber}-${slot}`;
}

// Coureurs à accréditer : relayeurs et remplaçants saisis, toutes entreprises.
// portals : portails Business Race ; teamsByPortal : { [portalId]: équipes enregistrées }.
function listBusinessRaceRunners(portals = [], teamsByPortal = {}) {
  const runners = [];
  portals.filter(isBusinessRacePortal).forEach((portal) => {
    const organization = cleanText(portal.organizationName) || portal.id;
    const teams = buildBusinessRaceTeams(portal, teamsByPortal[portal.id] || []);
    teams.forEach((team) => {
      const teamLabel = getBusinessRaceTeamLabel(team, organization, teams.length);
      const slots = [
        ...team.runners.map((runner, index) => ({ runner, slot: `leg${index + 1}`, leg: index + 1 })),
        { runner: team.reserve, slot: "reserve", leg: 0 },
      ];
      slots.forEach(({ runner, slot, leg }) => {
        if (!runnerIsFilled(runner)) return;
        runners.push({
          key: businessRaceBadgeKey(portal.id, team.teamNumber, slot),
          portalId: portal.id,
          organization,
          teamNumber: team.teamNumber,
          teamLabel,
          leg,
          isReserve: slot === "reserve",
          firstName: runner.firstName,
          lastName: runner.lastName,
          gender: runner.gender,
          vip: runner.vip === true,
          email: runner.email,
          phone: runner.phone,
          birthYear: runner.birthYear,
          emergencyFirstName: runner.emergencyFirstName,
          emergencyLastName: runner.emergencyLastName,
          emergencyPhone: runner.emergencyPhone,
          rulesAccepted: runner.rulesAccepted,
          missingDetails: getRunnerMissingDetails(runner),
        });
      });
    });
  });
  return runners.sort(
    (left, right) =>
      left.organization.localeCompare(right.organization, "fr") ||
      left.teamNumber - right.teamNumber ||
      (left.isReserve ? 9 : left.leg) - (right.isReserve ? 9 : right.leg),
  );
}

// Coordonnées de facturation de l'entreprise, saisies sur son portail
// (vipPartnerPortals/{id}/billing/current : privé, pas sur le doc public du portail).
const BILLING_FIELDS = [
  "companyName",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "country",
  "contactFirstName",
  "contactLastName",
  "email",
  "orderReference",
];
const BILLING_REQUIRED_FIELDS = ["companyName", "address", "postalCode", "city", "country", "contactFirstName", "contactLastName", "email"];

function normalizeBusinessRaceBilling(billing = {}) {
  const next = {};
  BILLING_FIELDS.forEach((field) => {
    next[field] = cleanText(billing?.[field]);
  });
  next.email = next.email.toLowerCase();
  return next;
}

function getBillingMissingFields(billing = {}) {
  const normalized = normalizeBusinessRaceBilling(billing);
  const missing = BILLING_REQUIRED_FIELDS.filter((field) => !normalized[field]);
  if (normalized.email && !isValidEmail(normalized.email)) missing.push("email");
  return missing;
}

// Valeurs du portail enregistrées depuis le formulaire admin.
function buildBusinessRacePortalFields(form = {}) {
  const teams = Math.floor(Number(form.businessRaceTeams));
  return {
    businessRace: true,
    businessRacePack: getBusinessRacePack(form.businessRacePack) ? form.businessRacePack : "custom",
    businessRaceTeams: Number.isFinite(teams) && teams >= 1 ? Math.min(teams, BUSINESS_RACE_MAX_TEAMS) : 1,
  };
}

// Fiche invité VIP créée pour un coureur à qui l'entreprise donne une place VIP
// (vipPartnerPortals/{id}/entries/br-runner-{n}-{slot}).
const RUNNER_VIP_SOURCE = "business_race_runner";

function buildRunnerVipEntryId(teamNumber, slot) {
  return `br-runner-${teamNumber}-${slot}`;
}

// Emplacements d'une équipe (relayeurs 1 à 4, remplaçant) avec leur coureur.
function listTeamSlots(team = {}) {
  const normalized = normalizeBusinessRaceTeam(team, team.teamNumber);
  return [
    ...normalized.runners.map((runner, index) => ({ slot: `leg${index + 1}`, runner })),
    { slot: "reserve", runner: normalized.reserve },
  ];
}

// Coureurs de l'équipe qui prennent une place VIP (nom saisi et case cochée).
function countTeamVipRunners(team = {}) {
  return listTeamSlots(team).filter(({ runner }) => runner.vip && runnerIsFilled(runner)).length;
}

// Réglages communs (admin seulement) : dernière modification des équipes et
// entraînements au passage de témoin. Plusieurs lignes d'entraînement
// possibles selon les disponibilités ; chacune s'applique aux équipes cochées
// (clé « portail#numéro »), ou à toutes les autres équipes si aucune n'est cochée.
const DEFAULT_TRAINING = Object.freeze({ id: "training-1", date: "2027-01-15", time: "14:00", place: "", note: "", teamKeys: [] });

const DEFAULT_BUSINESS_RACE_SETTINGS = Object.freeze({
  teamsDeadline: "2027-01-07",
  trainings: [DEFAULT_TRAINING],
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function buildTeamKey(portalId, teamNumber) {
  return `${portalId}#${teamNumber}`;
}

function normalizeTraining(raw = {}, index = 0) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    id: cleanText(data.id) || `training-${index + 1}`,
    date: DATE_RE.test(data.date || "") ? data.date : "",
    time: TIME_RE.test(data.time || "") ? data.time : "",
    place: cleanText(data.place),
    note: cleanText(data.note),
    teamKeys: [...new Set((Array.isArray(data.teamKeys) ? data.teamKeys : []).map(cleanText).filter(Boolean))],
  };
}

function normalizeBusinessRaceSettings(raw = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const deadline = typeof data.teamsDeadline === "string" && (data.teamsDeadline === "" || DATE_RE.test(data.teamsDeadline))
    ? data.teamsDeadline
    : DEFAULT_BUSINESS_RACE_SETTINGS.teamsDeadline;
  const trainings = Array.isArray(data.trainings) ? data.trainings : DEFAULT_BUSINESS_RACE_SETTINGS.trainings;
  return { teamsDeadline: deadline, trainings: trainings.map(normalizeTraining) };
}

// Entraînements d'une équipe : les lignes où elle est cochée, sinon les lignes
// « toutes les équipes » (aucune équipe cochée). Triés par date et heure.
function getTeamTrainings(settings = {}, portalId = "", teamNumber = 1) {
  const { trainings } = normalizeBusinessRaceSettings(settings);
  const key = buildTeamKey(portalId, teamNumber);
  const own = trainings.filter((training) => training.teamKeys.includes(key));
  const list = own.length ? own : trainings.filter((training) => !training.teamKeys.length);
  return list.filter((training) => training.date).sort((left, right) => `${left.date}${left.time}`.localeCompare(`${right.date}${right.time}`));
}

// Fin du dernier jour de modification (23:59:59, heure locale).
function getTeamsDeadlineEnd(settings = {}) {
  const date = normalizeBusinessRaceSettings(settings).teamsDeadline;
  if (!date) return null;
  const end = new Date(`${date}T23:59:59`);
  return Number.isNaN(end.getTime()) ? null : end;
}

function areBusinessRaceTeamsLocked(settings = {}, now = new Date()) {
  const end = getTeamsDeadlineEnd(settings);
  return Boolean(end && now.getTime() > end.getTime());
}

export {
  DEFAULT_BUSINESS_RACE_SETTINGS,
  RUNNER_VIP_SOURCE,
  areBusinessRaceTeamsLocked,
  buildTeamKey,
  getTeamTrainings,
  normalizeTraining,
  buildRunnerVipEntryId,
  countTeamVipRunners,
  getTeamsDeadlineEnd,
  listTeamSlots,
  normalizeBusinessRaceSettings,
};

export {
  BILLING_FIELDS,
  BILLING_REQUIRED_FIELDS,
  RUNNER_DETAIL_FIELDS,
  getBillingMissingFields,
  getRunnerMissingDetails,
  isValidBirthYear,
  isValidEmail,
  normalizeBusinessRaceBilling,
};

export {
  BUSINESS_RACE_LANES,
  BUSINESS_RACE_MAX_TEAMS,
  BUSINESS_RACE_PACKS,
  RUNNERS_PER_GENDER,
  RUNNERS_PER_TEAM,
  buildBusinessRacePortalFields,
  buildBusinessRaceTeamId,
  buildBusinessRaceTeams,
  businessRaceBadgeKey,
  createEmptyBusinessRaceRunner,
  getBusinessRacePack,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamLabel,
  getBusinessRaceTeamStatus,
  isBusinessRacePortal,
  listBusinessRaceRunners,
  normalizeBusinessRaceRunner,
  normalizeBusinessRaceTeam,
  runnerIsFilled,
};

// Lien du portail à envoyer à l'entreprise.
function buildBusinessRacePortalPath(portalId) {
  return `/business-race/${encodeURIComponent(String(portalId || "").trim())}`;
}

export { buildBusinessRacePortalPath };
