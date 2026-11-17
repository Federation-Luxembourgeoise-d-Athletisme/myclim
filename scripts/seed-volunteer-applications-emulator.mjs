// Données fictives pour tester Bénévoles › Candidatures (affectation d'une
// équipe depuis le tableau) en local. NE TOURNE QUE SUR LES ÉMULATEURS
// Firebase (auth 9099 + firestore 8080) : le script s'arrête sinon.
//
//   node scripts/seed-volunteer-applications-emulator.mjs          # ajoute / remet les données
//   node scripts/seed-volunteer-applications-emulator.mjs --clear  # les retire
//
// Compte de test créé (émulateur uniquement) :
//   volunteers.admin@myclim.test / Volunteers-Admin-Test-2027
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
const ADMIN_EMAIL = "volunteers.admin@myclim.test";
const ADMIN_PASSWORD = "Volunteers-Admin-Test-2027";
const SEED_TAG = "seed-volunteer-applications";

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
const day = (offset) => Timestamp.fromMillis(Date.now() - offset * 86400000);

const APPLICANTS = [
  { id: "seed-vol-agresta", firstName: "Fulvio", lastName: "TESTAGRESTA", age: 43, languages: ["Anglais", "Italien"], missionPreferences: ["Antidoping", "Guides VIP"], daysAgo: 1 },
  { id: "seed-vol-casal", firstName: "Isabel", lastName: "TESTCASAL", age: 16, languages: ["Français", "Anglais"], missionPreferences: ["Transport", "Porte-panier"], daysAgo: 1 },
  { id: "seed-vol-frank", firstName: "Daniel", lastName: "TESTFRANK", age: 59, languages: ["Français", "Allemand"], missionPreferences: [], daysAgo: 30 },
  { id: "seed-vol-kita", firstName: "Yannick", lastName: "TESTKITA", age: 18, languages: ["Français", "Luxembourgeois"], missionPreferences: ["Starting block", "Entrance"], daysAgo: 0 },
];

async function ensureAdmin() {
  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL);
  } catch {
    user = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true, displayName: "Volunteers Admin" });
  }
  await db.doc(`users/${user.uid}`).set(
    { firstName: "Volunteers", lastName: "Admin", email: ADMIN_EMAIL, role: "admin", roles: ["admin"], userTypes: ["admin"], accountStatus: "actif", seedTag: SEED_TAG, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return user;
}

if (process.argv.includes("--clear")) {
  await Promise.all(APPLICANTS.map((applicant) => db.doc(`volunteerApplications/${applicant.id}`).delete()));
  console.log("Candidatures de test retirées.");
  process.exit(0);
}

await ensureAdmin();
await db.doc("appSettings/platform").set({ activeEdition: EDITION_ID }, { merge: true });
for (const applicant of APPLICANTS) {
  const { id, daysAgo, ...fields } = applicant;
  await db.doc(`volunteerApplications/${id}`).set({
    ...fields,
    email: `${fields.firstName.toLowerCase()}.${fields.lastName.toLowerCase()}@example.test`,
    phone: "+352 600 000 000",
    availability: [],
    workflowStatus: "Candidature reçue",
    assignedRole: "",
    assignedRoles: [],
    teamEmailSent: false,
    editionId: EDITION_ID,
    seedTag: SEED_TAG,
    submittedAt: day(daysAgo),
  });
}
console.log(`${APPLICANTS.length} candidatures de test prêtes. Connexion : ${ADMIN_EMAIL}`);
process.exit(0);
