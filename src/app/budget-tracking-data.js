import rawBudget2025 from "../data/budget2025.json";
import rawBudget2026 from "../data/budget2026.json";

const BUDGET_COLLECTION = "budgets";
const BUDGET_HISTORY_COLLECTION = "history";

const EXPENSE_SECTION_ORDER = [
  "Athlètes",
  "Communication",
  "Animation",
  "Conférence du vendredi",
  "Imprimerie",
  "Catering",
  "Divers",
];

const REVENUE_SECTION_ORDER = [
  "Entrée / buvette",
  "Sponsors (monétaire)",
  "Sponsors (services / prise en charge)",
  "Subsides",
  "Ventes",
  "Business Run",
];

const DERIVED_ROW_IDS = new Set(["exp-40", "rev-11"]);

// Le coût du meet director est contractuellement 10 % des montants versés aux
// athlètes (déplacement, engagement, prize money, primes de performance, extra
// appearance fee). La ligne est donc calculée, verrouillée et affichée en tête
// du bloc Athlètes.
const MEET_DIRECTOR_ROW_ID = "exp-14";
const MEET_DIRECTOR_RATE = 0.1;
const MEET_DIRECTOR_SOURCE_ROW_IDS = ["exp-8", "exp-9", "exp-10", "exp-11", "exp-12"];
const MEET_DIRECTOR_FIELDS = ["currentForecast", "currentActual"];
const CANONICAL_HISTORICAL_EDITIONS = new Set(["2024", "2025", "2026"]);

const BUDGET_SEED_SOURCES = {
  "2025": rawBudget2025,
  "2026": rawBudget2026,
};

const SIMPLIFIED_GROUPS_BY_EDITION = {
  "2026": {
  expenses: [
    {
      id: "expenses-athletes-competition",
      label: "Athlètes / compétition",
      rowIds: [
        "exp-8",
        "exp-9",
        "exp-10",
        "exp-11",
        "exp-12",
        "exp-13",
        "exp-14",
        "exp-15",
        "exp-16",
        "exp-17",
        "exp-18",
        "exp-19",
        "exp-20",
        "exp-21",
        "exp-22",
        "exp-23",
        "exp-24",
        "exp-25",
        "exp-26",
        "exp-27",
      ],
    },
    {
      id: "expenses-operations",
      label: "Organisation compétition",
      rowIds: ["exp-28", "exp-29", "exp-30", "exp-31", "exp-32", "exp-33"],
    },
    {
      id: "expenses-animation",
      label: "Animation compétition",
      rowIds: [
        "exp-36",
        "exp-37",
        "exp-38",
        "exp-39",
        "exp-41",
        "exp-42",
        "exp-43",
        "exp-44",
        "exp-45",
        "exp-46",
        "exp-47",
        "exp-48",
        "exp-49",
        "exp-50",
        "exp-51",
        "exp-52",
        "exp-53",
      ],
    },
    {
      id: "expenses-supports",
      label: "Supports communication",
      rowIds: ["exp-54", "exp-55", "exp-56", "exp-57", "exp-58", "exp-59", "exp-60", "exp-61", "exp-62"],
    },
    {
      id: "expenses-friday-conference",
      label: "Conférence vendredi",
      rowIds: ["exp-71", "exp-72"],
    },
    {
      id: "expenses-print",
      label: "Impressions",
      rowIds: [
        "exp-75",
        "exp-76",
        "exp-77",
        "exp-78",
        "exp-79",
        "exp-80",
        "exp-81",
        "exp-82",
        "exp-83",
        "exp-84",
        "exp-85",
        "exp-86",
        "exp-87",
        "exp-88",
        "exp-89",
        "exp-90",
        "exp-91",
      ],
    },
    {
      id: "expenses-catering",
      label: "Catering: buvette + VIP + bénévoles",
      rowIds: ["exp-94", "exp-95", "exp-96", "exp-97", "exp-98", "exp-99", "exp-100", "exp-101"],
    },
    {
      id: "expenses-misc",
      label: "Divers et habits organisation",
      rowIds: ["exp-104", "exp-105", "exp-106", "exp-107", "exp-108", "exp-109", "exp-110", "exp-111", "exp-112", "exp-114", "exp-115", "exp-116"],
    },
  ],
  revenues: [
    {
      id: "revenues-entry",
      label: "Entrée / buvette",
      rowIds: ["rev-7", "rev-8", "rev-9", "rev-10"],
    },
    {
      id: "revenues-sponsors-cash",
      label: "Sponsors",
      rowIds: ["rev-15", "rev-16", "rev-17", "rev-18", "rev-19", "rev-21", "rev-22", "rev-23", "rev-24", "rev-25"],
    },
    {
      id: "revenues-subsidies",
      label: "Subsides",
      rowIds: ["rev-54", "rev-55", "rev-56", "rev-57", "rev-58", "rev-59"],
    },
    {
      id: "revenues-other",
      label: "Ventes et business run",
      rowIds: ["rev-62", "rev-63", "rev-66", "rev-67"],
    },
  ],
  },
};

const DIFF_FIELDS = [
  "rowNumber",
  "section",
  "label",
  "details",
  "referenceForecast",
  "referenceActual",
  "currentForecast",
  "currentForecastFormula",
  "currentActual",
  "currentActualFormula",
  "actualReference",
  "comment",
];

const BUDGET_VALUE_FIELDS = [
  "referenceForecast",
  "referenceActual",
  "currentForecast",
  "currentActual",
];

const FORMULA_ENABLED_FIELDS = ["currentForecast", "currentActual"];

function normalizeEditionId(value, fallback = rawBudget2026.editionId) {
  const normalizedValue = normalizeOptionalEditionId(value);
  return normalizedValue || fallback;
}

function normalizeOptionalEditionId(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return normalizedValue;
}

function toBudgetNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  }

  const normalizedValue = String(value).trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalizedValue) return null;

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(4)) : null;
}

function isBudgetSummaryRow(label) {
  const normalizedLabel = String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  return (
    normalizedLabel === "total"
    || normalizedLabel === "totaux generaux"
    || normalizedLabel === "recettes"
    || normalizedLabel.startsWith("total ")
  );
}

function normalizeBudgetRow(row = {}, side, index = 0) {
  const safeId = String(row.id || `${side}-row-${index + 1}`).trim();
  const label = String(row.label || "").trim();

  return {
    id: safeId,
    rowNumber: Number(row.rowNumber || index + 1),
    side,
    section: String(row.section || "Autres").trim() || "Autres",
    label: label || `Ligne ${index + 1}`,
    details: String(row.details || "").trim(),
    referenceForecast: toBudgetNumber(row.referenceForecast),
    referenceActual: toBudgetNumber(row.referenceActual),
    currentForecast: toBudgetNumber(row.currentForecast),
    currentForecastFormula: String(row.currentForecastFormula || "").trim(),
    currentForecastFormulaError: "",
    currentActual: toBudgetNumber(row.currentActual),
    currentActualFormula: String(row.currentActualFormula || "").trim(),
    currentActualFormulaError: "",
    actualReference: String(row.actualReference || "").trim(),
    comment: String(row.comment || "").trim(),
    isCustom: Boolean(row.isCustom),
    isDerived: DERIVED_ROW_IDS.has(safeId),
    isSummary: isBudgetSummaryRow(label),
    isComputedLocked: safeId === MEET_DIRECTOR_ROW_ID,
  };
}

function cloneBudgetRow(row, { includeValues = true } = {}) {
  return {
    ...row,
    rowNumber: Number(row.rowNumber || 0),
    referenceForecast: includeValues ? toBudgetNumber(row.referenceForecast) : null,
    referenceActual: includeValues ? toBudgetNumber(row.referenceActual) : null,
    currentForecast: includeValues ? toBudgetNumber(row.currentForecast) : null,
    currentForecastFormula: String(row.currentForecastFormula || "").trim(),
    currentForecastFormulaError: String(row.currentForecastFormulaError || "").trim(),
    currentActual: includeValues ? toBudgetNumber(row.currentActual) : null,
    currentActualFormula: String(row.currentActualFormula || "").trim(),
    currentActualFormulaError: String(row.currentActualFormulaError || "").trim(),
    actualReference: String(row.actualReference || ""),
    comment: String(row.comment || ""),
    isCustom: Boolean(row.isCustom),
  };
}

function normalizeFormulaName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function getFormulaFieldName(fieldName) {
  return `${fieldName}Formula`;
}

function getFormulaErrorFieldName(fieldName) {
  return `${fieldName}FormulaError`;
}

function evaluateFormulaToken(token, rowMap, resolver) {
  const normalizedToken = String(token || "").trim().toUpperCase();
  const match = normalizedToken.match(/^([PR])(\d+)$/);
  if (!match) throw new Error(`Référence invalide : ${token}`);

  const [, columnCode, rowNumberValue] = match;
  const targetRow = rowMap.get(Number(rowNumberValue));
  if (!targetRow) throw new Error(`Ligne introuvable : ${token}`);

  const targetField = columnCode === "P" ? "currentForecast" : "currentActual";
  return resolver(targetRow, targetField);
}

function evaluateFormulaRange(rangeValue, rowMap, resolver) {
  const normalizedRange = String(rangeValue || "").trim().toUpperCase();
  const match = normalizedRange.match(/^([PR])(\d+):([PR])(\d+)$/);
  if (!match) throw new Error(`Plage invalide : ${rangeValue}`);

  const [, startColumn, startRowValue, endColumn, endRowValue] = match;
  if (startColumn !== endColumn) throw new Error(`Colonnes incompatibles : ${rangeValue}`);

  const startRow = Number(startRowValue);
  const endRow = Number(endRowValue);
  const step = startRow <= endRow ? 1 : -1;
  let total = 0;

  for (let rowNumber = startRow; step > 0 ? rowNumber <= endRow : rowNumber >= endRow; rowNumber += step) {
    total += evaluateFormulaToken(`${startColumn}${rowNumber}`, rowMap, resolver);
  }

  return total;
}

function evaluateBudgetFormulaExpression(expression, rowMap, resolver) {
  let formulaBody = String(expression || "").trim();
  if (!formulaBody.startsWith("=")) return { value: toBudgetNumber(formulaBody), error: "" };

  formulaBody = formulaBody.slice(1).trim();
  if (!formulaBody) return { value: null, error: "Formule vide." };

  try {
    let normalizedExpression = normalizeFormulaName(formulaBody);

    const sumPattern = /\b(SOMME|SUM)\(([^()]*)\)/g;
    normalizedExpression = normalizedExpression.replace(sumPattern, (_, _fn, rawArgs) => {
      const args = String(rawArgs || "")
        .split(/[;,]/)
        .map((value) => value.trim())
        .filter(Boolean);

      const total = args.reduce((sum, arg) => {
        if (/^[PR]\d+:[PR]\d+$/i.test(arg)) return sum + evaluateFormulaRange(arg, rowMap, resolver);
        if (/^[PR]\d+$/i.test(arg)) return sum + evaluateFormulaToken(arg, rowMap, resolver);

        const numericValue = Number(arg.replace(",", "."));
        if (!Number.isFinite(numericValue)) {
          throw new Error(`Argument SOMME invalide : ${arg}`);
        }

        return sum + numericValue;
      }, 0);

      return String(total);
    });

    if (/[PR]\d+:[PR]\d+/i.test(normalizedExpression)) {
      throw new Error("Les plages doivent être utilisées dans SOMME().");
    }

    normalizedExpression = normalizedExpression.replace(/[PR]\d+/gi, (token) => {
      return String(evaluateFormulaToken(token, rowMap, resolver));
    });

    normalizedExpression = normalizedExpression.replace(/,/g, ".");

    if (!/^[\d+\-*/().\s]+$/.test(normalizedExpression)) {
      throw new Error("Expression non autorisée.");
    }

    const evaluatedValue = Function(`"use strict"; return (${normalizedExpression});`)();
    if (!Number.isFinite(evaluatedValue)) throw new Error("Résultat invalide.");

    return {
      value: Number(Number(evaluatedValue).toFixed(4)),
      error: "",
    };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Formule invalide.",
    };
  }
}

function recalculateBudgetCollectionFormulas(rows = []) {
  const nextRows = rows.map((row) => cloneBudgetRow(row));
  const rowMap = new Map(nextRows.map((row) => [Number(row.rowNumber || 0), row]));
  const cache = new Map();

  function resolveFieldValue(row, fieldName, evaluationPath = new Set()) {
    const cacheKey = `${row.id}:${fieldName}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const formulaField = getFormulaFieldName(fieldName);
    const formulaErrorField = getFormulaErrorFieldName(fieldName);
    const formulaValue = String(row[formulaField] || "").trim();

    if (!formulaValue) {
      const directValue = toBudgetNumber(row[fieldName]) ?? 0;
      cache.set(cacheKey, directValue);
      row[formulaErrorField] = "";
      return directValue;
    }

    if (evaluationPath.has(cacheKey)) {
      row[formulaErrorField] = "Référence circulaire détectée.";
      cache.set(cacheKey, 0);
      return 0;
    }

    const nextPath = new Set(evaluationPath);
    nextPath.add(cacheKey);

    const { value, error } = evaluateBudgetFormulaExpression(formulaValue, rowMap, (targetRow, targetField) =>
      resolveFieldValue(targetRow, targetField, nextPath),
    );

    row[fieldName] = value;
    row[formulaErrorField] = error;

    const resolvedValue = value ?? 0;
    cache.set(cacheKey, resolvedValue);
    return resolvedValue;
  }

  nextRows.forEach((row) => {
    FORMULA_ENABLED_FIELDS.forEach((fieldName) => {
      const formulaErrorField = getFormulaErrorFieldName(fieldName);
      row[formulaErrorField] = "";
    });
  });

  nextRows.forEach((row) => {
    FORMULA_ENABLED_FIELDS.forEach((fieldName) => {
      const formulaField = getFormulaFieldName(fieldName);
      const formulaValue = String(row[formulaField] || "").trim();
      if (!formulaValue) return;
      resolveFieldValue(row, fieldName);
    });
  });

  return nextRows;
}

function applyMeetDirectorCost(rows = []) {
  const directorRow = rows.find((row) => row.id === MEET_DIRECTOR_ROW_ID);
  if (!directorRow) return rows;

  const sourceRows = rows.filter((row) => MEET_DIRECTOR_SOURCE_ROW_IDS.includes(row.id));

  return rows.map((row) => {
    if (row.id !== MEET_DIRECTOR_ROW_ID) return row;

    const nextRow = { ...row, section: "Athlètes", isComputedLocked: true };
    MEET_DIRECTOR_FIELDS.forEach((fieldName) => {
      const values = sourceRows.map((sourceRow) => toBudgetNumber(sourceRow[fieldName])).filter((value) => value != null);
      // Pas de réalisé saisi sur les lignes liées → pas de réalisé pour le meet director non plus.
      nextRow[fieldName] = values.length
        ? Number((values.reduce((sum, value) => sum + value, 0) * MEET_DIRECTOR_RATE).toFixed(2))
        : null;
      nextRow[getFormulaFieldName(fieldName)] = "";
      nextRow[getFormulaErrorFieldName(fieldName)] = "";
    });
    return nextRow;
  });
}

function recalculateBudgetFormulas(budget) {
  if (!budget) return budget;

  let expenses = recalculateBudgetCollectionFormulas(budget.expenses || []);
  // Les éditions figées gardent les montants de l'Excel d'origine.
  if (!isBudgetLockedEdition(budget.editionId)) {
    expenses = applyMeetDirectorCost(expenses);
    // Second passage : une formule peut elle-même pointer sur la ligne du meet director.
    expenses = recalculateBudgetCollectionFormulas(expenses);
  }

  return {
    ...structuredClone(budget),
    expenses,
    revenues: recalculateBudgetCollectionFormulas(budget.revenues || []),
  };
}

function normalizeHistoricalMatchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[()/:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHistoricalMatchKeys(row) {
  const section = normalizeHistoricalMatchValue(row.section);
  const label = normalizeHistoricalMatchValue(row.label);
  const details = normalizeHistoricalMatchValue(row.details);
  const simplifiedLabel = label
    .replace(/\bet\b/g, " ")
    .replace(/\bpart\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [
    `${section}||${label}||${details}`,
    `${section}||${label}`,
    `${section}||${simplifiedLabel}`,
    `${label}||${details}`,
    label,
    simplifiedLabel,
  ].filter(Boolean);
}

function buildHistoricalRowIndex(rows = []) {
  const indices = Array.from({ length: 6 }, () => new Map());

  rows.forEach((row, rowIndex) => {
    buildHistoricalMatchKeys(row).forEach((key, keyIndex) => {
      const scopedKey = `${row.side}||${key}`;
      if (!indices[keyIndex].has(scopedKey)) indices[keyIndex].set(scopedKey, []);
      indices[keyIndex].get(scopedKey).push(rowIndex);
    });
  });

  return indices;
}

function findHistoricalRowMatch(linkedRow, baseRows, rowIndexMaps, usedBaseIndexes) {
  const candidateKeys = buildHistoricalMatchKeys(linkedRow);

  for (let keyIndex = 0; keyIndex < candidateKeys.length; keyIndex += 1) {
    const matchingIndexes = rowIndexMaps[keyIndex].get(`${linkedRow.side}||${candidateKeys[keyIndex]}`) || [];
    const availableIndexes = matchingIndexes.filter((rowIndex) => {
      if (usedBaseIndexes.has(rowIndex)) return false;
      return Boolean(baseRows[rowIndex]?.isDerived) === Boolean(linkedRow.isDerived);
    });

    if (availableIndexes.length === 1) return availableIndexes[0];
  }

  return null;
}

function mergeHistoricalBudgetRows(baseRows = [], linkedRows = []) {
  const mergedBaseRows = baseRows.map((row) => ({
    ...cloneBudgetRow(row),
    currentForecast: null,
    currentActual: null,
  }));
  const unmatchedLinkedRowsBySection = new Map();
  const rowIndexMaps = buildHistoricalRowIndex(mergedBaseRows);
  const usedBaseIndexes = new Set();

  linkedRows.forEach((linkedRow) => {
    const matchingBaseIndex = findHistoricalRowMatch(linkedRow, mergedBaseRows, rowIndexMaps, usedBaseIndexes);

    if (matchingBaseIndex != null) {
      usedBaseIndexes.add(matchingBaseIndex);
      mergedBaseRows[matchingBaseIndex] = {
        ...mergedBaseRows[matchingBaseIndex],
        currentForecast: linkedRow.referenceForecast,
        currentActual: linkedRow.referenceActual,
      };
      return;
    }

    const sectionName = String(linkedRow.section || "Autres").trim() || "Autres";
    if (!unmatchedLinkedRowsBySection.has(sectionName)) unmatchedLinkedRowsBySection.set(sectionName, []);
    unmatchedLinkedRowsBySection.get(sectionName).push({
      ...cloneBudgetRow(linkedRow),
      referenceForecast: null,
      referenceActual: null,
      currentForecast: linkedRow.referenceForecast,
      currentActual: linkedRow.referenceActual,
      currentForecastFormula: "",
      currentForecastFormulaError: "",
      currentActualFormula: "",
      currentActualFormulaError: "",
      actualReference: "",
      comment: "",
      isLinkedOnly: true,
    });
  });

  const mergedRows = [];
  const appendedSections = new Set();

  mergedBaseRows.forEach((row, rowIndex) => {
    mergedRows.push(row);

    const nextRow = mergedBaseRows[rowIndex + 1];
    if (nextRow?.section === row.section) return;

    const sectionRows = unmatchedLinkedRowsBySection.get(row.section) || [];
    if (!sectionRows.length) return;

    mergedRows.push(...sectionRows);
    appendedSections.add(row.section);
  });

  unmatchedLinkedRowsBySection.forEach((rows, sectionName) => {
    if (appendedSections.has(sectionName)) return;
    mergedRows.push(...rows);
  });

  return mergedRows;
}

function enrichBudgetWithLinkedActuals(budget, budgets = []) {
  if (!budget) return budget;

  const alreadyHasCurrentValues =
    hasMeaningfulCurrentValues(budget.expenses)
    || hasMeaningfulCurrentValues(budget.revenues);

  if (alreadyHasCurrentValues) return budget;

  const linkedReferenceBudget = budgets.find(
    (candidateBudget) => normalizeEditionId(candidateBudget.referenceEditionId) === normalizeEditionId(budget.currentEditionId),
  );

  if (!linkedReferenceBudget) return budget;

  return {
    ...budget,
    expenses: mergeHistoricalBudgetRows(budget.expenses, linkedReferenceBudget.expenses),
    revenues: mergeHistoricalBudgetRows(budget.revenues, linkedReferenceBudget.revenues),
  };
}

function createBudgetRow({
  side = "expense",
  section = "Autres",
  rowNumber = 1,
  label = "",
  details = "",
} = {}) {
  const rowSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  return normalizeBudgetRow(
    {
      id: `custom-${side}-${rowSuffix}`,
      rowNumber,
      side,
      section,
      label: label || "Nouvelle ligne",
      details,
      referenceForecast: null,
      referenceActual: null,
      currentForecast: null,
      currentForecastFormula: "",
      currentActual: null,
      currentActualFormula: "",
      actualReference: "",
      comment: "",
      isCustom: true,
    },
    side,
    Math.max(0, rowNumber - 1),
  );
}

function getBudgetSeedSource(editionId) {
  const normalizedEditionId = normalizeEditionId(editionId);
  if (normalizedEditionId === "2024") return rawBudget2025;
  return BUDGET_SEED_SOURCES[normalizedEditionId] ?? rawBudget2026;
}

function inferReferenceEditionId(editionId) {
  const numericEdition = Number(editionId);
  if (!Number.isFinite(numericEdition)) return rawBudget2026.referenceEditionId;
  return String(numericEdition - 1);
}

function buildStandaloneHistoricalBudget({
  editionId,
  title,
  meetingLevel = rawBudget2025.meetingLevel || rawBudget2026.meetingLevel,
  sourceBudget,
  includeSeedValues = true,
} = {}) {
  function mapStandaloneRow(row, side, index) {
    const normalizedRow = normalizeBudgetRow(row, side, index);
    return {
      ...cloneBudgetRow(normalizedRow, { includeValues: includeSeedValues }),
      referenceForecast: null,
      referenceActual: null,
      currentForecast: includeSeedValues ? toBudgetNumber(normalizedRow.referenceForecast) : null,
      currentActual: includeSeedValues ? toBudgetNumber(normalizedRow.referenceActual) : null,
      currentForecastFormula: "",
      currentActualFormula: "",
      actualReference: "",
      comment: "",
    };
  }

  return {
    editionId,
    title,
    meetingLevel,
    referenceEditionId: "",
    currentEditionId: editionId,
    expenses: sourceBudget.expenses.map((row, index) => mapStandaloneRow(row, "expense", index)),
    revenues: sourceBudget.revenues.map((row, index) => mapStandaloneRow(row, "revenue", index)),
    createdAt: null,
    updatedAt: null,
    updatedByName: "",
    updatedByUid: "",
  };
}

function buildBudgetSeed({
  editionId = rawBudget2026.editionId,
  referenceEditionId = inferReferenceEditionId(editionId),
  includeSeedValues = true,
} = {}) {
  const normalizedEditionId = normalizeEditionId(editionId);
  if (normalizedEditionId === "2024") {
    return buildStandaloneHistoricalBudget({
      editionId: "2024",
      title: "Budget CMCM Luxembourg Indoor Meeting 2024",
      sourceBudget: rawBudget2025,
      includeSeedValues,
    });
  }

  const budgetSource = getBudgetSeedSource(normalizedEditionId);
  const normalizedReferenceEditionId = normalizeOptionalEditionId(referenceEditionId) || rawBudget2026.referenceEditionId;
  const expenses = budgetSource.expenses.map((row, index) =>
    cloneBudgetRow(normalizeBudgetRow(row, "expense", index), { includeValues: includeSeedValues }),
  );
  const revenues = budgetSource.revenues.map((row, index) =>
    cloneBudgetRow(normalizeBudgetRow(row, "revenue", index), { includeValues: includeSeedValues }),
  );

  return {
    editionId: normalizedEditionId,
    title: `Budget CMCM Luxembourg Indoor Meeting ${normalizedEditionId}`,
    meetingLevel: budgetSource.meetingLevel || rawBudget2026.meetingLevel,
    referenceEditionId: normalizedReferenceEditionId,
    currentEditionId: normalizedEditionId,
    expenses,
    revenues,
    createdAt: null,
    updatedAt: null,
    updatedByName: "",
    updatedByUid: "",
  };
}

function normalizeBudgetDocument(data = {}, { fallbackEditionId = rawBudget2026.editionId } = {}) {
  const normalizedEditionId = normalizeEditionId(data.editionId || fallbackEditionId);
  const budgetSource = getBudgetSeedSource(normalizedEditionId);
  const fallbackBudget = buildBudgetSeed({
    editionId: normalizedEditionId,
    referenceEditionId: data.referenceEditionId || inferReferenceEditionId(normalizedEditionId),
    includeSeedValues: true,
  });

  return {
    editionId: normalizedEditionId,
    title: String(data.title || fallbackBudget.title).trim(),
    meetingLevel: String(data.meetingLevel || budgetSource.meetingLevel || fallbackBudget.meetingLevel).trim(),
    referenceEditionId: normalizeOptionalEditionId(data.referenceEditionId) || fallbackBudget.referenceEditionId,
    currentEditionId: normalizeEditionId(data.currentEditionId || normalizedEditionId, normalizedEditionId),
    expenses: Array.isArray(data.expenses) && data.expenses.length
      ? data.expenses.map((row, index) => normalizeBudgetRow(row, "expense", index))
      : fallbackBudget.expenses,
    revenues: Array.isArray(data.revenues) && data.revenues.length
      ? data.revenues.map((row, index) => normalizeBudgetRow(row, "revenue", index))
      : fallbackBudget.revenues,
    createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
    updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt ?? null,
    updatedByName: String(data.updatedByName || "").trim(),
    updatedByUid: String(data.updatedByUid || "").trim(),
  };
}

function serializeBudgetDocument(budget, { actorName = "", actorUid = "" } = {}) {
  return {
    editionId: normalizeEditionId(budget.editionId),
    title: String(budget.title || "").trim(),
    meetingLevel: String(budget.meetingLevel || "").trim(),
    referenceEditionId: normalizeOptionalEditionId(budget.referenceEditionId),
    currentEditionId: normalizeEditionId(budget.currentEditionId || budget.editionId),
    updatedByName: String(actorName || "").trim(),
    updatedByUid: String(actorUid || "").trim(),
    expenses: budget.expenses.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      section: row.section,
      label: row.label,
      details: row.details,
      referenceForecast: toBudgetNumber(row.referenceForecast),
      referenceActual: toBudgetNumber(row.referenceActual),
      currentForecast: toBudgetNumber(row.currentForecast),
      currentForecastFormula: String(row.currentForecastFormula || "").trim(),
      currentActual: toBudgetNumber(row.currentActual),
      currentActualFormula: String(row.currentActualFormula || "").trim(),
      actualReference: String(row.actualReference || "").trim(),
      comment: String(row.comment || "").trim(),
      isCustom: Boolean(row.isCustom),
    })),
    revenues: budget.revenues.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      section: row.section,
      label: row.label,
      details: row.details,
      referenceForecast: toBudgetNumber(row.referenceForecast),
      referenceActual: toBudgetNumber(row.referenceActual),
      currentForecast: toBudgetNumber(row.currentForecast),
      currentForecastFormula: String(row.currentForecastFormula || "").trim(),
      currentActual: toBudgetNumber(row.currentActual),
      currentActualFormula: String(row.currentActualFormula || "").trim(),
      actualReference: String(row.actualReference || "").trim(),
      comment: String(row.comment || "").trim(),
      isCustom: Boolean(row.isCustom),
    })),
  };
}

function applyCanonicalHistoricalBudget(storedBudget, fallbackBudget) {
  if (!storedBudget) return fallbackBudget;
  if (!fallbackBudget) return storedBudget;
  if (!CANONICAL_HISTORICAL_EDITIONS.has(normalizeEditionId(storedBudget.editionId))) return storedBudget;

  return {
    ...structuredClone(fallbackBudget),
    createdAt: storedBudget.createdAt ?? fallbackBudget.createdAt,
    updatedAt: storedBudget.updatedAt ?? fallbackBudget.updatedAt,
    updatedByName: storedBudget.updatedByName || fallbackBudget.updatedByName,
    updatedByUid: storedBudget.updatedByUid || fallbackBudget.updatedByUid,
  };
}

function isBudgetLockedEdition(editionId) {
  return CANONICAL_HISTORICAL_EDITIONS.has(normalizeEditionId(editionId));
}

function hasMeaningfulBudgetValues(rows = []) {
  return getVisibleBudgetRows(rows).some((row) =>
    BUDGET_VALUE_FIELDS.some((fieldName) => {
      const value = toBudgetNumber(row[fieldName]);
      return value != null && value !== 0;
    }),
  );
}

function hasMeaningfulCurrentValues(rows = []) {
  return getVisibleBudgetRows(rows).some((row) => {
    const currentForecast = toBudgetNumber(row.currentForecast);
    const currentActual = toBudgetNumber(row.currentActual);
    return (currentForecast != null && currentForecast !== 0) || (currentActual != null && currentActual !== 0);
  });
}

function mergeBudgetRowWithFallback(storedRow, fallbackRow) {
  if (!storedRow) return fallbackRow ? structuredClone(fallbackRow) : storedRow;
  if (!fallbackRow) return storedRow;

  const nextRow = structuredClone(storedRow);

  BUDGET_VALUE_FIELDS.forEach((fieldName) => {
    const storedValue = toBudgetNumber(storedRow[fieldName]);
    const fallbackValue = toBudgetNumber(fallbackRow[fieldName]);
    if (storedValue == null && fallbackValue != null) {
      nextRow[fieldName] = fallbackValue;
    }
  });

  if (!String(nextRow.label || "").trim()) nextRow.label = fallbackRow.label;
  if (!String(nextRow.details || "").trim()) nextRow.details = fallbackRow.details;
  if (!String(nextRow.section || "").trim()) nextRow.section = fallbackRow.section;

  return nextRow;
}

function mergeBudgetSideWithFallback(storedRows = [], fallbackRows = []) {
  if (!fallbackRows.length) return storedRows;
  if (!storedRows.length) return structuredClone(fallbackRows);

  const fallbackRowsById = new Map(fallbackRows.map((row) => [row.id, row]));
  const mergedRows = storedRows.map((storedRow) =>
    mergeBudgetRowWithFallback(storedRow, fallbackRowsById.get(storedRow.id)),
  );

  const knownIds = new Set(mergedRows.map((row) => row.id));
  fallbackRows.forEach((fallbackRow) => {
    if (!knownIds.has(fallbackRow.id)) mergedRows.push(structuredClone(fallbackRow));
  });

  return mergedRows;
}

function mergeFallbackBudgetValues(storedBudget, fallbackBudget) {
  if (!storedBudget) return fallbackBudget;
  if (!fallbackBudget) return storedBudget;

  return {
    ...structuredClone(storedBudget),
    title: storedBudget.title || fallbackBudget.title,
    meetingLevel: storedBudget.meetingLevel || fallbackBudget.meetingLevel,
    referenceEditionId: storedBudget.referenceEditionId || fallbackBudget.referenceEditionId,
    currentEditionId: storedBudget.currentEditionId || fallbackBudget.currentEditionId,
    expenses: hasMeaningfulBudgetValues(storedBudget.expenses)
      ? mergeBudgetSideWithFallback(storedBudget.expenses, fallbackBudget.expenses)
      : structuredClone(fallbackBudget.expenses),
    revenues: hasMeaningfulBudgetValues(storedBudget.revenues)
      ? mergeBudgetSideWithFallback(storedBudget.revenues, fallbackBudget.revenues)
      : structuredClone(fallbackBudget.revenues),
    createdAt: storedBudget.createdAt ?? fallbackBudget.createdAt,
    updatedAt: storedBudget.updatedAt ?? fallbackBudget.updatedAt,
    updatedByName: storedBudget.updatedByName || fallbackBudget.updatedByName,
    updatedByUid: storedBudget.updatedByUid || fallbackBudget.updatedByUid,
  };
}

function getVisibleBudgetRows(rows = []) {
  return rows.filter((row) => !row.isDerived && !row.isSummary);
}

function groupRowsBySection(rows = [], order = []) {
  const visibleRows = [...getVisibleBudgetRows(rows)].sort((left, right) => {
    const leftPinned = left.id === MEET_DIRECTOR_ROW_ID;
    const rightPinned = right.id === MEET_DIRECTOR_ROW_ID;
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

    const leftRowNumber = Number(left.rowNumber || 0);
    const rightRowNumber = Number(right.rowNumber || 0);

    if (leftRowNumber !== rightRowNumber) return leftRowNumber - rightRowNumber;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  const rowsBySection = visibleRows.reduce((accumulator, row) => {
    if (!accumulator[row.section]) accumulator[row.section] = [];
    accumulator[row.section].push(row);
    return accumulator;
  }, {});

  const orderedSections = order.filter((sectionName) => rowsBySection[sectionName]);
  const extraSections = Object.keys(rowsBySection).filter((sectionName) => !orderedSections.includes(sectionName));

  return [...orderedSections, ...extraSections].map((sectionName) => ({
    sectionName,
    rows: rowsBySection[sectionName],
  }));
}

function sumBudgetField(rows = [], fieldName, { emptyAsNull = false } = {}) {
  const visibleRows = getVisibleBudgetRows(rows);
  const numericValues = visibleRows
    .map((row) => toBudgetNumber(row[fieldName]))
    .filter((value) => value != null);

  if (!numericValues.length) return emptyAsNull ? null : 0;
  return Number(numericValues.reduce((accumulator, value) => accumulator + value, 0).toFixed(2));
}

function getBudgetTotals(budget) {
  const expenseFields = budget.expenses;
  const revenueFields = budget.revenues;
  const totals = {
    expenses: {
      referenceForecast: sumBudgetField(expenseFields, "referenceForecast"),
      referenceActual: sumBudgetField(expenseFields, "referenceActual"),
      currentForecast: sumBudgetField(expenseFields, "currentForecast"),
      currentActual: sumBudgetField(expenseFields, "currentActual", { emptyAsNull: true }),
    },
    revenues: {
      referenceForecast: sumBudgetField(revenueFields, "referenceForecast"),
      referenceActual: sumBudgetField(revenueFields, "referenceActual"),
      currentForecast: sumBudgetField(revenueFields, "currentForecast"),
      currentActual: sumBudgetField(revenueFields, "currentActual", { emptyAsNull: true }),
    },
  };

  totals.balance = {
    referenceForecast: Number((totals.revenues.referenceForecast - totals.expenses.referenceForecast).toFixed(2)),
    referenceActual: Number((totals.revenues.referenceActual - totals.expenses.referenceActual).toFixed(2)),
    currentForecast: Number((totals.revenues.currentForecast - totals.expenses.currentForecast).toFixed(2)),
    currentActual:
      totals.revenues.currentActual == null && totals.expenses.currentActual == null
        ? null
        : Number((((totals.revenues.currentActual ?? 0) - (totals.expenses.currentActual ?? 0))).toFixed(2)),
  };

  return totals;
}

function buildSimplifiedRows(budget, side) {
  const sideKey = side === "revenue" ? "revenues" : "expenses";
  const rows = side === "revenue" ? budget.revenues : budget.expenses;
  const rowMap = new Map(getVisibleBudgetRows(rows).map((row) => [row.id, row]));
  const editionGroups = SIMPLIFIED_GROUPS_BY_EDITION[normalizeEditionId(budget.editionId)]?.[sideKey];

  if (!editionGroups?.length) {
    return groupRowsBySection(
      rows,
      side === "revenue" ? REVENUE_SECTION_ORDER : EXPENSE_SECTION_ORDER,
    ).map(({ sectionName, rows: sectionRows }) => ({
      id: `${sideKey}-${sectionName}`,
      label: sectionName,
      rowsCount: sectionRows.length,
      referenceForecast: sumBudgetField(sectionRows, "referenceForecast"),
      referenceActual: sumBudgetField(sectionRows, "referenceActual"),
      currentForecast: sumBudgetField(sectionRows, "currentForecast"),
      currentActual: sumBudgetField(sectionRows, "currentActual"),
      items: sectionRows.map((row) => ({
        id: row.id,
        label: row.label,
        details: row.details,
        referenceForecast: row.referenceForecast,
        referenceActual: row.referenceActual,
        currentForecast: row.currentForecast,
        currentActual: row.currentActual,
      })),
    }));
  }

  return editionGroups.map((group) => {
    const groupedRows = group.rowIds.map((rowId) => rowMap.get(rowId)).filter(Boolean);

    return {
      id: group.id,
      label: group.label,
      rowsCount: groupedRows.length,
      referenceForecast: sumBudgetField(groupedRows, "referenceForecast"),
      referenceActual: sumBudgetField(groupedRows, "referenceActual"),
      currentForecast: sumBudgetField(groupedRows, "currentForecast"),
      currentActual: sumBudgetField(groupedRows, "currentActual"),
      items: groupedRows.map((row) => ({
        id: row.id,
        label: row.label,
        details: row.details,
        referenceForecast: row.referenceForecast,
        referenceActual: row.referenceActual,
        currentForecast: row.currentForecast,
        currentActual: row.currentActual,
      })),
    };
  });
}

function mapHistoryEntry(snapshot) {
  const data = snapshot.data();
  const createdAt = data.createdAt?.toDate?.() ?? null;

  return {
    id: snapshot.id,
    createdAt,
    actorName: String(data.actorName || "").trim(),
    actorUid: String(data.actorUid || "").trim(),
    summary: String(data.summary || "").trim(),
    changeCount: Number(data.changeCount || 0),
    changes: Array.isArray(data.changes) ? data.changes : [],
  };
}

function buildBudgetDiff(originalBudget, nextBudget) {
  if (!originalBudget || !nextBudget) return [];

  const originalRows = new Map(
    [...(originalBudget.expenses || []), ...(originalBudget.revenues || [])].map((row) => [row.id, row]),
  );
  const nextRowsMap = new Map(
    [...(nextBudget.expenses || []), ...(nextBudget.revenues || [])].map((row) => [row.id, row]),
  );
  const nextRows = [...(nextBudget.expenses || []), ...(nextBudget.revenues || [])];
  const changes = [];

  nextRows.forEach((row) => {
    const originalRow = originalRows.get(row.id);
    if (!originalRow) {
      changes.push({
        rowId: row.id,
        rowLabel: row.label,
        section: row.section,
        side: row.side,
        field: "created",
        before: null,
        after: row.label,
      });
      return;
    }

    DIFF_FIELDS.forEach((fieldName) => {
      const isNumericField =
        fieldName === "rowNumber"
        || BUDGET_VALUE_FIELDS.includes(fieldName);
      const beforeValue = isNumericField
        ? toBudgetNumber(originalRow[fieldName])
        : String(originalRow[fieldName] || "").trim();
      const afterValue = isNumericField
        ? toBudgetNumber(row[fieldName])
        : String(row[fieldName] || "").trim();

      if (beforeValue === afterValue) return;

      changes.push({
        rowId: row.id,
        rowLabel: row.label,
        section: row.section,
        side: row.side,
        field: fieldName,
        before: beforeValue,
        after: afterValue,
      });
    });
  });

  originalRows.forEach((row, rowId) => {
    if (nextRowsMap.has(rowId)) return;

    changes.push({
      rowId,
      rowLabel: row.label,
      section: row.section,
      side: row.side,
      field: "deleted",
      before: row.label,
      after: null,
    });
  });

  return changes;
}

function getBudgetDocumentLabel(budget) {
  return String(budget.currentEditionId || budget.editionId || "").trim();
}

function buildAllBudgetSeeds() {
  return sortBudgetDocuments(
    ["2024", ...Object.keys(BUDGET_SEED_SOURCES)].map((editionId) =>
      buildBudgetSeed({
        editionId,
        referenceEditionId: BUDGET_SEED_SOURCES[editionId]?.referenceEditionId || inferReferenceEditionId(editionId),
        includeSeedValues: true,
      }),
    ),
  );
}

function sortBudgetDocuments(budgets = []) {
  return [...budgets].sort((left, right) => {
    const rightYear = Number(getBudgetDocumentLabel(right));
    const leftYear = Number(getBudgetDocumentLabel(left));

    if (Number.isFinite(rightYear) && Number.isFinite(leftYear) && rightYear !== leftYear) {
      return rightYear - leftYear;
    }

    return String(getBudgetDocumentLabel(right)).localeCompare(String(getBudgetDocumentLabel(left)));
  });
}

export {
  BUDGET_COLLECTION,
  BUDGET_HISTORY_COLLECTION,
  EXPENSE_SECTION_ORDER,
  REVENUE_SECTION_ORDER,
  buildBudgetDiff,
  buildAllBudgetSeeds,
  applyCanonicalHistoricalBudget,
  buildBudgetSeed,
  buildSimplifiedRows,
  createBudgetRow,
  enrichBudgetWithLinkedActuals,
  getBudgetDocumentLabel,
  getBudgetTotals,
  getVisibleBudgetRows,
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
};
