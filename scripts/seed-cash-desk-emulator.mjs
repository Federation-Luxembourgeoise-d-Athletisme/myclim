// Données de test de la caisse (édition active 2027) : une liste sponsors,
// une liste officiels, des VIP et un athlète des courses nationales.
// NE TOURNE QUE SUR LES ÉMULATEURS Firebase (auth 9099 + firestore 8080).
//
//   node scripts/seed-cash-desk-emulator.mjs
//
// Compte de test (émulateur uniquement) : gestionnaire.test@myclim.test /
// Gestionnaire-Test-2027 (rôle gestionnaire : ouvre /app/caisse et /caisse).
// Les postes et le code se créent depuis l'admin, pour tester ces boutons.
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
const EDITION = "2027";
const TEST_EMAIL = "gestionnaire.test@myclim.test";
const TEST_PASSWORD = "Gestionnaire-Test-2027";

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
const now = FieldValue.serverTimestamp();

const lists = [
  ["doorGuestLists/cashtest-sponsors", { name: "Invités CMCM", category: "sponsors", editionId: EDITION, active: true, sortOrder: 1, createdAt: now }],
  ["doorGuestLists/cashtest-officials", { name: "Fédération", category: "officials", editionId: EDITION, active: true, sortOrder: 2, createdAt: now }],
];

const guests = [
  ["cashtest-g1", "cashtest-sponsors", "Hélène", "Müller", "CMCM", 2, ""],
  ["cashtest-g2", "cashtest-sponsors", "Paul", "Martin", "CMCM", 1, "Badge parking à remettre"],
  ["cashtest-g3", "cashtest-sponsors", "Sophie", "Weber", "BGL", 4, ""],
  ["cashtest-g4", "cashtest-officials", "Marc", "Schmit", "FLA", 1, ""],
  ["cashtest-g5", "cashtest-officials", "Anne", "Hoffmann", "COSL", 2, ""],
].map(([id, listId, firstName, lastName, organization, places, notes]) => [
  `doorGuests/${id}`,
  { listId, editionId: EDITION, firstName, lastName, organization, email: "", places, notes, source: "seed", createdAt: now },
]);

const vip = [
  ["vipAdminRegistrations/cashtest-v1", { editionId: EDITION, firstName: "Claire", lastName: "Dupont", organization: "Ville de Luxembourg", email: "claire.dupont@example.test", guestFirstName: "Jean", guestLastName: "Dupont", registrationStatus: "confirmed", createdAt: now }],
  ["vipPublicRegistrations/cashtest-v2", { editionId: EDITION, firstName: "Luc", lastName: "Kremer", organization: "POST", email: "luc.kremer@example.test", createdAt: now }],
];

const nationalRaces = [
  ["nationalRaceRequests/cashtest-n1", { editionId: EDITION, status: "selected", firstName: "Lea", lastName: "Muller", event: "800 m", gender: "femme", isLuxLicensed: true, club: "CAB", createdAt: now }],
];

const batch = db.batch();
batch.set(db.doc("appSettings/platform"), { activeEdition: EDITION }, { merge: true });
[...lists, ...guests, ...vip, ...nationalRaces].forEach(([path, data]) => batch.set(db.doc(path), data, { merge: true }));
await batch.commit();

let user;
try {
  user = await auth.getUserByEmail(TEST_EMAIL);
} catch {
  user = await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true, displayName: "Gestionnaire Test" });
}
await db.doc(`users/${user.uid}`).set(
  { firstName: "Gestionnaire", lastName: "Test", email: TEST_EMAIL, role: "gestionnaire", roles: ["gestionnaire"], userTypes: ["gestionnaire"], accountStatus: "actif", updatedAt: now },
  { merge: true },
);

console.log(`${lists.length} listes, ${guests.length} invités, ${vip.length} VIP, ${nationalRaces.length} course nationale ; compte ${TEST_EMAIL} prêt.`);
