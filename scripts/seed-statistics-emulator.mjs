// Historique du meeting (éditions, résultats, records, vainqueurs) chargé
// depuis src/data/*.json, pour tester le module Statistiques en local.
// NE TOURNE QUE SUR LES ÉMULATEURS Firebase (auth 9099 + firestore 8080).
//
//   node scripts/seed-statistics-emulator.mjs
//
// Compte de test créé (émulateur uniquement) :
//   gestionnaire.test@myclim.test / Gestionnaire-Test-2027
// Rôle gestionnaire : voit Statistiques et Engagés (lecture seule).
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST) || !/^(127\.0\.0\.1|localhost):/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error("Refus : ce script ne s'utilise qu'avec les émulateurs locaux.");
  process.exit(1);
}

const PROJECT_ID = "myclim-5b5e5";
const TEST_EMAIL = "gestionnaire.test@myclim.test";
const TEST_PASSWORD = "Gestionnaire-Test-2027";

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8"));

async function writeAll(entries) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach(([path, data]) => batch.set(db.doc(path), data, { merge: true }));
    await batch.commit();
  }
}

const slug = (text) => String(text || "").replace(/[^\w-]+/g, "_");

const editions = read("meetingEditions.json").map((e) => [`meetingEditions/${e.year}`, e]);
const records = read("meetingRecords.json").map((r) => [`meetingRecords/${r.gender}_${slug(r.discipline)}`, r]);
const winners = read("meetingWinners.json").map((w) => [`meetingWinners/${w.year}_${w.gender}_${slug(w.discipline)}`, w]);
const results = Object.entries(read("meetingResults.json")).flatMap(([year, rows]) =>
  rows.map((r, i) => [
    `meetingResults/${year}_${slug(r.discipline)}_${r.gender || "X"}_${slug(r.round)}_${slug(r.finalGroup || r.heat || "main")}_${i}`,
    { ...r, year: Number(year) },
  ]));

// Base athlètes : une fiche par athlète des résultats, comme le fait
// « Clôturer l'édition » en production.
const registry = new Map();
for (const [, r] of results) {
  const key = `${String(r.lastName || "").toLowerCase()}_${String(r.firstName || "").toLowerCase()}`;
  if (key === "_") continue;
  if (!registry.has(key)) {
    registry.set(key, { lastName: r.lastName || "", firstName: r.firstName || "", nationality: r.noc || "", editions: [], ...(r.yob ? { yob: r.yob, birthYear: r.yob } : {}) });
  }
  registry.get(key).editions.push({ year: r.year, discipline: r.discipline || "", gender: r.gender || "", rank: r.rank ?? null, result: r.result || "", noc: r.noc || "" });
}
const registryEntries = [...registry.entries()].map(([key, entry]) => [`athleteRegistry/hist_${slug(key).slice(0, 80)}`, entry]);

await writeAll([...editions, ...records, ...winners, ...results, ...registryEntries]);

let user;
try {
  user = await auth.getUserByEmail(TEST_EMAIL);
} catch {
  user = await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true, displayName: "Gestionnaire Test" });
}
await db.doc(`users/${user.uid}`).set({
  firstName: "Gestionnaire",
  lastName: "Test",
  email: TEST_EMAIL,
  role: "gestionnaire",
  roles: ["gestionnaire"],
  userTypes: ["gestionnaire"],
  accountStatus: "actif",
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

console.log(`${editions.length} éditions, ${results.length} résultats, ${records.length} records, ${winners.length} vainqueurs ; compte ${TEST_EMAIL} prêt.`);
