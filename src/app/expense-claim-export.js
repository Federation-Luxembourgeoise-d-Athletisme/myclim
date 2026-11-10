import templateUrl from "../assets/decompte/decompte-template-2026.xlsx?url";
import { claimFileName, claimOwnerName, computeClaimTotals, formatAmount, formatIban } from "./expense-claims";

// Décompte rempli dans le modèle Excel de la FLA (« Décompte vierge 2026 ») :
// logo et mise en page d'origine, cellules D7…D15, lignes 18 à 35, totaux
// E36/E38/E40, nombre de justificatifs E43, date E45, certification D47.

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatDate(ymd) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(ymd || "");
}

async function buildClaimWorkbookBuffer(claim) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const template = await fetch(templateUrl).then((response) => response.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  const sheet = workbook.worksheets[0];
  const totals = computeClaimTotals(claim);

  sheet.getCell("D7").value = claimOwnerName(claim);
  sheet.getCell("D9").value = claim.address;
  sheet.getCell("D11").value = formatIban(claim.iban);
  sheet.getCell("D13").value = claim.bank;
  sheet.getCell("D15").value = claim.reason;
  claim.lines
    .filter((line) => line.detail || line.amount)
    .forEach((line, index) => {
      const row = 18 + index;
      sheet.getCell(`B${row}`).value = formatDate(line.date);
      sheet.getCell(`C${row}`).value = line.place;
      sheet.getCell(`D${row}`).value = line.detail;
      sheet.getCell(`E${row}`).value = line.amount;
      sheet.getCell(`E${row}`).numFmt = '#,##0.00 "€"';
    });
  // Le modèle ne totalisait que les lignes 18 à 22 : on couvre tout le tableau.
  sheet.getCell("E36").value = { formula: "SUM(E18:E35)", result: totals.total };
  sheet.getCell("E38").value = totals.advance;
  sheet.getCell("E40").value = { formula: "E36-E38", result: totals.toPay };
  ["E36", "E38", "E40"].forEach((address) => {
    sheet.getCell(address).numFmt = '#,##0.00 "€"';
  });
  sheet.getCell("E43").value = claim.receipts.length;
  sheet.getCell("E45").value = formatDate(String(claim.certifiedAt || "").slice(0, 10));
  sheet.getCell("D47").value = claim.certified
    ? `Certifié exact par ${claimOwnerName(claim)} le ${formatDate(String(claim.certifiedAt || "").slice(0, 10))} (MyCLIM)`
    : "";
  return workbook.xlsx.writeBuffer();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function buildClaimExcelAttachment(claim) {
  const buffer = await buildClaimWorkbookBuffer(claim);
  return { filename: `${claimFileName(claim)}.xlsx`, contentType: XLSX_TYPE, contentBase64: arrayBufferToBase64(buffer) };
}

async function downloadClaimExcel(claim) {
  const buffer = await buildClaimWorkbookBuffer(claim);
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${claimFileName(claim)}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Version imprimable (même contenu que le modèle) : la fenêtre d'impression
// du navigateur propose « Enregistrer au format PDF ».
function printClaimPdf(claim) {
  const totals = computeClaimTotals(claim);
  const lines = claim.lines.filter((line) => line.detail || line.amount);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(claimFileName(claim))}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font: 12px/1.45 Arial, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 2px; } .sub { color: #555; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-size: 11px; } .num { text-align: right; white-space: nowrap; }
  .meta td:first-child { width: 34%; color: #444; } .tot td { font-weight: bold; }
  .sign { margin-top: 18px; } .receipts { margin-top: 10px; font-size: 11px; color: #333; }
</style></head><body>
<h1>Décompte / Abrechnung</h1><p class="sub">Fédération Luxembourgeoise d'Athlétisme · CMCM Luxembourg Indoor Meeting ${escapeHtml(claim.editionYear || "")}</p>
<table class="meta">
<tr><td>Nom, prénom / Name, Vorname</td><td>${escapeHtml(claimOwnerName(claim))}</td></tr>
<tr><td>Domicile / Wohnort</td><td>${escapeHtml(claim.address)}</td></tr>
<tr><td>Numéro de compte / Kontonummer (IBAN)</td><td>${escapeHtml(formatIban(claim.iban))}</td></tr>
<tr><td>Nom de la Banque / Name der Bank + BIC</td><td>${escapeHtml(claim.bank)}</td></tr>
<tr><td>Motif des dépenses / Grund der Ausgaben</td><td>${escapeHtml(claim.reason)}</td></tr>
</table>
<table><thead><tr><th>Date / Datum</th><th>Lieu / Ort</th><th>Détail des dépenses / Beschreibung</th><th class="num">Montant / Betrag</th></tr></thead><tbody>
${lines.map((line) => `<tr><td>${escapeHtml(formatDate(line.date))}</td><td>${escapeHtml(line.place)}</td><td>${escapeHtml(line.detail)}</td><td class="num">${escapeHtml(formatAmount(line.amount))}</td></tr>`).join("")}
</tbody><tfoot>
<tr class="tot"><td colspan="3">Total des dépenses / Gesamtbetrag</td><td class="num">${escapeHtml(formatAmount(totals.total))}</td></tr>
<tr><td colspan="3">Acompte obtenu / erhaltener Vorschuss</td><td class="num">${escapeHtml(formatAmount(totals.advance))}</td></tr>
<tr class="tot"><td colspan="3">Montant à payer / zu zahlender Betrag</td><td class="num">${escapeHtml(formatAmount(totals.toPay))}</td></tr>
</tfoot></table>
<p>Nombre de pièces justificatives jointes / Anzahl der Belege : <strong>${claim.receipts.length}</strong></p>
<p class="receipts">${claim.receipts.map((receipt) => escapeHtml(receipt.fileName)).join(" · ")}</p>
<p class="sign">${claim.certified ? `Certifié exact par <strong>${escapeHtml(claimOwnerName(claim))}</strong> le ${escapeHtml(formatDate(String(claim.certifiedAt).slice(0, 10)))} (MyCLIM).` : "Non certifié."}</p>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const view = window.open("", "_blank", "width=900,height=1000");
  if (!view) return false;
  view.document.open();
  view.document.write(html);
  view.document.close();
  return true;
}

export { buildClaimExcelAttachment, downloadClaimExcel, printClaimPdf };
