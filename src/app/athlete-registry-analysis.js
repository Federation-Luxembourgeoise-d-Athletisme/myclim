// Analyse de la base athlètes (athleteRegistry) : statistiques par fiche,
// fiches suspectes à nettoyer, filtres, tris et détection rapide des doublons.
// Fonctions pures, sans Firestore.

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizePhoneticToken(value) {
  return normalizeToken(value)
    .replace(/sch/g, "s")
    .replace(/sh/g, "s")
    .replace(/ch/g, "s")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/cq/g, "k")
    .replace(/qu/g, "k")
    .replace(/q/g, "k")
    .replace(/ou/g, "u")
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1");
}

function isFinalRound(round) {
  const value = String(round || "").trim().toLowerCase();
  return !value || value.startsWith("final");
}

function getBirthYear(entry) {
  const raw = entry?.birthYear ?? entry?.yob ?? (entry?.birthDate ? String(entry.birthDate).slice(0, 4) : null);
  const year = Number(raw);
  return Number.isFinite(year) && year > 1900 ? year : null;
}

// Résumé d'une fiche : années, épreuves, meilleure place en finale, podiums.
function getRegistryEntryStats(entry) {
  const editions = Array.isArray(entry?.editions) ? entry.editions : [];
  const years = [...new Set(editions.map((edition) => Number(edition?.year)).filter(Boolean))].sort((a, b) => a - b);
  const disciplines = [...new Set(editions.map((edition) => edition?.discipline).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  const finalRanks = editions
    .filter((edition) => isFinalRound(edition?.round) && String(edition?.status || "OK").toUpperCase() === "OK")
    .map((edition) => Number(edition?.rank))
    .filter((rank) => Number.isFinite(rank) && rank > 0);
  const genders = [...new Set([entry?.gender, ...editions.map((edition) => edition?.gender)].filter(Boolean))];

  return {
    years,
    editionCount: years.length,
    firstYear: years[0] || null,
    lastYear: years[years.length - 1] || null,
    disciplines,
    bestFinalRank: finalRanks.length ? Math.min(...finalRanks) : null,
    wins: finalRanks.filter((rank) => rank === 1).length,
    podiums: finalRanks.filter((rank) => rank <= 3).length,
    gender: genders[0] || "",
    birthYear: getBirthYear(entry),
  };
}

// Mots qui trahissent une épreuve ou une ligne d'en-tête importée à la place d'un nom.
const EVENT_WORD_PATTERN =
  /\b(hurdles?|haies|relay|relais|heat|heats|serie|series|final|finale|women|men|hommes|femmes|jump|saut|vault|perche|shot|poids|sprint|metres?|meters?|lane|couloir|result|resultat|rank|place)\b/i;
const DISTANCE_PATTERN = /\b\d+\s?(m|km|mh|x\d+)\b|^\d+$/i;

// Raisons pour lesquelles une fiche a l'air fausse (vide = fiche saine).
// linkedCount = engagés de l'édition en cours liés à la fiche.
function getRegistrySuspectReasons(entry, { linkedCount = 0 } = {}) {
  const reasons = [];
  const lastName = String(entry?.lastName || "").trim();
  const firstName = String(entry?.firstName || "").trim();
  const fullName = `${lastName} ${firstName}`.trim();

  if (!lastName || !firstName) reasons.push(!lastName && !firstName ? "Sans nom" : !lastName ? "Nom vide" : "Prénom vide");
  if (DISTANCE_PATTERN.test(fullName)) reasons.push("Ressemble à une épreuve");
  else if (/\d/.test(fullName)) reasons.push("Chiffres dans le nom");
  if (EVENT_WORD_PATTERN.test(fullName)) reasons.push("Mot d'épreuve dans le nom");
  if (lastName && firstName && normalizeToken(lastName) === normalizeToken(firstName)) reasons.push("Nom = prénom");
  if (fullName && fullName.replace(/[^\p{L}]/gu, "").length <= 2) reasons.push("Nom trop court");
  if (entry?.nationality && !/^[A-Z]{3}$/.test(String(entry.nationality).trim())) reasons.push("Nationalité non standard");
  const editions = Array.isArray(entry?.editions) ? entry.editions : [];
  if (!editions.length && !entry?.waid && !linkedCount) reasons.push("Ni résultat ni WAID");

  return [...new Set(reasons)];
}

// Les raisons restent en français (clés) ; libellé anglais à l'affichage.
const REGISTRY_SUSPECT_REASONS_EN = {
  "Sans nom": "No name",
  "Nom vide": "Empty last name",
  "Prénom vide": "Empty first name",
  "Ressemble à une épreuve": "Looks like an event",
  "Chiffres dans le nom": "Digits in the name",
  "Mot d'épreuve dans le nom": "Event word in the name",
  "Nom = prénom": "Last name = first name",
  "Nom trop court": "Name too short",
  "Nationalité non standard": "Non-standard nationality",
  "Ni résultat ni WAID": "No result and no WAID",
};

function registrySuspectReasonLabel(reason, tr) {
  return tr(reason, REGISTRY_SUSPECT_REASONS_EN[reason] || reason);
}

const REGISTRY_SORTS = [
  { value: "name", label: "Nom (A → Z)", labelEn: "Last name (A → Z)" },
  { value: "editions", label: "Nombre d'éditions", labelEn: "Number of editions" },
  { value: "lastYear", label: "Dernière participation", labelEn: "Last participation" },
  { value: "firstYear", label: "Première participation", labelEn: "First participation" },
  { value: "podiums", label: "Podiums en finale", labelEn: "Podiums in finals" },
  { value: "bestRank", label: "Meilleure place en finale", labelEn: "Best place in a final" },
  { value: "birthYear", label: "Année de naissance", labelEn: "Year of birth" },
  { value: "nationality", label: "Nationalité", labelEn: "Nationality" },
];

function compareNullableNumbers(left, right, direction) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction * (left - right);
}

function compareByName(a, b) {
  const last = String(a.lastName || "").localeCompare(String(b.lastName || ""), "fr", { sensitivity: "base" });
  return last || String(a.firstName || "").localeCompare(String(b.firstName || ""), "fr", { sensitivity: "base" });
}

// rows = [{ entry, stats }] ; direction 1 = croissant, -1 = décroissant.
function sortRegistryRows(rows, sortKey, direction = 1) {
  const sorted = [...rows];
  const byName = (left, right) => compareByName(left.entry, right.entry);
  const comparators = {
    name: (left, right) => direction * byName(left, right),
    nationality: (left, right) =>
      direction * String(left.entry.nationality || "~").localeCompare(String(right.entry.nationality || "~")) ||
      byName(left, right),
    editions: (left, right) => compareNullableNumbers(left.stats.editionCount, right.stats.editionCount, direction),
    lastYear: (left, right) => compareNullableNumbers(left.stats.lastYear, right.stats.lastYear, direction),
    firstYear: (left, right) => compareNullableNumbers(left.stats.firstYear, right.stats.firstYear, direction),
    podiums: (left, right) => compareNullableNumbers(left.stats.podiums, right.stats.podiums, direction),
    bestRank: (left, right) => compareNullableNumbers(left.stats.bestFinalRank, right.stats.bestFinalRank, direction),
    birthYear: (left, right) => compareNullableNumbers(left.stats.birthYear, right.stats.birthYear, direction),
  };
  const comparator = comparators[sortKey] || comparators.name;
  return sorted.sort((left, right) => comparator(left, right) || byName(left, right));
}

// Sens par défaut d'un tri : les chiffres « plus = mieux » d'abord en décroissant.
function getDefaultSortDirection(sortKey) {
  return ["editions", "lastYear", "podiums"].includes(sortKey) ? -1 : 1;
}

function countBy(values) {
  const counts = new Map();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

// Statistiques d'un ensemble de fiches (celui qui correspond aux filtres).
function buildRegistryAnalysis(rows) {
  const athletesPerYear = new Map();
  const newcomersPerYear = new Map();
  rows.forEach(({ stats }) => {
    stats.years.forEach((year) => athletesPerYear.set(year, (athletesPerYear.get(year) || 0) + 1));
    if (stats.firstYear) newcomersPerYear.set(stats.firstYear, (newcomersPerYear.get(stats.firstYear) || 0) + 1);
  });
  const years = [...athletesPerYear.keys()].sort((a, b) => a - b);

  return {
    total: rows.length,
    withWaid: rows.filter(({ entry }) => entry.waid).length,
    participations: rows.reduce((sum, { stats }) => sum + stats.editionCount, 0),
    returning: rows.filter(({ stats }) => stats.editionCount >= 2).length,
    nations: countBy(rows.map(({ entry }) => String(entry.nationality || "").trim())),
    genders: countBy(rows.map(({ stats }) => stats.gender)),
    disciplines: countBy(rows.flatMap(({ stats }) => stats.disciplines)),
    loyalty: countBy(rows.map(({ stats }) => (stats.editionCount >= 5 ? "5+" : String(stats.editionCount)))),
    perYear: years.map((year) => ({
      year,
      athletes: athletesPerYear.get(year) || 0,
      newcomers: newcomersPerYear.get(year) || 0,
    })),
    mostLoyal: [...rows]
      .filter(({ stats }) => stats.editionCount > 1)
      .sort((a, b) => b.stats.editionCount - a.stats.editionCount || compareByName(a.entry, b.entry))
      .slice(0, 10),
    mostPodiums: [...rows]
      .filter(({ stats }) => stats.podiums > 0)
      .sort((a, b) => b.stats.podiums - a.stats.podiums || b.stats.wins - a.stats.wins || compareByName(a.entry, b.entry))
      .slice(0, 10),
  };
}

// Levenshtein borné : s'arrête dès que la distance dépasse max.
function boundedLevenshtein(left, right, max) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > max) return max + 1;
  let previous = new Array(right.length + 1);
  let current = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j++) previous[j] = j;
  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

// Même règle que areVariantDuplicateTokens (proche ou phonétiquement proche),
// sur des jetons déjà normalisés.
function areVariantTokens(token, otherToken, phonetic, otherPhonetic) {
  if (token && otherToken) {
    if (token === otherToken) return true;
    if (token.startsWith(otherToken) || otherToken.startsWith(token)) {
      if (Math.abs(token.length - otherToken.length) <= 2) return true;
    } else if (boundedLevenshtein(token, otherToken, 2) <= 2) {
      return true;
    }
  }
  if (!phonetic || !otherPhonetic) return false;
  if (phonetic === otherPhonetic) return true;
  if (phonetic.length <= 2 || otherPhonetic.length <= 2) return false;
  return boundedLevenshtein(phonetic, otherPhonetic, 1) <= 1;
}

// Paires candidates aux doublons : même WAID, même profil WA, ou nom ET prénom
// proches sans années de naissance contradictoires. Toutes les règles de
// getDuplicateMatchReason exigent l'une de ces conditions ; la règle complète
// n'est donc appliquée qu'à ces paires, au lieu de toutes les paires.
function findDuplicateCandidatePairs(registry) {
  const prepared = registry.map((entry) => ({
    entry,
    last: normalizeToken(entry.lastName),
    first: normalizeToken(entry.firstName),
    phLast: normalizePhoneticToken(entry.lastName),
    phFirst: normalizePhoneticToken(entry.firstName),
    birth: getBirthYear(entry),
    waid: entry.waid != null && entry.waid !== "" ? String(entry.waid) : "",
    waUrl: String(entry.waUrl || "").trim(),
  }));

  const pairs = [];
  for (let i = 0; i < prepared.length; i++) {
    const left = prepared[i];
    for (let j = i + 1; j < prepared.length; j++) {
      const right = prepared[j];
      if ((left.waid && left.waid === right.waid) || (left.waUrl && left.waUrl === right.waUrl)) {
        pairs.push([left.entry, right.entry]);
        continue;
      }
      if (left.birth && right.birth && left.birth !== right.birth) continue;
      if (!areVariantTokens(left.last, right.last, left.phLast, right.phLast)) continue;
      if (!areVariantTokens(left.first, right.first, left.phFirst, right.phFirst)) continue;
      pairs.push([left.entry, right.entry]);
    }
  }
  return pairs;
}

export {
  REGISTRY_SORTS,
  buildRegistryAnalysis,
  findDuplicateCandidatePairs,
  getDefaultSortDirection,
  getRegistryEntryStats,
  getRegistrySuspectReasons,
  registrySuspectReasonLabel,
  sortRegistryRows,
};
