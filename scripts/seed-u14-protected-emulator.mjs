// Données fictives U12/U14 pour tester les places protégées en local :
// enfants déjà inscrits par le formulaire général, à rattacher à une place
// protégée à l'import. NE TOURNE QUE SUR LES ÉMULATEURS Firebase
// (auth 9099 + firestore 8080) : le script s'arrête si ce n'est pas le cas.
//
//   node scripts/seed-u14-protected-emulator.mjs          # ajoute / remet les données
//   node scripts/seed-u14-protected-emulator.mjs --clear  # les retire
//
// Compte de test créé (émulateur uniquement) :
//   u14.admin@myclim.test / U14-Admin-Test-2027
//
// Liste à coller dans l'onglet Places protégées (2 déjà inscrits, 1 nouveau) :
//   TESTDUPONT;Emma;CAB;emma.parent@example.test;9001;2016;F
//   TESTMULLER;Noah;CSL;noah.parent@example.test;9002;2014;G
//   TESTNOUVEAU;Lina;CAD;lina.parent@example.test;9003;2015;F
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST) || !/^(127\.0\.0\.1|localhost):/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error("Refus : ce script ne s'utilise qu'avec les émulateurs locaux.");
  process.exit(1);
}

const PROJECT_ID = "myclim-5b5e5";
const EDITION_ID = "2027";
const ADMIN_EMAIL = "u14.admin@myclim.test";
const ADMIN_PASSWORD = "U14-Admin-Test-2027";
const SEED_TAG = "seed-u14-protected";

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
const day = (offset) => Timestamp.fromMillis(Date.now() - offset * 86400000);

const CHILDREN = [
  { id: "seed-u14-emma", firstName: "Emma", lastName: "TESTDUPONT", birthYear: 2016, category: "U12", gender: "fille", club: "CAB", bibNumber: "9001", raceCode: "U12F60", requestedEvent: "60 m", daysAgo: 3 },
  { id: "seed-u14-noah", firstName: "Noah", lastName: "TESTMULLER", birthYear: 2014, category: "U14", gender: "garcon", club: "CSL", bibNumber: "9002", raceCode: "U14M1000", requestedEvent: "1000 m", daysAgo: 2 },
  { id: "seed-u14-other", firstName: "Tom", lastName: "TESTAUTRE", birthYear: 2016, category: "U12", gender: "garcon", club: "CAPA", bibNumber: "9004", raceCode: "U12M60", requestedEvent: "60 m", daysAgo: 1 },
];

async function ensureAdmin() {
  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL);
  } catch {
    user = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true, displayName: "U14 Admin" });
  }
  await db.doc(`users/${user.uid}`).set(
    { firstName: "U14", lastName: "Admin", email: ADMIN_EMAIL, role: "admin", roles: ["admin"], userTypes: ["admin"], accountStatus: "actif", seedTag: SEED_TAG, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return user;
}

async function clear() {
  for (const name of ["u14Children", "u14Requests", "u14ProtectedInvites"]) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.filter((entry) => entry.id.startsWith("seed-u14-") || entry.data().seedTag === SEED_TAG || entry.data().lastName?.startsWith("TEST")).map((entry) => entry.ref.delete()));
  }
}

await clear();
if (process.argv.includes("--clear")) {
  console.log("Données U12/U14 de test retirées.");
  process.exit(0);
}

const admin = await ensureAdmin();
await db.doc("appSettings/platform").set({ activeEdition: EDITION_ID }, { merge: true });
await db.doc("appSettings/u14ProtectedSettings").set({ pools: { U12F: 3, U12M: 3, U14F: 6, U14M: 6 }, deadline: "2026-12-15", editionId: EDITION_ID });

for (const child of CHILDREN) {
  const parentEmail = `${child.firstName.toLowerCase()}.parent@example.test`;
  await db.doc(`u14Children/${child.id}`).set({
    editionId: EDITION_ID,
    parentUserId: admin.uid,
    firstName: child.firstName,
    lastName: child.lastName,
    birthYear: child.birthYear,
    birthDate: `${child.birthYear}-05-10`,
    category: child.category,
    gender: child.gender,
    club: child.club,
    bibNumber: child.bibNumber,
    seedTag: SEED_TAG,
  });
  await db.doc(`u14Requests/${child.id}-req`).set({
    editionId: EDITION_ID,
    seedTag: SEED_TAG,
    childId: child.id,
    parentUserId: admin.uid,
    parentFirstName: "Parent",
    parentLastName: child.lastName,
    parentEmail,
    childFirstName: child.firstName,
    childLastName: child.lastName,
    category: child.category,
    gender: child.gender,
    club: child.club,
    bibNumber: child.bibNumber,
    requestType: "preprogram",
    requestedEvent: child.requestedEvent,
    raceCode: child.raceCode,
    status: "confirmed",
    allocationMode: "platform",
    adminApprovalStatus: "pending",
    submittedAt: day(child.daysAgo),
  });
}
console.log(`Données U12/U14 de test prêtes. Connexion : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
process.exit(0);
