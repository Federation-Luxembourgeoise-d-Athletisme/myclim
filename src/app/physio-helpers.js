// Réservation kiné : logique pure partagée par la page des kinés (/app/kine)
// et la partie « Mes réservations » du roadbook. Même découpage des créneaux
// que functions/src/athlete-hub.js (à garder alignés).

const PHYSIO_SLOT_LENGTH_OPTIONS = [10, 15, 20, 25, 30, 45, 60];

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Créneaux complets d'une plage d'ouverture : un dernier bout plus court que
// la durée d'un créneau n'est pas proposé.
function buildSessionSlots(session = {}) {
  const start = timeToMinutes(session.start);
  const end = timeToMinutes(session.end);
  const length = Number(session.slotMinutes);
  if (start === null || end === null || !Number.isFinite(length) || length <= 0 || end <= start) return [];

  const slots = [];
  for (let cursor = start; cursor + length <= end; cursor += length) {
    slots.push({ start: minutesToTime(cursor), end: minutesToTime(cursor + length) });
  }
  return slots;
}

function buildPhysioBookingId(sessionId, start) {
  return `${sessionId}__${String(start || "").replace(":", "")}`;
}

// `tr(fr, en)` choisit la langue du message (français par défaut).
function validatePhysioSession(session = {}, tr = (fr) => fr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ""))) return tr("Choisis un jour.", "Pick a day.");
  const start = timeToMinutes(session.start);
  const end = timeToMinutes(session.end);
  if (start === null || end === null) return tr("Indique une heure d'ouverture et de fermeture (HH:MM).", "Enter an opening and closing time (HH:MM).");
  if (end <= start) return tr("L'heure de fermeture doit être après l'ouverture.", "The closing time must be after the opening time.");
  if (!buildSessionSlots(session).length) return tr("La plage est plus courte qu'un créneau.", "The opening window is shorter than one slot.");
  if (!String(session.location || "").trim()) return tr("Indique le lieu.", "Enter the location.");
  return "";
}

// Créneaux d'un jour, tous kinés confondus : un horaire proposé par 3 kinés
// a une capacité de 3. `remaining` = places encore libres.
function buildDailyAvailability(sessions = [], bookings = [], date = "") {
  const takenIds = new Set(bookings.filter((booking) => booking.status !== "cancelled").map((booking) => booking.id));
  const byStart = new Map();

  sessions
    .filter((session) => session.date === date)
    .forEach((session) => {
      buildSessionSlots(session).forEach((slot) => {
        const entry = byStart.get(slot.start) || { start: slot.start, end: slot.end, capacity: 0, remaining: 0 };
        entry.capacity += 1;
        if (!takenIds.has(buildPhysioBookingId(session.id, slot.start))) entry.remaining += 1;
        byStart.set(slot.start, entry);
      });
    });

  return [...byStart.values()].sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
}

function listSessionDates(sessions = []) {
  return [...new Set(sessions.map((session) => session.date).filter(Boolean))].sort();
}

function formatPhysioDate(date, language = "fr", options = { weekday: "long", day: "numeric", month: "long" }) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", options);
}

export {
  PHYSIO_SLOT_LENGTH_OPTIONS,
  buildDailyAvailability,
  buildPhysioBookingId,
  buildSessionSlots,
  formatPhysioDate,
  listSessionDates,
  minutesToTime,
  timeToMinutes,
  validatePhysioSession,
};
