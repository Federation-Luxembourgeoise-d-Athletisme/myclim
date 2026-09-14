import { Fragment, useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/auth-context";
import meetingLogoUrl from "../assets/cmcm-logo.png";
import sponsorsStripUrl from "../assets/accreditation-sponsors-strip.png";
import { useBudgetInvoiceConfiguration } from "./config-hooks";
import { useDocumentsCollection } from "./documents-hooks";
import { useActiveEdition } from "./edition";
import { canUserUploadBudgetInvoice } from "./budget-invoice-config";
import {
  buildBudgetExpenseTargetOptions,
  formatInvoiceStatusLabel,
  InvoiceInlineList,
  InvoiceUploadForm,
} from "./invoice-management";
import { extractRolesFromProfile, getDisplayName } from "./utils";
import {
  BUDGET_COLLECTION,
  BUDGET_HISTORY_COLLECTION,
  EXPENSE_SECTION_ORDER,
  REVENUE_SECTION_ORDER,
  applyCanonicalHistoricalBudget,
  buildAllBudgetSeeds,
  buildBudgetDiff,
  buildSimplifiedRows,
  createBudgetRow,
  enrichBudgetWithLinkedActuals,
  getBudgetDocumentLabel,
  getBudgetTotals,
  groupRowsBySection,
  isBudgetLockedEdition,
  mapHistoryEntry,
  mergeFallbackBudgetValues,
  normalizeBudgetDocument,
  normalizeEditionId,
  recalculateBudgetFormulas,
  serializeBudgetDocument,
  sortBudgetDocuments,
  toBudgetNumber,
} from "./budget-tracking-data";

const currencyFormatter = new Intl.NumberFormat("fr-LU", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const historyFieldLabels = {
  rowNumber: "Ordre",
  section: "Section",
  label: "Libellé",
  details: "Détail",
  referenceForecast: "Prévisionnel année de référence",
  referenceActual: "Réalisé année de référence",
  currentForecast: "Prévisionnel année courante",
  currentForecastFormula: "Formule prévisionnel",
  currentActual: "Réalisé année courante",
  currentActualFormula: "Formule réalisé",
  actualReference: "Facture / repère",
  comment: "Commentaire",
  created: "Création",
  deleted: "Suppression",
};

const EXCEL_EXPORT_BRAND = {
  navy: "163C6B",
  navySoft: "EAF2FB",
  red: "D61F2C",
  redSoft: "FBEAEC",
  ink: "172033",
  muted: "607086",
  line: "D7E1EB",
  soft: "F7FAFC",
  white: "FFFFFF",
  good: "176F3F",
  bad: "B42318",
};

const EXCEL_CURRENCY_FORMAT = '[$€-x-euro2] #,##0.00;[Red]-[$€-x-euro2] #,##0.00';

function formatCurrency(value) {
  if (value == null) return "—";
  return currencyFormatter.format(value);
}

function formatDateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "En attente";
  return new Date(value).toLocaleString("fr-LU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateForExport(value = new Date()) {
  return new Date(value).toLocaleString("fr-LU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryValue(value) {
  if (typeof value === "number") return formatCurrency(value);
  if (value == null || value === "") return "vide";
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function computeVariance(forecastValue, actualValue) {
  const normalizedForecast = forecastValue == null ? null : Number(forecastValue);
  const normalizedActual = actualValue == null ? null : Number(actualValue);

  if (normalizedActual == null) return null;

  return Number(((normalizedActual ?? 0) - (normalizedForecast ?? 0)).toFixed(2));
}

function sumBudgetRowsField(rows = [], fieldName, { emptyAsNull = false } = {}) {
  const numericValues = rows.map((row) => toBudgetNumber(row[fieldName])).filter((value) => value != null);

  if (!numericValues.length) return emptyAsNull ? null : 0;
  return Number(numericValues.reduce((sum, value) => sum + value, 0).toFixed(2));
}

function formatVariance(value) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function getBalanceToneClass(value) {
  if (value > 0) return "budget-balance budget-balance--positive";
  if (value < 0) return "budget-balance budget-balance--negative";
  return "budget-balance";
}

function getVarianceToneClass(value, side = "neutral") {
  if (value == null || value === 0) return "budget-variance";

  const positiveIsGood = side === "revenue" || side === "balance";
  if (value > 0) {
    return positiveIsGood ? "budget-variance budget-variance--positive" : "budget-variance budget-variance--negative";
  }

  return positiveIsGood ? "budget-variance budget-variance--negative" : "budget-variance budget-variance--positive";
}

function hasComparisonEdition(referenceEditionId) {
  return Boolean(String(referenceEditionId || "").trim());
}

function buildBudgetFromTemplate(templateBudget, nextEditionId) {
  const normalizedEditionId = normalizeEditionId(nextEditionId);
  const referenceEditionId = normalizeEditionId(
    templateBudget.currentEditionId || templateBudget.editionId,
    templateBudget.editionId,
  );

  function mapRowForNewBudget(row) {
    return {
      ...row,
      isCustom: false,
      referenceForecast: row.currentForecast ?? row.referenceForecast,
      referenceActual: row.currentActual ?? row.currentForecast ?? row.referenceActual,
      currentForecast: row.currentActual ?? row.currentForecast ?? row.referenceForecast,
      currentForecastFormula: "",
      currentForecastFormulaError: "",
      currentActual: null,
      currentActualFormula: "",
      currentActualFormulaError: "",
      actualReference: "",
      comment: "",
    };
  }

  return {
    ...structuredClone(templateBudget),
    editionId: normalizedEditionId,
    currentEditionId: normalizedEditionId,
    referenceEditionId,
    title: `Budget CMCM Luxembourg Indoor Meeting ${normalizedEditionId}`,
    createdAt: null,
    updatedAt: null,
    updatedByName: "",
    updatedByUid: "",
    expenses: templateBudget.expenses.map(mapRowForNewBudget),
    revenues: templateBudget.revenues.map(mapRowForNewBudget),
  };
}

function resequenceBudgetRows(rows = []) {
  return rows.map((row, index) => ({
    ...row,
    rowNumber: index + 1,
  }));
}

function getBudgetExportColumnLabel(fieldName) {
  if (fieldName === "currentForecast") return "Prévisionnel";
  if (fieldName === "currentActual") return "Réalisé";
  return fieldName;
}

function buildBudgetSheetExportRows({
  title,
  sectionLabel,
  sections,
  totals,
  currentEditionId,
  referenceEditionId,
  hasComparison,
}) {
  const rows = [
    [title],
    [`Généré le ${formatDateForExport()}`],
    [],
    ["Section", "Ligne", "Poste", "Détail", ...(hasComparison ? [`Réalisé ${referenceEditionId}`] : []), `Prévisionnel ${currentEditionId}`, `Réalisé ${currentEditionId}`, `Écart ${currentEditionId}`, "Repère / facture", "Commentaire", "Formule prévisionnel", "Formule réalisé"],
  ];

  sections.forEach(({ sectionName, rows: sectionRows }) => {
    rows.push([`${sectionLabel} · ${sectionName}`]);
    sectionRows.forEach((row) => {
      const variance = computeVariance(row.currentForecast, row.currentActual);
      rows.push([
        sectionName,
        row.rowNumber,
        row.label,
        row.details || "",
        ...(hasComparison ? [row.referenceActual ?? ""] : []),
        row.currentForecast ?? "",
        row.currentActual ?? "",
        variance ?? "",
        row.actualReference || "",
        row.comment || "",
        row.currentForecastFormula || "",
        row.currentActualFormula || "",
      ]);
    });
    rows.push([]);
  });

  rows.push([
    `Total ${title.toLowerCase()}`,
    "",
    "",
    "",
    ...(hasComparison ? [totals.referenceActual ?? ""] : []),
    totals.currentForecast ?? "",
    totals.currentActual ?? "",
    computeVariance(totals.currentForecast, totals.currentActual) ?? "",
    "",
    "",
    "",
    "",
  ]);

  return rows;
}

function buildBudgetOverviewExportRows({ budget, totals, hasComparison }) {
  return [
    [`Budget ${budget.currentEditionId} · Vue d'ensemble`],
    [`Généré le ${formatDateForExport()}`],
    [],
    ["Bloc", ...(hasComparison ? [`Réalisé ${budget.referenceEditionId}`] : []), `Prévisionnel ${budget.currentEditionId}`, `Réalisé ${budget.currentEditionId}`, `Écart ${budget.currentEditionId}`],
    ["Dépenses", ...(hasComparison ? [totals.expenses.referenceActual] : []), totals.expenses.currentForecast, totals.expenses.currentActual, computeVariance(totals.expenses.currentForecast, totals.expenses.currentActual)],
    ["Recettes", ...(hasComparison ? [totals.revenues.referenceActual] : []), totals.revenues.currentForecast, totals.revenues.currentActual, computeVariance(totals.revenues.currentForecast, totals.revenues.currentActual)],
    ["Équilibre", ...(hasComparison ? [totals.balance.referenceActual] : []), totals.balance.currentForecast, totals.balance.currentActual, computeVariance(totals.balance.currentForecast, totals.balance.currentActual)],
  ];
}

function triggerExcelDownload(buffer, filename) {
  const blob = new Blob(
    [buffer],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadWorkbookImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load workbook image: ${url}`);
  }
  return response.arrayBuffer();
}

function applyCellBorder(cell, overrides = {}) {
  cell.border = {
    top: { style: "thin", color: { argb: overrides.top || EXCEL_EXPORT_BRAND.line } },
    left: { style: "thin", color: { argb: overrides.left || EXCEL_EXPORT_BRAND.line } },
    bottom: { style: "thin", color: { argb: overrides.bottom || EXCEL_EXPORT_BRAND.line } },
    right: { style: "thin", color: { argb: overrides.right || EXCEL_EXPORT_BRAND.line } },
  };
}

function styleHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: EXCEL_EXPORT_BRAND.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_EXPORT_BRAND.navy } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCellBorder(cell, {
      top: EXCEL_EXPORT_BRAND.navy,
      right: EXCEL_EXPORT_BRAND.navy,
      bottom: EXCEL_EXPORT_BRAND.navy,
      left: EXCEL_EXPORT_BRAND.navy,
    });
  });
}

function styleSectionRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: EXCEL_EXPORT_BRAND.red } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_EXPORT_BRAND.redSoft } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    applyCellBorder(cell);
  });
}

function styleTotalRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: EXCEL_EXPORT_BRAND.ink } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_EXPORT_BRAND.navySoft } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    applyCellBorder(cell, { top: EXCEL_EXPORT_BRAND.navy, bottom: EXCEL_EXPORT_BRAND.navy });
  });
}

function styleDataRow(row, { zebra = false } = {}) {
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, color: { argb: EXCEL_EXPORT_BRAND.ink } };
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    if (zebra) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_EXPORT_BRAND.soft } };
    }
    applyCellBorder(cell);
  });
}

function styleCurrencyCell(cell) {
  cell.numFmt = EXCEL_CURRENCY_FORMAT;
  cell.alignment = { vertical: "middle", horizontal: "right" };
}

function styleVarianceCell(cell, value, { positiveIsGood = false } = {}) {
  styleCurrencyCell(cell);
  if (typeof value !== "number" || Number.isNaN(value) || value === 0) return;
  cell.font = {
    name: "Aptos",
    size: 10,
    bold: true,
    color: { argb: value > 0 ? (positiveIsGood ? EXCEL_EXPORT_BRAND.good : EXCEL_EXPORT_BRAND.bad) : (positiveIsGood ? EXCEL_EXPORT_BRAND.bad : EXCEL_EXPORT_BRAND.good) },
  };
}

function addWorksheetBrandHeader({
  worksheet,
  title,
  subtitle,
  editionLabel,
  imageId,
  stripImageId,
  totalColumns,
}) {
  const lastCol = Math.max(totalColumns, 8);
  worksheet.getRow(1).height = 26;
  worksheet.getRow(2).height = 28;
  worksheet.getRow(3).height = 20;
  worksheet.getRow(4).height = 18;
  worksheet.getRow(5).height = 16;
  worksheet.getRow(6).height = 8;

  worksheet.mergeCells(1, 3, 2, Math.max(5, lastCol - 2));
  worksheet.mergeCells(3, 3, 3, Math.max(5, lastCol - 2));
  worksheet.mergeCells(4, 3, 4, Math.max(5, lastCol - 2));
  worksheet.mergeCells(5, 3, 5, Math.max(5, lastCol - 2));

  worksheet.getCell(1, 3).value = title;
  worksheet.getCell(1, 3).font = { name: "Aptos Display", size: 18, bold: true, color: { argb: EXCEL_EXPORT_BRAND.navy } };
  worksheet.getCell(1, 3).alignment = { vertical: "middle", horizontal: "left" };

  worksheet.getCell(3, 3).value = subtitle;
  worksheet.getCell(3, 3).font = { name: "Aptos", size: 11, color: { argb: EXCEL_EXPORT_BRAND.muted } };
  worksheet.getCell(3, 3).alignment = { vertical: "middle", horizontal: "left" };

  worksheet.getCell(4, 3).value = "Fédération Luxembourgeoise d'Athlétisme";
  worksheet.getCell(4, 3).font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_EXPORT_BRAND.ink } };
  worksheet.getCell(4, 3).alignment = { vertical: "middle", horizontal: "left" };

  worksheet.getCell(5, 3).value = editionLabel;
  worksheet.getCell(5, 3).font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_EXPORT_BRAND.red } };
  worksheet.getCell(5, 3).alignment = { vertical: "middle", horizontal: "left" };

  for (let col = 1; col <= lastCol; col += 1) {
    const cell = worksheet.getCell(6, col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_EXPORT_BRAND.navy } };
  }

  if (imageId) {
    worksheet.addImage(imageId, {
      tl: { col: 0.18, row: 0.2 },
      ext: { width: 146, height: 58 },
    });
  }

  if (stripImageId) {
    worksheet.addImage(stripImageId, {
      tl: { col: Math.max(lastCol - 2.7, 5.2), row: 0.18 },
      ext: { width: 208, height: 48 },
    });
  }
}

function addOverviewWorksheet({
  workbook,
  budget,
  totals,
  hasComparison,
  imageId,
  stripImageId,
}) {
  const worksheet = workbook.addWorksheet("Vue d'ensemble", {
    properties: { defaultRowHeight: 20 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    views: [{ state: "frozen", ySplit: 8 }],
  });

  worksheet.columns = [
    { width: 24 },
    ...(hasComparison ? [{ width: 18 }] : []),
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ];

  addWorksheetBrandHeader({
    worksheet,
    title: `Budget ${budget.currentEditionId}`,
    subtitle: "Vue d'ensemble budgétaire du meeting",
    editionLabel: `Généré le ${formatDateForExport()}`,
    imageId,
    stripImageId,
    totalColumns: worksheet.columnCount,
  });

  const tableRows = buildBudgetOverviewExportRows({ budget, totals, hasComparison }).slice(3);
  const headerRowNumber = 8;
  styleHeaderRow(worksheet.addRow(tableRows[0]));

  tableRows.slice(1).forEach((rowValues, index) => {
    const row = worksheet.addRow(rowValues);
    styleDataRow(row, { zebra: index % 2 === 1 });
    row.getCell(1).font = { name: "Aptos", size: 11, bold: true, color: { argb: EXCEL_EXPORT_BRAND.ink } };

    const positiveIsGood = rowValues[0] === "Recettes" || rowValues[0] === "Équilibre";
    row.eachCell((cell, colNumber) => {
      if (colNumber === 1 || typeof cell.value !== "number") return;
      if (colNumber === row.cellCount) {
        styleVarianceCell(cell, cell.value, { positiveIsGood });
        return;
      }
      styleCurrencyCell(cell);
    });

    if (rowValues[0] === "Équilibre") {
      styleTotalRow(row);
    }
  });

  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: tableRows[0].length },
  };
}

function addBudgetDetailWorksheet({
  workbook,
  title,
  sectionLabel,
  sections,
  totals,
  currentEditionId,
  referenceEditionId,
  hasComparison,
  imageId,
  stripImageId,
}) {
  const worksheet = workbook.addWorksheet(title, {
    properties: { defaultRowHeight: 19 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 8 }],
  });

  worksheet.columns = [
    { width: 18 },
    { width: 8 },
    { width: 28 },
    { width: 22 },
    ...(hasComparison ? [{ width: 16 }] : []),
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 26 },
    { width: 20 },
    { width: 20 },
  ];

  addWorksheetBrandHeader({
    worksheet,
    title,
    subtitle: `Suivi détaillé · ${sectionLabel}`,
    editionLabel: hasComparison
      ? `Référence ${referenceEditionId} · Édition courante ${currentEditionId}`
      : `Édition courante ${currentEditionId}`,
    imageId,
    stripImageId,
    totalColumns: worksheet.columnCount,
  });

  const rows = buildBudgetSheetExportRows({
    title,
    sectionLabel,
    sections,
    totals,
    currentEditionId,
    referenceEditionId,
    hasComparison,
  });

  const headerValues = rows[3];
  styleHeaderRow(worksheet.addRow(headerValues));

  const moneyColumns = hasComparison ? [5, 6, 7, 8] : [5, 6, 7];
  let zebraIndex = 0;
  rows.slice(4).forEach((rowValues) => {
    const isBlank = rowValues.every((value) => value === "" || value == null);
    if (isBlank) {
      worksheet.addRow([]);
      return;
    }

    const filledValues = rowValues.filter((value) => value !== "" && value != null);
    const isSection = filledValues.length === 1 && typeof rowValues[0] === "string" && rowValues[0].startsWith(`${sectionLabel} · `);
    const isTotal = typeof rowValues[0] === "string" && rowValues[0].startsWith("Total ");

    const row = worksheet.addRow(rowValues);

    if (isSection) {
      worksheet.mergeCells(row.number, 1, row.number, worksheet.columnCount);
      styleSectionRow(row);
      return;
    }

    if (isTotal) {
      styleTotalRow(row);
    } else {
      styleDataRow(row, { zebra: zebraIndex % 2 === 1 });
      zebraIndex += 1;
    }

    row.eachCell((cell, colNumber) => {
      if (!moneyColumns.includes(colNumber) || typeof cell.value !== "number") return;
      if (colNumber === moneyColumns[moneyColumns.length - 1]) {
        styleVarianceCell(cell, cell.value, { positiveIsGood: title === "Recettes" });
      } else {
        styleCurrencyCell(cell);
      }
    });

    if (!isSection && !isTotal) {
      row.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
      row.getCell(3).font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_EXPORT_BRAND.ink } };
    }
  });

  worksheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: worksheet.columnCount },
  };
}

function addBudgetHistoryWorksheet({
  workbook,
  historyEntries,
  currentEditionId,
  imageId,
  stripImageId,
}) {
  if (!historyEntries.length) return;

  const worksheet = workbook.addWorksheet("Historique", {
    properties: { defaultRowHeight: 19 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 8 }],
  });

  worksheet.columns = [
    { width: 20 },
    { width: 22 },
    { width: 58 },
    { width: 16 },
  ];

  addWorksheetBrandHeader({
    worksheet,
    title: "Historique du budget",
    subtitle: "Journal des modifications de l'édition",
    editionLabel: `Édition ${currentEditionId} · Généré le ${formatDateForExport()}`,
    imageId,
    stripImageId,
    totalColumns: worksheet.columnCount,
  });

  styleHeaderRow(worksheet.addRow(["Date", "Auteur", "Résumé", "Nb changements"]));
  historyEntries.forEach((entry, index) => {
    const row = worksheet.addRow([
      formatDateTime(entry.createdAt),
      entry.actorName || "Admin",
      entry.summary || "",
      entry.changeCount || 0,
    ]);
    styleDataRow(row, { zebra: index % 2 === 1 });
    row.getCell(4).alignment = { vertical: "middle", horizontal: "center" };
  });

  worksheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: worksheet.columnCount },
  };
}

function buildBudgetPrintSectionMarkup({
  title,
  side,
  sections,
  currentEditionId,
}) {
  return `
    <section class="budget-print-section">
      <header class="budget-print-section__header">
        <div>
          <p>${escapeHtml(side)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </header>
      ${sections.map(({ sectionName, rows }) => {
        const sectionCurrentForecast = sumBudgetRowsField(rows, "currentForecast");

        return `
          <article class="budget-print-group">
            <div class="budget-print-group__top">
              <div>
                <h3>${escapeHtml(sectionName)}</h3>
                <p>${rows.length} ligne(s)</p>
              </div>
              <div class="budget-print-group__metric">
                <small>Prévisionnel ${escapeHtml(currentEditionId)}</small>
                <strong>${escapeHtml(formatCurrency(sectionCurrentForecast))}</strong>
              </div>
            </div>
            <table class="budget-print-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Poste</th>
                  <th>Détail</th>
                  <th>Prév. ${escapeHtml(currentEditionId)}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.rowNumber)}</td>
                    <td>
                      <strong>${escapeHtml(row.label)}</strong>
                      ${row.isCustom ? `<small class="budget-print-pill">Ajoutée</small>` : ""}
                    </td>
                    <td>${escapeHtml(row.details || "—")}</td>
                    <td>${escapeHtml(formatCurrency(row.currentForecast))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function buildBudgetPrintDocument({
  budget,
  totals,
  expenseSections,
  revenueSections,
}) {
  const generatedAt = formatDateForExport();

  return `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>Budget ${escapeHtml(budget.currentEditionId)}</title>
      <style>
        :root {
          color-scheme: light;
          --ink: #172033;
          --muted: #607086;
          --line: #d7e1eb;
          --paper: #ffffff;
          --soft: #f4f7fb;
          --brand: #163c6b;
          --brand-soft: #edf4fb;
          --good: #176f3f;
          --warn: #b54708;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Avenir Next", "Segoe UI", Arial, sans-serif;
          color: var(--ink);
          background: #eef3f8;
        }
        .budget-print {
          max-width: 1200px;
          margin: 0 auto;
          padding: 18mm 14mm 22mm;
        }
        .budget-print-cover {
          margin-bottom: 16mm;
          padding: 0 0 10mm;
          border-radius: 0;
          background:
            linear-gradient(135deg, #143a66 0%, #204d86 55%, #2f6ba6 100%);
          color: #fff;
          box-shadow: none;
        }
        .budget-print-cover__eyebrow {
          margin: 0 0 10px;
          font-size: 11pt;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          opacity: 0.82;
        }
        .budget-print-cover h1 {
          margin: 0;
          font-size: 28pt;
          line-height: 1.05;
        }
        .budget-print-cover p {
          margin: 8px 0 0;
          font-size: 12pt;
          opacity: 0.92;
        }
        .budget-print-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 10mm;
          padding-top: 8mm;
          border-top: 1px solid rgba(255, 255, 255, 0.28);
        }
        .budget-print-summary span {
          display: block;
          font-size: 10pt;
          opacity: 0.84;
        }
        .budget-print-summary strong {
          display: block;
          margin-top: 6px;
          font-size: 18pt;
        }
        .budget-print-section {
          margin-top: 0;
        }
        .budget-print-dual-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9mm;
          align-items: start;
          margin-top: 10mm;
        }
        .budget-print-section__header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          margin-bottom: 6mm;
        }
        .budget-print-section__header p {
          margin: 0 0 4px;
          color: var(--muted);
          font-size: 9pt;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .budget-print-section__header h2 {
          margin: 0;
          font-size: 19pt;
          color: var(--brand);
        }
        .budget-print-group {
          margin-bottom: 8mm;
          padding-bottom: 5mm;
          border-bottom: 1px solid var(--line);
          break-inside: avoid;
        }
        .budget-print-group__top {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 10px;
          align-items: end;
        }
        .budget-print-group__top h3 {
          margin: 0;
          font-size: 14pt;
        }
        .budget-print-group__top p {
          margin: 4px 0 0;
          color: var(--muted);
          font-size: 9pt;
        }
        .budget-print-group__metric {
          display: grid;
          gap: 3px;
          min-width: 180px;
          text-align: right;
        }
        .budget-print-group__metric small {
          color: var(--muted);
          font-size: 8pt;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .budget-print-group__metric strong {
          font-size: 13pt;
          color: var(--brand);
        }
        .budget-print-table {
          width: 100%;
          border-collapse: collapse;
        }
        .budget-print-table th,
        .budget-print-table td {
          padding: 7px 8px;
          border: 1px solid #e5edf4;
          vertical-align: top;
          text-align: left;
          font-size: 8.6pt;
          line-height: 1.36;
        }
        .budget-print-table th {
          background: #f1f5f9;
          color: var(--brand);
          font-size: 7.9pt;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .budget-print-pill {
          display: inline-block;
          margin-top: 4px;
          padding: 2px 7px;
          border-radius: 999px;
          background: #ecfeff;
          color: #0f766e;
          font-size: 7.2pt;
          font-weight: 700;
        }
        .budget-print-note {
          margin-top: 12mm;
          color: var(--muted);
          font-size: 8.5pt;
          text-align: center;
        }
        @media (max-width: 1100px) {
          .budget-print-dual-grid {
            grid-template-columns: 1fr;
          }
          .budget-print-group__top {
            flex-direction: column;
            align-items: start;
          }
          .budget-print-group__metric {
            text-align: left;
          }
          .budget-print-section {
            margin-top: 8mm;
          }
        }
        @page {
          size: A4 landscape;
          margin: 10mm;
        }
        @media print {
          body { background: #fff; }
          .budget-print { padding: 0; }
          .budget-print-note { display: none; }
        }
      </style>
    </head>
    <body>
      <main class="budget-print">
        <section class="budget-print-cover">
          <p class="budget-print-cover__eyebrow">MyCLIM · Export budget</p>
          <h1>Budget ${escapeHtml(budget.currentEditionId)}</h1>
          <p>${escapeHtml(budget.meetingLevel || "Meeting")} · Généré le ${escapeHtml(generatedAt)}</p>
          <div class="budget-print-summary">
            <article>
              <span>Dépenses</span>
              <strong>${escapeHtml(formatCurrency(totals.expenses.currentForecast))}</strong>
            </article>
            <article>
              <span>Recettes</span>
              <strong>${escapeHtml(formatCurrency(totals.revenues.currentForecast))}</strong>
            </article>
            <article>
              <span>Équilibre</span>
              <strong>${escapeHtml(formatCurrency(totals.balance.currentForecast))}</strong>
            </article>
          </div>
        </section>
        <section class="budget-print-dual-grid">
          ${buildBudgetPrintSectionMarkup({
            title: "Dépenses détaillées",
            side: "Dépenses",
            sections: expenseSections,
            currentEditionId: budget.currentEditionId,
          })}
          ${buildBudgetPrintSectionMarkup({
            title: "Recettes détaillées",
            side: "Recettes",
            sections: revenueSections,
            currentEditionId: budget.currentEditionId,
          })}
        </section>
        <p class="budget-print-note">Utilisez la boîte de dialogue d'impression pour enregistrer le document en PDF.</p>
      </main>
      <script>
        window.addEventListener("load", () => {
          const triggerPrint = () => {
            window.focus();
            window.print();
          };

          if ("requestAnimationFrame" in window) {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                window.setTimeout(triggerPrint, 180);
              });
            });
          } else {
            window.setTimeout(triggerPrint, 180);
          }
        });
      </script>
    </body>
  </html>`;
}

function BudgetAmountField({ row, fieldName, onValueChange, collectionKey, isEditable }) {
  const formulaFieldName = `${fieldName}Formula`;
  const formulaErrorFieldName = `${fieldName}FormulaError`;
  const formulaValue = String(row[formulaFieldName] || "").trim();
  const formulaError = String(row[formulaErrorFieldName] || "").trim();
  const isFormula = Boolean(formulaValue);
  const inputValue = isFormula ? formulaValue : (row[fieldName] ?? "");
  const columnCode = fieldName === "currentForecast" ? "P" : "R";
  const placeholder = fieldName === "currentForecast" ? "=SOMME(P1:P3)" : "=SOMME(R1:R3)";

  if (!isEditable) {
    return <span className="budget-cell-value">{formatCurrency(row[fieldName])}</span>;
  }

  return (
    <div className={`budget-amount-editor ${isFormula ? "budget-amount-editor--formula" : ""} ${formulaError ? "budget-amount-editor--error" : ""}`}>
      <input
        className={`budget-cell-input ${isFormula ? "budget-cell-input--formula" : ""} ${formulaError ? "budget-cell-input--error" : ""}`}
        inputMode="decimal"
        type="text"
        value={inputValue}
        onChange={(event) => onValueChange(collectionKey, row.id, fieldName, event.target.value)}
        placeholder={placeholder}
      />
      {isFormula ? (
        <small className={`budget-amount-editor__meta ${formulaError ? "budget-amount-editor__meta--error" : ""}`}>
          {formulaError || `${columnCode}${row.rowNumber} = ${formatCurrency(row[fieldName])}`}
        </small>
      ) : null}
    </div>
  );
}

function BudgetLineTable({
  side,
  collectionKey,
  sections,
  referenceEditionId,
  currentEditionId,
  hasComparison,
  isEditable,
  newSectionName,
  onValueChange,
  onAddRow,
  onDeleteRow,
  onNewSectionNameChange,
  onAddSection,
  dragState,
  dragOverRowId,
  onRowDragStart,
  onRowDragOver,
  onRowDrop,
  onRowDragEnd,
  totals,
  invoicesByRowId,
  canManageInvoices,
  onUnlinkInvoice,
}) {
  function renderTextCell(row, fieldName, placeholder) {
    if (!isEditable) {
      return <span className="budget-cell-text">{row[fieldName] || "—"}</span>;
    }

    return (
      <input
        className="budget-text-input"
        type="text"
        value={row[fieldName]}
        onChange={(event) => onValueChange(collectionKey, row.id, fieldName, event.target.value)}
        placeholder={placeholder}
      />
    );
  }

  function renderReferenceCell(row) {
    const linkedInvoices = invoicesByRowId[row.id] || [];

    if (!isEditable) {
      return (
        <div className="budget-reference-cell">
          <span className="budget-cell-text">{row.actualReference || "—"}</span>
          <InvoiceInlineList invoices={linkedInvoices} />
        </div>
      );
    }

    return (
      <div className="budget-reference-cell">
        <input
          className="budget-text-input"
          type="text"
          value={row.actualReference}
          onChange={(event) => onValueChange(collectionKey, row.id, "actualReference", event.target.value)}
          placeholder="Facture / note"
        />
        <InvoiceInlineList invoices={linkedInvoices} canManage={canManageInvoices} onDetach={onUnlinkInvoice} />
      </div>
    );
  }

  return (
    <div className="budget-table-stack">
      {isEditable ? (
        <Fragment>
          <div className="budget-table-toolbar">
            <div className="budget-table-toolbar__legend">
              {hasComparison ? <span className="budget-legend budget-legend--reference">Réalisé {referenceEditionId}</span> : null}
              <span className="budget-legend budget-legend--forecast">Prévisionnel {currentEditionId}</span>
              <span className="budget-legend budget-legend--actual">Réalisé {currentEditionId}</span>
            </div>
            <div className="budget-table-toolbar__actions">
              <input
                className="budget-text-input budget-table-toolbar__input"
                type="text"
                value={newSectionName}
                onChange={(event) => onNewSectionNameChange(collectionKey, event.target.value)}
                placeholder="Nouvelle section"
              />
              <button
                className="button button--secondary budget-add-row-button"
                type="button"
                onClick={() => onAddSection(collectionKey)}
              >
                Ajouter une section
              </button>
            </div>
          </div>
          <p className="budget-formula-note">
            Formules disponibles dans les montants: <code>=SOMME(P1:P3)</code> pour le prévisionnel et <code>=SOMME(R4:R8)</code> pour le réalisé.
          </p>
        </Fragment>
      ) : null}
      {sections.map(({ sectionName, rows }) => {
        const sectionReferenceActual = sumBudgetRowsField(rows, "referenceActual");
        const sectionCurrentForecast = sumBudgetRowsField(rows, "currentForecast");
        const sectionCurrentActual = sumBudgetRowsField(rows, "currentActual", { emptyAsNull: true });
        const sectionVariance = computeVariance(sectionCurrentForecast, sectionCurrentActual);

        return (
        <section className="budget-section-card" key={sectionName}>
          <div className="budget-section-card__header">
            <div className="budget-section-card__heading">
              <h3>{sectionName}</h3>
              <p>{rows.length} poste(s) dans cette section.</p>
            </div>
            {isEditable ? (
              <button
                className="button button--secondary budget-add-row-button"
                type="button"
                onClick={() => onAddRow(collectionKey, sectionName)}
              >
                Ajouter une ligne
              </button>
            ) : null}
          </div>
          <div className="table-wrap table-wrap--compact">
            <div className="budget-section-summary">
              <div className="budget-section-summary__eyebrow">Synthèse de section</div>
              <div className="budget-section-summary__metrics">
                {hasComparison ? (
                  <span className="budget-metric-chip budget-metric-chip--reference">
                    <small>Réalisé {referenceEditionId}</small>
                    <strong>{formatCurrency(sectionReferenceActual)}</strong>
                  </span>
                ) : null}
                <span className="budget-metric-chip budget-metric-chip--forecast">
                  <small>Prévu {currentEditionId}</small>
                  <strong>{formatCurrency(sectionCurrentForecast)}</strong>
                </span>
                <span className="budget-metric-chip budget-metric-chip--actual">
                  <small>Réalisé {currentEditionId}</small>
                  <strong>{formatCurrency(sectionCurrentActual)}</strong>
                </span>
                <span className={`${getVarianceToneClass(sectionVariance, side)} budget-metric-chip budget-metric-chip--variance`}>
                  <small>Écart {currentEditionId}</small>
                  <strong>{formatVariance(sectionVariance)}</strong>
                </span>
              </div>
            </div>
            <table className="data-table data-table--admin data-table--compact budget-table budget-table--sheet">
              <colgroup>
                <col className="budget-col budget-col--label" />
                <col className="budget-col budget-col--details" />
                {hasComparison ? <col className="budget-col budget-col--comparison" /> : null}
                <col className="budget-col budget-col--amount" />
                <col className="budget-col budget-col--amount" />
                <col className="budget-col budget-col--variance" />
                <col className="budget-col budget-col--reference" />
                <col className="budget-col budget-col--comment" />
                {isEditable ? <col className="budget-col budget-col--actions" /> : null}
              </colgroup>
              <thead>
                <tr>
                  <th>Poste</th>
                  <th>Détail</th>
                  {hasComparison ? <th className="budget-table__col budget-table__col--reference">Réalisé {referenceEditionId}</th> : null}
                  <th className="budget-table__col budget-table__col--forecast">Prév. {currentEditionId}</th>
                  <th className="budget-table__col budget-table__col--actual">Réalisé {currentEditionId}</th>
                  <th>Écart {currentEditionId}</th>
                  <th>Facture / repère</th>
                  <th>Commentaire</th>
                  {isEditable ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    className={[
                      "budget-table__row",
                      row.isCustom ? "budget-table__row--custom" : "",
                      dragOverRowId === row.id ? "budget-table__row--drag-over" : "",
                    ].filter(Boolean).join(" ")}
                    key={row.id}
                    onDragOver={isEditable ? (event) => onRowDragOver(event, collectionKey, row.id) : undefined}
                    onDrop={isEditable ? (event) => onRowDrop(event, collectionKey, sectionName, row.id) : undefined}
                  >
                    <td className="budget-table__label">
                      {isEditable ? (
                        <div className="budget-table__label-editable">
                          <button
                            className={`budget-drag-handle ${dragState?.rowId === row.id ? "budget-drag-handle--active" : ""}`}
                            type="button"
                            draggable
                            onDragStart={(event) => onRowDragStart(event, collectionKey, sectionName, row.id)}
                            onDragEnd={onRowDragEnd}
                            aria-label={`Déplacer ${row.label}`}
                            title="Glisser pour déplacer la ligne"
                          >
                            <span className="budget-drag-handle__icon" aria-hidden="true" />
                          </button>
                          <div className="budget-table__label-content">
                            <div className="budget-table__label-inline">
                              <span className="budget-row-ref">#{row.rowNumber}</span>
                              <input
                                className="budget-text-input"
                                type="text"
                                value={row.label}
                                onChange={(event) => onValueChange(collectionKey, row.id, "label", event.target.value)}
                                placeholder="Libellé"
                              />
                              {row.isCustom ? <span className="budget-custom-badge">Ajoutée</span> : null}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="budget-cell-text">{row.label}</span>
                      )}
                    </td>
                    <td className="budget-table__details">
                      {isEditable
                        ? renderTextCell(row, "details", "Détail")
                        : <span className="budget-cell-text">{row.details || "—"}</span>}
                    </td>
                    {hasComparison ? (
                      <td className="budget-table__cell budget-table__cell--reference"><span className="budget-cell-value">{formatCurrency(row.referenceActual)}</span></td>
                    ) : null}
                    <td className="budget-table__cell budget-table__cell--forecast">
                      <BudgetAmountField
                        row={row}
                        fieldName="currentForecast"
                        onValueChange={onValueChange}
                        collectionKey={collectionKey}
                        isEditable={isEditable}
                      />
                    </td>
                    <td className="budget-table__cell budget-table__cell--actual">
                      <BudgetAmountField
                        row={row}
                        fieldName="currentActual"
                        onValueChange={onValueChange}
                        collectionKey={collectionKey}
                        isEditable={isEditable}
                      />
                    </td>
                    <td className="budget-table__variance">
                      <span className={getVarianceToneClass(computeVariance(row.currentForecast, row.currentActual), side)}>
                        {formatVariance(computeVariance(row.currentForecast, row.currentActual))}
                      </span>
                    </td>
                    <td>{renderReferenceCell(row)}</td>
                    <td>{renderTextCell(row, "comment", "Commentaire")}</td>
                    {isEditable ? (
                      <td className="budget-table__actions">
                        <button
                          className="budget-delete-button"
                          type="button"
                          onClick={() => onDeleteRow(collectionKey, row.id)}
                          aria-label={`Supprimer ${row.label}`}
                          title="Supprimer la ligne"
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
      })}
      <PanelTotals
        totals={totals}
        title={collectionKey === "expenses" ? "Total dépenses" : "Total recettes"}
        side={side}
        hasComparison={hasComparison}
      />
    </div>
  );
}

function BudgetOverviewTable({
  collectionKey,
  sections,
  currentEditionId,
  allowEditing,
  actualColumnLabel,
  onValueChange,
  totals,
  invoicesByRowId,
}) {
  const amountColumns = [
    { key: "currentForecast", label: `Prév. ${currentEditionId}`, cellClassName: "budget-table__cell--forecast" },
    { key: "currentActual", label: actualColumnLabel, cellClassName: "budget-table__cell--actual" },
  ];

  function renderTextField(row, fieldName, placeholder) {
    if (!allowEditing) {
      return <span className="budget-cell-text">{row[fieldName] || "—"}</span>;
    }

    return (
      <input
        className="budget-text-input"
        type="text"
        value={row[fieldName]}
        onChange={(event) => onValueChange(collectionKey, row.id, fieldName, event.target.value)}
        placeholder={placeholder}
      />
    );
  }

  function renderInvoiceCell(row) {
    return <InvoiceInlineList invoices={invoicesByRowId[row.id] || []} />;
  }

  return (
    <div className="table-wrap table-wrap--compact">
      <table className="data-table data-table--admin data-table--compact budget-table budget-table--sheet budget-overview-table">
        <colgroup>
          <col className="budget-col budget-col--label" />
          <col className="budget-col budget-col--details" />
          {amountColumns.map((column) => (
            <col className="budget-col budget-col--amount" key={column.key} />
          ))}
          <col className="budget-col budget-col--reference" />
        </colgroup>
        <thead>
          <tr>
            <th>Poste</th>
            <th>Détail</th>
            {amountColumns.map((column) => (
              <th key={column.key} className={`budget-table__col ${column.cellClassName.replace("__cell", "__col")}`}>
                {column.label}
              </th>
            ))}
            <th>Factures</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(({ sectionName, rows }) => {
            const sectionCurrentForecast = sumBudgetRowsField(rows, "currentForecast");
            const sectionCurrentActual = sumBudgetRowsField(rows, "currentActual", { emptyAsNull: true });
            const sectionInvoiceCount = rows.reduce((sum, row) => sum + (invoicesByRowId[row.id]?.length || 0), 0);

            return (
              <Fragment key={sectionName}>
                <tr className="budget-overview-table__section-row">
                  <th className="budget-overview-table__section-title" colSpan={2} scope="rowgroup">
                    <div className="budget-overview-table__section-heading">
                      <strong>{sectionName}</strong>
                      <span>{rows.length} ligne(s)</span>
                    </div>
                  </th>
                  <th className="budget-overview-table__section-total budget-table__cell--forecast">
                    {formatCurrency(sectionCurrentForecast)}
                  </th>
                  <th className="budget-overview-table__section-total budget-table__cell--actual">
                    {formatCurrency(sectionCurrentActual)}
                  </th>
                  <th className="budget-overview-table__section-total">
                    {sectionInvoiceCount ? `${sectionInvoiceCount} facture(s)` : "—"}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr className={row.isCustom ? "budget-table__row budget-table__row--custom" : "budget-table__row"} key={row.id}>
                    <td className="budget-table__label">
                      {allowEditing ? (
                        <div className="budget-table__label-content">
                          <div className="budget-table__label-inline">
                            <span className="budget-row-ref">#{row.rowNumber}</span>
                            <input
                              className="budget-text-input"
                              type="text"
                              value={row.label}
                              onChange={(event) => onValueChange(collectionKey, row.id, "label", event.target.value)}
                              placeholder="Libellé"
                            />
                            {row.isCustom ? <span className="budget-custom-badge">Ajoutée</span> : null}
                          </div>
                        </div>
                      ) : (
                        <span className="budget-cell-text">{row.label}</span>
                      )}
                    </td>
                    <td className="budget-table__details">{renderTextField(row, "details", "Détail")}</td>
                    {amountColumns.map((column) => (
                      <td className={`budget-table__cell ${column.cellClassName}`} key={`${row.id}-${column.key}`}>
                        <BudgetAmountField
                          row={row}
                          fieldName={column.key}
                          onValueChange={onValueChange}
                          collectionKey={collectionKey}
                          isEditable={allowEditing}
                        />
                      </td>
                    ))}
                    <td>{renderInvoiceCell(row)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="budget-overview-table__footer">
            <th colSpan={2}>Total</th>
            <th className="budget-table__cell--forecast">{formatCurrency(totals.currentForecast)}</th>
            <th className="budget-table__cell--actual">{formatCurrency(totals.currentActual)}</th>
            <th>{Object.values(invoicesByRowId).flat().length || "—"}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PanelTotals({ title, totals, side, hasComparison }) {
  if (!totals) return null;

  return (
    <div className="budget-inline-summary">
      <strong>{title}</strong>
      {hasComparison ? <span>{formatCurrency(totals.referenceActual)} réalisé réf.</span> : null}
      <span>{formatCurrency(totals.currentForecast)} prév. courante</span>
      <span>{formatCurrency(totals.currentActual)} réalisé courant</span>
      <span className={getVarianceToneClass(computeVariance(totals.currentForecast, totals.currentActual), side)}>
        {formatVariance(computeVariance(totals.currentForecast, totals.currentActual))} courant
      </span>
    </div>
  );
}

function BudgetSeedLog({ lines = [] }) {
  if (!lines.length) return null;

  return (
    <div className="budget-seed-log" aria-live="polite">
      {lines.map((line, index) => (
        <div key={`${line}-${index}`}>{line}</div>
      ))}
    </div>
  );
}

function SimplifiedBudgetTable({
  Panel,
  title,
  subtitle,
  side,
  rows,
  selectedMap,
  detailSelections,
  displayMode,
  showDetails,
  onToggleRow,
  onToggleDetailRow,
  referenceEditionId,
  currentEditionId,
  hasComparison,
}) {
  const visibleRows = rows.filter((row) => selectedMap[row.id] ?? true);
  const showForecast = displayMode === "forecast" || displayMode === "both";
  const showActual = displayMode === "actual" || displayMode === "both";

  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="budget-simplified-picker">
        <div className="budget-simplified-picker__header">
          <strong>Blocs affichés</strong>
          <span>{visibleRows.length} sur {rows.length}</span>
        </div>
        <div className="budget-simplified-picker__grid">
          {rows.map((row) => (
            <label className="budget-simplified-check" key={row.id}>
              <input
                type="checkbox"
                checked={selectedMap[row.id] ?? true}
                onChange={() => onToggleRow(row.id)}
              />
              <span>{row.label}</span>
            </label>
          ))}
        </div>
      </div>

      {showDetails ? (
        <div className="budget-simplified-detail-picker">
          <div className="budget-simplified-picker__header">
            <strong>Détail affiché</strong>
            <span>Le total du bloc reste inchangé.</span>
          </div>
          <div className="budget-simplified-detail-picker__stack">
            {visibleRows.map((row) => (
              <div className="budget-simplified-detail-group" key={`${row.id}-details`}>
                <strong>{row.label}</strong>
                <div className="budget-simplified-detail-picker__grid">
                  {row.items.map((item) => (
                    <label className="budget-simplified-check budget-simplified-check--detail" key={item.id}>
                      <input
                        type="checkbox"
                        checked={detailSelections[row.id]?.[item.id] ?? true}
                        onChange={() => onToggleDetailRow(row.id, item.id)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="table-wrap table-wrap--compact">
        <table className="data-table data-table--admin data-table--compact budget-table budget-table--sheet budget-table--summary">
          <thead>
            <tr>
              <th>Bloc</th>
              {hasComparison ? <th>Réalisé {referenceEditionId}</th> : null}
              {showForecast ? <th>Prév. {currentEditionId}</th> : null}
              {showActual ? <th>Réalisé {currentEditionId}</th> : null}
              {showForecast && showActual ? <th>Écart {currentEditionId}</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <Fragment key={row.id}>
                <tr key={row.id}>
                  <td>{row.label}</td>
                  {hasComparison ? <td>{formatCurrency(row.referenceActual)}</td> : null}
                  {showForecast ? <td>{formatCurrency(row.currentForecast)}</td> : null}
                  {showActual ? <td>{formatCurrency(row.currentActual)}</td> : null}
                  {showForecast && showActual ? (
                    <td className="budget-table__variance">
                      <span className={getVarianceToneClass(computeVariance(row.currentForecast, row.currentActual), side)}>
                        {formatVariance(computeVariance(row.currentForecast, row.currentActual))}
                      </span>
                    </td>
                  ) : null}
                </tr>
                {showDetails ? row.items
                  .filter((item) => detailSelections[row.id]?.[item.id] ?? true)
                  .map((item) => (
                  <tr className="budget-table__detail-row" key={`${row.id}-${item.id}`}>
                    <td>
                      <div className="budget-detail-label">
                        <span>{item.label}</span>
                        {item.details ? <small>{item.details}</small> : null}
                      </div>
                    </td>
                    {hasComparison ? <td>{formatCurrency(item.referenceActual)}</td> : null}
                    {showForecast ? <td>{formatCurrency(item.currentForecast)}</td> : null}
                    {showActual ? <td>{formatCurrency(item.currentActual)}</td> : null}
                    {showForecast && showActual ? (
                      <td className="budget-table__variance">
                        <span className={getVarianceToneClass(computeVariance(item.currentForecast, item.currentActual), side)}>
                          {formatVariance(computeVariance(item.currentForecast, item.currentActual))}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                )) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function BudgetTrackingPage({ Panel }) {
  const { currentUser, userProfile } = useAuth();
  const { activeEditionId } = useActiveEdition(true);
  const invoiceConfiguration = useBudgetInvoiceConfiguration();
  const { documents: allDocuments } = useDocumentsCollection(true);
  const [storedBudgets, setStoredBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [draftBudget, setDraftBudget] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isEditMode, setIsEditMode] = useState(false);
  const [newBudgetYear, setNewBudgetYear] = useState("");
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [pendingNewBudgetId, setPendingNewBudgetId] = useState("");
  const [simplifiedDisplayMode, setSimplifiedDisplayMode] = useState("both");
  const [simplifiedShowDetails, setSimplifiedShowDetails] = useState(false);
  const [simplifiedSelections, setSimplifiedSelections] = useState({
    expenses: {},
    revenues: {},
  });
  const [simplifiedDetailSelections, setSimplifiedDetailSelections] = useState({
    expenses: {},
    revenues: {},
  });
  const [sectionDrafts, setSectionDrafts] = useState({
    expenses: "",
    revenues: "",
  });
  const [saveStatus, setSaveStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSeedingBudgets, setIsSeedingBudgets] = useState(false);
  const [budgetSeedLog, setBudgetSeedLog] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [dragState, setDragState] = useState(null);
  const [dragOverRowId, setDragOverRowId] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [hasUserSelectedEdition, setHasUserSelectedEdition] = useState(false);
  const [invoiceLinkDrafts, setInvoiceLinkDrafts] = useState({});
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedInvoiceTargetRowId, setSelectedInvoiceTargetRowId] = useState("");

  const fallbackBudgets = useMemo(() => buildAllBudgetSeeds(), []);
  const fallbackBudgetMap = useMemo(
    () => new Map(fallbackBudgets.map((budget) => [budget.editionId, budget])),
    [fallbackBudgets],
  );
  const missingSeedEditionIds = useMemo(
    () => fallbackBudgets
      .filter((fallbackBudget) => !storedBudgets.some((budget) => budget.editionId === fallbackBudget.editionId))
      .map((budget) => budget.editionId),
    [fallbackBudgets, storedBudgets],
  );
  const usesFallbackBudgets = missingSeedEditionIds.length > 0;

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, BUDGET_COLLECTION),
      (snapshot) => {
        const nextBudgets = sortBudgetDocuments(snapshot.docs.map((docSnapshot) => normalizeBudgetDocument({
          id: docSnapshot.id,
          editionId: docSnapshot.id,
          ...docSnapshot.data(),
        })));
        setStoredBudgets(nextBudgets);
        setLoading(false);
        setError("");
      },
      () => {
        setStoredBudgets([]);
        setLoading(false);
        setError("Impossible de charger les budgets.");
      },
    );

    return unsubscribe;
  }, []);

  const budgets = useMemo(() => {
    const sourceBudgets = usesFallbackBudgets
      ? sortBudgetDocuments([
          ...storedBudgets,
          ...fallbackBudgets.filter((fallbackBudget) => missingSeedEditionIds.includes(fallbackBudget.editionId)),
        ])
      : storedBudgets;

    const hydratedBudgets = sourceBudgets.map((budget) =>
      mergeFallbackBudgetValues(budget, fallbackBudgetMap.get(budget.editionId)),
    );

    const canonicalBudgets = hydratedBudgets.map((budget) =>
      applyCanonicalHistoricalBudget(budget, fallbackBudgetMap.get(budget.editionId)),
    );

    return canonicalBudgets.map((budget) => recalculateBudgetFormulas(enrichBudgetWithLinkedActuals(budget, canonicalBudgets)));
  }, [fallbackBudgetMap, fallbackBudgets, missingSeedEditionIds, storedBudgets, usesFallbackBudgets]);

  const selectedBudget = useMemo(
    () => budgets.find((budget) => budget.editionId === selectedEditionId) ?? null,
    [budgets, selectedEditionId],
  );
  const persistedBudget = useMemo(
    () => storedBudgets.find((budget) => budget.editionId === selectedEditionId) ?? null,
    [selectedEditionId, storedBudgets],
  );
  const latestBudget = useMemo(() => {
    const numericBudgets = budgets.filter((budget) => Number.isFinite(Number(getBudgetDocumentLabel(budget))));

    if (numericBudgets.length) {
      return [...numericBudgets].sort((left, right) => Number(getBudgetDocumentLabel(right)) - Number(getBudgetDocumentLabel(left)))[0];
    }

    return budgets[0] ?? null;
  }, [budgets]);

  useEffect(() => {
    if (!budgets.length || !latestBudget) return;
    if (hasUserSelectedEdition && selectedEditionId && budgets.some((budget) => budget.editionId === selectedEditionId)) return;

    setSelectedEditionId(latestBudget.editionId);
  }, [budgets, hasUserSelectedEdition, latestBudget, selectedEditionId]);

  const isBudgetLocked = Boolean(selectedBudget && isBudgetLockedEdition(selectedBudget.editionId));
  const isBudgetEditable = Boolean(selectedBudget && latestBudget && selectedBudget.editionId === latestBudget.editionId && !isBudgetLocked);
  const canEditBudget = isBudgetEditable && isEditMode;
  const canCreateNextBudget = Boolean(selectedBudget && latestBudget && selectedBudget.editionId === latestBudget.editionId);
  const primaryTabLabel = isBudgetLocked ? "Budget définitif" : (isBudgetEditable ? "Prévisionnel / actuel" : "Budget consulté");

  useEffect(() => {
    if (!selectedBudget) return;
    setDraftBudget(recalculateBudgetFormulas(structuredClone(selectedBudget)));
    setActiveTab("overview");
    if (selectedBudget.editionId === pendingNewBudgetId) {
      setIsEditMode(true);
      setSaveStatus(`Budget ${selectedBudget.currentEditionId} créé à partir de ${selectedBudget.referenceEditionId}.`);
      setPendingNewBudgetId("");
      return;
    }

    setIsEditMode(false);
    setSaveStatus("");
  }, [selectedBudget]);

  useEffect(() => {
    if (!latestBudget) return;
    const nextYear = Number(getBudgetDocumentLabel(latestBudget));
    if (!Number.isFinite(nextYear)) return;
    setNewBudgetYear(String(nextYear + 1));
  }, [latestBudget]);

  useEffect(() => {
    if (!selectedEditionId) return undefined;

    setHistoryLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, BUDGET_COLLECTION, selectedEditionId, BUDGET_HISTORY_COLLECTION),
      (snapshot) => {
        const entries = snapshot.docs.map(mapHistoryEntry).sort((left, right) => {
          return (right.createdAt?.getTime?.() || 0) - (left.createdAt?.getTime?.() || 0);
        });
        setHistoryEntries(entries);
        setHistoryLoading(false);
        setHistoryError("");
      },
      () => {
        setHistoryEntries([]);
        setHistoryLoading(false);
        setHistoryError("Impossible de charger l'historique du budget.");
      },
    );

    return unsubscribe;
  }, [selectedEditionId]);

  const actorName = useMemo(() => getDisplayName(userProfile, currentUser?.email), [currentUser?.email, userProfile]);
  const activeRoles = useMemo(() => extractRolesFromProfile(userProfile), [userProfile]);
  const budgetDiff = useMemo(
    () => (draftBudget && selectedBudget ? buildBudgetDiff(selectedBudget, draftBudget) : []),
    [draftBudget, selectedBudget],
  );
  const hasPersistedBudget = Boolean(persistedBudget);
  const hasUnsavedChanges = isBudgetEditable && (Boolean(budgetDiff.length) || !hasPersistedBudget);
  const totals = useMemo(() => (draftBudget ? getBudgetTotals(draftBudget) : null), [draftBudget]);
  const hasCurrentActualValues = useMemo(
    () => (draftBudget
      ? [...draftBudget.expenses, ...draftBudget.revenues].some((row) => row?.currentActual != null && row.currentActual !== "")
      : false),
    [draftBudget],
  );
  const hasComparison = useMemo(
    () => hasComparisonEdition(draftBudget?.referenceEditionId),
    [draftBudget?.referenceEditionId],
  );
  const expenseSections = useMemo(
    () => (draftBudget ? groupRowsBySection(draftBudget.expenses, EXPENSE_SECTION_ORDER) : []),
    [draftBudget],
  );
  const revenueSections = useMemo(
    () => (draftBudget ? groupRowsBySection(draftBudget.revenues, REVENUE_SECTION_ORDER) : []),
    [draftBudget],
  );
  const expenseTargetOptions = useMemo(
    () => buildBudgetExpenseTargetOptions(expenseSections, draftBudget?.currentEditionId || ""),
    [draftBudget?.currentEditionId, expenseSections],
  );
  const invoiceDocuments = useMemo(
    () => allDocuments.filter((document) => document.documentType === "invoice"),
    [allDocuments],
  );
  const selectedEditionInvoices = useMemo(
    () =>
      invoiceDocuments
        .filter((invoice) => {
          const invoiceEditionId = String(invoice.linkedBudgetEditionId || invoice.editionId || "").trim();
          return invoiceEditionId === String(draftBudget?.currentEditionId || "").trim();
        })
        .sort((left, right) => right.createdAtMs - left.createdAtMs),
    [draftBudget?.currentEditionId, invoiceDocuments],
  );
  const unclassifiedInvoices = useMemo(
    () =>
      selectedEditionInvoices.filter(
        (invoice) => String(invoice.invoiceStatus || "").trim() !== "linked" || !String(invoice.linkedBudgetRowId || "").trim(),
      ),
    [selectedEditionInvoices],
  );
  const invoicesByBudgetRowId = useMemo(
    () =>
      selectedEditionInvoices.reduce((accumulator, invoice) => {
        const rowId = String(invoice.linkedBudgetRowId || "").trim();
        if (!rowId) return accumulator;
        if (!accumulator[rowId]) accumulator[rowId] = [];
        accumulator[rowId].push(invoice);
        return accumulator;
      }, {}),
    [selectedEditionInvoices],
  );
  const selectedInvoiceForClassification = useMemo(
    () => unclassifiedInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [selectedInvoiceId, unclassifiedInvoices],
  );
  const canUploadInvoices = useMemo(
    () =>
      canUserUploadBudgetInvoice({
        activeRoles,
        userId: currentUser?.uid,
        configuration: invoiceConfiguration,
      }),
    [activeRoles, currentUser?.uid, invoiceConfiguration],
  );
  const canManageInvoicePanel = Boolean(
    draftBudget &&
      latestBudget &&
      draftBudget.currentEditionId === latestBudget.currentEditionId &&
      (activeRoles.includes("admin") || activeRoles.includes("budget") || canUploadInvoices),
  );
  const simplifiedExpenseRows = useMemo(
    () => (draftBudget ? buildSimplifiedRows(draftBudget, "expense") : []),
    [draftBudget],
  );
  const simplifiedRevenueRows = useMemo(
    () => (draftBudget ? buildSimplifiedRows(draftBudget, "revenue") : []),
    [draftBudget],
  );

  useEffect(() => {
    setSimplifiedSelections((currentSelections) => ({
      expenses: Object.fromEntries(
        simplifiedExpenseRows.map((row) => [row.id, currentSelections.expenses[row.id] ?? true]),
      ),
      revenues: Object.fromEntries(
        simplifiedRevenueRows.map((row) => [row.id, currentSelections.revenues[row.id] ?? true]),
      ),
    }));
  }, [simplifiedExpenseRows, simplifiedRevenueRows]);

  useEffect(() => {
    setSimplifiedDetailSelections((currentSelections) => ({
      expenses: Object.fromEntries(
        simplifiedExpenseRows.map((row) => [
          row.id,
          Object.fromEntries(
            row.items.map((item) => [item.id, currentSelections.expenses[row.id]?.[item.id] ?? true]),
          ),
        ]),
      ),
      revenues: Object.fromEntries(
        simplifiedRevenueRows.map((row) => [
          row.id,
          Object.fromEntries(
            row.items.map((item) => [item.id, currentSelections.revenues[row.id]?.[item.id] ?? true]),
          ),
        ]),
      ),
    }));
  }, [simplifiedExpenseRows, simplifiedRevenueRows]);

  useEffect(() => {
    setInvoiceLinkDrafts((currentDrafts) =>
      Object.fromEntries(
        unclassifiedInvoices.map((invoice) => [invoice.id, currentDrafts[invoice.id] || ""]),
      ),
    );
  }, [unclassifiedInvoices]);

  useEffect(() => {
    if (!unclassifiedInvoices.length) {
      setSelectedInvoiceId("");
      setSelectedInvoiceTargetRowId("");
      return;
    }

    setSelectedInvoiceId((currentInvoiceId) => {
      if (currentInvoiceId && unclassifiedInvoices.some((invoice) => invoice.id === currentInvoiceId)) {
        return currentInvoiceId;
      }

      return unclassifiedInvoices[0].id;
    });
  }, [unclassifiedInvoices]);

  useEffect(() => {
    setSelectedInvoiceTargetRowId("");
  }, [selectedInvoiceId]);

  function handleRowChange(type, rowId, fieldName, nextValue) {
    if (!canEditBudget) return;

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      const collectionKey = type === "expenses" ? "expenses" : "revenues";
      const isNumericField = fieldName.includes("Forecast") || fieldName.includes("Actual");
      const nextBudget = {
        ...currentBudget,
        [collectionKey]: currentBudget[collectionKey].map((row) =>
          row.id === rowId
            ? {
                ...row,
                ...(isNumericField
                  ? String(nextValue || "").trim().startsWith("=")
                    ? {
                        [fieldName]: row[fieldName],
                        [`${fieldName}Formula`]: String(nextValue || "").trim(),
                        [`${fieldName}FormulaError`]: "",
                      }
                    : {
                        [fieldName]: toBudgetNumber(nextValue),
                        [`${fieldName}Formula`]: "",
                        [`${fieldName}FormulaError`]: "",
                      }
                  : {
                      [fieldName]: nextValue,
                    }),
              }
            : row,
        ),
      };

      return isNumericField ? recalculateBudgetFormulas(nextBudget) : nextBudget;
    });
  }

  function handleAddRow(type, sectionName) {
    if (!canEditBudget) return;

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      const collectionKey = type === "expenses" ? "expenses" : "revenues";
      const sideName = collectionKey === "expenses" ? "expense" : "revenue";
      const existingRows = currentBudget[collectionKey];
      const nextRowNumber = existingRows.reduce((maxValue, row) => Math.max(maxValue, Number(row.rowNumber || 0)), 0) + 1;
      const newRow = createBudgetRow({
        side: sideName,
        section: sectionName,
        rowNumber: nextRowNumber,
      });

      const insertIndex = existingRows.reduce(
        (lastMatchIndex, row, index) => (row.section === sectionName ? index + 1 : lastMatchIndex),
        existingRows.length,
      );
      const nextRows = [...existingRows];
      nextRows.splice(insertIndex, 0, newRow);

      return recalculateBudgetFormulas({
        ...currentBudget,
        [collectionKey]: resequenceBudgetRows(nextRows),
      });
    });

    setSaveStatus("Nouvelle ligne ajoutée au budget en cours.");
  }

  function handleNewSectionNameChange(type, value) {
    setSectionDrafts((currentDrafts) => ({
      ...currentDrafts,
      [type]: value,
    }));
  }

  function handleAddSection(type) {
    if (!canEditBudget) return;

    const nextSectionName = String(sectionDrafts[type] || "").trim();
    if (!nextSectionName) {
      setSaveStatus("Indique un nom de section avant de l'ajouter.");
      return;
    }

    const collectionKey = type === "expenses" ? "expenses" : "revenues";
    if (draftBudget?.[collectionKey]?.some((row) => row.section.toLowerCase() === nextSectionName.toLowerCase())) {
      setSaveStatus("Cette section existe déjà dans le budget en cours.");
      return;
    }

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      const sideName = collectionKey === "expenses" ? "expense" : "revenue";
      const existingRows = currentBudget[collectionKey];

      const nextRowNumber = existingRows.reduce((maxValue, row) => Math.max(maxValue, Number(row.rowNumber || 0)), 0) + 1;
      const newRow = createBudgetRow({
        side: sideName,
        section: nextSectionName,
        rowNumber: nextRowNumber,
      });

      return recalculateBudgetFormulas({
        ...currentBudget,
        [collectionKey]: resequenceBudgetRows([...existingRows, newRow]),
      });
    });

    setSectionDrafts((currentDrafts) => ({
      ...currentDrafts,
      [type]: "",
    }));
    setSaveStatus(`Section "${nextSectionName}" ajoutée au budget en cours.`);
  }

  function handleDeleteRow(type, rowId) {
    if (!canEditBudget) return;

    const collectionKey = type === "expenses" ? "expenses" : "revenues";
    const rowToDelete = draftBudget?.[collectionKey]?.find((row) => row.id === rowId);
    if (!rowToDelete) return;

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      return recalculateBudgetFormulas({
        ...currentBudget,
        [collectionKey]: resequenceBudgetRows(currentBudget[collectionKey].filter((row) => row.id !== rowId)),
      });
    });

    setSaveStatus(`Ligne "${rowToDelete.label}" supprimée du budget en cours.`);
  }

  async function handleLinkInvoice(invoiceId, targetRowId) {
    const invoice = selectedEditionInvoices.find((entry) => entry.id === invoiceId);
    const target = expenseTargetOptions.find((option) => option.value === targetRowId);
    if (!invoice || !target) return;

    try {
      await updateDoc(doc(db, "documents", invoiceId), {
        invoiceStatus: "linked",
        linkedBudgetEditionId: target.editionId,
        linkedBudgetCollectionKey: target.collectionKey,
        linkedBudgetRowId: target.rowId,
        linkedBudgetRowLabel: target.rowLabel,
        linkedBudgetSectionName: target.sectionName,
        updatedAt: serverTimestamp(),
      });
      setSaveStatus(`Facture liée à ${target.rowLabel}.`);
    } catch (error) {
      console.error("Unable to link invoice to budget row", error);
      setSaveStatus("La liaison de la facture a échoué.");
    }
  }

  async function handleUnlinkInvoice(invoice) {
    if (!invoice?.id || !draftBudget) return;

    try {
      await updateDoc(doc(db, "documents", invoice.id), {
        invoiceStatus: "unclassified",
        linkedBudgetEditionId: draftBudget.currentEditionId,
        linkedBudgetCollectionKey: "",
        linkedBudgetRowId: "",
        linkedBudgetRowLabel: "",
        linkedBudgetSectionName: "",
        updatedAt: serverTimestamp(),
      });
      setSaveStatus(`Facture déliée de ${invoice.linkedBudgetRowLabel || "la ligne budgétaire"}.`);
    } catch (error) {
      console.error("Unable to unlink invoice from budget row", error);
      setSaveStatus("Le retrait de la facture a échoué.");
    }
  }

  function handleRowDragStart(event, type, sectionName, rowId) {
    if (!canEditBudget) return;

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rowId);
    setDragState({
      type,
      sectionName,
      rowId,
    });
    setDragOverRowId(rowId);
  }

  function handleRowDragOver(event, type, rowId) {
    if (!dragState || dragState.type !== type) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverRowId !== rowId) setDragOverRowId(rowId);
  }

  function handleRowDrop(event, type, sectionName, targetRowId) {
    event.preventDefault();
    if (!canEditBudget || !dragState || dragState.type !== type) {
      setDragState(null);
      setDragOverRowId("");
      return;
    }

    const sourceRowId = dragState.rowId;
    setDragState(null);
    setDragOverRowId("");

    if (sourceRowId === targetRowId) return;

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      const collectionKey = type === "expenses" ? "expenses" : "revenues";
      const currentRows = currentBudget[collectionKey];
      const sourceIndex = currentRows.findIndex((row) => row.id === sourceRowId);
      const targetIndex = currentRows.findIndex((row) => row.id === targetRowId);

      if (sourceIndex < 0 || targetIndex < 0) return currentBudget;

      const sourceRow = currentRows[sourceIndex];
      const targetRow = currentRows[targetIndex];

      if (sourceRow.section !== targetRow.section || sourceRow.section !== sectionName) return currentBudget;

      const nextRows = [...currentRows];
      const [movedRow] = nextRows.splice(sourceIndex, 1);
      const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      nextRows.splice(insertionIndex, 0, movedRow);

      return recalculateBudgetFormulas({
        ...currentBudget,
        [collectionKey]: resequenceBudgetRows(nextRows),
      });
    });

    setSaveStatus(`Ordre mis à jour dans la section "${sectionName}".`);
  }

  function handleRowDragEnd() {
    setDragState(null);
    setDragOverRowId("");
  }

  function resetDraft() {
    if (!isBudgetEditable || !selectedBudget) return;
    setDraftBudget(recalculateBudgetFormulas(structuredClone(selectedBudget)));
    setIsEditMode(false);
    setSaveStatus("Les modifications locales ont été réinitialisées.");
  }

  async function handleSave() {
    if (!isBudgetEditable) {
      setSaveStatus("Les budgets passés sont verrouillés en lecture seule.");
      return;
    }
    if (!draftBudget) return;
    if (!budgetDiff.length && hasPersistedBudget) {
      setSaveStatus("Aucune modification à enregistrer.");
      return;
    }

    setIsSaving(true);
    setSaveStatus("Enregistrement du budget en cours...");

    try {
      const budgetRef = doc(db, BUDGET_COLLECTION, draftBudget.editionId);
      const serializedBudget = serializeBudgetDocument(draftBudget, {
        actorName,
        actorUid: currentUser?.uid || "",
      });
      const historySummary = !hasPersistedBudget && !budgetDiff.length
        ? "Initialisation du budget"
        : `${budgetDiff.length} modification(s) enregistrée(s)`;

      await setDoc(
        budgetRef,
        {
          ...serializedBudget,
          createdAt: persistedBudget?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      try {
        await addDoc(collection(db, BUDGET_COLLECTION, draftBudget.editionId, BUDGET_HISTORY_COLLECTION), {
          createdAt: serverTimestamp(),
          actorName,
          actorUid: currentUser?.uid || "",
          summary: historySummary,
          changeCount: budgetDiff.length,
          changes: budgetDiff.slice(0, 80),
        });
      } catch (historyError) {
        console.error("Unable to log budget history entry", historyError);
      }

      setSaveStatus(historySummary);
      setIsEditMode(false);
    } catch (saveError) {
      console.error("Unable to save budget tracking changes", saveError);
      setSaveStatus("La sauvegarde du budget a échoué.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateBudget() {
    if (!canCreateNextBudget || !latestBudget) return;

    const normalizedEditionId = normalizeEditionId(newBudgetYear);
    const targetYear = Number(normalizedEditionId);
    const latestYear = Number(getBudgetDocumentLabel(latestBudget));

    if (!Number.isFinite(targetYear)) {
      setSaveStatus("Indique une année valide pour le nouveau budget.");
      return;
    }

    if (budgets.some((budget) => budget.editionId === normalizedEditionId)) {
      setSaveStatus(`Le budget ${normalizedEditionId} existe déjà.`);
      return;
    }

    if (Number.isFinite(latestYear) && targetYear <= latestYear) {
      setSaveStatus(`Le nouveau budget doit être supérieur à ${latestYear}.`);
      return;
    }

    setIsCreatingBudget(true);
    setSaveStatus(`Création du budget ${normalizedEditionId} en cours...`);

    try {
      const nextBudget = buildBudgetFromTemplate(latestBudget, normalizedEditionId);
      const budgetRef = doc(db, BUDGET_COLLECTION, normalizedEditionId);

      await setDoc(budgetRef, {
        ...serializeBudgetDocument(nextBudget, {
          actorName,
          actorUid: currentUser?.uid || "",
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, BUDGET_COLLECTION, normalizedEditionId, BUDGET_HISTORY_COLLECTION), {
        createdAt: serverTimestamp(),
        actorName,
        actorUid: currentUser?.uid || "",
        summary: `Initialisation du budget ${normalizedEditionId}`,
        changeCount: 0,
        changes: [],
      });

      setPendingNewBudgetId(normalizedEditionId);
      setSelectedEditionId(normalizedEditionId);
    } catch (createError) {
      console.error("Unable to create budget", createError);
      setSaveStatus("La création du nouveau budget a échoué.");
    } finally {
      setIsCreatingBudget(false);
    }
  }

  async function handleSeedBudgets() {
    if (isSeedingBudgets) return;

    const shouldSeed = window.confirm(
      usesFallbackBudgets
        ? `Importer ${missingSeedEditionIds.join(", ")} dans Firestore et faire de Firebase la source de vérité ?`
        : "Ressynchroniser les budgets historiques locaux vers Firestore ?",
    );
    if (!shouldSeed) return;

    setIsSeedingBudgets(true);
    setBudgetSeedLog([]);
    setSaveStatus("");

    try {
      const budgetsToSeed = usesFallbackBudgets
        ? fallbackBudgets.filter((budget) => missingSeedEditionIds.includes(budget.editionId))
        : fallbackBudgets;

      setBudgetSeedLog((currentLog) => [
        ...currentLog,
        `Préparation de ${budgetsToSeed.length} budget(s) : ${budgetsToSeed.map((budget) => budget.editionId).join(", ")}`,
      ]);

      let batch = writeBatch(db);
      let count = 0;

      budgetsToSeed.forEach((budget) => {
        const existingBudget = storedBudgets.find((item) => item.editionId === budget.editionId);
        const budgetRef = doc(db, BUDGET_COLLECTION, budget.editionId);

        batch.set(
          budgetRef,
          {
            ...serializeBudgetDocument(budget, {
              actorName,
              actorUid: currentUser?.uid || "",
            }),
            createdAt: existingBudget?.createdAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
            seededAt: serverTimestamp(),
          },
          { merge: true },
        );
        count += 1;
      });

      await batch.commit();
      setBudgetSeedLog((currentLog) => [...currentLog, `Budgets importés : ${count}`]);

      for (const budget of budgetsToSeed) {
        await setDoc(
          doc(db, BUDGET_COLLECTION, budget.editionId, BUDGET_HISTORY_COLLECTION, "seed-initial"),
          {
            createdAt: serverTimestamp(),
            actorName,
            actorUid: currentUser?.uid || "",
            summary: `Initialisation Firestore du budget ${budget.editionId}`,
            changeCount: 0,
            changes: [],
            source: "local-seed",
          },
          { merge: true },
        );
        setBudgetSeedLog((currentLog) => [...currentLog, `Historique créé : ${budget.editionId}`]);
      }

      setSaveStatus(
        usesFallbackBudgets
          ? `Firestore initialisé pour ${budgetsToSeed.map((budget) => budget.editionId).join(", ")}.`
          : "Budgets Firestore resynchronisés depuis les modèles locaux.",
      );
    } catch (seedError) {
      console.error("Unable to seed budgets", seedError);
      setBudgetSeedLog((currentLog) => [...currentLog, `❌ ${seedError?.message || "Import impossible"}`]);
      setSaveStatus("L'initialisation Firestore du budget a échoué.");
    } finally {
      setIsSeedingBudgets(false);
    }
  }

  function handleToggleSimplifiedRow(sideKey, rowId) {
    setSimplifiedSelections((currentSelections) => ({
      ...currentSelections,
      [sideKey]: {
        ...currentSelections[sideKey],
        [rowId]: !(currentSelections[sideKey][rowId] ?? true),
      },
    }));
  }

  function handleToggleSimplifiedDetailRow(sideKey, rowId, itemId) {
    setSimplifiedDetailSelections((currentSelections) => ({
      ...currentSelections,
      [sideKey]: {
        ...currentSelections[sideKey],
        [rowId]: {
          ...currentSelections[sideKey][rowId],
          [itemId]: !(currentSelections[sideKey][rowId]?.[itemId] ?? true),
        },
      },
    }));
  }

  async function handleExportExcel() {
    if (!draftBudget || !totals) return;

    setIsExportingExcel(true);
    setExportStatus("Préparation de l'export Excel…");

    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MyCLIM";
      workbook.company = "Fédération Luxembourgeoise d'Athlétisme";
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.subject = `Budget CMCM Luxembourg Indoor Meeting ${draftBudget.currentEditionId}`;
      workbook.title = `Budget ${draftBudget.currentEditionId}`;

      const [meetingLogoBuffer, sponsorsStripBuffer] = await Promise.all([
        loadWorkbookImage(meetingLogoUrl),
        loadWorkbookImage(sponsorsStripUrl),
      ]);

      const meetingLogoId = workbook.addImage({
        buffer: meetingLogoBuffer,
        extension: "png",
      });
      const sponsorsStripId = workbook.addImage({
        buffer: sponsorsStripBuffer,
        extension: "png",
      });

      addOverviewWorksheet({
        workbook,
        budget: draftBudget,
        totals,
        hasComparison,
        imageId: meetingLogoId,
        stripImageId: sponsorsStripId,
      });

      addBudgetDetailWorksheet({
        workbook,
        title: "Dépenses",
        sectionLabel: "Dépenses",
        sections: expenseSections,
        totals: totals.expenses,
        currentEditionId: draftBudget.currentEditionId,
        referenceEditionId: draftBudget.referenceEditionId,
        hasComparison,
        imageId: meetingLogoId,
        stripImageId: sponsorsStripId,
      });

      addBudgetDetailWorksheet({
        workbook,
        title: "Recettes",
        sectionLabel: "Recettes",
        sections: revenueSections,
        totals: totals.revenues,
        currentEditionId: draftBudget.currentEditionId,
        referenceEditionId: draftBudget.referenceEditionId,
        hasComparison,
        imageId: meetingLogoId,
        stripImageId: sponsorsStripId,
      });

      addBudgetHistoryWorksheet({
        workbook,
        historyEntries,
        currentEditionId: draftBudget.currentEditionId,
        imageId: meetingLogoId,
        stripImageId: sponsorsStripId,
      });

      const filename = `budget-${draftBudget.currentEditionId}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      triggerExcelDownload(buffer, filename);
      setExportStatus(`Export Excel prêt : ${filename}`);
    } catch (error) {
      console.error("Unable to export budget to Excel", error);
      setExportStatus("L'export Excel a échoué.");
    } finally {
      setIsExportingExcel(false);
    }
  }

  function handleExportPdf() {
    if (!draftBudget || !totals) return;

    setIsExportingPdf(true);
    setExportStatus("Préparation du PDF…");

    try {
      const htmlDocument = buildBudgetPrintDocument({
        budget: draftBudget,
        totals,
        expenseSections,
        revenueSections,
        hasComparison,
      });
      const printBlob = new Blob([htmlDocument], { type: "text/html;charset=utf-8" });
      const printUrl = URL.createObjectURL(printBlob);
      const printWindow = window.open(printUrl, "_blank");

      if (!printWindow) {
        URL.revokeObjectURL(printUrl);
        setExportStatus("Le navigateur a bloqué l'ouverture de la fenêtre PDF.");
        setIsExportingPdf(false);
        return;
      }

      window.setTimeout(() => {
        URL.revokeObjectURL(printUrl);
      }, 60000);

      setExportStatus("Aperçu PDF ouvert. Si la boîte d'impression ne s'ouvre pas, utilise Cmd+P pour enregistrer le PDF.");
    } catch (error) {
      console.error("Unable to export budget to PDF", error);
      setExportStatus("L'export PDF a échoué.");
    } finally {
      setIsExportingPdf(false);
    }
  }

  if (loading || !draftBudget || !totals) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">Budget</p>
            <h1>Chargement du suivi budgétaire</h1>
            <p>Nous préparons la structure du budget et son historique.</p>
          </div>
        </section>
      </div>
    );
  }

  const currentYearLabel = getBudgetDocumentLabel(draftBudget);
  const topbarSummaryField = !isBudgetLocked && !hasCurrentActualValues ? "currentForecast" : "currentActual";
  const topbarSummaryLabel = topbarSummaryField === "currentForecast" ? "Prévisionnel" : (isBudgetLocked ? "Définitif" : "Réalisé");

  return (
    <div className="page budget-page">
      {error ? (
        <div className="notice-card notice-card--warn">
          <strong>Chargement partiel</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <section className="budget-topbar">
        <div className="budget-topbar__header">
          <div className="budget-topbar__identity">
            <p className="budget-topbar__eyebrow">Budget {currentYearLabel}</p>
            <h1>{primaryTabLabel}</h1>
            <p>{draftBudget.meetingLevel || "meeting"}</p>
          </div>
          <div className="budget-toolbar-actions">
            {canCreateNextBudget ? (
              <div className="budget-toolbar-actions__new">
                <input
                  type="text"
                  inputMode="numeric"
                  value={newBudgetYear}
                  onChange={(event) => setNewBudgetYear(event.target.value)}
                  placeholder="2027"
                />
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={handleCreateBudget}
                  disabled={isCreatingBudget}
                >
                  {isCreatingBudget ? "Création..." : "Nouveau budget"}
                </button>
              </div>
            ) : null}
            <span className={`status-pill ${isBudgetEditable ? "status-pill--ok" : "status-pill--warn"}`}>
              {isBudgetEditable ? (isEditMode ? "Mode modification actif" : "Budget en cours prêt à modifier") : (isBudgetLocked ? "Budget verrouillé" : "Lecture seule")}
            </span>
            {usesFallbackBudgets ? (
              <span className="status-pill status-pill--warn">Source provisoire</span>
            ) : (
              <span className="status-pill">Firebase</span>
            )}
            <button
              className="button button--secondary budget-export-button"
              type="button"
              onClick={handleExportExcel}
              disabled={isExportingExcel}
            >
              {isExportingExcel ? "Export Excel..." : "Export Excel"}
            </button>
            <button
              className="button button--secondary budget-export-button"
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
            >
              {isExportingPdf ? "Export PDF..." : "Export PDF"}
            </button>
            {isBudgetEditable ? (
              <>
                {!isEditMode ? (
                  <button className="button button--secondary" type="button" onClick={() => setIsEditMode(true)}>
                    Modifier
                  </button>
                ) : (
                  <>
                    <button className="button button--secondary" type="button" onClick={() => setIsEditMode(false)}>
                      Fermer
                    </button>
                    <button className="button button--secondary" type="button" onClick={resetDraft} disabled={!hasUnsavedChanges || isSaving}>
                      Réinitialiser
                    </button>
                    <button className="button button--primary" type="button" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="budget-toolbar">
          <label className="field budget-toolbar__field">
            <span>Budget consulté</span>
            <select
              value={selectedEditionId}
              onChange={(event) => {
                setHasUserSelectedEdition(true);
                setSelectedEditionId(event.target.value);
              }}
            >
              {budgets.map((budget) => (
                <option key={budget.editionId} value={budget.editionId}>
                  {getBudgetDocumentLabel(budget)}
                </option>
              ))}
            </select>
          </label>
          <div className="budget-toolbar__meta">
            <strong>{hasPersistedBudget ? "Budget sauvegardé" : "Modèle local"}</strong>
            <span>{formatDateTime(draftBudget.updatedAt)}</span>
            <span>{draftBudget.updatedByName || actorName}</span>
          </div>
        </div>

        <div className="budget-inline-summary budget-inline-summary--topbar" aria-label={`Synthèse ${topbarSummaryLabel.toLowerCase()} du budget`}>
          <span className="budget-inline-summary__context">{topbarSummaryLabel} {draftBudget.currentEditionId}</span>
          <span className="budget-inline-summary__item">
            <strong>Dépenses</strong>
            <span>{formatCurrency(totals.expenses[topbarSummaryField])}</span>
          </span>
          <span className="budget-inline-summary__item">
            <strong>Recettes</strong>
            <span>{formatCurrency(totals.revenues[topbarSummaryField])}</span>
          </span>
          <span className="budget-inline-summary__item budget-inline-summary__item--balance">
            <strong>Bilan</strong>
            <span className={getBalanceToneClass(totals.balance[topbarSummaryField])}>
              {formatCurrency(totals.balance[topbarSummaryField])}
            </span>
          </span>
        </div>

        {budgetSeedLog.length ? <BudgetSeedLog lines={budgetSeedLog} /> : null}
        {exportStatus ? <p className="panel-note budget-save-status">{exportStatus}</p> : null}
        {saveStatus ? <p className="panel-note budget-save-status">{saveStatus}</p> : null}
      </section>

      {activeTab !== "overview" && activeTab !== "invoices" ? (
        <section className="budget-summary-grid">
            {hasComparison ? (
              <article className="budget-summary-card">
                <span className="budget-summary-card__label">Dépenses {draftBudget.referenceEditionId}</span>
                <strong>{formatCurrency(totals.expenses.referenceActual)}</strong>
                <small>Réalisé de comparaison</small>
              </article>
            ) : null}
            <article className="budget-summary-card">
              <span className="budget-summary-card__label">Dépenses {draftBudget.currentEditionId}</span>
              <strong>{formatCurrency(totals.expenses.currentActual)}</strong>
              <small>{formatCurrency(totals.expenses.currentForecast)} prévues</small>
              <span className={getVarianceToneClass(computeVariance(totals.expenses.currentForecast, totals.expenses.currentActual), "expense")}>
                {formatVariance(computeVariance(totals.expenses.currentForecast, totals.expenses.currentActual))}
              </span>
            </article>
            {hasComparison ? (
              <article className="budget-summary-card">
                <span className="budget-summary-card__label">Recettes {draftBudget.referenceEditionId}</span>
                <strong>{formatCurrency(totals.revenues.referenceActual)}</strong>
                <small>Réalisé de comparaison</small>
              </article>
            ) : null}
            <article className="budget-summary-card">
              <span className="budget-summary-card__label">Recettes {draftBudget.currentEditionId}</span>
              <strong>{formatCurrency(totals.revenues.currentActual)}</strong>
              <small>{formatCurrency(totals.revenues.currentForecast)} prévues</small>
              <span className={getVarianceToneClass(computeVariance(totals.revenues.currentForecast, totals.revenues.currentActual), "revenue")}>
                {formatVariance(computeVariance(totals.revenues.currentForecast, totals.revenues.currentActual))}
              </span>
            </article>
            {hasComparison ? (
              <article className="budget-summary-card budget-summary-card--balance">
                <span className="budget-summary-card__label">Équilibre {draftBudget.referenceEditionId}</span>
                <strong className={getBalanceToneClass(totals.balance.referenceActual)}>{formatCurrency(totals.balance.referenceActual)}</strong>
                <small>Réalisé de comparaison</small>
              </article>
            ) : null}
            <article className="budget-summary-card budget-summary-card--balance">
              <span className="budget-summary-card__label">Équilibre {draftBudget.currentEditionId}</span>
              <strong className={getBalanceToneClass(totals.balance.currentActual)}>{formatCurrency(totals.balance.currentActual)}</strong>
              <small>{formatCurrency(totals.balance.currentForecast)} prévisionnel</small>
              <span className={getVarianceToneClass(computeVariance(totals.balance.currentForecast, totals.balance.currentActual), "balance")}>
                {formatVariance(computeVariance(totals.balance.currentForecast, totals.balance.currentActual))}
              </span>
            </article>
        </section>
      ) : null}

      <div className="admin-subtabs" role="tablist" aria-label="Navigation du budget">
        {[
          ["overview", primaryTabLabel],
          ["expenses", "Dépenses"],
          ["revenues", "Recettes"],
          ...(canManageInvoicePanel || selectedEditionInvoices.length ? [["invoices", "Factures"]] : []),
          ["simplified", "Simplifiée"],
          ["history", "Historique"],
        ].map(([tabId, label]) => (
          <button
            key={tabId}
            className={`admin-subtab ${activeTab === tabId ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveTab(tabId)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && canEditBudget ? (
        <p className="panel-note budget-reorder-note">
          Pour déplacer les lignes, ouvre l&apos;onglet Dépenses ou Recettes puis utilise le bouton "Depl." au bout de la ligne.
        </p>
      ) : null}

      {activeTab === "overview" ? (
        <div className="budget-sheet-stack">
          <section className="budget-sheet-group">
            <div className="budget-sheet-group__header">
              <div>
                <h3>Dépenses</h3>
                <p>{isBudgetLocked ? `Budget ${draftBudget.currentEditionId} — prévisionnel et définitif.` : `Budget ${draftBudget.currentEditionId} — prévisionnel et réalisé.`}</p>
              </div>
            </div>
            <BudgetOverviewTable
              collectionKey="expenses"
              sections={expenseSections}
              currentEditionId={draftBudget.currentEditionId}
              allowEditing={canEditBudget}
              actualColumnLabel={`${isBudgetLocked ? "Définitif" : "Réalisé"} ${draftBudget.currentEditionId}`}
              onValueChange={handleRowChange}
              totals={totals.expenses}
              invoicesByRowId={invoicesByBudgetRowId}
            />
          </section>

          <section className="budget-sheet-group">
            <div className="budget-sheet-group__header">
              <div>
                <h3>Recettes</h3>
                <p>{isBudgetLocked ? `Budget ${draftBudget.currentEditionId} — prévisionnel et définitif.` : `Budget ${draftBudget.currentEditionId} — prévisionnel et réalisé.`}</p>
              </div>
            </div>
            <BudgetOverviewTable
              collectionKey="revenues"
              sections={revenueSections}
              currentEditionId={draftBudget.currentEditionId}
              allowEditing={canEditBudget}
              actualColumnLabel={`${isBudgetLocked ? "Définitif" : "Réalisé"} ${draftBudget.currentEditionId}`}
              onValueChange={handleRowChange}
              totals={totals.revenues}
              invoicesByRowId={invoicesByBudgetRowId}
            />
          </section>
        </div>
      ) : null}

      {activeTab === "expenses" ? (
        <BudgetLineTable
          side="expense"
          collectionKey="expenses"
          sections={expenseSections}
          referenceEditionId={draftBudget.referenceEditionId}
          currentEditionId={draftBudget.currentEditionId}
          hasComparison={hasComparison}
          isEditable={canEditBudget}
          newSectionName={sectionDrafts.expenses}
          onValueChange={handleRowChange}
          onAddRow={handleAddRow}
          onDeleteRow={handleDeleteRow}
          onNewSectionNameChange={handleNewSectionNameChange}
          onAddSection={handleAddSection}
          dragState={dragState}
          dragOverRowId={dragOverRowId}
          onRowDragStart={handleRowDragStart}
          onRowDragOver={handleRowDragOver}
          onRowDrop={handleRowDrop}
          onRowDragEnd={handleRowDragEnd}
          totals={totals.expenses}
          invoicesByRowId={invoicesByBudgetRowId}
          canManageInvoices={canManageInvoicePanel}
          onUnlinkInvoice={handleUnlinkInvoice}
        />
      ) : null}

      {activeTab === "revenues" ? (
        <BudgetLineTable
          side="revenue"
          collectionKey="revenues"
          sections={revenueSections}
          referenceEditionId={draftBudget.referenceEditionId}
          currentEditionId={draftBudget.currentEditionId}
          hasComparison={hasComparison}
          isEditable={canEditBudget}
          newSectionName={sectionDrafts.revenues}
          onValueChange={handleRowChange}
          onAddRow={handleAddRow}
          onDeleteRow={handleDeleteRow}
          onNewSectionNameChange={handleNewSectionNameChange}
          onAddSection={handleAddSection}
          dragState={dragState}
          dragOverRowId={dragOverRowId}
          onRowDragStart={handleRowDragStart}
          onRowDragOver={handleRowDragOver}
          onRowDrop={handleRowDrop}
          onRowDragEnd={handleRowDragEnd}
          totals={totals.revenues}
          invoicesByRowId={invoicesByBudgetRowId}
          canManageInvoices={canManageInvoicePanel}
          onUnlinkInvoice={handleUnlinkInvoice}
        />
      ) : null}

      {activeTab === "invoices" ? (
        <section className="panel-grid panel-grid--2 budget-invoice-panels">
          {canManageInvoicePanel ? (
            <Panel
              title="Déposer une facture"
              subtitle="Dépose une facture dans ce module dédié. Le classement se fait ensuite séparément."
            >
              <InvoiceUploadForm
                editionId={draftBudget.currentEditionId}
                currentUser={currentUser}
                userProfile={userProfile}
                assignedTeams={Array.isArray(userProfile?.assignedTeams) ? userProfile.assignedTeams : []}
              />
            </Panel>
          ) : null}

          {canManageInvoicePanel ? (
          <Panel
            title="Classer une facture"
            subtitle="Choisis d'abord la facture par son titre, puis la ligne budgétaire de dépense à laquelle la rattacher."
          >
            {!unclassifiedInvoices.length ? (
              <p className="panel-note">Aucune facture en attente de classement pour cette édition.</p>
            ) : (
              <div className="section-stack">
                <div className="field">
                  <span>Facture</span>
                  <select value={selectedInvoiceId} onChange={(event) => setSelectedInvoiceId(event.target.value)}>
                    {unclassifiedInvoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.title || invoice.fileName || "Facture"}{invoice.uploadedByName ? ` · ${invoice.uploadedByName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <span>Ligne budgétaire</span>
                  <select
                    value={selectedInvoiceTargetRowId}
                    onChange={(event) => setSelectedInvoiceTargetRowId(event.target.value)}
                  >
                    <option value="">Choisir une ligne de dépense</option>
                    {expenseTargetOptions.map((target) => (
                      <option key={`selected-invoice-${target.value}`} value={target.value}>
                        {target.rowLabel} · {target.sectionName}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedInvoiceForClassification ? (
                  <div className="budget-invoice-admin-cell">
                    <strong>{selectedInvoiceForClassification.title || selectedInvoiceForClassification.fileName || "Facture"}</strong>
                    <span>{selectedInvoiceForClassification.invoiceNote || "Aucune note renseignée."}</span>
                    {selectedInvoiceForClassification.resolvedUrl ? (
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => window.open(selectedInvoiceForClassification.resolvedUrl, "_blank", "noopener,noreferrer")}
                      >
                        Ouvrir la facture
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="table-actions table-actions--inline">
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={!selectedInvoiceId || !selectedInvoiceTargetRowId}
                    onClick={() => handleLinkInvoice(selectedInvoiceId, selectedInvoiceTargetRowId)}
                  >
                    Classer la facture
                  </button>
                </div>
              </div>
            )}
          </Panel>
          ) : null}

          {selectedEditionInvoices.length ? (
            <Panel
              title="Factures de l'édition"
              subtitle="Vue d'ensemble des factures déposées pour cette édition, classées ou encore en attente."
            >
              <div className="table-wrap">
                <table className="data-table data-table--admin">
                  <thead>
                    <tr>
                      <th>Facture</th>
                      <th>Déposée par</th>
                      <th>Statut</th>
                      <th>Ligne liée</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEditionInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.title || invoice.fileName || "Facture"}</td>
                        <td>{invoice.uploadedByName || "Utilisateur"}</td>
                        <td>{formatInvoiceStatusLabel(invoice)}</td>
                        <td>{invoice.linkedBudgetRowLabel || "—"}</td>
                        <td>
                          <div className="table-actions table-actions--inline">
                            {invoice.resolvedUrl ? (
                              <button
                                className="button button--secondary"
                                type="button"
                                onClick={() => window.open(invoice.resolvedUrl, "_blank", "noopener,noreferrer")}
                              >
                                Ouvrir
                              </button>
                            ) : null}
                            {invoice.linkedBudgetRowId && canManageInvoicePanel ? (
                              <button
                                className="button button--ghost-danger"
                                type="button"
                                onClick={() => handleUnlinkInvoice(invoice)}
                              >
                                Délier
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </section>
      ) : null}

      {activeTab === "simplified" ? (
        <div className="budget-simplified-layout">
          <Panel
            title="Réglages de la vue simplifiée"
            subtitle="Choisissez les gros blocs à afficher, puis le niveau de lecture souhaité."
          >
            <div className="budget-simplified-controls">
              <label className="field budget-simplified-controls__field">
                <span>Afficher</span>
                <select value={simplifiedDisplayMode} onChange={(event) => setSimplifiedDisplayMode(event.target.value)}>
                  <option value="forecast">Prévisionnel</option>
                  <option value="actual">Réalisé</option>
                  <option value="both">Les deux</option>
                </select>
              </label>
              <label className="budget-simplified-toggle">
                <input
                  type="checkbox"
                  checked={simplifiedShowDetails}
                  onChange={(event) => setSimplifiedShowDetails(event.target.checked)}
                />
                <span>Afficher le détail des lignes</span>
              </label>
            </div>
          </Panel>

          <div className="budget-overview-grid">
            <SimplifiedBudgetTable
              Panel={Panel}
              title="Version simplifiée — dépenses"
              subtitle="Agrégats calculés automatiquement à partir du budget détaillé."
              side="expense"
              rows={simplifiedExpenseRows}
              selectedMap={simplifiedSelections.expenses}
              detailSelections={simplifiedDetailSelections.expenses}
              displayMode={simplifiedDisplayMode}
              showDetails={simplifiedShowDetails}
              onToggleRow={(rowId) => handleToggleSimplifiedRow("expenses", rowId)}
              onToggleDetailRow={(rowId, itemId) => handleToggleSimplifiedDetailRow("expenses", rowId, itemId)}
              referenceEditionId={draftBudget.referenceEditionId}
              currentEditionId={draftBudget.currentEditionId}
              hasComparison={hasComparison}
            />
            <SimplifiedBudgetTable
              Panel={Panel}
              title="Version simplifiée — recettes"
              subtitle="Même logique, côté recettes, pour lire rapidement l'équilibre."
              side="revenue"
              rows={simplifiedRevenueRows}
              selectedMap={simplifiedSelections.revenues}
              detailSelections={simplifiedDetailSelections.revenues}
              displayMode={simplifiedDisplayMode}
              showDetails={simplifiedShowDetails}
              onToggleRow={(rowId) => handleToggleSimplifiedRow("revenues", rowId)}
              onToggleDetailRow={(rowId, itemId) => handleToggleSimplifiedDetailRow("revenues", rowId, itemId)}
              referenceEditionId={draftBudget.referenceEditionId}
              currentEditionId={draftBudget.currentEditionId}
              hasComparison={hasComparison}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "history" ? (
        <Panel
          title="Historique des modifications"
          subtitle="Chaque enregistrement garde une trace des changements budgétaires."
        >
          {historyLoading ? (
            <p>Chargement de l'historique…</p>
          ) : historyError ? (
            <p className="form-error">{historyError}</p>
          ) : historyEntries.length === 0 ? (
            <p>Aucune sauvegarde n'a encore été enregistrée pour cette édition.</p>
          ) : (
            <div className="budget-history-list">
              {historyEntries.map((entry) => (
                <article className="budget-history-entry" key={entry.id}>
                  <div className="budget-history-entry__header">
                    <div>
                      <strong>{entry.summary || "Modification budgétaire"}</strong>
                      <p>{formatDateTime(entry.createdAt)} • {entry.actorName || "Admin"}</p>
                    </div>
                    <span className="status-pill">{entry.changeCount} changement(s)</span>
                  </div>
                  {entry.changes.length ? (
                    <div className="budget-history-entry__changes">
                      {entry.changes.slice(0, 8).map((change, index) => (
                        <div className="budget-history-change" key={`${entry.id}-${change.rowId}-${change.field}-${index}`}>
                          <strong>{change.rowLabel}</strong>
                          <span>{historyFieldLabels[change.field] || change.field}</span>
                          <small>
                            {formatHistoryValue(change.before)} → {formatHistoryValue(change.after)}
                          </small>
                        </div>
                      ))}
                      {entry.changes.length > 8 ? (
                        <p className="panel-note">+ {entry.changes.length - 8} autre(s) changement(s) enregistrés.</p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

export { BudgetTrackingPage };
