import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { auth, db, STORAGE_UPLOAD_ENDPOINT } from "../services/firebase";
import { recordMatchesEdition, useActiveEdition } from "./edition";

const ATHLETE_PORTAL_SETTINGS_PATH = ["appSettings", "athletePortalSettings"];
const ATHLETES_COLLECTION = "athletes";
const ATHLETE_TRANSPORT_LOTS_COLLECTION = "athleteTransportLots";
const ATHLETE_IMPORT_HISTORY_COLLECTION = "athleteImportHistory";

/**
 * Permanent cross-edition athlete registry.
 * Document ID = WAID (as string) when known, otherwise
 * "noWaid_{lastName}|{firstName}|{birthYear}" lowercased & normalised.
 * Core identity fields only — no per-edition operational data.
 */
const ATHLETE_REGISTRY_COLLECTION = "athleteRegistry";

// ─── Field definitions ────────────────────────────────────────────────────────

const ALL_ATHLETE_FIELDS = [
  // Core identity
  { key: "event",         label: "Event",             group: "identity" },
  { key: "lastName",      label: "Last name",          group: "identity" },
  { key: "firstName",     label: "First name",         group: "identity" },
  { key: "nationality",   label: "Nationality",        group: "identity" },
  { key: "birthYear",     label: "Birth year",         group: "identity" },

  // Excel-imported performance (from start list / lanes file)
  { key: "status",        label: "Status (ok/out)",    group: "excel" },
  { key: "worldRanking",  label: "World Ranking",      group: "excel" },
  { key: "pb",            label: "PB (Excel raw)",     group: "excel" },
  { key: "pbIndoor",      label: "PB Indoor (Excel)",  group: "excel" },
  { key: "pbOutdoor",     label: "PB Outdoor (Excel)", group: "excel" },
  { key: "sb",            label: "SB (Excel raw)",     group: "excel" },

  // World Athletics — source of truth
  { key: "waid",              label: "WAID",                    group: "wa" },
  { key: "waUrl",             label: "WA Profile URL",          group: "wa" },
  { key: "waPbIndoor",        label: "WA PB Indoor",            group: "wa" },
  { key: "waPbOutdoor",       label: "WA PB Outdoor",           group: "wa" },
  { key: "waIndoorSb",        label: "WA SB Indoor (prev yr)",  group: "wa" },
  { key: "waIndoorSbCurrent", label: "WA SB Indoor (curr yr)",  group: "wa" },
  { key: "waOutdoorSb",       label: "WA SB Outdoor",           group: "wa" },
  { key: "waFetchedAt",       label: "WA last sync",            group: "wa" },

  // Heat/lane (from lanes file)
  { key: "heat",          label: "Heat",               group: "lanes" },
  { key: "lane",          label: "Lane",               group: "lanes" },

  // Travel logistics (from travel file)
  { key: "manager",         label: "Manager",          group: "travel" },
  { key: "arrival",         label: "Arrival (raw)",    group: "travel" },
  { key: "arrivalDay",      label: "Arr. Day",         group: "travel" },
  { key: "arrivalTime",     label: "Arr. Time",        group: "travel" },
  { key: "arrivalFlight",   label: "Arr. Flight",      group: "travel" },
  { key: "arrivalFrom",     label: "Arr. From",        group: "travel" },
  { key: "departure",       label: "Departure (raw)",  group: "travel" },
  { key: "departureDay",    label: "Dep. Day",         group: "travel" },
  { key: "departureTime",   label: "Dep. Time",        group: "travel" },
  { key: "departureFlight", label: "Dep. Flight",      group: "travel" },
  { key: "departureTo",     label: "Dep. To",          group: "travel" },
];

const FIELD_GROUPS = [
  { key: "identity", label: "Identity" },
  { key: "excel",    label: "Excel import" },
  { key: "wa",       label: "World Athletics" },
  { key: "lanes",    label: "Heats & Lanes" },
  { key: "travel",   label: "Travel" },
];

// Default settings — admin can override everything via the settings page.
// Season rule for early-January meetings (meeting year N):
//   indoor     = N-1  (previous indoor season, completed — most athletes have results here)
//   indoorCurrent = N (current indoor season, just started — few results)
//   outdoor    = N-1  (previous outdoor season, completed)
// Example: CMCM 2026 → indoor 2025, indoorCurrent 2026, outdoor 2025
const DEFAULT_PORTAL_SETTINGS = {
  accessRoles: ["admin", "meeting_director", "chef_transport_athletes", "benevole_transport_athletes"],
  importerRoles: ["admin", "meeting_director"],
  // WA service base URL: /api/wa → proxied to the Netlify Function wa-athlete,
  // itself backed by worldathletics.nimarion.de. Works the same in local dev
  // via `netlify dev`.
  waServiceUrl: "/api/wa",
  // Which seasons to display as SBs
  seasons: { indoor: 2025, indoorCurrent: 2026, outdoor: 2025 },
  fieldVisibility: {
    admin:            ALL_ATHLETE_FIELDS.map((f) => f.key),
    meeting_director: ALL_ATHLETE_FIELDS.map((f) => f.key),
    gestionnaire:              ["event", "lastName", "firstName", "nationality", "status", "heat", "lane"],
    chef_equipe:               ["event", "lastName", "firstName", "nationality"],
    chef_transport_athletes:   ["event", "lastName", "firstName", "nationality", "manager", "arrivalDay", "arrivalTime", "arrivalFlight", "arrivalFrom", "departureDay", "departureTime", "departureFlight", "departureTo"],
    benevole_transport_athletes: ["event", "lastName", "firstName", "nationality", "arrivalDay", "arrivalTime", "arrivalFlight", "arrivalFrom"],
  },
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAthletePortalSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...ATHLETE_PORTAL_SETTINGS_PATH),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setSettings({
            ...DEFAULT_PORTAL_SETTINGS,
            ...data,
            seasons: {
              ...DEFAULT_PORTAL_SETTINGS.seasons,
              ...(data.seasons ?? {}),
              // indoorCurrent defaults to indoor+1 if not explicitly saved
              indoorCurrent: data.seasons?.indoorCurrent
                ?? (data.seasons?.indoor ? data.seasons.indoor + 1 : DEFAULT_PORTAL_SETTINGS.seasons.indoorCurrent),
            },
          });
        } else {
          setSettings(DEFAULT_PORTAL_SETTINGS);
        }
        setLoading(false);
      },
      () => { setSettings(DEFAULT_PORTAL_SETTINGS); setLoading(false); },
    );
    return unsubscribe;
  }, []);

  return { settings, loading };
}

function useAthletes(enabled = true) {
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }

    const unsubscribe = onSnapshot(
      collection(db, ATHLETES_COLLECTION),
      (snapshot) => {
        setAthletes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [enabled]);

  return { athletes, loading };
}

// ─── WA service integration ───────────────────────────────────────────────────

/**
 * Normalize an event discipline string to the WA disciplineCode format.
 *
 * Handles both compact codes ("60mH", "3000mSC") and full English names
 * ("60 m hurdles", "Long Jump", "Pole Vault") as found in meeting start lists.
 *
 * Examples:
 *   "800m W"         → "800"
 *   "60 m"           → "60"
 *   "60mH"           → "60H"
 *   "60 m hurdles"   → "60H"
 *   "100 m hurdles"  → "100H"
 *   "3000mSC"        → "3000SC"
 *   "3000 m steeplechase" → "3000SC"
 *   "Long Jump"      → "LJ"
 *   "Triple Jump"    → "TJ"
 *   "High Jump"      → "HJ"
 *   "Pole Vault"     → "PV"
 *   "Shot Put"       → "SP"
 */
function normalizeDisciplineCode(disc) {
  if (!disc) return null;

  // Strip gender/round suffixes: "800m W", "60 m hurdles Women", etc.
  const s = disc.trim()
    .replace(/\s+(W|M|F|Women|Men|Femmes?|Hommes?)\s*$/i, "")
    .replace(/\s+(Final|Heat|Round)\s*$/i, "")
    .trim();

  const lower = s.toLowerCase();

  // ── Field events by full name ──────────────────────────────────────────────
  if (/long\s*jump/i.test(s))   return "LJ";
  if (/triple\s*jump/i.test(s)) return "TJ";
  if (/high\s*jump/i.test(s))   return "HJ";
  if (/pole\s*vault/i.test(s))  return "PV";
  if (/shot\s*put/i.test(s))    return "SP";
  if (/discus/i.test(s))        return "DT";
  if (/hammer/i.test(s))        return "HT";
  if (/javelin/i.test(s))       return "JT";

  // ── Hurdles / Steeplechase by full name ────────────────────────────────────
  if (/hurd/i.test(lower)) {
    const m = s.match(/(\d+)/);
    return m ? `${m[1]}H` : null;
  }
  if (/steeplechase/i.test(lower)) {
    const m = s.match(/(\d+)/);
    return m ? `${m[1]}SC` : null;
  }

  // ── Compact format: "800m", "60mH", "3000mSC", "60 m", "800 m" ───────────
  const compact = s.replace(/\s+/g, ""); // remove spaces: "60 m" → "60m"
  const code = compact
    .replace(/mSC$/i, "SC")
    .replace(/mH$/i,  "H")
    .replace(/m$/i,   "")
    .toUpperCase();

  return code || null;
}

/**
 * Fetch a single athlete's data from the wa-service and extract the
 * season-relevant SBs.
 *
 * @param {string|number} waid       World Athletics ID
 * @param {object}        settings   Portal settings (waServiceUrl, seasons)
 * @param {string}        [event]    Athlete event string, e.g. "800m W".
 *                                   Used to filter WA results to the correct
 *                                   discipline so a 1500m PB isn't mistaken
 *                                   for an 800m PB.
 *
 * Returns an object with the fields to write back to Firestore:
 *   waPbIndoor, waPbOutdoor, waIndoorSb, waIndoorSbCurrent, waOutdoorSb,
 *   waFetchedAt, waUrl
 */
async function fetchAthleteFromWaService(waid, settings, event) {
  const baseUrl = String(settings?.waServiceUrl || DEFAULT_PORTAL_SETTINGS.waServiceUrl).replace(/\/$/, "");
  const seasons = settings?.seasons ?? DEFAULT_PORTAL_SETTINGS.seasons;

  const response = await fetch(`${baseUrl}/athlete/${waid}/performances`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Try to extract the structured error detail from the Netlify Function response
    let detail = "";
    try {
      const body = await response.json();
      detail = body.detail || body.error || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`HTTP ${response.status} — ${detail}`);
  }

  const data = await response.json();

  const pbs = Array.isArray(data.personalBests) ? data.personalBests : [];
  const sbs = Array.isArray(data.seasonBests) ? data.seasonBests : [];

  // Derive a WA disciplineCode from the athlete's event field so we only pick
  // PBs/SBs in their actual discipline (avoids a 1500m PB showing up for an
  // 800m athlete because it has a higher resultScore).
  // Strip gender suffix first: "800m W" → "800m" → "800"
  const rawDisc = (event || "").trim().replace(/\s+(W|M|F|H|Women|Men|Femmes?|Hommes?)\s*$/i, "").trim();
  const discCode = normalizeDisciplineCode(rawDisc); // e.g. "800", "60H", null

  /**
   * Returns true if the WA result belongs to the athlete's discipline.
   * Falls back to true (no filter) when discCode is unknown.
   */
  function matchesDiscipline(r) {
    if (!discCode) return true;
    const code = (r.disciplineCode || "").toUpperCase();
    return code === discCode;
  }

  // Best PB for each environment, restricted to the athlete's discipline.
  // The `indoor` field is computed server-side from venue "(i)" suffix + discipline name,
  // so it is reliable — use it directly instead of guessing from discipline name.
  const waPbIndoor  = bestMark(pbs.filter((r) => r.indoor === true  && matchesDiscipline(r)));
  const waPbOutdoor = bestMark(pbs.filter((r) => r.indoor === false && matchesDiscipline(r)));

  // Season bests — same discipline filter applied.
  //   indoor        = previous indoor season (N-1, completed, most athletes have results)
  //   indoorCurrent = current indoor season (N, just started, few results)
  //   outdoor       = previous outdoor season (N-1)
  const filteredSbs = sbs.filter(matchesDiscipline);
  const waIndoorSb        = bestMarkForYear(filteredSbs, seasons.indoor,        true);
  const waIndoorSbCurrent = bestMarkForYear(filteredSbs, seasons.indoorCurrent, true);
  const waOutdoorSb       = bestMarkForYear(filteredSbs, seasons.outdoor,       false);

  function fmtPb(r)  { return r ? `${r.mark}${r.date ? ` (${r.date.slice(0,4)})` : ""}` : null; }
  function fmtSb(r)  { return r ? `${r.mark}${r.date ? ` @ ${(r.venue ?? "").trim()}`.trimEnd() : ""}` : null; }

  const waUrl = data.firstName ? `https://worldathletics.org/athletes/_/${waid}` : null;

  return {
    waPbIndoor:        fmtPb(waPbIndoor),
    waPbOutdoor:       fmtPb(waPbOutdoor),
    waIndoorSb:        fmtSb(waIndoorSb),
    waIndoorSbCurrent: fmtSb(waIndoorSbCurrent),
    waOutdoorSb:       fmtSb(waOutdoorSb),
    waFetchedAt: new Date().toISOString(),
    waUrl,
    // Identity fields from WA — used by callers to upsert the athlete registry
    _waIdentity: {
      firstName:   data.firstName   || null,
      lastName:    data.lastName    || null,
      birthDate:   data.birthDate   || null,
      countryCode: data.countryCode || null,
      waid:        Number(waid),
      waUrl,
    },
  };
}

function bestMark(results) {
  if (!results.length) return null;
  // Sort by resultScore desc if available, otherwise just take first
  return results.slice().sort((a, b) => (b.resultScore ?? 0) - (a.resultScore ?? 0))[0];
}

function bestMarkForYear(results, year, indoor) {
  const yearStr = String(year);
  const relevant = results.filter((r) => {
    if (!r.date) return false;
    if (!r.date.startsWith(yearStr)) return false;
    if (indoor !== undefined) {
      // `indoor` field is computed server-side from venue "(i)" suffix
      if (indoor && r.indoor !== true) return false;
      if (!indoor && r.indoor !== false) return false;
    }
    return true;
  });
  return bestMark(relevant);
}

// ─── Permission helpers ───────────────────────────────────────────────────────

function canAccessAthletePortal(roles, settings) {
  const accessRoles = settings?.accessRoles ?? DEFAULT_PORTAL_SETTINGS.accessRoles;
  return roles.some((r) => accessRoles.includes(r));
}

function canImportAthletes(roles, settings) {
  const importerRoles = settings?.importerRoles ?? DEFAULT_PORTAL_SETTINGS.importerRoles;
  return roles.some((r) => importerRoles.includes(r));
}

function getVisibleFields(roles, settings) {
  const fieldVisibility = settings?.fieldVisibility ?? {};
  const visibleKeys = new Set();
  roles.forEach((role) => {
    (fieldVisibility[role] ?? []).forEach((k) => visibleKeys.add(k));
  });
  return ALL_ATHLETE_FIELDS.filter((f) => visibleKeys.has(f.key));
}

// ─── Parsing helpers (used by import page) ────────────────────────────────────

function extractWaid(urlOrText) {
  if (!urlOrText) return null;
  const m = String(urlOrText).trim().match(/[/-](\d{7,10})(?:[#?].*)?$/);
  return m ? m[1] : null;
}

function parsePb(raw) {
  if (!raw) return { indoor: null, outdoor: null };
  const parts = String(raw).trim().split("/").map((p) => p.trim()).filter(Boolean);

  function parsePart(p) {
    if (!p) return null;
    const yearMatch = p.match(/\((\d{2,4})\)/);
    let year = yearMatch ? yearMatch[1] : null;
    if (year && year.length === 2) year = Number(year) < 50 ? `20${year}` : `19${year}`;
    const noYear = p.replace(/\(\d{2,4}\)/g, "").replace(/NR/gi, "");
    const val = noYear.replace(/[^0-9,]/g, "").replace(",", ".");
    return val ? `${val}${year ? ` (${year})` : ""}` : null;
  }

  return { indoor: parsePart(parts[0]), outdoor: parsePart(parts[1]) ?? null };
}

function normalizeBirthYear(raw) {
  const n = Number(raw);
  if (!n) return null;
  if (n >= 1900) return n;
  return n < 50 ? 2000 + n : 1900 + n;
}

function normalizeIdentityFragment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveAthleteBirthYear(fields = {}) {
  return (
    normalizeBirthYear(fields.birthYear)
    ?? normalizeBirthYear(fields.yob)
    ?? (fields.birthDate ? normalizeBirthYear(String(fields.birthDate).slice(0, 4)) : null)
    ?? null
  );
}

function buildAthleteIdentityKeys(fields = {}) {
  const lastName = normalizeIdentityFragment(fields.lastName);
  const firstName = normalizeIdentityFragment(fields.firstName);
  const nationality = normalizeIdentityFragment(fields.nationality || fields.countryCode);
  const birthYear = resolveAthleteBirthYear(fields);

  if (!lastName && !firstName) return [];

  const keys = [
    [lastName, firstName, birthYear, nationality].filter(Boolean).join("|"),
    [lastName, firstName, birthYear].filter(Boolean).join("|"),
    [lastName, firstName, nationality].filter(Boolean).join("|"),
    [lastName, firstName].filter(Boolean).join("|"),
  ].filter(Boolean);

  return [...new Set(keys)];
}

function athleteMergeKey(lastName, firstName, nationality) {
  return [lastName, firstName, nationality]
    .map((s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function registryParticipationKey(row) {
  return `${Number(row.year)}||${String(row.discipline || "").trim()}`;
}

function registryRoundOrder(round) {
  const value = String(round || "").trim().toLowerCase();
  if (
    value === "final" ||
    value === "timed final" ||
    value === "final a" ||
    value === "final b" ||
    value === "final 1" ||
    value === "final 2"
  ) return 0;
  if (value === "heat" || value === "timed heats") return 1;
  return 2;
}

function registryStatusOrder(status) {
  const value = String(status || "").trim().toUpperCase();
  if (!value || value === "OK") return 0;
  if (value === "DNF") return 1;
  if (value === "DNS") return 2;
  if (value === "DSQ" || value === "DQ") return 3;
  return 4;
}

function compareRegistryRows(a, b) {
  const roundDiff = registryRoundOrder(a.round) - registryRoundOrder(b.round);
  if (roundDiff !== 0) return roundDiff;

  const statusDiff = registryStatusOrder(a.status) - registryStatusOrder(b.status);
  if (statusDiff !== 0) return statusDiff;

  const rankA = Number(a.rank);
  const rankB = Number(b.rank);
  const rankDiff = (Number.isFinite(rankA) ? rankA : 9999) - (Number.isFinite(rankB) ? rankB : 9999);
  if (rankDiff !== 0) return rankDiff;

  return String(a.result || "").localeCompare(String(b.result || ""));
}

function buildHistoricalRegistryDocId(row) {
  const norm = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const birthYear = row.yob ?? row.birthYear ?? "na";
  return `hist_${norm(row.lastName)}_${norm(row.firstName)}_${birthYear}_${norm(row.noc)}`;
}

// ─── Athlete Registry ─────────────────────────────────────────────────────────

/**
 * Derive a stable Firestore document ID for the permanent athlete registry.
 * Uses WAID when available (most stable), falls back to a normalised name key.
 */
function registryDocId(waid, lastName, firstName, birthYear) {
  if (waid) return String(waid);
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
  return `noWaid_${norm(lastName)}_${norm(firstName)}_${birthYear || ""}`;
}

/**
 * Upsert an athlete's permanent identity record into the `athleteRegistry`
 * collection.  Only writes identity fields — never per-edition data.
 *
 * @param {object} fields  Any subset of:
 *   { lastName, firstName, nationality, birthYear, birthDate, waid, waUrl, gender }
 */
async function upsertAthleteRegistry(fields) {
  const { lastName, firstName, nationality, birthDate, waid, waUrl, gender } = fields;
  if (!lastName && !firstName) return; // nothing useful to store

  const normalizedBirthYear = resolveAthleteBirthYear(fields);
  const identityKeys = buildAthleteIdentityKeys({
    ...fields,
    nationality: nationality || fields.countryCode || "",
    birthYear: normalizedBirthYear,
  });

  let existingDoc = null;

  if (waid) {
    const waidSnap = await getDocs(
      query(collection(db, ATHLETE_REGISTRY_COLLECTION), where("waid", "==", Number(waid))),
    );
    existingDoc = waidSnap.docs[0] || null;
  }

  if (!existingDoc) {
    for (const identityKey of identityKeys) {
      const keySnap = await getDocs(
        query(collection(db, ATHLETE_REGISTRY_COLLECTION), where("identityKeys", "array-contains", identityKey)),
      );
      if (keySnap.docs[0]) {
        existingDoc = keySnap.docs[0];
        break;
      }
    }
  }

  const docId = existingDoc?.id || registryDocId(waid, lastName, firstName, normalizedBirthYear);
  const existingData = existingDoc?.data() || {};
  const record = {};
  if (lastName)     record.lastName     = lastName;
  if (firstName)    record.firstName    = firstName;
  if (nationality || fields.countryCode)  record.nationality  = nationality || fields.countryCode;
  if (normalizedBirthYear)    record.birthYear    = Number(normalizedBirthYear);
  if (birthDate)    record.birthDate    = birthDate;
  if (waid)         record.waid         = Number(waid);
  if (waUrl)        record.waUrl        = waUrl;
  if (gender)       record.gender       = gender;
  record.identityKeys = [
    ...new Set([
      ...(Array.isArray(existingData.identityKeys) ? existingData.identityKeys : []),
      ...identityKeys,
    ]),
  ];
  record.updatedAt = serverTimestamp();

  await setDoc(
    doc(db, ATHLETE_REGISTRY_COLLECTION, docId),
    { ...record, createdAt: serverTimestamp() },
    { merge: true },  // merge so createdAt is only written on first insert
  );

  return { docId };
}

async function rebuildAthleteRegistryFromHistoricalResults(onProgress) {
  const resultsJson = await import("../data/meetingResults.json").then((m) => m.default);
  const rows = Object.values(resultsJson)
    .flatMap((items) => items || [])
    .filter((row) => row && (row.lastName || row.firstName));

  onProgress?.(`Résultats historiques chargés : ${rows.length} lignes.`);

  onProgress?.("Suppression de la base athlètes existante…");
  const existingSnap = await getDocs(collection(db, ATHLETE_REGISTRY_COLLECTION));
  let batch = writeBatch(db);
  let deleted = 0;
  for (const docSnap of existingSnap.docs) {
    batch.delete(docSnap.ref);
    deleted++;
    if (deleted % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (deleted % 400 !== 0 || deleted === 0) {
    await batch.commit();
  }
  onProgress?.(`${deleted} fiches athlètes supprimées.`);

  onProgress?.("Regroupement des athlètes à partir des résultats historiques…");
  const athletes = new Map();
  for (const row of rows) {
    const key = athleteMergeKey(row.lastName, row.firstName, row.noc);
    if (!key.replace(/\|/g, "")) continue;

    if (!athletes.has(key)) {
      athletes.set(key, {
        docId: buildHistoricalRegistryDocId(row),
        lastName: row.lastName || "",
        firstName: row.firstName || "",
        nationality: row.noc || "",
        gender: row.gender || "",
        birthYear: row.yob ?? row.birthYear ?? null,
        participations: new Map(),
      });
    }

    const athlete = athletes.get(key);
    const participationKey = registryParticipationKey(row);
    const current = athlete.participations.get(participationKey);
    if (!current || compareRegistryRows(row, current) < 0) {
      athlete.participations.set(participationKey, row);
    }
  }

  const payloads = [...athletes.values()].map((athlete) => {
    const editions = [...athlete.participations.values()]
      .map((row) => ({
        year: Number(row.year),
        discipline: row.discipline || "",
        gender: row.gender || "",
        rank: row.rank ?? null,
        result: row.result || "",
        noc: row.noc || "",
        round: row.round || "",
        heat: row.heat || "",
        finalGroup: row.finalGroup || "",
        status: row.status || "",
        date: row.date || "",
      }))
      .sort((a, b) => a.year - b.year || String(a.discipline || "").localeCompare(String(b.discipline || "")));

    const payload = {
      lastName: athlete.lastName,
      firstName: athlete.firstName,
      nationality: athlete.nationality,
      identityKeys: buildAthleteIdentityKeys({
        lastName: athlete.lastName,
        firstName: athlete.firstName,
        nationality: athlete.nationality,
        birthYear: athlete.birthYear,
      }),
      editions,
      rebuiltFromHistoricalResults: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (athlete.gender) payload.gender = athlete.gender;
    if (athlete.birthYear != null && athlete.birthYear !== "") {
      payload.yob = Number(athlete.birthYear);
      payload.birthYear = Number(athlete.birthYear);
    }

    return { docId: athlete.docId, payload };
  });

  onProgress?.(`${payloads.length} fiches athlètes reconstruites.`);
  onProgress?.("Réécriture de la base athlètes…");
  batch = writeBatch(db);
  let written = 0;
  for (const entry of payloads) {
    batch.set(doc(db, ATHLETE_REGISTRY_COLLECTION, entry.docId), entry.payload, { merge: false });
    written++;
    if (written % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (written % 400 !== 0 || written === 0) {
    await batch.commit();
  }

  onProgress?.(`${written} fiches athlètes écrites.`);
  return { deleted, written, sourceRows: rows.length };
}

/**
 * Subscribe to the full athlete registry (all editions).
 * Sorted client-side: lastName ASC then firstName ASC.
 */
function useAthleteRegistry(enabled = true) {
  const [registry, setRegistry] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }

    const unsubscribe = onSnapshot(
      collection(db, ATHLETE_REGISTRY_COLLECTION),
      (snapshot) => {
        const items = snapshot.docs
          .map((d) => ({ _docId: d.id, ...d.data() }))
          .sort((a, b) => {
            const cmp = String(a.lastName || "").localeCompare(String(b.lastName || ""));
            return cmp !== 0 ? cmp : String(a.firstName || "").localeCompare(String(b.firstName || ""));
          });
        setRegistry(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [enabled]);

  return { registry, loading };
}

function useAthleteTransportLots(enabled = true) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const { activeEditionId, loading: editionLoading } = useActiveEdition(enabled);

  useEffect(() => {
    if (!enabled || editionLoading) return undefined;
    const unsubscribe = onSnapshot(
      collection(db, ATHLETE_TRANSPORT_LOTS_COLLECTION),
      (snapshot) => {
        setLots(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((lot) => recordMatchesEdition(lot, activeEditionId)),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [enabled, activeEditionId, editionLoading]);

  return { lots, loading: loading || editionLoading };
}

// ─── Import history ───────────────────────────────────────────────────────────
// Keeps the raw Excel file (Storage) + merge metadata (Firestore) for every
// athlete import, so the meeting director's file can always be re-downloaded
// and an operator can see which version of the roster is currently live.

async function uploadAthleteImportFile(file) {
  const user = auth.currentUser;
  if (!user) throw new Error("User is not authenticated.");
  const idToken = await user.getIdToken();

  const response = await fetch(STORAGE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Path": "athlete-imports",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });

  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    throw new Error(payload?.message || `Upload HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.url) throw new Error("Réponse d'upload incomplète.");
  return { url: payload.url, filePath: payload.filePath || "" };
}

async function recordAthleteImport({ file, fileType, presentFields, recordCount, added, updated, markedOut, changes, actorName, actorUid }) {
  let fileUrl = "";
  let filePath = "";
  try {
    const uploaded = await uploadAthleteImportFile(file);
    fileUrl = uploaded.url;
    filePath = uploaded.filePath;
  } catch (uploadError) {
    console.error("Unable to archive the imported Excel file", uploadError);
  }

  await addDoc(collection(db, ATHLETE_IMPORT_HISTORY_COLLECTION), {
    fileName: file.name,
    fileUrl,
    filePath,
    fileType,
    presentFields: presentFields || null,
    recordCount, added, updated, markedOut,
    changes: Array.isArray(changes) ? changes : [],
    actorName: actorName || "",
    actorUid: actorUid || "",
    importedAt: serverTimestamp(),
  });
}

function useAthleteImportHistory(enabled = true) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));

  useEffect(() => {
    if (!enabled) { setHistory([]); setLoading(false); return undefined; }
    const unsubscribe = onSnapshot(
      query(collection(db, ATHLETE_IMPORT_HISTORY_COLLECTION), orderBy("importedAt", "desc")),
      (snapshot) => {
        setHistory(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [enabled]);

  return { history, loading };
}

function useTransportVolunteers(enabled = true) {
  const [volunteers, setVolunteers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }
    const unsubscribe = onSnapshot(
      query(collection(db, "users"), where("userTypes", "array-contains", "benevole_transport_athletes")),
      (snapshot) => {
        setVolunteers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [enabled]);

  return { volunteers, loading };
}

export {
  useAthletePortalSettings,
  useAthletes,
  useAthleteRegistry,
  rebuildAthleteRegistryFromHistoricalResults,
  fetchAthleteFromWaService,
  upsertAthleteRegistry,
  canAccessAthletePortal,
  canImportAthletes,
  getVisibleFields,
  extractWaid,
  parsePb,
  normalizeBirthYear,
  resolveAthleteBirthYear,
  buildAthleteIdentityKeys,
  athleteMergeKey,
  ALL_ATHLETE_FIELDS,
  FIELD_GROUPS,
  DEFAULT_PORTAL_SETTINGS,
  ATHLETE_PORTAL_SETTINGS_PATH,
  ATHLETES_COLLECTION,
  ATHLETE_REGISTRY_COLLECTION,
  ATHLETE_TRANSPORT_LOTS_COLLECTION,
  useAthleteTransportLots,
  useTransportVolunteers,
  ATHLETE_IMPORT_HISTORY_COLLECTION,
  recordAthleteImport,
  useAthleteImportHistory,
};
