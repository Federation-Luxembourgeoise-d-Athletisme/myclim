import test from "node:test";
import assert from "node:assert/strict";

import {
  daysUntilEdition,
  formatDoorsTime,
  getCountdownParts,
  getDoorsOpenDate,
  getTicketPhase,
  showPlanVisitOnHome,
} from "../src/site/ticketing-utils.js";

const pricing = {
  saleOpensAt: "2026-11-17T10:00:00+01:00",
  earlyBirdEndsAt: "2026-12-18T23:59:59+01:00",
};
const edition = "2027-01-17";
const lux = (value) => new Date(`${value}+01:00`);

test("getTicketPhase follows the sale calendar", () => {
  assert.equal(getTicketPhase(pricing, edition, lux("2026-11-04T12:00:00")), "presale");
  assert.equal(getTicketPhase(pricing, edition, lux("2026-11-17T10:00:00")), "earlyBird");
  assert.equal(getTicketPhase(pricing, edition, lux("2026-12-18T23:30:00")), "earlyBird");
  assert.equal(getTicketPhase(pricing, edition, lux("2026-12-19T00:10:00")), "regular");
  assert.equal(getTicketPhase(pricing, edition, lux("2027-01-17T09:00:00")), "eventDay");
  assert.equal(getTicketPhase(pricing, edition, lux("2027-01-18T09:00:00")), "past");
});

test("getTicketPhase works without an edition date", () => {
  assert.equal(getTicketPhase(pricing, null, lux("2026-12-01T12:00:00")), "earlyBird");
});

test("getDoorsOpenDate reads the doors time and defaults to 14:00", () => {
  assert.equal(getDoorsOpenDate(edition).toISOString(), "2027-01-17T13:00:00.000Z");
  assert.equal(getDoorsOpenDate(edition, "Doors open at 13h30").toISOString(), "2027-01-17T12:30:00.000Z");
  assert.equal(formatDoorsTime(getDoorsOpenDate(edition)), "14:00");
  assert.equal(getDoorsOpenDate(null), null);
});

test("getCountdownParts splits the time left and stops at zero", () => {
  const doors = getDoorsOpenDate(edition);
  assert.deepEqual(getCountdownParts(doors, lux("2027-01-15T12:30:00")), { days: 2, hours: 1, minutes: 30 });
  assert.equal(getCountdownParts(doors, lux("2027-01-17T14:00:00")), null);
});

test("Plan your visit shows on the homepage from 10 days before until the meeting day", () => {
  assert.equal(daysUntilEdition(edition, lux("2027-01-07T08:00:00")), 10);
  assert.equal(showPlanVisitOnHome(edition, lux("2027-01-06T23:00:00")), false);
  assert.equal(showPlanVisitOnHome(edition, lux("2027-01-07T00:30:00")), true);
  assert.equal(showPlanVisitOnHome(edition, lux("2027-01-17T20:00:00")), true);
  assert.equal(showPlanVisitOnHome(edition, lux("2027-01-18T10:00:00")), false);
  assert.equal(showPlanVisitOnHome(null), false);
});
