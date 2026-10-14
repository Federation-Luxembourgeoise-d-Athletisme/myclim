import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCallTimeCell,
  formatScheduleDay,
  normalizeRoadbook,
  parseCallTimeRows,
  pickText,
  splitLines,
} from "../src/app/athlete-roadbook-shared.js";

test("normalizeRoadbook fills missing sections from the default content", () => {
  const roadbook = normalizeRoadbook({ status: "published", emergency: { phone: "+352 123" } });
  assert.equal(roadbook.status, "published");
  assert.equal(roadbook.emergency.phone, "+352 123");
  assert.equal(roadbook.schedule.length, 3);
  assert.ok(roadbook.arrival.fromAirport.fr.includes("T1"));
});

test("pickText falls back to the other language when one is empty", () => {
  assert.equal(pickText({ en: "Hello", fr: "" }, "fr"), "Hello");
  assert.equal(pickText({ en: "Hello", fr: "Bonjour" }, "fr"), "Bonjour");
  assert.deepEqual(splitLines("a\n\n b \n"), ["a", "b"]);
});

test("formatScheduleDay derives day labels from the competition date", () => {
  assert.equal(formatScheduleDay("2027-01-17T12:00:00", -2, "en"), "Friday 15 January");
  assert.equal(formatScheduleDay("2027-01-17T12:00:00", 0, "fr"), "dimanche 17 janvier");
  assert.equal(formatScheduleDay(null, -1, "fr"), "Jour de compétition −1");
});

test("formatCallTimeCell converts Excel day fractions to HH:MM", () => {
  assert.equal(formatCallTimeCell(0.65486111), "15:43");
  assert.equal(formatCallTimeCell("16:01 -  16:04"), "16:01 - 16:04");
  assert.equal(formatCallTimeCell(null), "");
});

test("parseCallTimeRows reads the 2026 layout, skipping a title row", () => {
  const { rows, missingColumns } = parseCallTimeRows([
    ["CALL TIMES"],
    ["Event", "1st Call 10'", "Last Call 3'", "Official Call\nRoom Time", "Call Room Out", "Warm-Up Infield", "Presentation Start", "Event Start"],
    ["60m Heat 1 Women", "15:43", "15:50", "15:53", "16:00", "16:01 - 16:04", "16:04", "16:06"],
    ["", "", "", "", "", "", "", ""],
    ["800m Final Women", 0.7138888, "17:15", "17:18", "17:27", "/", "17:29", "17:32"],
  ]);
  assert.deepEqual(missingColumns, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].officialCall, "15:53");
  assert.equal(rows[1].firstCall, "17:08");
  assert.equal(rows[1].warmUp, "/");
});

test("parseCallTimeRows accepts French headers and reports missing columns", () => {
  const { rows, missingColumns } = parseCallTimeRows([
    ["Épreuve", "Chambre d'appel", "Départ"],
    ["Perche F", "15:23", "16:57"],
  ]);
  assert.equal(rows[0].start, "16:57");
  assert.ok(missingColumns.includes("Last Call 3'"));
  assert.equal(parseCallTimeRows([["foo"]]).error, "missing_event_column");
});
