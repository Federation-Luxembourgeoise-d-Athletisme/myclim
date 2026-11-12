// Programme du dimanche (Équipes & affectations › Programme du dimanche) :
// règles pures, sans Firebase, testées dans tests/meeting-day-programme.test.js.
//
// Décisions de Margot (09/11/2026, maquette design/programme) :
//  - grille de 8:00 à 20:00 par 15 min ; une colonne « Programme piste » en
//    lecture, reprise du timetable de l'édition (pré-programme compris) ;
//  - une colonne « Général » (arrivée, repas…) vue par tout le monde ;
//  - une colonne par équipe bénévole, ou une par sous-rôle quand l'équipe est
//    « détaillée » (Accueil & billetterie : billets, runner inside…) ;
//  - des colonnes libres hors bénévoles (Apex, TV, Officials, Speakers…) ;
//  - une activité = bloc début/fin, catégorie, lieu, responsable, note, et
//    une ou plusieurs colonnes ;
//  - bénévoles et chefs d'équipe voient leur équipe + le Général.
//
// Document Firestore : meetingDayProgrammes/{année}-{jour}
//   { mode, splitTeamIds, subRoleColumns: { [teamId]: [noms] }, extraColumns: [{ id, name }],
//     hiddenTeamIds, visibleOrgTeamIds, activities }
//
// Extension du 09/11/2026 (Planning) : un onglet par jour de la CLIM Week
// (lundi → lundi, vendredi/samedi/dimanche compris), chaque jour en grille
// ou en liste ; les équipes de l'organisation (organisation-teams.js) sont
// des colonnes au même titre que les équipes bénévoles ; une activité peut
// porter un effectif / des personnes (« LUNEX (2) ») et être « toute la journée ».

import { editionDateYmd } from "./meeting-edition-utils.js";

const PROGRAMME_START = 8 * 60;
const PROGRAMME_END = 20 * 60;
const PROGRAMME_STEP = 15;
const GENERAL_COLUMN_KEY = "general";

// Jours du planning, par rapport au dimanche du meeting (jour 0).
// Le dimanche garde l'identifiant de document d'origine ({année}-sunday).
const PLANNING_DAYS = [
  { key: "mon-before", offset: -6, label: "Lundi", short: "Lun.", defaultMode: "list" },
  { key: "tue-before", offset: -5, label: "Mardi", short: "Mar.", defaultMode: "list" },
  { key: "wed-before", offset: -4, label: "Mercredi", short: "Mer.", defaultMode: "list" },
  { key: "thu-before", offset: -3, label: "Jeudi", short: "Jeu.", defaultMode: "list" },
  { key: "friday", offset: -2, label: "Vendredi", short: "Ven.", defaultMode: "grid" },
  { key: "saturday", offset: -1, label: "Samedi", short: "Sam.", defaultMode: "grid" },
  { key: "sunday", offset: 0, label: "Dimanche · meeting", short: "Dim.", defaultMode: "grid" },
  { key: "mon-after", offset: 1, label: "Lundi (après)", short: "Lun.", defaultMode: "list" },
];

function getPlanningDay(key) {
  return PLANNING_DAYS.find((day) => day.key === key) || PLANNING_DAYS.find((day) => day.key === "sunday");
}

// Date du jour à partir de la date du meeting (« 2027-01-17 » ou Timestamp
// Firestore, tel qu'enregistré par Site web › Édition), ou null.
function getPlanningDayDate(meetingDate, dayKey) {
  const match = editionDateYmd(meetingDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + getPlanningDay(dayKey).offset);
  return date;
}

const PROGRAMME_CATEGORIES = [
  { value: "briefing", label: "Briefing", background: "#e3edfb", border: "#3c6fd1" },
  { value: "accred", label: "Accréditation & t-shirts", background: "#efe6fb", border: "#8a56d6" },
  { value: "setup", label: "Installation / mise en place", background: "#fff2d9", border: "#d99a1e" },
  { value: "race", label: "Course / entraînement", background: "#e2f4e8", border: "#2e9a5a" },
  { value: "tech", label: "Technique / tests", background: "#fde7e9", border: "#c8314a" },
  { value: "meal", label: "Repas", background: "#eaf6f6", border: "#2f9a9a" },
  { value: "other", label: "Autre", background: "#eef1f5", border: "#8391a3" },
];

// Lieux de la Coque (plans du lieu) ; le champ accepte aussi du texte libre.
const COQUE_PLACES = [
  "Hall d'entrée",
  "Billetterie",
  "Entrée · info",
  "Arcades",
  "Buvette",
  "Bar & food (mur du gymnase)",
  "Discovery corner",
  "Amphithéâtre",
  "Échauffement",
  "Call room",
  "Piste (R-1)",
  "Mixed zone",
  "Salon VIP / Judges room",
  "Galerie (R+1)",
  "Zone bénévoles (galerie)",
  "Salle de presse",
  "Parking",
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function toMinutes(time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function toTimeLabel(minutes) {
  const value = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function getProgrammeTimeOptions() {
  const options = [];
  for (let minute = PROGRAMME_START; minute <= PROGRAMME_END; minute += PROGRAMME_STEP) options.push(toTimeLabel(minute));
  return options;
}

function getCategory(value) {
  return PROGRAMME_CATEGORIES.find((category) => category.value === value) || PROGRAMME_CATEGORIES.at(-1);
}

function cleanNames(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeProgramme(data = {}, dayKey = "sunday") {
  const subRoleColumns = {};
  Object.entries(data?.subRoleColumns && typeof data.subRoleColumns === "object" ? data.subRoleColumns : {}).forEach(
    ([teamId, names]) => {
      subRoleColumns[teamId] = cleanNames(names);
    },
  );
  return {
    mode: data?.mode === "list" || data?.mode === "grid" ? data.mode : getPlanningDay(dayKey).defaultMode,
    splitTeamIds: cleanNames(data?.splitTeamIds),
    hiddenTeamIds: cleanNames(data?.hiddenTeamIds),
    visibleOrgTeamIds: cleanNames(data?.visibleOrgTeamIds),
    subRoleColumns,
    extraColumns: (Array.isArray(data?.extraColumns) ? data.extraColumns : [])
      .filter((column) => column?.id && String(column.name || "").trim())
      .map((column) => ({ id: String(column.id), name: String(column.name).trim() })),
    activities: (Array.isArray(data?.activities) ? data.activities : [])
      .filter((activity) => activity?.id && toMinutes(activity.start) !== null && toMinutes(activity.end) !== null)
      .map((activity) => ({
        id: String(activity.id),
        title: String(activity.title || ""),
        start: toTimeLabel(toMinutes(activity.start)),
        end: toTimeLabel(toMinutes(activity.end)),
        category: getCategory(activity.category).value,
        place: String(activity.place || ""),
        owner: String(activity.owner || ""),
        note: String(activity.note || ""),
        people: String(activity.people || ""),
        allDay: Boolean(activity.allDay),
        columns: cleanNames(activity.columns),
      })),
  };
}

function orgColumnKey(orgTeamId) {
  return `org:${orgTeamId}`;
}

function teamColumnKey(teamId) {
  return `team:${teamId}`;
}

function subRoleColumnKey(teamId, subRole) {
  return `sub:${teamId}:${subRole}`;
}

function getTeamSubRoleNames(team, programme) {
  return cleanNames([...(team?.subRoles || []), ...(programme.subRoleColumns[team?.id] || [])]);
}

// Colonnes affichées : Général, puis chaque équipe bénévole (ou ses
// sous-rôles quand elle est détaillée) sauf celles masquées ce jour-là, puis
// les équipes de l'organisation affichées ce jour-là, puis les colonnes libres.
// { all: true } ignore le masquage (liste des colonnes dans le panneau).
function buildProgrammeColumns(teams = [], programme = normalizeProgramme(), orgTeams = [], options = {}) {
  const columns = [{ key: GENERAL_COLUMN_KEY, kind: "general", name: "Général · tout le monde" }];
  teams.filter((team) => options.all || !programme.hiddenTeamIds.includes(team.id)).forEach((team) => {
    const subRoles = getTeamSubRoleNames(team, programme);
    if (programme.splitTeamIds.includes(team.id) && subRoles.length) {
      subRoles.forEach((subRole) =>
        columns.push({ key: subRoleColumnKey(team.id, subRole), kind: "subrole", name: subRole, teamId: team.id, teamName: team.roleName }),
      );
    } else {
      columns.push({ key: teamColumnKey(team.id), kind: "team", name: team.roleName, teamId: team.id, teamName: team.roleName });
    }
  });
  orgTeams
    .filter((team) => options.all || programme.visibleOrgTeamIds.includes(team.id))
    .forEach((team) => columns.push({ key: orgColumnKey(team.id), kind: "org", name: team.name, orgTeamId: team.id }));
  programme.extraColumns.forEach((column) => columns.push({ key: `extra:${column.id}`, kind: "extra", name: column.name, extraId: column.id }));
  return columns;
}

// Activités d'un jour pour la vue liste : la journée entière d'abord, puis
// par heure de début.
function sortActivitiesForList(activities = []) {
  return [...activities].sort(
    (left, right) =>
      Number(right.allDay) - Number(left.allDay) ||
      toMinutes(left.start) - toMinutes(right.start) ||
      left.title.localeCompare(right.title, "fr"),
  );
}

// Une activité posée sur une équipe détaillée reste visible : sa colonne
// « team:… » est lue comme « tous les sous-rôles de l'équipe », et inversement.
function activityMatchesColumn(activity, column) {
  if (activity.columns.includes(column.key)) return true;
  if (column.kind === "subrole") return activity.columns.includes(teamColumnKey(column.teamId));
  if (column.kind === "team") return activity.columns.some((key) => key.startsWith(`sub:${column.teamId}:`));
  return false;
}

function getColumnActivities(activities, column) {
  return activities
    .filter((activity) => activityMatchesColumn(activity, column))
    .sort((left, right) => toMinutes(left.start) - toMinutes(right.start) || left.title.localeCompare(right.title, "fr"));
}

// Activités qui se chevauchent dans une colonne : côte à côte (voies).
function layoutLanes(activities) {
  const lanes = [];
  const laneById = new Map();
  [...activities]
    .sort((left, right) => toMinutes(left.start) - toMinutes(right.start))
    .forEach((activity) => {
      let lane = lanes.findIndex((end) => end <= toMinutes(activity.start));
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(0);
      }
      lanes[lane] = toMinutes(activity.end);
      laneById.set(activity.id, lane);
    });
  return { laneById, laneCount: Math.max(1, lanes.length) };
}

// Ce que voit un bénévole ou un chef d'équipe : le Général, plus chaque
// équipe dont il fait partie ; pour une équipe détaillée, le sous-rôle qui
// porte le nom de sa fonction, sinon tous les sous-rôles de l'équipe.
function getVolunteerColumns(columns, assignedTeamNames = [], teamRoleAssignments = {}) {
  const names = assignedTeamNames.map(normalizeText);
  const selected = columns.filter((column) => column.kind === "general");
  columns
    .filter((column) => column.kind === "team" && names.includes(normalizeText(column.teamName)))
    .forEach((column) => selected.push(column));
  const splitTeams = [...new Set(columns.filter((column) => column.kind === "subrole").map((column) => column.teamName))];
  splitTeams
    .filter((teamName) => names.includes(normalizeText(teamName)))
    .forEach((teamName) => {
      const roleKey = Object.keys(teamRoleAssignments || {}).find((name) => normalizeText(name) === normalizeText(teamName));
      const memberRole = normalizeText(roleKey ? teamRoleAssignments[roleKey] : "");
      const teamColumns = columns.filter((column) => column.kind === "subrole" && column.teamName === teamName);
      const own = teamColumns.filter((column) => normalizeText(column.name) === memberRole);
      selected.push(...(own.length ? own : teamColumns));
    });
  return selected;
}

function getVolunteerTimeline(activities, columns) {
  const seen = new Set();
  const timeline = [];
  columns.forEach((column) => {
    getColumnActivities(activities, column).forEach((activity) => {
      if (seen.has(activity.id)) return;
      seen.add(activity.id);
      timeline.push({ ...activity, general: column.kind === "general" });
    });
  });
  return timeline.sort((left, right) => toMinutes(left.start) - toMinutes(right.start));
}

// Ce que voit un membre de l'organisation (Mon planning) : les activités de
// ses équipes (colonnes « org:… »), plus le Général les jours où son équipe a
// quelque chose. Même forme que getVolunteerTimeline ; `general` marque le
// Général, `teams` liste ses équipes concernées.
function getOrganisationTimeline(activities = [], orgTeams = []) {
  const keys = new Map(orgTeams.map((team) => [orgColumnKey(team.id), team.name]));
  const own = activities.filter((activity) => activity.columns.some((key) => keys.has(key)));
  if (!own.length) return [];
  const general = activities.filter((activity) => !own.includes(activity) && activity.columns.includes(GENERAL_COLUMN_KEY));
  return [
    ...own.map((activity) => ({
      ...activity,
      general: false,
      teams: activity.columns.filter((key) => keys.has(key)).map((key) => keys.get(key)),
    })),
    ...general.map((activity) => ({ ...activity, general: true, teams: [] })),
  ].sort((left, right) => Number(right.allDay) - Number(left.allDay) || toMinutes(left.start) - toMinutes(right.start));
}

// Lignes du timetable de l'édition (pré-programme compris) pour la colonne
// « Programme piste » : une entrée par horaire, les titres de section exclus.
function getTrackEntries(timetable = []) {
  return (Array.isArray(timetable) ? timetable : [])
    .filter((entry) => entry && entry.type !== "header" && toMinutes(entry.time) !== null)
    .map((entry) => ({
      time: toTimeLabel(toMinutes(entry.time)),
      label:
        entry.type === "event"
          ? [entry.gender === "WOMEN" ? "W" : entry.gender === "MEN" ? "M" : "", entry.event, entry.round].filter(Boolean).join(" ")
          : String(entry.label || ""),
    }))
    .filter((entry) => entry.label)
    .sort((left, right) => toMinutes(left.time) - toMinutes(right.time));
}

function guessCategory(title) {
  const text = normalizeText(title);
  if (/accreditation/.test(text)) return "accred";
  if (/briefing|reunion/.test(text)) return "briefing";
  if (/mise en place|installation|arrival/.test(text)) return "setup";
  if (/race|training/.test(text)) return "race";
  if (/check|test/.test(text)) return "tech";
  if (/repas|lunch|catering/.test(text)) return "meal";
  return "other";
}

// Import du dimanche de l'an dernier (fichier « Task and Organisation »,
// feuille « 3 days ») : chaque colonne retrouve l'équipe de même nom ; les
// colonnes « Entrance – … » deviennent des sous-rôles de l'équipe Accueil ;
// le reste devient des colonnes libres ; une activité posée sur presque toutes
// les colonnes passe dans « Général ».
function importLegacySunday(legacy, teams = []) {
  const programme = normalizeProgramme({});
  const keyByLegacyId = new Map();
  const accueil = teams.find((team) => /accueil/.test(normalizeText(team.roleName)));
  (legacy?.columns || []).forEach((legacyColumn, index) => {
    const name = String(legacyColumn.name || "").trim();
    const team = teams.find((candidate) => normalizeText(candidate.roleName) === normalizeText(name));
    if (team) {
      keyByLegacyId.set(legacyColumn.id, teamColumnKey(team.id));
      return;
    }
    const entrance = name.match(/^entrance\s*[–-]\s*(.+)$/i);
    if (entrance && accueil) {
      const subRole = entrance[1].trim();
      if (!programme.splitTeamIds.includes(accueil.id)) programme.splitTeamIds.push(accueil.id);
      programme.subRoleColumns[accueil.id] = cleanNames([...(programme.subRoleColumns[accueil.id] || []), subRole]);
      keyByLegacyId.set(legacyColumn.id, subRoleColumnKey(accueil.id, subRole));
      return;
    }
    const id = `legacy-${index}`;
    programme.extraColumns.push({ id, name });
    keyByLegacyId.set(legacyColumn.id, `extra:${id}`);
  });
  const legacyColumnCount = (legacy?.columns || []).length;
  programme.activities = (legacy?.activities || []).map((activity, index) => {
    const legacyColumns = activity.cols || activity.columns || [];
    const columns =
      legacyColumnCount > 4 && legacyColumns.length >= legacyColumnCount * 0.8
        ? [GENERAL_COLUMN_KEY]
        : cleanNames(legacyColumns.map((id) => keyByLegacyId.get(id)).filter(Boolean));
    return {
      id: `import-${index}`,
      title: String(activity.title || ""),
      start: activity.start,
      end: activity.end,
      category: activity.category || guessCategory(activity.title),
      place: String(activity.place || ""),
      owner: String(activity.owner || ""),
      note: String(activity.note || ""),
      columns,
    };
  });
  return normalizeProgramme(programme);
}

// Lignes de la feuille « CLIM Week Tasks » d'un jour : rattachées à
// l'équipe Étudiants LUNEX quand elle existe (c'est leur planning), sinon au
// Général ; sans heure = toute la journée.
function buildWeekActivities(weekRows = [], dayKey, orgTeams = [], findOrgTeam = () => null) {
  const lunex = findOrgTeam(orgTeams, "lunex");
  return (Array.isArray(weekRows) ? weekRows : [])
    .filter((row) => row.day === dayKey && String(row.title || "").trim())
    .map((row, index) => {
      const start = toMinutes(row.start);
      const end = toMinutes(row.end);
      const allDay = start === null;
      const startMinutes = allDay ? PROGRAMME_START : Math.max(PROGRAMME_START, Math.min(start, PROGRAMME_END - PROGRAMME_STEP));
      const endMinutes = allDay
        ? PROGRAMME_START + PROGRAMME_STEP
        : end !== null && end > startMinutes
          ? Math.min(end, PROGRAMME_END)
          : Math.min(startMinutes + 30, PROGRAMME_END);
      return {
        id: `week-${dayKey}-${index}`,
        title: String(row.title).trim(),
        start: toTimeLabel(startMinutes),
        end: toTimeLabel(endMinutes),
        category: guessCategory(row.title),
        place: "",
        owner: "",
        note: String(row.note || ""),
        people: String(row.people || ""),
        allDay,
        columns: [lunex ? orgColumnKey(lunex.id) : GENERAL_COLUMN_KEY],
      };
    });
}

// Import de l'an dernier pour un jour du planning :
//  - vendredi / samedi : la grille de la feuille « 3 days » ; chaque colonne
//    retrouve une équipe de l'organisation (Apex, TV, Officials → Juges…),
//    sinon une équipe bénévole de même nom, sinon devient une colonne libre ;
//  - dimanche : importLegacySunday ;
//  - tous les jours : les lignes de la CLIM Week de ce jour.
// Hors dimanche, les équipes bénévoles sont masquées par défaut ; seules les
// équipes de l'organisation qui ont une activité ce jour-là sont affichées.
function importLegacyDay(dayKey, legacy = {}, teams = [], orgTeams = [], findOrgTeam = () => null) {
  let programme;
  if (dayKey === "sunday") {
    programme = importLegacySunday(legacy.sunday, teams);
  } else {
    programme = normalizeProgramme({}, dayKey);
    const grid = legacy[dayKey];
    const keyByLegacyId = new Map();
    (grid?.columns || []).forEach((legacyColumn, index) => {
      const name = String(legacyColumn.name || "").trim();
      const orgTeam = findOrgTeam(orgTeams, name);
      if (orgTeam) return keyByLegacyId.set(legacyColumn.id, orgColumnKey(orgTeam.id));
      const team = teams.find((candidate) => normalizeText(candidate.roleName) === normalizeText(name));
      if (team) return keyByLegacyId.set(legacyColumn.id, teamColumnKey(team.id));
      const id = `legacy-${dayKey}-${index}`;
      programme.extraColumns.push({ id, name });
      return keyByLegacyId.set(legacyColumn.id, `extra:${id}`);
    });
    programme.activities = (grid?.activities || []).map((activity, index) => ({
      id: `import-${dayKey}-${index}`,
      title: String(activity.title || ""),
      start: activity.start,
      end: activity.end,
      category: activity.category || guessCategory(activity.title),
      place: "",
      owner: "",
      note: "",
      people: "",
      allDay: false,
      columns: cleanNames((activity.cols || []).map((id) => keyByLegacyId.get(id)).filter(Boolean)),
    }));
    programme.hiddenTeamIds = teams.map((team) => team.id);
  }
  programme.activities = [...programme.activities, ...buildWeekActivities(legacy.week, dayKey, orgTeams, findOrgTeam)];
  const usedOrgIds = new Set(
    programme.activities.flatMap((activity) => activity.columns.filter((key) => key.startsWith("org:")).map((key) => key.slice(4))),
  );
  programme.visibleOrgTeamIds = orgTeams.filter((team) => usedOrgIds.has(team.id)).map((team) => team.id);
  return normalizeProgramme(programme, dayKey);
}

export {
  COQUE_PLACES,
  PLANNING_DAYS,
  buildWeekActivities,
  getPlanningDay,
  getPlanningDayDate,
  importLegacyDay,
  orgColumnKey,
  sortActivitiesForList,
  GENERAL_COLUMN_KEY,
  PROGRAMME_CATEGORIES,
  PROGRAMME_END,
  PROGRAMME_START,
  PROGRAMME_STEP,
  activityMatchesColumn,
  buildProgrammeColumns,
  getCategory,
  getColumnActivities,
  getProgrammeTimeOptions,
  getTeamSubRoleNames,
  getTrackEntries,
  getVolunteerColumns,
  getVolunteerTimeline,
  getOrganisationTimeline,
  guessCategory,
  importLegacySunday,
  layoutLanes,
  normalizeProgramme,
  subRoleColumnKey,
  teamColumnKey,
  toMinutes,
  toTimeLabel,
};
