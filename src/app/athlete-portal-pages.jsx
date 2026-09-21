import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { getActiveRoles } from "./navigation";
import {
  ALL_ATHLETE_FIELDS,
  ATHLETES_COLLECTION,
  ATHLETE_REGISTRY_COLLECTION,
  DEFAULT_PORTAL_SETTINGS,
  FIELD_GROUPS,
  athleteMergeKey,
  rebuildAthleteRegistryFromHistoricalResults,
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
} from "./athlete-portal-hooks";
import { db } from "../services/firebase";

const PLATFORM_ROLES = [
  { key: "admin",                      label: "Administrator" },
  { key: "meeting_director",           label: "Meeting Director" },
  { key: "gestionnaire",               label: "Manager (Gestionnaire)" },
  { key: "chef_equipe",                label: "Team Leader (Chef d'équipe)" },
  { key: "benevole",                   label: "Volunteer (Bénévole)" },
  { key: "parent_u14",                 label: "U14 Parent" },
  { key: "chef_transport_athletes",    label: "Chef du Transport Athlètes" },
  { key: "benevole_transport_athletes", label: "Bénévole Transport Athlètes" },
];

// ─── Travel entry parser ──────────────────────────────────────────────────────
// Parses strings like "17. flight 21:45 with LG8254 from Nice"
//                  or "19. flight 06:00 with LG3759 to Lisbon"
// into structured fields: day, time, flightNo, dir ("from"|"to"), city.

// Flexible travel regex:
//   "17. flight 21:45 with LG3752 from Lisbon"
//   "16. flight 22:20 with KL 1715 from AMS"   ← space in flight no.
//   "17. flight 10:15 LH9528 from Frankfurt"    ← no "with"
//   "17. flight 17:50 with KL1713"              ← no city
const _TRAVEL_RE = /^(\d+)\.\s+(\S+)\s+(\d{1,2}:\d{2})\s+(?:with\s+)?([A-Z]{1,3}\s*\d+[A-Z0-9]*)(?:\s+(from|to)\s+(.+))?$/i;

function parseTravelEntry(text) {
  if (!text) return null;
  const m = _TRAVEL_RE.exec(String(text).trim());
  if (!m) return null;
  return {
    day:      parseInt(m[1], 10),
    mode:     m[2].toLowerCase(),
    time:     m[3],
    flightNo: m[4].replace(/\s+/g, "").toUpperCase(), // "KL 1715" → "KL1715"
    dir:      (m[5] || "").toLowerCase(),              // "from" | "to" | ""
    city:     (m[6] || "").trim(),
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

function TravelCell({ raw, prefix }) {
  if (!raw) return <span style={{ color: "#bbb" }}>—</span>;
  const p = parseTravelEntry(raw);
  if (!p) return <span style={{ fontSize: "0.82rem", color: "#555" }}>{raw}</span>;
  const arrow = prefix === "arrival" ? "← " : "→ ";
  return (
    <div style={{ lineHeight: 1.65, fontSize: "0.82rem" }}>
      <div style={{ fontWeight: 600 }}>
        Jour {p.day}{p.time ? ` · ${p.time}` : ""}
      </div>
      <div style={{ color: "#555" }}>
        ✈ {p.flightNo} {arrow}{p.city}
      </div>
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
  waUrl:        [/^wa\s?(url|profile)?$/, /^world\s?athletics$/],
  heat:         [/^heat$/,           /^série$/,      /^serie$/],
  lane:         [/^lane$/,           /^couloir$/],
  manager:      [/^manager$/,        /^gestionnaire$/],
  arrival:      [/^arrival$/,        /^anreise$/,    /^arrivée$/,    /^arrivee$/],
  departure:    [/^departure$/,      /^abreise$/,    /^départ$/,     /^depart$/],
};

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
    return { type: "COMBINED", colMap: bestMap, dataStartIdx: bestHeaderIdx + 1 };
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
  const lastName = norm(row[1]);
  const firstName = norm(row[2]);
  if (!lastName || !firstName) return null;
  const arrival   = norm(row[5]) || null;
  const departure = norm(row[6]) || null;
  return {
    event: norm(row[0]), lastName, firstName,
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
  const lastName  = g("lastName");
  const firstName = g("firstName");
  if (!lastName && !firstName) return null;

  const rawPb   = g("pb");
  const rawWaUrl = g("waUrl");
  const { indoor: parsedPbIn, outdoor: parsedPbOut } = parsePb(rawPb);
  const rawLane = g("lane");

  return {
    event:        g("event")        || null,
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
    arrival:   g("arrival")   || null,
    departure: g("departure") || null,
    ...expandTravelField(g("arrival")   || null, "arrival"),
    ...expandTravelField(g("departure") || null, "departure"),
  };
}

function parseRows(rows, detected) {
  const { type, colMap, dataStartIdx } = detected;
  if (type === "START_LIST")  return rows.slice(dataStartIdx).map(parseStartListRow).filter(Boolean);
  if (type === "FINAL_LANES") return parseFinaLanesRows(rows.slice(dataStartIdx));
  if (type === "TRAVEL")      return rows.slice(dataStartIdx).map(parseTravelRow).filter(Boolean);
  if (type === "COMBINED")    return rows.slice(dataStartIdx).map((r) => parseCombinedRow(r, colMap)).filter(Boolean);
  return [];
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

function mergeAthletes(existing, incoming, fileType, presentFields = null) {
  const byKey = new Map(
    existing.map((a) => [athleteMergeKey(a.lastName, a.firstName, a.nationality), { ...a }]),
  );
  const matchedKeys = new Set(); // tracks which existing athletes appear in this import
  let added = 0;
  let updated = 0;

  for (const record of incoming) {
    const key = athleteMergeKey(record.lastName, record.firstName, record.nationality);
    const ex = byKey.get(key);

    if (!ex) { byKey.set(key, { ...record }); added++; continue; }

    matchedKeys.add(key);
    const merged = { ...ex };

    if (fileType === "COMBINED") {
      const hasColumn = (field) => !presentFields || presentFields.includes(field);
      if (record.event)                merged.event        = record.event;
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
      if (hasColumn("heat")) merged.heat = record.heat ?? null;
      if (hasColumn("lane")) merged.lane = record.lane ?? null;
      applyTravelFields(merged, record, presentFields);
    } else if (fileType === "TRAVEL") {
      applyTravelFields(merged, record, null);
    } else if (fileType === "FINAL_LANES") {
      if (record.heat !== null) merged.heat = record.heat;
      if (record.lane !== null) merged.lane = record.lane;
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

    byKey.set(key, merged);
    updated++;
  }

  // For COMBINED / START_LIST: athletes in the DB but absent from this import
  // → mark as "out", clear heat/lane/travel (they're no longer on the start list).
  // They are NEVER deleted — they stay in the system permanently.
  let markedOut = 0;
  if (fileType === "COMBINED" || fileType === "START_LIST") {
    for (const [key, athlete] of byKey) {
      if (athlete.id && !matchedKeys.has(key)) {
        byKey.set(key, {
          ...athlete,
          status:    "out",
          heat: null, lane: null, manager: null,
          arrival: null, arrivalDay: null, arrivalTime: null, arrivalFlight: null, arrivalFrom: null,
          departure: null, departureDay: null, departureTime: null, departureFlight: null, departureTo: null,
        });
        markedOut++;
      }
    }
  }

  return { merged: [...byKey.values()], added, updated, markedOut };
}

// ─── Small shared components ─────────────────────────────────────────────────

function StatusBadge({ status }) {
  if (!status) return "—";
  if (status === "ok")  return <span className="status-pill status-pill--ok">OK</span>;
  if (status === "out") return <span className="status-pill status-pill--warn">Out</span>;
  return <span className="status-pill">{status}</span>;
}

function WaBadge({ value }) {
  if (!value) return <span style={{ color: "#aaa" }}>—</span>;
  return <span className="status-pill status-pill--accent" title="Source: World Athletics">{value}</span>;
}

function FileTypeBadge({ type }) {
  const map = {
    COMBINED:    ["Combined (all data)", "status-pill status-pill--accent"],
    START_LIST:  ["Start list",          "status-pill status-pill--accent"],
    FINAL_LANES: ["Heats & Lanes",       "status-pill"],
    TRAVEL:      ["Travel",              "status-pill"],
    UNKNOWN:     ["Unknown",             "status-pill status-pill--warn"],
  };
  const [label, cls] = map[type] ?? map.UNKNOWN;
  return <span className={cls}>{label}</span>;
}

// ─── Inline WAID editor ───────────────────────────────────────────────────────

function WaidCell({ athlete, onSave }) {
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
      title="Click to edit WAID"
      onClick={() => { setValue(athlete.waid ?? ""); setEditing(true); }}
    >
      {athlete.waid ?? <span style={{ color: "#aaa", fontStyle: "italic" }}>— add</span>}
    </span>
  );
}

// ─── WA sync button ───────────────────────────────────────────────────────────

function WaSyncButton({ athlete, settings, onDone }) {
  const [status, setStatus] = useState(null); // null | "syncing" | "ok" | "error"
  const [error, setError] = useState("");

  if (!athlete.waid) return <span style={{ color: "#ccc", fontSize: "0.8rem" }}>no WAID</span>;

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

  if (status === "syncing") return <span style={{ color: "#888", fontSize: "0.8rem" }}>syncing…</span>;
  if (status === "ok")      return <span className="status-pill status-pill--ok" style={{ fontSize: "0.75rem" }}>synced ✓</span>;

  if (status === "error") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxWidth: 220 }}>
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <span className="status-pill status-pill--warn" style={{ fontSize: "0.75rem" }}>error ✕</span>
        <button className="button button--ghost button--small" type="button" onClick={handleSync} title="Retry">↻</button>
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
    <button className="button button--ghost button--small" type="button" onClick={handleSync}>
      ↻ WA
    </button>
  );
}

// ─── Overview page ────────────────────────────────────────────────────────────

function AthletePortalOverview({ Panel }) {
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { athletes, loading: athletesLoading } = useAthletes(!settingsLoading);
  const isAdmin = roles.includes("admin") || roles.includes("meeting_director");

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
      const ev = String(a.event || "Unknown").trim();
      counts[ev] = (counts[ev] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [athletes]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Overview</h1>
          <p>
            Seasons: <strong>Indoor {seasons.indoor}</strong>
            {seasons.indoorCurrent && seasons.indoorCurrent !== seasons.indoor && (
              <> · <strong>Indoor {seasons.indoorCurrent}</strong> <span style={{ fontWeight: "normal", color: "#888" }}>(current, few results)</span></>
            )}
            {" · "}<strong>Outdoor {seasons.outdoor}</strong>
          </p>
        </div>
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title="Roster">
          {athletesLoading ? <p className="panel-note">Loading…</p> : (
            <ul className="compact-list">
              <li><strong>{athletes.length}</strong> athletes · <strong>{stats.nations}</strong> nations · <strong>{eventCounts.length}</strong> events</li>
              <li>Status: <strong>{stats.ok}</strong> confirmed · <strong>{stats.out}</strong> withdrawn</li>
              <li>Lanes assigned: <strong>{stats.withLane}</strong></li>
              <li>Travel info: <strong>{stats.withTravel}</strong></li>
              <li>WAID known: <strong>{stats.withWaid}</strong> · WA synced: <strong>{stats.waSynced}</strong></li>
            </ul>
          )}
        </Panel>
        <Panel title="Quick access">
          <div className="dashboard-action-grid">
            <NavLink className="button button--secondary button-link" to="/app/athlete-portal/athletes">View athletes</NavLink>
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/statistics/registry">Athletes database</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/statistics/results">Meeting results</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/statistics/records">Meeting records</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/statistics/winners">Hall of winners</NavLink>}
            {isAdmin && <NavLink className="button button--secondary button-link" to="/app/athlete-portal/settings">Portal settings</NavLink>}
          </div>
        </Panel>
      </section>

      {eventCounts.length > 0 && (
        <section className="panel-grid panel-grid--1">
          <Panel title="Events">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Event</th><th>Athletes</th></tr></thead>
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
function getCompPace(a) {
  return a.waIndoorSbCurrent || a.waIndoorSb || a.waOutdoorSb
      || a.waPbIndoor || a.waPbOutdoor
      || a.sb || a.pb || null;
}

function GenderBadge({ gender }) {
  if (!gender) return null;
  const w = gender === "W";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 10px", borderRadius: 999,
      fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em",
      background: w ? "#fce4ec" : "#e3f2fd",
      color: w ? "#b71c1c" : "#1565c0",
      flexShrink: 0,
      textTransform: "uppercase",
    }}>
      {w ? "Women" : "Men"}
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
  return [primary?.firstName, primary?.lastName].filter(Boolean).join(" ").trim() || "Athlete";
}

function getRegistryEntryDisciplines(entry) {
  return [...new Set(
    (Array.isArray(entry?.editions) ? entry.editions : [])
      .map((edition) => edition?.discipline)
      .filter(Boolean),
  )].sort((a, b) => String(a).localeCompare(String(b)));
}

function AthleteProfilePanel({ Panel, registryEntry, currentAthletes = [], onClear, title = "Athlete profile", editable = false }) {
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
      setSaveState("✅ Fiche athlète mise à jour.");
      setIsEditing(false);
    } catch (error) {
      setSaveState(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={title}
      subtitle={`${historyRows.length} résultat${historyRows.length > 1 ? "s" : ""} historique${historyRows.length > 1 ? "s" : ""} · ${currentAthletes.length} fiche${currentAthletes.length > 1 ? "s" : ""} édition courante`}
      actions={(
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {editable ? (
            isEditing ? (
              <>
                <button className="button button--ghost button--small" type="button" onClick={() => setIsEditing(false)} disabled={saving}>
                  Annuler
                </button>
                <button className="button button--secondary button--small" type="button" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </>
            ) : (
              <button className="button button--secondary button--small" type="button" onClick={() => setIsEditing(true)}>
                Modifier la fiche
              </button>
            )
          ) : null}
          {onClear ? (
            <button className="button button--ghost button--small" type="button" onClick={onClear}>
              Fermer
            </button>
          ) : null}
        </div>
      )}
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {isEditing ? `${draft.firstName || ""} ${draft.lastName || ""}`.trim() || "Athlete" : getAthleteDisplayName(primary)}
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
              Profil World Athletics
            </a>
          ) : null}
        </div>

        {saveState ? <p className="panel-note" style={{ margin: 0 }}>{saveState}</p> : null}

        {isEditing ? (
          <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label className="field">
              <span>Nom</span>
              <input value={draft.lastName} onChange={(event) => setDraft((current) => ({ ...current, lastName: event.target.value }))} />
            </label>
            <label className="field">
              <span>Prénom</span>
              <input value={draft.firstName} onChange={(event) => setDraft((current) => ({ ...current, firstName: event.target.value }))} />
            </label>
            <label className="field">
              <span>Nationalité</span>
              <input value={draft.nationality} onChange={(event) => setDraft((current) => ({ ...current, nationality: event.target.value.toUpperCase() }))} maxLength={3} />
            </label>
            <label className="field">
              <span>Date de naissance</span>
              <input type="date" value={draft.birthDate} onChange={(event) => setDraft((current) => ({ ...current, birthDate: event.target.value }))} />
            </label>
            <label className="field">
              <span>Année de naissance</span>
              <input value={draft.birthYear} onChange={(event) => setDraft((current) => ({ ...current, birthYear: event.target.value }))} inputMode="numeric" />
            </label>
            <label className="field">
              <span>Genre</span>
              <select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value }))}>
                <option value="">—</option>
                <option value="M">Men</option>
                <option value="F">Women</option>
              </select>
            </label>
            <label className="field">
              <span>WAID</span>
              <input value={draft.waid} onChange={(event) => setDraft((current) => ({ ...current, waid: event.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric" />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Lien WA</span>
              <input value={draft.waUrl} onChange={(event) => setDraft((current) => ({ ...current, waUrl: event.target.value }))} />
            </label>
          </div>
        ) : null}

        <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>Naissance</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{getAthleteDisplayBirth(primary)}</p>
          </div>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>Éditions</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{years.length > 0 ? years.join(", ") : "Aucune"}</p>
          </div>
          <div className="notice-card" style={{ padding: "0.9rem 1rem" }}>
            <strong>Disciplines</strong>
            <p style={{ margin: "0.35rem 0 0 0" }}>{disciplines.length > 0 ? disciplines.join(", ") : "Aucune"}</p>
          </div>
        </div>

        <div>
          <h4 style={{ margin: "0 0 0.65rem 0" }}>Édition en cours</h4>
          {currentAthletes.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              Cet athlète n&apos;est pas lié aux engagés de l&apos;édition en cours.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Épreuve</th>
                    <th>Statut</th>
                    <th>Série</th>
                    <th>Couloir</th>
                    <th>Réf. perf</th>
                    <th>Voyage</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAthletes.map((athlete) => (
                    <tr key={athlete.id}>
                      <td>{athlete.event || "—"}</td>
                      <td>{athlete.status ? <StatusBadge status={athlete.status} /> : "—"}</td>
                      <td>{athlete.heat || "—"}</td>
                      <td>{athlete.lane || "—"}</td>
                      <td>{getCompPace(athlete) || "—"}</td>
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
          <h4 style={{ margin: "0 0 0.65rem 0" }}>Historique meeting</h4>
          {historyRows.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              Aucun résultat historique encore lié à cette fiche.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Année</th>
                    <th>Épreuve</th>
                    <th>Tour</th>
                    <th>RK</th>
                    <th>Résultat</th>
                    <th>Statut</th>
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

  for (let i = 0; i < registry.length; i++) {
    for (let j = i + 1; j < registry.length; j++) {
      const left = registry[i];
      const right = registry[j];
      const reason = getDuplicateMatchReason(left, right);
      if (!reason) continue;
      adjacency.get(left._docId)?.add(right._docId);
      adjacency.get(right._docId)?.add(left._docId);
      reasonsByEdge.set(`${left._docId}__${right._docId}`, reason);
      reasonsByEdge.set(`${right._docId}__${left._docId}`, reason);
    }
  }

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
      .map((docId) => registry.find((candidate) => candidate._docId === docId))
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

const DUPLICATE_MERGE_FIELDS = [
  { key: "lastName", label: "Nom" },
  { key: "firstName", label: "Prénom" },
  { key: "nationality", label: "Nationalité" },
  { key: "birthDate", label: "Date de naissance" },
  { key: "birthYear", label: "Année de naissance" },
  { key: "gender", label: "Genre" },
  { key: "waid", label: "WAID" },
  { key: "waUrl", label: "Lien WA" },
];

function getDuplicateEntryFieldValue(entry, field) {
  if (!entry) return "";
  if (field === "birthYear") return resolveAthleteBirthYear(entry) || "";
  return entry[field] ?? "";
}

function getDuplicateEntryLabel(entry) {
  const name = [entry?.firstName, entry?.lastName].filter(Boolean).join(" ").trim() || entry?._docId || "Fiche";
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

function AthletesListPage({ Panel }) {
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { athletes, loading: athletesLoading } = useAthletes(!settingsLoading);
  const canViewUnifiedProfile = roles.includes("admin") || roles.includes("meeting_director");
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
  // Column visibility — keys in this set are hidden (lastName + firstName always visible)
  const [hiddenCols,    setHiddenCols]    = useState(new Set());
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef(null);
  const tableRef = useRef(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState("");

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

  // ── Augment each athlete with parsed event fields ───────────────────────────
  const athletesParsed = useMemo(
    () => athletes.map((a) => ({ ...a, _ev: parseEventField(a.event) })),
    [athletes],
  );

  // ── Build dropdown option lists ─────────────────────────────────────────────
  const filterOptions = useMemo(() => {
    const disciplines = new Set();
    const nats  = new Set();
    const heats = new Set();
    athletesParsed.forEach((a) => {
      if (a._ev.discipline) disciplines.add(a._ev.discipline);
      if (a.nationality)    nats.add(String(a.nationality).trim());
      if (a.heat)           heats.add(String(a.heat).trim());
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
      if (filterEvent  && a._ev.discipline !== filterEvent)               return false;
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

  // ── Group athletes by event, sort within group by heat → lane → name ────────
  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((a) => {
      const key = String(a.event || "").trim() || "(no event)";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });
    map.forEach((grp) => {
      grp.sort((a, b) => {
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

  // Show "Ref. Pace" column whenever any performance data is visible AND not hidden
  const showPace = displayedFields.some((f) =>
    ["sb","pb","pbIndoor","pbOutdoor","waPbIndoor","waPbOutdoor",
     "waIndoorSb","waIndoorSbCurrent","waOutdoorSb"].includes(f.key),
  );

  const colCount =
    displayedFields.length
    + (showPace ? 1 : 0)
    + (canEdit && !displayedFields.find((f) => f.key === "waid") ? 1 : 0)
    + (canEdit ? 1 : 0);

  // ── Sticky column left-offset computation ────────────────────────────────────
  // Run after every render that could change column layout.
  // Measures each `data-sticky-col` <th> width and sets the `left` CSS property
  // on both the <th> and every <td> in that column so they freeze correctly.
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const theadRow = table.querySelector("thead tr");
    if (!theadRow) return;
    const ths = [...theadRow.children];
    let left = 0;
    ths.forEach((th, colIdx) => {
      if (!th.dataset.stickyCol) return;
      th.style.left = `${left}px`;
      const w = th.getBoundingClientRect().width;
      table.querySelectorAll("tbody tr").forEach((row) => {
        const cell = row.children[colIdx];
        if (cell) cell.style.left = `${left}px`;
      });
      left += w;
    });
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
    if (!withWaid.length) { setSyncAllStatus("No athletes with a WAID to sync."); return; }
    setSyncingAll(true);
    setSyncAllStatus(`Syncing ${withWaid.length} athletes…`);
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
    setSyncAllStatus(`Done: ${ok} updated, ${failures.length} failed.`);
    setSyncAllFailures(failures);
    setSyncingAll(false);
  }

  async function handleLinkAllToRegistry() {
    const candidates = athletes.filter((athlete) => athlete.lastName || athlete.firstName);
    if (!candidates.length) {
      setLinkRegistryStatus("Aucun athlète à lier.");
      return;
    }

    setLinkingRegistry(true);
    setLinkRegistryStatus(`Liaison de ${candidates.length} athlètes en cours…`);

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

    setLinkRegistryStatus(`Liaison terminée : ${linked} liés, ${failed} en erreur.`);
    setLinkingRegistry(false);
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (settingsLoading || athletesLoading) {
    return <div className="page"><section className="page-header"><div><h1>Athletes</h1></div></section><p className="panel-note">Loading…</p></div>;
  }
  if (visibleFields.length === 0) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>Athletes</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>Access restricted</strong>
          <p>You do not have permission to view athlete data. Contact an administrator.</p>
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
            fontWeight: 600,
            textAlign: "left",
          }}
          title="Ouvrir la fiche athlète"
        >
          {a[f.key] ?? "—"}
        </button>
      );
    }
    if (f.key === "waid" && canEdit) return <WaidCell athlete={a} onSave={handleSaveWaid} />;
    if (f.key === "status") return <StatusBadge status={a.status} />;
    if (f.key === "waUrl" && a.waUrl)
      return <a href={a.waUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8rem" }}>WA ↗</a>;
    if (f.group === "wa" && f.key !== "waid" && f.key !== "waUrl" && f.key !== "waFetchedAt")
      return <WaBadge value={a[f.key]} />;
    // Arrival / departure: render structured if raw string present
    if (f.key === "arrival")   return <TravelCell raw={a.arrival}   prefix="arrival" />;
    if (f.key === "departure") return <TravelCell raw={a.departure} prefix="departure" />;
    return a[f.key] ?? "—";
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="page">

      {/* ── Page header ── */}
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Athletes</h1>
          <p>
            {filtered.length} of {athletes.length} athletes ·{" "}
            <strong>Indoor {seasons.indoor}</strong>
            {seasons.indoorCurrent && seasons.indoorCurrent !== seasons.indoor && (
              <> / <strong>{seasons.indoorCurrent}</strong></>
            )}
            {" · "}<strong>Outdoor {seasons.outdoor}</strong>
          </p>
        </div>
        {canEdit && (
          <div style={{ maxWidth: 320 }}>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <button className="button button--secondary" type="button" onClick={handleSyncAll} disabled={syncingAll}>
                {syncingAll ? "Syncing…" : "↻ Sync all with WA"}
              </button>
              <button className="button button--ghost" type="button" onClick={handleLinkAllToRegistry} disabled={linkingRegistry}>
                {linkingRegistry ? "Liaison…" : "Lier les engagés à la base athlètes"}
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
                  {syncAllFailures.length} failure{syncAllFailures.length > 1 ? "s" : ""} — see details
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

      {/* ── Filters ── */}
      <section className="panel-grid panel-grid--1">
        <Panel title="Filters &amp; view">
          <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            <label className="field">
              <span>Search</span>
              <input placeholder="Name, nat., WAID…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="field">
              <span>Discipline</span>
              <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}>
                <option value="">All disciplines</option>
                {filterOptions.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Gender</span>
              <select value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                <option value="">All</option>
                <option value="W">Women (W)</option>
                <option value="M">Men (M)</option>
              </select>
            </label>
            <label className="field">
              <span>Nationality</span>
              <select value={filterNat} onChange={(e) => setFilterNat(e.target.value)}>
                <option value="">All nations</option>
                {filterOptions.nats.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {filterOptions.heats.length > 0 && (
              <label className="field">
                <span>Heat</span>
                <select value={filterHeat} onChange={(e) => setFilterHeat(e.target.value)}>
                  <option value="">All heats</option>
                  {filterOptions.heats.map((h) => <option key={h} value={h}>Heat {h}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>Status</span>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All</option>
                <option value="ok">Confirmed (OK)</option>
                <option value="out">Withdrawn (Out)</option>
              </select>
            </label>
            <label className="field">
              <span>WA sync</span>
              <select value={filterWa} onChange={(e) => setFilterWa(e.target.value)}>
                <option value="">All</option>
                <option value="synced">WA synced ✓</option>
                <option value="has_waid">Has WAID</option>
                <option value="no_waid">No WAID</option>
              </select>
            </label>
            <label className="field" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <span>&nbsp;</span>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", padding: "7px 0" }}>
                <input type="checkbox" checked={groupByEvent} onChange={(e) => setGroupByEvent(e.target.checked)} />
                <span style={{ fontSize: "0.875rem" }}>Group by event</span>
              </label>
            </label>
          </div>
        </Panel>
      </section>

      {/* ── Table ── */}
      {athletes.length === 0 ? (
        <div className="notice-card">
          <strong>No athletes yet</strong>
          <p>No data imported yet. A Meeting Director can upload a start list.</p>
        </div>
      ) : (
        <section className="panel-grid panel-grid--1">
          <Panel
            title={groupByEvent ? `${grouped.length} event${grouped.length !== 1 ? "s" : ""}` : "Athlete list"}
            subtitle={`${filtered.length} athlete${filtered.length !== 1 ? "s" : ""}`}
          >
            {/* ── Column picker ── */}
            <div ref={colPickerRef} style={{ position: "relative", display: "inline-block", marginBottom: "0.75rem" }}>
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => setColPickerOpen((v) => !v)}
                style={{ fontSize: "0.8rem" }}
              >
                Colonnes {colPickerOpen ? "▲" : "▼"}
                {hiddenCols.size > 0 && (
                  <span style={{
                    marginLeft: 6, background: "#1b6b55", color: "#fff",
                    borderRadius: 999, padding: "1px 7px", fontSize: "0.7rem", fontWeight: 700,
                  }}>
                    {hiddenCols.size} masquée{hiddenCols.size > 1 ? "s" : ""}
                  </span>
                )}
              </button>
              {colPickerOpen && (
                <div className="col-picker-popover">
                  <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#587079",
                    textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.5rem" }}>
                    Afficher / masquer
                  </div>
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
                        <span>{f.label}</span>
                      </label>
                    );
                  })}
                  {hiddenCols.size > 0 && (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      style={{ marginTop: "0.5rem", width: "100%", fontSize: "0.78rem" }}
                      onClick={() => setHiddenCols(new Set())}
                    >
                      Tout afficher
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="table-wrap table-wrap--athletes">
              <table className="data-table" ref={tableRef}>
                <thead>
                  <tr>
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
                        >
                          {f.label}
                        </th>
                      );
                    })}
                    {showPace && <th title="Best available reference time for competition seeding">Ref. Pace</th>}
                    {canEdit && !displayedFields.find((f) => f.key === "waid") && <th>WAID</th>}
                    {canEdit && <th>WA sync</th>}
                  </tr>
                </thead>

                {groupByEvent
                  ? grouped.map(([eventKey, group]) => {
                      const ev = parseEventField(eventKey);
                      return (
                        <tbody key={eventKey} className="event-group">
                          <tr className="event-group-header">
                            <td colSpan={colCount}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.01em" }}>
                                  {ev.discipline || eventKey}
                                </span>
                                <GenderBadge gender={ev.gender} />
                                <span style={{ color: "#888", fontSize: "0.8rem", fontWeight: 400 }}>
                                  {group.length} athlete{group.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {group.map((a) => (
                            <tr key={a.id} className={a.status === "out" ? "row--muted" : ""}>
                              {displayedFields.map((f) => {
                                const isSticky = f.key === "lastName" || f.key === "firstName";
                                const isLast = isSticky &&
                                  !displayedFields.slice(displayedFields.indexOf(f) + 1).some(
                                    (x) => x.key === "lastName" || x.key === "firstName"
                                  );
                                return (
                                  <td
                                    key={f.key}
                                    className={isSticky ? `col-sticky${isLast ? " col-sticky--last" : ""}` : ""}
                                  >
                                    {renderCell(f, a)}
                                  </td>
                                );
                              })}
                              {showPace && (
                                <td>
                                  {getCompPace(a)
                                    ? <span className="status-pill status-pill--accent">{getCompPace(a)}</span>
                                    : <span style={{ color: "#bbb" }}>—</span>}
                                </td>
                              )}
                              {canEdit && !displayedFields.find((f) => f.key === "waid") && (
                                <td><WaidCell athlete={a} onSave={handleSaveWaid} /></td>
                              )}
                              {canEdit && <td><WaSyncButton athlete={a} settings={settings} /></td>}
                            </tr>
                          ))}
                        </tbody>
                      );
                    })
                  : (
                    <tbody>
                      {filtered.map((a) => (
                        <tr key={a.id} className={a.status === "out" ? "row--muted" : ""}>
                          {displayedFields.map((f) => {
                            const isSticky = f.key === "lastName" || f.key === "firstName";
                            const isLast = isSticky &&
                              !displayedFields.slice(displayedFields.indexOf(f) + 1).some(
                                (x) => x.key === "lastName" || x.key === "firstName"
                              );
                            return (
                              <td
                                key={f.key}
                                className={isSticky ? `col-sticky${isLast ? " col-sticky--last" : ""}` : ""}
                              >
                                {renderCell(f, a)}
                              </td>
                            );
                          })}
                          {showPace && (
                            <td>
                              {getCompPace(a)
                                ? <span className="status-pill status-pill--accent">{getCompPace(a)}</span>
                                : <span style={{ color: "#bbb" }}>—</span>}
                            </td>
                          )}
                          {canEdit && !displayedFields.find((f) => f.key === "waid") && (
                            <td><WaidCell athlete={a} onSave={handleSaveWaid} /></td>
                          )}
                          {canEdit && <td><WaSyncButton athlete={a} settings={settings} /></td>}
                        </tr>
                      ))}
                    </tbody>
                  )
                }
              </table>
            </div>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              {showPace && (
                <p className="panel-note">
                  <span className="status-pill status-pill--accent">7.05 …</span>{" "}
                  Ref. Pace = best available: indoor SB (current) → indoor SB → outdoor SB → PB
                </p>
              )}
              {visibleFields.some((f) => f.group === "wa") && (
                <p className="panel-note">
                  <span className="status-pill status-pill--accent">WA value</span> = sourced from World Athletics
                </p>
              )}
            </div>
          </Panel>
        </section>
      )}
      {canViewUnifiedProfile && selectedCurrentAthlete && (
        <section className="panel-grid panel-grid--1">
          <AthleteProfilePanel
            Panel={Panel}
            registryEntry={selectedRegistryEntry}
            currentAthletes={selectedCurrentAthletes}
            onClear={() => setSelectedAthleteId("")}
            title={registryLoading ? "Fiche athlète (chargement…)" : "Fiche athlète"}
          />
        </section>
      )}
    </div>
  );
}

// ─── Import page ──────────────────────────────────────────────────────────────

function AthleteImportPage({ Panel }) {
  const { userProfile, currentUser } = useAuth();
  const roles = getActiveRoles(userProfile);
  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const canImport = canImportAthletes(roles, settings);
  const { athletes } = useAthletes(true);
  const { history: importHistory, loading: historyLoading } = useAthleteImportHistory(canImport);

  const [parsed, setParsed] = useState(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // ⚠️ useMemo must be declared before any early returns (Rules of Hooks)
  const mergePreview = useMemo(
    () => (parsed ? mergeAthletes(athletes, parsed.records, parsed.fileType, parsed.presentFields) : null),
    [parsed, athletes],
  );

  if (settingsLoading) return <div className="page"><p className="panel-note">Loading…</p></div>;

  if (!canImport) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>Import athletes</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>Access restricted</strong>
          <p>Only Meeting Directors and Administrators can import athlete data.</p>
        </div>
      </div>
    );
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Reading file…"); setParsed(null);
    try {
      const { read, utils } = await import("xlsx");
      const wb = read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rows.length < 2) { setStatus("File appears empty."); return; }
      const detected = detectFileType(rows);
      const records = parseRows(rows, detected);
      const presentFields = detected.colMap ? Object.keys(detected.colMap) : null;
      setParsed({ fileType: detected.type, records, fileName: file.name, presentFields, file });
      setStatus(`Detected: ${detected.type} — ${records.length} records.${presentFields ? ` Columns: ${presentFields.join(", ")}.` : ""}`);
    } catch (err) { setStatus(`Error: ${err.message}`); }
  }

  async function handleImport() {
    if (!parsed) return;
    setSaving(true); setStatus("Merging and saving…");
    try {
      const { merged, added, updated, markedOut } = mergeAthletes(athletes, parsed.records, parsed.fileType, parsed.presentFields);
      const batch = writeBatch(db);
      const athleteRefs = [];
      // Never delete athletes — update or create only
      merged.forEach((a, i) => {
        const id = a.id || `athlete_${Date.now()}_${i}`;
        athleteRefs.push({ athleteId: id, athlete: a });
        const { id: _id, _ev, ...data } = a; // strip client-only fields
        batch.set(doc(db, ATHLETES_COLLECTION, id), {
          ...data,
          importedAt: serverTimestamp(),
          importSource: parsed.fileType,
        });
      });
      await batch.commit();

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
          added, updated, markedOut,
          actorName: [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser?.email || "",
          actorUid: currentUser?.uid || "",
        });
      } catch (historyError) {
        console.error("Unable to archive this import", historyError);
      }

      const parts = [`${added} added`, `${updated} updated`];
      if (markedOut > 0) parts.push(`${markedOut} marked out (not in file)`);
      setStatus(`Done. ${parts.join(" · ")} · ${merged.length} total.`);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) { setStatus(`Import failed: ${err.message}`); }
    finally { setSaving(false); }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Import file</h1>
          <p>Format detected automatically. Existing WAID and WA data are always preserved.</p>
        </div>
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title="Accepted formats">
          <ul className="compact-list">
            <li><strong>Combined (recommended)</strong> — one file with all columns: Event, Last name, First name, Nat., Birth year, Status, WR, PB, SB, WA URL, Heat, Lane, Manager, Arrival, Departure. Updates everything; can be re-uploaded as many times as needed.</li>
            <li><strong>Start list</strong> (legacy) — Event, Name, Vorname, Nat., Jahrg., Status, WR, PB, SB, WA Profile</li>
            <li><strong>Heats &amp; Lanes</strong> (legacy) — same + Heat rows and Lane; only updates heat/lane</li>
            <li><strong>Travel</strong> (legacy) — Event, Name, Vorname, Nat., Manager, Anreise, Abreise; only updates logistics</li>
          </ul>
          <p className="panel-note">WA data (WAID, PBs from WA) is never overwritten by an import — only by a manual WA sync.</p>
        </Panel>
        <Panel title="Upload">
          <label className="field">
            <span>Excel file (.xlsx)</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={saving} />
          </label>
          {status && <p className="panel-note">{status}</p>}
        </Panel>
      </section>

      {parsed && (
        <>
          <section className="panel-grid panel-grid--2">
            <Panel title="Detection result">
              <ul className="compact-list">
                <li>File: <strong>{parsed.fileName}</strong></li>
                <li>Type: <FileTypeBadge type={parsed.fileType} /></li>
                <li>Records in file: <strong>{parsed.records.length}</strong></li>
                {parsed.presentFields ? (
                  <li>Columns detected: <strong>{parsed.presentFields.join(", ")}</strong></li>
                ) : null}
              </ul>
              {parsed.presentFields ? (
                <p className="panel-note">
                  Only these columns will be updated for matching athletes — anything not listed here (e.g. heat/lane
                  or travel if this file doesn't include them) is left untouched.
                </p>
              ) : null}
            </Panel>
            {mergePreview && (
              <Panel title="Merge preview">
                <ul className="compact-list">
                  <li>Currently in DB: <strong>{athletes.length}</strong></li>
                  <li>New athletes to add: <strong>{mergePreview.added}</strong></li>
                  <li>Existing athletes to update: <strong>{mergePreview.updated}</strong></li>
                  {mergePreview.markedOut > 0 && (
                    <li style={{ color: "#b45309" }}>
                      Not in this file → will be marked <strong>Out</strong>{" "}
                      (heat/lane/travel cleared): <strong>{mergePreview.markedOut}</strong>
                    </li>
                  )}
                  <li>Total in DB after import: <strong>{mergePreview.merged.length}</strong></li>
                </ul>
                {parsed.fileType === "COMBINED"    && <p className="panel-note">Updates all fields. Athletes absent from this file are marked Out — never deleted.</p>}
                {parsed.fileType === "TRAVEL"      && <p className="panel-note">Only updates travel details. No athletes marked out.</p>}
                {parsed.fileType === "FINAL_LANES" && <p className="panel-note">Only updates heat/lane. No athletes marked out.</p>}
              </Panel>
            )}
          </section>

          <section className="panel-grid panel-grid--1">
            <Panel title="Preview — first 10 records">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Event</th><th>Last name</th><th>First name</th><th>Nat.</th>
                      {(parsed.fileType === "START_LIST" || parsed.fileType === "COMBINED") && <><th>Status</th><th>WR</th><th>PB Indoor</th><th>PB Outdoor</th><th>SB</th><th>WAID</th></>}
                      {(parsed.fileType === "FINAL_LANES" || parsed.fileType === "COMBINED") && <><th>Heat</th><th>Lane</th></>}
                      {(parsed.fileType === "TRAVEL"      || parsed.fileType === "COMBINED") && <><th>Manager</th><th>Arrival</th><th>Departure</th></>}
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
                          <><td>{r.manager ?? "—"}</td><td><TravelCell raw={r.arrival} prefix="arrival" /></td><td><TravelCell raw={r.departure} prefix="departure" /></td></>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dashboard-action-grid" style={{ marginTop: "1rem" }}>
                <button className="button button--primary" type="button" onClick={handleImport} disabled={saving || parsed.fileType === "UNKNOWN"}>
                  {saving ? "Importing…" : `Confirm import (${parsed.records.length} records)`}
                </button>
                <button className="button button--secondary" type="button" onClick={() => { setParsed(null); setStatus(""); if (fileRef.current) fileRef.current.value = ""; }} disabled={saving}>
                  Cancel
                </button>
              </div>
              {parsed.fileType === "UNKNOWN" && (
                <p className="panel-note" style={{ color: "var(--color-danger, #c0392b)" }}>
                  Format not recognized. Please check this is a CMCM start list, lanes or travel file.
                </p>
              )}
            </Panel>
          </section>
        </>
      )}

      <section className="panel-grid panel-grid--1">
        <Panel title="Import history" subtitle="Every file received, in order, with the original Excel always downloadable">
          {historyLoading ? (
            <p className="panel-note">Loading…</p>
          ) : importHistory.length === 0 ? (
            <p className="panel-note">No import recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th><th>File</th><th>Type</th><th>Columns</th><th>Records</th><th>By</th><th>Date</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>
                        {index === 0 ? (
                          <span className="status-pill status-pill--ok" style={{ fontSize: "0.72rem" }}>current</span>
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
                      <td>{entry.actorName || "—"}</td>
                      <td>{entry.importedAt?.toDate ? entry.importedAt.toDate().toLocaleString() : "—"}</td>
                      <td>
                        {entry.fileUrl ? (
                          <a href={entry.fileUrl} target="_blank" rel="noopener noreferrer" className="button button--secondary button--small">
                            Download
                          </a>
                        ) : (
                          <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>not archived</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
        <section className="page-header"><div><h1>Portal settings</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>Administrators only</strong>
          <p>Only administrators can manage Athlete Portal permissions.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><p className="panel-note">Loading…</p></div>;

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
    setSaving(true); setSaveStatus("Saving…");
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
      setSaveStatus("Settings saved.");
    } catch (err) { setSaveStatus(`Save failed: ${err.message}`); }
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
          <p className="eyebrow">Athlete Portal</p>
          <h1>Portal settings</h1>
          <p>Access control, season configuration and World Athletics integration.</p>
        </div>
        <div>
          <button className="button button--primary" form="settings-form" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saveStatus && <p className="panel-note" style={{ marginTop: 4 }}>{saveStatus}</p>}
        </div>
      </section>

      <form id="settings-form" onSubmit={handleSave}>

        {/* ── Seasons ──────────────────────────────────────────────── */}
        <section className="panel-grid panel-grid--1">
          <Panel title="Seasons" subtitle="CMCM takes place in early January — the indoor season has barely started at meeting time.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem 2rem", maxWidth: 520 }}>
              <label className="field">
                <span>Indoor — previous year</span>
                <input type="number" min="2020" max="2040" value={indoorSeason}
                  onChange={(e) => setIndoorSeason(e.target.value)} />
                <span className="field-hint">Main SB (season completed)</span>
              </label>
              <label className="field">
                <span>Indoor — current year</span>
                <input type="number" min="2020" max="2040" value={indoorCurrentSeason}
                  onChange={(e) => setIndoorCurrentSeason(e.target.value)} />
                <span className="field-hint">Also shown if available</span>
              </label>
              <label className="field">
                <span>Outdoor</span>
                <input type="number" min="2020" max="2040" value={outdoorSeason}
                  onChange={(e) => setOutdoorSeason(e.target.value)} />
                <span className="field-hint">Previous summer (N−1)</span>
              </label>
            </div>
            <p className="panel-note" style={{ marginTop: "1rem" }}>
              Example for CMCM <strong>{indoorCurrentSeason}</strong>: Indoor SB <strong>{indoorSeason}</strong> (main) ·
              Indoor SB <strong>{indoorCurrentSeason}</strong> (current, few results) ·
              Outdoor SB <strong>{outdoorSeason}</strong>.
            </p>
          </Panel>
        </section>

        {/* ── Access & Import rights ────────────────────────────────── */}
        <section className="panel-grid panel-grid--2">
          <Panel title="Portal access" subtitle="Who can open the Athlete Portal.">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {PLATFORM_ROLES.map((role) => (
                <label key={role.key} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: "0.5rem", alignItems: "center", cursor: role.key === "admin" ? "default" : "pointer", minWidth: 0 }}>
                  <input type="checkbox"
                    checked={accessRoles.includes(role.key)}
                    disabled={role.key === "admin"}
                    onChange={() => toggleRole(accessRoles, setAccessRoles, role.key)} />
                  <span style={{ fontSize: "0.875rem", wordBreak: "break-word" }}>{role.label}</span>
                  {role.key === "admin" && <span className="status-pill status-pill--accent" style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>always</span>}
                  {role.key !== "admin" && <span />}
                </label>
              ))}
            </div>
          </Panel>

          <Panel title="Import rights" subtitle="Who can upload Excel files. Only roles with portal access are shown.">
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
          <Panel title="World Athletics service" subtitle="URL used by the ↻ WA sync buttons.">
            <div style={{ maxWidth: 480 }}>
              <label className="field">
                <span>WA service URL</span>
                <input type="text" value={waServiceUrl}
                  onChange={(e) => setWaServiceUrl(e.target.value)}
                  placeholder="/api/wa" />
              </label>
              <p className="panel-note" style={{ marginTop: "0.5rem" }}>
                Default <code>/api/wa</code> → Netlify Function (works in production with no extra setup).<br />
                For local dev, switch to <code>http://localhost:3001</code> while running <code>wa-service/</code>.
              </p>
            </div>
          </Panel>
        </section>

        {/* ── Field visibility ──────────────────────────────────────── */}
        <section className="panel-grid panel-grid--1">
          <Panel title="Field visibility per role" subtitle="Which columns each role can see in the athlete list.">

            {/* Sticky role header */}
            <div style={{ ...visGrid, borderBottom: "2px solid var(--color-border, #e0e0e0)", paddingBottom: "0.5rem", marginBottom: "0.25rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Field</div>
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
                            title={allOn ? `Remove all ${group.label} fields for ${r.label}` : `Grant all ${group.label} fields to ${r.label}`}
                          >
                            {allOn ? "All ✓" : "None"}
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
                {saving ? "Saving…" : "Save settings"}
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

function AthleteRegistryPage({ Panel }) {
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const canAccess = roles.includes("admin") || roles.includes("meeting_director");

  const { settings, loading: settingsLoading } = useAthletePortalSettings();
  const { registry, loading } = useAthleteRegistry(canAccess);
  const { athletes, loading: athletesLoading } = useAthletes(canAccess);
  const [search, setSearch] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildLog, setRebuildLog] = useState([]);
  const [selectedRegistryDocId, setSelectedRegistryDocId] = useState("");
  const [selectedRegistryIds, setSelectedRegistryIds] = useState([]);
  const [mergingGroupId, setMergingGroupId] = useState("");
  const [dismissingGroupId, setDismissingGroupId] = useState("");
  const [mergeStatus, setMergeStatus] = useState("");
  const [mergeOverrides, setMergeOverrides] = useState({});

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return registry;
    return registry.filter((a) => {
      const hay = [a.lastName, a.firstName, a.nationality, a.waid, a.birthDate]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [registry, search]);

  const registryLookup = useMemo(
    () => buildRegistryLookup(registry),
    [registry],
  );

  const currentAthletesByRegistryId = useMemo(
    () => buildCurrentAthletesByRegistryId(athletes, registryLookup),
    [athletes, registryLookup],
  );

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
    if (!window.confirm("Masquer ce groupe de doublons probables ?\n\nTu pourras toujours corriger les fiches manuellement ensuite.")) return;
    setDismissingGroupId(group.id);
    setMergeStatus("");
    try {
      const nextDismissed = [...new Set([...dismissedDuplicateGroupIds, group.id])];
      await setDoc(
        doc(db, ...ATHLETE_PORTAL_SETTINGS_PATH),
        { ignoredDuplicateGroupIds: nextDismissed, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMergeStatus("✅ Groupe masqué des doublons probables.");
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
      setMergeStatus("✅ Tous les doublons masqués ont été réaffichés.");
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

    if (!window.confirm(`Fusionner ces fiches athlètes ?\n\n${names}`)) return;

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
      setMergeStatus(`✅ ${sortedEntries.length} fiches fusionnées pour ${canonicalFirstName || ""} ${canonicalLastName || ""}`.trim());
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

  if (!canAccess) {
    return (
      <div className="page">
        <section className="page-header"><div><h1>Athletes Database</h1></div></section>
        <div className="notice-card notice-card--warn">
          <strong>Access restricted</strong>
          <p>Admin and Meeting Director only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Athletes Database</h1>
          <p>
            {loading ? "Loading…" : `${registry.length} athletes across all editions`}
            {" · "}Grows automatically when athletes are imported or WA-synced.
          </p>
        </div>
      </section>

      <section className="panel-grid panel-grid--1">
        <Panel title="Maintenance" subtitle="Rebuild the historical athlete registry from the corrected meeting results">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p className="panel-note" style={{ margin: 0 }}>
              Cette action vide complètement <code>athleteRegistry</code>, puis le reconstruit à partir de
              <code> meetingResults.json</code>.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="button button--danger"
                disabled={rebuilding}
                onClick={async () => {
                  if (!window.confirm("Vider complètement la base athlètes puis la reconstruire depuis les résultats historiques corrigés ?")) return;
                  setRebuildLog([]);
                  setRebuilding(true);
                  try {
                    const summary = await rebuildAthleteRegistryFromHistoricalResults((msg) => {
                      setRebuildLog((prev) => [...prev, msg]);
                    });
                    setRebuildLog((prev) => [
                      ...prev,
                      `✅ Base athlètes reconstruite : ${summary.deleted} supprimés, ${summary.written} recréés, source ${summary.sourceRows} lignes.`,
                    ]);
                  } catch (error) {
                    setRebuildLog((prev) => [...prev, `❌ ${error.message}`]);
                  } finally {
                    setRebuilding(false);
                  }
                }}
              >
                {rebuilding ? "Reconstruction…" : "Vider et reconstruire la base athlètes"}
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

        <Panel
          title="Doublons probables"
          subtitle={`${duplicateGroups.length} groupe${duplicateGroups.length > 1 ? "s" : ""} détecté${duplicateGroups.length > 1 ? "s" : ""}`}
        >
          {mergeStatus ? <p className="panel-note" style={{ marginTop: 0 }}>{mergeStatus}</p> : null}
          {dismissedDuplicateGroupIds.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.85rem" }}>
              <p className="panel-note" style={{ margin: 0 }}>
                {dismissedDuplicateGroupIds.length} groupe{dismissedDuplicateGroupIds.length > 1 ? "s" : ""} masqué{dismissedDuplicateGroupIds.length > 1 ? "s" : ""}.
              </p>
              <button
                type="button"
                className="button button--ghost"
                disabled={dismissingGroupId === "restore-all"}
                onClick={handleRestoreDismissedDuplicates}
              >
                {dismissingGroupId === "restore-all" ? "Réaffichage…" : "Réafficher tous"}
              </button>
            </div>
          ) : null}
          {duplicateGroups.length === 0 ? (
            <p className="panel-note" style={{ margin: 0 }}>
              Aucun doublon probable détecté pour le moment.
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
                        {group.entries.length} fiches à fusionner
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        {group.reasons.map((reason) => (
                          <span key={reason} className="status-pill status-pill--accent">{reason}</span>
                        ))}
                        {group.hasNationalityConflict ? (
                          <span className="status-pill status-pill--warn">Nationalités différentes</span>
                        ) : null}
                        {getRegistryEntryDisciplines(group.primary).slice(0, 4).map((discipline) => (
                          <span key={discipline} className="status-pill">{discipline}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={dismissingGroupId === group.id}
                        onClick={() => handleDismissDuplicateGroup(group)}
                      >
                        {dismissingGroupId === group.id ? "Masquage…" : "Pas un doublon"}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={mergingGroupId === group.id}
                        onClick={() => handleMergeDuplicateGroup(group)}
                      >
                        {mergingGroupId === group.id ? "Fusion…" : "Fusionner"}
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
                          <span>{field.label}</span>
                          <select
                            value={selectedSource}
                            onChange={(event) => setMergeOverride(group.id, field.key, event.target.value)}
                          >
                            <option value="auto">Auto</option>
                            {group.entries.map((entry) => (
                              <option key={entry._docId} value={entry._docId}>
                                {getDuplicateEntryLabel(entry)}
                              </option>
                            ))}
                          </select>
                          <span className="panel-note" style={{ marginTop: 4 }}>
                            {selectedSource === "auto"
                              ? "Auto = WA si disponible, sinon meilleure fiche détectée."
                              : `Garder: ${formatDuplicateFieldValue(selectedValue, field.key)}`}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Priorité</th>
                          <th>Athlète</th>
                          <th>Nat.</th>
                          <th>Naissance</th>
                          <th>Disciplines</th>
                          <th>WAID</th>
                          <th>Éditions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry, index) => {
                          const years = [...new Set((entry.editions || []).map((edition) => edition.year).filter(Boolean))].sort((a, b) => a - b);
                          return (
                            <tr key={entry._docId}>
                              <td>{index === 0 ? <span className="status-pill status-pill--ok">Base</span> : index + 1}</td>
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

        {selectedRegistryIds.length > 0 ? (
          <Panel
            title="Fusion manuelle"
            subtitle={`${selectedRegistryIds.length} fiche${selectedRegistryIds.length > 1 ? "s" : ""} sélectionnée${selectedRegistryIds.length > 1 ? "s" : ""}`}
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
                        Fusionner la sélection
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        {manualMergeGroup.reasons.map((reason) => (
                          <span key={reason} className="status-pill status-pill--accent">{reason}</span>
                        ))}
                        {manualMergeGroup.hasNationalityConflict ? (
                          <span className="status-pill status-pill--warn">Nationalités différentes</span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setSelectedRegistryIds([])}
                      >
                        Tout vider
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={mergingGroupId === manualMergeGroup.id}
                        onClick={() => handleMergeDuplicateGroup(manualMergeGroup)}
                      >
                        {mergingGroupId === manualMergeGroup.id ? "Fusion…" : "Fusionner la sélection"}
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
                          <span>{field.label}</span>
                          <select
                            value={selectedSource}
                            onChange={(event) => setMergeOverride(manualMergeGroup.id, field.key, event.target.value)}
                          >
                            <option value="auto">Auto</option>
                            {manualMergeGroup.entries.map((entry) => (
                              <option key={entry._docId} value={entry._docId}>
                                {getDuplicateEntryLabel(entry)}
                              </option>
                            ))}
                          </select>
                          <span className="panel-note" style={{ marginTop: 4 }}>
                            {selectedSource === "auto"
                              ? "Auto = WA si disponible, sinon meilleure fiche détectée."
                              : `Garder: ${formatDuplicateFieldValue(selectedValue, field.key)}`}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Base</th>
                          <th>Athlète</th>
                          <th>Nat.</th>
                          <th>Naissance</th>
                          <th>Disciplines</th>
                          <th>WAID</th>
                          <th>Éditions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualMergeGroup.entries.map((entry, index) => {
                          const years = [...new Set((entry.editions || []).map((edition) => edition.year).filter(Boolean))].sort((a, b) => a - b);
                          return (
                            <tr key={entry._docId}>
                              <td>{index === 0 ? <span className="status-pill status-pill--ok">Base</span> : index + 1}</td>
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
                  Sélectionne au moins 2 fiches dans le tableau pour lancer une fusion manuelle.
                </p>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setSelectedRegistryIds([])}
                >
                  Tout vider
                </button>
              </div>
            )}
          </Panel>
        ) : null}

        <Panel title="Search" subtitle={`${filtered.length} result${filtered.length !== 1 ? "s" : ""}`}>
          <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.75rem", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Name, nationality, WAID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 340 }}
            />
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="panel-note" style={{ margin: 0 }}>
                {selectedRegistryIds.length} sélectionnée{selectedRegistryIds.length > 1 ? "s" : ""}
              </span>
              {selectedRegistryIds.length > 0 ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setSelectedRegistryIds([])}
                >
                  Vider la sélection
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <p className="panel-note">Loading registry…</p>
          ) : registry.length === 0 ? (
            <div className="notice-card">
              <strong>Registry is empty</strong>
              <p>Import athletes or run a WA sync to populate the database.</p>
            </div>
          ) : (
            <div className="table-wrap table-wrap--athletes">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Select.</th>
                    <th data-sticky-col="1" className="col-sticky col-sticky--last">Last name</th>
                    <th>First name</th>
                    <th>Nat.</th>
                    <th>Birth date</th>
                    <th>WAID</th>
                    <th>WA Profile</th>
                    <th>Editions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const editions = Array.isArray(a.editions) ? a.editions : [];
                    const years = [...new Set(editions.map((e) => e.year))].sort((x, y) => x - y);
                    return (
                      <tr key={a._docId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRegistryIds.includes(a._docId)}
                            onChange={() => toggleRegistrySelection(a._docId)}
                            aria-label={`Sélectionner ${[a.firstName, a.lastName].filter(Boolean).join(" ") || "cet athlète"}`}
                          />
                        </td>
                        <td className="col-sticky col-sticky--last" style={{ fontWeight: 600 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedRegistryDocId(a._docId)}
                            style={{
                              appearance: "none",
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                              cursor: "pointer",
                              color: selectedRegistryDocId === a._docId ? "#1d4ed8" : "inherit",
                              fontWeight: 600,
                              textAlign: "left",
                            }}
                            title="Ouvrir la fiche athlète"
                          >
                            {a.lastName || "—"}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedRegistryDocId(a._docId)}
                            style={{
                              appearance: "none",
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                              cursor: "pointer",
                              color: selectedRegistryDocId === a._docId ? "#1d4ed8" : "inherit",
                              fontWeight: 600,
                              textAlign: "left",
                            }}
                            title="Ouvrir la fiche athlète"
                          >
                            {a.firstName || "—"}
                          </button>
                        </td>
                        <td>{a.nationality || "—"}</td>
                        <td style={{ color: "#555", fontSize: "0.85rem" }}>
                          {a.birthDate
                            ? a.birthDate.slice(0, 10)
                            : a.birthYear
                              ? String(a.birthYear)
                              : "—"}
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                          {a.waid || "—"}
                        </td>
                        <td>
                          {a.waUrl
                            ? <a href={a.waUrl} target="_blank" rel="noopener noreferrer"
                                 style={{ fontSize: "0.82rem" }}>WA ↗</a>
                            : <span style={{ color: "#bbb" }}>—</span>}
                        </td>
                        <td>
                          {years.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                              {years.map((yr) => (
                                <span key={yr} style={{
                                  fontSize: "0.68rem", fontWeight: 600,
                                  background: "#dbeafe", color: "#1d4ed8",
                                  padding: "1px 5px", borderRadius: 8,
                                }}>
                                  {yr}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: "#ccc", fontSize: "0.8rem" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="panel-note" style={{ marginTop: "0.5rem" }}>
            Records are permanent — an athlete is never removed from this database,
            even if they no longer appear in the current edition's start list.
            Core identity (name, birth date, WAID, WA URL) is preserved forever.
          </p>
        </Panel>
      </section>

      {selectedRegistryEntry && (
        <section className="panel-grid panel-grid--1">
          <AthleteProfilePanel
            Panel={Panel}
            registryEntry={selectedRegistryEntry}
            currentAthletes={selectedCurrentAthletes}
            onClear={() => setSelectedRegistryDocId("")}
            title={athletesLoading ? "Fiche athlète (liaison en cours…)" : "Fiche athlète"}
            editable
          />
        </section>
      )}
    </div>
  );
}

export { AthletePortalOverview, AthletesListPage, AthleteImportPage, AthletePortalSettingsPage, AthleteRegistryPage };
