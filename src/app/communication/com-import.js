// Import du plan de communication Excel (« Communication Plan 2026-27.xlsx »)
// dans le module : calendrier → publications, week-end du meeting → publications,
// jalons → tâches. Logique pure (lignes déjà lues par xlsx), testée dans
// tests/communication-import.test.js.
import { addDays, parseYmd, ymd } from "./com-dates.js";

export const IMPORT_SHEETS = {
  calendar: "UPDATED CALENDAR 27",
  weekend: "Content Calendar Fri-Sun",
  milestones: "Milestones",
};

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // La salle s'appelle « Coque » depuis son changement de nom.
    .replace(/d[’']\s?Coque/g, "Coque");

// Mois d'une cellule « MONTH » : « October », « Oct-Nov », « Dec-Jan », « >Jan ».
function monthOf(label) {
  const first = clean(label).toLowerCase().replace(/^>/, "").split(/[-\s]/)[0];
  if (!first) return null;
  const match = Object.keys(MONTHS).find((name) => name.startsWith(first.slice(0, 3)));
  return match === undefined ? null : MONTHS[match];
}

const weekdayOf = (label) => {
  const key = clean(label).toLowerCase().slice(0, 3);
  return key in WEEKDAYS ? WEEKDAYS[key] : null;
};

// Les mois d'automne appartiennent à l'année précédant le meeting (janvier).
const yearFor = (month, eventYear) => (month >= 6 ? eventYear - 1 : eventYear);
const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7));

// Premier jour >= from dont le quantième vaut day.
function nextDayNumber(from, day) {
  for (let i = 0; i < 40; i += 1) {
    const candidate = addDays(from, i);
    if (candidate.getDate() === day) return candidate;
  }
  return null;
}

// Type de publication déduit de la colonne « FORMAT ».
export function typeFromFormat(format) {
  const value = clean(format).toLowerCase();
  if (/reel|video|vidéo|live|footage/.test(value)) return "video";
  if (/post|carrousel|carousel|photo|image|visual/.test(value)) return "post";
  if (/story/.test(value)) return "story";
  return "post";
}

const statusFrom = (value) => (/posted|published|done|publié/i.test(clean(value)) ? "done" : "todo");

const noteLines = (...lines) => lines.filter(Boolean).join("\n");

/* ---------- Onglet « UPDATED CALENDAR 27 » ---------- */

// Colonnes : MONTH | WEEK | DAY | CONTENT PILLAR | THEME | FORMAT | STATUS.
// Les semaines sont des plages (« 19-25th », « 30th-4th ») ou un jour (« 21th », « 5 »).
// Une ligne sans jour hérite de la semaine en cours et tombe le lundi ;
// si le jour et le nom du jour ne concordent pas, le nom du jour l'emporte.
export function parseCalendarSheet(rows, { eventDate }) {
  const eventYear = parseYmd(eventDate).getFullYear();
  const items = [];
  let month = null;
  let weekStart = null;

  rows.slice(1).forEach((row, index) => {
    const [monthCell, weekCell, dayCell, pillar, themeCell, format, status] = row.map(clean);
    const rowNumber = index + 2;
    const newMonth = monthOf(monthCell);
    if (newMonth !== null) month = newMonth;
    if (month === null) return;

    let explicitDay = null;
    const range = weekCell.match(/^(\d{1,2})\D*-\s*(\d{1,2})/);
    if (range) {
      // « December | 30th-4th » : la semaine commence le 30 du mois précédent.
      const crossesBack = Number(range[1]) > Number(range[2]) && newMonth !== null && !monthCell.includes("-");
      const startMonth = crossesBack ? month - 1 : month;
      weekStart = mondayOf(new Date(yearFor(startMonth, eventYear), startMonth, Number(range[1])));
    } else if (/^\d{1,2}/.test(weekCell)) {
      explicitDay = Number(weekCell.match(/^\d{1,2}/)[0]);
    }

    const title = themeCell || pillar.charAt(0).toUpperCase() + pillar.slice(1);
    if (!title) return;

    const weekday = weekdayOf(dayCell);
    let date = null;
    let adjusted = false;
    let undated = false;

    if (explicitDay !== null) {
      const from = weekStart || new Date(yearFor(month, eventYear), month, 1);
      date = nextDayNumber(from, explicitDay) || new Date(yearFor(month, eventYear), month, explicitDay);
      if (weekday !== null && date.getDay() !== weekday) {
        date = addDays(mondayOf(date), (weekday + 6) % 7);
        adjusted = true;
      }
      weekStart = mondayOf(date);
    } else if (weekStart) {
      if (weekday !== null) date = addDays(weekStart, (weekday + 6) % 7);
      else {
        date = weekStart;
        undated = true;
      }
    }
    if (!date) return;

    const original = [weekCell, dayCell].filter(Boolean).join(" ");
    items.push({
      importId: `xlsx-cal27-r${rowNumber}`,
      titre: title,
      date: ymd(date),
      heure: null,
      type: typeFromFormat(format),
      statut: statusFrom(status),
      notes: noteLines(
        pillar && themeCell ? `Pillar: ${pillar}` : "",
        format ? `Format: ${format}` : "",
        undated ? `Date to be confirmed (Excel: week ${weekCell || "?"})` : "",
        adjusted ? `Date adjusted to the weekday (Excel said: ${original})` : "",
      ),
      undated,
      adjusted,
    });
  });
  return items;
}

/* ---------- Onglet « Content Calendar Fri-Sun » ---------- */

// Colonnes : DAY | THEME | FORMAT | WHO | Idea … (dernière colonne : remarque).
// Les jours (« 16 », « 17 ») sont ceux de l'édition précédente : on les recale
// sur le meeting (veille, avant-veille). Section « EVENT DAY » : jour J,
// sauf « AFTER » (lendemain).
export function parseWeekendSheet(rows, { eventDate }) {
  const body = rows.slice(1);
  const numbers = body.map((row) => Number(clean(row[0]))).filter((n) => Number.isInteger(n) && n > 0);
  const fileEventDay = numbers.length ? Math.max(...numbers) + 1 : null;
  const event = parseYmd(eventDate);
  const items = [];
  let phase = null;
  let inEventDay = false;

  body.forEach((row, index) => {
    const cells = row.map(clean);
    const [dayCell, theme, format] = cells;
    const idea = cells[4];
    const remark = cells.slice(5).filter(Boolean).join(" · ");
    if (/^event day$/i.test(theme) && !dayCell) {
      inEventDay = true;
      return;
    }
    if (!theme) return;

    let date;
    if (!inEventDay && /^\d+$/.test(dayCell) && fileEventDay) {
      date = addDays(event, Number(dayCell) - fileEventDay);
    } else {
      if (dayCell) phase = dayCell;
      date = /^after$/i.test(phase || "") ? addDays(event, 1) : event;
    }

    const time = theme.match(/^(\d{1,2})[:h](\d{2})\s*/);
    items.push({
      importId: `xlsx-weekend-r${index + 2}`,
      titre: time ? theme.slice(time[0].length) : theme,
      date: ymd(date),
      heure: time ? `${time[1].padStart(2, "0")}:${time[2]}` : null,
      type: typeFromFormat(format),
      statut: "todo",
      notes: noteLines(
        inEventDay && phase ? `Event day: ${phase.toLowerCase()}` : "",
        format ? `Format: ${format}` : "",
        idea ? `Idea: ${idea}` : "",
        remark,
      ),
      undated: false,
      adjusted: false,
    });
  });
  return items;
}

/* ---------- Onglet « Milestones » ---------- */

// Colonnes : MONTH | PHASE | TASKS | STATUS. Les cases cochées concernaient
// l'édition précédente : tout est importé « à faire ». Échéance : fin du mois,
// ou calée sur le meeting pour les phases de janvier.
export function parseMilestonesSheet(rows, { eventDate }) {
  const event = parseYmd(eventDate);
  const eventYear = event.getFullYear();
  const items = [];
  let month = null;
  let phase = "";
  let dayOverride = null;

  const dueFor = () => {
    const p = phase.toLowerCase();
    if (/countdown/.test(p)) return addDays(event, -10);
    if (/final stretch/.test(p)) return addDays(event, -1);
    if (/event day/.test(p)) return event;
    if (/post-event|wrap/.test(p)) return addDays(event, 14);
    if (dayOverride) return new Date(yearFor(month, eventYear), month, dayOverride);
    return new Date(yearFor(month, eventYear), month + 1, 0);
  };

  rows.slice(1).forEach((row, index) => {
    const [monthCell, phaseCell, task] = row.map(clean);
    const newMonth = monthOf(monthCell);
    if (newMonth !== null) {
      month = newMonth;
      dayOverride = null;
    } else if (/^\d{1,2}/.test(monthCell)) {
      dayOverride = Number(monthCell.match(/^\d{1,2}/)[0]);
    }
    if (phaseCell) {
      phase = phaseCell;
      dayOverride = /^\d/.test(monthCell) ? dayOverride : null;
    }
    if (!task || month === null) return;
    items.push({
      importId: `xlsx-milestones-r${index + 2}`,
      titre: task.replace(/\.$/, ""),
      echeance: ymd(dueFor()),
      statut: "todo",
      notes: phase ? `Phase: ${phase}` : "",
    });
  });
  return items;
}

const sameItem = (a, b) => a.date === b.date && a.titre.toLowerCase() === b.titre.toLowerCase();

// Classeur entier → ce qui sera créé. sheets : { nom d'onglet: lignes }.
export function parseCommunicationPlan(sheets, { eventDate }) {
  const calendar = sheets[IMPORT_SHEETS.calendar] ? parseCalendarSheet(sheets[IMPORT_SHEETS.calendar], { eventDate }) : [];
  const weekend = sheets[IMPORT_SHEETS.weekend] ? parseWeekendSheet(sheets[IMPORT_SHEETS.weekend], { eventDate }) : [];
  const tasks = sheets[IMPORT_SHEETS.milestones] ? parseMilestonesSheet(sheets[IMPORT_SHEETS.milestones], { eventDate }) : [];
  // Une même idée présente dans les deux calendriers n'est créée qu'une fois.
  const publications = [...calendar, ...weekend.filter((item) => !calendar.some((other) => sameItem(item, other)))];
  publications.sort((a, b) => a.date.localeCompare(b.date) || (a.heure || "").localeCompare(b.heure || ""));
  return { publications, tasks, missingSheets: Object.values(IMPORT_SHEETS).filter((name) => !sheets[name]) };
}
