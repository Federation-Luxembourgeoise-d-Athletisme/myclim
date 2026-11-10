import test from "node:test";
import assert from "node:assert/strict";
import {
  claimFileName,
  computeClaimTotals,
  getClaimSubmitProblems,
  isValidIban,
  normalizeClaim,
  summarizeClaims,
  toAmount,
} from "../src/app/expense-claims.js";

const complete = {
  ownerFirstName: "Lila",
  ownerLastName: "Müller",
  ownerEmail: "Lila@X.test",
  address: "1 rue du Stade, L-1234 Luxembourg",
  iban: "LU28 0019 4006 4475 0000",
  bank: "BCEE · BCEELULL",
  reason: "Courses buvette",
  lines: [{ date: "2027-01-15", place: "Luxembourg", detail: "Boissons", amount: "120,50" }, { detail: "Transport", amount: 30 }],
  advance: "50",
  receipts: [{ fileUrl: "https://x/1.pdf", fileName: "ticket.pdf" }],
  certified: true,
};

test("amounts accept French decimals and totals subtract the advance", () => {
  assert.equal(toAmount("120,50"), 120.5);
  assert.equal(toAmount(""), 0);
  const totals = computeClaimTotals(normalizeClaim(complete));
  assert.deepEqual(totals, { total: 150.5, advance: 50, toPay: 100.5 });
});

test("IBAN check uses the bank checksum", () => {
  assert.equal(isValidIban("LU28 0019 4006 4475 0000"), true);
  assert.equal(isValidIban("LU29 0019 4006 4475 0000"), false);
  assert.equal(isValidIban("FR76 3000 6000 0112 3456 7890 189"), true);
  assert.equal(isValidIban("abc"), false);
});

test("a complete claim is ready; missing pieces are listed", () => {
  assert.deepEqual(getClaimSubmitProblems(normalizeClaim(complete)), []);
  const problems = getClaimSubmitProblems(normalizeClaim({ ...complete, receipts: [], certified: false, iban: "LU00" }));
  assert.ok(problems.includes("IBAN valide"));
  assert.ok(problems.includes("Au moins une facture ou un justificatif"));
  assert.ok(problems.includes("La case « je certifie »"));
});

test("normalized claim keeps owner e-mail lower-case and an unknown status becomes draft", () => {
  const claim = normalizeClaim({ ...complete, status: "weird" });
  assert.equal(claim.ownerEmail, "lila@x.test");
  assert.equal(claim.status, "draft");
  assert.equal(claim.iban, "LU280019400644750000");
  assert.equal(claimFileName({ ...claim, editionYear: 2027 }), "Decompte-2027-Lila-Muller");
});

test("tracking summary counts claims to check and amounts", () => {
  const base = normalizeClaim(complete);
  const summary = summarizeClaims([
    { ...base, status: "submitted" },
    { ...base, status: "checked" },
    { ...base, status: "paid" },
    { ...base, status: "preset" },
  ]);
  assert.equal(summary.toCheck, 1);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.openAmount, 201);
  assert.equal(summary.paidAmount, 100.5);
});
