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
// Document Firestore : meetingDayProgrammes/{année}-sunday
//   { splitTeamIds, subRoleColumns: { [teamId]: [noms] }, extraColumns: [{ id, name }], activities }

const PROGRAMME_START = 8 * 60;
const PROGRAMME_END = 20 * 60;
const PROGRAMME_STEP = 15;
const GENERAL_COLUMN_KEY = "general";

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

function normalizeProgramme(data = {}) {
  const subRoleColumns = {};
  Object.entries(data?.subRoleColumns && typeof data.subRoleColumns === "object" ? data.subRoleColumns : {}).forEach(
    ([teamId, names]) => {
      subRoleColumns[teamId] = cleanNames(names);
    },
  );
  return {
    splitTeamIds: cleanNames(data?.splitTeamIds),
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
        columns: cleanNames(activity.columns),
      })),
  };
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

// Colonnes affichées : Général, puis chaque équipe (ou ses sous-rôles quand
// elle est détaillée), puis les colonnes libres.
function buildProgrammeColumns(teams = [], programme = normalizeProgramme()) {
  const columns = [{ key: GENERAL_COLUMN_KEY, kind: "general", name: "Général · tout le monde" }];
  teams.forEach((team) => {
    const subRoles = getTeamSubRoleNames(team, programme);
    if (programme.splitTeamIds.includes(team.id) && subRoles.length) {
      subRoles.forEach((subRole) =>
        columns.push({ key: subRoleColumnKey(team.id, subRole), kind: "subrole", name: subRole, teamId: team.id, teamName: team.roleName }),
      );
    } else {
      columns.push({ key: teamColumnKey(team.id), kind: "team", name: team.roleName, teamId: team.id, teamName: team.roleName });
    }
  });
  programme.extraColumns.forEach((column) => columns.push({ key: `extra:${column.id}`, kind: "extra", name: column.name, extraId: column.id }));
  return columns;
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

export {
  COQUE_PLACES,
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
  guessCategory,
  importLegacySunday,
  layoutLanes,
  normalizeProgramme,
  subRoleColumnKey,
  teamColumnKey,
  toMinutes,
  toTimeLabel,
};
