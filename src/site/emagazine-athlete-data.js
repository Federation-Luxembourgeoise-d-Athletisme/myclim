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

// World Athletics discipline code of an event typed in the admin: "60m hurdles" → "60H".
export function waCodeForEvent(event) {
  const value = String(event || "").toLowerCase().replace(/\s+/g, "");
  const field = { longjump: "LJ", highjump: "HJ", triplejump: "TJ", polevault: "PV", shotput: "SP" };
  const fieldCode = Object.entries(field).find(([name]) => value.includes(name));
  if (fieldCode) return fieldCode[1];
  const match = value.match(/^(\d+)m?(hurdles|h)?/);
  return match ? `${match[1]}${match[2] ? "H" : ""}` : "";
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

// Framing of an athlete photo, set in the admin: zoom in % and the point of
// the photo kept in view (x, y in %, from the left and the top).
export const DEFAULT_PHOTO_FRAME = { zoom: 100, x: 50, y: 0, minZoom: 100 };
// Cut-out portrait of the Luxembourg athlete page: x and y move it around.
// It can be made smaller than the page, and moved by up to 200 px sideways
// and 500 px up or down (CUTOUT_SHIFT px per step of x and y).
export const DEFAULT_CUTOUT_FRAME = { zoom: 100, x: 50, y: 50, minZoom: 40 };
export const CUTOUT_SHIFT = { x: 4, y: 10 };

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizePhotoFrame(raw, defaults = DEFAULT_PHOTO_FRAME) {
  return {
    zoom: clamp(raw?.zoom, defaults.minZoom ?? 100, 300, defaults.zoom),
    x: clamp(raw?.x, 0, 100, defaults.x),
    y: clamp(raw?.y, 0, 100, defaults.y),
  };
}

// Photo filling its column (object-fit: cover), zoomed on the chosen point.
export function photoFrameStyle(frame) {
  const { zoom, x, y } = normalizePhotoFrame(frame);
  return {
    objectPosition: `${x}% ${y}%`,
    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
    transformOrigin: `${x}% ${y}%`,
  };
}

// Cut-out portrait standing at the bottom of the page: 50/50 leaves it in place.
export function cutoutFrameStyle(frame) {
  const { zoom, x, y } = normalizePhotoFrame(frame, DEFAULT_CUTOUT_FRAME);
  if (zoom === 100 && x === 50 && y === 50) return undefined;
  return {
    transform: `translate(${(x - 50) * CUTOUT_SHIFT.x}px, ${(y - 50) * CUTOUT_SHIFT.y}px) scale(${zoom / 100})`,
    transformOrigin: "50% 100%",
  };
}
