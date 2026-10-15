import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const FIREBASE_PROJECT_ID = "myclim-5b5e5";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
}

const db = admin.firestore();
const ATHLETE_REGISTRY_COLLECTION = "athleteRegistry";
const MEETING_RESULTS_JSON = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../src/data/meetingResults.json",
);

const TRACK_ROUND_ORDER = {
  final: 0,
  "timed final": 0,
  "final a": 0,
  "final b": 0,
  "final 1": 0,
  "final 2": 0,
  heat: 1,
  "timed heats": 1,
};

function normalizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildRegistryDocId(row) {
  const last = normalizeKeyPart(row.lastName);
  const first = normalizeKeyPart(row.firstName);
  const birthYear = row.yob || row.birthYear || "na";
  const noc = normalizeKeyPart(row.noc);
  return `hist_${last}_${first}_${birthYear}_${noc}`;
}

function athleteKey(row) {
  return [
    normalizeKeyPart(row.lastName),
    normalizeKeyPart(row.firstName),
    normalizeKeyPart(row.noc),
    // Birth year (when a result row carries one) keeps homonyms apart.
    String(row.yob ?? row.birthYear ?? ""),
  ].join("|");
}

function participationKey(row) {
  return `${Number(row.year)}||${String(row.discipline || "").trim()}`;
}

function roundOrder(round) {
  return TRACK_ROUND_ORDER[String(round || "").trim().toLowerCase()] ?? 2;
}

function statusOrder(status) {
  const value = String(status || "").trim().toUpperCase();
  if (!value || value === "OK") return 0;
  if (value === "DNF") return 1;
  if (value === "DNS") return 2;
  if (value === "DSQ" || value === "DQ") return 3;
  return 4;
}

function numericRank(value) {
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : 9999;
}

function compareParticipationRows(a, b) {
  const roundDiff = roundOrder(a.round) - roundOrder(b.round);
  if (roundDiff !== 0) return roundDiff;

  const statusDiff = statusOrder(a.status) - statusOrder(b.status);
  if (statusDiff !== 0) return statusDiff;

  const rankDiff = numericRank(a.rank) - numericRank(b.rank);
  if (rankDiff !== 0) return rankDiff;

  return String(a.result || "").localeCompare(String(b.result || ""));
}

function buildParticipation(row) {
  return {
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
  };
}

async function loadResults() {
  const raw = await readFile(MEETING_RESULTS_JSON, "utf8");
  const parsed = JSON.parse(raw);
  return Object.values(parsed)
    .flatMap((rows) => rows || [])
    .filter((row) => row && (row.lastName || row.firstName));
}

async function deleteExistingRegistry() {
  const snapshot = await db.collection(ATHLETE_REGISTRY_COLLECTION).get();
  let batch = db.batch();
  let deleted = 0;

  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
    deleted++;
    if (deleted % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (deleted % 400 !== 0 || deleted === 0) {
    await batch.commit();
  }

  return deleted;
}

function buildRegistryEntries(results) {
  const athletes = new Map();

  for (const row of results) {
    const key = athleteKey(row);
    if (!key.replace(/\|/g, "")) continue;

    if (!athletes.has(key)) {
      athletes.set(key, {
        docId: buildRegistryDocId(row),
        lastName: row.lastName || "",
        firstName: row.firstName || "",
        nationality: row.noc || "",
        gender: row.gender || "",
        birthYear: row.yob ?? row.birthYear ?? null,
        participations: new Map(),
      });
    }

    const athlete = athletes.get(key);
    const pKey = participationKey(row);
    const current = athlete.participations.get(pKey);
    if (!current || compareParticipationRows(row, current) < 0) {
      athlete.participations.set(pKey, row);
    }
  }

  return [...athletes.values()].map((athlete) => {
    const editions = [...athlete.participations.values()]
      .map(buildParticipation)
      .sort((a, b) => a.year - b.year || String(a.discipline).localeCompare(String(b.discipline)));

    const payload = {
      lastName: athlete.lastName,
      firstName: athlete.firstName,
      nationality: athlete.nationality,
      editions,
      rebuiltFromHistoricalResults: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (athlete.gender) payload.gender = athlete.gender;
    if (athlete.birthYear != null && athlete.birthYear !== "") {
      payload.yob = Number(athlete.birthYear);
      payload.birthYear = Number(athlete.birthYear);
    }

    return {
      docId: athlete.docId,
      payload,
    };
  });
}

async function writeRegistry(entries) {
  let batch = db.batch();
  let written = 0;

  for (const entry of entries) {
    batch.set(
      db.collection(ATHLETE_REGISTRY_COLLECTION).doc(entry.docId),
      entry.payload,
      { merge: false },
    );
    written++;

    if (written % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (written % 400 !== 0 || written === 0) {
    await batch.commit();
  }

  return written;
}

async function main() {
  console.log("Loading rebuilt meeting results JSON…");
  const results = await loadResults();
  console.log(`Loaded ${results.length} result rows.`);

  console.log("Deleting existing athleteRegistry collection…");
  const deleted = await deleteExistingRegistry();
  console.log(`Deleted ${deleted} athlete registry documents.`);

  console.log("Building athlete registry entries from historical results…");
  const entries = buildRegistryEntries(results);
  console.log(`Built ${entries.length} athlete registry entries.`);

  console.log("Writing rebuilt athlete registry…");
  const written = await writeRegistry(entries);
  console.log(`Wrote ${written} athlete registry documents.`);

  console.log("Athlete registry rebuild complete.");
}

main().catch((error) => {
  console.error("Athlete registry rebuild failed.");
  console.error(error);
  process.exitCode = 1;
});
