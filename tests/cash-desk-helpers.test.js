import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCheckInKey,
  buildDoorEntries,
  evaluateCheckIn,
  filterDoorEntries,
  normalizeCashPostCode,
  parseGuestImportRows,
} from "../src/app/cash-desk-helpers.js";

test("buildDoorEntries merges VIP sources without duplicates and hides VIP on public posts", () => {
  const input = {
    editionId: "2027",
    vipAdminRegistrations: [{ id: "a1", firstName: "Ada", lastName: "Lovelace", email: "ada@x.lu" }],
    vipPublicRegistrations: [
      { id: "p1", firstName: "Ada", lastName: "Lovelace", email: "ADA@x.lu" },
      { id: "p2", firstName: "Grace", lastName: "Hopper", guestFirstName: "Bob", guestLastName: "H" },
    ],
    vipPortalEntries: [{ id: "e1", portalId: "cmcm", firstName: "Alan", lastName: "Turing" }],
    guestLists: [
      { id: "l1", name: "Sponsors", postScope: "all" },
      { id: "l2", name: "Fédé", postScope: "vip" },
    ],
    guests: [
      { id: "g1", listId: "l1", firstName: "Marie", lastName: "Curie", places: 3 },
      { id: "g2", listId: "l2", firstName: "Niels", lastName: "Bohr" },
    ],
    checkIns: [{ id: buildCheckInKey("2027", "door_guest", "g1"), admittedCount: 1 }],
  };

  const vipEntries = buildDoorEntries({ ...input, post: { kind: "vip", showVipLists: true } });
  assert.deepEqual(
    vipEntries.map((entry) => entry.fullName),
    ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Marie Curie", "Niels Bohr"],
  );
  assert.equal(vipEntries.find((entry) => entry.fullName === "Ada Lovelace").sourceType, "vip_admin");
  assert.equal(vipEntries.find((entry) => entry.fullName === "Grace Hopper").places, 2);
  const marie = vipEntries.find((entry) => entry.fullName === "Marie Curie");
  assert.equal(marie.admittedCount, 1);
  assert.equal(marie.remainingPlaces, 2);

  const publicEntries = buildDoorEntries({ ...input, post: { kind: "public", showVipLists: false } });
  assert.deepEqual(publicEntries.map((entry) => entry.fullName), ["Marie Curie"]);
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
    ["", "Turing", "", "", ""],
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
});

test("normalizeCashPostCode ignores separators and case", () => {
  assert.equal(normalizeCashPostCode(" ab3-k9 7q "), "AB3K97Q");
});
