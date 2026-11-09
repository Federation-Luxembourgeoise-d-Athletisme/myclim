import { Fragment, useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { db, storage } from "../services/firebase";
import { useAuth } from "../context/auth-context";
import meetingLogoUrl from "../assets/cmcm-logo.png";
import sponsorsStripUrl from "../assets/accreditation-sponsors-strip.png";
import { useBudgetInvoiceConfiguration } from "./config-hooks";
import { useDocumentsCollection } from "./documents-hooks";
import { useActiveEdition } from "./edition";
import { canUserUploadBudgetInvoice } from "./budget-invoice-config";
import { useComLang } from "./communication/com-i18n";
import {
  BudgetLinePicker,
  buildBudgetExpenseTargetOptions,
  INVOICE_CONTACT,
  InvoiceInlineList,
  InvoiceMailDialog,
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

const roundedCurrencyFormatter = new Intl.NumberFormat("fr-LU", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

// La vue d'ensemble arrondit à l'euro pour que les deux tableaux tiennent côte à côte.
function formatRoundedCurrency(value) {
  if (value == null) return "—";
  return roundedCurrencyFormatter.format(value);
}

function formatRoundedVariance(value) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatRoundedCurrency(value)}`;
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

const MEET_DIRECTOR_HINT =
  "Calculé automatiquement : 10 % de Frais déplacement + Engagement + Prize money + Primes performance exceptionnelle + Extra apparence fee.";

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
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

  if (row.isComputedLocked) {
    return (
      <span className="budget-cell-value budget-cell-value--locked" title={MEET_DIRECTOR_HINT}>
        {formatCurrency(row[fieldName])}
      </span>
    );
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

function computeEvolutionPercent(referenceValue, currentValue) {
  if (currentValue == null || !referenceValue) return null;
  return ((currentValue - referenceValue) / Math.abs(referenceValue)) * 100;
}

function formatPercent(value) {
  if (value == null) return "";
  const rounded = Math.abs(value) < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  const sign = rounded > 0 ? "+" : (rounded < 0 ? "−" : "");
  return `${sign}${Math.abs(rounded).toLocaleString("fr-LU")} %`;
}

function getEvolutionToneClass(value, side) {
  // Sous 1 % on reste neutre : l'écart n'est pas significatif.
  return getVarianceToneClass(value == null || Math.abs(value) < 1 ? 0 : value, side);
}

function hasBudgetValue(value) {
  return toBudgetNumber(value) != null;
}

function buildOverviewBlocs(sections) {
  return sections.map(({ sectionName, rows }) => ({
    sectionName,
    rows: rows.filter((row) => hasBudgetValue(row.referenceActual) || hasBudgetValue(row.currentForecast) || hasBudgetValue(row.currentActual)),
    referenceActual: sumBudgetRowsField(rows, "referenceActual"),
    currentForecast: sumBudgetRowsField(rows, "currentForecast"),
    currentActual: sumBudgetRowsField(rows, "currentActual", { emptyAsNull: true }),
  }));
}

function buildAttentionPoints({ expenseBlocs, revenueBlocs, referenceEditionId, comparisonField }) {
  // On ne remonte que les blocs dont l'évolution est à la fois forte en % et significative en euros.
  return [
    ...expenseBlocs.map((bloc) => ({ ...bloc, side: "expense" })),
    ...revenueBlocs.map((bloc) => ({ ...bloc, side: "revenue" })),
  ]
    .map((bloc) => ({
      ...bloc,
      compared: bloc[comparisonField] ?? 0,
      delta: (bloc[comparisonField] ?? 0) - bloc.referenceActual,
      evolution: computeEvolutionPercent(bloc.referenceActual, bloc[comparisonField]),
    }))
    .filter((bloc) => bloc.evolution != null && Math.abs(bloc.evolution) >= 20 && Math.abs(bloc.delta) >= 2000)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 4)
    .map((bloc) => ({
      id: `${bloc.side}-${bloc.sectionName}`,
      tone: (bloc.side === "expense") === (bloc.delta > 0) ? "warn" : "info",
      title: `${bloc.side === "expense" ? "Dépenses" : "Recettes"} · ${bloc.sectionName} : ${formatPercent(bloc.evolution)}`,
      text: `${formatRoundedCurrency(bloc.compared)} ${comparisonField === "currentActual" ? "définitifs" : "prévus"} contre ${formatRoundedCurrency(bloc.referenceActual)} réalisés en ${referenceEditionId}.`,
    }));
}

function BudgetOverviewSide({
  title,
  side,
  blocs,
  totals,
  openSections,
  onToggleSection,
  hasComparison,
  referenceEditionId,
  currentEditionId,
  actualShortLabel,
  showActual,
  comparisonField,
}) {
  const lineCount = blocs.reduce((sum, bloc) => sum + bloc.rows.length, 0);
  const gridClassName = `budget-overview-board__grid${hasComparison ? " budget-overview-board__grid--compare" : ""}`;
  const amountColumnCount = 1 + (hasComparison ? 1 : 0) + (showActual ? 1 : 0);
  // Sur téléphone, la colonne de l'année de comparaison est masquée (le % reste affiché).
  const gridStyle = {
    "--budget-amount-columns": amountColumnCount,
    "--budget-amount-columns-mobile": amountColumnCount - (hasComparison ? 1 : 0),
  };

  function renderTrend(referenceValue, forecastValue, actualValue, { isLine = false } = {}) {
    if (hasComparison) {
      const comparedValue = comparisonField === "currentActual" ? actualValue : forecastValue;
      if (isLine && !toBudgetNumber(referenceValue) && toBudgetNumber(comparedValue)) {
        return <span className="budget-overview-board__trend budget-overview-board__trend--new">nouveau</span>;
      }
      const evolution = computeEvolutionPercent(toBudgetNumber(referenceValue), toBudgetNumber(comparedValue));
      return <span className={`budget-overview-board__trend ${getEvolutionToneClass(evolution, side)}`}>{formatPercent(evolution)}</span>;
    }

    const variance = computeVariance(toBudgetNumber(forecastValue), toBudgetNumber(actualValue));
    return <span className={`budget-overview-board__trend ${getVarianceToneClass(variance, side)}`}>{variance == null ? "" : formatRoundedVariance(variance)}</span>;
  }

  function getActualClassName(forecastValue, actualValue) {
    const forecast = toBudgetNumber(forecastValue);
    const actual = toBudgetNumber(actualValue);
    const isOverrun = side === "expense" && actual != null && forecast != null && actual > forecast;
    return `budget-overview-board__amount${isOverrun ? " budget-overview-board__amount--alert" : ""}`;
  }

  return (
    <article className="budget-overview-board__side">
      <header className="budget-overview-board__side-header">
        <h3>{title}</h3>
        <span>{blocs.length} blocs · {lineCount} lignes</span>
      </header>
      <div className={`${gridClassName} budget-overview-board__head`} style={gridStyle}>
        <span>Bloc / poste</span>
        {hasComparison ? <span>Réal. {referenceEditionId}</span> : null}
        <span>Prévu {currentEditionId}</span>
        {showActual ? <span>{actualShortLabel} {currentEditionId}</span> : null}
        <span>{hasComparison ? `vs ${referenceEditionId}` : "Écart"}</span>
      </div>
      {blocs.map((bloc) => {
        const isOpen = Boolean(openSections[bloc.sectionName]);
        const share = totals.currentForecast ? Math.round((bloc.currentForecast / totals.currentForecast) * 100) : 0;

        return (
          <div className={`budget-overview-board__bloc${isOpen ? " budget-overview-board__bloc--open" : ""}`} key={bloc.sectionName}>
            <button
              type="button"
              className={`${gridClassName} budget-overview-board__bloc-row`}
              style={gridStyle}
              aria-expanded={isOpen}
              onClick={() => onToggleSection(bloc.sectionName)}
            >
              <span className="budget-overview-board__name">
                <span className="budget-overview-board__chevron" aria-hidden="true" />
                <span className="budget-overview-board__name-text">
                  <strong>{bloc.sectionName}</strong>
                  <small>{bloc.rows.length} ligne(s) · {share} % du total</small>
                </span>
              </span>
              {hasComparison ? <span className="budget-overview-board__amount budget-overview-board__amount--muted">{formatRoundedCurrency(bloc.referenceActual)}</span> : null}
              <span className="budget-overview-board__amount budget-overview-board__amount--strong">{formatRoundedCurrency(bloc.currentForecast)}</span>
              {showActual ? <span className={getActualClassName(bloc.currentForecast, bloc.currentActual)}>{formatRoundedCurrency(bloc.currentActual)}</span> : null}
              {renderTrend(bloc.referenceActual, bloc.currentForecast, bloc.currentActual)}
            </button>
            {isOpen ? (
              <div className="budget-overview-board__lines">
                {bloc.rows.map((row) => (
                  <div className={`${gridClassName} budget-overview-board__line`} style={gridStyle} key={row.id}>
                    <span className="budget-overview-board__line-label" title={row.details ? `${row.label} — ${row.details}` : row.label}>
                      {row.label || "Sans libellé"}
                      {row.details ? <small>{row.details}</small> : null}
                    </span>
                    {hasComparison ? <span className="budget-overview-board__amount budget-overview-board__amount--muted">{formatRoundedCurrency(toBudgetNumber(row.referenceActual))}</span> : null}
                    <span className="budget-overview-board__amount">{formatRoundedCurrency(toBudgetNumber(row.currentForecast))}</span>
                    {showActual ? <span className={getActualClassName(row.currentForecast, row.currentActual)}>{formatRoundedCurrency(toBudgetNumber(row.currentActual))}</span> : null}
                    {renderTrend(row.referenceActual, row.currentForecast, row.currentActual, { isLine: true })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className={`${gridClassName} budget-overview-board__total`} style={gridStyle}>
        <span>Total {title.toLowerCase()}</span>
        {hasComparison ? <span className="budget-overview-board__amount">{formatRoundedCurrency(totals.referenceActual)}</span> : null}
        <span className="budget-overview-board__amount">{formatRoundedCurrency(totals.currentForecast)}</span>
        {showActual ? <span className="budget-overview-board__amount">{formatRoundedCurrency(totals.currentActual)}</span> : null}
        {renderTrend(totals.referenceActual, totals.currentForecast, totals.currentActual)}
      </div>
    </article>
  );
}

function BudgetOverview({
  budget,
  totals,
  expenseSections,
  revenueSections,
  hasComparison,
  isBudgetLocked,
  hasCurrentActualValues,
  unclassifiedInvoiceCount,
  showInvoiceCard,
  onOpenInvoices,
}) {
  const [openSections, setOpenSections] = useState({ expenses: {}, revenues: {} });
  const expenseBlocs = useMemo(() => buildOverviewBlocs(expenseSections), [expenseSections]);
  const revenueBlocs = useMemo(() => buildOverviewBlocs(revenueSections), [revenueSections]);
  const referenceEditionId = budget.referenceEditionId;
  const currentEditionId = budget.currentEditionId;
  const actualLabel = isBudgetLocked ? "Définitif" : "Réalisé";
  const actualShortLabel = isBudgetLocked ? "Déf." : "Réal.";
  // Tant qu'aucun réalisé n'est saisi, la colonne ne contiendrait que des tirets : on la masque.
  const showActualColumn = isBudgetLocked || hasCurrentActualValues;
  // Un budget définitif se compare sur ses montants définitifs, sinon on compare le prévisionnel.
  const comparisonField = isBudgetLocked ? "currentActual" : "currentForecast";
  // Tant qu'aucun réalisé n'est saisi, les chiffres clés montrent le prévisionnel.
  const summaryField = !isBudgetLocked && !hasCurrentActualValues ? "currentForecast" : "currentActual";
  const summaryLabel = summaryField === "currentForecast" ? "prévues" : (isBudgetLocked ? "définitives" : "réalisées");
  const allSectionCount = expenseBlocs.length + revenueBlocs.length;
  const openSectionCount = Object.values(openSections.expenses).filter(Boolean).length
    + Object.values(openSections.revenues).filter(Boolean).length;
  const isAllOpen = allSectionCount > 0 && openSectionCount === allSectionCount;
  const attentionPoints = hasComparison
    ? buildAttentionPoints({ expenseBlocs, revenueBlocs, referenceEditionId, comparisonField })
    : [];

  function toggleSection(collectionKey, sectionName) {
    setOpenSections((current) => ({
      ...current,
      [collectionKey]: { ...current[collectionKey], [sectionName]: !current[collectionKey][sectionName] },
    }));
  }

  function toggleAllSections() {
    if (isAllOpen) {
      setOpenSections({ expenses: {}, revenues: {} });
      return;
    }

    setOpenSections({
      expenses: Object.fromEntries(expenseBlocs.map((bloc) => [bloc.sectionName, true])),
      revenues: Object.fromEntries(revenueBlocs.map((bloc) => [bloc.sectionName, true])),
    });
  }

  function renderComparisonNote(collectionKey, positiveIsGood) {
    if (summaryField === "currentForecast") {
      if (!hasComparison) return null;
      const evolution = computeEvolutionPercent(totals[collectionKey].referenceActual, totals[collectionKey].currentForecast);
      return (
        <small>
          <span className={getEvolutionToneClass(evolution, positiveIsGood ? "revenue" : "expense")}>{formatPercent(evolution)}</span>
          {" "}vs réalisé {referenceEditionId} ({formatRoundedCurrency(totals[collectionKey].referenceActual)})
        </small>
      );
    }

    return <small>{formatRoundedCurrency(totals[collectionKey].currentForecast)} prévus</small>;
  }

  return (
    <div className="budget-overview">
      <section className="budget-kpis" aria-label="Chiffres clés">
        <article className="budget-kpi">
          <span className="budget-kpi__label">Dépenses {summaryLabel}</span>
          <strong className="budget-kpi__value">{formatRoundedCurrency(totals.expenses[summaryField])}</strong>
          {renderComparisonNote("expenses", false)}
        </article>
        <article className="budget-kpi">
          <span className="budget-kpi__label">Recettes {summaryLabel}</span>
          <strong className="budget-kpi__value">{formatRoundedCurrency(totals.revenues[summaryField])}</strong>
          {renderComparisonNote("revenues", true)}
        </article>
        <article className="budget-kpi budget-kpi--highlight">
          <span className="budget-kpi__label">Résultat {summaryField === "currentForecast" ? "prévu" : (isBudgetLocked ? "définitif" : "réalisé")}</span>
          <strong className="budget-kpi__value">{formatRoundedVariance(totals.balance[summaryField])}</strong>
          {hasComparison ? <small>Réalisé {referenceEditionId} : {formatRoundedVariance(totals.balance.referenceActual)}</small> : null}
        </article>
        {showInvoiceCard ? (
          <button
            type="button"
            className={`budget-kpi budget-kpi--action${unclassifiedInvoiceCount ? " budget-kpi--warn" : ""}`}
            onClick={onOpenInvoices}
          >
            <span className="budget-kpi__label">Factures à classer</span>
            <strong className="budget-kpi__value">{unclassifiedInvoiceCount}</strong>
            <small>{unclassifiedInvoiceCount ? "Classer maintenant →" : "Tout est classé"}</small>
          </button>
        ) : null}
      </section>

      <section className="budget-overview-board" aria-label="Dépenses et recettes">
        <div className="budget-overview-board__toolbar">
          <h2>Dépenses et recettes</h2>
          <div className="budget-overview-board__toolbar-actions">
            <span>Clique sur un bloc pour voir ses lignes</span>
            <button type="button" className="button button--secondary" onClick={toggleAllSections}>
              {isAllOpen ? "Tout replier" : "Tout déplier"}
            </button>
          </div>
        </div>
        <div className="budget-overview-board__sides">
          <BudgetOverviewSide
            title="Dépenses"
            side="expense"
            blocs={expenseBlocs}
            totals={totals.expenses}
            openSections={openSections.expenses}
            onToggleSection={(sectionName) => toggleSection("expenses", sectionName)}
            hasComparison={hasComparison}
            referenceEditionId={referenceEditionId}
            currentEditionId={currentEditionId}
            actualShortLabel={actualShortLabel}
            showActual={showActualColumn}
            comparisonField={comparisonField}
          />
          <BudgetOverviewSide
            title="Recettes"
            side="revenue"
            blocs={revenueBlocs}
            totals={totals.revenues}
            openSections={openSections.revenues}
            onToggleSection={(sectionName) => toggleSection("revenues", sectionName)}
            hasComparison={hasComparison}
            referenceEditionId={referenceEditionId}
            currentEditionId={currentEditionId}
            actualShortLabel={actualShortLabel}
            showActual={showActualColumn}
            comparisonField={comparisonField}
          />
        </div>
        <div className="budget-overview-board__result">
          <strong>Résultat (recettes − dépenses)</strong>
          {hasComparison ? (
            <span>
              <small>Réalisé {referenceEditionId}</small>
              <b>{formatRoundedVariance(totals.balance.referenceActual)}</b>
            </span>
          ) : null}
          <span>
            <small>Prévu {currentEditionId}</small>
            <b>{formatRoundedVariance(totals.balance.currentForecast)}</b>
          </span>
          <span>
            <small>{actualLabel} {currentEditionId}</small>
            <b>{hasCurrentActualValues ? formatRoundedVariance(totals.balance.currentActual) : "—"}</b>
          </span>
        </div>
      </section>

      {attentionPoints.length || (!isBudgetLocked && !hasCurrentActualValues) ? (
        <section className="budget-attention">
          <h2>Points d&apos;attention</h2>
          <ul>
            {attentionPoints.map((point) => (
              <li className={`budget-attention__item budget-attention__item--${point.tone}`} key={point.id}>
                <strong>{point.title}</strong>
                <span>{point.text}</span>
              </li>
            ))}
            {!isBudgetLocked && !hasCurrentActualValues ? (
              <li className="budget-attention__item">
                <strong>Réalisé {currentEditionId} pas encore saisi</strong>
                <span>La colonne se remplit à mesure que les montants réalisés sont saisis dans les lignes budgétaires.</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const LINE_FILTERS = [
  { id: "gap", label: "Écart > 10 %" },
  { id: "comment", label: "Avec commentaire" },
  { id: "noInvoice", label: "Sans facture", side: "expense" },
];

function getRowGapPercent(row, hasComparison) {
  const forecast = toBudgetNumber(row.currentForecast);
  const actual = toBudgetNumber(row.currentActual);
  if (actual != null && forecast) return ((actual - forecast) / Math.abs(forecast)) * 100;
  if (!hasComparison) return null;
  return computeEvolutionPercent(toBudgetNumber(row.referenceActual), forecast);
}

function matchesLineSearch(row, sectionName, words) {
  if (!words.length) return true;
  const haystack = normalizeLineSearchText([row.label, row.details, row.comment, row.actualReference, sectionName].join(" "));
  return words.every((word) => haystack.includes(word));
}

function normalizeLineSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7L14 5.5a3.5 3.5 0 015 5L10.5 19a2 2 0 01-3-3l8-8" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5h16v11H8l-4 4V5z" />
    </svg>
  );
}

function BudgetLineDrawer({
  row,
  side,
  collectionKey,
  sectionNames,
  referenceEditionId,
  currentEditionId,
  hasComparison,
  actualLabel,
  isEditable,
  canStartEditing,
  onStartEditing,
  onValueChange,
  onDeleteRow,
  invoices,
  canManageInvoices,
  onUnlinkInvoice,
  rowHistory,
  onClose,
}) {
  const evolution = hasComparison
    ? computeEvolutionPercent(toBudgetNumber(row.referenceActual), toBudgetNumber(row.currentForecast))
    : null;
  const variance = computeVariance(toBudgetNumber(row.currentForecast), toBudgetNumber(row.currentActual));

  function renderTextField(fieldName, label, { multiline = false, placeholder = "" } = {}) {
    if (!isEditable) {
      return (
        <div className="budget-drawer__field">
          <span>{label}</span>
          <p className="budget-drawer__value">{row[fieldName] || "—"}</p>
        </div>
      );
    }

    const commonProps = {
      value: row[fieldName] || "",
      placeholder,
      onChange: (event) => onValueChange(collectionKey, row.id, fieldName, event.target.value),
    };

    return (
      <label className="field budget-drawer__field">
        <span>{label}</span>
        {multiline ? <textarea rows={3} {...commonProps} /> : <input type="text" {...commonProps} />}
      </label>
    );
  }

  return (
    <aside className="budget-drawer" aria-label={`Détail de la ligne ${row.label || ""}`}>
      <header className="budget-drawer__header">
        <div>
          <p className="budget-drawer__eyebrow">
            {side === "expense" ? "Dépenses" : "Recettes"} · {row.section} · ligne {row.rowNumber}
          </p>
          <h2>{row.label || "Sans libellé"}</h2>
        </div>
        <button type="button" className="budget-drawer__close" onClick={onClose} aria-label="Fermer le détail">
          ×
        </button>
      </header>

      <div className="budget-drawer__amounts">
        <div className="budget-drawer__field">
          <span>Prévu {currentEditionId}</span>
          <BudgetAmountField row={row} fieldName="currentForecast" onValueChange={onValueChange} collectionKey={collectionKey} isEditable={isEditable} />
        </div>
        <div className="budget-drawer__field">
          <span>{actualLabel} {currentEditionId}</span>
          <BudgetAmountField row={row} fieldName="currentActual" onValueChange={onValueChange} collectionKey={collectionKey} isEditable={isEditable} />
        </div>
      </div>

      <p className="budget-drawer__summary">
        {hasComparison ? (
          <>
            Réalisé {referenceEditionId} : <strong>{formatCurrency(toBudgetNumber(row.referenceActual))}</strong>
            {evolution != null ? (
              <> · évolution <strong className={getEvolutionToneClass(evolution, side)}>{formatPercent(evolution)}</strong></>
            ) : null}
          </>
        ) : null}
        {variance != null ? (
          <>
            {hasComparison ? <br /> : null}
            Écart réalisé / prévu : <strong className={getVarianceToneClass(variance, side)}>{formatVariance(variance)}</strong>
          </>
        ) : null}
        {!hasComparison && variance == null ? "Aucun réalisé saisi pour cette ligne." : null}
      </p>

      {row.isComputedLocked && (isEditable || canStartEditing) ? (
        <p className="budget-drawer__locked-note">
          <LockIcon /> {MEET_DIRECTOR_HINT} Ligne verrouillée : modifie les lignes liées pour la faire évoluer.
        </p>
      ) : null}

      {isEditable && !row.isComputedLocked ? renderTextField("label", "Libellé") : null}
      {renderTextField("details", "Détail", { multiline: true, placeholder: "Fournisseur, devis, quantités…" })}
      {renderTextField("actualReference", "Facture / repère", { placeholder: "N° de facture, note…" })}
      {renderTextField("comment", "Commentaire", { multiline: true })}

      {isEditable && !row.isComputedLocked && sectionNames.length > 1 ? (
        <label className="field budget-drawer__field">
          <span>Bloc</span>
          <select value={row.section} onChange={(event) => onValueChange(collectionKey, row.id, "section", event.target.value)}>
            {sectionNames.map((sectionName) => (
              <option key={sectionName} value={sectionName}>{sectionName}</option>
            ))}
          </select>
        </label>
      ) : null}

      {side === "expense" ? (
        <div className="budget-drawer__field">
          <span>Factures liées</span>
          {invoices.length ? (
            <InvoiceInlineList invoices={invoices} canManage={canManageInvoices} onDetach={onUnlinkInvoice} />
          ) : (
            <p className="budget-drawer__value budget-drawer__value--muted">Aucune facture liée. Elles se rangent depuis l&apos;onglet Factures.</p>
          )}
        </div>
      ) : null}

      {rowHistory.length ? (
        <div className="budget-drawer__field">
          <span>Dernières modifications</span>
          <ul className="budget-drawer__history">
            {rowHistory.map((change) => (
              <li key={change.key}>
                <strong>{change.fieldLabel}</strong> : {formatHistoryValue(change.before)} → {formatHistoryValue(change.after)}
                <small>{change.actorName} · {formatDateTime(change.createdAt)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="budget-drawer__footer">
        {isEditable && row.isComputedLocked ? null : isEditable ? (
          <button
            type="button"
            className="button button--ghost-danger"
            onClick={() => {
              if (window.confirm(`Supprimer la ligne « ${row.label || "Sans libellé"} » ? Elle disparaîtra à l'enregistrement.`)) {
                onDeleteRow(collectionKey, row.id);
                onClose();
              }
            }}
          >
            Supprimer la ligne
          </button>
        ) : canStartEditing ? (
          <button type="button" className="button button--secondary" onClick={onStartEditing}>
            Modifier cette ligne
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

function BudgetLinesWorkspace({
  side,
  collectionKey,
  sections,
  referenceEditionId,
  currentEditionId,
  hasComparison,
  isBudgetLocked,
  showActualColumn,
  isEditable,
  canStartEditing,
  onStartEditing,
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
  historyEntries,
}) {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({});
  const [selectedRowId, setSelectedRowId] = useState("");
  const actualLabel = isBudgetLocked ? "Définitif" : "Réalisé";
  const showActual = showActualColumn || isEditable;
  const availableFilters = LINE_FILTERS.filter((filter) => !filter.side || filter.side === side);
  const searchWords = normalizeLineSearchText(search).split(/\s+/).filter(Boolean);
  const isFiltering = searchWords.length > 0 || Object.values(activeFilters).some(Boolean);
  const allRows = sections.flatMap((section) => section.rows);
  const selectedRow = allRows.find((row) => row.id === selectedRowId) ?? null;
  const columnCount = 4 + (hasComparison ? 2 : 0) + (showActual ? 2 : 0) + (isEditable ? 1 : 0);

  useEffect(() => {
    if (!selectedRowId) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") setSelectedRowId("");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRowId]);

  const visibleSections = sections
    .map((section) => ({
      ...section,
      visibleRows: section.rows.filter((row) => {
        if (!matchesLineSearch(row, section.sectionName, searchWords)) return false;
        if (activeFilters.gap) {
          const gap = getRowGapPercent(row, hasComparison);
          if (gap == null || Math.abs(gap) < 10) return false;
        }
        if (activeFilters.comment && !String(row.comment || "").trim()) return false;
        if (activeFilters.noInvoice) {
          const hasAmount = Boolean(toBudgetNumber(row.currentForecast) || toBudgetNumber(row.currentActual));
          if (!hasAmount || (invoicesByRowId[row.id] || []).length) return false;
        }
        return true;
      }),
    }))
    .filter((section) => !isFiltering || section.visibleRows.length);
  const visibleRowCount = visibleSections.reduce((sum, section) => sum + section.visibleRows.length, 0);

  const rowHistory = useMemo(() => {
    if (!selectedRowId) return [];
    return historyEntries
      .flatMap((entry) =>
        entry.changes
          .filter((change) => change.rowId === selectedRowId)
          .map((change, index) => ({
            key: `${entry.id}-${change.field}-${index}`,
            fieldLabel: historyFieldLabels[change.field] || change.field,
            before: change.before,
            after: change.after,
            actorName: entry.actorName || "Admin",
            createdAt: entry.createdAt,
          })),
      )
      .slice(0, 3);
  }, [historyEntries, selectedRowId]);

  function toggleFilter(filterId) {
    setActiveFilters((current) => ({ ...current, [filterId]: !current[filterId] }));
  }

  function toggleSection(sectionName) {
    setCollapsedSections((current) => ({ ...current, [sectionName]: !current[sectionName] }));
  }

  function renderTrend(row) {
    if (!hasComparison) return null;
    if (!toBudgetNumber(row.referenceActual) && toBudgetNumber(row.currentForecast)) {
      return <span className="budget-overview-board__trend--new">nouveau</span>;
    }
    const evolution = computeEvolutionPercent(toBudgetNumber(row.referenceActual), toBudgetNumber(row.currentForecast));
    return <span className={getEvolutionToneClass(evolution, side)}>{formatPercent(evolution)}</span>;
  }

  function renderVariance(forecastValue, actualValue) {
    const variance = computeVariance(toBudgetNumber(forecastValue), toBudgetNumber(actualValue));
    if (variance == null) return <span className="budget-lines-table__muted">—</span>;
    return <span className={getVarianceToneClass(variance, side)}>{formatVariance(variance)}</span>;
  }

  return (
    <div className="budget-lines-workspace">
      <div className="budget-lines-toolbar">
        <div className="budget-lines-toolbar__filters">
          <label className="budget-lines-search">
            <span className="budget-visually-hidden">Rechercher une ligne</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un poste, un fournisseur…"
            />
          </label>
          {availableFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`budget-chip${activeFilters[filter.id] ? " budget-chip--active" : ""}`}
              aria-pressed={Boolean(activeFilters[filter.id])}
              onClick={() => toggleFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
          {isFiltering ? <span className="budget-lines-toolbar__count">{visibleRowCount} ligne(s)</span> : null}
        </div>
        {isEditable ? (
          <div className="budget-lines-toolbar__new-section">
            <input
              type="text"
              value={newSectionName}
              onChange={(event) => onNewSectionNameChange(collectionKey, event.target.value)}
              placeholder="Nouveau bloc"
              aria-label="Nom du nouveau bloc"
            />
            <button type="button" className="button button--secondary" onClick={() => onAddSection(collectionKey)}>
              Ajouter le bloc
            </button>
          </div>
        ) : null}
      </div>

      {isEditable ? (
        <p className="panel-note budget-lines-hint">
          Les montants se modifient directement dans le tableau ; clique sur une ligne pour son libellé, son détail et son commentaire.
          Formules possibles : <code>=SOMME(P1:P3)</code> (prévu) ou <code>=SOMME(R4:R8)</code> (réalisé).
        </p>
      ) : null}

      <div className={`budget-lines-layout${selectedRow ? " budget-lines-layout--with-drawer" : ""}`}>
        <div className="budget-lines-table-wrap">
          <table className="budget-lines-table">
            <thead>
              <tr>
                {isEditable ? <th scope="col" className="budget-lines-table__handle"><span className="budget-visually-hidden">Déplacer</span></th> : null}
                <th scope="col">Poste</th>
                {hasComparison ? <th scope="col" className="budget-lines-table__num">Réal. {referenceEditionId}</th> : null}
                <th scope="col" className="budget-lines-table__num">Prévu {currentEditionId}</th>
                {hasComparison ? <th scope="col" className="budget-lines-table__num">vs {referenceEditionId}</th> : null}
                {showActual ? <th scope="col" className="budget-lines-table__num">{actualLabel} {currentEditionId}</th> : null}
                {showActual ? <th scope="col" className="budget-lines-table__num">Écart</th> : null}
                <th scope="col" className="budget-lines-table__pieces">Pièces</th>
              </tr>
            </thead>
            {visibleSections.map((section) => {
              const isCollapsed = !isFiltering && Boolean(collapsedSections[section.sectionName]);
              const sectionForecast = sumBudgetRowsField(section.rows, "currentForecast");
              const sectionActual = sumBudgetRowsField(section.rows, "currentActual", { emptyAsNull: true });
              const sectionReference = sumBudgetRowsField(section.rows, "referenceActual");
              const sectionEvolution = computeEvolutionPercent(sectionReference, sectionForecast);

              return (
                <tbody key={section.sectionName}>
                  <tr className="budget-lines-table__section">
                    {isEditable ? <td /> : null}
                    <th scope="rowgroup">
                      <button
                        type="button"
                        className="budget-lines-table__section-toggle"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleSection(section.sectionName)}
                      >
                        <span className={`budget-overview-board__chevron${isCollapsed ? "" : " budget-lines-table__chevron--open"}`} aria-hidden="true" />
                        {section.sectionName}
                        <small>{isFiltering ? `${section.visibleRows.length} sur ${section.rows.length}` : `${section.rows.length} ligne(s)`}</small>
                      </button>
                    </th>
                    {hasComparison ? <td className="budget-lines-table__num budget-lines-table__muted">{formatCurrency(sectionReference)}</td> : null}
                    <td className="budget-lines-table__num"><strong>{formatCurrency(sectionForecast)}</strong></td>
                    {hasComparison ? (
                      <td className="budget-lines-table__num">
                        <span className={getEvolutionToneClass(sectionEvolution, side)}>{formatPercent(sectionEvolution)}</span>
                      </td>
                    ) : null}
                    {showActual ? <td className="budget-lines-table__num"><strong>{formatCurrency(sectionActual)}</strong></td> : null}
                    {showActual ? <td className="budget-lines-table__num">{renderVariance(sectionForecast, sectionActual)}</td> : null}
                    <td className="budget-lines-table__pieces">
                      {isEditable ? (
                        <button type="button" className="budget-lines-table__add" onClick={() => {
                            const newRowId = onAddRow(collectionKey, section.sectionName);
                            if (newRowId) setSelectedRowId(newRowId);
                          }}>
                          + Ligne
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isCollapsed ? null : section.visibleRows.map((row) => {
                    const rowInvoices = invoicesByRowId[row.id] || [];
                    const isSelected = row.id === selectedRowId;

                    return (
                      <tr
                        key={row.id}
                        className={[
                          "budget-lines-table__row",
                          isSelected ? "budget-lines-table__row--selected" : "",
                          dragOverRowId === row.id ? "budget-lines-table__row--drag-over" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={(event) => {
                          if (event.target.closest("input, button, a, textarea, select")) return;
                          setSelectedRowId(isSelected ? "" : row.id);
                        }}
                        onDragOver={isEditable ? (event) => onRowDragOver(event, collectionKey, row.id) : undefined}
                        onDrop={isEditable ? (event) => onRowDrop(event, collectionKey, section.sectionName, row.id) : undefined}
                      >
                        {isEditable && row.isComputedLocked ? <td className="budget-lines-table__handle" /> : null}
                        {isEditable && !row.isComputedLocked ? (
                          <td className="budget-lines-table__handle">
                            <button
                              className={`budget-drag-handle ${dragState?.rowId === row.id ? "budget-drag-handle--active" : ""}`}
                              type="button"
                              draggable
                              onDragStart={(event) => onRowDragStart(event, collectionKey, section.sectionName, row.id)}
                              onDragEnd={onRowDragEnd}
                              aria-label={`Déplacer ${row.label}`}
                              title="Glisser pour déplacer la ligne"
                            >
                              <span className="budget-drag-handle__icon" aria-hidden="true" />
                            </button>
                          </td>
                        ) : null}
                        <td className="budget-lines-table__label">
                          <button
                            type="button"
                            className="budget-lines-table__open"
                            onClick={() => setSelectedRowId(isSelected ? "" : row.id)}
                            aria-expanded={isSelected}
                          >
                            {row.label || "Sans libellé"}
                            {row.isCustom ? <span className="budget-custom-badge">Ajoutée</span> : null}
                            {row.isComputedLocked && (isEditable || canStartEditing) ? (
                              <span className="budget-custom-badge budget-locked-badge" title={MEET_DIRECTOR_HINT}>
                                <LockIcon /> 10 % auto
                              </span>
                            ) : null}
                          </button>
                          {row.details ? <small>{row.details}</small> : null}
                        </td>
                        {hasComparison ? (
                          <td className="budget-lines-table__num budget-lines-table__muted">{formatCurrency(toBudgetNumber(row.referenceActual))}</td>
                        ) : null}
                        <td className="budget-lines-table__num">
                          <BudgetAmountField row={row} fieldName="currentForecast" onValueChange={onValueChange} collectionKey={collectionKey} isEditable={isEditable} />
                        </td>
                        {hasComparison ? <td className="budget-lines-table__num">{renderTrend(row)}</td> : null}
                        {showActual ? (
                          <td className="budget-lines-table__num">
                            <BudgetAmountField row={row} fieldName="currentActual" onValueChange={onValueChange} collectionKey={collectionKey} isEditable={isEditable} />
                          </td>
                        ) : null}
                        {showActual ? <td className="budget-lines-table__num">{renderVariance(row.currentForecast, row.currentActual)}</td> : null}
                        <td className="budget-lines-table__pieces">
                          {rowInvoices.length ? (
                            <span className="budget-lines-table__piece" title={`${rowInvoices.length} facture(s) liée(s)`}>
                              <PaperclipIcon />{rowInvoices.length}
                            </span>
                          ) : null}
                          {String(row.comment || "").trim() ? (
                            <span className="budget-lines-table__piece" title={row.comment}>
                              <CommentIcon />
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
            {!visibleSections.length ? (
              <tbody>
                <tr>
                  <td colSpan={columnCount} className="budget-lines-table__empty">Aucune ligne ne correspond à la recherche.</td>
                </tr>
              </tbody>
            ) : null}
            <tfoot>
              <tr>
                {isEditable ? <td /> : null}
                <th scope="row">Total {side === "expense" ? "dépenses" : "recettes"}</th>
                {hasComparison ? <td className="budget-lines-table__num">{formatCurrency(totals.referenceActual)}</td> : null}
                <td className="budget-lines-table__num">{formatCurrency(totals.currentForecast)}</td>
                {hasComparison ? (
                  <td className="budget-lines-table__num">
                    {formatPercent(computeEvolutionPercent(totals.referenceActual, totals.currentForecast))}
                  </td>
                ) : null}
                {showActual ? <td className="budget-lines-table__num">{formatCurrency(totals.currentActual)}</td> : null}
                {showActual ? <td className="budget-lines-table__num">{formatVariance(computeVariance(totals.currentForecast, totals.currentActual))}</td> : null}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {selectedRow ? (
          <BudgetLineDrawer
            key={selectedRow.id}
            row={selectedRow}
            side={side}
            collectionKey={collectionKey}
            sectionNames={sections.map((section) => section.sectionName)}
            referenceEditionId={referenceEditionId}
            currentEditionId={currentEditionId}
            hasComparison={hasComparison}
            actualLabel={actualLabel}
            isEditable={isEditable}
            canStartEditing={canStartEditing}
            onStartEditing={onStartEditing}
            onValueChange={onValueChange}
            onDeleteRow={onDeleteRow}
            invoices={invoicesByRowId[selectedRow.id] || []}
            canManageInvoices={canManageInvoices}
            onUnlinkInvoice={onUnlinkInvoice}
            rowHistory={rowHistory}
            onClose={() => setSelectedRowId("")}
          />
        ) : null}
      </div>
    </div>
  );
}

function BudgetTrackingPage({ Panel }) {
  const { currentUser, userProfile } = useAuth();
  const { tr } = useComLang();
  const { activeEditionId } = useActiveEdition(true);
  const invoiceConfiguration = useBudgetInvoiceConfiguration();
  const { documents: allDocuments } = useDocumentsCollection(true);
  const [storedBudgets, setStoredBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [draftBudget, setDraftBudget] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [linesCollectionKey, setLinesCollectionKey] = useState("expenses");
  const [isEditMode, setIsEditMode] = useState(false);
  const [newBudgetYear, setNewBudgetYear] = useState("");
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [pendingNewBudgetId, setPendingNewBudgetId] = useState("");
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
  const [isInvoiceMailOpen, setIsInvoiceMailOpen] = useState(false);
  const [invoiceFilingStatus, setInvoiceFilingStatus] = useState("");
  const [invoiceListFilter, setInvoiceListFilter] = useState("all");

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
    // Les menus Exporter / Plus d'actions se referment quand on clique ailleurs.
    function closeOpenMenus(event) {
      document.querySelectorAll(".budget-menu[open]").forEach((menu) => {
        if (!menu.contains(event.target)) menu.removeAttribute("open");
      });
    }

    document.addEventListener("pointerdown", closeOpenMenus);
    return () => document.removeEventListener("pointerdown", closeOpenMenus);
  }, []);

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
  // Les règles Firestore ne laissent supprimer un document qu'aux admins et gestionnaires.
  const canDeleteInvoices = activeRoles.includes("admin") || activeRoles.includes("gestionnaire");
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
      const targetRow = currentBudget[collectionKey].find((row) => row.id === rowId);
      if (targetRow?.isComputedLocked && (isNumericField || fieldName === "label" || fieldName === "section")) {
        return currentBudget;
      }
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
    if (!canEditBudget || !draftBudget) return "";

    const collectionKey = type === "expenses" ? "expenses" : "revenues";
    const sideName = collectionKey === "expenses" ? "expense" : "revenue";
    const nextRowNumber = draftBudget[collectionKey].reduce((maxValue, row) => Math.max(maxValue, Number(row.rowNumber || 0)), 0) + 1;
    const newRow = createBudgetRow({
      side: sideName,
      section: sectionName,
      rowNumber: nextRowNumber,
    });

    setDraftBudget((currentBudget) => {
      if (!currentBudget) return currentBudget;

      const existingRows = currentBudget[collectionKey];
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
    return newRow.id;
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
      setInvoiceFilingStatus(tr(`Facture rangée dans ${target.rowLabel}.`, `Invoice filed under ${target.rowLabel}.`));
    } catch (error) {
      console.error("Unable to link invoice to budget row", error);
      setSaveStatus("La liaison de la facture a échoué.");
      setInvoiceFilingStatus(tr("La liaison de la facture a échoué.", "Filing the invoice failed."));
    }
  }

  async function handleDeleteInvoice(invoice) {
    if (!invoice?.id) return;
    const invoiceTitle = invoice.title || invoice.fileName || tr("Facture", "Invoice");
    const confirmed = window.confirm(
      tr(
        `Supprimer définitivement la facture « ${invoiceTitle} » et son fichier ?`,
        `Permanently delete the invoice "${invoiceTitle}" and its file?`,
      ),
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "documents", invoice.id));
      // Le fichier est retiré ensuite ; un échec ici ne bloque pas la suppression de la facture.
      if (invoice.filePath) {
        await deleteObject(storageRef(storage, invoice.filePath)).catch((error) =>
          console.warn("Unable to delete invoice file", error),
        );
      }
      const message = tr(`Facture « ${invoiceTitle} » supprimée.`, `Invoice "${invoiceTitle}" deleted.`);
      setSaveStatus(message);
      setInvoiceFilingStatus(message);
    } catch (error) {
      console.error("Unable to delete invoice", error);
      const message = tr("La suppression de la facture a échoué.", "Deleting the invoice failed.");
      setSaveStatus(message);
      setInvoiceFilingStatus(message);
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
  const budgetStatus = isBudgetLocked
    ? { label: "Définitif", tone: "locked" }
    : !isBudgetEditable
      ? { label: "Lecture seule", tone: "neutral" }
      : isEditMode
        ? { label: "Modification en cours", tone: "editing" }
        : { label: hasCurrentActualValues ? "Suivi en cours" : "Prévisionnel en cours", tone: "active" };
  const showInvoicesTab = canManageInvoicePanel || selectedEditionInvoices.length > 0;
  const lineSideConfig = linesCollectionKey === "revenues"
    ? { side: "revenue", collectionKey: "revenues", sections: revenueSections, totals: totals.revenues }
    : { side: "expense", collectionKey: "expenses", sections: expenseSections, totals: totals.expenses };
  const lineTotalField = !isBudgetLocked && !hasCurrentActualValues ? "currentForecast" : "currentActual";

  function closeMenu(event) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  return (
    <div className="page budget-page">
      {error ? (
        <div className="notice-card notice-card--warn">
          <strong>Chargement partiel</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <header className="budget-header">
        <div className="budget-header__identity">
          <p className="budget-header__eyebrow">Budget</p>
          <div className="budget-header__title">
            <h1>Budget {currentYearLabel}</h1>
            <span className={`budget-status-badge budget-status-badge--${budgetStatus.tone}`}>{budgetStatus.label}</span>
            {usesFallbackBudgets ? <span className="budget-status-badge budget-status-badge--warn">Source provisoire</span> : null}
          </div>
          <p className="budget-header__meta">
            {[
              draftBudget.meetingLevel,
              hasPersistedBudget
                ? `Modifié le ${formatDateTime(draftBudget.updatedAt)} par ${draftBudget.updatedByName || actorName}`
                : "Modèle local, pas encore enregistré",
            ].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="budget-header__actions">
          <label className="budget-header__edition">
            <span>Édition</span>
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

          <details className="budget-menu">
            <summary className="button button--secondary">
              {isExportingExcel || isExportingPdf ? "Export…" : "Exporter"}
            </summary>
            <div className="budget-menu__panel">
              <button type="button" onClick={(event) => { closeMenu(event); handleExportExcel(); }} disabled={isExportingExcel}>
                Fichier Excel
              </button>
              <button type="button" onClick={(event) => { closeMenu(event); handleExportPdf(); }} disabled={isExportingPdf}>
                PDF imprimable
              </button>
            </div>
          </details>

          {isBudgetEditable ? (
            !isEditMode ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  setIsEditMode(true);
                  setActiveTab("lines");
                }}
              >
                Modifier le budget
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
            )
          ) : null}

          {canCreateNextBudget ? (
            <details className="budget-menu budget-menu--end">
              <summary className="button button--secondary budget-menu__more" aria-label="Plus d'actions">⋯</summary>
              <div className="budget-menu__panel budget-menu__panel--form">
                <label className="field">
                  <span>Créer le budget de l&apos;édition</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={newBudgetYear}
                    onChange={(event) => setNewBudgetYear(event.target.value)}
                    placeholder="2028"
                  />
                </label>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={handleCreateBudget}
                  disabled={isCreatingBudget}
                >
                  {isCreatingBudget ? "Création..." : "Créer à partir de ce budget"}
                </button>
              </div>
            </details>
          ) : null}
        </div>
      </header>

      {budgetSeedLog.length ? <BudgetSeedLog lines={budgetSeedLog} /> : null}
      {exportStatus ? <p className="panel-note budget-save-status">{exportStatus}</p> : null}
      {saveStatus ? <p className="panel-note budget-save-status">{saveStatus}</p> : null}

      <nav className="budget-tabs" aria-label="Sections du budget">
        {[
          ["overview", "Vue d'ensemble"],
          ["lines", "Lignes budgétaires"],
          ...(showInvoicesTab ? [["invoices", "Factures"]] : []),
          ["history", "Historique"],
        ].map(([tabId, label]) => (
          <button
            key={tabId}
            className={`budget-tabs__tab${activeTab === tabId ? " budget-tabs__tab--active" : ""}`}
            type="button"
            aria-current={activeTab === tabId ? "page" : undefined}
            onClick={() => setActiveTab(tabId)}
          >
            {label}
            {tabId === "invoices" && unclassifiedInvoices.length ? (
              <span className="budget-tabs__count" aria-label={`${unclassifiedInvoices.length} à classer`}>{unclassifiedInvoices.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <BudgetOverview
          budget={draftBudget}
          totals={totals}
          expenseSections={expenseSections}
          revenueSections={revenueSections}
          hasComparison={hasComparison}
          isBudgetLocked={isBudgetLocked}
          hasCurrentActualValues={hasCurrentActualValues}
          unclassifiedInvoiceCount={unclassifiedInvoices.length}
          showInvoiceCard={showInvoicesTab}
          onOpenInvoices={() => setActiveTab("invoices")}
        />
      ) : null}

      {activeTab === "lines" ? (
        <div className="budget-lines">
          <div className="budget-segmented" role="group" aria-label="Côté du budget">
            {[
              ["expenses", "Dépenses", totals.expenses],
              ["revenues", "Recettes", totals.revenues],
            ].map(([collectionKey, label, sideTotals]) => (
              <button
                key={collectionKey}
                type="button"
                className={`budget-segmented__option${linesCollectionKey === collectionKey ? " budget-segmented__option--active" : ""}`}
                aria-pressed={linesCollectionKey === collectionKey}
                onClick={() => setLinesCollectionKey(collectionKey)}
              >
                {label} · {formatCurrency(sideTotals[lineTotalField])}
              </button>
            ))}
          </div>
          <BudgetLinesWorkspace
            key={lineSideConfig.collectionKey}
            side={lineSideConfig.side}
            collectionKey={lineSideConfig.collectionKey}
            sections={lineSideConfig.sections}
            referenceEditionId={draftBudget.referenceEditionId}
            currentEditionId={draftBudget.currentEditionId}
            hasComparison={hasComparison}
            isBudgetLocked={isBudgetLocked}
            showActualColumn={isBudgetLocked || hasCurrentActualValues}
            isEditable={canEditBudget}
            canStartEditing={isBudgetEditable && !isEditMode}
            onStartEditing={() => setIsEditMode(true)}
            newSectionName={sectionDrafts[lineSideConfig.collectionKey]}
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
            totals={lineSideConfig.totals}
            invoicesByRowId={invoicesByBudgetRowId}
            canManageInvoices={canManageInvoicePanel}
            onUnlinkInvoice={handleUnlinkInvoice}
            historyEntries={historyEntries}
          />
        </div>
      ) : null}

      {activeTab === "invoices" ? (
        <div className="budget-invoices">
          {canManageInvoicePanel ? (
            <div className="budget-invoices__top">
              <section className="budget-card budget-invoice-inbox" aria-label="Factures à classer">
                <header className="budget-card__header">
                  <h2>
                    À classer <span>· {unclassifiedInvoices.length} facture{unclassifiedInvoices.length > 1 ? "s" : ""}</span>
                  </h2>
                  {unclassifiedInvoices.length > 1 ? (
                    <span className="budget-card__meta">
                      {unclassifiedInvoices.findIndex((invoice) => invoice.id === selectedInvoiceId) + 1} sur {unclassifiedInvoices.length}
                    </span>
                  ) : null}
                </header>
                {invoiceFilingStatus ? <p className="panel-note" role="status">{invoiceFilingStatus}</p> : null}

                {!unclassifiedInvoices.length ? (
                  <p className="budget-invoice-inbox__done">Tout est classé pour cette édition.</p>
                ) : (
                  <div className="budget-invoice-inbox__body">
                    {unclassifiedInvoices.length > 1 ? (
                      <ul className="budget-invoice-inbox__queue" aria-label="File des factures à classer">
                        {unclassifiedInvoices.map((invoice) => (
                          <li key={invoice.id}>
                            <button
                              type="button"
                              className={`budget-invoice-inbox__queue-item${invoice.id === selectedInvoiceId ? " budget-invoice-inbox__queue-item--active" : ""}`}
                              aria-pressed={invoice.id === selectedInvoiceId}
                              onClick={() => setSelectedInvoiceId(invoice.id)}
                            >
                              <strong>{invoice.title || invoice.fileName || "Facture"}</strong>
                              <small>{invoice.uploadedByName || "Utilisateur"}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {selectedInvoiceForClassification ? (
                      <div className="budget-invoice-inbox__current">
                        <div className="budget-invoice-inbox__preview">
                          {String(selectedInvoiceForClassification.mimeType || "").startsWith("image/") && selectedInvoiceForClassification.resolvedUrl ? (
                            <img src={selectedInvoiceForClassification.resolvedUrl} alt={`Aperçu de ${selectedInvoiceForClassification.title || "la facture"}`} />
                          ) : (
                            <span aria-hidden="true">PDF</span>
                          )}
                        </div>
                        <div className="budget-invoice-inbox__form">
                          <div>
                            <strong className="budget-invoice-inbox__title">
                              {selectedInvoiceForClassification.title || selectedInvoiceForClassification.fileName || "Facture"}
                            </strong>
                            <p className="budget-invoice-inbox__meta">
                              Déposée par {selectedInvoiceForClassification.uploadedByName || "un utilisateur"}
                              {" · "}
                              {selectedInvoiceForClassification.invoiceNote || "aucune note"}
                            </p>
                          </div>

                          <BudgetLinePicker
                            key={selectedInvoiceId}
                            targets={expenseTargetOptions}
                            value={selectedInvoiceTargetRowId}
                            onChange={setSelectedInvoiceTargetRowId}
                          />

                          <div className="budget-invoice-inbox__actions">
                            <button
                              className="button button--primary"
                              type="button"
                              disabled={!selectedInvoiceId || !selectedInvoiceTargetRowId}
                              onClick={() => handleLinkInvoice(selectedInvoiceId, selectedInvoiceTargetRowId)}
                            >
                              {unclassifiedInvoices.length > 1 ? "Classer et passer à la suivante" : "Classer la facture"}
                            </button>
                            {selectedInvoiceForClassification.resolvedUrl ? (
                              <button
                                className="button button--secondary"
                                type="button"
                                onClick={() => window.open(selectedInvoiceForClassification.resolvedUrl, "_blank", "noopener,noreferrer")}
                              >
                                Ouvrir le fichier
                              </button>
                            ) : null}
                            <button className="button button--secondary" type="button" onClick={() => setIsInvoiceMailOpen(true)}>
                              {tr(`Envoyer un mail à ${INVOICE_CONTACT.firstName}`, `Email ${INVOICE_CONTACT.firstName}`)}
                            </button>
                            {canDeleteInvoices ? (
                              <button
                                className="button button--ghost-danger"
                                type="button"
                                onClick={() => handleDeleteInvoice(selectedInvoiceForClassification)}
                              >
                                {tr("Supprimer la facture", "Delete invoice")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isInvoiceMailOpen && selectedInvoiceForClassification ? (
                      <InvoiceMailDialog
                        invoice={selectedInvoiceForClassification}
                        target={expenseTargetOptions.find((option) => option.value === selectedInvoiceTargetRowId) ?? null}
                        senderName={getDisplayName(userProfile, currentUser?.email)}
                        senderEmail={currentUser?.email || userProfile?.email || ""}
                        onClose={() => setIsInvoiceMailOpen(false)}
                        onSent={(recipient) => {
                          setIsInvoiceMailOpen(false);
                          setInvoiceFilingStatus(tr(`Mail envoyé à ${recipient}.`, `Email sent to ${recipient}.`));
                        }}
                      />
                    ) : null}
                  </div>
                )}
              </section>

              <section className="budget-card budget-invoice-upload" aria-label="Déposer une facture">
                <header className="budget-card__header">
                  <h2>Déposer une facture</h2>
                </header>
                <p className="budget-card__intro">Elle arrive dans « À classer » ; le rangement se fait ensuite.</p>
                <InvoiceUploadForm
                  editionId={draftBudget.currentEditionId}
                  currentUser={currentUser}
                  userProfile={userProfile}
                  assignedTeams={Array.isArray(userProfile?.assignedTeams) ? userProfile.assignedTeams : []}
                />
              </section>
            </div>
          ) : null}

          {selectedEditionInvoices.length ? (
            <section className="budget-card budget-invoice-list-card" aria-label="Toutes les factures">
              <header className="budget-card__header">
                <h2>Toutes les factures {draftBudget.currentEditionId}</h2>
                <div className="budget-invoice-list-card__filters" role="group" aria-label="Filtrer les factures">
                  {[
                    ["all", "Toutes", selectedEditionInvoices.length],
                    ["pending", "À classer", unclassifiedInvoices.length],
                    ["linked", "Classées", selectedEditionInvoices.length - unclassifiedInvoices.length],
                  ].map(([filterId, label, count]) => (
                    <button
                      key={filterId}
                      type="button"
                      className={`budget-chip${invoiceListFilter === filterId ? " budget-chip--active" : ""}`}
                      aria-pressed={invoiceListFilter === filterId}
                      onClick={() => setInvoiceListFilter(filterId)}
                    >
                      {label} · {count}
                    </button>
                  ))}
                </div>
              </header>
              <div className="budget-invoice-list-card__table">
                <table className="budget-lines-table">
                  <thead>
                    <tr>
                      <th scope="col">Facture</th>
                      <th scope="col">Ligne budgétaire</th>
                      <th scope="col">Statut</th>
                      <th scope="col"><span className="budget-visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEditionInvoices
                      .filter((invoice) => {
                        const isPending = unclassifiedInvoices.includes(invoice);
                        if (invoiceListFilter === "pending") return isPending;
                        if (invoiceListFilter === "linked") return !isPending;
                        return true;
                      })
                      .map((invoice) => {
                        const isPending = unclassifiedInvoices.includes(invoice);

                        return (
                          <tr key={invoice.id}>
                            <td>
                              <strong>{invoice.title || invoice.fileName || "Facture"}</strong>
                              <small className="budget-invoice-list-card__sub">{invoice.uploadedByName || "Utilisateur"}</small>
                            </td>
                            <td>
                              {invoice.linkedBudgetRowLabel || "—"}
                              {invoice.linkedBudgetSectionName ? (
                                <small className="budget-invoice-list-card__sub">{invoice.linkedBudgetSectionName}</small>
                              ) : null}
                            </td>
                            <td>
                              <span className={`budget-status-badge ${isPending ? "budget-status-badge--editing" : "budget-status-badge--locked"}`}>
                                {isPending ? "À classer" : "Classée"}
                              </span>
                            </td>
                            <td className="budget-invoice-list-card__actions">
                              {isPending && canManageInvoicePanel ? (
                                <button className="button button--secondary button--small" type="button" onClick={() => setSelectedInvoiceId(invoice.id)}>
                                  Classer
                                </button>
                              ) : null}
                              {invoice.resolvedUrl ? (
                                <button
                                  className="button button--secondary button--small"
                                  type="button"
                                  onClick={() => window.open(invoice.resolvedUrl, "_blank", "noopener,noreferrer")}
                                >
                                  Ouvrir
                                </button>
                              ) : null}
                              {invoice.linkedBudgetRowId && canManageInvoicePanel ? (
                                <button className="button button--ghost-danger button--small" type="button" onClick={() => handleUnlinkInvoice(invoice)}>
                                  Délier
                                </button>
                              ) : null}
                              {canDeleteInvoices ? (
                                <button className="button button--ghost-danger button--small" type="button" onClick={() => handleDeleteInvoice(invoice)}>
                                  {tr("Supprimer", "Delete")}
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
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
