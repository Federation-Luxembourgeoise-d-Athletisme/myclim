import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVipRegistrationPayload,
  createEmptyVipFormData,
  getVipPartnerPortalLabel,
  getVipTourChoiceLabel,
} from "../src/app/vip-helpers.js";

test("createEmptyVipFormData applies defaults and overrides", () => {
  const formData = createEmptyVipFormData({ organization: "CMCM" });

  assert.equal(formData.organization, "CMCM");
  assert.equal(formData.vipTourChoice, "coque");
  assert.equal(formData.firstName, "");
});

test("getVipPartnerPortalLabel humanizes the shared portal slug", () => {
  assert.equal(getVipPartnerPortalLabel("ville-de-luxembourg"), "Ville De Luxembourg");
  assert.equal(getVipPartnerPortalLabel(""), "Partenaire VIP");
});

test("buildVipRegistrationPayload trims values and normalizes emails", () => {
  const payload = buildVipRegistrationPayload({
    firstName: " Ada ",
    lastName: " Lovelace ",
    organization: " CMCM ",
    email: " ADA@Example.com ",
    guestEmail: " GUEST@Example.com ",
    vipTourChoice: "",
  });

  assert.equal(payload.firstName, "Ada");
  assert.equal(payload.lastName, "Lovelace");
  assert.equal(payload.organization, "CMCM");
  assert.equal(payload.email, "ada@example.com");
  assert.equal(payload.guestEmail, "guest@example.com");
  assert.equal(payload.vipTourChoice, "coque");
});

test("getVipTourChoiceLabel resolves the configured labels", () => {
  assert.match(getVipTourChoiceLabel("coulisses"), /coulisses/i);
  assert.match(getVipTourChoiceLabel("unknown"), /non renseigné/i);
});

test("partner portal places: caps, place types and legacy contacts", async () => {
  const {
    computeVipPortalPlaces,
    getVipPortalContacts,
    getVipPortalPlaceTypes,
    parseVipPlacesCap,
  } = await import("../src/app/vip-helpers.js");

  assert.equal(parseVipPlacesCap(""), null);
  assert.equal(parseVipPlacesCap("12"), 12);
  assert.equal(parseVipPlacesCap("0"), 0);

  assert.deepEqual(getVipPortalPlaceTypes({}), ["vip"]);
  assert.deepEqual(getVipPortalPlaceTypes({ vipPlacesCap: 10, standardPlacesCap: 5 }), ["vip", "standard"]);
  assert.deepEqual(getVipPortalPlaceTypes({ vipPlacesCap: 0, standardPlacesCap: 5 }), ["standard"]);

  // Le quota compte les invitations ; l'accompagnant (nommé ou « + 1 ») ajoute une place.
  const places = computeVipPortalPlaces({ vipPlacesCap: 3, standardPlacesCap: 2 }, [
    { firstName: "A", guestFirstName: "B" },
    { firstName: "D", hasCompanion: true },
    { firstName: "C", placeType: "standard" },
  ]);
  assert.deepEqual(places.used, { vip: 2, standard: 1 });
  assert.deepEqual(places.seats, { vip: 4, standard: 1 });
  assert.deepEqual(places.remaining, { vip: 1, standard: 1 });

  assert.deepEqual(getVipPortalContacts({ contactName: "Fred Muller", contactEmail: "f@x.lu" }), [
    { firstName: "Fred", lastName: "Muller", email: "f@x.lu", phone: "" },
  ]);
});

test("partner portal companions counted in the quota (CMCM: 45 places, +1 included)", async () => {
  const {
    computeVipPortalPlaces,
    computeVipMissingPlaces,
    getVipPortalCompanionMode,
    vipCompanionModeFields,
  } = await import("../src/app/vip-helpers.js");

  assert.equal(getVipPortalCompanionMode({}), "extra");
  assert.equal(getVipPortalCompanionMode({ companionsAllowed: false, companionsInQuota: true }), "none");
  assert.equal(getVipPortalCompanionMode({ companionsInQuota: true }), "included");
  assert.deepEqual(vipCompanionModeFields("included"), { companionsAllowed: true, companionsInQuota: true });
  assert.deepEqual(vipCompanionModeFields("none"), { companionsAllowed: false, companionsInQuota: false });

  const cmcm = { vipPlacesCap: 5, companionsInQuota: true };
  const entries = [
    { id: "a", firstName: "A", hasCompanion: true },
    { id: "b", firstName: "B", guestFirstName: "Bea" },
  ];
  const places = computeVipPortalPlaces(cmcm, entries);
  assert.equal(places.unit, "people");
  assert.deepEqual(places.used, { vip: 4, standard: 0 });
  assert.equal(places.remaining.vip, 1);

  // 1 place left: a guest alone fits, a guest with a +1 is 1 place short.
  assert.equal(computeVipMissingPlaces(cmcm, entries, "vip", { firstName: "C" }), 0);
  assert.equal(computeVipMissingPlaces(cmcm, entries, "vip", { firstName: "C", hasCompanion: true }), 1);
  // Editing "a" to drop its +1 frees a place; keeping it costs nothing new.
  assert.equal(computeVipMissingPlaces(cmcm, entries, "vip", { firstName: "A", hasCompanion: true }, "a"), 0);

  // Default mode: the quota still counts invitations.
  const rtl = { vipPlacesCap: 2 };
  assert.equal(computeVipPortalPlaces(rtl, entries).used.vip, 2);
  assert.equal(computeVipMissingPlaces(rtl, entries, "vip", { firstName: "C" }), 1);
});

test("partner portal meeting contact falls back to Margot", async () => {
  const { getVipPortalMeetingContact } = await import("../src/app/vip-helpers.js");
  assert.equal(getVipPortalMeetingContact({}).email, "margot.laporte@fla.lu");
  assert.equal(getVipPortalMeetingContact({ meetingContact: null }).lastName, "Laporte");
  assert.equal(getVipPortalMeetingContact({ meetingContact: { firstName: "Paul", email: "p@fla.lu" } }).firstName, "Paul");
});

test('one portal, two modules: the company sees the places added up', async () => {
  const { computeVipPortalPlaces, getVipPortalCaps, portalHasVipModule, getVipPortalPlaceTypes } = await import('../src/app/vip-helpers.js');
  assert.equal(portalHasVipModule({ vipPlacesCap: 4 }), true);
  assert.equal(portalHasVipModule({ businessRace: true }), false);
  assert.equal(portalHasVipModule({ businessRace: true, vipPartner: true }), true);

  const both = { vipPartner: true, vipPlacesCap: 6, standardPlacesCap: 2, businessRace: true, businessRaceVipCap: 4, businessRaceStandardCap: 8 };
  const caps = getVipPortalCaps(both);
  assert.deepEqual(caps.total, { vip: 10, standard: 10 });
  assert.deepEqual(caps.partner, { vip: 6, standard: 2 });
  const places = computeVipPortalPlaces(both, [{ firstName: 'A' }, { firstName: 'B', placeType: 'standard' }]);
  assert.deepEqual(places.remaining, { vip: 9, standard: 9 });

  // Business Race seule : ses anciens champs VIP du partenariat sont ignorés.
  const raceOnly = { businessRace: true, vipPlacesCap: 99, businessRaceVipCap: 4, businessRaceStandardCap: 0 };
  assert.deepEqual(getVipPortalCaps(raceOnly).total, { vip: 4, standard: 0 });
  assert.deepEqual(getVipPortalPlaceTypes(raceOnly), ['vip']);

  // Partenariat VIP sans plafond : total illimité.
  assert.equal(getVipPortalCaps({ vipPartner: true, businessRace: true, businessRaceVipCap: 4 }).total.vip, null);
});

test('existing portal found by id, by a name containing the other, or by contact e-mail', async () => {
  const { findExistingPortal, buildCompanyPortalPath } = await import('../src/app/vip-helpers.js');
  const portals = [
    { id: 'cargolux', organizationName: 'Cargolux' },
    { id: 'bgl-bnp-paribas', organizationName: 'BGL BNP Paribas', contacts: [{ firstName: 'M', email: 'm.schmit@bgl.lu' }] },
  ];
  assert.equal(findExistingPortal(portals, { organizationName: 'Cargolux' }).id, 'cargolux');
  assert.equal(findExistingPortal(portals, { organizationName: 'BGL BNP' }).id, 'bgl-bnp-paribas');
  assert.equal(findExistingPortal(portals, { organizationName: 'Autre', email: 'M.Schmit@bgl.lu' }).id, 'bgl-bnp-paribas');
  assert.equal(findExistingPortal(portals, { organizationName: 'Cargo' }).id, 'cargolux');
  assert.equal(findExistingPortal(portals, { organizationName: 'Luxair' }), null);
  assert.equal(buildCompanyPortalPath({ id: 'cargolux' }), '/vip/orga/cargolux');
  assert.equal(buildCompanyPortalPath({ id: 'acme', businessRace: true }), '/business-race/acme');
});
