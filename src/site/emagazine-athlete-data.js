// Data of a Luxembourg athlete page, gathered in the admin and saved with the
// page: indoor bests from World Athletics (/api/wa, netlify/functions/wa-athlete.mjs)
// and the athlete's own history at the meeting (meetingResults).

const RECORD_PRIORITY = ["WR", "ER", "AR", "NR", "MR"];

export function waEventLabel(discipline) {
  return String(discipline || "")
    .replace(/\s+Metres\s+Hurdles/i, "m hurdles")
    .replace(/\s+Metres/i, "m")
    .replace(/\s+Miles?/i, " mile")
    .trim();
}

function mainRecord(records) {
  const list = Array.isArray(records) ? records.map((value) => String(value).toUpperCase()) : [];
  return RECORD_PRIORITY.find((code) => list.includes(code)) || "";
}

function bestOf(results) {
  return results.slice().sort((a, b) => (b.resultScore ?? 0) - (a.resultScore ?? 0))[0] || null;
}

// One entry per indoor discipline (relays left out): events run this season
// first, then the best ones. The first two are shown on the page.
export function buildAthleteEventsFromWa(data) {
  const pbs = (Array.isArray(data?.personalBests) ? data.personalBests : [])
    .filter((result) => result.indoor && result.mark && result.disciplineCode && !/X/i.test(result.disciplineCode));
  const results = (Array.isArray(data?.seasonBests) ? data.seasonBests : [])
    .filter((result) => result.indoor && result.mark && result.notLegal !== true);

  const codes = [...new Set(pbs.map((result) => result.disciplineCode))];
  return codes
    .map((code) => {
      const pb = bestOf(pbs.filter((result) => result.disciplineCode === code));
      // Season best of the latest indoor season with a result in this event.
      const own = results.filter((result) => result.disciplineCode === code && result.date);
      const sbYear = own.reduce((latest, result) => Math.max(latest, Number(result.date.slice(0, 4))), 0);
      const sb = sbYear ? bestOf(own.filter((result) => result.date.startsWith(String(sbYear)))) : null;
      return {
        id: `wa-${code}`,
        disciplineCode: code,
        event: waEventLabel(pb.discipline),
        pb: pb.mark,
        pbYear: pb.date ? pb.date.slice(0, 4) : "",
        record: mainRecord(pb.records),
        sb: sb?.mark || "",
        sbYear: sb ? String(sbYear) : "",
        score: pb.resultScore ?? 0,
      };
    })
    .sort((a, b) => Number(b.sbYear || 0) - Number(a.sbYear || 0) || b.score - a.score)
    .map((entry, index) => {
      const { score, ...rest } = entry;
      return { ...rest, shown: index < 2 && score >= 0 };
    });
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
}

export function sameAthlete(row, athlete) {
  return normalizeName(row?.lastName) === normalizeName(athlete?.lastName)
    && normalizeName(row?.firstName) === normalizeName(athlete?.firstName);
}

const FIELD_EVENT_RE = /jump|vault|put|throw|weight|LJ|HJ|TJ|PV|SP/i;

function markValue(result) {
  const parts = String(result || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function isFinalRound(round) {
  return !round || /^final$/i.test(String(round).trim());
}

// The athlete at the meeting: editions, wins (rank 1 in a final) and best
// mark in each event, the most contested event first.
export function buildMeetingStats(rows) {
  const valid = rows.filter((row) => row.year && String(row.status || "OK").toUpperCase() === "OK");
  const years = [...new Set(rows.map((row) => Number(row.year)).filter(Boolean))].sort((a, b) => a - b);
  if (!years.length) return null;
  const wins = valid.filter((row) => Number(row.rank) === 1 && isFinalRound(row.round)).length;

  const byEvent = new Map();
  valid.forEach((row) => {
    const value = markValue(row.result);
    if (value == null || !row.discipline) return;
    const higherIsBetter = FIELD_EVENT_RE.test(row.discipline);
    const entry = byEvent.get(row.discipline) || { event: row.discipline, years: new Set(), best: null };
    entry.years.add(Number(row.year));
    if (!entry.best || (higherIsBetter ? value > entry.best.value : value < entry.best.value)) {
      entry.best = { value, mark: String(row.result).trim(), year: Number(row.year) };
    }
    byEvent.set(row.discipline, entry);
  });

  const bests = [...byEvent.values()]
    .sort((a, b) => b.years.size - a.years.size)
    .map((entry) => ({ event: entry.event, mark: entry.best.mark, year: entry.best.year }));

  return { editions: years.length, firstYear: years[0], wins, bests };
}

export async function searchWaAthletes(name) {
  const response = await fetch(`/api/wa/search?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return Array.isArray(data.athletes) ? data.athletes : [];
}

export async function fetchAthleteEventsFromWa(waid) {
  const response = await fetch(`/api/wa/athlete/${encodeURIComponent(waid)}/performances`, {
    signal: AbortSignal.timeout(40_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return buildAthleteEventsFromWa(data);
}
