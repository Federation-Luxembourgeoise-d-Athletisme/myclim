// Données fictives des courses nationales, pour tester l'espace de la
// commission des athlètes en local. NE TOURNE QUE SUR LES ÉMULATEURS Firebase
// (auth 9099 + firestore 8080) : le script s'arrête si ce n'est pas le cas.
//
//   node scripts/seed-national-races-emulator.mjs          # ajoute / remet les données
//   node scripts/seed-national-races-emulator.mjs --clear  # les retire
//
// Compte de test créé (émulateur uniquement) :
//   commission.test@myclim.test / Commission-Test-2027
// Rôle commission_athletes : il voit seulement « Courses nationales ».
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
const TEST_EMAIL = "commission.test@myclim.test";
const TEST_PASSWORD = "Commission-Test-2027";
const SEED_TAG = "seed-national-races";

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const day = (offset) => Timestamp.fromMillis(Date.now() - offset * 86400000);

function request(id, data) {
  const isLuxLicensed = data.isLuxLicensed ?? true;
  return {
    id,
    editionId: EDITION_ID,
    athleteUserId: "",
    seedTag: SEED_TAG,
    email: `${id}@example.test`,
    phone: "+352 621 000 000",
    birthYear: data.birthDate ? Number(data.birthDate.slice(0, 4)) : null,
    event: "800 m",
    isLuxLicensed,
    club: isLuxLicensed ? data.club || "CAB" : "",
    bibNumber: isLuxLicensed ? data.bibNumber || "1234" : "",
    foreignCountry: isLuxLicensed ? "" : data.foreignCountry || "",
    foreignClub: isLuxLicensed ? "" : data.foreignClub || "",
    foreignLicenceNumber: isLuxLicensed ? "" : data.foreignLicenceNumber || "X-0001",
    worldAthleticsUrl: `https://worldathletics.org/athletes/luxembourg/${id}`,
    personalBest: "",
    seasonBest: "",
    seasonBestPlace: "",
    seasonBestDate: "",
    previousSeasonBest: "",
    previousSeasonBestPlace: "",
    previousSeasonBestDate: "",
    otherTime: "",
    notes: "",
    isMinor: false,
    imageConsent: true,
    status: "submitted",
    seltecEntered: false,
    role: "athlete",
    submittedAt: day(data.daysAgo ?? 5),
    updatedAt: FieldValue.serverTimestamp(),
    ...data,
    raceCode: `NAT${(data.event || "800 m").includes("800") ? "800" : "60"}${data.gender === "femme" ? "F" : "M"}`,
  };
}

const REQUESTS = [
  // 800 m femmes : 10 demandes, 4 Luxembourgeoises dont une sans SB 2026/2027.
  request("seed-800f-01", { firstName: "Lena", lastName: "Fischer", gender: "femme", birthDate: "1999-04-12", nationality: "Allemande", isLuxLicensed: false, foreignCountry: "Allemagne", foreignClub: "LG Saar 70", seasonBest: "2:03.10", seasonBestPlace: "Dortmund", seasonBestDate: "2026-12-14", pacerPayment: "oui", daysAgo: 9 }),
  request("seed-800f-02", { firstName: "Camille", lastName: "Dubois", gender: "femme", birthDate: "2001-08-30", nationality: "Française", isLuxLicensed: false, foreignCountry: "France", foreignClub: "Metz Athlétisme", seasonBest: "2:04.55", seasonBestPlace: "Metz", seasonBestDate: "2026-12-20", pacerPayment: "non", daysAgo: 8 }),
  request("seed-800f-03", { firstName: "Anouk", lastName: "Weber", gender: "femme", birthDate: "2003-02-02", nationality: "Luxembourgeoise", club: "CAB", bibNumber: "1187", seasonBest: "2:09.80", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", pacerPayment: "oui", daysAgo: 7 }),
  request("seed-800f-04", { firstName: "Sophie", lastName: "Martens", gender: "femme", birthDate: "1998-11-19", nationality: "Belge", isLuxLicensed: false, foreignCountry: "Belgique", foreignClub: "RFCL Liège", seasonBest: "2:05.20", seasonBestPlace: "Gand", seasonBestDate: "2026-12-21", pacerPayment: "oui", daysAgo: 7 }),
  request("seed-800f-05", { firstName: "Mia", lastName: "Schmit", gender: "femme", birthDate: "2008-06-15", nationality: "Luxembourgeoise", club: "CSL", bibNumber: "2045", seasonBest: "2:14.30", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", isMinor: true, guardianFirstName: "Carole", guardianLastName: "Schmit", guardianEmail: "carole.schmit@example.test", guardianPhone: "+352 621 111 111", guardianConsent: true, pacerPayment: "non", notes: "Mineure, accord parental donné.", daysAgo: 6 }),
  request("seed-800f-06", { firstName: "Julie", lastName: "Hoffmann", gender: "femme", birthDate: "2000-01-25", nationality: "Luxembourgeoise", club: "CELTIC", bibNumber: "0932", previousSeasonBest: "2:11.40", previousSeasonBestPlace: "Bruxelles", previousSeasonBestDate: "2025-02-16", personalBest: "2:08.90", pacerPayment: "oui", notes: "Pas encore couru cette saison.", daysAgo: 5 }),
  request("seed-800f-07", { firstName: "Elena", lastName: "Rossi", gender: "femme", birthDate: "1997-09-03", nationality: "Italienne", isLuxLicensed: false, foreignCountry: "Italie", foreignClub: "Atletica Brescia", seasonBest: "2:06.75", seasonBestPlace: "Ancona", seasonBestDate: "2027-01-02", pacerPayment: "non", daysAgo: 4 }),
  request("seed-800f-08", { firstName: "Laura", lastName: "Meyer", gender: "femme", birthDate: "2002-05-11", nationality: "Luxembourgeoise", club: "CAEG", bibNumber: "1503", seasonBest: "2:12.05", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", pacerPayment: "oui", daysAgo: 3 }),
  request("seed-800f-09", { firstName: "Nina", lastName: "Kovac", gender: "femme", birthDate: "1999-12-01", nationality: "Croate", isLuxLicensed: false, foreignCountry: "Croatie", foreignClub: "AK Zagreb", seasonBest: "2:07.40", seasonBestPlace: "Zagreb", seasonBestDate: "2026-12-28", pacerPayment: "non", daysAgo: 2 }),
  request("seed-800f-10", { firstName: "Clara", lastName: "Bernard", gender: "femme", birthDate: "2001-03-09", nationality: "Française", isLuxLicensed: false, foreignCountry: "France", foreignClub: "Nancy Athlé", otherTime: "1000 m 2:48.00", otherTimePlace: "Nancy", otherTimeDate: "2026-12-13", status: "withdrawn", pacerPayment: "non", daysAgo: 2 }),
  // 800 m hommes : 9 demandes, dont un déjà retenu et prévenu, un en attente prévenu.
  request("seed-800m-01", { firstName: "Tom", lastName: "Wagner", gender: "homme", birthDate: "1998-07-21", nationality: "Luxembourgeoise", club: "CAPA", bibNumber: "0811", seasonBest: "1:52.40", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", status: "selected", notifiedStatus: "selected", notifiedAt: day(1), notifiedBy: "Commission Test", pacerPayment: "oui", daysAgo: 10 }),
  request("seed-800m-02", { firstName: "Lukas", lastName: "Braun", gender: "homme", birthDate: "1996-10-05", nationality: "Allemande", isLuxLicensed: false, foreignCountry: "Allemagne", foreignClub: "TV Wattenscheid", seasonBest: "1:48.90", seasonBestPlace: "Karlsruhe", seasonBestDate: "2027-01-03", pacerPayment: "oui", daysAgo: 9 }),
  request("seed-800m-03", { firstName: "Hugo", lastName: "Lefèvre", gender: "homme", birthDate: "2000-04-17", nationality: "Française", isLuxLicensed: false, foreignCountry: "France", foreignClub: "EA Reims", seasonBest: "1:49.60", seasonBestPlace: "Reims", seasonBestDate: "2026-12-27", pacerPayment: "non", daysAgo: 8 }),
  request("seed-800m-04", { firstName: "Max", lastName: "Thill", gender: "homme", birthDate: "2004-02-28", nationality: "Luxembourgeoise", club: "CSN Clervaux", bibNumber: "1622", seasonBest: "1:56.10", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", pacerPayment: "oui", daysAgo: 7 }),
  request("seed-800m-05", { firstName: "Jonas", lastName: "Peeters", gender: "homme", birthDate: "1999-08-08", nationality: "Belge", isLuxLicensed: false, foreignCountry: "Belgique", foreignClub: "Excelsior", seasonBest: "1:50.20", seasonBestPlace: "Louvain-la-Neuve", seasonBestDate: "2026-12-20", pacerPayment: "non", daysAgo: 6 }),
  request("seed-800m-06", { firstName: "Paulo", lastName: "Ferreira", gender: "homme", birthDate: "2001-06-14", nationality: "Portugaise", club: "CAD", bibNumber: "1340", seasonBest: "1:54.80", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", pacerPayment: "oui", notes: "Nationalité portugaise, licencié au Luxembourg.", daysAgo: 5 }),
  request("seed-800m-07", { firstName: "David", lastName: "Kremer", gender: "homme", birthDate: "1997-12-30", nationality: "Luxembourgeoise", isLuxLicensed: false, foreignCountry: "Allemagne", foreignClub: "LAC Saarlouis", seasonBest: "1:51.30", seasonBestPlace: "Sarrebruck", seasonBestDate: "2026-12-14", pacerPayment: "non", notes: "Luxembourgeois licencié en Allemagne.", daysAgo: 4 }),
  request("seed-800m-08", { firstName: "Ben", lastName: "Schroeder", gender: "homme", birthDate: "2002-09-09", nationality: "Luxembourgeoise", club: "CAB", bibNumber: "1210", seasonBest: "1:58.70", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", status: "waitlist", notifiedStatus: "waitlist", notifiedAt: day(1), notifiedBy: "Commission Test", pacerPayment: "non", daysAgo: 3 }),
  request("seed-800m-09", { firstName: "Mats", lastName: "Jansen", gender: "homme", birthDate: "1995-03-03", nationality: "Néerlandaise", isLuxLicensed: false, foreignCountry: "Pays-Bas", foreignClub: "AV Haarlem", seasonBest: "1:50.95", seasonBestPlace: "Apeldoorn", seasonBestDate: "2027-01-04", pacerPayment: "oui", daysAgo: 1 }),
  // Lièvre ajouté par la commission au 800 m hommes.
  request("seed-800m-pacer", { firstName: "Yann", lastName: "Reiter", gender: "homme", birthDate: "1994-05-05", nationality: "Luxembourgeoise", club: "CELTIC", bibNumber: "0420", seasonBest: "1:51.00", role: "pacer", source: "commission", addedBy: "Commission Test", status: "selected", daysAgo: 1 }),
  // 60 m sur invitation : quelques invités ajoutés par la commission.
  request("seed-60f-01", { event: "60 m", firstName: "Patrizia", lastName: "Van der Weken", gender: "femme", birthDate: "2000-02-08", nationality: "Luxembourgeoise", club: "CSL", bibNumber: "0101", seasonBest: "7.25", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", source: "commission", addedBy: "Commission Test", daysAgo: 2 }),
  request("seed-60f-02", { event: "60 m", firstName: "Iris", lastName: "Lambert", gender: "femme", birthDate: "1998-06-22", nationality: "Belge", isLuxLicensed: false, foreignCountry: "Belgique", foreignClub: "Vilvoorde AC", seasonBest: "7.31", seasonBestPlace: "Gand", seasonBestDate: "2027-01-02", source: "commission", addedBy: "Commission Test", notes: "Étrangère : confirmation attendue.", daysAgo: 2 }),
  request("seed-60m-01", { event: "60 m", firstName: "Olivier", lastName: "Boussong", gender: "homme", birthDate: "1999-01-18", nationality: "Luxembourgeoise", club: "CAEG", bibNumber: "0222", seasonBest: "6.78", seasonBestPlace: "Luxembourg", seasonBestDate: "2026-12-07", source: "commission", addedBy: "Commission Test", status: "selected", daysAgo: 2 }),
];

async function ensureCommissionUser() {
  let user;
  try {
    user = await auth.getUserByEmail(TEST_EMAIL);
  } catch {
    user = await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true, displayName: "Commission Test" });
  }
  await db.doc(`users/${user.uid}`).set(
    {
      firstName: "Commission",
      lastName: "Test",
      email: TEST_EMAIL,
      role: "commission_athletes",
      roles: ["commission_athletes"],
      userTypes: ["commission_athletes"],
      accountStatus: "actif",
      seedTag: SEED_TAG,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return user;
}

async function clear() {
  const snapshot = await db.collection("nationalRaceRequests").where("seedTag", "==", SEED_TAG).get();
  const batch = db.batch();
  snapshot.docs.forEach((entry) => batch.delete(entry.ref));
  await batch.commit();
  console.log(`${snapshot.size} demandes fictives retirées.`);
}

if (process.argv.includes("--clear")) {
  await clear();
} else {
  await ensureCommissionUser();
  const batch = db.batch();
  REQUESTS.forEach(({ id, ...data }) => batch.set(db.doc(`nationalRaceRequests/${id}`), data));
  await batch.commit();
  console.log(`${REQUESTS.length} demandes fictives écrites, compte ${TEST_EMAIL} prêt.`);
}
