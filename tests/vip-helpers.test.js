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

  const places = computeVipPortalPlaces({ vipPlacesCap: 3, standardPlacesCap: 2 }, [
    { firstName: "A", guestFirstName: "B" },
    { firstName: "C", placeType: "standard" },
  ]);
  assert.deepEqual(places.used, { vip: 2, standard: 1 });
  assert.deepEqual(places.remaining, { vip: 1, standard: 1 });

  assert.deepEqual(getVipPortalContacts({ contactName: "Fred Muller", contactEmail: "f@x.lu" }), [
    { firstName: "Fred", lastName: "Muller", email: "f@x.lu", phone: "" },
  ]);
});
