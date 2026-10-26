import test from "node:test";
import assert from "node:assert/strict";

import { fmtLong, monthGridDays, parseYmd } from "../src/app/communication/com-dates.js";
import { buildCalendarItems, movedRule, occurs, ruleAt, ruleLabel } from "../src/app/communication/com-recurrence.js";
import { buildComPartner, normalizeObligation, obligationProgress } from "../src/app/communication/com-partners.js";
import { linkLabel, normalizePublication } from "../src/app/communication/com-domain.js";

test("monthGridDays covers full Monday-to-Sunday weeks", () => {
  const days = monthGridDays(2027, 0); // janvier 2027 commence un vendredi
  assert.equal(days.length % 7, 0);
  assert.equal(days[0].getDay(), 1);
  assert.equal(fmtLong("2027-01-01"), "vendredi 1er janvier");
});

test("occurs handles weekly, nth-weekday and last-weekday rules", () => {
  const thursday = parseYmd("2027-01-21"); // 3e jeudi
  assert.equal(occurs({ kind: "weekly", dow: 4 }, thursday), true);
  assert.equal(occurs({ kind: "monthly", dow: 4, nth: [3] }, thursday), true);
  assert.equal(occurs({ kind: "monthly", dow: 4, nth: [1] }, thursday), false);
  assert.equal(occurs({ kind: "last", dow: 4 }, parseYmd("2027-01-28")), true);
  assert.equal(occurs({ kind: "last", dow: 4 }, thursday), false);
  assert.equal(ruleLabel({ kind: "monthly", dow: 5, nth: [2, 4] }), "2e et 4e vendredi du mois");
});

test("ruleAt keeps old rules for past dates and movedRule shifts the series", () => {
  const rubrique = { rule: { kind: "weekly", dow: 3 }, history: [{ until: "2027-01-10", rule: { kind: "weekly", dow: 1 } }] };
  assert.equal(ruleAt(rubrique, "2027-01-05").dow, 1);
  assert.equal(ruleAt(rubrique, "2027-01-12").dow, 3);
  assert.deepEqual(movedRule({ kind: "monthly", dow: 4, nth: [3] }, parseYmd("2027-01-21"), parseYmd("2027-01-29")), {
    kind: "monthly",
    dow: 5,
    nth: [5],
  });
});

test("buildCalendarItems merges virtual occurrences with saved, moved and cancelled ones", () => {
  const rubriques = [{ id: "r1", titre: "Countdown", type: "post", canaux: ["ig"], responsableUid: "u1", rule: { kind: "weekly", dow: 1 }, history: [], active: true }];
  const publications = [
    { id: "r_r1_2027-01-11", rubriqueId: "r1", occurrenceDate: "2027-01-11", date: "2027-01-13", titre: "Countdown J-4", type: "post", canaux: ["ig"], statut: "doing", annulee: false },
    { id: "r_r1_2027-01-18", rubriqueId: "r1", occurrenceDate: "2027-01-18", date: "2027-01-18", titre: "Countdown", annulee: true },
    { id: "p1", date: "2027-01-17", titre: "Jour J", type: "story", canaux: ["ig", "fb"], statut: "todo", annulee: false },
  ];
  const items = buildCalendarItems({ rubriques, publications, start: "2027-01-01", end: "2027-01-31", today: "2027-01-08" });
  const dates = items.map((item) => `${item.date}:${item.titre}`);
  assert.deepEqual(dates, [
    "2027-01-04:Countdown",
    "2027-01-13:Countdown J-4",
    "2027-01-17:Jour J",
    "2027-01-25:Countdown",
  ]);
  assert.equal(items[0].statut, "done"); // passée, jamais modifiée
  assert.equal(items[0].materialized, false);
  assert.deepEqual(items[0].assigneUids, ["u1"]);
  assert.equal(items[3].statut, "todo");
});

test("buildComPartner joins the public sponsor with private details", () => {
  const partner = buildComPartner({ id: "cmcm", name: "CMCM", logoUrl: "x.png", category: "title" }, { handle: "@cmcm", contratFin: "2027-02-28" }, "Title partner");
  assert.equal(partner.nom, "CMCM");
  assert.equal(partner.niveau, "Title partner");
  assert.equal(partner.handle, "@cmcm");
  assert.equal(partner.contact, "");
  assert.equal(partner.hasDetails, true);
});

test("obligationProgress counts published mentions and flags late counterparts", () => {
  const partner = { id: "cmcm", contratDebut: "2026-10-01", contratFin: "2027-03-31" };
  const ob = normalizeObligation({ partnerId: "cmcm", categorie: "social", mode: "publications", cible: 10 });
  const ctx = {
    today: "2027-01-15",
    rubriques: [],
    partnerPublications: [
      { id: "a", date: "2026-11-02", partnerIds: ["cmcm"], statut: "done", type: "post" },
      { id: "b", date: "2027-01-20", partnerIds: ["cmcm"], statut: "todo", type: "post" },
    ],
    rubriquePublications: [],
  };
  const progress = obligationProgress(partner, ob, ctx);
  assert.equal(progress.fait, 1);
  assert.equal(progress.prevus, 1);
  assert.equal(progress.statut, "late"); // ~6 attendues à mi-contrat

  const noContract = obligationProgress({ id: "cmcm" }, ob, ctx);
  assert.equal(noContract.attendu, null);
  assert.equal(noContract.statut, "ontrack");

  const livrable = normalizeObligation({ partnerId: "cmcm", categorie: "print", mode: "livrable", etape: 3 });
  assert.equal(obligationProgress(partner, livrable, ctx).statut, "done");
});

test("linkLabel names known services and falls back to the domain", () => {
  assert.equal(linkLabel("https://flaluxembourg.sharepoint.com/:f:/s/meeting/abc"), "SharePoint");
  assert.equal(linkLabel("https://drive.google.com/drive/folders/xyz"), "Google Drive");
  assert.equal(linkLabel("https://www.example.lu/visuel.png"), "example.lu");
  assert.deepEqual(normalizePublication({ liens: [{ label: "A", url: "https://a.lu" }, null, { label: "x" }] }).liens, [{ label: "A", url: "https://a.lu" }]);
});
