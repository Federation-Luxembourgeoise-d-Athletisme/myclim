// Rétroplanning (Pilotage › Rétroplanning) : les tâches et échéances de
// l'organisation du meeting, reprises de la feuille « Tasks » du fichier
// « Task and Organisation ». Décisions de Margot (09/11/2026) :
//  - champs du fichier (échéance, J-x calculé depuis la date du meeting,
//    périmètre, action) + responsable + statut (à faire / en cours / fait),
//    tâches en retard mises en évidence, pas de rappel par e-mail ;
//  - admins et gestionnaires voient et modifient tout ; un membre d'une
//    équipe de l'organisation voit les tâches de son périmètre et peut en
//    changer le statut.
//
// Collection Firestore : meetingTasks/{id}
//   { editionYear, deadline: "AAAA-MM-JJ", perimeter: [orgTeamId], action,
//     ownerName, status, perimeterEmails: [e-mail], perimeterNames: [nom],
//     createdAt, updatedAt }
// Règles pures, testées dans tests/retroplanning.test.js.

const TASK_STATUSES = [
  { value: "todo", label: "À faire" },
  { value: "doing", label: "En cours" },
  { value: "done", label: "Fait" },
];

const MONTH_LABELS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const date = parseYmd(ymd);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return toYmd(date);
}

// Nombre de jours entre l'échéance et le meeting : négatif avant (J-30),
// 0 le jour J, positif après (J+3).
function daysFromMeeting(deadline, meetingDate) {
  const a = parseYmd(deadline);
  const b = parseYmd(meetingDate);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}

function formatDMinus(days) {
  if (days === null || days === undefined) return "";
  if (days === 0) return "Jour J";
  return days < 0 ? `J-${-days}` : `J+${days}`;
}

function normalizeTask(task = {}) {
  return {
    id: String(task.id || ""),
    editionYear: Number(task.editionYear) || null,
    deadline: parseYmd(task.deadline) ? String(task.deadline).slice(0, 10) : "",
    perimeter: [...new Set((Array.isArray(task.perimeter) ? task.perimeter : []).map(String).filter(Boolean))],
    action: String(task.action || "").trim(),
    ownerName: String(task.ownerName || "").trim(),
    status: TASK_STATUSES.some((status) => status.value === task.status) ? task.status : "todo",
    perimeterEmails: Array.isArray(task.perimeterEmails) ? task.perimeterEmails : [],
    perimeterNames: Array.isArray(task.perimeterNames) ? task.perimeterNames.map(String) : [],
  };
}

function isTaskLate(task, today) {
  return Boolean(task.deadline) && task.status !== "done" && task.deadline < today;
}

function compareTasks(left, right) {
  return (left.deadline || "9999").localeCompare(right.deadline || "9999") || left.action.localeCompare(right.action, "fr");
}

// Groupes par mois d'échéance (« Novembre 2026 »), dans l'ordre ; les tâches
// sans date à la fin.
function groupTasksByMonth(tasks = []) {
  const groups = new Map();
  [...tasks].sort(compareTasks).forEach((task) => {
    const date = parseYmd(task.deadline);
    const key = date ? task.deadline.slice(0, 7) : "none";
    const label = date ? `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : "Sans échéance";
    if (!groups.has(key)) groups.set(key, { key, label, tasks: [] });
    groups.get(key).tasks.push(task);
  });
  return [...groups.values()];
}

function summarizeTasks(tasks = [], today) {
  return {
    total: tasks.length,
    todo: tasks.filter((task) => task.status === "todo").length,
    doing: tasks.filter((task) => task.status === "doing").length,
    done: tasks.filter((task) => task.status === "done").length,
    late: tasks.filter((task) => isTaskLate(task, today)).length,
  };
}

// Import de la feuille « Tasks » : l'échéance est recalculée à partir du J-x
// et de la date du meeting de l'édition (les dates du fichier contenaient des
// erreurs d'année) ; les périmètres retrouvent les équipes de l'organisation.
function importLegacyTasks(legacyTasks = [], { meetingDate, editionYear, orgTeams = [], findOrgTeam = () => null }) {
  if (!parseYmd(meetingDate)) return [];
  return legacyTasks
    .filter((task) => Number.isFinite(task.offsetDays) && String(task.action || "").trim())
    .map((task) => ({
      editionYear,
      deadline: addDaysYmd(meetingDate, task.offsetDays),
      perimeter: [
        ...new Set((task.perimeter || []).map((name) => findOrgTeam(orgTeams, name)?.id).filter(Boolean)),
      ],
      action: String(task.action).trim(),
      ownerName: "",
      status: "todo",
    }));
}

export {
  TASK_STATUSES,
  addDaysYmd,
  compareTasks,
  daysFromMeeting,
  formatDMinus,
  groupTasksByMonth,
  importLegacyTasks,
  isTaskLate,
  normalizeTask,
  parseYmd,
  summarizeTasks,
  toYmd,
};
