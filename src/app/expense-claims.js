// Factures et décomptes (remboursements) — règles pures, testées dans
// tests/expense-claims.test.js. Décisions de Margot du 10/11/2026 :
//  - une facture dit comment elle a été payée : pas encore payée (la FLA paie
//    le fournisseur), déjà payée par la FLA, ou avancée par la personne →
//    remboursement = « décompte » (modèle « Décompte vierge 2026 ») ;
//  - un décompte porte une ou plusieurs factures / justificatifs (obligatoires) ;
//  - envoyé à Margot (Excel rempli en pièce jointe), qui le vérifie puis le
//    transmet au secrétariat pour paiement ; suivi en ligne (voir, Excel, PDF) ;
//  - Margot peut préparer un décompte (ex. « Forfait 1 jour – Transport
//    300 € ») pour des personnes choisies, qui le complètent et le renvoient ;
//  - signature = case « je certifie » + nom + date ; adresse et IBAN gardés
//    dans le profil privé de la personne.
//
// Collection Firestore : expenseClaims/{id}
//   { editionYear, status, ownerUid, ownerEmail, ownerFirstName, ownerLastName,
//     address, iban, bank, reason, lines: [{ date, place, detail, amount }],
//     advance, receipts: [{ fileUrl, fileName, filePath, mimeType }],
//     certified, certifiedAt, preset: { byName, note } | null,
//     history: [{ status, at, byName }], submittedAt, createdAt, updatedAt }

const DECOMPTE_RECIPIENT = "margot.laporte@fla.lu";
const MAX_CLAIM_LINES = 18; // lignes 18 à 35 du modèle Excel

const PAYMENT_METHODS = [
  { value: "to_pay", label: "Pas encore payée — la FLA paie le fournisseur", labelEn: "Not paid yet — the FLA pays the supplier" },
  { value: "paid_by_fla", label: "Déjà payée par la FLA (carte ou virement)", labelEn: "Already paid by the FLA (card or transfer)" },
  { value: "reimbursement", label: "Je l'ai payée moi-même → remboursement (décompte)", labelEn: "I paid it myself → reimbursement (expense claim)" },
];

const CLAIM_STATUSES = [
  { value: "preset", label: "À compléter", labelEn: "To complete", tone: "warn" },
  { value: "draft", label: "Brouillon", labelEn: "Draft", tone: "muted" },
  { value: "submitted", label: "Envoyé", labelEn: "Sent", tone: "info" },
  { value: "checked", label: "Vérifié", labelEn: "Checked", tone: "info" },
  // Dernière étape suivie dans MyCLIM (Margot, 10/11/2026) : le paiement
  // lui-même est fait par le secrétariat, on ne le marque pas ici.
  { value: "sent_secretary", label: "Transmis au secrétariat", labelEn: "Passed to the secretariat", tone: "ok" },
  { value: "rejected", label: "À corriger", labelEn: "To correct", tone: "danger" },
];

// Ce qui manque avant l'envoi : les textes restent en français (tests, logique),
// traduits à l'affichage.
const CLAIM_PROBLEMS_EN = {
  "Prénom et nom": "First and last name",
  "Domicile": "Home address",
  "IBAN valide": "A valid IBAN",
  "Banque et BIC": "Bank and BIC",
  "Motif des dépenses": "Reason for the expenses",
  "Au moins une dépense": "At least one expense",
  "Détail et montant de chaque dépense": "Detail and amount of each expense",
  "Un montant": "An amount",
  "Au moins une facture ou un justificatif": "At least one invoice or receipt",
  "La case « je certifie »": "The “I certify” box",
};

function claimProblemLabel(problem, tr) {
  return tr(problem, CLAIM_PROBLEMS_EN[problem] || problem);
}

// Suite logique des statuts côté organisateur (boutons du suivi).
const NEXT_STATUS = { submitted: "checked", checked: "sent_secretary" };

function getClaimStatus(value) {
  return CLAIM_STATUSES.find((status) => status.value === value) || CLAIM_STATUSES[1];
}

function toAmount(value) {
  const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

// language : "fr" (défaut, aussi pour l'Excel/PDF) ou autre → format anglais.
function formatAmount(value, language = "fr") {
  return `${toAmount(value).toLocaleString(language === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function normalizeIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function formatIban(value) {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}

// IBAN : longueur et clé de contrôle (mod 97), comme les banques.
function isValidIban(value) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

function normalizeLine(line = {}) {
  return {
    date: String(line.date || "").slice(0, 10),
    place: String(line.place || "").trim(),
    detail: String(line.detail || "").trim(),
    amount: toAmount(line.amount),
  };
}

function normalizeClaim(data = {}) {
  return {
    id: String(data.id || ""),
    editionYear: Number(data.editionYear) || null,
    status: CLAIM_STATUSES.some((status) => status.value === data.status) ? data.status : "draft",
    ownerUid: String(data.ownerUid || ""),
    ownerEmail: String(data.ownerEmail || "").toLowerCase(),
    ownerFirstName: String(data.ownerFirstName || "").trim(),
    ownerLastName: String(data.ownerLastName || "").trim(),
    address: String(data.address || "").trim(),
    iban: normalizeIban(data.iban),
    bank: String(data.bank || "").trim(),
    reason: String(data.reason || "").trim(),
    lines: (Array.isArray(data.lines) ? data.lines : []).map(normalizeLine).slice(0, MAX_CLAIM_LINES),
    advance: toAmount(data.advance),
    receipts: (Array.isArray(data.receipts) ? data.receipts : [])
      .filter((receipt) => receipt?.fileUrl)
      .map((receipt) => ({
        fileUrl: String(receipt.fileUrl),
        fileName: String(receipt.fileName || "justificatif"),
        filePath: String(receipt.filePath || ""),
        mimeType: String(receipt.mimeType || ""),
      })),
    certified: Boolean(data.certified),
    certifiedAt: String(data.certifiedAt || ""),
    preset: data.preset && typeof data.preset === "object" ? { byName: String(data.preset.byName || ""), note: String(data.preset.note || "") } : null,
    history: Array.isArray(data.history) ? data.history : [],
    // Justificatif → facture du budget déjà créée (fileUrl → id du document).
    budgetInvoiceIds: data.budgetInvoiceIds && typeof data.budgetInvoiceIds === "object" ? { ...data.budgetInvoiceIds } : {},
  };
}

// Justificatifs pas encore envoyés au budget comme factures à classer.
function getReceiptsNotInBudget(claim) {
  return claim.receipts.filter((receipt) => !claim.budgetInvoiceIds?.[receipt.fileUrl]);
}

function computeClaimTotals(claim) {
  const total = toAmount(claim.lines.reduce((sum, line) => sum + toAmount(line.amount), 0));
  const advance = toAmount(claim.advance);
  return { total, advance, toPay: toAmount(total - advance) };
}

function claimOwnerName(claim) {
  return [claim.ownerFirstName, claim.ownerLastName].filter(Boolean).join(" ") || claim.ownerEmail || "—";
}

// Ce qui manque avant l'envoi (liste vide = prêt).
function getClaimSubmitProblems(claim) {
  const problems = [];
  if (!claim.ownerFirstName || !claim.ownerLastName) problems.push("Prénom et nom");
  if (!claim.address) problems.push("Domicile");
  if (!isValidIban(claim.iban)) problems.push("IBAN valide");
  if (!claim.bank) problems.push("Banque et BIC");
  if (!claim.reason) problems.push("Motif des dépenses");
  const lines = claim.lines.filter((line) => line.detail || line.amount);
  if (!lines.length) problems.push("Au moins une dépense");
  // Dans un décompte préparé, une ligne sans montant est une précision (ex. « Forfait 1 jour »).
  if (lines.some((line) => !line.detail || (!line.amount && !claim.preset))) problems.push("Détail et montant de chaque dépense");
  if (lines.length && !lines.some((line) => line.amount)) problems.push("Un montant");
  if (!claim.receipts.length) problems.push("Au moins une facture ou un justificatif");
  if (!claim.certified) problems.push("La case « je certifie »");
  return problems;
}

function claimFileName(claim) {
  const name = claimOwnerName(claim)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Decompte-${claim.editionYear || ""}-${name || "sans-nom"}`;
}

function summarizeClaims(claims = []) {
  const open = claims.filter((claim) => ["submitted", "checked"].includes(claim.status));
  return {
    toCheck: claims.filter((claim) => claim.status === "submitted").length,
    waiting: claims.filter((claim) => claim.status === "preset").length,
    openAmount: toAmount(open.reduce((sum, claim) => sum + computeClaimTotals(claim).toPay, 0)),
    sentAmount: toAmount(claims.filter((claim) => claim.status === "sent_secretary").reduce((sum, claim) => sum + computeClaimTotals(claim).toPay, 0)),
  };
}

export {
  CLAIM_STATUSES,
  DECOMPTE_RECIPIENT,
  MAX_CLAIM_LINES,
  NEXT_STATUS,
  PAYMENT_METHODS,
  claimFileName,
  claimOwnerName,
  claimProblemLabel,
  computeClaimTotals,
  formatAmount,
  formatIban,
  getClaimStatus,
  getClaimSubmitProblems,
  getReceiptsNotInBudget,
  isValidIban,
  normalizeClaim,
  normalizeIban,
  summarizeClaims,
  toAmount,
};
