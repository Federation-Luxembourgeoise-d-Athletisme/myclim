import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailyAvailability,
  buildPhysioBookingId,
  buildSessionSlots,
  validatePhysioSession,
} from "../src/app/physio-helpers.js";

test("buildSessionSlots cuts a session into full slots only", () => {
  assert.deepEqual(buildSessionSlots({ start: "16:00", end: "17:10", slotMinutes: 20 }), [
    { start: "16:00", end: "16:20" },
    { start: "16:20", end: "16:40" },
    { start: "16:40", end: "17:00" },
  ]);
  assert.deepEqual(buildSessionSlots({ start: "17:00", end: "16:00", slotMinutes: 20 }), []);
});

test("buildDailyAvailability adds up physios working at the same time", () => {
  const sessions = [
    { id: "a", date: "2027-01-16", start: "16:00", end: "16:40", slotMinutes: 20 },
    { id: "b", date: "2027-01-16", start: "16:20", end: "17:00", slotMinutes: 20 },
    { id: "c", date: "2027-01-17", start: "10:00", end: "11:00", slotMinutes: 30 },
  ];
  const bookings = [
    { id: buildPhysioBookingId("a", "16:20"), status: "booked" },
    { id: buildPhysioBookingId("b", "16:40"), status: "cancelled" },
  ];
  assert.deepEqual(buildDailyAvailability(sessions, bookings, "2027-01-16"), [
    { start: "16:00", end: "16:20", capacity: 1, remaining: 1 },
    { start: "16:20", end: "16:40", capacity: 2, remaining: 1 },
    { start: "16:40", end: "17:00", capacity: 1, remaining: 1 },
  ]);
});

test("validatePhysioSession explains what is missing", () => {
  const valid = { date: "2027-01-16", start: "16:00", end: "19:00", slotMinutes: 20, location: "Salle kiné" };
  assert.equal(validatePhysioSession(valid), "");
  assert.match(validatePhysioSession({ ...valid, end: "15:00" }), /après/);
  assert.match(validatePhysioSession({ ...valid, location: " " }), /lieu/);
  assert.match(validatePhysioSession({ ...valid, end: "16:10" }), /plus courte/);
});
