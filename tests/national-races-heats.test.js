import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNationalRaceStartList,
  fillNationalRacePlacement,
  formatNationalRaceLane,
  getFirstFreeLane,
  normalizeNationalRaceConfig,
  validateNationalRaceLane,
} from "../src/app/national-races-heats.js";

const DEFINITIONS = [
  { code: "NAT60F", lanes: 8 },
  { code: "NAT800M", lanes: 6 },
];

const athlete = (id, heat = null, lane = null, status = "selected") => ({ id, heat, lane, status });

test("normalizeNationalRaceConfig defaults to 1 heat and the race lanes", () => {
  assert.deepEqual(normalizeNationalRaceConfig(null, DEFINITIONS), {
    NAT60F: { heats: 1, lanes: 8 },
    NAT800M: { heats: 1, lanes: 6 },
  });
});

test("normalizeNationalRaceConfig keeps admin values and rejects invalid ones", () => {
  const config = normalizeNationalRaceConfig({ races: { NAT60F: { heats: 3, lanes: 0 }, NAT800M: { heats: "x", lanes: 99 } } }, DEFINITIONS);
  assert.deepEqual(config.NAT60F, { heats: 3, lanes: 8 });
  assert.deepEqual(config.NAT800M, { heats: 1, lanes: 10 });
});

test("a lane already used in the same heat is refused and names the athlete", () => {
  const requests = [athlete("a", 1, 4), athlete("b")];
  const result = validateNationalRaceLane({ request: requests[1], heat: 1, lane: 4, raceRequests: requests, config: { heats: 2, lanes: 8 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "lane_taken");
  assert.equal(result.conflict.id, "a");
});

test("the same lane in another heat is allowed", () => {
  const requests = [athlete("a", 1, 4), athlete("b")];
  assert.deepEqual(validateNationalRaceLane({ request: requests[1], heat: 2, lane: 4, raceRequests: requests, config: { heats: 2, lanes: 8 } }), { ok: true });
});

test("a full heat is refused for a newcomer but an athlete already in it can change lane", () => {
  const config = { heats: 2, lanes: 3 };
  const requests = [athlete("a", 1, 1), athlete("b", 1, 2), athlete("c", 1, 3), athlete("d")];
  const refused = validateNationalRaceLane({ request: requests[3], heat: 1, lane: null, raceRequests: requests, config });
  assert.equal(refused.code, "heat_full");
  assert.equal(refused.heat, 1);
  // a passe du couloir 1 au 3 : couloir pris, mais pas « série complète ».
  assert.equal(validateNationalRaceLane({ request: requests[0], heat: 1, lane: 3, raceRequests: requests, config }).code, "lane_taken");
});

test("heat and lane must stay within the race settings", () => {
  const requests = [athlete("a")];
  const config = { heats: 2, lanes: 6 };
  assert.equal(validateNationalRaceLane({ request: requests[0], heat: 3, lane: 1, raceRequests: requests, config }).code, "heat_out_of_range");
  assert.equal(validateNationalRaceLane({ request: requests[0], heat: 1, lane: 7, raceRequests: requests, config }).code, "lane_out_of_range");
});

test("only selected athletes are placed, and deselected ones free their lane", () => {
  const config = { heats: 1, lanes: 8 };
  const requests = [athlete("a", 1, 4, "waitlist"), athlete("b")];
  assert.equal(validateNationalRaceLane({ request: requests[0], heat: 1, lane: 2, raceRequests: requests, config }).code, "not_selected");
  assert.deepEqual(validateNationalRaceLane({ request: requests[1], heat: 1, lane: 4, raceRequests: requests, config }), { ok: true });
  // Retirer un placement est toujours permis.
  assert.deepEqual(validateNationalRaceLane({ request: requests[0], heat: null, lane: null, raceRequests: requests, config }), { ok: true });
});

test("getFirstFreeLane skips taken lanes and returns null for a full heat", () => {
  const requests = [athlete("a", 1, 1), athlete("b", 1, 2)];
  assert.equal(getFirstFreeLane({ heat: 1, raceRequests: requests, config: { lanes: 3 } }), 3);
  assert.equal(getFirstFreeLane({ heat: 1, raceRequests: [...requests, athlete("c", 1, 3)], config: { lanes: 3 } }), null);
});

test("buildNationalRaceStartList groups by heat, sorts by lane and flags full heats", () => {
  const requests = [
    athlete("a", 1, 3),
    athlete("b", 1, 1),
    athlete("c", 2, 1),
    athlete("d"),
    athlete("e", 1, 2),
    athlete("x", 1, 2, "not_selected"),
  ];
  const list = buildNationalRaceStartList(requests, { heats: 2, lanes: 3 });
  assert.deepEqual(list.heats[0].entries.map((entry) => entry.request.id), ["b", "e", "a"]);
  assert.equal(list.heats[0].full, true);
  assert.equal(list.heats[1].full, false);
  assert.deepEqual(list.heats[1].freeLanes, [2, 3]);
  assert.deepEqual(list.unplaced.map((entry) => entry.request.id), ["d"]);
  assert.equal(list.placedCount, 4);
});

test("buildNationalRaceStartList sends out-of-range and duplicate placements back to unplaced", () => {
  const requests = [athlete("a", 3, 1), athlete("b", 1, 2), athlete("c", 1, 2)];
  const list = buildNationalRaceStartList(requests, { heats: 2, lanes: 8 });
  assert.deepEqual(list.unplaced.map(({ request, reason }) => [request.id, reason]), [["a", "out_of_range"], ["c", "duplicate"]]);
});

test("formatNationalRaceLane shows the heat and lane once both are set", () => {
  assert.equal(formatNationalRaceLane({ heat: 2, lane: 5 }, "fr"), "Série 2 · couloir 5");
  assert.equal(formatNationalRaceLane({ heat: 2, lane: 5 }, "en"), "Heat 2 · lane 5");
  assert.equal(formatNationalRaceLane({ heat: 2, lane: null }, "fr"), "");
});

test("fillNationalRacePlacement fills the variable or inserts the line before the signature", () => {
  assert.equal(fillNationalRacePlacement("Hello\n\n{placement}Bye", "Heat 1 · lane 4"), "Hello\n\nHeat 1 · lane 4\n\nBye");
  assert.equal(fillNationalRacePlacement("Hello\n\n{placement}Bye", ""), "Hello\n\nBye");
  assert.equal(fillNationalRacePlacement("Hello\n\nInfo\n\nBye", "Heat 1 · lane 4"), "Hello\n\nInfo\n\nHeat 1 · lane 4\n\nBye");
  assert.equal(fillNationalRacePlacement("Hello\n\nBye", ""), "Hello\n\nBye");
});
