/**
 * Hooks and helpers for the CMCM meeting history database.
 *
 * Collections:
 *   meetingEditions   — one doc per edition (year is doc ID)
 *   meetingResults    — one doc per result entry (auto-ID)
 *   meetingRecords    — meeting records by discipline/gender
 *   meetingWinners    — historical winners by year/discipline
 */
import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot,
  query, updateDoc, where, writeBatch, setDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { ATHLETE_REGISTRY_COLLECTION } from "./athlete-portal-hooks";

// ─── Collection names ──────────────────────────────────────────────────────

export const MEETING_EDITIONS_COL  = "meetingEditions";
export const MEETING_RESULTS_COL   = "meetingResults";
export const MEETING_RECORDS_COL   = "meetingRecords";
export const MEETING_WINNERS_COL   = "meetingWinners";

const FIELD_DISCIPLINES = new Set([
  "High Jump",
  "Long Jump",
  "Pole Vault",
  "Shot Put",
  "Triple Jump",
]);

const normalizeDisciplineKey = (discipline) =>
  String(discipline || "")
    .replace(/(\d)\s+(m\b)/gi, "$1$2")
    .replace(/Hurdles/g, "hurdles")
    .trim();

function roundSortValue(round) {
  const value = String(round || "").toLowerCase();
  if (value === "heat") return 0;
  if (value === "final") return 1;
  return 2;
}

function sectionSortValue(result) {
  const token = String(result?.finalGroup || result?.heat || "").toUpperCase();
  if (!token) return 0;
  if (token === "1" || token === "A") return 1;
  if (token === "2" || token === "B") return 2;
  if (token === "3" || token === "C") return 3;
  const numeric = Number(token);
  if (Number.isFinite(numeric)) return numeric;
  return 99;
}

function compareResultRows(a, b) {
  const dc = String(a.discipline || "").localeCompare(String(b.discipline || ""));
  if (dc !== 0) return dc;
  const gc = String(a.gender || "").localeCompare(String(b.gender || ""));
  if (gc !== 0) return gc;
  const rc = roundSortValue(a.round) - roundSortValue(b.round);
  if (rc !== 0) return rc;
  const sc = sectionSortValue(a) - sectionSortValue(b);
  if (sc !== 0) return sc;
  return (a.sectionRank || a.rank || 99) - (b.sectionRank || b.rank || 99);
}

function normalizeHeatSectionRanks(results) {
  const rows = results.map((row) => ({ ...row }));
  const hasFinalByEvent = new Set(
    rows
      .filter((row) => String(row?.round || "").toLowerCase() === "final")
      .map((row) => `${row.discipline || ""}||${row.gender || ""}`),
  );
  const groups = new Map();

  for (const row of rows) {
    if (String(row?.round || "").toLowerCase() !== "heat") continue;
    const linkedRound = String(row?.linkedRound || "").toLowerCase();
    const eventKey = `${row.discipline || ""}||${row.gender || ""}`;
    const qualifiesToFinal = linkedRound === "final" || hasFinalByEvent.has(eventKey);
    if (!qualifiesToFinal) continue;
    const groupKey = `${eventKey}||${row.heat || ""}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => {
      const rankDiff = (Number(a.rank) || 999) - (Number(b.rank) || 999);
      if (rankDiff !== 0) return rankDiff;
      const markDiff = compareRecordCandidates(
        { discipline: a.discipline, result: a.result },
        { discipline: b.discipline, result: b.result },
      );
      if (markDiff !== 0) return markDiff;
      return `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`);
    });

    groupRows.forEach((row, index) => {
      row.sectionRank = index + 1;
    });
  }

  return rows;
}

function isOfficialResult(result) {
  return String(result?.round || "").toLowerCase() !== "heat";
}

function isValidForRecords(result) {
  if (!isOfficialResult(result)) return false;
  const status = String(result?.status || "").toUpperCase();
  return !status || status === "OK";
}

function toComparableMark(result, discipline) {
  const raw = String(result || "").trim();
  if (!raw) return null;

  if (FIELD_DISCIPLINES.has(discipline)) {
    const numeric = Number(raw.replace(/\s*m$/i, "").replace(",", "."));
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (raw.includes(":")) {
    const [minutes, seconds] = raw.split(":");
    const total = Number(minutes) * 60 + Number(seconds);
    return Number.isFinite(total) ? total : null;
  }

  const compact = raw.replace(/\s+/g, "");
  const numeric = Number(compact.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function compareRecordCandidates(a, b) {
  const aValue = toComparableMark(a.result || a.mark, a.discipline);
  const bValue = toComparableMark(b.result || b.mark, b.discipline);

  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;

  if (FIELD_DISCIPLINES.has(a.discipline)) {
    return bValue - aValue;
  }

  return aValue - bValue;
}

function formatRecordMark(result, discipline) {
  const raw = String(result || "").trim();
  if (!raw) return "";
  if (FIELD_DISCIPLINES.has(discipline)) {
    return raw.endsWith(" m") ? raw : `${raw} m`;
  }
  return raw.replace(":", ".");
}

function buildMeetingResultId(year, result, index) {
  const parts = [
    year,
    normalizeDisciplineKey(result.discipline).replace(/[^\w-]+/g, "_"),
    result.gender || "X",
    (result.round || "final").toLowerCase(),
    String(result.finalGroup || result.heat || "main").replace(/[^\w-]+/g, "_"),
    result.sectionRank || result.rank || index + 1,
    (result.lastName || "athlete").replace(/[^\w-]+/g, "_"),
    (result.firstName || "").replace(/[^\w-]+/g, "_"),
  ];
  return parts.join("_");
}

export function getOfficialWinnersFromResults(results) {
  const winnersByKey = new Map();

  for (const row of results) {
    if (!isOfficialResult(row) || Number(row.rank) !== 1) continue;
    const key = `${normalizeDisciplineKey(row.discipline)}_${row.gender || "X"}`;
    const current = winnersByKey.get(key);
    if (!current || compareResultRows(row, current) < 0) {
      winnersByKey.set(key, row);
    }
  }

  return [...winnersByKey.values()].sort(compareResultRows);
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export function useMeetingEditions() {
  const [editions, setEditions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, MEETING_EDITIONS_COL), (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.year - a.year);
      setEditions(items);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);
  return { editions, loading };
}

export function useMeetingResultsForYear(year) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!year) { setLoading(false); return; }
    const q = query(collection(db, MEETING_RESULTS_COL), where("year", "==", Number(year)));
    const unsub = onSnapshot(q, (snap) => {
      const items = normalizeHeatSectionRanks(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      )
        .sort(compareResultRows);
      setResults(items);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [year]);
  return { results, loading };
}

export function useMeetingRecords() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, MEETING_RECORDS_COL), (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);
  return { records, loading };
}

export function useMeetingWinners(discipline, gender) {
  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let q = collection(db, MEETING_WINNERS_COL);
    if (discipline) q = query(q, where("discipline", "==", discipline));
    if (gender) q = query(q, where("gender", "==", gender));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.year - a.year);
      setWinners(items);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [discipline, gender]);
  return { winners, loading };
}

export function useAllWinners() {
  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, MEETING_WINNERS_COL), (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          // Sort by canonical event order (track by distance, then field alpha)
          const DISCIPLINE_ORDER = [
            "50 m","60 m","60 m hurdles",
            "200 m","200 m - Special Olympics",
            "400 m","800 m","1000 m","1500 m","3000 m","5000 m",
          ];
          const keyOf = (d) => {
            const i = DISCIPLINE_ORDER.indexOf(d);
            return i !== -1 ? `0_${String(i).padStart(3,"0")}` : `1_${d}`;
          };
          const dc = keyOf(a.discipline || "").localeCompare(keyOf(b.discipline || ""));
          if (dc !== 0) return dc;
          if (a.gender !== b.gender) return a.gender === "W" ? -1 : 1;
          return b.year - a.year;
        });
      setWinners(items);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);
  return { winners, loading };
}

// ─── Edit / delete individual results ────────────────────────────────────────

/**
 * Update editable fields on a single meetingResults document.
 * Only the supplied keys are written (patch semantics).
 */
export async function updateMeetingResult(docId, fields) {
  await updateDoc(doc(db, MEETING_RESULTS_COL, docId), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a single meetingResults document.
 */
export async function deleteMeetingResult(docId) {
  await deleteDoc(doc(db, MEETING_RESULTS_COL, docId));
}

// ─── Seed historical data from JSON files ────────────────────────────────────

/**
 * Seed all historical data from the bundled JSON files into Firestore.
 * Idempotent — uses setDoc with merge so re-running is safe.
 * Returns a status string.
 */
export async function seedMeetingDatabase(onProgress) {
  // Dynamic imports so bundle doesn't include JSON unless this function runs
  const [editionsJson, recordsJson, winnersJson, resultsJson] = await Promise.all([
    import("../data/meetingEditions.json").then((m) => m.default),
    import("../data/meetingRecords.json").then((m) => m.default),
    import("../data/meetingWinners.json").then((m) => m.default),
    import("../data/meetingResults.json").then((m) => m.default),
  ]);

  let total = 0;

  // 1. Editions
  onProgress?.("Importing editions…");
  let batch = writeBatch(db);
  let count = 0;
  for (const ed of editionsJson) {
    batch.set(doc(db, MEETING_EDITIONS_COL, String(ed.year)), { ...ed, seededAt: serverTimestamp() }, { merge: true });
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  total += count;
  onProgress?.(`Editions: ${count} done`);

  // 2. Records
  onProgress?.("Importing meeting records…");
  batch = writeBatch(db); count = 0;
  for (const rec of recordsJson) {
    const id = `${rec.gender}_${rec.discipline.replace(/\s+/g, "_")}`;
    batch.set(doc(db, MEETING_RECORDS_COL, id), { ...rec, seededAt: serverTimestamp() }, { merge: true });
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  total += count;
  onProgress?.(`Records: ${count} done`);

  // 3. Winners
  onProgress?.("Importing winners…");
  batch = writeBatch(db); count = 0;
  for (const w of winnersJson) {
    const id = `${w.year}_${w.gender}_${w.discipline.replace(/\s+/g, "_")}`;
    batch.set(doc(db, MEETING_WINNERS_COL, id), { ...w, seededAt: serverTimestamp() }, { merge: true });
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  total += count;
  onProgress?.(`Winners: ${count} done`);

  // 4. Results (all years)
  onProgress?.("Importing historical results…");
  batch = writeBatch(db); count = 0;
  for (const [year, results] of Object.entries(resultsJson)) {
    for (const [index, r] of results.entries()) {
      const id = buildMeetingResultId(year, r, index);
      batch.set(doc(db, MEETING_RESULTS_COL, id), {
        ...r, year: Number(year), seededAt: serverTimestamp(),
      }, { merge: true });
      count++;
      if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
  }
  await batch.commit();
  total += count;
  onProgress?.(`Results: ${count} done`);

  return `Done — ${total} documents written to Firestore.`;
}

export async function importResultsForYearFromJson(year, onProgress) {
  const resultsJson = await import("../data/meetingResults.json").then((m) => m.default);
  const yearResults = Array.isArray(resultsJson?.[String(year)]) ? resultsJson[String(year)] : [];

  onProgress?.(`Suppression des résultats ${year} existants…`);
  const deleted = await clearResultsForYear(year);
  onProgress?.(`${deleted} résultats supprimés.`);

  onProgress?.(`Import des résultats ${year}…`);
  let batch = writeBatch(db);
  let count = 0;
  for (const [index, row] of yearResults.entries()) {
    const id = buildMeetingResultId(year, row, index);
    batch.set(doc(db, MEETING_RESULTS_COL, id), {
      ...row,
      year: Number(year),
      seededAt: serverTimestamp(),
    }, { merge: true });
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (count % 400 !== 0 || count === 0) {
    await batch.commit();
  }

  onProgress?.(`${count} résultats importés.`);
  return yearResults;
}

// ─── Sync winners for one year from rank=1 results ───────────────────────────

const _normDisc = (d) => (d || "").replace(/(\d)\s+(m\b)/gi, "$1$2").replace(/Hurdles/g, "hurdles").trim();

/**
 * Replace meetingWinners documents for `year` with the rank=1 results.
 * Deletes old docs for that year first, then writes one doc per discipline/gender.
 */
export async function syncWinnersForYear(year, rank1Results) {
  // Delete existing winners for this year
  const snap = await getDocs(
    query(collection(db, MEETING_WINNERS_COL), where("year", "==", Number(year))),
  );
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();

  // Write new winners from rank=1
  batch = writeBatch(db); count = 0;
  for (const r of rank1Results) {
    const disc = _normDisc(r.discipline).replace(/\s+/g, "_");
    const id = `${year}_${r.gender || "X"}_${disc}`;
    batch.set(doc(db, MEETING_WINNERS_COL, id), {
      year: Number(year),
      discipline: _normDisc(r.discipline),
      gender: r.gender || "",
      firstName: r.firstName || "",
      lastName: r.lastName || "",
      noc: r.noc || "",
      result: r.result || r.mark || "",
      syncedFromResults: true,
      syncedAt: serverTimestamp(),
    });
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  return count;
}

// Every result of every edition (e-magazine athlete pages).
export async function fetchAllMeetingResults() {
  const snap = await getDocs(collection(db, MEETING_RESULTS_COL));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function rebuildMeetingRecords(onProgress) {
  onProgress?.("Lecture des résultats pour recalculer les records…");
  const resultsSnap = await getDocs(collection(db, MEETING_RESULTS_COL));
  const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const bestByKey = new Map();
  for (const row of results) {
    if (!isValidForRecords(row)) continue;
    const key = `${normalizeDisciplineKey(row.discipline)}_${row.gender || "X"}`;
    const current = bestByKey.get(key);
    if (!current || compareRecordCandidates(row, current) < 0) {
      bestByKey.set(key, row);
    }
  }

  onProgress?.("Suppression des anciens records…");
  const recordsSnap = await getDocs(collection(db, MEETING_RECORDS_COL));
  let batch = writeBatch(db);
  let deleted = 0;
  for (const docSnap of recordsSnap.docs) {
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

  onProgress?.("Écriture des nouveaux records…");
  batch = writeBatch(db);
  let written = 0;
  for (const row of [...bestByKey.values()].sort(compareResultRows)) {
    const id = `${row.gender || "X"}_${normalizeDisciplineKey(row.discipline).replace(/\s+/g, "_")}`;
    batch.set(doc(db, MEETING_RECORDS_COL, id), {
      gender: row.gender || "",
      discipline: normalizeDisciplineKey(row.discipline),
      mark: formatRecordMark(row.result || row.mark || "", row.discipline),
      fullName: `${row.lastName || ""} ${row.firstName || ""}`.trim(),
      noc: row.noc || "",
      date: row.date || "",
      year: Number(row.year),
      syncedFromResults: true,
      syncedAt: serverTimestamp(),
    });
    written++;
    if (written % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (written % 400 !== 0 || written === 0) {
    await batch.commit();
  }

  onProgress?.(`${written} records recalculés.`);
  return written;
}

export async function reseedMeetingYearFromJson(year, onProgress) {
  const importedResults = await importResultsForYearFromJson(year, onProgress);
  const winners = getOfficialWinnersFromResults(importedResults);
  const winnerCount = await syncWinnersForYear(year, winners);
  onProgress?.(`${winnerCount} winners synchronisés.`);
  const recordCount = await rebuildMeetingRecords(onProgress);
  return {
    results: importedResults.length,
    winners: winnerCount,
    records: recordCount,
  };
}

// ─── Reset winners collection (delete all + re-seed from JSON) ───────────────

/**
 * Deletes every document in meetingWinners, then re-seeds from the bundled
 * JSON. Use this to fix stale documents left behind by previous seeds that
 * used different discipline name formats (e.g. "60 m" vs "60m").
 */
export async function resetAndReseedWinners(onProgress) {
  onProgress?.("Deleting all winners…");
  const snap = await getDocs(collection(db, MEETING_WINNERS_COL));
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  onProgress?.(`Deleted ${count} old documents.`);

  onProgress?.("Re-seeding winners from JSON…");
  const winnersJson = await import("../data/meetingWinners.json").then((m) => m.default);
  batch = writeBatch(db); count = 0;
  for (const w of winnersJson) {
    const id = `${w.year}_${w.gender}_${w.discipline.replace(/\s+/g, "_")}`;
    batch.set(doc(db, MEETING_WINNERS_COL, id), { ...w, seededAt: serverTimestamp() });
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  onProgress?.(`Re-seeded ${count} winners.`);
  return `Done — ${count} winners written.`;
}

// ─── Clear all results for a year ────────────────────────────────────────────

export async function clearResultsForYear(year) {
  const snap = await getDocs(query(collection(db, MEETING_RESULTS_COL), where("year", "==", Number(year))));
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  if (count % 400 !== 0) await batch.commit();
  return count;
}

// ─── Result CRUD ──────────────────────────────────────────────────────────────

export async function saveResult(id, data) {
  const now = serverTimestamp();
  if (id) {
    await updateDoc(doc(db, MEETING_RESULTS_COL, id), { ...data, updatedAt: now });
    return id;
  }
  const ref = await addDoc(collection(db, MEETING_RESULTS_COL), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}

export async function deleteResult(id) {
  await deleteDoc(doc(db, MEETING_RESULTS_COL, id));
}

// ─── Edition visibility ────────────────────────────────────────────────────────

export async function setEditionVisibility(year, visibleInStats) {
  await updateDoc(doc(db, MEETING_EDITIONS_COL, String(year)), { visibleInStats });
}

// ─── Close an edition ─────────────────────────────────────────────────────────

/**
 * Mark an edition as closed and record participation in athleteRegistry.
 * Matches results → registry entries by lastName + yob.
 * Falls back to name-only match if no registry entry found yet.
 */
export async function closeEdition(year, results, onProgress) {
  // Load all registry entries to find matches
  onProgress?.("Loading athlete registry…");
  const regSnap = await getDocs(collection(db, ATHLETE_REGISTRY_COLLECTION));
  const registry = regSnap.docs.map((d) => ({ _docId: d.id, ...d.data() }));

  // Index registry by lastName.toLowerCase()
  const regByName = new Map();
  for (const a of registry) {
    const k = String(a.lastName || "").toLowerCase();
    if (!regByName.has(k)) regByName.set(k, []);
    regByName.get(k).push(a);
  }

  let matched = 0;
  let created = 0;
  const batch = writeBatch(db);

  onProgress?.(`Processing ${results.length} results…`);

  for (const r of results) {
    const lastKey = String(r.lastName || "").toLowerCase();
    const candidates = regByName.get(lastKey) || [];

    // Match: same lastName + same yob (preferred) or same NOC
    let match = candidates.find((c) => c.yob === r.yob || c.birthYear === r.yob) ||
                candidates.find((c) => String(c.nationality || "").toUpperCase() === r.noc);

    // Build participation — omit any fields that are undefined (Firestore rejects them)
    const participation = Object.fromEntries(
      Object.entries({
        year:       Number(year),
        discipline: r.discipline || "",
        gender:     r.gender     || "",
        rank:       r.rank       ?? null,
        result:     r.result     || "",
        noc:        r.noc        || "",
      }).filter(([, v]) => v !== undefined),
    );

    if (match) {
      // Add participation to existing registry entry
      const existing = Array.isArray(match.editions) ? match.editions : [];
      const alreadyPresent = existing.some((e) => e.year === Number(year) && e.discipline === r.discipline);
      if (!alreadyPresent) {
        batch.set(
          doc(db, ATHLETE_REGISTRY_COLLECTION, match._docId),
          { editions: [...existing, participation] },
          { merge: true },
        );
        matched++;
      }
    } else {
      // Create a new registry entry for this historical athlete
      // Strip undefined values — Firestore rejects them
      const newId = `hist_${lastKey}_${(r.firstName || "").toLowerCase().slice(0, 4)}_${r.yob || ""}`;
      const newEntry = {
        lastName:    r.lastName  || "",
        firstName:   r.firstName || "",
        nationality: r.noc       || "",
        editions:    [participation],
        createdAt:   serverTimestamp(),
        updatedAt:   serverTimestamp(),
      };
      if (r.yob != null) { newEntry.yob = r.yob; newEntry.birthYear = r.yob; }
      batch.set(
        doc(db, ATHLETE_REGISTRY_COLLECTION, newId),
        newEntry,
        { merge: true },
      );
      created++;
    }
  }

  // Mark edition as closed
  batch.set(
    doc(db, MEETING_EDITIONS_COL, String(year)),
    { isClosed: true, closedAt: serverTimestamp() },
    { merge: true },
  );

  await batch.commit();
  return `Edition ${year} closed. ${matched} athletes matched in registry, ${created} new registry entries created.`;
}

export async function updateEdition(year, fields) {
  await setDoc(
    doc(db, MEETING_EDITIONS_COL, String(year)),
    fields,
    { merge: true },
  );
}
