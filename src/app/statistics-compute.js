/**
 * Calculs du module Statistiques (Vue d'ensemble), sans React ni Firebase :
 * on leur passe les résultats, records, vainqueurs et éditions déjà chargés.
 *
 * Conventions des données (meetingResults) :
 *  - status "OK" = a concouru ; DNS = n'a pas pris le départ (exclu des
 *    comptages de participants) ; DNF/DSQ/NM comptent comme participants.
 *  - notes : "Meeting Record", "National Record", "National Record Indoor"…
 *    (« National Best Uxx » ne compte pas comme record national).
 *  - un athlète est identifié par nom + prénom (l'année de naissance manque
 *    souvent dans l'historique).
 */

import { getEditionDisplayNumber } from "./meeting-edition-utils.js";

const DISCIPLINE_FR = {
  "50m": "50 m",
  "60m": "60 m",
  "60m hurdles": "60 m haies",
  "200m": "200 m",
  "400m": "400 m",
  "400m hurdles": "400 m haies",
  "800m": "800 m",
  "1000m": "1000 m",
  "1500m": "1500 m",
  "3000m": "3000 m",
  "5000m": "5000 m",
  "high jump": "saut en hauteur",
  "pole vault": "saut à la perche",
  "long jump": "saut en longueur",
  "triple jump": "triple saut",
  "shot put": "lancer du poids",
};

function disciplineKey(discipline) {
  return String(discipline || "").replace(/(\d)\s+m\b/gi, "$1m").trim().toLowerCase();
}

const DISCIPLINE_EN = {
  "50m": "50 m",
  "60m": "60 m",
  "60m hurdles": "60 m hurdles",
  "200m": "200 m",
  "400m": "400 m",
  "400m hurdles": "400 m hurdles",
  "800m": "800 m",
  "1000m": "1000 m",
  "1500m": "1500 m",
  "3000m": "3000 m",
  "5000m": "5000 m",
  "high jump": "high jump",
  "pole vault": "pole vault",
  "long jump": "long jump",
  "triple jump": "triple jump",
  "shot put": "shot put",
};

// language : langue de l'appli ("fr" = français, sinon anglais).
export function disciplineLabel(discipline, language = "fr") {
  const labels = language === "fr" ? DISCIPLINE_FR : DISCIPLINE_EN;
  const key = disciplineKey(discipline);
  if (labels[key]) return labels[key];
  // « 200m - Special Olympics », « Shot Put F42 »… : on traduit la base.
  const base = Object.keys(labels).find((k) => key.startsWith(`${k} `));
  return base ? `${labels[base]}${String(discipline).slice(base.length)}` : String(discipline || "");
}

export function genderLabel(gender, { short = false, language = "fr" } = {}) {
  const fr = language === "fr";
  if (gender === "M") return short ? (fr ? "H" : "M") : (fr ? "hommes" : "men");
  if (gender === "W") return short ? (fr ? "F" : "W") : (fr ? "femmes" : "women");
  return short ? "" : (fr ? "mixte" : "mixed");
}

export function eventLabel(discipline, gender, language = "fr") {
  if (gender !== "M" && gender !== "W") return disciplineLabel(discipline, language);
  return `${disciplineLabel(discipline, language)} ${genderLabel(gender, { language })}`;
}

function athleteKey(row) {
  return `${String(row.lastName || "").trim().toLowerCase()}|${String(row.firstName || "").trim().toLowerCase()}`;
}

// « VAN DER WEKEN » → « Van Der Weken », « O'CONNOR-SMITH » → « O'Connor-Smith ».
// Particules en minuscules sauf en tête : « VAN DER WEKEN » → « Van der Weken ».
const NAME_PARTICLES = new Set(["van", "der", "den", "de", "del", "della", "di", "da", "du", "des", "le", "la", "von", "zu", "dos", "das"]);

function titleCase(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase())
    .split(" ")
    .map((word, index) => (index > 0 && NAME_PARTICLES.has(word.toLowerCase()) ? word.toLowerCase() : word))
    .join(" ");
}

function isUpperWord(word) {
  return /\p{L}/u.test(word) && word === word.toUpperCase();
}

export function formatPersonName(row) {
  let last = String(row.lastName || "").trim();
  let first = String(row.firstName || "").trim();
  if (!last && row.fullName) {
    // Records : « KIMUTAI Sylas » (nom en majuscules puis prénom).
    const words = String(row.fullName).trim().split(/\s+/);
    const split = words.findIndex((w) => !isUpperWord(w));
    if (split <= 0) return titleCase(row.fullName);
    last = words.slice(0, split).join(" ");
    first = words.slice(split).join(" ");
  }
  const lastNice = isUpperWord(last) || last === last.toLowerCase() ? titleCase(last) : last;
  return [first, lastNice].filter(Boolean).join(" ");
}

function didCompete(row) {
  return String(row.status || "OK").toUpperCase() !== "DNS";
}

export function isMeetingRecordNote(notes) {
  return /meeting record/i.test(String(notes || ""));
}

export function isNationalRecordNote(notes) {
  return /national record/i.test(String(notes || ""));
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

/** Statistiques d'une édition (ou null si aucune donnée pour cette année). */
function summarizeYear(rows) {
  const competed = rows.filter(didCompete);
  if (!competed.length) return null;
  const athletes = new Map();
  for (const row of competed) athletes.set(athleteKey(row), row);
  const nations = countBy([...athletes.values()], (row) => row.noc);
  return {
    athletes: athletes.size,
    nations: nations.size,
    nationCounts: nations,
    meetingRecords: competed.filter((row) => isMeetingRecordNote(row.notes)).length,
    nationalRecords: competed.filter((row) => isNationalRecordNote(row.notes)).length,
    luxAthletes: [...athletes.values()].filter((row) => row.noc === "LUX").length,
  };
}

function groupByYear(results) {
  const byYear = new Map();
  for (const row of results) {
    const year = Number(row.year);
    if (!year) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }
  return byYear;
}

/** Vainqueurs regroupés par athlète, du plus titré au moins titré. */
function topWinners(winners, limit = 5, language = "fr") {
  const byAthlete = new Map();
  for (const w of winners) {
    const key = athleteKey(w);
    if (key === "|") continue;
    if (!byAthlete.has(key)) byAthlete.set(key, { name: formatPersonName(w), noc: w.noc, wins: [] });
    byAthlete.get(key).wins.push(w);
  }
  return [...byAthlete.values()]
    .filter((a) => a.wins.length > 1)
    .map((a) => ({
      ...a,
      years: [...new Set(a.wins.map((w) => Number(w.year)))].sort((x, y) => x - y),
      events: [...new Set(a.wins.map((w) => eventLabel(w.discipline, w.gender, language)))],
    }))
    .sort((a, b) => b.wins.length - a.wins.length || a.years[0] - b.years[0])
    .slice(0, limit);
}

/**
 * Statistiques toutes éditions confondues.
 * editions : meetingEditions (pour exclure les années masquées et
 * annulées) ; currentYear : année de référence pour « tient depuis N ans » ;
 * language : langue des libellés et des faits ("fr", sinon anglais).
 */
export function computeAllTimeStats({ results, records, winners, editions, currentYear = new Date().getFullYear(), language = "fr" }) {
  const hiddenYears = new Set(editions.filter((e) => e.cancelled).map((e) => Number(e.year)));
  const usable = results.filter((row) => !hiddenYears.has(Number(row.year)));
  const byYear = groupByYear(usable);
  const perYear = [...byYear.entries()]
    .map(([year, rows]) => ({ year, ...summarizeYear(rows) }))
    .filter((y) => y.athletes)
    .sort((a, b) => a.year - b.year);

  const competed = usable.filter(didCompete);
  const athletes = new Map();
  for (const row of competed) if (!athletes.has(athleteKey(row))) athletes.set(athleteKey(row), row);

  // Nations : athlètes différents par pays (toutes éditions).
  const nationAthletes = countBy([...athletes.values()], (row) => row.noc);
  const nations = [...nationAthletes.entries()].sort((a, b) => b[1] - a[1]);

  const mrPerformances = competed.filter((row) => isMeetingRecordNote(row.notes));
  const nrPerformances = competed.filter((row) => isNationalRecordNote(row.notes));

  const oldestRecords = [...records]
    .filter((r) => Number(r.year))
    .sort((a, b) => Number(a.year) - Number(b.year))
    .slice(0, 5);

  const lux = competed.filter((row) => row.noc === "LUX");
  const luxParticipations = new Set(lux.map((row) => `${row.year}|${athleteKey(row)}`));
  const luxWins = winners.filter((w) => w.noc === "LUX");
  const luxNationalRecords = nrPerformances.filter((row) => row.noc === "LUX");

  const firstYear = perYear[0]?.year ?? null;
  // Numéro officiel de la dernière édition disputée (2026 = 23e, 2022 ne
  // compte pas — voir meeting-edition-utils) : les éditions à venir ne
  // comptent pas encore ; sans numéro, le nombre d'années avec résultats.
  const lastYear = perYear[perYear.length - 1]?.year;
  const lastEditionNumber = Math.max(0, ...editions.filter((e) => Number(e.year) <= lastYear).map((e) => getEditionDisplayNumber(e) || 0));
  const editionCount = lastEditionNumber || perYear.length;
  const biggestEdition = perYear.reduce((best, y) => (!best || y.athletes > best.athletes ? y : best), null);
  const mostRecordsEdition = perYear.reduce((best, y) => (!best || y.meetingRecords > best.meetingRecords ? y : best), null);

  const stats = {
    firstYear,
    editionCount,
    athleteCount: athletes.size,
    nationCount: nations.length,
    meetingRecordCount: records.length,
    meetingRecordPerformances: mrPerformances.length,
    nationalRecordPerformances: nrPerformances.length,
    nationalRecordNations: new Set(nrPerformances.map((row) => row.noc).filter(Boolean)).size,
    perYear,
    nations,
    oldestRecords,
    topWinners: topWinners(winners, 5, language),
    lux: {
      athletes: nationAthletes.get("LUX") || 0,
      participations: luxParticipations.size,
      wins: luxWins.length,
      winners: topWinners(luxWins, 3, language),
      nationalRecords: luxNationalRecords.length,
      lastNationalRecord: [...luxNationalRecords].sort((a, b) => Number(b.year) - Number(a.year))[0] || null,
    },
    biggestEdition,
    mostRecordsEdition,
  };
  stats.facts = buildFacts(stats, currentYear, language);
  return stats;
}

function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

function formatNumber(n, language = "fr") {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-GB").format(n);
}

/** Phrases prêtes pour la com, dans l'ordre d'intérêt (en français, sinon en anglais). */
function buildFacts(stats, currentYear, language = "fr") {
  const fr = language === "fr";
  const tr = (frText, enText) => (fr ? frText : enText);
  const facts = [];
  if (stats.firstYear) {
    facts.push({
      category: tr("Chiffres clés", "Key figures"),
      text: tr(
        `${stats.editionCount} éditions depuis ${stats.firstYear} : ${formatNumber(stats.athleteCount, language)} athlètes venus de ${stats.nationCount} nations.`,
        `${stats.editionCount} editions since ${stats.firstYear}: ${formatNumber(stats.athleteCount, language)} athletes from ${stats.nationCount} nations.`,
      ),
    });
  }
  const oldest = stats.oldestRecords[0];
  if (oldest) {
    const years = currentYear - Number(oldest.year);
    const event = eventLabel(oldest.discipline, oldest.gender, language);
    facts.push({
      category: tr("Record le plus ancien", "Oldest record"),
      text: tr(
        `Le record du meeting du ${event} (${oldest.mark}, ${formatPersonName(oldest)}, ${oldest.noc}) tient depuis ${oldest.year}${years > 1 ? ` : ${years} ans sans être battu` : ""}.`,
        `The ${event} meeting record (${oldest.mark}, ${formatPersonName(oldest)}, ${oldest.noc}) has stood since ${oldest.year}${years > 1 ? `: ${years} years unbeaten` : ""}.`,
      ),
    });
  }
  const top = stats.topWinners[0];
  if (top) {
    facts.push({
      category: tr("Le plus de victoires", "Most wins"),
      text: tr(
        `${top.name} (${top.noc}) a gagné ${top.wins.length} fois au meeting (${top.events.join(", ")} — ${top.years.join(", ")}).`,
        `${top.name} (${top.noc}) has won ${top.wins.length} times at the meeting (${top.events.join(", ")} — ${top.years.join(", ")}).`,
      ),
    });
  }
  if (stats.lux.wins || stats.lux.nationalRecords) {
    const parts = [];
    if (stats.lux.wins) {
      parts.push(fr
        ? plural(stats.lux.wins, "victoire luxembourgeoise", "victoires luxembourgeoises")
        : plural(stats.lux.wins, "Luxembourg win", "Luxembourg wins"));
    }
    if (stats.lux.nationalRecords) {
      parts.push(fr
        ? plural(stats.lux.nationalRecords, "record national luxembourgeois battu", "records nationaux luxembourgeois battus")
        : plural(stats.lux.nationalRecords, "Luxembourg national record broken", "Luxembourg national records broken"));
    }
    facts.push({
      category: "Luxembourg",
      text: tr(
        `${parts.join(" et ")} au meeting depuis ${stats.firstYear}.`,
        `${parts.join(" and ")} at the meeting since ${stats.firstYear}.`,
      ),
    });
  }
  if (stats.nationalRecordPerformances) {
    facts.push({
      category: tr("Records nationaux", "National records"),
      text: tr(
        `${stats.nationalRecordPerformances} records nationaux battus au meeting, pour ${stats.nationalRecordNations} pays différents.`,
        `${plural(stats.nationalRecordPerformances, "national record", "national records")} broken at the meeting, for ${plural(stats.nationalRecordNations, "country", "different countries")}.`,
      ),
    });
  }
  if (stats.biggestEdition) {
    facts.push({
      category: tr("Édition record", "Record edition"),
      text: tr(
        `${stats.biggestEdition.year} est l'édition la plus fournie : ${stats.biggestEdition.athletes} athlètes de ${stats.biggestEdition.nations} nations.`,
        `${stats.biggestEdition.year} is the biggest edition: ${stats.biggestEdition.athletes} athletes from ${stats.biggestEdition.nations} nations.`,
      ),
    });
  }
  if (stats.mostRecordsEdition?.meetingRecords > 1) {
    facts.push({
      category: tr("Records du meeting", "Meeting records"),
      text: tr(
        `En ${stats.mostRecordsEdition.year}, ${stats.mostRecordsEdition.meetingRecords} records du meeting sont tombés en une seule édition.`,
        `In ${stats.mostRecordsEdition.year}, ${stats.mostRecordsEdition.meetingRecords} meeting records fell in a single edition.`,
      ),
    });
  }
  return facts;
}

/** Statistiques d'une édition, comparées à l'édition précédente qui a des résultats. */
export function computeEditionStats({ results, winners, year }) {
  const byYear = groupByYear(results);
  const rows = byYear.get(Number(year)) || [];
  const current = summarizeYear(rows);
  const previousYear = [...byYear.keys()].filter((y) => y < Number(year) && summarizeYear(byYear.get(y))).sort((a, b) => b - a)[0] ?? null;
  const previous = previousYear ? summarizeYear(byYear.get(previousYear)) : null;
  const competed = rows.filter(didCompete);
  return {
    year: Number(year),
    current,
    previousYear,
    previous,
    records: competed
      .filter((row) => isMeetingRecordNote(row.notes) || isNationalRecordNote(row.notes))
      .map((row) => ({ ...row, isMeetingRecord: isMeetingRecordNote(row.notes), isNationalRecord: isNationalRecordNote(row.notes) })),
    winners: winners.filter((w) => Number(w.year) === Number(year)),
    nations: current ? [...current.nationCounts.entries()].sort((a, b) => b[1] - a[1]) : [],
  };
}

/** Index de recherche : athlètes, épreuves et éditions (libellés dans language). */
export function buildSearchIndex({ results, editions, language = "fr" }) {
  const athletes = new Map();
  const events = new Map();
  for (const row of results) {
    const key = athleteKey(row);
    if (key !== "|") {
      if (!athletes.has(key)) athletes.set(key, { name: formatPersonName(row), lastName: row.lastName, firstName: row.firstName, noc: row.noc, years: new Set() });
      athletes.get(key).years.add(Number(row.year));
    }
    const eventKey = `${disciplineKey(row.discipline)}|${row.gender}`;
    if (!events.has(eventKey)) events.set(eventKey, { discipline: row.discipline, gender: row.gender, label: eventLabel(row.discipline, row.gender, language), years: new Set() });
    events.get(eventKey).years.add(Number(row.year));
  }
  return {
    athletes: [...athletes.values()].map((a) => ({ ...a, years: [...a.years].sort((x, y) => y - x) })),
    events: [...events.values()].map((e) => ({ ...e, years: [...e.years].sort((x, y) => y - x) })),
    years: editions.filter((e) => !e.cancelled).map((e) => Number(e.year)).sort((a, b) => b - a),
  };
}

function normalizeSearch(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function searchStatistics(index, query, limit = 6) {
  const q = normalizeSearch(query);
  if (!q) return { athletes: [], events: [], years: [] };
  const words = q.split(/\s+/);
  const matchAll = (text) => {
    const hay = normalizeSearch(text);
    return words.every((w) => hay.includes(w));
  };
  return {
    athletes: index.athletes.filter((a) => matchAll(`${a.firstName} ${a.lastName} ${a.noc}`)).slice(0, limit),
    events: index.events.filter((e) => matchAll(`${e.label} ${e.discipline}`)).slice(0, limit),
    years: index.years.filter((y) => String(y).includes(q)).slice(0, limit),
  };
}

export function eventAnchorId(discipline, gender) {
  return `evt-${disciplineKey(discipline).replace(/[^a-z0-9]+/g, "-")}-${gender || "x"}`;
}
