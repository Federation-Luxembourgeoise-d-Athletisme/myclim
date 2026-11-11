import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { canAccessStatistics, getActiveRoles } from "./navigation";
import { normalizeEditionId, useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import {
  ALL_ATHLETE_FIELDS,
  ATHLETES_COLLECTION,
  ATHLETE_REGISTRY_COLLECTION,
  DEFAULT_PORTAL_SETTINGS,
  FIELD_GROUPS,
  athleteMergeKey,
  rebuildAthleteRegistryFromHistoricalResults,
  splitHistoricalHomonyms,
  canImportAthletes,
  extractWaid,
  fetchAthleteFromWaService,
  getVisibleFields,
  normalizeBirthYear,
  parsePb,
  resolveAthleteBirthYear,
  buildAthleteIdentityKeys,
  upsertAthleteRegistry,
  useAthletePortalSettings,
  useAthleteRegistry,
  useAthletes,
  ATHLETE_PORTAL_SETTINGS_PATH,
  recordAthleteImport,
  useAthleteImportHistory,
  ATHLETE_ACCOMPANYING_COLLECTION,
  useAccompanyingPersons,
  formatTravelDay,
} from "./athlete-portal-hooks";
import { db } from "../services/firebase";
import { findDuplicateCandidatePairs, getRegistryEntryStats, getRegistrySuspectReasons } from "./athlete-registry-analysis";
import {
  AthleteRegistryAnalysisPanel,
  AthleteRegistryCleanupPanel,
  AthleteRegistryFilters,
  AthleteRegistryTable,
} from "./athlete-registry-tools";
import { useRegistryFilters } from "./athlete-registry-filters";
import { searchWaAthletes } from "../site/emagazine-athlete-data";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Staff roles are stored in French (see _STAFF_ROLE_PATTERNS); shown translated.
const STAFF_ROLE_EN = {
  "Médical": "Medical",
  "Accompagnateur": "Companion",
  "Famille / invité": "Family / guest",
  "Autre": "Other",
};

function staffRoleLabel(role, tr) {
  return tr(role, STAFF_ROLE_EN[role] || role);
}

function fieldLabel(field, tr) {
  return tr(field.label, field.labelEn || field.label);
}

const PLATFORM_ROLES = [
  { key: "admin",                      label: "Administrateur" },
  { key: "meeting_director",           label: "Meeting director" },
  { key: "gestionnaire",               label: "Gestionnaire" },
  { key: "chef_equipe",                label: "Chef d'équipe" },
  { key: "benevole",                   label: "Bénévole" },
  { key: "parent_u14",                 label: "Parent U14" },
  { key: "chef_transport_athletes",    label: "Chef du Transport Athlètes" },
  { key: "benevole_transport_athletes", label: "Bénévole Transport Athlètes" },
];

// ─── Travel entry parser ──────────────────────────────────────────────────────
// Parses strings like "17. flight 21:45 with LG8254 from Nice"
//                  or "19. flight 06:00 with LG3759 to Lisbon"
// into structured fields: day, time, flightNo, dir ("from"|"to"), city.

// Flexible travel regex — time and flight number are optional so entries with
// no flight (e.g. "18. train", ground transport with no fixed number) still
// parse instead of falling back to raw, unformatted text:
//   "17. flight 21:45 with LG3752 from Lisbon"
//   "16. flight 22:20 with KL 1715 from AMS"   ← space in flight no.
//   "17. flight 10:15 LH9528 from Frankfurt"    ← no "with"
//   "17. flight 17:50 with KL1713"              ← no city
//   "19. flight 15.30 with FR5055 to Madrid"    ← "." as time separator
//   "18. train"                                 ← no time, no flight number
const _TRAVEL_RE = /^(\d+)\.\s+(\S+)(?:\s+(\d{1,2})[:.](\d{2}))?(?:\s+(?:with\s+)?([A-Z]{1,3}\s*\d+[A-Z0-9]*))?(?:\s+(from|to)\s+(.+))?$/i;

function parseTravelEntry(text) {
  if (!text) return null;
  const m = _TRAVEL_RE.exec(String(text).trim());
  if (!m) return null;
  return {
    day:      parseInt(m[1], 10),
    mode:     m[2].toLowerCase(),
    time:     m[3] ? `${m[3]}:${m[4]}` : null,
    flightNo: m[5] ? m[5].replace(/\s+/g, "").toUpperCase() : null, // "KL 1715" → "KL1715"
    dir:      (m[6] || "").toLowerCase(),              // "from" | "to" | ""
    city:     (m[7] || "").trim(),
  };
}

/** Expand a raw arrival or departure string into structured sub-fields. */
function expandTravelField(raw, prefix) {
  // prefix = "arrival" | "departure"
  const p = parseTravelEntry(raw);
  if (!p) return {};
  const cityKey = prefix === "arrival" ? `${prefix}From` : `${prefix}To`;
  return {
    [`${prefix}Day`]:    p.day,
    [`${prefix}Time`]:   p.time,
    [`${prefix}Flight`]: p.flightNo,
    [cityKey]:           p.city,
  };
}

// Short day label for dense tables: "dim. 17" (falls back to "J17").
function formatTravelDayShort(day, referenceDate, language = "fr") {
  const ref = referenceDate?.toDate ? referenceDate.toDate() : referenceDate ? new Date(referenceDate) : null;
  if (!ref || Number.isNaN(ref.getTime())) return `${language === "fr" ? "J" : "D"}${day}`;
  const resolved = new Date(ref.getFullYear(), ref.getMonth(), day);
  return `${resolved.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "short" })} ${day}`;
}

function TravelCell({ raw, prefix, referenceDate, compact = false }) {
  const { language } = useLanguage();
  if (!raw) return <span style={{ color: "#bbb" }}>—</span>;
  const p = parseTravelEntry(raw);
  if (!p) return <span style={{ fontSize: "0.82rem", color: "#555" }}>{raw}</span>;
  const arrow = prefix === "arrival" ? "← " : "→ ";
  const icon = /train/i.test(p.mode) ? "🚆" : /(bus|car|voiture|pkw)/i.test(p.mode) ? "🚗" : "✈";
  if (compact) {
    return (
      <span className="ath-travel" title={raw}>
        <strong>{formatTravelDayShort(p.day, referenceDate, language)}{p.time ? ` ${p.time}` : ""}</strong>
        {p.flightNo ? <span className="ath-travel__flight"> {p.flightNo}</span> : null}
        {p.city ? <span className="ath-travel__city"> {arrow}{p.city}</span> : null}
      </span>
    );
  }
  return (
    <div style={{ lineHeight: 1.65, fontSize: "0.82rem" }}>
      <div style={{ fontWeight: 600 }}>
        {formatTravelDay(p.day, referenceDate, language)}{p.time ? ` · ${p.time}` : ""}
      </div>
      {(p.flightNo || p.city) ? (
        <div style={{ color: "#555" }}>
          {icon}{p.flightNo ? ` ${p.flightNo}` : ""}{p.city ? ` ${arrow}${p.city}` : ""}
        </div>
      ) : (
        <div style={{ color: "#555" }}>{icon}</div>
      )}
    </div>
  );
}

async function ensureCurrentAthleteRegistryLink(athleteId, athleteFields) {
  const result = await upsertAthleteRegistry({
    lastName: athleteFields.lastName,
    firstName: athleteFields.firstName,
    nationality: athleteFields.nationality,
    birthYear: athleteFields.birthYear,
    birthDate: athleteFields.birthDate,
    waid: athleteFields.waid,
    waUrl: athleteFields.waUrl,
    gender: athleteFields.gender,
  });

  if (result?.docId) {
    await updateDoc(doc(db, ATHLETES_COLLECTION, athleteId), {
      registryAthleteId: result.docId,
    });
  }

  return result?.docId || null;
}

// ─── File type detection & parsing ───────────────────────────────────────────

// "Race" and "Lauf" (German) are the same sentinel concept as "Heat" — the
// same file sometimes mixes conventions across event blocks (some sections
// use "Heat 1"/"Heat 2", others "Race 1"/"Race 2" for the exact same thing),
// and a sentinel this regex doesn't recognize is silently dropped, leaving
// every athlete in that block wrongly inheriting whatever heat number was
// last seen from an earlier, unrelated event.
const HEAT_SENTINEL_RE = /^(?:heat|série|serie|race|lauf)\s+(.+)$/i;

// Column-name patterns for the new "all-in-one" combined file format.
const COMBINED_COL_PATTERNS = {
  event:        [/^event$/,          /^épreuve$/,    /^discipline$/],
  lastName:     [/^last\s?name$/,    /^nom$/,        /^name$/,       /^surname$/],
  firstName:    [/^first\s?name$/,   /^prénom$/,     /^prenom$/,     /^vorname$/],
  nationality:  [/^nat(ionality)?$/, /^pays$/,       /^land$/],
  birthYear:    [/^birth\s?year$/,   /^year$/,       /^jahrg\.?$/,   /^année$/],
  status:       [/^status$/],
  worldRanking: [/^wr$/,             /^world\s?ranking$/, /^ranking$/],
  pb:           [/^pb$/],
  pbIndoor:     [/^pb\s?indoor$/],
  pbOutdoor:    [/^pb\s?outdoor$/],
  sb:           [/^sb\d*$/],
  waUrl:        [/^wa\s?(url|profile)?$/, /^world\s?athletics(\s?profile)?$/],
  heat:         [/^heat$/,           /^série$/,      /^serie$/],
  lane:         [/^lane$/,           /^couloir$/],
  manager:      [/^manager$/,        /^gestionnaire$/],
  arrival:      [/^arrival$/,        /^anreise$/,    /^arrivée$/,    /^arrivee$/],
  departure:    [/^departure$/,      /^abreise$/,    /^départ$/,     /^depart$/],
  hotel:        [/^hotel$/,          /^hôtel$/],
};

// The meeting director never gives coaches/physios/family their own file
// column — he writes their role directly into the Event column instead
// ("coach", "manager"...) with their own name in Last/First name and the
// athlete they support in the Manager column. Detected up front so they
// never get imported as if they were competing athletes.
const _STAFF_ROLE_PATTERNS = [
  [/^coach\b/i, "Coach"],
  [/^manager\b/i, "Manager"],
  [/^physio/i, "Physio"],
  [/^m[ée]decin|^medical|^arzt/i, "Médical"],
  [/^betreuer/i, "Accompagnateur"],
  [/^famil(y|le)|^parent|^guest/i, "Famille / invité"],
];

function detectStaffRole(rawEvent) {
  const cleaned = String(rawEvent || "").trim();
  for (const [re, label] of _STAFF_ROLE_PATTERNS) {
    if (re.test(cleaned)) return label;
  }
  return null;
}

// Occasionally the role word ends up prefixed onto the name itself instead of
// (or in addition to) the Event column — "coach Asier" typed straight into
// Last name. Strip it so the person's actual name isn't polluted with their
// role, and fall back to it as the staffRole source when the Event column
// didn't carry one.
function stripLeadingStaffRole(text) {
  const cleaned = String(text || "").trim();
  for (const [re, label] of _STAFF_ROLE_PATTERNS) {
    const m = re.exec(cleaned);
    if (m) return { role: label, rest: cleaned.slice(m[0].length).trim() };
  }
  return null;
}

function buildColMap(row) {
  // Trailing "." tolerated (the documented header "Nat." wouldn't otherwise
  // match /^nat(ionality)?$/ — the exact column name this app's own "Accepted
  // formats" panel tells the meeting director to use).
  const h = row.map((c) => String(c || "").trim().toLowerCase().replace(/\.+$/, ""));
  const map = {};
  for (const [field, pats] of Object.entries(COMBINED_COL_PATTERNS)) {
    const idx = h.findIndex((cell) => pats.some((p) => p.test(cell)));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function detectFileType(rows) {
  // Try rows 0-2 to find the best header (most recognized columns).
  let bestMap = {};
  let bestHeaderIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const m = buildColMap(rows[i]);
    if (Object.keys(m).length > Object.keys(bestMap).length) {
      bestMap = m; bestHeaderIdx = i;
    }
  }
  const hasIdent = "lastName" in bestMap && "firstName" in bestMap;
  // Le meeting director renvoie le même type de fichier avec un sous-ensemble
  // de colonnes variable selon ce qui a changé (juste les séries/couloirs un
  // jour, juste les voyages un autre) — tant que les colonnes d'identité sont
  // reconnues par en-tête, on utilise le mapping par nom de colonne plutôt que
  // d'exiger un jeu complet de colonnes, sans quoi ça retombe sur le fallback
  // positionnel legacy qui suppose un format figé.
  if (hasIdent) {
    // Some CMCM "final start list with lanes" files carry no Heat/Lane header
    // at all — heats are announced as a literal "Heat 1" row in column A,
    // followed by athlete rows whose column A holds their lane number (1-8,
    // resetting each heat). Only trust column A as a lane number when such a
    // sentinel row genuinely appears somewhere in the sheet — other CMCM
    // exports also put a bare running number in column A that is just a rank
    // in that list, not a lane, and must not be misread as one.
    const hasHeatSentinels = rows.some((row) => HEAT_SENTINEL_RE.test(norm(row[0])));
    return { type: "COMBINED", colMap: bestMap, dataStartIdx: bestHeaderIdx + 1, hasHeatSentinels };
  }

  // Position-based fallback for the legacy CMCM Excel formats.
  const h = rows[0].map((c) => String(c || "").trim().toLowerCase());
  if (h[4] === "manager" || (h[5] || "").startsWith("anreise")) return { type: "TRAVEL",     colMap: null, dataStartIdx: 1 };
  if (h[7] === "status"  || h[8] === "wr")                      return { type: "START_LIST", colMap: null, dataStartIdx: 2 };
  if (h[7] === "pb"      || h[7] === "pb ")                     return { type: "FINAL_LANES",colMap: null, dataStartIdx: 2 };
  if (h[2] === "event")                                          return { type: "START_LIST", colMap: null, dataStartIdx: 2 };
  return { type: "UNKNOWN", colMap: null, dataStartIdx: 1 };
}

function norm(v) { return String(v || "").trim(); }

// Some meeting directors paste a World Athletics profile as a hyperlink whose
// visible text is just "Name | Profile | World Athletics" with no URL or WAID
// anywhere in the displayed text — sheet_to_json() only reads cell text, so
// those hyperlinks are otherwise silently lost. Read the underlying hyperlink
// target when present so the real profile URL survives.
function sheetRowsWithHyperlinks(utils, ws) {
  if (!ws["!ref"]) return [];
  const range = utils.decode_range(ws["!ref"]);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[utils.encode_cell({ r, c })];
      if (!cell) { row.push(""); continue; }
      row.push(cell.l?.Target || (cell.v ?? ""));
    }
    rows.push(row);
  }
  return rows;
}

function parseStartListRow(row) {
  const event = norm(row[2]);
  const lastName = norm(row[3]);
  const firstName = norm(row[4]);
  if (!event || !lastName || event.toLowerCase() === "event") return null;

  const rawPb = norm(row[9]);
  const { indoor: pbIndoor, outdoor: pbOutdoor } = parsePb(rawPb);
  const waRaw = norm(row[11]);

  return {
    event, lastName, firstName,
    nationality: norm(row[5]),
    birthYear: normalizeBirthYear(row[6]),
    status: norm(row[7]).toLowerCase() || null,
    worldRanking: row[8] !== "" && !isNaN(Number(row[8])) ? Number(row[8]) : null,
    pb: rawPb || null, pbIndoor, pbOutdoor,
    sb: norm(row[10]) || null,
    waUrl: waRaw.startsWith("http") ? waRaw : null,
    waid: extractWaid(waRaw),
    heat: null, lane: null, manager: null, arrival: null, departure: null,
  };
}

function parseFinaLanesRows(rows) {
  const athletes = [];
  let currentHeat = null;

  for (const row of rows) {
    const col0 = norm(row[0]);
    const event = norm(row[2]);
    if (col0.toLowerCase().startsWith("heat")) { currentHeat = col0; continue; }
    const lastName = norm(row[3]);
    if (!event || !lastName || event.toLowerCase() === "event") continue;

    const rawPb = norm(row[7]);
    const { indoor: pbIndoor, outdoor: pbOutdoor } = parsePb(rawPb);
    const waRaw = norm(row[9]);

    athletes.push({
      event, lastName, firstName: norm(row[4]),
      nationality: norm(row[5]),
      birthYear: normalizeBirthYear(row[6]),
      status: null, worldRanking: null,
      pb: rawPb || null, pbIndoor, pbOutdoor,
      sb: norm(row[8]) || null,
      waUrl: waRaw.startsWith("http") ? waRaw : null,
      waid: extractWaid(waRaw),
      heat: currentHeat,
      lane: col0 !== "" && !isNaN(Number(col0)) ? Number(col0) : null,
      manager: null, arrival: null, departure: null,
    });
  }
  return athletes;
}

function parseTravelRow(row) {
  const rawLastName = norm(row[1]);
  const firstName = norm(row[2]);
  if (!rawLastName || !firstName) return null;
  const nameRoleMatch = stripLeadingStaffRole(rawLastName);
  const lastName = nameRoleMatch ? (nameRoleMatch.rest || rawLastName) : rawLastName;
  const arrival   = norm(row[5]) || null;
  const departure = norm(row[6]) || null;
  const event = norm(row[0]);
  return {
    event, staffRole: detectStaffRole(event) || nameRoleMatch?.role || null, lastName, firstName,
    nationality: norm(row[3]),
    birthYear: null, status: null, worldRanking: null,
    pb: null, pbIndoor: null, pbOutdoor: null, sb: null,
    waUrl: null, waid: null, heat: null, lane: null,
    manager: norm(row[4]) || null,
    arrival, ...expandTravelField(arrival, "arrival"),
    departure, ...expandTravelField(departure, "departure"),
  };
}

function parseCombinedRow(row, colMap) {
  const g = (field) => colMap[field] !== undefined ? norm(row[colMap[field]]) : "";
  const rawLastName = g("lastName");
  const firstName = g("firstName");
  if (!rawLastName && !firstName) return null;

  const nameRoleMatch = stripLeadingStaffRole(rawLastName);
  const lastName = nameRoleMatch ? (nameRoleMatch.rest || rawLastName) : rawLastName;

  const rawPb   = g("pb");
  const rawWaUrl = g("waUrl");
  const { indoor: parsedPbIn, outdoor: parsedPbOut } = parsePb(rawPb);
  const rawLane = g("lane");

  return {
    event:        g("event")        || null,
    staffRole:    detectStaffRole(g("event")) || nameRoleMatch?.role || null,
    lastName,     firstName,
    nationality:  g("nationality")  || null,
    birthYear:    normalizeBirthYear(colMap.birthYear !== undefined ? row[colMap.birthYear] : null),
    status:       g("status").toLowerCase() || null,
    worldRanking: (() => { const v = g("worldRanking"); return v !== "" && !isNaN(Number(v)) ? Number(v) : null; })(),
    pb:           rawPb || null,
    pbIndoor:     g("pbIndoor")  || parsedPbIn  || null,
    pbOutdoor:    g("pbOutdoor") || parsedPbOut || null,
    sb:           g("sb")        || null,
    waUrl:        rawWaUrl.startsWith("http") ? rawWaUrl : null,
    waid:         extractWaid(rawWaUrl),
    heat:         g("heat") || null,
    lane:         rawLane !== "" && !isNaN(Number(rawLane)) ? Number(rawLane) : null,
    manager:   g("manager")   || null,
    hotel:     g("hotel")     || null,
    arrival:   g("arrival")   || null,
    departure: g("departure") || null,
    ...expandTravelField(g("arrival")   || null, "arrival"),
    ...expandTravelField(g("departure") || null, "departure"),
  };
}

// Some CMCM files repeat the header row mid-sheet (one block per event) and,
// when hasHeatSentinels is set, use "Heat N" sentinel rows + a bare lane
// number in column A instead of named Heat/Lane columns (see detectFileType).
function parseCombinedRowsWithHeatSentinels(rows, colMap) {
  const records = [];
  let currentHeat = null;
  for (const row of rows) {
    const firstCell = norm(row[0]);
    const sentinelMatch = HEAT_SENTINEL_RE.exec(firstCell);
    if (sentinelMatch && !norm(row[colMap.lastName])) {
      currentHeat = sentinelMatch[1];
      continue;
    }
    // A repeated header row (new event block) — not an athlete.
    const rowColMap = buildColMap(row);
    if (rowColMap.lastName !== undefined && rowColMap.firstName !== undefined) continue;

    const record = parseCombinedRow(row, colMap);
    if (!record) continue;
    if (colMap.heat === undefined) record.heat = currentHeat;
    // Column A is usually a bare lane number, but some event blocks in the
    // same file instead write "Bahn N" (German for "lane") — strip that
    // prefix before parsing, or the lane is silently left blank.
    const laneCell = firstCell.replace(/^(bahn|lane|couloir)\s+/i, "");
    if (colMap.lane === undefined && laneCell !== "" && !isNaN(Number(laneCell))) {
      record.lane = Number(laneCell);
    }
    records.push(record);
  }
  return records;
}

// Splits any parsed row list into real athletes vs staff/accompanying persons
// (flagged via staffRole — see detectStaffRole). COMBINED and TRAVEL rows both
// carry an Event-like column that staff rows use ("coach", "manager", ...);
// START_LIST/FINAL_LANES have no such column so this is a no-op for those.
function splitStaffRows(rows) {
  const records = [];
  const staff = [];
  for (const row of rows) {
    (row.staffRole ? staff : records).push(row);
  }
  return { records, staff };
}

function parseRows(rows, detected) {
  const { type, colMap, dataStartIdx, hasHeatSentinels } = detected;
  if (type === "START_LIST")  return { records: rows.slice(dataStartIdx).map(parseStartListRow).filter(Boolean), staff: [] };
  if (type === "FINAL_LANES") return { records: parseFinaLanesRows(rows.slice(dataStartIdx)), staff: [] };
  if (type === "TRAVEL")      return splitStaffRows(rows.slice(dataStartIdx).map(parseTravelRow).filter(Boolean));
  if (type === "COMBINED") {
    const dataRows = rows.slice(dataStartIdx);
    const parsed = hasHeatSentinels
      ? parseCombinedRowsWithHeatSentinels(dataRows, colMap)
      : dataRows
          // Some CMCM files repeat the header row mid-sheet (one block per
          // event) even outside the Heat-sentinel format — without this,
          // that row's own header text ("Name"/"Vorname"...) gets imported
          // as if it were a real athlete.
          .filter((row) => {
            const rowColMap = buildColMap(row);
            return !(rowColMap.lastName !== undefined && rowColMap.firstName !== undefined);
          })
          .map((r) => parseCombinedRow(r, colMap)).filter(Boolean);
    return splitStaffRows(parsed);
  }
  return { records: [], staff: [] };
}

// Helper: copy all structured travel sub-fields from a record onto a merged athlete.
// `presentFields` (columns actually found in this specific file's header) gates
// each sub-field independently: a column absent from this import must never
// blank out data set by a previous import that did have it (see mergeAthletes).
function applyTravelFields(merged, record, presentFields) {
  const hasColumn = (field) => !presentFields || presentFields.includes(field);

  if (hasColumn("arrival")) {
    merged.arrival       = record.arrival       ?? null;
    merged.arrivalDay    = record.arrivalDay    ?? null;
    merged.arrivalTime   = record.arrivalTime   ?? null;
    merged.arrivalFlight = record.arrivalFlight ?? null;
    merged.arrivalFrom   = record.arrivalFrom   ?? null;
  }
  if (hasColumn("departure")) {
    merged.departure       = record.departure       ?? null;
    merged.departureDay    = record.departureDay    ?? null;
    merged.departureTime   = record.departureTime   ?? null;
    merged.departureFlight = record.departureFlight ?? null;
    merged.departureTo     = record.departureTo     ?? null;
  }
  if (hasColumn("manager")) merged.manager = record.manager ?? null;
}

// Fields worth calling out when comparing one import to the next — WA-sourced
// fields are deliberately excluded (they change via the Sync button, not via
// import, so surfacing them here would be noise unrelated to this file).
const DIFFABLE_ATHLETE_FIELDS = [
  { key: "event",     label: "Épreuve",  labelEn: "Event" },
  { key: "status",    label: "Statut",   labelEn: "Status" },
  { key: "heat",      label: "Série",    labelEn: "Heat" },
  { key: "lane",      label: "Couloir",  labelEn: "Lane" },
  { key: "manager",   label: "Manager",  labelEn: "Manager" },
  { key: "arrival",   label: "Arrivée",  labelEn: "Arrival" },
  { key: "departure", label: "Départ",   labelEn: "Departure" },
  { key: "waid",      label: "WAID",     labelEn: "WAID" },
];

function athleteDisplayLabel(a) {
  return [a.lastName, a.firstName].filter(Boolean).join(" ") || "(sans nom)";
}

function mergeAthletes(existing, incoming, fileType, presentFields = null) {
  // Grouped by key rather than a single slot per key: a name+nationality can
  // map to SEVERAL existing docs when the admin split one messy row across
  // disciplines (see handleSplitEvent, "Dupliquer sur N épreuves"). Collapsing
  // those into one slot would silently drop one duplicate on the next import.
  const groups = new Map();
  for (const a of existing) {
    const key = athleteMergeKey(a.lastName, a.firstName, a.nationality);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...a });
  }

  const matchedKeys = new Set(); // tracks which existing athletes appear in this import
  let added = 0;
  let updated = 0;
  const changes = [];

  for (const record of incoming) {
    const key = athleteMergeKey(record.lastName, record.firstName, record.nationality);
    const group = groups.get(key);

    if (!group) {
      groups.set(key, [{ ...record }]);
      added++;
      changes.push({ type: "added", name: athleteDisplayLabel(record), event: record.event || null });
      continue;
    }

    matchedKeys.add(key);
    // A split athlete already has each duplicate's event/heat/lane set by
    // hand — re-applying this (single, un-split) import row's raw event to
    // either of them would undo the fix. Only fields that aren't
    // discipline-specific get refreshed on every duplicate.
    const isSplit = group.length > 1;
    let anyChanged = false;

    for (let i = 0; i < group.length; i++) {
      const ex = group[i];
      const merged = { ...ex };

      if (fileType === "COMBINED") {
        const hasColumn = (field) => !presentFields || presentFields.includes(field);
        if (!isSplit && record.event)    merged.event        = record.event;
        if (record.status !== null)      merged.status       = record.status;
        if (record.worldRanking != null) merged.worldRanking = record.worldRanking;
        if (record.pb)                   merged.pb           = record.pb;
        if (record.pbIndoor)             merged.pbIndoor     = record.pbIndoor;
        if (record.pbOutdoor)            merged.pbOutdoor    = record.pbOutdoor;
        if (record.sb)                   merged.sb           = record.sb;
        if (record.waUrl && !merged.waUrl) merged.waUrl      = record.waUrl;
        if (record.waid  && !merged.waid)  merged.waid       = record.waid;
        // Un fichier qui ne contient pas les colonnes Heat/Lane pour cette
        // édition (ex. mise à jour voyages uniquement) ne doit pas effacer les
        // séries/couloirs déjà connus.
        if (!isSplit && hasColumn("heat")) merged.heat = record.heat ?? null;
        if (!isSplit && hasColumn("lane")) merged.lane = record.lane ?? null;
        // A heat/lane assignment is unambiguous proof this athlete is
        // competing — a lanes-only file has no Status column to say so
        // explicitly, but leaving them stuck on a stale "out" from an
        // earlier import that simply didn't mention them (or an import that
        // happened before this file was even seeded) would be wrong once
        // they've clearly been placed in a heat.
        if (record.status === null && merged.status === "out" && (merged.heat || merged.lane)) {
          merged.status = "ok";
        }
        applyTravelFields(merged, record, presentFields);
      } else if (fileType === "TRAVEL") {
        applyTravelFields(merged, record, null);
      } else if (fileType === "FINAL_LANES") {
        if (!isSplit && record.heat !== null) merged.heat = record.heat;
        if (!isSplit && record.lane !== null) merged.lane = record.lane;
        if (!merged.pb && record.pb)             merged.pb       = record.pb;
        if (!merged.pbIndoor && record.pbIndoor) merged.pbIndoor = record.pbIndoor;
        if (!merged.pbOutdoor && record.pbOutdoor) merged.pbOutdoor = record.pbOutdoor;
        if (!merged.sb && record.sb)             merged.sb       = record.sb;
      } else {
        // START_LIST
        if (record.status !== null)       merged.status       = record.status;
        if (record.worldRanking !== null) merged.worldRanking = record.worldRanking;
        if (record.pb)        merged.pb        = record.pb;
        if (record.pbIndoor)  merged.pbIndoor  = record.pbIndoor;
        if (record.pbOutdoor) merged.pbOutdoor = record.pbOutdoor;
        if (record.sb)        merged.sb        = record.sb;
        if (record.waUrl)     merged.waUrl     = record.waUrl;
        if (record.waid)      merged.waid      = record.waid;
      }

      const fieldChanges = DIFFABLE_ATHLETE_FIELDS
        .filter(({ key: field }) => (ex[field] ?? null) !== (merged[field] ?? null))
        .map(({ key: field, label }) => ({ field, label, before: ex[field] ?? null, after: merged[field] ?? null }));
      if (fieldChanges.length > 0) {
        changes.push({ type: "updated", name: athleteDisplayLabel(merged), event: merged.event || null, fields: fieldChanges });
        anyChanged = true;
      }
      group[i] = merged;
    }
    if (anyChanged) updated++;
  }

  // For COMBINED / START_LIST: athletes in the DB but absent from this import
  // → mark as "out", clear heat/lane/travel (they're no longer on the start list).
  // They are NEVER deleted — they stay in the system permanently.
  //
  // A COMBINED-shaped file isn't necessarily the full official roster: the
  // meeting director also sends travel-only lists using the same modern
  // headers (Event/Name/Vorname/Nat./Manager/Anreise/Abreise) restricted to
  // whichever athletes need transport help — a real subset of the roster, not
  // "everyone else withdrew". Only treat a COMBINED file as authoritative for
  // presence/absence when it actually carries a roster-defining column
  // (Status, ranking, PB/SB, WA URL, Heat or Lane) — a pure identity+travel
  // file never does.
  const ROSTER_DEFINING_FIELDS = ["status", "worldRanking", "pb", "pbIndoor", "pbOutdoor", "sb", "waUrl", "heat", "lane"];
  const isAuthoritativeRoster = fileType === "START_LIST" ||
    (fileType === "COMBINED" && (!presentFields || ROSTER_DEFINING_FIELDS.some((f) => presentFields.includes(f))));

  let markedOut = 0;
  if (isAuthoritativeRoster) {
    for (const [key, group] of groups) {
      if (matchedKeys.has(key)) continue;
      for (let i = 0; i < group.length; i++) {
        const athlete = group[i];
        if (!athlete.id) continue;
        // Only count/report a fresh cancellation — an athlete already marked
        // "out" by a previous import isn't a change introduced by this one.
        if (athlete.status !== "out") {
          markedOut++;
          changes.push({ type: "markedOut", name: athleteDisplayLabel(athlete), event: athlete.event || null });
        }
        group[i] = {
          ...athlete,
          status:    "out",
          heat: null, lane: null, manager: null,
          arrival: null, arrivalDay: null, arrivalTime: null, arrivalFlight: null, arrivalFrom: null,
          departure: null, departureDay: null, departureTime: null, departureFlight: null, departureTo: null,
        };
      }
    }
  }

  const merged = [];
  for (const group of groups.values()) merged.push(...group);
  return { merged, added, updated, markedOut, changes };
}

// Coaches/physios/family (see detectStaffRole): add-or-update by identity,
// same matching key as athletes. No "out"/markedOut concept here — the
// director doesn't consistently re-list every accompanying person on every
// file, so someone missing from a later file isn't necessarily gone.
function mergeAccompanyingPersons(existing, incoming) {
  const byKey = new Map(
    existing.map((p) => [athleteMergeKey(p.lastName, p.firstName, p.nationality), { ...p }]),
  );
  let added = 0;
  let updated = 0;

  for (const record of incoming) {
    const key = athleteMergeKey(record.lastName, record.firstName, record.nationality);
    const ex = byKey.get(key);
    if (!ex) {
      byKey.set(key, { ...record });
      added++;
      continue;
    }
    const merged = { ...ex };
    if (record.staffRole)  merged.staffRole  = record.staffRole;
    if (record.status)     merged.status     = record.status;
    if (record.manager)    merged.linkedTo   = record.manager;
    if (record.hotel)      merged.hotel      = record.hotel;
    applyTravelFields(merged, record, null);
    byKey.set(key, merged);
    updated++;
  }

  return { merged: [...byKey.values()], added, updated };
}

// ─── Small shared components ─────────────────────────────────────────────────

// The meeting director's file sometimes carries an intermediate status
// (invited, not yet confirmed) before the athlete becomes "ok" or "out" on
// the official list — this is transient, not a lasting data problem, but
// worth translating for whoever reads the roster in the meantime. Keyed on
// the trimmed, lowercased raw value; the raw text stays visible as a tooltip.
const PENDING_STATUS_TRANSLATIONS = {
  "unser angebot": ["Invité(e), pas encore confirmé(e)", "Invited, not yet confirmed"],
  "abwarten": ["En attente", "Pending"],
  "warten": ["En attente", "Pending"],
};

// The hotel column often carries German hotel-admin shorthand rather than a
// hotel name — room type (DZ/EZ) and who booked it. Translate what we
// recognize, keep the raw text visible on hover for anything else.
const HOTEL_ABBREVIATION_TRANSLATIONS = [
  [/\bdz\b/gi, "chambre double", "double room"],
  [/\bez\b/gi, "chambre simple", "single room"],
  [/\bohne\b/gi, "sans hôtel", "no hotel"],
  [/selber gebucht/gi, "réservé par ses soins", "self-booked"],
  [/\bstorniert\b/gi, "annulé", "cancelled"],
];

function translateHotelText(raw, tr) {
  let translated = raw;
  let changed = false;
  for (const [re, fr, en] of HOTEL_ABBREVIATION_TRANSLATIONS) {
    if (re.test(translated)) { changed = true; translated = translated.replace(re, tr(fr, en)); }
  }
  return changed ? translated : null;
}

function HotelCell({ value }) {
  const tr = useTr();
  if (!value) return "—";
  const translated = translateHotelText(value, tr);
  if (!translated) return value;
  return <span title={`${tr("Texte d'origine : ", "Original text: ")}${value}`}>{translated}</span>;
}

function StatusBadge({ status }) {
  const tr = useTr();
  if (!status) return "—";
  if (status === "ok")  return <span className="status-pill status-pill--ok">OK</span>;
  if (status === "out") return <span className="status-pill status-pill--warn">Out</span>;
  const translated = PENDING_STATUS_TRANSLATIONS[String(status).trim().toLowerCase()];
  if (translated) {
    return (
      <span className="status-pill status-pill--pending" title={`${tr("Texte d'origine : ", "Original text: ")}${status}`}>
        {tr(translated[0], translated[1])}
      </span>
    );
  }
  return <span className="status-pill">{status}</span>;
}

// Shows whether this athlete is linked to the permanent cross-edition
// registry (so their past-editions history is actually available) and opens
// their unified profile card on click — same target as clicking the name.
function RegistryLinkCell({ athlete, onOpen }) {
  const tr = useTr();
  const linked = Boolean(athlete.registryAthleteId);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={linked
        ? tr("Relié à l'historique — voir la fiche", "Linked to the history — open the profile")
        : tr("Pas encore relié à l'historique — voir la fiche", "Not linked to the history yet — open the profile")}
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        fontSize: "0.78rem",
        fontWeight: 600,
        lineHeight: 1,
        color: linked ? "#166534" : "#94a3b8",
      }}
    >
      {linked ? "✓" : "–"}
    </button>
  );
}

function WaBadge({ value }) {
  const tr = useTr();
  if (!value) return <span style={{ color: "#aaa" }}>—</span>;
  return (
    <span style={{ color: "#1d4ed8", whiteSpace: "nowrap" }} title={tr("Source : World Athletics", "Source: World Athletics")}>
      {value}
    </span>
  );
}

function FileTypeBadge({ type }) {
  const tr = useTr();
  const map = {
    COMBINED:    [tr("Combiné (toutes les données)", "Combined (all data)"), "status-pill status-pill--accent"],
    START_LIST:  [tr("Liste de départ", "Start list"),        "status-pill status-pill--accent"],
    FINAL_LANES: [tr("Séries & couloirs", "Heats & lanes"),   "status-pill"],
    TRAVEL:      [tr("Voyages", "Travel"),                    "status-pill"],
    UNKNOWN:     [tr("Inconnu", "Unknown"),                   "status-pill status-pill--warn"],
  };
  const [label, cls] = map[type] ?? map.UNKNOWN;
  return <span className={cls}>{label}</span>;
}

// ─── Inline WAID editor ───────────────────────────────────────────────────────

function WaidCell({ athlete, onSave }) {
  const tr = useTr();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(athlete.waid ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = value.trim();
    if (trimmed === (athlete.waid ?? "")) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(athlete.id, trimmed || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <input
          autoFocus
          style={{ width: 100, fontSize: "0.85rem", padding: "2px 4px" }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          placeholder="WAID"
          disabled={saving}
        />
        <button className="button button--ghost button--small" type="button" onClick={handleSave} disabled={saving}>✓</button>
        <button className="button button--ghost button--small" type="button" onClick={() => setEditing(false)}>✕</button>
      </span>
    );
  }

  return (
    <span
      style={{ cursor: "pointer", borderBottom: "1px dashed #999", paddingBottom: 1 }}
      title={tr("Cliquer pour modifier le WAID", "Click to edit the WAID")}
      onClick={() => { setValue(athlete.waid ?? ""); setEditing(true); }}
    >
      {athlete.waid ?? <span className="ath-muted">{tr("+ ajouter", "+ add")}</span>}
    </span>
  );
}

// ─── Event correction row (for "à vérifier" entries) ─────────────────────────

// A guessed value like "60m + 60mH W" means the athlete is genuinely entered
// in more than one discipline — a single event string can't represent that,
// so this needs a second Firestore doc (see handleSplitEvent), not just a
// text edit. Parsed back into { disciplines, gender } so the split button
// knows what to create.
function parseSplitValue(value) {
  if (!value.includes(" + ")) return null;
  const genderMatch = /\s+(W|M)$/.exec(value.trim());
  const gender = genderMatch ? genderMatch[1] : null;
  const withoutGender = gender ? value.trim().slice(0, -genderMatch[0].length) : value.trim();
  const disciplines = withoutGender.split(" + ").map((d) => d.trim()).filter(Boolean);
  return disciplines.length > 1 ? { disciplines, gender } : null;
}

const GENDER_OPTIONS = [
  { value: "", label: "Genre ?", labelEn: "Gender?" },
  { value: "W", label: "Femmes", labelEn: "Women" },
  { value: "M", label: "Hommes", labelEn: "Men" },
];
const _TRAILING_GENDER_RE = /\s+(women|femmes?|men|hommes?|w|f|m|h)$/i;

function stripTrailingGender(value) {
  return value.replace(_TRAILING_GENDER_RE, "").trim();
}

function detectTrailingGender(value) {
  const m = _TRAILING_GENDER_RE.exec(value.trim());
  if (!m) return "";
  return /^(w|f|women|femmes?)$/i.test(m[1]) ? "W" : "M";
}

function RowDeleteCell({ athlete, onDelete }) {
  const tr = useTr();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onDelete(athlete.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        className="ath-icon-btn ath-icon-btn--danger"
        type="button"
        onClick={() => setConfirming(true)}
        title={tr("Supprimer cette fiche (erreur d'import, doublon...)", "Delete this entry (import error, duplicate...)")}
        aria-label={tr("Supprimer", "Delete")}
      >
        ✕
      </button>
    );
  }
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
      <button className="ath-link ath-link--danger" type="button" onClick={handleConfirm} disabled={deleting}>
        {deleting ? "…" : tr("Supprimer", "Delete")}
      </button>
      <button className="ath-link" type="button" onClick={() => setConfirming(false)} disabled={deleting}>
        {tr("Annuler", "Cancel")}
      </button>
    </span>
  );
}

function EventCorrectionRow({ athlete, onSave, onSplit, onDelete }) {
  const tr = useTr();
  const [value, setValue] = useState(guessEventCorrection(athlete.event));
  const [gender, setGender] = useState(() => detectTrailingGender(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const split = parseSplitValue(value);

  function handleGenderChange(g) {
    setGender(g);
    setSaved(false);
    setValue((current) => {
      const base = stripTrailingGender(current);
      return g ? `${base} ${g}`.trim() : base;
    });
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(athlete.id, trimmed);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleSplit() {
    setSaving(true);
    try {
      await onSplit(athlete, split.disciplines, split.gender);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await onDelete(athlete.id);
    } finally {
      setSaving(false);
      setConfirmingDelete(false);
    }
  }

  const staffRoleHint = detectStaffRole(athlete.event);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 0" }}>
      <span style={{ minWidth: 160, fontWeight: 600 }}>{athlete.lastName} {athlete.firstName}</span>
      <span style={{ color: "#888", fontSize: "0.8rem" }}>
        {tr("brut :", "raw:")} <em>{athlete.event || tr("(vide)", "(empty)")}</em>
      </span>
      {staffRoleHint && (
        <span style={{ color: "#b8860b", fontSize: "0.78rem" }}>
          ⚠ {staffRoleLabel(staffRoleHint, tr)} — {tr(
            "ce n'est pas un athlète, pas d'épreuve à corriger : supprime cette fiche (un futur import de ce fichier la reliera correctement en accompagnateur)",
            "not an athlete, no event to fix: delete this entry (a later import of this file will link it correctly as staff)",
          )}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setGender(detectTrailingGender(e.target.value)); setSaved(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !split) handleSave(); }}
        style={{ width: 180, fontSize: "0.85rem", padding: "3px 6px" }}
        disabled={saving}
      />
      <select
        value={gender}
        onChange={(e) => handleGenderChange(e.target.value)}
        style={{ width: "auto", fontSize: "0.85rem", padding: "3px 6px" }}
        disabled={saving}
        title={tr("Ce que le meeting director attend pour cette épreuve", "What the meeting director expects for this event")}
      >
        {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{tr(o.label, o.labelEn)}</option>)}
      </select>
      {split ? (
        <button className="button button--secondary button--small" type="button" onClick={handleSplit} disabled={saving}>
          {saving ? "…" : tr(`Dupliquer sur ${split.disciplines.length} épreuves`, `Duplicate to ${split.disciplines.length} events`)}
        </button>
      ) : (
        <button className="button button--secondary button--small" type="button" onClick={handleSave} disabled={saving || !value.trim()}>
          {saving ? "…" : tr("Enregistrer", "Save")}
        </button>
      )}
      {saved && <span style={{ color: "#166534", fontSize: "0.78rem" }}>✓ {split ? tr("fiches créées", "entries created") : tr("enregistré", "saved")}</span>}
      {confirmingDelete ? (
        <>
          <span style={{ color: "#b71c1c", fontSize: "0.78rem" }}>{tr("Supprimer définitivement ?", "Delete permanently?")}</span>
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={handleDelete}
            disabled={saving}
            style={{ color: "#b71c1c", fontWeight: 700 }}
          >
            {saving ? "…" : tr("Confirmer", "Confirm")}
          </button>
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={saving}
          >
            {tr("Annuler", "Cancel")}
          </button>
        </>
      ) : (
        <button
          className="button button--ghost button--small"
          type="button"
          onClick={() => setConfirmingDelete(true)}
          style={{ color: "#b71c1c" }}
          title={tr("Cette fiche n'est pas un vrai athlète (erreur d'import)", "This entry is not a real athlete (import error)")}
        >
          {tr("Supprimer", "Delete")}
        </button>
      )}
    </div>
  );
}

// ─── WA sync button ───────────────────────────────────────────────────────────

function WaSyncButton({ athlete, settings, onDone }) {
  const [status, setStatus] = useState(null); // null | "syncing" | "ok" | "error"
  const [error, setError] = useState("");
  const tr = useTr();

  if (!athlete.waid) return <span className="ath-muted">{tr("sans WAID", "no WAID")}</span>;

  async function handleSync() {
    setStatus("syncing");
    setError("");
    try {
      const waData = await fetchAthleteFromWaService(athlete.waid, settings, athlete.event);
      const { _waIdentity, ...firestoreData } = waData;
      let registryAthleteId = athlete.registryAthleteId || null;
      if (_waIdentity) {
        try {
          const registryResult = await upsertAthleteRegistry({
            ..._waIdentity,
            nationality: athlete.nationality,
            birthYear:   athlete.birthYear,
          });
          registryAthleteId = registryResult?.docId || registryAthleteId;
        } catch (registryError) {
          console.error("Unable to update the athlete registry", registryError);
        }
      }
      await updateDoc(doc(db, ATHLETES_COLLECTION, athlete.id), {
        ...firestoreData,
        ...(registryAthleteId ? { registryAthleteId } : {}),
      });
      setStatus("ok");
      onDone?.();
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }

  if (status === "syncing") return <span className="ath-muted">{tr("synchro…", "syncing…")}</span>;
  if (status === "ok")      return <span className="ath-ok">{tr("synchronisé ✓", "synced ✓")}</span>;

  if (status === "error") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxWidth: 220 }}>
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <span className="status-pill status-pill--warn" style={{ fontSize: "0.75rem" }}>{tr("erreur ✕", "error ✕")}</span>
        <button className="button button--ghost button--small" type="button" onClick={handleSync} title={tr("Réessayer", "Retry")}>↻</button>
      </div>
      <span style={{
        fontSize: "0.7rem", color: "#b71c1c", lineHeight: 1.35,
        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
        overflow: "hidden", wordBreak: "break-word",
      }} title={error}>
        {error}
      </span>
    </div>
  );

  return (
    <button className="ath-link" type="button" onClick={handleSync} title={tr("Synchroniser avec World Athletics", "Sync with World Athletics")}>
      ↻ WA
    </button>
  );
}

// ─── Overview page ────────────────────────────────────────────────────────────

function AthletePortalOverview({ Panel }) {
  const tr = useTr();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { activeEditionId } = useActiveEdition();
  const isAdmin = roles.includes("admin") || roles.includes("meeting_director");
  // Same "Courante / Test" switch as the Athletes page — without it, this
  // page always shows the real edition and never the test-edition data an
  // admin is rehearsing an import against.
  // Follows the active edition until the user picks another one (useActiveEdition
  // starts on "test" while it loads, which used to stick).
  const [pickedViewEditionId, setViewEditionId] = useState("");
  const viewEditionId = pickedViewEditionId || activeEditionId;
  const { athletes, loading: athletesLoading } = useAthletes(!settingsLoading, viewEditionId);
  const { people: accompanyingPersons, loading: staffLoading } = useAccompanyingPersons(!settingsLoading, viewEditionId);

  const staffByRole = useMemo(() => {
    const counts = {};
    accompanyingPersons.forEach((p) => {
      const role = p.staffRole || "Autre";
      counts[role] = (counts[role] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [accompanyingPersons]);

  const seasons = settings?.seasons ?? DEFAULT_PORTAL_SETTINGS.seasons;

  const stats = useMemo(() => {
    const nations = new Set(athletes.map((a) => a.nationality).filter(Boolean));
    const withWaid = athletes.filter((a) => a.waid).length;
    const waSynced = athletes.filter((a) => a.waFetchedAt).length;
    const ok = athletes.filter((a) => a.status === "ok").length;
    const out = athletes.filter((a) => a.status === "out").length;
    const withLane = athletes.filter((a) => a.lane).length;
    const withTravel = athletes.filter((a) => a.arrival || a.departure).length;
    return { nations: nations.size, withWaid, waSynced, ok, out, withLane, withTravel };
  }, [athletes]);

  const eventCounts = useMemo(() => {
    const counts = {};
    athletes.forEach((a) => {
      const ev = String(a.event || "Inconnue").trim();
      counts[ev] = (counts[ev] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [athletes]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Portail athlètes</p>
          <h1>Vue d&apos;ensemble</h1>
          <p>
            Saisons : <strong>Indoor {seasons.indoor}</strong>
            {seasons.indoorCurrent && seasons.indoorCurrent !== seasons.indoor && (
              <> · <strong>Indoor {seasons.indoorCurrent}</strong> <span style={{ fontWeight: "normal", color: "#888" }}>(en cours, peu de résultats)</span></>
            )}
            {" · "}<strong>Outdoor {seasons.outdoor}</strong>
          </p>
          {isAdmin && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: "0.8rem", color: "#607086" }}>Édition :</label>
              <select
                value={viewEditionId}
                onChange={(e) => setViewEditionId(e.target.value)}
                style={{ width: "auto", fontSize: "0.85rem", padding: "3px 6px" }}
              >
                <option value={activeEditionId}>{tr("Courante", "Current")} ({activeEditionId})</option>
                {normalizeEditionId(activeEditionId) !== "test" && <option value="test">{tr("Exemple 2026", "Sample 2026")}</option>}
              </select>
              {viewEditionId === "test" && (
                <span className="status-pill status-pill--warn" style={{ fontSize: "0.72rem" }}>
                  Rien ici n&apos;apparaît ailleurs dans l&apos;app
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title="Engagés">
          {athletesLoading ? <p className="panel-note">Chargement…</p> : (
            <ul className="compact-list">
              <li><strong>{athletes.length}</strong> athlètes · <strong>{stats.nations}</strong> nations · <strong>{eventCounts.length}</strong> épreuves</li>
              <li>Statut : <strong>{stats.ok}</strong> confirmés · <strong>{stats.out}</strong> retirés</li>
              <li>Couloirs attribués : <strong>{stats.withLane}</strong></li>
              <li>Infos voyage : <strong>{stats.withTravel}</strong></li>
              <li>WAID connu : <strong>{stats.withWaid}</strong> · synchro WA : <strong>{stats.waSynced}</strong></li>
            </ul>
          )}
        </Panel>
        <Panel title={`Staff & accompagnateurs (${accompanyingPersons.length})`}>
          {staffLoading ? <p className="panel-note">Chargement…</p> : accompanyingPersons.length === 0 ? (
            <p className="panel-note">Aucun import pour cette édition pour le moment.</p>
          ) : (
            <ul className="compact-list">
              {staffByRole.map(([role, count]) => (
                <li key={role}><strong>{count}</strong> {role}</li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="panel-grid panel-grid--1">
        <Panel title="Accès rapide">
          <div className="dashboard-action-grid">
            <NavLink className="button button--secondary button-link" to="/app/athletes">Voir les athlètes</NavLink>
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/athletes/import">Staff & historique des imports</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/resultats/base-athletes">Base athlètes</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/resultats/editions">Résultats du meeting</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/resultats/records">Records du meeting</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/resultats/hall-of-winners">Hall of Winners</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/reglages/portail-athletes">Réglages du portail</NavLink>}
          </div>
        </Panel>
      </section>

      {eventCounts.length > 0 && (
        <section className="panel-grid panel-grid--1">
          <Panel title="Épreuves">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Épreuve</th><th>Athlètes</th></tr></thead>
                <tbody>
                  {eventCounts.map(([ev, count]) => (
                    <tr key={ev}><td>{ev}</td><td>{count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}
    </div>
  );
}

// ─── Athletes list page — helpers ────────────────────────────────────────────

// Splits "60m W" → { discipline:"60m", gender:"W" }   "W 100m" → { discipline:"100m", gender:"W" }
const _GENDER_SUFFIX_RE = /^(.+?)\s+(W|M|F|H|Women|Men|Femmes?|Hommes?)$/i;
const _GENDER_PREFIX_RE = /^(W|M|F|H)\s+(.+)$/i;

function parseEventField(raw) {
  if (!raw) return { discipline: "", gender: null };
  const s = String(raw).trim();
  let m = _GENDER_SUFFIX_RE.exec(s);
  if (m) {
    const g = m[2][0].toUpperCase();
    return { discipline: m[1].trim(), gender: (g === "W" || g === "F") ? "W" : "M" };
  }
  m = _GENDER_PREFIX_RE.exec(s);
  if (m) {
    const g = m[1][0].toUpperCase();
    return { discipline: m[2].trim(), gender: (g === "W" || g === "F") ? "W" : "M" };
  }
  return { discipline: s, gender: null };
}

// Standardizes a discipline name into one canonical form per real event
// ("60m", "60 M", "60M" → "60m") instead of a fixed whitelist — on an
// international meeting there's no such thing as a genuinely "special" event,
// so anything left over after normalizing (a pacer note, a dual-event remark,
// a typo) is exactly what should surface for the meeting director to clean up
// at the source, rather than silently becoming its own event group.
const _FIELD_DISCIPLINE_PATTERNS = [
  [/^long\s*jump$/i, "Long Jump"],   [/^lj$/i, "Long Jump"],
  [/^triple\s*jump$/i, "Triple Jump"], [/^tj$/i, "Triple Jump"],
  [/^high\s*jump$/i, "High Jump"],   [/^hj$/i, "High Jump"],
  [/^pole\s*vault$/i, "Pole Vault"], [/^pv$/i, "Pole Vault"],
  [/^shot\s*put$/i, "Shot Put"],     [/^sp$/i, "Shot Put"],
  [/^discus$/i, "Discus"],           [/^dt$/i, "Discus"],
  [/^hammer$/i, "Hammer"],           [/^ht$/i, "Hammer"],
  [/^javelin$/i, "Javelin"],         [/^jt$/i, "Javelin"],
  [/^heptathlon$/i, "Heptathlon"],   [/^hep$/i, "Heptathlon"],
  [/^decathlon$/i, "Decathlon"],     [/^dec$/i, "Decathlon"],
  [/^pentathlon$/i, "Pentathlon"],   [/^pen$/i, "Pentathlon"],
];
// No \b between the unit and the hurdles/steeplechase suffix — compact forms
// like "60mH" or "3000mSC" have no space, so a word-boundary there would
// never match and wrongly flag every compact-form entry as non-standard.
const _TRACK_DISCIPLINE_RE = /^(\d+)\s*(miles?|m)\s*(hurdles?|h|sc|steeplechase)?/i;

// A trailing "pace"/"pacer"/"pacemaker" note is meaningful, not noise: that
// athlete is running as a rabbit for the race, not competing in it. Keep it
// as a real, visible fact rather than flagging it as "needs a human look".
const _PACER_NOTE_RE = /^pace(r|maker)?$/i;

// The meeting director writes the pacer note as "1500m M pace" — gender
// *before* "pace", not at the very end of the string — so parseEventField's
// end-anchored gender suffix never fires and the whole "M pace" tail lands
// here still carrying the gender letter. Strip it before checking for a bare
// pacer note, and hand the discovered gender back since the caller has none.
const _LEADING_GENDER_RE = /^(W|M|F|H|Women|Men|Femmes?|Hommes?)\s+/i;

function normalizeDisciplineLabel(rawDiscipline) {
  const cleaned = String(rawDiscipline || "").trim();
  if (!cleaned) return { label: "", standardized: false, isPacer: false, gender: null };

  for (const [re, label] of _FIELD_DISCIPLINE_PATTERNS) {
    if (re.test(cleaned)) return { label, standardized: true, isPacer: false, gender: null };
  }

  const m = _TRACK_DISCIPLINE_RE.exec(cleaned);
  if (m) {
    const unit = /mile/i.test(m[2]) ? "mile" : "m";
    const suffix = m[3] ? (/sc|steeplechase/i.test(m[3]) ? "SC" : "H") : "";
    const label = `${m[1]}${unit}${suffix}`;
    // Anything left over after the matched portion (a pacer note, "und 60mH",
    // a typo) means this entry needs a human look, not a silent guess —
    // except a pacer note, which is expected and should stay visible as such.
    let rest = cleaned.slice(m[0].length).trim();
    let gender = null;
    const genderMatch = _LEADING_GENDER_RE.exec(rest);
    if (genderMatch) {
      const g = genderMatch[1][0].toUpperCase();
      gender = (g === "W" || g === "F") ? "W" : "M";
      rest = rest.slice(genderMatch[0].length).trim();
    }
    // A pacer note with no gender anywhere in the text ("800m pace") can't be
    // placed in "800m Men" or "800m Women" without a guess — keep it flagged
    // for review instead of silently dropping it into an ungendered group
    // with no way back to fix it (isPacer alone hid it from "à vérifier").
    if (_PACER_NOTE_RE.test(rest)) return { label, standardized: Boolean(gender), isPacer: true, gender };
    return { label, standardized: rest === "", isPacer: false, gender };
  }

  return { label: cleaned, standardized: false, isPacer: false, gender: null };
}

// Best-effort suggestion for a non-standardized event, used to pre-fill an
// editable field — never applied automatically. Same discipline/gender
// vocabulary as normalizeDisciplineLabel, but searched anywhere in the
// string instead of requiring it to be the whole thing, since these are by
// definition the messy leftover cases ("60m W und 60mH", a typo, a stray
// note) — a suggestion an admin can accept, tweak or ignore beats leaving
// them with no path forward at all.
const _LOOSE_FIELD_PATTERNS = [
  [/long\s*jump|\blj\b/i, "Long Jump"],
  [/triple\s*jump|\btj\b/i, "Triple Jump"],
  [/high\s*jump|\bhj\b/i, "High Jump"],
  [/pole\s*vault|\bpv\b/i, "Pole Vault"],
  [/shot\s*put|\bsp\b/i, "Shot Put"],
  [/discus|\bdt\b/i, "Discus"],
  [/hammer|\bht\b/i, "Hammer"],
  [/javelin|\bjt\b/i, "Javelin"],
];
const _LOOSE_TRACK_RE = /(\d+)\s*(miles?|m)\s*(hurdles?|h|sc|steeplechase)?/i;
const _LOOSE_GENDER_RE = /\b(women|femmes?|w|f)\b|\b(men|hommes?|m|h)\b/i;

// "und"/"and"/"et" between two disciplines usually means the athlete is
// genuinely entered in both ("60m W und 60mH") rather than one being noise —
// list every discipline found instead of arbitrarily keeping only the first.
const _CONJUNCTION_RE = /\b(und|and|et)\b/i;

function guessEventCorrection(rawEvent) {
  const cleaned = String(rawEvent || "").trim();
  if (!cleaned) return "";

  const genderMatch = _LOOSE_GENDER_RE.exec(cleaned);
  const gender = genderMatch ? (genderMatch[1] ? "W" : "M") : null;

  if (_CONJUNCTION_RE.test(cleaned)) {
    const trackMatches = [...cleaned.matchAll(new RegExp(_LOOSE_TRACK_RE.source, "gi"))].map((m) => {
      const unit = /mile/i.test(m[2]) ? "mile" : "m";
      const suffix = m[3] ? (/sc|steeplechase/i.test(m[3]) ? "SC" : "H") : "";
      return `${m[1]}${unit}${suffix}`;
    });
    const fieldMatches = _LOOSE_FIELD_PATTERNS.filter(([re]) => re.test(cleaned)).map(([, label]) => label);
    const disciplines = [...new Set([...trackMatches, ...fieldMatches])];
    if (disciplines.length > 1) {
      return gender ? `${disciplines.join(" + ")} ${gender}` : disciplines.join(" + ");
    }
  }

  let disciplineLabel = null;
  for (const [re, label] of _LOOSE_FIELD_PATTERNS) {
    if (re.test(cleaned)) { disciplineLabel = label; break; }
  }
  if (!disciplineLabel) {
    const m = _LOOSE_TRACK_RE.exec(cleaned);
    if (m) {
      const unit = /mile/i.test(m[2]) ? "mile" : "m";
      const suffix = m[3] ? (/sc|steeplechase/i.test(m[3]) ? "SC" : "H") : "";
      disciplineLabel = `${m[1]}${unit}${suffix}`;
    }
  }
  if (!disciplineLabel) return cleaned;
  // Keep a pace note in the suggestion (don't silently drop that this is a
  // pacer) when gender couldn't be resolved — that's exactly why it's still
  // flagged: the admin needs to add "M "/"W " themselves.
  const paceNote = !gender && /\bpace(r|maker)?\b/i.test(cleaned) ? " pace" : "";
  return (gender ? `${disciplineLabel} ${gender}` : disciplineLabel) + paceNote;
}

const _DISC_RANK = [
  "60m","60mH","100m","200m","400m","600m","800m","1000m","1500m","1mile",
  "2000m","3000m","2miles","5000m","10000m","110mH","400mH","3000mSC",
  "HJ","PV","LJ","TJ","SP","DT","HT","JT","Pen","Hep","Dec",
];
function disciplineRank(disc) {
  const d = (disc || "").toLowerCase().replace(/[\s-]/g, "");
  const i = _DISC_RANK.findIndex((x) => d === x.toLowerCase() || d.startsWith(x.toLowerCase()));
  return i >= 0 ? i : 999;
}

function compareEventGroups([keyA], [keyB]) {
  const pa = parseEventField(keyA);
  const pb = parseEventField(keyB);
  const da = disciplineRank(pa.discipline);
  const db = disciplineRank(pb.discipline);
  if (da !== db) return da - db;
  // Women (W) before Men (M) — typical meeting program order
  if (pa.gender !== pb.gender) {
    if (pa.gender === "W") return -1;
    if (pb.gender === "W") return  1;
  }
  return keyA.localeCompare(keyB);
}

/**
 * Best available competition reference time for heat seeding.
 * Priority: current indoor SB → prev indoor SB → outdoor SB → indoor PB → outdoor PB → raw SB/PB
 */
function GenderBadge({ gender }) {
  const tr = useTr();
  if (!gender) return null;
  const w = gender === "W";
  return (
    <span className={`ath-gender ath-gender--${w ? "w" : "m"}`}>
      {w ? tr("Femmes", "Women") : tr("Hommes", "Men")}
    </span>
  );
}

function buildRegistryLookup(registry) {
  const byDocId = new Map();
  const byWaid = new Map();
  const byIdentityKey = new Map();

  registry.forEach((entry) => {
    if (!entry?._docId) return;
    byDocId.set(entry._docId, entry);

    if (entry.waid != null && entry.waid !== "") {
      byWaid.set(String(entry.waid), entry);
    }

    const identityKeys = Array.isArray(entry.identityKeys) && entry.identityKeys.length > 0
      ? entry.identityKeys
      : buildAthleteIdentityKeys(entry);

    identityKeys.forEach((key) => {
      if (key && !byIdentityKey.has(key)) {
        byIdentityKey.set(key, entry);
      }
    });
  });

  return { byDocId, byWaid, byIdentityKey };
}

function findRegistryEntryForAthlete(athlete, registryLookup) {
  if (!athlete || !registryLookup) return null;

  if (athlete.registryAthleteId && registryLookup.byDocId.has(athlete.registryAthleteId)) {
    return registryLookup.byDocId.get(athlete.registryAthleteId);
  }

  if (athlete.waid != null && athlete.waid !== "" && registryLookup.byWaid.has(String(athlete.waid))) {
    return registryLookup.byWaid.get(String(athlete.waid));
  }

  const identityKeys = buildAthleteIdentityKeys(athlete);
  for (const key of identityKeys) {
    if (registryLookup.byIdentityKey.has(key)) {
      return registryLookup.byIdentityKey.get(key);
    }
  }

  return null;
}

function buildCurrentAthletesByRegistryId(athletes, registryLookup) {
  const map = new Map();

  athletes.forEach((athlete) => {
    const registryEntry = findRegistryEntryForAthlete(athlete, registryLookup);
    if (!registryEntry?._docId) return;
    if (!map.has(registryEntry._docId)) {
      map.set(registryEntry._docId, []);
    }
    map.get(registryEntry._docId).push(athlete);
  });

  map.forEach((items) => {
    items.sort((a, b) =>
      String(a.event || "").localeCompare(String(b.event || ""))
      || String(a.lastName || "").localeCompare(String(b.lastName || ""))
      || String(a.firstName || "").localeCompare(String(b.firstName || "")),
    );
  });

  return map;
}

function formatAthleteStageLabel(entry) {
  const parts = [entry.round, entry.heat, entry.finalGroup]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function getAthleteDisplayBirth(primary) {
  if (primary?.birthDate) return primary.birthDate.slice(0, 10);
  const birthYear = resolveAthleteBirthYear(primary || {});
  return birthYear ? String(birthYear) : "—";
}

function getAthleteDisplayName(primary) {
  return [primary?.firstName, primary?.lastName].filter(Boolean).join(" ").trim() || "Athlète";
}

function getRegistryEntryDisciplines(entry) {
  return [...new Set(
    (Array.isArray(entry?.editions) ? entry.editions : [])
      .map((edition) => edition?.discipline)
      .filter(Boolean),
  )].sort((a, b) => String(a).localeCompare(String(b)));
}

// WAID typed or pasted as a World Athletics link (…/patrizia-van-der-weken-14621598).
function parseWaidInput(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;
  return extractWaid(text) || text.replace(/\D/g, "");
}

const WA_FIELD_LABELS = {
  lastName: ["Nom", "Last name"],
  firstName: ["Prénom", "First name"],
  nationality: ["Nationalité", "Nationality"],
  birthDate: ["Date de naissance", "Date of birth"],
  birthYear: ["Année de naissance", "Birth year"],
  gender: ["Genre", "Gender"],
  waUrl: ["Lien WA", "WA link"],
};

function AthleteProfilePanel({ Panel, registryEntry, currentAthletes = [], onClear, title, editable = false, registry = [], onMergeWith = null }) {
  const tr = useTr();
  const panelTitle = title || tr("Fiche athlète", "Athlete profile");
  const primary = registryEntry || currentAthletes[0] || null;
  if (!primary) return null;

  const historyRows = Array.isArray(registryEntry?.editions)
    ? [...registryEntry.editions].sort(
        (a, b) =>
          Number(b.year || 0) - Number(a.year || 0)
          || String(a.discipline || "").localeCompare(String(b.discipline || "")),
      )
    : [];

  const disciplines = [...new Set(historyRows.map((entry) => entry.discipline).filter(Boolean))];
  const years = [...new Set(historyRows.map((entry) => entry.year).filter(Boolean))].sort((a, b) => b - a);
  const currentBirthYear = resolveAthleteBirthYear(primary);
  const waUrl = primary.waUrl || registryEntry?.waUrl || currentAthletes[0]?.waUrl || null;
  const waid = primary.waid || registryEntry?.waid || currentAthletes[0]?.waid || null;
  const [isEditing, setIsEditing] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const { settings: portalSettings } = useAthletePortalSettings();
  const [waCandidates, setWaCandidates] = useState(null);
  const [waBusy, setWaBusy] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waChanges, setWaChanges] = useState([]);
  const [draft, setDraft] = useState({
    lastName: primary?.lastName || "",
    firstName: primary?.firstName || "",
    nationality: primary?.nationality || "",
    birthDate: primary?.birthDate ? String(primary.birthDate).slice(0, 10) : "",
    birthYear: resolveAthleteBirthYear(primary) || "",
    gender: primary?.gender || "",
    waid: primary?.waid != null ? String(primary.waid) : "",
    waUrl: primary?.waUrl || "",
  });

  useEffect(() => {
    setDraft({
      lastName: primary?.lastName || "",
      firstName: primary?.firstName || "",
      nationality: primary?.nationality || "",
      birthDate: primary?.birthDate ? String(primary.birthDate).slice(0, 10) : "",
      birthYear: resolveAthleteBirthYear(primary) || "",
      gender: primary?.gender || "",
      waid: primary?.waid != null ? String(primary.waid) : "",
      waUrl: primary?.waUrl || "",
    });
    setIsEditing(false);
    setSaveState("");
    setWaCandidates(null);
    setWaMessage("");
    setWaChanges([]);
  }, [
    primary?._docId,
    primary?.lastName,
    primary?.firstName,
    primary?.nationality,
    primary?.birthDate,
    primary?.birthYear,
    primary?.yob,
    primary?.gender,
    primary?.waid,
    primary?.waUrl,
  ]);

  // Same person already on another fiche of the database (same WAID).
  const duplicateEntry = draft.waid
    ? registry.find((entry) => entry._docId !== registryEntry?._docId && String(entry.waid || "") === String(draft.waid)) || null
    : null;

  // Candidates on World Athletics for the name of the fiche, same country first.
  async function handleFindWaCandidates() {
    const name = [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim();
    if (name.length < 3) {
      setWaMessage(tr("Il faut au moins un nom pour chercher sur World Athletics.", "A name is needed to search World Athletics."));
      return;
    }
    setWaBusy(tr("Recherche sur World Athletics…", "Searching World Athletics…"));
    setWaMessage("");
    try {
      const found = await searchWaAthletes(name);
      const nationality = String(draft.nationality || "").toUpperCase();
      setWaCandidates([...found].sort((a, b) => Number(b.country === nationality) - Number(a.country === nationality)));
      if (!found.length) setWaMessage(tr("Personne trouvé sur World Athletics avec ce nom : colle le WAID ou le lien WA.", "Nobody found on World Athletics with this name: paste the WAID or the WA link."));
    } catch (error) {
      setWaMessage(`${tr("World Athletics ne répond pas : ", "World Athletics is not responding: ")}${error.message}`);
    } finally {
      setWaBusy("");
    }
  }

  // Fills the fiche from the World Athletics profile; nothing is saved yet.
  async function handleFillFromWa(waidValue, candidate = null) {
    const waidToLoad = parseWaidInput(waidValue);
    if (!waidToLoad) {
      setWaMessage(tr("Colle le WAID ou le lien de la page World Athletics de l'athlète.", "Paste the WAID or the link to the athlete's World Athletics page."));
      return;
    }
    setWaBusy(tr("Lecture du profil World Athletics…", "Reading the World Athletics profile…"));
    setWaMessage("");
    try {
      const waData = await fetchAthleteFromWaService(waidToLoad, portalSettings || DEFAULT_PORTAL_SETTINGS);
      const identity = waData?._waIdentity || {};
      const waBirthDate = identity.birthDate ? String(identity.birthDate).slice(0, 10) : "";
      const next = {
        ...draft,
        waid: String(waidToLoad),
        lastName: identity.lastName || draft.lastName,
        firstName: identity.firstName || draft.firstName,
        nationality: identity.countryCode || draft.nationality,
        birthDate: waBirthDate || draft.birthDate,
        birthYear: waBirthDate ? waBirthDate.slice(0, 4) : draft.birthYear,
        gender: candidate?.sex ? (candidate.sex === "W" ? "F" : "M") : draft.gender,
        waUrl: identity.waUrl || `https://worldathletics.org/athletes/_/${waidToLoad}`,
      };
      setWaChanges(Object.keys(WA_FIELD_LABELS)
        .filter((field) => String(next[field] || "") !== String(draft[field] || ""))
        .map((field) => ({ field, before: draft[field] || "—", after: next[field] || "—" })));
      setDraft(next);
      setWaCandidates(null);
      setIsEditing(true);
    } catch (error) {
      setWaMessage(`${tr("World Athletics ne répond pas : ", "World Athletics is not responding: ")}${error.message}`);
    } finally {
      setWaBusy("");
    }
  }

  async function handleSaveProfile() {
    if (!registryEntry?._docId) return;
    setSaving(true);
    setSaveState("");
    try {
      const normalizedBirthYear = normalizeBirthYear(draft.birthYear);
      const normalizedBirthDate = String(draft.birthDate || "").trim() || null;
      const normalizedWaid = String(draft.waid || "").trim();
      const normalizedWaUrl = String(draft.waUrl || "").trim() || null;
      const identityKeys = buildAthleteIdentityKeys({
        lastName: draft.lastName,
        firstName: draft.firstName,
        nationality: draft.nationality,
        birthYear: normalizedBirthYear,
        birthDate: normalizedBirthDate,
      });

      const batch = writeBatch(db);
      batch.set(
        doc(db, ATHLETE_REGISTRY_COLLECTION, registryEntry._docId),
        {
          ...registryEntry,
          lastName: String(draft.lastName || "").trim(),
          firstName: String(draft.firstName || "").trim(),
          nationality: String(draft.nationality || "").trim(),
          birthDate: normalizedBirthDate,
          birthYear: normalizedBirthYear,
          yob: normalizedBirthYear,
          gender: String(draft.gender || "").trim() || null,
          waid: normalizedWaid ? Number(normalizedWaid) : null,
          waUrl: normalizedWaUrl,
          identityKeys,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      currentAthletes.forEach((athlete) => {
        batch.set(
          doc(db, ATHLETES_COLLECTION, athlete.id),
          {
            lastName: String(draft.lastName || "").trim() || athlete.lastName || "",
            firstName: String(draft.firstName || "").trim() || athlete.firstName || "",
            nationality: String(draft.nationality || "").trim() || athlete.nationality || "",
            birthDate: normalizedBirthDate,
            birthYear: normalizedBirthYear,
            gender: String(draft.gender || "").trim() || null,
            waid: normalizedWaid ? Number(normalizedWaid) : null,
            waUrl: normalizedWaUrl,
          },
          { merge: true },
        );
      });

      await batch.commit();
      setSaveState(tr("✅ Fiche athlète mise à jour.", "✅ Athlete profile updated."));
      setIsEditing(false);
      setWaChanges([]);
    } catch (error) {
      setSaveState(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={panelTitle}
      subtitle={tr(
        `${historyRows.length} résultat${historyRows.length > 1 ? "s" : ""} historique${historyRows.length > 1 ? "s" : ""} · ${currentAthletes.length} fiche${currentAthletes.length > 1 ? "s" : ""} édition courante`,
        `${historyRows.length} past result${historyRows.length > 1 ? "s" : ""} · ${currentAthletes.length} entr${currentAthletes.length > 1 ? "ies" : "y"} this edition`,
      )}
      actions={(
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {editable ? (
            isEditing ? (
              <>
                <button className="button button--ghost button--small" type="button" onClick={() => setIsEditing(false)} disabled={saving}>
                  {tr("Annuler", "Cancel")}
                </button>
                <button className="button button--secondary button--small" type="button" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
                </button>
              </>
            ) : (
              <>
                {!waid ? (
                  <button
                    className="button button--primary button--small"
                    type="button"
                    onClick={() => { setIsEditing(true); handleFindWaCandidates(); }}
                  >
                    {tr("Compléter avec World Athletics", "Complete from World Athletics")}
                  </button>
                ) : null}
                <button className="button button--secondary button--small" type="button" onClick={() => setIsEditing(true)}>
                  {tr("Modifier la fiche", "Edit profile")}
                </button>
              </>
            )
          ) : null}
          {onClear ? (
            <button className="button button--ghost button--small" type="button" onClick={onClear}>
              {tr("Fermer", "Close")}
            </button>
          ) : null}
        </div>
      )}
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {isEditing ? `${draft.firstName || ""} ${draft.lastName || ""}`.trim() || tr("Athlète", "Athlete") : getAthleteDisplayName(primary)}
            </div>
            <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginTop: "0.45rem" }}>
              <span className="status-pill">{isEditing ? (draft.nationality || "NAT ?") : (primary.nationality || "NAT ?")}</span>
              {(isEditing ? draft.gender : primary.gender) ? <GenderBadge gender={(isEditing ? draft.gender : primary.gender) === "F" ? "W" : (isEditing ? draft.gender : primary.gender)} /> : null}
              {(isEditing ? normalizeBirthYear(draft.birthYear) : currentBirthYear) ? <span className="status-pill">{isEditing ? normalizeBirthYear(draft.birthYear) : currentBirthYear}</span> : null}
              {(isEditing ? draft.waid : waid) ? <span className="status-pill status-pill--accent">WAID {isEditing ? draft.waid : waid}</span> : null}
            </div>
          </div>
          {(isEditing ? draft.waUrl : waUrl) ? (
            <a href={isEditing ? draft.waUrl : waUrl} target="_blank" rel="noopener noreferrer" className="button button--secondary button-link">
              {tr("Profil World Athletics", "World Athletics profile")}
            </a>
          ) : null}
        </div>

        {saveState ? <p className="panel-note" style={{ margin: 0 }}>{saveState}</p> : null}

        {isEditing ? (
          <div className="notice-card" style={{ padding: "0.9rem 1rem", display: "grid", gap: "0.6rem" }}>
            <strong>{tr("Identifiant World Athletics", "World Athletics ID")}</strong>
            <p className="panel-note" style={{ margin: 0 }}>
              {tr(
                "Le WAID fait de la fiche une seule personne : nom, nationalité et naissance viennent alors de World Athletics.",
                "The WAID ties the profile to one person: name, nationality and birth then come from World Athletics.",
              )}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={draft.waid}
                onChange={(event) => setDraft((current) => ({ ...current, waid: parseWaidInput(event.target.value) }))}
                placeholder={tr("WAID ou lien de la page WA", "WAID or WA page link")}
                style={{ flex: "1 1 220px" }}
              />
              <button className="button button--secondary button--small" type="button" disabled={Boolean(waBusy) || !draft.waid} onClick={() => handleFillFromWa(draft.waid)}>
                {tr("Remplir depuis World Athletics", "Fill from World Athletics")}
              </button>
              <button className="button button--ghost button--small" type="button" disabled={Boolean(waBusy)} onClick={handleFindWaCandidates}>
                {tr("Chercher sur World Athletics", "Search World Athletics")}
              </button>
            </div>
            {waBusy || waMessage ? <p className="panel-note" style={{ margin: 0 }}>{waBusy || waMessage}</p> : null}
            {waCandidates?.length ? (
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <span className="panel-note" style={{ margin: 0 }}>{tr("Clique sur la bonne personne (vérifie le pays et l'année) :", "Click the right person (check the country and year):")}</span>
                {waCandidates.map((candidate) => (
                  <button
                    key={candidate.waid}
                    type="button"
                    className="button button--ghost button--small"
                    style={{ justifyContent: "flex-start", textAlign: "left" }}
                    onClick={() => handleFillFromWa(candidate.waid, candidate)}
                  >
                    {candidate.firstName} {candidate.lastName} · {candidate.country || "?"} · {candidate.birthYear || tr("année ?", "year?")} · WAID {candidate.waid}
                  </button>
                ))}
              </div>
            ) : null}
            {waChanges.length ? (
              <div className="panel-note" style={{ margin: 0 }}>
                <strong>{tr("Rempli depuis World Athletics (pas encore enregistré) :", "Filled from World Athletics (not saved yet):")}</strong>
                <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                  {waChanges.map((change) => (
                    <li key={change.field}>{tr(...WA_FIELD_LABELS[change.field])} : {String(change.before)} → <strong>{String(change.after)}</strong></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {duplicateEntry ? (
              <div className="notice-card notice-card--warn" style={{ padding: "0.7rem 0.9rem", display: "grid", gap: "0.45rem" }}>
                <span>
                  {tr("Ce WAID est déjà sur la fiche", "This WAID is already on the profile")} <strong>{getAthleteDisplayName(duplicateEntry)}</strong>
                  {" "}({duplicateEntry.nationality || "?"}, {tr("éditions", "editions")} {[...new Set((duplicateEntry.editions || []).map((edition) => edition.year))].sort().join(", ") || tr("aucune", "none")}).
                  {" "}{tr("C'est la même personne : fusionne les deux fiches pour réunir leur historique.", "It is the same person: merge the two profiles to combine their history.")}
                </span>
                {onMergeWith ? (
                  <div>
                    <button className="button button--secondary button--small" type="button" onClick={() => onMergeWith(duplicateEntry)}>
                      {tr("Fusionner les deux fiches", "Merge the two profiles")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {isEditing ? (
          <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label className="field">
              <span>{tr("Nom", "Last name")}</span>
              <input value={draft.lastName} onChange={(event) => setDraft((current) => ({ ...current, lastName: event.target.value }))} />
            </label>
            <label className="field">
              <span>{tr("Prénom", "First name")}</span>
              <input value={draft.firstName} onChange={(event) => setDraft((current) => ({ ...current, firstName: event.target.value }))} />
            </label>
            <label className="field">
              <span>{tr("Nationalité", "Nationality")}</span>
              <input value={draft.nationality} onChange={(event) => setDraft((current) => ({ ...current, nationality: event.target.value.toUpperCase() }))} maxLength={3} />
            </label>
            <label className="field">
              <span>{tr("Date de naissance", "Date of birth")}</span>
              <input type="date" value={draft.birthDate} onChange={(event) => setDraft((current) => ({ ...current, birthDate: event.target.value }))} />
            </label>
            <label className="field">
              <span>{tr("Année de naissance", "Birth year")}</span>
              <input value={draft.birthYear} onChange={(event) => setDraft((current) => ({ ...current, birthYear: event.target.value }))} inputMode="numeric" />
            </label>
            <label className="field">
              <span>{tr("Genre", "Gender")}</span>
              <select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value }))}>
                <option value="">—</option>
                <option value="M">{tr("Hommes", "Men")}</option>
                <option value="F">{tr("Femmes", "Women")}</option>
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>{tr("Lien WA", "WA link")}</span>
              <input value={draft.waUrl} onChange={(event) => setDraft((current) => ({ ...current, waUrl: event.target.value }))} />
            </label>
          </div>
        ) : null}

        <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>{tr("Naissance", "Birth")}</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{getAthleteDisplayBirth(primary)}</p>
          </div>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>{tr("Éditions", "Editions")}</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{years.length > 0 ? years.join(", ") : tr("Aucune", "None")}</p>
          </div>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>Disciplines</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{disciplines.length > 0 ? disciplines.join(", ") : tr("Aucune", "None")}</p>
          </div>
        </div>

        <div>
          <h4 style={{ margin: "0 0 0.65rem 0" }}>{tr("Édition en cours", "Current edition")}</h4>
          {currentAthletes.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              {tr("Cet athlète n'est pas lié aux engagés de l'édition en cours.", "This athlete is not linked to the current edition's entries.")}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th>{tr("Statut", "Status")}</th>
                    <th>{tr("Série", "Heat")}</th>
                    <th>{tr("Couloir", "Lane")}</th>
                    <th>{tr("Voyage", "Travel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAthletes.map((athlete) => (
                    <tr key={athlete.id}>
                      <td>{athlete.event || "—"}</td>
                      <td>{athlete.status ? <StatusBadge status={athlete.status} /> : "—"}</td>
                      <td>{athlete.heat || "—"}</td>
                      <td>{athlete.lane || "—"}</td>
                      <td>
                        {athlete.arrival || athlete.departure
                          ? [athlete.arrival, athlete.departure].filter(Boolean).join(" / ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h4 style={{ margin: "0 0 0.65rem 0" }}>{tr("Historique meeting", "Meeting history")}</h4>
          {historyRows.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              {tr("Aucun résultat historique encore lié à cette fiche.", "No past result linked to this profile yet.")}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tr("Année", "Year")}</th>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th>{tr("Tour", "Round")}</th>
                    <th>RK</th>
                    <th>{tr("Résultat", "Result")}</th>
                    <th>{tr("Statut", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((entry, index) => (
                    <tr key={`${entry.year}-${entry.discipline}-${index}`}>
                      <td>{entry.year || "—"}</td>
                      <td>{entry.discipline || "—"}</td>
                      <td>{formatAthleteStageLabel(entry)}</td>
                      <td>{entry.rank ?? "—"}</td>
                      <td>{entry.result || "—"}</td>
                      <td>{entry.status || "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function normalizeDuplicateToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizePhoneticDuplicateToken(value) {
  return normalizeDuplicateToken(value)
    .replace(/sch/g, "s")
    .replace(/sh/g, "s")
    .replace(/ch/g, "s")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/cq/g, "k")
    .replace(/qu/g, "k")
    .replace(/q/g, "k")
    .replace(/ou/g, "u")
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1");
}

function levenshteinDistance(a, b) {
  const left = normalizeDuplicateToken(a);
  const right = normalizeDuplicateToken(b);
  if (!left || !right) return left === right ? 0 : 99;
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 3) return 99;

  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) dp[i][0] = i;
  for (let j = 0; j <= right.length; j++) dp[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[left.length][right.length];
}

function areCloseDuplicateTokens(a, b) {
  const left = normalizeDuplicateToken(a);
  const right = normalizeDuplicateToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.startsWith(right) || right.startsWith(left)) {
    return Math.abs(left.length - right.length) <= 2;
  }
  return levenshteinDistance(left, right) <= 2;
}

function arePhoneticDuplicateTokens(a, b) {
  const left = normalizePhoneticDuplicateToken(a);
  const right = normalizePhoneticDuplicateToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length <= 2 || right.length <= 2) return false;
  return levenshteinDistance(left, right) <= 1;
}

function areVariantDuplicateTokens(a, b) {
  return areCloseDuplicateTokens(a, b) || arePhoneticDuplicateTokens(a, b);
}

function getRegistryEntryYear(entry) {
  return resolveAthleteBirthYear(entry || {});
}

function getRegistryEntryEditionYears(entry) {
  return new Set(
    (Array.isArray(entry?.editions) ? entry.editions : [])
      .map((edition) => edition?.year)
      .filter(Boolean)
      .map((year) => Number(year)),
  );
}

function getRegistryEntryDisciplineKeys(entry) {
  return new Set(getRegistryEntryDisciplines(entry).map((discipline) => normalizeDuplicateToken(discipline)));
}

function setsIntersect(left, right) {
  if (!left?.size || !right?.size) return false;
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function haveSharedRegistryYear(a, b) {
  return setsIntersect(getRegistryEntryEditionYears(a), getRegistryEntryEditionYears(b));
}

function haveSharedRegistryDiscipline(a, b) {
  return setsIntersect(getRegistryEntryDisciplineKeys(a), getRegistryEntryDisciplineKeys(b));
}

function haveCompatibleRegistryNationality(a, b) {
  if (!a?.nationality || !b?.nationality) return true;
  return a.nationality === b.nationality;
}

function getRegistryEntryScore(entry, currentAthletesByRegistryId) {
  const editions = Array.isArray(entry?.editions) ? entry.editions.length : 0;
  const linkedCurrent = entry?._docId ? (currentAthletesByRegistryId.get(entry._docId)?.length || 0) : 0;
  return (
    (entry?.waid ? 100 : 0)
    + (entry?.waUrl ? 20 : 0)
    + (entry?.birthDate ? 12 : 0)
    + (getRegistryEntryYear(entry) ? 8 : 0)
    + editions * 2
    + linkedCurrent * 3
  );
}

function compareRegistryPrimaryCandidates(a, b, currentAthletesByRegistryId) {
  const scoreDiff = getRegistryEntryScore(b, currentAthletesByRegistryId) - getRegistryEntryScore(a, currentAthletesByRegistryId);
  if (scoreDiff !== 0) return scoreDiff;
  const editionsDiff = (Array.isArray(b?.editions) ? b.editions.length : 0) - (Array.isArray(a?.editions) ? a.editions.length : 0);
  if (editionsDiff !== 0) return editionsDiff;
  return String(a?._docId || "").localeCompare(String(b?._docId || ""));
}

function getDuplicateMatchReason(a, b) {
  if (!a || !b || a._docId === b._docId) return null;

  const waidA = a.waid != null ? String(a.waid) : "";
  const waidB = b.waid != null ? String(b.waid) : "";
  if (waidA && waidB && waidA === waidB) {
    return "Même WAID";
  }

  const waUrlA = String(a.waUrl || "").trim();
  const waUrlB = String(b.waUrl || "").trim();
  if (waUrlA && waUrlB && waUrlA === waUrlB) {
    return "Même profil WA";
  }

  const birthA = getRegistryEntryYear(a);
  const birthB = getRegistryEntryYear(b);
  const lastA = normalizeDuplicateToken(a.lastName);
  const lastB = normalizeDuplicateToken(b.lastName);
  const firstA = normalizeDuplicateToken(a.firstName);
  const firstB = normalizeDuplicateToken(b.firstName);
  const sameBirthYear = birthA && birthB && birthA === birthB;
  const sameNationality = haveCompatibleRegistryNationality(a, b);
  const sharedYear = haveSharedRegistryYear(a, b);
  const sharedDiscipline = haveSharedRegistryDiscipline(a, b);
  const sameLast = Boolean(lastA && lastA === lastB);
  const sameFirst = Boolean(firstA && firstA === firstB);
  const closeLast = areVariantDuplicateTokens(lastA, lastB);
  const closeFirst = areVariantDuplicateTokens(firstA, firstB);

  // Two known, different birth years = homonyms, not duplicates.
  if (birthA && birthB && birthA !== birthB) return null;

  if (sameLast && sameFirst) {
    return a.nationality !== b.nationality ? "Même nom, nationalités différentes" : "Même nom";
  }

  if (sameLast && closeFirst && (sameNationality || sameBirthYear || sharedDiscipline || sharedYear)) {
    return sameBirthYear
      ? "Même nom, prénom variante, même année"
      : "Même nom, prénom variante";
  }

  if (sameFirst && closeLast && (sameNationality || sameBirthYear || sharedDiscipline || sharedYear)) {
    return sameBirthYear
      ? "Même prénom, nom variante, même année"
      : "Même prénom, nom variante";
  }

  if (closeLast && closeFirst && (sameBirthYear || (sameNationality && (sharedDiscipline || sharedYear)))) {
    return sameBirthYear
      ? "Nom complet proche, même année"
      : "Nom complet proche";
  }

  if (sameBirthYear) {
    if (sameLast && closeFirst) {
      return "Même année de naissance, prénom proche";
    }
    if (sameFirst && closeLast) {
      return "Même année de naissance, nom proche";
    }
    if (closeLast && closeFirst) {
      return "Même année de naissance, nom complet proche";
    }
  }

  return null;
}

function buildDuplicateRegistryGroups(registry, currentAthletesByRegistryId) {
  const adjacency = new Map();
  const reasonsByEdge = new Map();

  registry.forEach((entry) => adjacency.set(entry._docId, new Set()));

  // Only pairs that can match at all get the full (slow) rule.
  findDuplicateCandidatePairs(registry).forEach(([left, right]) => {
    const reason = getDuplicateMatchReason(left, right);
    if (!reason) return;
    adjacency.get(left._docId)?.add(right._docId);
    adjacency.get(right._docId)?.add(left._docId);
    reasonsByEdge.set(`${left._docId}__${right._docId}`, reason);
    reasonsByEdge.set(`${right._docId}__${left._docId}`, reason);
  });
  const registryById = new Map(registry.map((entry) => [entry._docId, entry]));

  const visited = new Set();
  const groups = [];
  registry.forEach((entry) => {
    if (visited.has(entry._docId)) return;
    const neighbors = adjacency.get(entry._docId);
    if (!neighbors || neighbors.size === 0) return;

    const stack = [entry._docId];
    const componentIds = [];
    visited.add(entry._docId);

    while (stack.length > 0) {
      const currentId = stack.pop();
      componentIds.push(currentId);
      adjacency.get(currentId)?.forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        stack.push(nextId);
      });
    }

    const entries = componentIds
      .map((docId) => registryById.get(docId))
      .filter(Boolean)
      .sort((a, b) => compareRegistryPrimaryCandidates(a, b, currentAthletesByRegistryId));

    if (entries.length < 2) return;

    const primary = entries[0];
    const reasons = [...new Set(
      entries.slice(1)
        .map((candidate) => reasonsByEdge.get(`${primary._docId}__${candidate._docId}`))
        .filter(Boolean),
    )];

    groups.push({
      id: entries.map((candidate) => candidate._docId).join("__"),
      entries,
      primary,
      reasons,
      hasNationalityConflict: new Set(entries.map((candidate) => candidate.nationality).filter(Boolean)).size > 1,
    });
  });

  return groups.sort((a, b) => b.entries.length - a.entries.length || a.primary.lastName.localeCompare(b.primary.lastName));
}

function pickMostFrequentValue(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    const key = String(value).trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

// Duplicate reasons stay in French (used as keys); English label at render.
const DUPLICATE_REASONS_EN = {
  "Même WAID": "Same WAID",
  "Même profil WA": "Same WA profile",
  "Même nom, nationalités différentes": "Same name, different nationalities",
  "Même nom": "Same name",
  "Même nom, prénom variante, même année": "Same last name, first name variant, same year",
  "Même nom, prénom variante": "Same last name, first name variant",
  "Même prénom, nom variante, même année": "Same first name, last name variant, same year",
  "Même prénom, nom variante": "Same first name, last name variant",
  "Nom complet proche, même année": "Similar full name, same year",
  "Nom complet proche": "Similar full name",
  "Même année de naissance, prénom proche": "Same birth year, similar first name",
  "Même année de naissance, nom proche": "Same birth year, similar last name",
  "Même année de naissance, nom complet proche": "Same birth year, similar full name",
  "Fusion manuelle": "Manual merge",
};

function duplicateReasonLabel(reason, tr) {
  return tr(reason, DUPLICATE_REASONS_EN[reason] || reason);
}

const DUPLICATE_MERGE_FIELDS = [
  { key: "lastName", label: "Nom", labelEn: "Last name" },
  { key: "firstName", label: "Prénom", labelEn: "First name" },
  { key: "nationality", label: "Nationalité", labelEn: "Nationality" },
  { key: "birthDate", label: "Date de naissance", labelEn: "Date of birth" },
  { key: "birthYear", label: "Année de naissance", labelEn: "Year of birth" },
  { key: "gender", label: "Genre", labelEn: "Gender" },
  { key: "waid", label: "WAID", labelEn: "WAID" },
  { key: "waUrl", label: "Lien WA", labelEn: "WA link" },
];

function getDuplicateEntryFieldValue(entry, field) {
  if (!entry) return "";
  if (field === "birthYear") return resolveAthleteBirthYear(entry) || "";
  return entry[field] ?? "";
}

function getDuplicateEntryLabel(entry, tr) {
  const name = [entry?.firstName, entry?.lastName].filter(Boolean).join(" ").trim() || entry?._docId || tr("Fiche", "Profile");
  const nat = entry?.nationality ? ` · ${entry.nationality}` : "";
  const yob = resolveAthleteBirthYear(entry) ? ` · ${resolveAthleteBirthYear(entry)}` : "";
  return `${name}${nat}${yob}`;
}

function formatDuplicateFieldValue(value, field) {
  if (value == null || value === "") return "—";
  if (field === "waUrl") return String(value);
  return String(value);
}

function mergeRegistryEditions(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const editions = Array.isArray(entry?.editions) ? entry.editions : [];
    editions.forEach((edition, index) => {
      const key = [
        edition.year,
        edition.discipline,
        edition.round,
        edition.heat,
        edition.finalGroup,
        edition.rank,
        edition.result,
        edition.status,
        index,
      ].join("|");
      if (!map.has(key)) {
        map.set(key, edition);
      }
    });
  });

  return [...map.values()].sort(
    (a, b) =>
      Number(a.year || 0) - Number(b.year || 0)
      || String(a.discipline || "").localeCompare(String(b.discipline || "")),
  );
}

// ─── Athletes list page ───────────────────────────────────────────────────────

// Global input/select styling defaults to width:100% + large rounded corners
// for full-width form fields — override both for a compact inline filter bar.
// Right-aligned, tabular figures in the dense athletes table.
const NUMERIC_ATHLETE_FIELDS = new Set(["birthYear", "worldRanking", "heat", "lane", "waid"]);

const FILTER_CONTROL_STYLE = { width: "auto", fontSize: "0.82rem", padding: "0.4rem 0.6rem", borderRadius: 6 };

const ATHLETES_HIDDEN_COLS_STORAGE_KEY = "myclim-athletes-hidden-cols";

// Columns hidden by default the first time someone opens this page — mostly
// duplicates of a column shown elsewhere (Excel PB/SB once WA sync has taken
// over as the reliable source, or the granular arrival/departure sub-fields
// which the "Arrival"/"Departure" column already renders in one readable
// cell via TravelCell). Still reachable any time from "Colonnes".
const DEFAULT_HIDDEN_ATHLETE_COLUMNS = [
  "pb", "pbIndoor", "pbOutdoor", "sb",
  "waUrl", "worldRanking",
  "arrivalDay", "arrivalTime", "arrivalFlight", "arrivalFrom",
  "departureDay", "departureTime", "departureFlight", "departureTo",
];

function loadHiddenAthleteColumns() {
  try {
    const raw = window.localStorage.getItem(ATHLETES_HIDDEN_COLS_STORAGE_KEY);
    if (raw === null) return new Set(DEFAULT_HIDDEN_ATHLETE_COLUMNS);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(DEFAULT_HIDDEN_ATHLETE_COLUMNS);
  }
}

function saveHiddenAthleteColumns(hiddenCols) {
  try {
    window.localStorage.setItem(ATHLETES_HIDDEN_COLS_STORAGE_KEY, JSON.stringify([...hiddenCols]));
  } catch {
    // Best-effort only (private browsing, storage disabled, etc.)
  }
}

function AthletesListPage({ Panel }) {
  const tr = useTr();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { activeEditionId } = useActiveEdition();
  const canViewUnifiedProfile = roles.includes("admin") || roles.includes("meeting_director");
  const [pageTab, setPageTab] = useState("athletes");
  // Admins/meeting directors can switch to "test" to inspect a rehearsal
  // import without it ever mixing into the real roster (e-magazine, transport
  // and everyone else always see the current edition only).
  // Follows the active edition until the user picks another one (useActiveEdition
  // starts on "test" while it loads, which used to stick).
  const [pickedViewEditionId, setViewEditionId] = useState("");
  const viewEditionId = pickedViewEditionId || activeEditionId;
  const { athletes, loading: athletesLoading } = useAthletes(!settingsLoading, viewEditionId);
  const { people: accompanyingPersons } = useAccompanyingPersons(canViewUnifiedProfile, viewEditionId);
  const staffByRole = useMemo(() => {
    const counts = {};
    accompanyingPersons.forEach((p) => {
      const role = p.staffRole || "Autre";
      counts[role] = (counts[role] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [accompanyingPersons]);
  // Travel entries only carry a bare day-of-month ("17. flight…") — resolved
  // against the meeting's actual month/year so it reads as a real date.
  const { editions: meetingEditions } = useMeetingEditions();
  const meetingReferenceDate = meetingEditions.find((e) => String(e.year) === String(activeEditionId))?.date;
  const { registry, loading: registryLoading } = useAthleteRegistry(canViewUnifiedProfile);
  const visibleFields = useMemo(() => getVisibleFields(roles, settings), [roles, settings]);
  const canEdit = roles.includes("admin") || roles.includes("meeting_director");
  const seasons = settings?.seasons ?? DEFAULT_PORTAL_SETTINGS.seasons;

  // ── Filter state ────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState("");
  const [filterEvent,  setFilterEvent]  = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterNat,    setFilterNat]    = useState("");
  const [filterHeat,   setFilterHeat]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterWa,     setFilterWa]     = useState("");
  const [groupByEvent, setGroupByEvent] = useState(true);
  // Column visibility — keys in this set are hidden (lastName + firstName always visible).
  // Persisted per-browser so a curated view survives reloads.
  const [hiddenCols, setHiddenColsState] = useState(loadHiddenAthleteColumns);
  function setHiddenCols(updater) {
    setHiddenColsState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      saveHiddenAthleteColumns(next);
      return next;
    });
  }
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef(null);
  const tableRef = useRef(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [expandedEventGroups, setExpandedEventGroups] = useState(new Set());

  async function handleFixEvent(athleteId, newEvent) {
    await updateDoc(doc(db, ATHLETES_COLLECTION, athleteId), { event: newEvent });
  }

  // Athletes are otherwise never deleted (see mergeAthletes) — this is
  // specifically for the "à vérifier" panel, where a row can be a genuine
  // parsing artifact (a repeated header row imported as an "athlete", a
  // corrupted cell) rather than a real person who happens to need review.
  async function handleDeleteAthlete(athleteId) {
    await deleteDoc(doc(db, ATHLETES_COLLECTION, athleteId));
  }

  async function handleDeleteAccompanying(personId) {
    await deleteDoc(doc(db, ATHLETE_ACCOMPANYING_COLLECTION, personId));
  }

  // One person, genuinely entered in more than one discipline ("60m W und
  // 60mH") — a single `event` field can't represent that, so this athlete's
  // own doc keeps the first discipline and a fresh doc is created per
  // additional one, copying identity/status/travel and WAID/registry link
  // (those identify the PERSON, not the discipline, so the new entry can
  // still be WA-synced right away) but not heat/lane/PB/SB, which genuinely
  // are per-discipline and unknown for the new entry until synced.
  async function handleSplitEvent(athlete, disciplines, gender) {
    const suffix = gender ? ` ${gender}` : "";
    await updateDoc(doc(db, ATHLETES_COLLECTION, athlete.id), { event: `${disciplines[0]}${suffix}` });
    for (const discipline of disciplines.slice(1)) {
      const newId = `athlete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, ATHLETES_COLLECTION, newId), {
        lastName: athlete.lastName,
        firstName: athlete.firstName,
        nationality: athlete.nationality || null,
        birthYear: athlete.birthYear || null,
        status: athlete.status || null,
        manager: athlete.manager || null,
        hotel: athlete.hotel || null,
        arrival: athlete.arrival || null,
        departure: athlete.departure || null,
        editionId: athlete.editionId || null,
        event: `${discipline}${suffix}`,
        heat: null,
        lane: null,
        waid: athlete.waid || null,
        waUrl: athlete.waUrl || null,
        registryAthleteId: athlete.registryAthleteId || null,
        importedAt: serverTimestamp(),
        importSource: athlete.importSource || null,
        splitFromAthleteId: athlete.id,
      });
    }
  }

  // Close column picker when clicking outside it
  useLayoutEffect(() => {
    if (!colPickerOpen) return;
    function handleClick(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [colPickerOpen]);
  const [syncingAll,      setSyncingAll]      = useState(false);
  const [syncAllStatus,   setSyncAllStatus]   = useState("");
  const [syncAllFailures, setSyncAllFailures] = useState([]); // [{ name, waid, error }]
  const [linkingRegistry, setLinkingRegistry] = useState(false);
  const [linkRegistryStatus, setLinkRegistryStatus] = useState("");

  // ── Augment each athlete with parsed + standardized event fields ────────────
  const athletesParsed = useMemo(
    () => athletes.map((a) => {
      const _ev = parseEventField(a.event);
      const _std = normalizeDisciplineLabel(_ev.discipline);
      return { ...a, _ev, _std };
    }),
    [athletes],
  );

  // ── Build dropdown option lists ─────────────────────────────────────────────
  const filterOptions = useMemo(() => {
    const disciplines = new Set();
    const nats  = new Set();
    const heats = new Set();
    athletesParsed.forEach((a) => {
      if (a._std.label) disciplines.add(a._std.label);
      if (a.nationality) nats.add(String(a.nationality).trim());
      if (a.heat)        heats.add(String(a.heat).trim());
    });
    return {
      disciplines: [...disciplines].sort((a, b) => disciplineRank(a) - disciplineRank(b) || a.localeCompare(b)),
      nats:  [...nats].sort(),
      heats: [...heats].sort((a, b) => {
        const na = parseInt(a, 10); const nb = parseInt(b, 10);
        return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
      }),
    };
  }, [athletesParsed]);

  // ── Apply all filters ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return athletesParsed.filter((a) => {
      if (filterEvent  && a._std.label !== filterEvent)                   return false;
      if (filterGender && a._ev.gender     !== filterGender)              return false;
      if (filterNat    && String(a.nationality || "").trim() !== filterNat) return false;
      if (filterHeat   && String(a.heat    || "").trim() !== filterHeat)  return false;
      if (filterStatus && a.status !== filterStatus)                      return false;
      if (filterWa === "synced"   && !a.waFetchedAt) return false;
      if (filterWa === "has_waid" && !a.waid)        return false;
      if (filterWa === "no_waid"  &&  a.waid)        return false;
      if (q) {
        const hay = [a.lastName, a.firstName, a.nationality, a.waid]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [athletesParsed, search, filterEvent, filterGender, filterNat, filterHeat, filterStatus, filterWa]);

  // ── Group athletes by standardized discipline+gender, not the raw event
  // string, so formatting noise ("60m W" vs "60m w " vs "60m W pace") doesn't
  // fragment the same event into several groups.
  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((a) => {
      // A pacer note ("1500m M pace") has its gender embedded past "pace",
      // out of reach of parseEventField's end-anchored suffix match — use the
      // one normalizeDisciplineLabel recovered so pacers land in the actual
      // gendered group they're pacing, not a separate ungendered bucket.
      const key = [a._std.label, a._ev.gender || a._std.gender].filter(Boolean).join(" ") || "(sans épreuve)";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });
    map.forEach((grp) => {
      grp.sort((a, b) => {
        const oa = a.status === "out" ? 1 : 0; const ob = b.status === "out" ? 1 : 0;
        if (oa !== ob) return oa - ob;
        const ha = parseInt(a.heat, 10) || 999; const hb = parseInt(b.heat, 10) || 999;
        if (ha !== hb) return ha - hb;
        const la = parseInt(a.lane, 10) || 999; const lb = parseInt(b.lane, 10) || 999;
        if (la !== lb) return la - lb;
        return String(a.lastName || "").localeCompare(String(b.lastName || ""));
      });
    });
    return [...map.entries()].sort(compareEventGroups);
  }, [filtered]);

  const registryLookup = useMemo(
    () => buildRegistryLookup(registry),
    [registry],
  );

  const currentAthletesByRegistryId = useMemo(
    () => buildCurrentAthletesByRegistryId(athletes, registryLookup),
    [athletes, registryLookup],
  );

  const selectedCurrentAthlete = useMemo(
    () => athletes.find((athlete) => athlete.id === selectedAthleteId) || null,
    [athletes, selectedAthleteId],
  );

  const selectedRegistryEntry = useMemo(
    () => findRegistryEntryForAthlete(selectedCurrentAthlete, registryLookup),
    [selectedCurrentAthlete, registryLookup],
  );

  const selectedCurrentAthletes = useMemo(() => {
    if (!selectedCurrentAthlete) return [];
    if (selectedRegistryEntry?._docId) {
      return currentAthletesByRegistryId.get(selectedRegistryEntry._docId) || [selectedCurrentAthlete];
    }
    return [selectedCurrentAthlete];
  }, [selectedCurrentAthlete, selectedRegistryEntry, currentAthletesByRegistryId]);

  // ── Column config ───────────────────────────────────────────────────────────
  // In grouped view, drop "event" (shown in section header instead)
  // tableFields = all fields the user is allowed to see (before the hide toggle)
  const tableFields = useMemo(
    () => (groupByEvent ? visibleFields.filter((f) => f.key !== "event") : visibleFields),
    [visibleFields, groupByEvent],
  );

  // displayedFields = tableFields minus any the user has hidden via the column picker
  // lastName and firstName are always shown (they are the frozen/sticky columns)
  const displayedFields = useMemo(
    () => tableFields.filter((f) => !hiddenCols.has(f.key)),
    [tableFields, hiddenCols],
  );

  // Columns the user can toggle in the picker (all except the frozen identity cols)
  const toggleableCols = useMemo(
    () => tableFields.filter((f) => f.key !== "lastName" && f.key !== "firstName"),
    [tableFields],
  );

  const colCount =
    displayedFields.length
    + (canViewUnifiedProfile ? 1 : 0)
    + (canEdit && !displayedFields.find((f) => f.key === "waid") ? 1 : 0)
    + (canEdit ? 1 : 0);

  // ── Sticky column left-offset computation ────────────────────────────────────
  // Run after every render that could change column layout.
  // Measures each `data-sticky-col` <th> width and sets the `left` CSS property
  // on both the <th> and every <td> in that column so they freeze correctly.
  // Re-measured whenever a frozen header cell changes width (web font loaded,
  // data arriving, columns shown/hidden): a stale offset left a thin gap
  // between "Reg." and "Nom" where the scrolled content showed through.
  // Widths are floored so each frozen cell overlaps the previous one by a sub-pixel
  // instead of leaving a hairline gap.
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    const theadRow = table.querySelector("thead tr");
    if (!theadRow) return undefined;

    function applyStickyOffsets() {
      const ths = [...theadRow.children];
      let left = 0;
      ths.forEach((th, colIdx) => {
        if (!th.dataset.stickyCol) return;
        const offset = `${left}px`;
        th.style.left = offset;
        table.querySelectorAll("tbody tr").forEach((row) => {
          const cell = row.children[colIdx];
          if (cell && cell.classList.contains("col-sticky")) cell.style.left = offset;
        });
        left += Math.floor(th.getBoundingClientRect().width);
      });
    }

    applyStickyOffsets();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => applyStickyOffsets());
    [...theadRow.children].filter((th) => th.dataset.stickyCol).forEach((th) => observer.observe(th));
    return () => observer.disconnect();
  });

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleSaveWaid(athleteId, waid) {
    const athlete = athletes.find((item) => item.id === athleteId);
    await updateDoc(doc(db, ATHLETES_COLLECTION, athleteId), { waid });
    if (athlete) {
      await ensureCurrentAthleteRegistryLink(athleteId, { ...athlete, waid });
    }
  }

  async function handleSyncAll() {
    const withWaid = athletes.filter((a) => a.waid);
    if (!withWaid.length) { setSyncAllStatus(tr("Aucun athlète avec un WAID à synchroniser.", "No athlete with a WAID to sync.")); return; }
    setSyncingAll(true);
    setSyncAllStatus(tr(`Synchronisation de ${withWaid.length} athlètes…`, `Syncing ${withWaid.length} athletes…`));
    let ok = 0;
    const failures = [];
    setSyncAllFailures([]);
    for (const athlete of withWaid) {
      try {
        const waData = await fetchAthleteFromWaService(athlete.waid, settings, athlete.event);
        const { _waIdentity, ...firestoreData } = waData;
        let registryAthleteId = athlete.registryAthleteId || null;
        if (_waIdentity) {
          try {
            const registryResult = await upsertAthleteRegistry({
              ..._waIdentity,
              nationality: athlete.nationality,
              birthYear:   athlete.birthYear,
            });
            registryAthleteId = registryResult?.docId || registryAthleteId;
          } catch (registryError) {
            console.error("Unable to update the athlete registry", registryError);
          }
        }
        await updateDoc(doc(db, ATHLETES_COLLECTION, athlete.id), {
          ...firestoreData,
          ...(registryAthleteId ? { registryAthleteId } : {}),
        });
        ok++;
      } catch (err) {
        failures.push({
          name: [athlete.firstName, athlete.lastName].filter(Boolean).join(" "),
          waid: athlete.waid,
          error: err.message,
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setSyncAllStatus(tr(`Terminé : ${ok} mis à jour, ${failures.length} en erreur.`, `Done: ${ok} updated, ${failures.length} failed.`));
    setSyncAllFailures(failures);
    setSyncingAll(false);
  }

  async function handleLinkAllToRegistry() {
    const candidates = athletes.filter((athlete) => athlete.lastName || athlete.firstName);
    if (!candidates.length) {
      setLinkRegistryStatus(tr("Aucun athlète à lier.", "No athlete to link."));
      return;
    }

    setLinkingRegistry(true);
    setLinkRegistryStatus(tr(`Liaison de ${candidates.length} athlètes en cours…`, `Linking ${candidates.length} athletes…`));

    let linked = 0;
    let failed = 0;
    for (const athlete of candidates) {
      try {
        await ensureCurrentAthleteRegistryLink(athlete.id, athlete);
        linked++;
      } catch {
        failed++;
      }
    }

    setLinkRegistryStatus(tr(`Liaison terminée : ${linked} liés, ${failed} en erreur.`, `Linking done: ${linked} linked, ${failed} failed.`));
    setLinkingRegistry(false);
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (settingsLoading || athletesLoading) {
    return <div className="page"><section className="page-header"><div><h1>{tr("Athlètes", "Athletes")}</h1></div></section><p className="panel-note">{tr("Chargement…", "Loading…")}</p></div>;
  }
  if (visibleFields.length === 0) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>{tr("Athlètes", "Athletes")}</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>{tr("Accès restreint", "Restricted access")}</strong>
          <p>{tr("Pas d'accès aux données athlètes. Contacte un administrateur.", "No access to athlete data. Contact an administrator.")}</p>
        </div>
      </div>
    );
  }

  // ── Cell renderer ────────────────────────────────────────────────────────────
  function renderCell(f, a) {
    if ((f.key === "lastName" || f.key === "firstName") && canViewUnifiedProfile) {
      return (
        <button
          type="button"
          onClick={() => setSelectedAthleteId(a.id)}
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            color: selectedAthleteId === a.id ? "#1d4ed8" : "inherit",
            font: "inherit",
            textAlign: "left",
          }}
          title={tr("Ouvrir la fiche athlète", "Open the athlete profile")}
        >
          {a[f.key] ?? "—"}
        </button>
      );
    }
    if (f.key === "waid" && canEdit) return <WaidCell athlete={a} onSave={handleSaveWaid} />;
    if (f.key === "status") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <StatusBadge status={a.status} />
          {a._std?.isPacer && (
            <span className="ath-tag" title={tr("Court comme lièvre, hors classement", "Runs as pacer, not ranked")}>
              {tr("Lièvre", "Pacer")}
            </span>
          )}
        </span>
      );
    }
    if (f.key === "waUrl" && a.waUrl)
      return <a href={a.waUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8rem" }}>WA ↗</a>;
    if (f.group === "wa" && f.key !== "waid" && f.key !== "waUrl" && f.key !== "waFetchedAt")
      return <WaBadge value={a[f.key]} />;
    // Arrival / departure: render structured if raw string present
    if (f.key === "arrival")   return <TravelCell raw={a.arrival}   prefix="arrival"   referenceDate={meetingReferenceDate} compact />;
    if (f.key === "departure") return <TravelCell raw={a.departure} prefix="departure" referenceDate={meetingReferenceDate} compact />;
    return a[f.key] ?? "—";
  }

  // One athlete row (same markup grouped or not).
  function renderAthleteRow(a) {
    return (
      <tr key={a.id} className={`${a.status === "out" ? "row--muted" : ""}${selectedAthleteId === a.id ? " ath-row--selected" : ""}`}>
        {canViewUnifiedProfile && (
          <td className="col-sticky ath-reg">
            <RegistryLinkCell athlete={a} onOpen={() => setSelectedAthleteId(a.id)} />
          </td>
        )}
        {displayedFields.map((f) => {
          const isSticky = f.key === "lastName" || f.key === "firstName";
          const isLast = isSticky &&
            !displayedFields.slice(displayedFields.indexOf(f) + 1).some(
              (x) => x.key === "lastName" || x.key === "firstName"
            );
          const classes = [
            isSticky ? `col-sticky${isLast ? " col-sticky--last" : ""}` : "",
            f.key === "lastName" ? "ath-name" : "",
            f.key === "nationality" ? "ath-code" : "",
            NUMERIC_ATHLETE_FIELDS.has(f.key) ? "ath-num" : "",
          ].filter(Boolean).join(" ");
          return <td key={f.key} className={classes || undefined}>{renderCell(f, a)}</td>;
        })}
        {canEdit && !displayedFields.find((f) => f.key === "waid") && (
          <td><WaidCell athlete={a} onSave={handleSaveWaid} /></td>
        )}
        {canEdit && <td><WaSyncButton athlete={a} settings={settings} /></td>}
        {canEdit && <td className="ath-actions"><RowDeleteCell athlete={a} onDelete={handleDeleteAthlete} /></td>}
      </tr>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="page ath-page">

      {/* ── Page header (one compact line) ── */}
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Portail athlètes", "Athlete portal")}</p>
          <h1>{tr("Athlètes", "Athletes")}</h1>
          <p className="ath-head__meta">
            <span>
              <strong>{filtered.length}</strong> / {athletes.length} {tr("athlètes", "athletes")}
            </span>
            <span className="ath-head__sep">·</span>
            <span>
              Indoor {seasons.indoor}
              {seasons.indoorCurrent && seasons.indoorCurrent !== seasons.indoor && <> / {seasons.indoorCurrent}</>}
              {" · "}Outdoor {seasons.outdoor}
            </span>
            {canViewUnifiedProfile && (
              <>
                <span className="ath-head__sep">·</span>
                <label className="ath-head__edition">
                  {tr("Édition", "Edition")}
                  <select value={viewEditionId} onChange={(e) => setViewEditionId(e.target.value)}>
                    <option value={activeEditionId}>{tr("Courante", "Current")} ({activeEditionId})</option>
                    {normalizeEditionId(activeEditionId) !== "test" && <option value="test">{tr("Exemple 2026", "Sample 2026")}</option>}
                  </select>
                </label>
                {viewEditionId === "test" && (
                  <span className="ath-head__test">{tr("Exemple 2026 : rien n'apparaît ailleurs dans l'app", "Sample 2026: nothing shows anywhere else in the app")}</span>
                )}
              </>
            )}
          </p>
        </div>
        {canEdit && (
          <div className="ath-head__actions">
            <div className="ath-head__buttons">
              <button className="ath-btn" type="button" onClick={handleLinkAllToRegistry} disabled={linkingRegistry}>
                {linkingRegistry ? tr("Liaison…", "Linking…") : tr("Lier à la base athlètes", "Link to the athlete database")}
              </button>
              <button className="ath-btn ath-btn--primary" type="button" onClick={handleSyncAll} disabled={syncingAll}>
                {syncingAll ? tr("Synchronisation…", "Syncing…") : tr("↻ Tout synchroniser avec WA", "↻ Sync all with WA")}
              </button>
            </div>
            {syncAllStatus && (
              <p className="panel-note" style={{ marginTop: 4 }}>
                {syncAllStatus}
              </p>
            )}
            {linkRegistryStatus && (
              <p className="panel-note" style={{ marginTop: 4 }}>
                {linkRegistryStatus}
              </p>
            )}
            {syncAllFailures.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: "0.8rem", cursor: "pointer", color: "#b71c1c" }}>
                  {syncAllFailures.length} {tr(`échec${syncAllFailures.length > 1 ? "s" : ""} — voir le détail`, `failure${syncAllFailures.length > 1 ? "s" : ""} — see details`)}
                </summary>
                <ul style={{ margin: "4px 0 0 0", padding: "0 0 0 1rem", fontSize: "0.75rem", color: "#555" }}>
                  {syncAllFailures.map((f, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <strong>{f.name}</strong>{f.waid ? ` (${f.waid})` : ""}
                      <br />
                      <span style={{ color: "#b71c1c" }}>{f.error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="ath-sheet">
        {/* ── Toolbar: tab switch, filters, column picker ── */}
        <div className="ath-toolbar">
          {canViewUnifiedProfile && (
            <div className="ath-seg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={pageTab === "athletes"}
                className={`ath-seg__btn${pageTab === "athletes" ? " ath-seg__btn--active" : ""}`}
                onClick={() => setPageTab("athletes")}
              >
                {tr("Athlètes", "Athletes")} <span>{athletes.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pageTab === "staff"}
                className={`ath-seg__btn${pageTab === "staff" ? " ath-seg__btn--active" : ""}`}
                onClick={() => setPageTab("staff")}
              >
                {tr("Staff & accompagnateurs", "Staff & companions")} <span>{accompanyingPersons.length}</span>
              </button>
            </div>
          )}

          {pageTab === "athletes" && (
            <>
              <input
                className="ath-filter ath-filter--search"
                placeholder={tr("Rechercher nom, nat., WAID…", "Search name, nat., WAID…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className="ath-filter" value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}>
                <option value="">{tr("Épreuve", "Event")}</option>
                {filterOptions.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="ath-filter" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                <option value="">{tr("Genre", "Gender")}</option>
                <option value="W">{tr("Femmes", "Women")}</option>
                <option value="M">{tr("Hommes", "Men")}</option>
              </select>
              <select className="ath-filter" value={filterNat} onChange={(e) => setFilterNat(e.target.value)}>
                <option value="">Nation</option>
                {filterOptions.nats.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {filterOptions.heats.length > 0 && (
                <select className="ath-filter" value={filterHeat} onChange={(e) => setFilterHeat(e.target.value)}>
                  <option value="">{tr("Série", "Heat")}</option>
                  {filterOptions.heats.map((h) => <option key={h} value={h}>{tr("Série", "Heat")} {h}</option>)}
                </select>
              )}
              <select className="ath-filter" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">{tr("Statut", "Status")}</option>
                <option value="ok">{tr("Confirmé (OK)", "Confirmed (OK)")}</option>
                <option value="out">{tr("Retiré (Out)", "Withdrawn (Out)")}</option>
              </select>
              <select className="ath-filter" value={filterWa} onChange={(e) => setFilterWa(e.target.value)}>
                <option value="">{tr("Synchro WA", "WA sync")}</option>
                <option value="synced">{tr("Synchronisé WA", "Synced with WA")}</option>
                <option value="has_waid">{tr("Avec WAID", "With WAID")}</option>
                <option value="no_waid">{tr("Sans WAID", "Without WAID")}</option>
              </select>
              <label className="ath-check">
                <input type="checkbox" checked={groupByEvent} onChange={(e) => setGroupByEvent(e.target.checked)} />
                {tr("Grouper par épreuve", "Group by event")}
              </label>

              <span className="ath-toolbar__spacer" />
              <span className="ath-toolbar__count">
                {filtered.length} {tr(`athlète${filtered.length !== 1 ? "s" : ""}`, `athlete${filtered.length !== 1 ? "s" : ""}`)}
                {groupByEvent ? ` · ${grouped.length} ${tr(`épreuve${grouped.length !== 1 ? "s" : ""}`, `event${grouped.length !== 1 ? "s" : ""}`)}` : ""}
              </span>

              {/* ── Column picker ── */}
              <div ref={colPickerRef} className="ath-colpicker">
                <button className="ath-btn" type="button" onClick={() => setColPickerOpen((v) => !v)}>
                  {tr("Colonnes", "Columns")}
                  {hiddenCols.size > 0 && <span className="ath-btn__badge">{hiddenCols.size} {tr(`masquée${hiddenCols.size > 1 ? "s" : ""}`, "hidden")}</span>}
                  <span aria-hidden="true"> ▾</span>
                </button>
                {colPickerOpen && (
                  <div className="col-picker-popover col-picker-popover--right">
                    <div className="col-picker-popover__title">{tr("Afficher / masquer", "Show / hide")}</div>
                    {toggleableCols.map((f) => {
                      const hidden = hiddenCols.has(f.key);
                      return (
                        <label key={f.key} className="col-picker-row">
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={() => setHiddenCols((prev) => {
                              const next = new Set(prev);
                              if (hidden) next.delete(f.key); else next.add(f.key);
                              return next;
                            })}
                          />
                          <span>{fieldLabel(f, tr)}</span>
                        </label>
                      );
                    })}
                    {hiddenCols.size > 0 && (
                      <button type="button" className="ath-btn ath-btn--block" onClick={() => setHiddenCols(new Set())}>
                        {tr("Tout afficher", "Show all")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {pageTab === "staff" && staffByRole.length > 0 && (
            <>
              <span className="ath-toolbar__spacer" />
              <span className="ath-toolbar__count">
                {staffByRole.map(([role, count]) => `${count} ${staffRoleLabel(role, tr)}`).join(" · ")}
              </span>
            </>
          )}
        </div>

        {/* ── Staff & accompanying persons ── */}
        {canViewUnifiedProfile && pageTab === "staff" && (
          accompanyingPersons.length === 0 ? (
            <p className="ath-empty">{tr("Aucun staff ni accompagnateur importé pour cette édition.", "No staff or companions imported for this edition.")}</p>
          ) : (
            <div className="table-wrap table-wrap--athletes">
              <table className="data-table data-table--sheet ath-table">
                <thead>
                  <tr>
                    <th>{tr("Nom", "Last name")}</th><th>{tr("Prénom", "First name")}</th><th>Nat.</th><th>{tr("Rôle", "Role")}</th>
                    <th>{tr("Lié à", "Linked to")}</th><th>{tr("Statut", "Status")}</th><th>{tr("Hôtel", "Hotel")}</th><th>{tr("Arrivée", "Arrival")}</th><th>{tr("Départ", "Departure")}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {accompanyingPersons.map((p) => (
                    <tr key={p.id}>
                      <td className="ath-name">{p.lastName}</td>
                      <td>{p.firstName}</td>
                      <td className="ath-code">{p.nationality || "—"}</td>
                      <td>{p.staffRole ? staffRoleLabel(p.staffRole, tr) : "—"}</td>
                      <td>{p.linkedTo || "—"}</td>
                      <td>{p.status ? <StatusBadge status={p.status} /> : "—"}</td>
                      <td><HotelCell value={p.hotel} /></td>
                      <td><TravelCell raw={p.arrival} prefix="arrival" referenceDate={meetingReferenceDate} compact /></td>
                      <td><TravelCell raw={p.departure} prefix="departure" referenceDate={meetingReferenceDate} compact /></td>
                      <td className="ath-actions"><RowDeleteCell athlete={p} onDelete={handleDeleteAccompanying} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── Athletes ── */}
        {pageTab === "athletes" && (athletes.length === 0 ? (
          <p className="ath-empty">
            <strong>{tr("Aucun athlète pour le moment.", "No athletes yet.")}</strong>{" "}
            {tr("Un meeting director peut importer une liste de départ.", "A meeting director can import a start list.")}
          </p>
        ) : (
          <>
            <div className="table-wrap table-wrap--athletes">
              <table className="data-table data-table--sheet ath-table" ref={tableRef}>
                <thead>
                  <tr>
                    {canViewUnifiedProfile && (
                      <th className="col-sticky ath-reg" data-sticky-col="1" title={tr("Relié à l'historique multi-éditions ?", "Linked to the multi-edition history?")}>
                        Reg.
                      </th>
                    )}
                    {displayedFields.map((f) => {
                      const isSticky = f.key === "lastName" || f.key === "firstName";
                      const isLast = isSticky &&
                        !displayedFields.slice(displayedFields.indexOf(f) + 1).some(
                          (x) => x.key === "lastName" || x.key === "firstName"
                        );
                      return (
                        <th
                          key={f.key}
                          className={isSticky ? `col-sticky${isLast ? " col-sticky--last" : ""}` : ""}
                          data-sticky-col={isSticky ? "1" : undefined}
                          title={fieldLabel(f, tr)}
                        >
                          {fieldLabel(f, tr)}
                        </th>
                      );
                    })}
                    {canEdit && !displayedFields.find((f) => f.key === "waid") && <th>WAID</th>}
                    {canEdit && <th>{tr("Synchro", "Sync")}</th>}
                    {canEdit && <th aria-label="Actions"></th>}
                  </tr>
                </thead>

                {groupByEvent
                  ? grouped.map(([eventKey, group]) => {
                      const ev = parseEventField(eventKey);
                      const flaggedAthletes = group.filter((a) => !a._std.standardized);
                      const isFixOpen = expandedEventGroups.has(eventKey);
                      return (
                        <tbody key={eventKey} className="event-group">
                          <tr className="event-group-header">
                            <td colSpan={colCount}>
                              <div className="ath-group">
                                <span className="ath-group__title">{eventKey === "(sans épreuve)" ? tr("(sans épreuve)", "(no event)") : ev.discipline || eventKey}</span>
                                <GenderBadge gender={ev.gender} />
                                <span className="ath-group__count">{group.length}</span>
                                {flaggedAthletes.length > 0 && (
                                  <button
                                    type="button"
                                    className="ath-group__warn"
                                    onClick={() => setExpandedEventGroups((current) => {
                                      const next = new Set(current);
                                      if (next.has(eventKey)) next.delete(eventKey); else next.add(eventKey);
                                      return next;
                                    })}
                                  >
                                    {flaggedAthletes.length} {tr("à vérifier", "to check")} {isFixOpen ? "▴" : "▾"}
                                  </button>
                                )}
                              </div>
                              {isFixOpen && flaggedAthletes.length > 0 && (
                                <div className="ath-group__fix">
                                  {flaggedAthletes.map((a) => (
                                    <EventCorrectionRow
                                      key={a.id}
                                      athlete={a}
                                      onSave={handleFixEvent}
                                      onSplit={handleSplitEvent}
                                      onDelete={handleDeleteAthlete}
                                    />
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                          {group.map((a) => renderAthleteRow(a))}
                        </tbody>
                      );
                    })
                  : <tbody>{filtered.map((a) => renderAthleteRow(a))}</tbody>
                }
              </table>
            </div>
            {visibleFields.some((f) => f.group === "wa") && (
              <p className="ath-legend"><span className="ath-wa">{tr("bleu", "blue")}</span> {tr("= valeur issue de World Athletics", "= value from World Athletics")}</p>
            )}
          </>
        ))}
      </section>

      {canViewUnifiedProfile && pageTab === "athletes" && selectedCurrentAthlete && (
        <section className="panel-grid panel-grid--1">
          <AthleteProfilePanel
            Panel={Panel}
            registryEntry={selectedRegistryEntry}
            currentAthletes={selectedCurrentAthletes}
            onClear={() => setSelectedAthleteId("")}
            title={registryLoading ? tr("Fiche athlète (chargement…)", "Athlete profile (loading…)") : tr("Fiche athlète", "Athlete profile")}
          />
        </section>
      )}
    </div>
  );
}

// ─── Import page ──────────────────────────────────────────────────────────────

function formatChangeValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function ImportChangesDetail({ changes }) {
  const tr = useTr();
  // Labels are archived in French with each import; shown by field key.
  const changeLabel = (f) => {
    const known = DIFFABLE_ATHLETE_FIELDS.find((field) => field.key === f.field);
    return known ? fieldLabel(known, tr) : f.label;
  };
  const added = changes.filter((c) => c.type === "added");
  const updated = changes.filter((c) => c.type === "updated");
  const markedOut = changes.filter((c) => c.type === "markedOut");

  return (
    <div style={{ display: "grid", gap: 12, padding: "0.75rem 0.5rem", fontSize: "0.82rem" }}>
      {added.length > 0 && (
        <div>
          <strong style={{ color: "#166534" }}>+ {added.length} {tr(`ajouté${added.length > 1 ? "s" : ""}`, "added")}</strong>
          <ul className="compact-list" style={{ margin: "4px 0 0" }}>
            {added.map((c, i) => (
              <li key={i}>{c.name}{c.event ? ` — ${c.event}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {markedOut.length > 0 && (
        <div>
          <strong style={{ color: "#b45309" }}>− {markedOut.length} {tr(`annulé${markedOut.length > 1 ? "s" : ""} (marqué Out)`, "withdrawn (marked Out)")}</strong>
          <ul className="compact-list" style={{ margin: "4px 0 0" }}>
            {markedOut.map((c, i) => (
              <li key={i}>{c.name}{c.event ? ` — ${c.event}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {updated.length > 0 && (
        <div>
          <strong style={{ color: "#1d4ed8" }}>~ {updated.length} {tr(`modifié${updated.length > 1 ? "s" : ""}`, "changed")}</strong>
          <ul className="compact-list" style={{ margin: "4px 0 0" }}>
            {updated.map((c, i) => (
              <li key={i}>
                {c.name}{c.event ? ` — ${c.event}` : ""} :{" "}
                {c.fields.map((f, j) => (
                  <span key={j}>
                    {j > 0 ? ", " : ""}
                    <em>{changeLabel(f)}</em> {formatChangeValue(f.before)} → {formatChangeValue(f.after)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {added.length === 0 && markedOut.length === 0 && updated.length === 0 && (
        <p className="panel-note" style={{ margin: 0 }}>{tr("Aucun changement détecté.", "No change detected.")}</p>
      )}
    </div>
  );
}

function AthleteImportPage({ Panel }) {
  const tr = useTr();
  const { userProfile, currentUser } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const canImport = canImportAthletes(roles, settings);
  const { activeEditionId } = useActiveEdition();
  // Defaults to the real current edition, but can be pointed at "test" to
  // rehearse an import (partial columns, real files, etc.) without it ever
  // reaching the live roster shown elsewhere in the app.
  // Follows the active edition until the user picks another one (useActiveEdition
  // starts on "test" while it loads, which used to stick).
  const [pickedTargetEditionId, setTargetEditionId] = useState("");
  const targetEditionId = pickedTargetEditionId || activeEditionId;
  const { athletes } = useAthletes(true, targetEditionId);
  const { people: accompanyingPersons } = useAccompanyingPersons(true, targetEditionId);
  const { history: importHistory, loading: historyLoading } = useAthleteImportHistory(canImport, targetEditionId);
  const [expandedImportId, setExpandedImportId] = useState("");
  const { editions: meetingEditions } = useMeetingEditions();
  const meetingReferenceDate = meetingEditions.find((e) => String(e.year) === String(activeEditionId))?.date;

  const [parsed, setParsed] = useState(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // ⚠️ useMemo must be declared before any early returns (Rules of Hooks)
  const mergePreview = useMemo(
    () => (parsed ? mergeAthletes(athletes, parsed.records, parsed.fileType, parsed.presentFields) : null),
    [parsed, athletes],
  );

  if (settingsLoading) return <div className="page"><p className="panel-note">{tr("Chargement…", "Loading…")}</p></div>;

  if (!canImport) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>{tr("Importer des athlètes", "Import athletes")}</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>{tr("Accès restreint", "Restricted access")}</strong>
          <p>{tr("Seuls les meeting directors et les administrateurs peuvent importer les données athlètes.", "Only meeting directors and administrators can import athlete data.")}</p>
        </div>
      </div>
    );
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(tr("Lecture du fichier…", "Reading the file…")); setParsed(null);
    try {
      const { read, utils } = await import("xlsx");
      const wb = read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = sheetRowsWithHyperlinks(utils, ws);
      if (rows.length < 2) { setStatus(tr("Le fichier semble vide.", "The file looks empty.")); return; }
      const detected = detectFileType(rows);
      const { records, staff } = parseRows(rows, detected);
      const presentFields = detected.colMap
        ? [...new Set([
            ...Object.keys(detected.colMap),
            ...(detected.hasHeatSentinels ? ["heat", "lane"] : []),
          ])]
        : null;
      setParsed({ fileType: detected.type, records, staff, fileName: file.name, presentFields, file });
      setStatus(tr(
        `Détecté : ${detected.type} — ${records.length} athlètes${staff.length ? `, ${staff.length} staff/accompagnateurs` : ""}.${presentFields ? ` Colonnes : ${presentFields.join(", ")}.` : ""}`,
        `Detected: ${detected.type} — ${records.length} athletes${staff.length ? `, ${staff.length} staff/companions` : ""}.${presentFields ? ` Columns: ${presentFields.join(", ")}.` : ""}`,
      ));
    } catch (err) { setStatus(`${tr("Erreur : ", "Error: ")}${err.message}`); }
  }

  async function handleImport() {
    if (!parsed) return;
    setSaving(true); setStatus(tr("Fusion et enregistrement…", "Merging and saving…"));
    try {
      const { merged, added, updated, markedOut, changes } = mergeAthletes(athletes, parsed.records, parsed.fileType, parsed.presentFields);
      const batch = writeBatch(db);
      const athleteRefs = [];
      // Never delete athletes — update or create only
      merged.forEach((a, i) => {
        const id = a.id || `athlete_${Date.now()}_${i}`;
        athleteRefs.push({ athleteId: id, athlete: a });
        const { id: _id, _ev, ...data } = a; // strip client-only fields
        batch.set(doc(db, ATHLETES_COLLECTION, id), {
          ...data,
          editionId: targetEditionId,
          importedAt: serverTimestamp(),
          importSource: parsed.fileType,
        });
      });
      await batch.commit();

      if (parsed.staff?.length) {
        const staffMerge = mergeAccompanyingPersons(accompanyingPersons, parsed.staff);
        const staffBatch = writeBatch(db);
        staffMerge.merged.forEach((p, i) => {
          const id = p.id || `staff_${Date.now()}_${i}`;
          const { id: _id, ...data } = p;
          staffBatch.set(doc(db, ATHLETE_ACCOMPANYING_COLLECTION, id), {
            ...data,
            editionId: targetEditionId,
            importedAt: serverTimestamp(),
            importSource: parsed.fileType,
          });
        });
        await staffBatch.commit();
      }

      const links = await Promise.all(
        athleteRefs
          .filter(({ athlete }) => athlete.lastName || athlete.firstName)
          .map(async ({ athleteId, athlete }) => {
            const registryResult = await upsertAthleteRegistry({
              lastName: athlete.lastName,
              firstName: athlete.firstName,
              nationality: athlete.nationality,
              birthYear: athlete.birthYear,
              waid: athlete.waid,
              waUrl: athlete.waUrl,
            });

            return registryResult?.docId
              ? { athleteId, registryAthleteId: registryResult.docId }
              : null;
          }),
      );

      const linkBatch = writeBatch(db);
      let linkCount = 0;
      links.filter(Boolean).forEach((link) => {
        linkBatch.set(
          doc(db, ATHLETES_COLLECTION, link.athleteId),
          { registryAthleteId: link.registryAthleteId },
          { merge: true },
        );
        linkCount++;
      });
      if (linkCount > 0) {
        await linkBatch.commit();
      }

      try {
        await recordAthleteImport({
          file: parsed.file,
          fileType: parsed.fileType,
          presentFields: parsed.presentFields,
          recordCount: parsed.records.length,
          added, updated, markedOut, changes,
          actorName: [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser?.email || "",
          actorUid: currentUser?.uid || "",
          editionId: targetEditionId,
        });
      } catch (historyError) {
        console.error("Unable to archive this import", historyError);
      }

      const parts = [tr(`${added} ajoutés`, `${added} added`), tr(`${updated} mis à jour`, `${updated} updated`)];
      if (markedOut > 0) parts.push(tr(`${markedOut} marqués Out (absents du fichier)`, `${markedOut} marked Out (missing from the file)`));
      if (parsed.staff?.length) parts.push(tr(`${parsed.staff.length} staff/accompagnateurs`, `${parsed.staff.length} staff/companions`));
      setStatus(tr(`Terminé. ${parts.join(" · ")} · ${merged.length} au total.`, `Done. ${parts.join(" · ")} · ${merged.length} in total.`));
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) { setStatus(`${tr("Échec de l'import : ", "Import failed: ")}${err.message}`); }
    finally { setSaving(false); }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Portail athlètes", "Athlete portal")}</p>
          <h1>{tr("Importer un fichier", "Import a file")}</h1>
          <p>{tr("Format détecté automatiquement. Les WAID et données WA existants sont toujours conservés.", "Format detected automatically. Existing WAIDs and WA data are always kept.")}</p>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: "0.8rem", color: "#607086" }}>{tr("Importer dans :", "Import into:")}</label>
            <select
              value={targetEditionId}
              onChange={(e) => setTargetEditionId(e.target.value)}
              style={FILTER_CONTROL_STYLE}
            >
              <option value={activeEditionId}>{tr("Édition courante", "Current edition")} ({activeEditionId})</option>
              {normalizeEditionId(activeEditionId) !== "test" && <option value="test">{tr("Exemple 2026", "Sample 2026")}</option>}
            </select>
            {targetEditionId === "test" && (
              <span className="status-pill status-pill--warn" style={{ fontSize: "0.72rem" }}>
                {tr("Isolée — jamais affichée sur le site public ni aux bénévoles", "Isolated — never shown on the public site or to volunteers")}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title={tr("Formats acceptés", "Accepted formats")}>
          {tr(
            <ul className="compact-list">
              <li><strong>Combiné (recommandé)</strong> — un seul fichier avec toutes les colonnes : Event, Last name, First name, Nat., Birth year, Status, WR, PB, SB, WA URL, Heat, Lane, Manager, Arrival, Departure. Met tout à jour ; peut être réimporté autant de fois que nécessaire.</li>
              <li><strong>Liste de départ</strong> (ancien format) — Event, Name, Vorname, Nat., Jahrg., Status, WR, PB, SB, WA Profile</li>
              <li><strong>Séries &amp; couloirs</strong> (ancien format) — idem + lignes « Heat » et colonne Lane ; met à jour uniquement séries et couloirs</li>
              <li><strong>Voyages</strong> (ancien format) — Event, Name, Vorname, Nat., Manager, Anreise, Abreise ; met à jour uniquement la logistique</li>
            </ul>,
            <ul className="compact-list">
              <li><strong>Combined (recommended)</strong> — one file with every column: Event, Last name, First name, Nat., Birth year, Status, WR, PB, SB, WA URL, Heat, Lane, Manager, Arrival, Departure. Updates everything; can be re-imported as often as needed.</li>
              <li><strong>Start list</strong> (old format) — Event, Name, Vorname, Nat., Jahrg., Status, WR, PB, SB, WA Profile</li>
              <li><strong>Heats &amp; lanes</strong> (old format) — same + “Heat” rows and a Lane column; only updates heats and lanes</li>
              <li><strong>Travel</strong> (old format) — Event, Name, Vorname, Nat., Manager, Anreise, Abreise; only updates logistics</li>
            </ul>,
          )}
          <p className="panel-note">{tr(
            "Les données WA (WAID, PB venant de WA) ne sont jamais écrasées par un import — seulement par une synchro WA manuelle.",
            "WA data (WAID, PBs from WA) is never overwritten by an import — only by a manual WA sync.",
          )}</p>
        </Panel>
        <Panel title={tr("Fichier", "File")}>
          <label className="field">
            <span>{tr("Fichier Excel (.xlsx)", "Excel file (.xlsx)")}</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={saving} />
          </label>
          {status && <p className="panel-note">{status}</p>}
        </Panel>
      </section>

      {parsed && (
        <>
          <section className="panel-grid panel-grid--2">
            <Panel title={tr("Résultat de la détection", "Detection result")}>
              <ul className="compact-list">
                <li>{tr("Fichier :", "File:")} <strong>{parsed.fileName}</strong></li>
                <li>Type{tr(" :", ":")} <FileTypeBadge type={parsed.fileType} /></li>
                <li>{tr("Lignes dans le fichier :", "Rows in the file:")} <strong>{parsed.records.length}</strong></li>
                {parsed.presentFields ? (
                  <li>{tr("Colonnes détectées :", "Detected columns:")} <strong>{parsed.presentFields.join(", ")}</strong></li>
                ) : null}
              </ul>
              {parsed.presentFields ? (
                <p className="panel-note">
                  {tr(
                    "Seules ces colonnes seront mises à jour pour les athlètes reconnus — tout ce qui n'est pas listé ici (ex. séries/couloirs ou voyages si ce fichier ne les contient pas) reste inchangé.",
                    "Only these columns are updated for recognised athletes — anything not listed here (e.g. heats/lanes or travel if this file doesn't have them) stays unchanged.",
                  )}
                </p>
              ) : null}
            </Panel>
            {mergePreview && (
              <Panel title={tr("Aperçu de la fusion", "Merge preview")}>
                <ul className="compact-list">
                  <li>{tr("Actuellement en base :", "Currently in the database:")} <strong>{athletes.length}</strong></li>
                  <li>{tr("Nouveaux athlètes à ajouter :", "New athletes to add:")} <strong>{mergePreview.added}</strong></li>
                  <li>{tr("Athlètes existants à mettre à jour :", "Existing athletes to update:")} <strong>{mergePreview.updated}</strong></li>
                  {mergePreview.markedOut > 0 && (
                    <li style={{ color: "#b45309" }}>
                      {tr("Absents de ce fichier → seront marqués", "Missing from this file → will be marked")} <strong>Out</strong>{" "}
                      {tr("(série, couloir et voyage effacés) :", "(heat, lane and travel cleared):")} <strong>{mergePreview.markedOut}</strong>
                    </li>
                  )}
                  <li>{tr("Total en base après import :", "Total in the database after import:")} <strong>{mergePreview.merged.length}</strong></li>
                </ul>
                {parsed.fileType === "COMBINED"    && <p className="panel-note">{tr("Met à jour tous les champs. Les athlètes absents de ce fichier sont marqués Out — jamais supprimés.", "Updates every field. Athletes missing from this file are marked Out — never deleted.")}</p>}
                {parsed.fileType === "TRAVEL"      && <p className="panel-note">{tr("Met à jour uniquement les voyages. Aucun athlète marqué Out.", "Only updates travel. No athlete marked Out.")}</p>}
                {parsed.fileType === "FINAL_LANES" && <p className="panel-note">{tr("Met à jour uniquement les séries et couloirs. Aucun athlète marqué Out.", "Only updates heats and lanes. No athlete marked Out.")}</p>}
              </Panel>
            )}
          </section>

          <section className="panel-grid panel-grid--1">
            <Panel title={tr("Aperçu — 10 premières lignes", "Preview — first 10 rows")}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{tr("Épreuve", "Event")}</th><th>{tr("Nom", "Last name")}</th><th>{tr("Prénom", "First name")}</th><th>Nat.</th>
                      {(parsed.fileType === "START_LIST" || parsed.fileType === "COMBINED") && <><th>{tr("Statut", "Status")}</th><th>WR</th><th>PB Indoor</th><th>PB Outdoor</th><th>SB</th><th>WAID</th></>}
                      {(parsed.fileType === "FINAL_LANES" || parsed.fileType === "COMBINED") && <><th>{tr("Série", "Heat")}</th><th>{tr("Couloir", "Lane")}</th></>}
                      {(parsed.fileType === "TRAVEL"      || parsed.fileType === "COMBINED") && <><th>Manager</th><th>{tr("Arrivée", "Arrival")}</th><th>{tr("Départ", "Departure")}</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.records.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td>{r.event}</td><td>{r.lastName}</td><td>{r.firstName}</td><td>{r.nationality}</td>
                        {(parsed.fileType === "START_LIST" || parsed.fileType === "COMBINED") && (
                          <><td>{r.status ? <StatusBadge status={r.status} /> : "—"}</td><td>{r.worldRanking ?? "—"}</td><td>{r.pbIndoor ?? "—"}</td><td>{r.pbOutdoor ?? "—"}</td><td>{r.sb ?? "—"}</td><td>{r.waid ?? "—"}</td></>
                        )}
                        {(parsed.fileType === "FINAL_LANES" || parsed.fileType === "COMBINED") && (
                          <><td>{r.heat ?? "—"}</td><td>{r.lane ?? "—"}</td></>
                        )}
                        {(parsed.fileType === "TRAVEL" || parsed.fileType === "COMBINED") && (
                          <><td>{r.manager ?? "—"}</td><td><TravelCell raw={r.arrival} prefix="arrival" referenceDate={meetingReferenceDate} /></td><td><TravelCell raw={r.departure} prefix="departure" referenceDate={meetingReferenceDate} /></td></>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dashboard-action-grid" style={{ marginTop: "1rem" }}>
                <button className="button button--primary" type="button" onClick={handleImport} disabled={saving || parsed.fileType === "UNKNOWN"}>
                  {saving ? "Import…" : tr(`Confirmer l'import (${parsed.records.length} lignes)`, `Confirm the import (${parsed.records.length} rows)`)}
                </button>
                <button className="button button--secondary" type="button" onClick={() => { setParsed(null); setStatus(""); if (fileRef.current) fileRef.current.value = ""; }} disabled={saving}>
                  {tr("Annuler", "Cancel")}
                </button>
              </div>
              {parsed.fileType === "UNKNOWN" && (
                <p className="panel-note" style={{ color: "var(--color-danger, #c0392b)" }}>
                  {tr(
                    "Format non reconnu. Vérifie qu'il s'agit bien d'un fichier CMCM (liste de départ, couloirs ou voyages).",
                    "Format not recognised. Check that this is a CMCM file (start list, lanes or travel).",
                  )}
                </p>
              )}
            </Panel>
          </section>
        </>
      )}

      <section className="panel-grid panel-grid--1">
        <Panel
          title={tr("Historique des imports", "Import history")}
          subtitle={tr("Chaque fichier reçu, dans l'ordre, avec l'Excel d'origine toujours téléchargeable", "Every file received, in order, with the original Excel always downloadable")}
        >
          {historyLoading ? (
            <p className="panel-note">{tr("Chargement…", "Loading…")}</p>
          ) : importHistory.length === 0 ? (
            <p className="panel-note">{tr("Aucun import pour le moment.", "No import yet.")}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th><th>{tr("Fichier", "File")}</th><th>Type</th><th>{tr("Colonnes", "Columns")}</th><th>{tr("Lignes", "Rows")}</th><th>{tr("Changements", "Changes")}</th><th>{tr("Par", "By")}</th><th>Date</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map((entry, index) => {
                    const changes = Array.isArray(entry.changes) ? entry.changes : [];
                    const isExpanded = expandedImportId === entry.id;
                    return (
                      <Fragment key={entry.id}>
                        <tr>
                          <td>
                            {index === 0 ? (
                              <span className="status-pill status-pill--ok" style={{ fontSize: "0.72rem" }}>{tr("actuelle", "current")}</span>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>#{importHistory.length - index}</span>
                            )}
                          </td>
                          <td>{entry.fileName}</td>
                          <td><FileTypeBadge type={entry.fileType} /></td>
                          <td style={{ maxWidth: 240, fontSize: "0.78rem", color: "#607086" }}>
                            {entry.presentFields ? entry.presentFields.join(", ") : "—"}
                          </td>
                          <td>{entry.recordCount ?? "—"}</td>
                          <td>
                            {changes.length === 0 ? (
                              <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>
                            ) : (
                              <button
                                type="button"
                                className="button button--ghost button--small"
                                onClick={() => setExpandedImportId(isExpanded ? "" : entry.id)}
                                style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}
                              >
                                {entry.added > 0 ? `+${entry.added} ` : ""}
                                {entry.updated > 0 ? `~${entry.updated} ` : ""}
                                {entry.markedOut > 0 ? `-${entry.markedOut} ` : ""}
                                {isExpanded ? "▲" : "▼"}
                              </button>
                            )}
                          </td>
                          <td>{entry.actorName || "—"}</td>
                          <td>{entry.importedAt?.toDate ? entry.importedAt.toDate().toLocaleString() : "—"}</td>
                          <td>
                            {entry.fileUrl ? (
                              <a href={entry.fileUrl} target="_blank" rel="noopener noreferrer" className="button button--secondary button--small">
                                {tr("Télécharger", "Download")}
                              </a>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{tr("non archivé", "not archived")}</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} style={{ background: "#f8fafc" }}>
                              <ImportChangesDetail changes={changes} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

function AthletePortalSettingsPage({ Panel }) {
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isAdmin = roles.includes("admin");
  const { settings, loading } = useAthletePortalSettings();

  const [accessRoles,    setAccessRoles]    = useState([]);
  const [importerRoles,  setImporterRoles]  = useState([]);
  const [fieldVisibility,setFieldVisibility]= useState({});
  const [indoorSeason,        setIndoorSeason]        = useState(DEFAULT_PORTAL_SETTINGS.seasons.indoor);
  const [indoorCurrentSeason, setIndoorCurrentSeason] = useState(DEFAULT_PORTAL_SETTINGS.seasons.indoorCurrent);
  const [outdoorSeason,       setOutdoorSeason]       = useState(DEFAULT_PORTAL_SETTINGS.seasons.outdoor);
  const [waServiceUrl,   setWaServiceUrl]   = useState(DEFAULT_PORTAL_SETTINGS.waServiceUrl);
  const [saveStatus,     setSaveStatus]     = useState("");
  const [saving,         setSaving]         = useState(false);
  const [initialized,    setInitialized]    = useState(false);

  if (!initialized && settings) {
    setAccessRoles(settings.accessRoles ?? DEFAULT_PORTAL_SETTINGS.accessRoles);
    setImporterRoles(settings.importerRoles ?? DEFAULT_PORTAL_SETTINGS.importerRoles);
    setFieldVisibility(settings.fieldVisibility ?? DEFAULT_PORTAL_SETTINGS.fieldVisibility);
    setIndoorSeason(settings.seasons?.indoor ?? DEFAULT_PORTAL_SETTINGS.seasons.indoor);
    setIndoorCurrentSeason(settings.seasons?.indoorCurrent ?? DEFAULT_PORTAL_SETTINGS.seasons.indoorCurrent);
    setOutdoorSeason(settings.seasons?.outdoor ?? DEFAULT_PORTAL_SETTINGS.seasons.outdoor);
    setWaServiceUrl(settings.waServiceUrl ?? DEFAULT_PORTAL_SETTINGS.waServiceUrl);
    setInitialized(true);
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>Réglages du portail</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>Réservé aux administrateurs</strong>
          <p>Seuls les administrateurs peuvent gérer les droits du portail athlètes.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><p className="panel-note">Chargement…</p></div>;

  function toggleRole(list, setter, role) {
    setter((p) => p.includes(role) ? p.filter((r) => r !== role) : [...p, role]);
  }

  function toggleField(role, key) {
    setFieldVisibility((p) => {
      const cur = new Set(p[role] ?? []);
      cur.has(key) ? cur.delete(key) : cur.add(key);
      return { ...p, [role]: [...cur] };
    });
  }

  function setGroupForRole(role, group, on) {
    const keys = ALL_ATHLETE_FIELDS.filter((f) => f.group === group).map((f) => f.key);
    setFieldVisibility((p) => {
      const cur = new Set(p[role] ?? []);
      keys.forEach((k) => on ? cur.add(k) : cur.delete(k));
      return { ...p, [role]: [...cur] };
    });
  }

  function groupAllGranted(role, group) {
    const cur = fieldVisibility[role] ?? [];
    return ALL_ATHLETE_FIELDS.filter((f) => f.group === group).every((f) => cur.includes(f.key));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveStatus("Enregistrement…");
    try {
      await setDoc(
        doc(db, ...ATHLETE_PORTAL_SETTINGS_PATH),
        {
          accessRoles, importerRoles, fieldVisibility,
          seasons: { indoor: Number(indoorSeason), indoorCurrent: Number(indoorCurrentSeason), outdoor: Number(outdoorSeason) },
          waServiceUrl: waServiceUrl.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSaveStatus("Réglages enregistrés.");
    } catch (err) { setSaveStatus(`Échec de l'enregistrement : ${err.message}`); }
    finally { setSaving(false); }
  }

  const activeRoles = PLATFORM_ROLES.filter((r) => accessRoles.includes(r.key));

  const colCount = activeRoles.length;
  // CSS grid: field label column + one column per active role
  const visGrid = {
    display: "grid",
    gridTemplateColumns: `220px repeat(${colCount}, 1fr)`,
    gap: "0",
    alignItems: "center",
  };

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Portail athlètes</p>
          <h1>Réglages du portail</h1>
          <p>Droits d&apos;accès, saisons et lien avec World Athletics.</p>
        </div>
        <div>
          <button className="button button--primary" form="settings-form" type="submit" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          {saveStatus && <p className="panel-note" style={{ marginTop: 4 }}>{saveStatus}</p>}
        </div>
      </section>

      <form id="settings-form" onSubmit={handleSave}>

        {/* ── Seasons ──────────────────────────────────────────────── */}
        <section className="panel-grid panel-grid--1">
          <Panel title="Saisons" subtitle="Le CMCM a lieu début janvier : la saison indoor vient à peine de commencer au moment du meeting.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem 2rem", maxWidth: 520 }}>
              <label className="field">
                <span>Indoor — année précédente</span>
                <input type="number" min="2020" max="2040" value={indoorSeason}
                  onChange={(e) => setIndoorSeason(e.target.value)} />
                <span className="field-hint">SB principal (saison terminée)</span>
              </label>
              <label className="field">
                <span>Indoor — année en cours</span>
                <input type="number" min="2020" max="2040" value={indoorCurrentSeason}
                  onChange={(e) => setIndoorCurrentSeason(e.target.value)} />
                <span className="field-hint">Affiché aussi si disponible</span>
              </label>
              <label className="field">
                <span>Outdoor</span>
                <input type="number" min="2020" max="2040" value={outdoorSeason}
                  onChange={(e) => setOutdoorSeason(e.target.value)} />
                <span className="field-hint">Été précédent (N−1)</span>
              </label>
            </div>
            <p className="panel-note" style={{ marginTop: "1rem" }}>
              Exemple pour le CMCM <strong>{indoorCurrentSeason}</strong>: Indoor SB <strong>{indoorSeason}</strong> (principal) ·
              Indoor SB <strong>{indoorCurrentSeason}</strong> (en cours, peu de résultats) ·
              Outdoor SB <strong>{outdoorSeason}</strong>.
            </p>
          </Panel>
        </section>

        {/* ── Access & Import rights ────────────────────────────────── */}
        <section className="panel-grid panel-grid--2">
          <Panel title="Accès au portail" subtitle="Qui peut ouvrir le portail athlètes.">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {PLATFORM_ROLES.map((role) => (
                <label key={role.key} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: "0.5rem", alignItems: "center", cursor: role.key === "admin" ? "default" : "pointer", minWidth: 0 }}>
                  <input type="checkbox"
                    checked={accessRoles.includes(role.key)}
                    disabled={role.key === "admin"}
                    onChange={() => toggleRole(accessRoles, setAccessRoles, role.key)} />
                  <span style={{ fontSize: "0.875rem", wordBreak: "break-word" }}>{role.label}</span>
                  {role.key === "admin" && <span className="status-pill status-pill--accent" style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>toujours</span>}
                  {role.key !== "admin" && <span />}
                </label>
              ))}
            </div>
          </Panel>

          <Panel title="Droits d'import" subtitle="Qui peut importer les fichiers Excel. Seuls les rôles ayant accès au portail sont affichés.">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {activeRoles.map((role) => (
                <label key={role.key} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "0.5rem", alignItems: "center", cursor: "pointer", minWidth: 0 }}>
                  <input type="checkbox"
                    checked={importerRoles.includes(role.key)}
                    onChange={() => toggleRole(importerRoles, setImporterRoles, role.key)} />
                  <span style={{ fontSize: "0.875rem" }}>{role.label}</span>
                </label>
              ))}
            </div>
          </Panel>
        </section>

        {/* ── WA service URL ────────────────────────────────────────── */}
        <section className="panel-grid panel-grid--1">
          <Panel title="Service World Athletics" subtitle="URL utilisée par les boutons ↻ WA.">
            <div style={{ maxWidth: 480 }}>
              <label className="field">
                <span>URL du service WA</span>
                <input type="text" value={waServiceUrl}
                  onChange={(e) => setWaServiceUrl(e.target.value)}
                  placeholder="/api/wa" />
              </label>
              <p className="panel-note" style={{ marginTop: "0.5rem" }}>
                Par défaut <code>/api/wa</code> → fonction Netlify, elle-même branchée sur{" "}
                <code>worldathletics.nimarion.de</code> (fonctionne en production sans réglage supplémentaire).<br />
                En local, lance <code>netlify dev</code> pour tester la fonction, ou indique une URL
                qui respecte le même format.
              </p>
            </div>
          </Panel>
        </section>

        {/* ── Field visibility ──────────────────────────────────────── */}
        <section className="panel-grid panel-grid--1">
          <Panel title="Champs visibles par rôle" subtitle="Colonnes que chaque rôle voit dans la liste des athlètes.">

            {/* Sticky role header */}
            <div style={{ ...visGrid, borderBottom: "2px solid var(--color-border, #e0e0e0)", paddingBottom: "0.5rem", marginBottom: "0.25rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Champ</div>
              {activeRoles.map((r) => (
                <div key={r.key} style={{ textAlign: "center", fontWeight: 600, fontSize: "0.85rem", lineHeight: 1.3, padding: "0 4px" }}>
                  {r.label}
                </div>
              ))}
            </div>

            {/* Groups */}
            {FIELD_GROUPS.map((group) => {
              const gFields = ALL_ATHLETE_FIELDS.filter((f) => f.group === group.key);
              return (
                <div key={group.key} style={{ marginTop: "1.25rem" }}>

                  {/* Group header row */}
                  <div style={{ ...visGrid, background: "var(--color-surface-2, #f5f5f5)", borderRadius: 6, padding: "0.4rem 0.5rem", marginBottom: "0.15rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-muted, #555)" }}>
                      {group.label}
                    </div>
                    {activeRoles.map((r) => {
                      const allOn = groupAllGranted(r.key, group.key);
                      return (
                        <div key={r.key} style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className={`button button--small ${allOn ? "button--secondary" : "button--ghost"}`}
                            style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                            onClick={() => setGroupForRole(r.key, group.key, !allOn)}
                            title={allOn ? `Retirer tous les champs « ${group.label} » pour ${r.label}` : `Donner tous les champs « ${group.label} » à ${r.label}`}
                          >
                            {allOn ? "Tous ✓" : "Aucun"}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Field rows */}
                  {gFields.map((field, fi) => (
                    <div
                      key={field.key}
                      style={{
                        ...visGrid,
                        padding: "0.35rem 0.5rem",
                        borderRadius: 4,
                        background: fi % 2 === 0 ? "transparent" : "var(--color-surface-1, #fafafa)",
                      }}
                    >
                      <div style={{ fontSize: "0.875rem" }}>{field.label}</div>
                      {activeRoles.map((r) => (
                        <div key={r.key} style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            style={{ width: 16, height: 16, cursor: "pointer" }}
                            checked={(fieldVisibility[r.key] ?? []).includes(field.key)}
                            onChange={() => toggleField(r.key, field.key)}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}

            <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border, #e0e0e0)", display: "flex", gap: "1rem", alignItems: "center" }}>
              <button className="button button--primary" type="submit" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              {saveStatus && <p className="panel-note" style={{ margin: 0 }}>{saveStatus}</p>}
            </div>
          </Panel>
        </section>

      </form>
    </div>
  );
}

// ─── Athlete Registry page ────────────────────────────────────────────────────

// maintenance : "hide" (onglet Base athlètes) ou "only" (Réglages › Maintenance).
function AthleteRegistryPage({ Panel, maintenance }) {
  const tr = useTr();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const canAccess = canAccessStatistics(roles);

  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { registry, loading } = useAthleteRegistry(canAccess);
  const { athletes, loading: athletesLoading } = useAthletes(canAccess);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildLog, setRebuildLog] = useState([]);
  const [selectedRegistryDocId, setSelectedRegistryDocId] = useState("");
  const [selectedRegistryIds, setSelectedRegistryIds] = useState([]);
  const [mergingGroupId, setMergingGroupId] = useState("");
  const [dismissingGroupId, setDismissingGroupId] = useState("");
  const [mergeStatus, setMergeStatus] = useState("");
  const [mergeOverrides, setMergeOverrides] = useState({});
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState("");

  const withWaidCount = useMemo(() => registry.filter((entry) => entry.waid).length, [registry]);

  // One line per fiche with its computed stats and cleanup flags, for the
  // filters, sorts, analysis and the « À nettoyer » list.

  // The open fiche and the other fiche with the same WAID, merged as one person.
  function handleMergeSameWaid(otherEntry) {
    if (!selectedRegistryEntry || !otherEntry) return;
    const entries = [selectedRegistryEntry, otherEntry]
      .sort((a, b) => compareRegistryPrimaryCandidates(a, b, currentAthletesByRegistryId));
    handleMergeDuplicateGroup({
      id: `waid:${entries.map((entry) => entry._docId).sort().join("__")}`,
      entries,
      reasons: ["Même WAID"],
    });
  }

  const registryLookup = useMemo(
    () => buildRegistryLookup(registry),
    [registry],
  );

  const currentAthletesByRegistryId = useMemo(
    () => buildCurrentAthletesByRegistryId(athletes, registryLookup),
    [athletes, registryLookup],
  );

  const registryRows = useMemo(
    () => registry.map((entry) => ({
      entry,
      stats: getRegistryEntryStats(entry),
      suspectReasons: getRegistrySuspectReasons(entry, {
        linkedCount: (currentAthletesByRegistryId.get(entry._docId) || []).length,
      }),
    })),
    [currentAthletesByRegistryId, registry],
  );
  // Recherche venue de la barre du module Statistiques (?recherche=Nom).
  const [registrySearchParams] = useSearchParams();
  const registryFilterState = useRegistryFilters(registryRows, registrySearchParams.get("recherche") || "");
  const suspectRows = useMemo(() => registryRows.filter((row) => row.suspectReasons.length), [registryRows]);

  const selectedRegistryEntry = useMemo(
    () => registry.find((entry) => entry._docId === selectedRegistryDocId) || null,
    [registry, selectedRegistryDocId],
  );

  const selectedCurrentAthletes = useMemo(
    () => (selectedRegistryEntry?._docId ? (currentAthletesByRegistryId.get(selectedRegistryEntry._docId) || []) : []),
    [selectedRegistryEntry, currentAthletesByRegistryId],
  );

  const dismissedDuplicateGroupIds = useMemo(
    () => Array.isArray(settings?.ignoredDuplicateGroupIds) ? settings.ignoredDuplicateGroupIds : [],
    [settings],
  );

  const duplicateGroups = useMemo(
    () => buildDuplicateRegistryGroups(registry, currentAthletesByRegistryId)
      .filter((group) => !dismissedDuplicateGroupIds.includes(group.id)),
    [currentAthletesByRegistryId, dismissedDuplicateGroupIds, registry],
  );

  const manualMergeGroup = useMemo(() => {
    if (selectedRegistryIds.length < 2) return null;
    const selectedEntries = registry.filter((entry) => selectedRegistryIds.includes(entry._docId));
    if (selectedEntries.length < 2) return null;
    const sortedEntries = [...selectedEntries].sort((a, b) => compareRegistryPrimaryCandidates(a, b, currentAthletesByRegistryId));
    const nationalities = [...new Set(sortedEntries.map((entry) => entry.nationality).filter(Boolean))];
    return {
      id: `manual:${sortedEntries.map((entry) => entry._docId).sort().join("__")}`,
      entries: sortedEntries,
      reasons: ["Fusion manuelle"],
      hasNationalityConflict: nationalities.length > 1,
    };
  }, [currentAthletesByRegistryId, registry, selectedRegistryIds]);

  function toggleRegistrySelection(docId) {
    setSelectedRegistryIds((current) => (
      current.includes(docId)
        ? current.filter((value) => value !== docId)
        : [...current, docId]
    ));
  }

  function setMergeOverride(groupId, field, value) {
    setMergeOverrides((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] || {}),
        [field]: value,
      },
    }));
  }

  async function handleDismissDuplicateGroup(group) {
    if (!group?.id) return;
    if (!window.confirm(tr(
      "Masquer ce groupe de doublons probables ?\n\nTu pourras toujours corriger les fiches manuellement ensuite.",
      "Hide this group of likely duplicates?\n\nYou can still fix the profiles manually afterwards.",
    ))) return;
    setDismissingGroupId(group.id);
    setMergeStatus("");
    try {
      const nextDismissed = [...new Set([...dismissedDuplicateGroupIds, group.id])];
      await setDoc(
        doc(db, ...ATHLETE_PORTAL_SETTINGS_PATH),
        { ignoredDuplicateGroupIds: nextDismissed, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMergeStatus(tr("✅ Groupe masqué des doublons probables.", "✅ Group hidden from likely duplicates."));
    } catch (error) {
      setMergeStatus(`❌ ${error.message}`);
    } finally {
      setDismissingGroupId("");
    }
  }

  async function handleRestoreDismissedDuplicates() {
    setDismissingGroupId("restore-all");
    setMergeStatus("");
    try {
      await setDoc(
        doc(db, ...ATHLETE_PORTAL_SETTINGS_PATH),
        { ignoredDuplicateGroupIds: [], updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMergeStatus(tr("✅ Tous les doublons masqués ont été réaffichés.", "✅ All hidden duplicates are shown again."));
    } catch (error) {
      setMergeStatus(`❌ ${error.message}`);
    } finally {
      setDismissingGroupId("");
    }
  }

  async function handleMergeDuplicateGroup(group) {
    if (!group?.entries?.length) return;
    const names = group.entries
      .map((entry) => [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim() || entry._docId)
      .join(" / ");

    if (!window.confirm(tr(`Fusionner ces fiches athlètes ?\n\n${names}`, `Merge these athlete profiles?\n\n${names}`))) return;

    setMergingGroupId(group.id);
    setMergeStatus("");

    try {
      const sortedEntries = [...group.entries].sort((a, b) => compareRegistryPrimaryCandidates(a, b, currentAthletesByRegistryId));
      const primary = sortedEntries[0];
      const duplicates = sortedEntries.slice(1);
      const linkedCurrentAthletes = sortedEntries.flatMap((entry) => currentAthletesByRegistryId.get(entry._docId) || []);
      const groupOverrides = mergeOverrides[group.id] || {};
      const getOverrideEntry = (field) => sortedEntries.find((entry) => entry._docId === groupOverrides[field]) || null;

      const waidCandidates = [
        ...new Set(
          [
            ...sortedEntries.map((entry) => entry.waid),
            ...linkedCurrentAthletes.map((athlete) => athlete.waid),
          ]
            .filter(Boolean)
            .map((value) => String(value)),
        ),
      ];

      let waIdentity = null;
      if (!settingsLoading && settings && waidCandidates.length > 0) {
        try {
          const overrideWaidEntry = getOverrideEntry("waid");
          const preferredWaid = overrideWaidEntry?.waid
            ? String(overrideWaidEntry.waid)
            : primary.waid
              ? String(primary.waid)
              : waidCandidates[0];
          const waData = await fetchAthleteFromWaService(preferredWaid, settings);
          waIdentity = waData?._waIdentity || null;
        } catch {
          waIdentity = null;
        }
      }

      const mergedEditions = mergeRegistryEditions(sortedEntries);
      const pickManualOrAuto = (field, autoValue) => {
        const overrideEntry = getOverrideEntry(field);
        if (!overrideEntry) return autoValue;
        return getDuplicateEntryFieldValue(overrideEntry, field) || null;
      };

      const canonicalLastName = pickManualOrAuto(
        "lastName",
        waIdentity?.lastName || primary.lastName || pickMostFrequentValue(sortedEntries.map((entry) => entry.lastName)) || "",
      ) || "";
      const canonicalFirstName = pickManualOrAuto(
        "firstName",
        waIdentity?.firstName || primary.firstName || pickMostFrequentValue(sortedEntries.map((entry) => entry.firstName)) || "",
      ) || "";
      const canonicalNationality = pickManualOrAuto(
        "nationality",
        waIdentity?.countryCode || primary.nationality || pickMostFrequentValue(sortedEntries.map((entry) => entry.nationality)) || "",
      ) || "";
      const canonicalBirthDate = pickManualOrAuto(
        "birthDate",
        waIdentity?.birthDate || primary.birthDate || pickMostFrequentValue(sortedEntries.map((entry) => entry.birthDate)) || null,
      ) || null;
      const canonicalBirthYear = pickManualOrAuto(
        "birthYear",
        resolveAthleteBirthYear({
          birthYear: primary.birthYear || primary.yob,
          birthDate: canonicalBirthDate,
        }) || pickMostFrequentValue(sortedEntries.map((entry) => resolveAthleteBirthYear(entry)).filter(Boolean)),
      ) || null;
      const canonicalGender = pickManualOrAuto(
        "gender",
        primary.gender || pickMostFrequentValue(sortedEntries.map((entry) => entry.gender)) || null,
      ) || null;
      const canonicalWaid = pickManualOrAuto(
        "waid",
        waIdentity?.waid || primary.waid || waidCandidates[0] || null,
      ) || null;
      const canonicalWaUrl = pickManualOrAuto(
        "waUrl",
        waIdentity?.waUrl || primary.waUrl || pickMostFrequentValue(sortedEntries.map((entry) => entry.waUrl)) || null,
      ) || null;

      const canonicalIdentity = {
        lastName: canonicalLastName,
        firstName: canonicalFirstName,
        nationality: canonicalNationality,
        birthYear: canonicalBirthYear,
        birthDate: canonicalBirthDate,
      };

      const mergedIdentityKeys = [
        ...new Set([
          ...sortedEntries.flatMap((entry) => Array.isArray(entry.identityKeys) ? entry.identityKeys : buildAthleteIdentityKeys(entry)),
          ...buildAthleteIdentityKeys(canonicalIdentity),
        ]),
      ];

      const batch = writeBatch(db);
      batch.set(
        doc(db, ATHLETE_REGISTRY_COLLECTION, primary._docId),
        {
          lastName: canonicalLastName,
          firstName: canonicalFirstName,
          nationality: canonicalNationality,
          editions: mergedEditions,
          identityKeys: mergedIdentityKeys,
          updatedAt: serverTimestamp(),
          createdAt: primary.createdAt || serverTimestamp(),
          mergedDuplicateIds: sortedEntries.map((entry) => entry._docId),
          ...(canonicalBirthDate ? { birthDate: canonicalBirthDate } : {}),
          ...(canonicalBirthYear ? { birthYear: Number(canonicalBirthYear), yob: Number(canonicalBirthYear) } : {}),
          ...(canonicalGender ? { gender: canonicalGender } : {}),
          ...(canonicalWaid ? { waid: Number(canonicalWaid) } : {}),
          ...(canonicalWaUrl ? { waUrl: canonicalWaUrl } : {}),
        },
        { merge: false },
      );

      duplicates.forEach((entry) => {
        batch.delete(doc(db, ATHLETE_REGISTRY_COLLECTION, entry._docId));
      });

      linkedCurrentAthletes.forEach((athlete) => {
        batch.set(
          doc(db, ATHLETES_COLLECTION, athlete.id),
          {
            registryAthleteId: primary._docId,
            lastName: canonicalLastName || athlete.lastName,
            firstName: canonicalFirstName || athlete.firstName,
            nationality: canonicalNationality || athlete.nationality,
            ...(canonicalBirthDate ? { birthDate: canonicalBirthDate } : {}),
            ...(canonicalBirthYear ? { birthYear: Number(canonicalBirthYear) } : {}),
            ...(canonicalWaid ? { waid: Number(canonicalWaid) } : {}),
            ...(canonicalWaUrl ? { waUrl: canonicalWaUrl } : {}),
          },
          { merge: true },
        );
      });

      await batch.commit();
      setSelectedRegistryDocId(primary._docId);
      setSelectedRegistryIds((current) => current.filter((docId) => !sortedEntries.some((entry) => entry._docId === docId)));
      setMergeStatus(tr(
        `✅ ${sortedEntries.length} fiches fusionnées pour ${canonicalFirstName || ""} ${canonicalLastName || ""}`,
        `✅ ${sortedEntries.length} profiles merged for ${canonicalFirstName || ""} ${canonicalLastName || ""}`,
      ).trim());
      setMergeOverrides((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
    } catch (error) {
      setMergeStatus(`❌ ${error.message}`);
    } finally {
      setMergingGroupId("");
    }
  }

  // A fiche linked to an entry of the current edition is only deleted together
  // with that entry (withLinkedEntries), e.g. an imported line such as
  // "1 Platz Kenya"; otherwise it is kept and must be corrected or merged.
  async function handleDeleteRegistryEntries(entries, { withLinkedEntries = false } = {}) {
    const linkedOf = (entry) => currentAthletesByRegistryId.get(entry._docId) || [];
    const linked = withLinkedEntries ? [] : entries.filter((entry) => linkedOf(entry).length > 0);
    const deletable = entries.filter((entry) => !linked.includes(entry));
    const linkedAthletes = withLinkedEntries ? deletable.flatMap(linkedOf) : [];
    if (!deletable.length) {
      setCleanupStatus(tr(
        "Ces fiches sont liées à des engagés de l'édition en cours : utilise « Supprimer avec l'engagé » si l'engagé est lui aussi faux, sinon corrige le nom ou fusionne.",
        "These profiles are linked to entries of the current edition: use “Delete with the entry” if the entry is also wrong, otherwise fix the name or merge.",
      ));
      return false;
    }
    const names = deletable.slice(0, 8).map((entry) => [entry.firstName, entry.lastName].filter(Boolean).join(" ") || entry._docId).join("\n");
    const more = deletable.length > 8 ? tr(`\n… et ${deletable.length - 8} autre(s)`, `\n… and ${deletable.length - 8} more`) : "";
    const skipped = linked.length
      ? tr(
        `\n\n${linked.length} fiche(s) liée(s) à des engagés seront gardées.`,
        `\n\n${linked.length} profile(s) linked to entries will be kept.`,
      )
      : "";
    const athleteLines = linkedAthletes
      .slice(0, 8)
      .map((athlete) => `• ${[athlete.firstName, athlete.lastName].filter(Boolean).join(" ")} — ${athlete.event || tr("épreuve ?", "event?")}${athlete.status ? ` (${athlete.status})` : ""}`)
      .join("\n");
    const athletesNote = linkedAthletes.length
      ? tr(
        `\n\nAinsi que ${linkedAthletes.length} engagé(s) de l'édition en cours :\n${athleteLines}`,
        `\n\nAs well as ${linkedAthletes.length} entr${linkedAthletes.length > 1 ? "ies" : "y"} of the current edition:\n${athleteLines}`,
      )
      : "";
    if (!window.confirm(tr(
      `Supprimer définitivement ${deletable.length} fiche(s) de la base athlètes ?\n\n${names}${more}${athletesNote}${skipped}`,
      `Permanently delete ${deletable.length} profile(s) from the athlete database?\n\n${names}${more}${athletesNote}${skipped}`,
    ))) return false;

    setCleanupDeleting(true);
    setCleanupStatus("");
    try {
      const refs = [
        ...deletable.map((entry) => doc(db, ATHLETE_REGISTRY_COLLECTION, entry._docId)),
        ...linkedAthletes.map((athlete) => doc(db, ATHLETES_COLLECTION, athlete.id)),
      ];
      for (let index = 0; index < refs.length; index += 400) {
        const batch = writeBatch(db);
        refs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      if (deletable.some((entry) => entry._docId === selectedRegistryDocId)) setSelectedRegistryDocId("");
      setSelectedRegistryIds((current) => current.filter((docId) => !deletable.some((entry) => entry._docId === docId)));
      setCleanupStatus(tr(
        `✅ ${deletable.length} fiche(s) supprimée(s)${linkedAthletes.length ? ` et ${linkedAthletes.length} engagé(s)` : ""}.${linked.length ? ` ${linked.length} gardée(s) car liée(s) à des engagés.` : ""}`,
        `✅ ${deletable.length} profile(s) deleted${linkedAthletes.length ? ` and ${linkedAthletes.length} entr${linkedAthletes.length > 1 ? "ies" : "y"}` : ""}.${linked.length ? ` ${linked.length} kept because linked to entries.` : ""}`,
      ));
      return true;
    } catch (error) {
      setCleanupStatus(`❌ ${error.message}`);
      return false;
    } finally {
      setCleanupDeleting(false);
    }
  }

  function openRegistryEntry(docId) {
    setSelectedRegistryDocId(docId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!canAccess) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>{tr("Base athlètes", "Athlete database")}</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>{tr("Accès restreint", "Restricted access")}</strong>
          <p>{tr("Réservé aux admins, au meeting director et aux gestionnaires.", "Reserved for admins, the meeting director and managers.")}</p>
        </div>
      </div>
    );
  }

  const maintenancePanel = (
    <Panel
      title="Maintenance"
      subtitle={tr(
        "Reconstruire la base athlètes historique à partir des résultats corrigés du meeting",
        "Rebuild the historical athlete database from the corrected meeting results",
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p className="panel-note" style={{ margin: 0 }}>
          {tr("Cette action vide complètement ", "This action completely empties ")}<code>athleteRegistry</code>
          {tr(", puis le reconstruit à partir de", ", then rebuilds it from")}
          <code> meetingResults.json</code>
          {tr(
            ". « Séparer les homonymes » ne touche qu'aux fiches qui mélangent deux athlètes du même nom et garde toutes les fusions déjà faites.",
            ". “Split homonyms” only touches profiles that mix two athletes with the same name and keeps all merges already done.",
          )}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="button button--danger"
            disabled={rebuilding}
            onClick={async () => {
              if (!window.confirm(tr(
                `Vider complètement la base athlètes puis la reconstruire depuis les résultats historiques corrigés ?\n\nATTENTION : ${withWaidCount} fiche(s) ont un WAID et toutes les fusions seront perdues.`,
                `Completely empty the athlete database and rebuild it from the corrected historical results?\n\nWARNING: ${withWaidCount} profile(s) have a WAID and all merges will be lost.`,
              ))) return;
              setRebuildLog([]);
              setRebuilding(true);
              try {
                const summary = await rebuildAthleteRegistryFromHistoricalResults((msg) => {
                  setRebuildLog((prev) => [...prev, msg]);
                });
                setRebuildLog((prev) => [
                  ...prev,
                  tr(
                    `✅ Base athlètes reconstruite : ${summary.deleted} supprimés, ${summary.written} recréés, source ${summary.sourceRows} lignes.`,
                    `✅ Athlete database rebuilt: ${summary.deleted} deleted, ${summary.written} recreated, source ${summary.sourceRows} rows.`,
                  ),
                ]);
              } catch (error) {
                setRebuildLog((prev) => [...prev, `❌ ${error.message}`]);
              } finally {
                setRebuilding(false);
              }
            }}
          >
            {rebuilding ? tr("Reconstruction…", "Rebuilding…") : tr("Vider et reconstruire la base athlètes", "Empty and rebuild the athlete database")}
          </button>
          <button
            className="button button--secondary"
            disabled={rebuilding}
            onClick={async () => {
              if (!window.confirm(tr(
                "Séparer les homonymes (même nom, années de naissance différentes dans meetingResults.json) ?\n\nLes autres fiches et les fusions déjà faites ne sont pas touchées.",
                "Split homonyms (same name, different birth years in meetingResults.json)?\n\nOther profiles and merges already done are not touched.",
              ))) return;
              setRebuildLog([]);
              setRebuilding(true);
              try {
                await splitHistoricalHomonyms((msg) => {
                  setRebuildLog((prev) => [...prev, msg]);
                });
                setRebuildLog((prev) => [...prev, tr("✅ Séparation terminée.", "✅ Split done.")]);
              } catch (error) {
                setRebuildLog((prev) => [...prev, `❌ ${error.message}`]);
              } finally {
                setRebuilding(false);
              }
            }}
          >
            {tr("Séparer les homonymes", "Split homonyms")}
          </button>
        </div>
        {rebuildLog.length > 0 ? (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 14,
              padding: "0.9rem 1rem",
              fontFamily: "monospace",
              fontSize: "0.82rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {rebuildLog.join("\n")}
          </div>
        ) : null}
      </div>
    </Panel>
  );
  if (maintenance === "only") return maintenancePanel;

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Portail athlètes", "Athlete portal")}</p>
          <h1>{tr("Base athlètes", "Athlete database")}</h1>
          <p>
            {loading
              ? tr("Chargement…", "Loading…")
              : tr(`${registry.length} athlètes, toutes éditions confondues`, `${registry.length} athletes, all editions combined`)}
            {" · "}{tr("Se complète automatiquement à chaque import ou synchro WA.", "Fills in automatically with each import or WA sync.")}
          </p>
        </div>
      </section>

      <section className="panel-grid panel-grid--1">
        {maintenance === "hide" ? null : maintenancePanel}

        {selectedRegistryEntry ? null : (
          <AthleteRegistryAnalysisPanel
            Panel={Panel}
            rows={registryFilterState.filteredRows}
            hasFilters={registryFilterState.hasFilters}
            onOpen={openRegistryEntry}
          />
        )}

        {/* « À nettoyer » et « Doublons probables » : base corrigée en
            novembre 2026, plus affichés dans Statistiques › Athlètes. */}
        {maintenance === "hide" ? null : (<>
        <AthleteRegistryCleanupPanel
          Panel={Panel}
          rows={suspectRows}
          getLinkedCount={(docId) => (currentAthletesByRegistryId.get(docId) || []).length}
          onOpen={openRegistryEntry}
          onDelete={handleDeleteRegistryEntries}
          deleting={cleanupDeleting}
          status={cleanupStatus}
        />

        <Panel
          title={tr("Doublons probables", "Likely duplicates")}
          subtitle={tr(
            `${duplicateGroups.length} groupe${duplicateGroups.length > 1 ? "s" : ""} détecté${duplicateGroups.length > 1 ? "s" : ""}`,
            `${duplicateGroups.length} group${duplicateGroups.length > 1 ? "s" : ""} detected`,
          )}
        >
          {mergeStatus ? <p className="panel-note" style={{ marginTop: 0 }}>{mergeStatus}</p> : null}
          {dismissedDuplicateGroupIds.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.85rem" }}>
              <p className="panel-note" style={{ margin: 0 }}>
                {tr(
                  `${dismissedDuplicateGroupIds.length} groupe${dismissedDuplicateGroupIds.length > 1 ? "s" : ""} masqué${dismissedDuplicateGroupIds.length > 1 ? "s" : ""}.`,
                  `${dismissedDuplicateGroupIds.length} group${dismissedDuplicateGroupIds.length > 1 ? "s" : ""} hidden.`,
                )}
              </p>
              <button
                type="button"
                className="button button--neutral"
                disabled={dismissingGroupId === "restore-all"}
                onClick={handleRestoreDismissedDuplicates}
              >
                {dismissingGroupId === "restore-all" ? tr("Réaffichage…", "Restoring…") : tr("Réafficher tous", "Show all again")}
              </button>
            </div>
          ) : null}
          {duplicateGroups.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              {tr("Aucun doublon probable détecté pour le moment.", "No likely duplicate detected for now.")}
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.85rem" }}>
              {duplicateGroups.map((group) => (
                <div
                  key={group.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: "0.9rem 1rem",
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        {tr(`${group.entries.length} fiches à fusionner`, `${group.entries.length} profiles to merge`)}
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        {group.reasons.map((reason) => (
                          <span key={reason} className="status-pill status-pill--accent">{duplicateReasonLabel(reason, tr)}</span>
                        ))}
                        {group.hasNationalityConflict ? (
                          <span className="status-pill status-pill--warn">{tr("Nationalités différentes", "Different nationalities")}</span>
                        ) : null}
                        {getRegistryEntryDisciplines(group.primary).slice(0, 4).map((discipline) => (
                          <span key={discipline} className="status-pill">{discipline}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button button--neutral"
                        disabled={dismissingGroupId === group.id}
                        onClick={() => handleDismissDuplicateGroup(group)}
                      >
                        {dismissingGroupId === group.id ? tr("Masquage…", "Hiding…") : tr("Pas un doublon", "Not a duplicate")}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={mergingGroupId === group.id}
                        onClick={() => handleMergeDuplicateGroup(group)}
                      >
                        {mergingGroupId === group.id ? tr("Fusion…", "Merging…") : tr("Fusionner", "Merge")}
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "0.75rem",
                      marginTop: "0.85rem",
                      marginBottom: "0.85rem",
                    }}
                  >
                    {DUPLICATE_MERGE_FIELDS.map((field) => {
                      const selectedSource = mergeOverrides[group.id]?.[field.key] || "auto";
                      const selectedEntry = group.entries.find((entry) => entry._docId === selectedSource) || null;
                      const selectedValue = selectedEntry
                        ? getDuplicateEntryFieldValue(selectedEntry, field.key)
                        : null;
                      return (
                        <label
                          key={field.key}
                          className="field"
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: "0.7rem 0.8rem",
                            background: "#f8fafc",
                          }}
                        >
                          <span>{tr(field.label, field.labelEn)}</span>
                          <select
                            value={selectedSource}
                            onChange={(event) => setMergeOverride(group.id, field.key, event.target.value)}
                          >
                            <option value="auto">Auto</option>
                            {group.entries.map((entry) => (
                              <option key={entry._docId} value={entry._docId}>
                                {getDuplicateEntryLabel(entry, tr)}
                              </option>
                            ))}
                          </select>
                          <span className="panel-note" style={{ marginTop: 4 }}>
                            {selectedSource === "auto"
                              ? tr("Auto = WA si disponible, sinon meilleure fiche détectée.", "Auto = WA if available, otherwise best profile detected.")
                              : tr(`Garder : ${formatDuplicateFieldValue(selectedValue, field.key)}`, `Keep: ${formatDuplicateFieldValue(selectedValue, field.key)}`)}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{tr("Priorité", "Priority")}</th>
                          <th>{tr("Athlète", "Athlete")}</th>
                          <th>Nat.</th>
                          <th>{tr("Naissance", "Birth")}</th>
                          <th>Disciplines</th>
                          <th>WAID</th>
                          <th>{tr("Éditions", "Editions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry, index) => {
                          const years = [...new Set((entry.editions || []).map((edition) => edition.year).filter(Boolean))].sort((a, b) => a - b);
                          return (
                            <tr key={entry._docId}>
                              <td>{index === 0 ? <span className="status-pill status-pill--ok">{tr("Base", "Primary")}</span> : index + 1}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => setSelectedRegistryDocId(entry._docId)}
                                  style={{
                                    appearance: "none",
                                    border: "none",
                                    background: "transparent",
                                    padding: 0,
                                    margin: 0,
                                    cursor: "pointer",
                                    color: "#1d4ed8",
                                    fontWeight: 600,
                                    textAlign: "left",
                                  }}
                                >
                                  {[entry.firstName, entry.lastName].filter(Boolean).join(" ") || "—"}
                                </button>
                              </td>
                              <td>{entry.nationality || "—"}</td>
                              <td>{entry.birthDate ? entry.birthDate.slice(0, 10) : (getRegistryEntryYear(entry) || "—")}</td>
                              <td style={{ fontSize: "0.82rem", color: "#475569" }}>
                                {getRegistryEntryDisciplines(entry).join(", ") || "—"}
                              </td>
                              <td>{entry.waid || "—"}</td>
                              <td>{years.length > 0 ? years.join(", ") : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        </>)}

        {selectedRegistryIds.length > 0 ? (
          <Panel
            title={tr("Fusion manuelle", "Manual merge")}
            subtitle={tr(
              `${selectedRegistryIds.length} fiche${selectedRegistryIds.length > 1 ? "s" : ""} sélectionnée${selectedRegistryIds.length > 1 ? "s" : ""}`,
              `${selectedRegistryIds.length} profile${selectedRegistryIds.length > 1 ? "s" : ""} selected`,
            )}
          >
            {manualMergeGroup ? (
              <div style={{ display: "grid", gap: "0.85rem" }}>
                <div
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: "0.9rem 1rem",
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        {tr("Fusionner la sélection", "Merge the selection")}
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        {manualMergeGroup.reasons.map((reason) => (
                          <span key={reason} className="status-pill status-pill--accent">{duplicateReasonLabel(reason, tr)}</span>
                        ))}
                        {manualMergeGroup.hasNationalityConflict ? (
                          <span className="status-pill status-pill--warn">{tr("Nationalités différentes", "Different nationalities")}</span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button button--neutral"
                        onClick={() => setSelectedRegistryIds([])}
                      >
                        {tr("Tout vider", "Clear all")}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={mergingGroupId === manualMergeGroup.id}
                        onClick={() => handleMergeDuplicateGroup(manualMergeGroup)}
                      >
                        {mergingGroupId === manualMergeGroup.id ? tr("Fusion…", "Merging…") : tr("Fusionner la sélection", "Merge the selection")}
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "0.75rem",
                      marginTop: "0.85rem",
                      marginBottom: "0.85rem",
                    }}
                  >
                    {DUPLICATE_MERGE_FIELDS.map((field) => {
                      const selectedSource = mergeOverrides[manualMergeGroup.id]?.[field.key] || "auto";
                      const selectedEntry = manualMergeGroup.entries.find((entry) => entry._docId === selectedSource) || null;
                      const selectedValue = selectedEntry
                        ? getDuplicateEntryFieldValue(selectedEntry, field.key)
                        : null;
                      return (
                        <label
                          key={field.key}
                          className="field"
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: "0.7rem 0.8rem",
                            background: "#f8fafc",
                          }}
                        >
                          <span>{tr(field.label, field.labelEn)}</span>
                          <select
                            value={selectedSource}
                            onChange={(event) => setMergeOverride(manualMergeGroup.id, field.key, event.target.value)}
                          >
                            <option value="auto">Auto</option>
                            {manualMergeGroup.entries.map((entry) => (
                              <option key={entry._docId} value={entry._docId}>
                                {getDuplicateEntryLabel(entry, tr)}
                              </option>
                            ))}
                          </select>
                          <span className="panel-note" style={{ marginTop: 4 }}>
                            {selectedSource === "auto"
                              ? tr("Auto = WA si disponible, sinon meilleure fiche détectée.", "Auto = WA if available, otherwise best profile detected.")
                              : tr(`Garder : ${formatDuplicateFieldValue(selectedValue, field.key)}`, `Keep: ${formatDuplicateFieldValue(selectedValue, field.key)}`)}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{tr("Base", "Primary")}</th>
                          <th>{tr("Athlète", "Athlete")}</th>
                          <th>Nat.</th>
                          <th>{tr("Naissance", "Birth")}</th>
                          <th>Disciplines</th>
                          <th>WAID</th>
                          <th>{tr("Éditions", "Editions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualMergeGroup.entries.map((entry, index) => {
                          const years = [...new Set((entry.editions || []).map((edition) => edition.year).filter(Boolean))].sort((a, b) => a - b);
                          return (
                            <tr key={entry._docId}>
                              <td>{index === 0 ? <span className="status-pill status-pill--ok">{tr("Base", "Primary")}</span> : index + 1}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => setSelectedRegistryDocId(entry._docId)}
                                  style={{
                                    appearance: "none",
                                    border: "none",
                                    background: "transparent",
                                    padding: 0,
                                    margin: 0,
                                    cursor: "pointer",
                                    color: "#1d4ed8",
                                    fontWeight: 600,
                                    textAlign: "left",
                                  }}
                                >
                                  {[entry.firstName, entry.lastName].filter(Boolean).join(" ") || "—"}
                                </button>
                              </td>
                              <td>{entry.nationality || "—"}</td>
                              <td>{entry.birthDate ? entry.birthDate.slice(0, 10) : (getRegistryEntryYear(entry) || "—")}</td>
                              <td style={{ fontSize: "0.82rem", color: "#475569" }}>
                                {getRegistryEntryDisciplines(entry).join(", ") || "—"}
                              </td>
                              <td>{entry.waid || "—"}</td>
                              <td>{years.length > 0 ? years.join(", ") : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <p className="panel-note" style={{ margin: 0 }}>
                  {tr("Sélectionne au moins 2 fiches dans le tableau pour lancer une fusion manuelle.", "Select at least 2 profiles in the table to start a manual merge.")}
                </p>
                <button
                  type="button"
                  className="button button--neutral"
                  onClick={() => setSelectedRegistryIds([])}
                >
                  {tr("Tout vider", "Clear all")}
                </button>
              </div>
            )}
          </Panel>
        ) : null}

        {selectedRegistryEntry ? (
          <AthleteProfilePanel
            Panel={Panel}
            registryEntry={selectedRegistryEntry}
            currentAthletes={selectedCurrentAthletes}
            onClear={() => setSelectedRegistryDocId("")}
            title={athletesLoading ? tr("Fiche athlète (liaison en cours…)", "Athlete profile (linking…)") : tr("Fiche athlète", "Athlete profile")}
            editable
            registry={registry}
            onMergeWith={handleMergeSameWaid}
          />
        ) : null}

        <Panel
          title={tr("Rechercher", "Search")}
          subtitle={tr(
            `${withWaidCount} / ${registry.length} fiches avec WAID · clique sur un titre de colonne pour trier`,
            `${withWaidCount} / ${registry.length} profiles with a WAID · click a column header to sort`,
          )}
        >
          {loading ? (
            <p className="panel-note">{tr("Chargement de la base…", "Loading the database…")}</p>
          ) : registry.length === 0 ? (
            <div className="notice-card">
              <strong>{tr("La base athlètes est vide", "The athlete database is empty")}</strong>
              <p>{tr("Importe des athlètes ou lance une synchro WA pour la remplir.", "Import athletes or run a WA sync to fill it.")}</p>
            </div>
          ) : (
            <>
              <AthleteRegistryFilters
                state={registryFilterState}
                totalCount={registry.length}
                selectedCount={selectedRegistryIds.length}
                onClearSelection={() => setSelectedRegistryIds([])}
              />
              <AthleteRegistryTable
                state={registryFilterState}
                selectedIds={selectedRegistryIds}
                onToggle={toggleRegistrySelection}
                onOpen={openRegistryEntry}
                openDocId={selectedRegistryDocId}
              />
            </>
          )}
          <p className="panel-note" style={{ marginTop: "0.5rem" }}>
            {tr(
              "Les fiches sont permanentes : un athlète n'est jamais retiré de cette base, même s'il n'apparaît plus dans la liste de départ de l'édition en cours. L'identité (nom, naissance, WAID, lien WA) est conservée pour toujours.",
              "Profiles are permanent: an athlete is never removed from this database, even if they no longer appear in the start list of the current edition. The identity (name, birth, WAID, WA link) is kept forever.",
            )}
          </p>
        </Panel>
      </section>

    </div>
  );
}

export { AthletePortalOverview, AthletesListPage, AthleteImportPage, AthletePortalSettingsPage, AthleteRegistryPage };
