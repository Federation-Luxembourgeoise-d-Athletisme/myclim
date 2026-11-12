import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCheckInKey,
  buildDoorEntries,
  countEntriesByPost,
  evaluateCheckIn,
  filterDoorEntries,
  flattenCheckInEvents,
  normalizeCashPostCode,
  parseGuestImportRows,
} from "../src/app/cash-desk-helpers.js";

test("buildDoorEntries merges VIP sources without duplicates and shows every active list", () => {
  const input = {
    editionId: "2027",
    vipAdminRegistrations: [{ id: "a1", firstName: "Ada", lastName: "Lovelace", email: "ada@x.lu" }],
    vipPublicRegistrations: [
      { id: "p1", firstName: "Ada", lastName: "Lovelace", email: "ADA@x.lu" },
      { id: "p2", firstName: "Grace", lastName: "Hopper", guestFirstName: "Bob", guestLastName: "H" },
    ],
    vipPortalEntries: [{ id: "e1", portalId: "cmcm", firstName: "Alan", lastName: "Turing" }],
    guestLists: [
      { id: "l1", name: "Sponsors", category: "sponsors" },
      { id: "l2", name: "Fédé", category: "officials" },
      { id: "l3", name: "Archivée", active: false },
    ],
    guests: [
      { id: "g1", listId: "l1", firstName: "Marie", lastName: "Curie", places: 3 },
      { id: "g2", listId: "l2", firstName: "Niels", lastName: "Bohr" },
      { id: "g3", listId: "l3", firstName: "Old", lastName: "Guest" },
    ],
    checkIns: [{ id: buildCheckInKey("2027", "door_guest", "g1"), admittedCount: 1 }],
  };

  const entries = buildDoorEntries(input);
  assert.deepEqual(
    entries.map((entry) => entry.fullName),
    ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Marie Curie", "Niels Bohr"],
  );
  assert.equal(entries.find((entry) => entry.fullName === "Ada Lovelace").sourceType, "vip_admin");
  assert.equal(entries.find((entry) => entry.fullName === "Ada Lovelace").kind, "vip");
  assert.equal(entries.find((entry) => entry.fullName === "Grace Hopper").places, 2);
  assert.equal(entries.find((entry) => entry.fullName === "Niels Bohr").kind, "officials");
  const marie = entries.find((entry) => entry.fullName === "Marie Curie");
  assert.equal(marie.kind, "sponsors");
  assert.equal(marie.admittedCount, 1);
  assert.equal(marie.remainingPlaces, 2);
});

test("flattenCheckInEvents sorts passages newest first and countEntriesByPost nets undos", () => {
  const events = flattenCheckInEvents([
    {
      id: "a",
      displayName: "Ada",
      history: [
        { postId: "p1", count: 2, at: new Date("2027-02-01T18:00:00Z") },
        { postId: "p1", count: -1, at: new Date("2027-02-01T18:05:00Z") },
      ],
    },
    { id: "b", displayName: "Bob", history: [{ postId: "p2", count: 1, at: new Date("2027-02-01T18:02:00Z") }] },
  ]);
  assert.deepEqual(events.map((event) => [event.displayName, event.count]), [["Ada", -1], ["Bob", 1], ["Ada", 2]]);
  const counts = countEntriesByPost(events);
  assert.equal(counts.get("p1"), 1);
  assert.equal(counts.get("p2"), 1);
});

test("filterDoorEntries matches every term, ignoring accents and case", () => {
  const entries = [
    { fullName: "Hélène Müller", organization: "CMCM", listName: "Sponsors", companions: [] },
    { fullName: "Paul Martin", organization: "Ville", listName: "VIP", companions: ["Hélène Martin"] },
  ];
  assert.equal(filterDoorEntries(entries, "helene").length, 2);
  assert.equal(filterDoorEntries(entries, "helene cmcm").length, 1);
  assert.equal(filterDoorEntries(entries, "").length, 2);
});

test("evaluateCheckIn blocks overflow unless forced, and undo below zero", () => {
  assert.deepEqual(evaluateCheckIn({ places: 2, admittedCount: 0, count: 2 }), { ok: true, nextCount: 2 });
  assert.deepEqual(evaluateCheckIn({ places: 2, admittedCount: 2, count: 1 }), {
    ok: false,
    reason: "overflow",
    remaining: 0,
  });
  assert.deepEqual(evaluateCheckIn({ places: 2, admittedCount: 2, count: 1, force: true }), { ok: true, nextCount: 3 });
  assert.equal(evaluateCheckIn({ places: 1, admittedCount: 0, count: -1 }).reason, "nothing_to_undo");
});

test("parseGuestImportRows maps French headers and defaults places to 1", () => {
  const { guests, skipped } = parseGuestImportRows([
    ["Prénom", "Nom", "Société", "E-mail", "Places"],
    ["Ada", "Lovelace", "CMCM", "ADA@X.LU", "3"],
    ["", "", "", "", ""],
    ["Alan", "Turing", "", "", ""],
  ]);
  assert.equal(skipped, 1);
  assert.deepEqual(guests[0], {
    firstName: "Ada",
    lastName: "Lovelace",
    organization: "CMCM",
    email: "ada@x.lu",
    places: 3,
    notes: "",
  });
  assert.equal(guests[1].places, 1);
});

test("parseGuestImportRows reports a file without any name column", () => {
  assert.equal(parseGuestImportRows([["Foo"], ["bar"]]).error, "missing_name_column");
  assert.equal(parseGuestImportRows([["Prénom"], ["Ada"]]).error, "missing_name_column");
});

test("parseGuestImportRows refuses a single full-name column", () => {
  assert.equal(parseGuestImportRows([["Nom complet"], ["Ada Lovelace"]]).error, "full_name_only");
});

test("normalizeCashPostCode ignores separators and case", () => {
  assert.equal(normalizeCashPostCode(" ab3-k9 7q "), "AB3K97Q");
});

test("buildDoorEntries lists selected national race athletes with one companion ticket", () => {
  const entries = buildDoorEntries({
    editionId: "2027",
    nationalRaceAthletes: [
      { id: "n1", editionId: "2027", status: "selected", firstName: "Lea", lastName: "Muller", event: "800 m", gender: "femme", isLuxLicensed: true, club: "CAB" },
      { id: "n2", editionId: "2027", status: "selected", role: "pacer", firstName: "Tom", lastName: "Weber", event: "800 m", gender: "homme" },
      { id: "n3", editionId: "2027", status: "waitlist", firstName: "Zoe", lastName: "Hoffmann", event: "800 m", gender: "femme" },
      { id: "n4", editionId: "2026", status: "selected", firstName: "Old", lastName: "Edition", event: "60 m", gender: "homme" },
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.fullName), ["Lea Muller", "Tom Weber"]);
  assert.equal(entries[0].places, 1);
  assert.equal(entries[0].sourceLabel, "Courses nationales · 800 m F");
  assert.equal(entries[0].organization, "CAB");
  assert.match(entries[1].notes, /lièvre/);
  assert.equal(entries[0].key, buildCheckInKey("2027", "national_race", "n1"));
});
