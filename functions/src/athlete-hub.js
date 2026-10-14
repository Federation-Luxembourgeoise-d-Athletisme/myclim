/* global Buffer */

// Espace athlète du roadbook (« Mes réservations ») : kiné et places gratuites.
// Pas de compte ni de lien personnel : l'athlète s'identifie avec son nom et
// son année de naissance (données du portail athlètes). Il reçoit un « pass »
// signé (HMAC) que le téléphone garde et renvoie à chaque appel ; plusieurs
// pass peuvent coexister sur un même téléphone (manager, coach).

import admin from "firebase-admin";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const REGION = "europe-west1";
const DEFAULT_EDITION = "test";
const MAX_GUESTS = 2;
const IDENTIFY_MAX_FAILURES = 20;
const IDENTIFY_WINDOW_MS = 15 * 60 * 1000;

const db = () => admin.firestore();

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeEditionId(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-") || DEFAULT_EDITION;
}

function resolveBirthYear(athlete = {}) {
  const candidates = [athlete.birthYear, athlete.yob, athlete.birthDate ? String(athlete.birthDate).slice(0, 4) : null];
  for (const candidate of candidates) {
    const year = Number.parseInt(candidate, 10);
    if (Number.isFinite(year) && year > 1900 && year < 2100) return year;
  }
  return null;
}

async function getActiveEditionId() {
  const snapshot = await db().collection("appSettings").doc("platform").get();
  return normalizeEditionId(snapshot.exists ? snapshot.data()?.activeEdition : DEFAULT_EDITION);
}

// ── Pass signé ────────────────────────────────────────────────────────────

let cachedSecret = null;

async function getHubSecret() {
  if (cachedSecret) return cachedSecret;
  const ref = db().collection("appSettings").doc("athleteHubSecret");
  cachedSecret = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && snapshot.data()?.secret) return snapshot.data().secret;
    const secret = randomBytes(32).toString("hex");
    transaction.set(ref, { secret, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return secret;
  });
  return cachedSecret;
}

async function signPass(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", await getHubSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function readPass(pass) {
  const [body, signature] = String(pass || "").split(".");
  if (!body || !signature) throw new HttpsError("unauthenticated", "Identifie-toi à nouveau.");
  const expected = createHmac("sha256", await getHubSecret()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpsError("unauthenticated", "Identifie-toi à nouveau.");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const activeEditionId = await getActiveEditionId();
  if (payload.e !== activeEditionId) throw new HttpsError("unauthenticated", "Identifie-toi à nouveau.");

  const athleteSnapshot = await db().collection("athletes").doc(String(payload.a)).get();
  if (!athleteSnapshot.exists) throw new HttpsError("unauthenticated", "Identifie-toi à nouveau.");
  return { editionId: activeEditionId, athlete: { id: athleteSnapshot.id, ...athleteSnapshot.data() } };
}

function publicAthlete(athlete) {
  return {
    id: athlete.id,
    firstName: String(athlete.firstName || ""),
    lastName: String(athlete.lastName || ""),
    event: String(athlete.event || ""),
    nationality: String(athlete.nationality || ""),
  };
}

// ── Limite d'essais d'identification ─────────────────────────────────────

function attemptRefFor(request) {
  const ip = String(request.rawRequest?.ip || "unknown");
  return db().collection("athleteHubAttempts").doc(createHash("sha256").update(ip).digest("hex"));
}

async function assertNotRateLimited(attemptRef) {
  const snapshot = await attemptRef.get();
  const data = snapshot.exists ? snapshot.data() : null;
  if (data && Date.now() - (Number(data.windowStartMs) || 0) < IDENTIFY_WINDOW_MS && (Number(data.failures) || 0) >= IDENTIFY_MAX_FAILURES) {
    throw new HttpsError("resource-exhausted", "Trop d'essais. Réessaie dans quelques minutes.");
  }
}

async function registerFailure(attemptRef) {
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const data = snapshot.exists ? snapshot.data() : {};
    const now = Date.now();
    const inWindow = now - (Number(data.windowStartMs) || 0) < IDENTIFY_WINDOW_MS;
    transaction.set(attemptRef, {
      windowStartMs: inWindow ? data.windowStartMs : now,
      failures: inWindow ? (Number(data.failures) || 0) + 1 : 1,
    });
  });
}

// ── Créneaux (même découpage que src/app/physio-helpers.js) ─────────────

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minutesToTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function buildSessionSlots(session = {}) {
  const start = timeToMinutes(session.start);
  const end = timeToMinutes(session.end);
  const length = Number(session.slotMinutes);
  if (start === null || end === null || !(length > 0) || end <= start) return [];
  const slots = [];
  for (let cursor = start; cursor + length <= end; cursor += length) {
    slots.push({ start: minutesToTime(cursor), end: minutesToTime(cursor + length) });
  }
  return slots;
}

function bookingIdFor(sessionId, start) {
  return `${sessionId}__${String(start).replace(":", "")}`;
}

async function loadEditionSessions(editionId) {
  const snapshot = await db().collection("physioSessions").where("editionId", "==", editionId).get();
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function loadEditionBookings(editionId) {
  const snapshot = await db().collection("physioBookings").where("editionId", "==", editionId).get();
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function buildAvailability(sessions, bookings) {
  const taken = new Set(bookings.filter((booking) => booking.status !== "cancelled").map((booking) => booking.id));
  const days = new Map();
  sessions.forEach((session) => {
    const day = days.get(session.date) || new Map();
    buildSessionSlots(session).forEach((slot) => {
      const entry = day.get(slot.start) || { start: slot.start, end: slot.end, capacity: 0, remaining: 0 };
      entry.capacity += 1;
      if (!taken.has(bookingIdFor(session.id, slot.start))) entry.remaining += 1;
      day.set(slot.start, entry);
    });
    days.set(session.date, day);
  });
  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, slots]) => ({ date, slots: [...slots.values()].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)) }));
}

function publicBooking(booking) {
  return {
    id: booking.id,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    location: booking.location || "",
    status: booking.status,
  };
}

// ── Invités (liste de la caisse « Invités des athlètes ») ────────────────

function guestListId(editionId) {
  return `${editionId}-athlete-guests`;
}

function guestDocId(editionId, athleteId, index) {
  return `${editionId}-athlete-${athleteId}-${index + 1}`;
}

function checkInKeyFor(editionId, guestId) {
  return [editionId, "door_guest", guestId].map((part) => String(part).replace(/[/\s]+/g, "-")).join("__");
}

async function loadAthleteGuests(editionId, athleteId) {
  const refs = Array.from({ length: MAX_GUESTS }, (_, index) => db().collection("doorGuests").doc(guestDocId(editionId, athleteId, index)));
  const snapshots = await db().getAll(...refs);
  const checkInRefs = refs.map((ref) => db().collection("doorCheckIns").doc(checkInKeyFor(editionId, ref.id)));
  const checkIns = await db().getAll(...checkInRefs);
  return snapshots.map((snapshot, index) =>
    snapshot.exists
      ? {
          firstName: snapshot.data().firstName || "",
          lastName: snapshot.data().lastName || "",
          email: snapshot.data().email || "",
          admitted: (Number(checkIns[index].data()?.admittedCount) || 0) > 0,
        }
      : null,
  );
}

// ── Fonctions appelables ─────────────────────────────────────────────────

export const identifyAthlete = onCall({ region: REGION }, async (request) => {
  const lastName = normalizeText(request.data?.lastName);
  const birthYear = Number.parseInt(request.data?.birthYear, 10);
  const chosenAthleteId = String(request.data?.athleteId || "");
  if (!lastName || !Number.isFinite(birthYear)) {
    throw new HttpsError("invalid-argument", "Indique ton nom et ton année de naissance.");
  }

  const attemptRef = attemptRefFor(request);
  await assertNotRateLimited(attemptRef);

  const editionId = await getActiveEditionId();
  const snapshot = await db().collection("athletes").get();
  const matches = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((athlete) => normalizeEditionId(athlete.editionId) === editionId)
    .filter((athlete) => normalizeText(athlete.lastName) === lastName && resolveBirthYear(athlete) === birthYear);

  if (!matches.length) {
    await registerFailure(attemptRef);
    throw new HttpsError("not-found", "Aucun athlète trouvé avec ce nom et cette année de naissance.");
  }

  const selected = chosenAthleteId ? matches.find((athlete) => athlete.id === chosenAthleteId) : matches.length === 1 ? matches[0] : null;
  if (!selected) {
    return { candidates: matches.map(publicAthlete) };
  }

  return { pass: await signPass({ a: selected.id, e: editionId }), athlete: publicAthlete(selected) };
});

export const getAthleteHub = onCall({ region: REGION }, async (request) => {
  const { editionId, athlete } = await readPass(request.data?.pass);
  const [sessions, bookings, guests] = await Promise.all([
    loadEditionSessions(editionId),
    loadEditionBookings(editionId),
    loadAthleteGuests(editionId, athlete.id),
  ]);

  return {
    athlete: publicAthlete(athlete),
    bookings: bookings.filter((booking) => booking.athleteId === athlete.id && booking.status !== "cancelled").map(publicBooking),
    availability: buildAvailability(sessions, bookings),
    guests,
    maxGuests: MAX_GUESTS,
  };
});

export const bookPhysioSlot = onCall({ region: REGION }, async (request) => {
  const { editionId, athlete } = await readPass(request.data?.pass);
  const date = String(request.data?.date || "");
  const start = String(request.data?.start || "");

  const sessions = (await loadEditionSessions(editionId)).filter(
    (session) => session.date === date && buildSessionSlots(session).some((slot) => slot.start === start),
  );
  if (!sessions.length) throw new HttpsError("not-found", "Ce créneau n'existe plus.");

  const booking = await db().runTransaction(async (transaction) => {
    const mine = await transaction.get(db().collection("physioBookings").where("athleteId", "==", athlete.id));
    const alreadyBooked = mine.docs.some(
      (entry) => entry.data().editionId === editionId && entry.data().date === date && entry.data().status !== "cancelled",
    );
    if (alreadyBooked) throw new HttpsError("already-exists", "Tu as déjà un créneau kiné ce jour-là.");

    const refs = sessions.map((session) => db().collection("physioBookings").doc(bookingIdFor(session.id, start)));
    const snapshots = await transaction.getAll(...refs);
    const freeIndex = snapshots.findIndex((snapshot) => !snapshot.exists || snapshot.data().status === "cancelled");
    if (freeIndex < 0) throw new HttpsError("resource-exhausted", "Ce créneau vient d'être pris. Choisis-en un autre.");

    const session = sessions[freeIndex];
    const slot = buildSessionSlots(session).find((candidate) => candidate.start === start);
    const data = {
      editionId,
      sessionId: session.id,
      physioUid: session.physioUid || "",
      physioName: session.physioName || "",
      date,
      start: slot.start,
      end: slot.end,
      location: session.location || "",
      athleteId: athlete.id,
      athleteFirstName: String(athlete.firstName || ""),
      athleteLastName: String(athlete.lastName || ""),
      athleteEvent: String(athlete.event || ""),
      status: "booked",
      source: "athlete",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    transaction.set(refs[freeIndex], data);
    return { id: refs[freeIndex].id, ...data };
  });

  return { booking: publicBooking(booking) };
});

export const cancelPhysioBooking = onCall({ region: REGION }, async (request) => {
  const { athlete } = await readPass(request.data?.pass);
  const ref = db().collection("physioBookings").doc(String(request.data?.bookingId || ""));
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().athleteId !== athlete.id) {
    throw new HttpsError("not-found", "Réservation introuvable.");
  }
  // Supprimer libère le créneau pour un autre athlète.
  await ref.delete();
  return { ok: true };
});

export const saveAthleteGuests = onCall({ region: REGION }, async (request) => {
  const { editionId, athlete } = await readPass(request.data?.pass);
  const input = Array.isArray(request.data?.guests) ? request.data.guests.slice(0, MAX_GUESTS) : [];
  const guests = input.map((guest) => ({
    firstName: String(guest?.firstName || "").trim(),
    lastName: String(guest?.lastName || "").trim(),
    email: String(guest?.email || "").trim().toLowerCase(),
  }));
  guests.forEach((guest) => {
    const filled = guest.firstName || guest.lastName || guest.email;
    if (filled && (!guest.firstName || !guest.lastName)) {
      throw new HttpsError("invalid-argument", "Indique le prénom et le nom de chaque invité.");
    }
  });

  const current = await loadAthleteGuests(editionId, athlete.id);
  const athleteName = [athlete.firstName, athlete.lastName].filter(Boolean).join(" ");
  const listRef = db().collection("doorGuestLists").doc(guestListId(editionId));
  const batch = db().batch();
  batch.set(
    listRef,
    {
      name: "Invités des athlètes",
      category: "athletes",
      postScope: "all",
      editionId,
      active: true,
      source: "athlete_hub",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  for (let index = 0; index < MAX_GUESTS; index += 1) {
    const guest = guests[index] || { firstName: "", lastName: "", email: "" };
    const existing = current[index];
    const ref = db().collection("doorGuests").doc(guestDocId(editionId, athlete.id, index));
    const unchanged = existing && existing.firstName === guest.firstName && existing.lastName === guest.lastName;

    if (existing?.admitted && !unchanged) {
      throw new HttpsError("failed-precondition", `${existing.firstName} ${existing.lastName} est déjà entré(e) : cette place ne peut plus être modifiée.`);
    }

    if (!guest.firstName) {
      if (existing) batch.delete(ref);
      continue;
    }

    batch.set(ref, {
      listId: listRef.id,
      editionId,
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      organization: "",
      places: 1,
      notes: `Invité(e) de ${athleteName}${athlete.event ? ` (${athlete.event})` : ""}`,
      invitedByAthleteId: athlete.id,
      source: "athlete_hub",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { guests: await loadAthleteGuests(editionId, athlete.id) };
});
