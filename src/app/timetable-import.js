// Turns a timetable pasted from Excel / Word (one row per line: time, gender,
// event and round separated by tabs) into timetable entries.
//   "16:10	Women	60m Heat 1"            → event 60m, WOMEN, round "Heat 1"
//   "16:05		Presentation Long Jump"     → info row (ceremony, video, show…)
//   "PRE-PROGRAM" / "MAIN-PROGRAM"           → section header
// Rows with a time but nothing else are skipped.

const DISCIPLINE_ALIASES = [
  [/^60\s*m\s*h(urdles)?$/i, "60m Hurdles"],
  [/^60\s*m$/i, "60m"],
  [/^200\s*m$/i, "200m"],
  [/^400\s*m$/i, "400m"],
  [/^800\s*m$/i, "800m"],
  [/^1500\s*m$/i, "1500m"],
  [/^(1\s*)?mile$/i, "Mile"],
  [/^3000\s*m$/i, "3000m"],
  [/^5000\s*m$/i, "5000m"],
  [/^high\s*jump$/i, "High Jump"],
  [/^pole\s*vault$/i, "Pole Vault"],
  [/^long\s*jump$/i, "Long Jump"],
  [/^triple\s*jump$/i, "Triple Jump"],
  [/^shot\s*put$/i, "Shot Put"],
  [/^weight\s*throw$/i, "Weight Throw"],
];

const FIELD_EVENTS = new Set(["High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Shot Put", "Weight Throw"]);

const HEADER_LABELS = new Set(["PRE-PROGRAM", "MAIN-PROGRAM"]);

const ROUND_RE = /\s+((?:heats?|final|semi-final|series)(?:\s+[a-z0-9]+)?)$/i;

function normalizeTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})[:h.](\d{2})$/i);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function normalizeGender(value) {
  const token = String(value || "").trim().toLowerCase();
  if (["women", "woman", "w", "f", "femmes", "dames"].includes(token)) return "WOMEN";
  if (["men", "man", "m", "h", "hommes", "messieurs"].includes(token)) return "MEN";
  return "";
}

function matchDiscipline(value) {
  const entry = DISCIPLINE_ALIASES.find(([pattern]) => pattern.test(value.trim()));
  return entry ? entry[1] : "";
}

function capitalizeRound(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function newId(index) {
  return `${Date.now().toString(36)}${index.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function parseTimetablePaste(text) {
  const entries = [];
  const skipped = [];

  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (HEADER_LABELS.has(line.toUpperCase())) {
      entries.push({ id: newId(entries.length), type: "header", label: line.toUpperCase() });
      return;
    }

    const cells = rawLine.includes("\t") ? rawLine.split("\t") : rawLine.split(/\s{2,}/);
    const time = normalizeTime(cells[0]);
    if (!time) {
      skipped.push(line);
      return;
    }

    let gender = "";
    let rest = cells.slice(1).map((cell) => cell.trim()).filter(Boolean);
    if (rest.length > 1 && normalizeGender(rest[0])) {
      gender = normalizeGender(rest[0]);
      rest = rest.slice(1);
    }
    const label = rest.join(" ").trim();
    if (!label) return;

    const roundMatch = label.match(ROUND_RE);
    const eventPart = roundMatch ? label.slice(0, roundMatch.index) : label;
    const discipline = matchDiscipline(eventPart);

    if (discipline) {
      entries.push({
        id: newId(entries.length),
        type: "event",
        time,
        gender,
        event: discipline,
        round: roundMatch ? capitalizeRound(roundMatch[1]) : "",
        isField: FIELD_EVENTS.has(discipline),
      });
    } else {
      entries.push({ id: newId(entries.length), type: "info", time, label });
    }
  });

  return { entries, skipped };
}

// "Version of 2 November 2026 — times are indicative and subject to change."
export function defaultTimetableNote(date = new Date()) {
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Luxembourg" });
  return `Version of ${day} — times are indicative and subject to change.`;
}
