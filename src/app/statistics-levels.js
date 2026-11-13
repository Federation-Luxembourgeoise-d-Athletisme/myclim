/**
 * Comparaisons par niveau du meeting (World Athletics Indoor Tour) et fiches
 * speaker. Fonctions pures : on leur passe résultats, records, vainqueurs et
 * engagés déjà chargés.
 *
 * Niveaux : sans label jusqu'en 2020, Bronze 2021–2024, Silver depuis 2025.
 * Pour un futur passage en Gold : ajouter une ligne à MEETING_LEVELS.
 */

import { eventLabel, formatPersonName } from "./statistics-compute.js";

export const MEETING_LEVELS = [
  { key: "none", label: "Sans label", labelEn: "No label", from: 0, to: 2020 },
  { key: "bronze", label: "Bronze", labelEn: "Bronze", from: 2021, to: 2024 },
  { key: "silver", label: "Silver", labelEn: "Silver", from: 2025, to: 9999 },
];

export function levelOfYear(year) {
  const y = Number(year);
  return MEETING_LEVELS.find((level) => y >= level.from && y <= level.to) || null;
}

export function levelYears(level) {
  if (level.to >= 9999) return `${level.from}+`;
  if (!level.from) return `2003–${level.to}`;
  return `${level.from}–${level.to}`;
}

// ─── Épreuves et performances ───────────────────────────────────────────────

const FIELD_RE = /jump|vault|put|throw|saut|perche|hauteur|longueur|poids|lancer/i;

/** Clé commune à « 60m Hurdles », « 60 m hurdles », « 60mH », « 60 m haies »… */
export function canonicalDiscipline(discipline) {
  let s = String(discipline || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/special olympics|\bf\d\d\b|para/.test(s)) return "";
  s = s.replace(/metres?|meters?/g, "m").replace(/\s+/g, "");
  if (/hauteur|highjump/.test(s)) return "highjump";
  if (/perche|polevault/.test(s)) return "polevault";
  if (/triple/.test(s)) return "triplejump";
  if (/longueur|longjump/.test(s)) return "longjump";
  if (/poids|shotput/.test(s)) return "shotput";
  const m = s.match(/^(\d+)m?(hurdles|haies|h)?$/);
  if (m) return `${m[1]}m${m[2] ? "hurdles" : ""}`;
  return s;
}

const EVENT_ORDER = ["50m", "60m", "60mhurdles", "200m", "400m", "800m", "1000m", "1500m", "3000m", "highjump", "polevault", "longjump", "triplejump", "shotput"];

function eventOrder(key) {
  const index = EVENT_ORDER.indexOf(key);
  return index === -1 ? 99 : index;
}

export function isFieldEvent(discipline) {
  return FIELD_RE.test(String(discipline || "")) || /jump|vault|shotput/.test(canonicalDiscipline(discipline));
}

/** « 1:48.91 » → 108.91 ; « 7,87 » → 7.87 ; « 6.55i », « 6.55 (=PB) » → 6.55 ; DNF… → null. */
export function markValue(mark) {
  const s = String(mark || "").replace(",", ".").trim().match(/^\d+(?::\d+)*(?:\.\d+)?/);
  if (!s) return null;
  const value = s[0].split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isBetter(a, b, field) {
  return field ? a > b : a < b;
}

export function formatMark(value, field) {
  if (value == null) return "";
  if (field || value < 60) return value.toFixed(2);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** Écart lisible : « 0.42 s plus vite », « 12 cm plus haut/loin ». */
function formatGap(diff, field, language) {
  const fr = language === "fr";
  const abs = Math.abs(diff);
  if (field) {
    const cm = Math.round(abs * 100);
    return fr ? `${cm} cm` : `${cm} cm`;
  }
  return fr ? `${abs.toFixed(2).replace(".", ",")} s` : `${abs.toFixed(2)} s`;
}

function eventKey(discipline, gender) {
  return `${canonicalDiscipline(discipline)}|${gender}`;
}

function didCompete(row) {
  return String(row.status || "OK").toUpperCase() === "OK";
}

function athleteKey(row) {
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
  return `${norm(row.lastName)}|${norm(row.firstName)}`;
}

function samePerson(a, b) {
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
  return Boolean(norm(a)) && norm(a) === norm(b);
}

/** « plus vite », « plus haut » (hauteur, perche) ou « plus loin » (longueur, triple, poids). */
function betterWord(key, language) {
  const fr = language === "fr";
  if (/highjump|polevault/.test(key)) return fr ? "plus haut" : "higher";
  if (/jump|shotput/.test(key)) return fr ? "plus loin" : "further";
  return fr ? "plus vite" : "faster";
}

/** Meilleure perf de chaque épreuve et de chaque édition (toutes séries confondues). */
function bestPerEventYear(results) {
  const best = new Map();
  for (const row of results) {
    if (!didCompete(row) || (row.gender !== "M" && row.gender !== "W")) continue;
    const key = eventKey(row.discipline, row.gender);
    if (key.startsWith("|")) continue;
    const value = markValue(row.result);
    if (value == null) continue;
    const field = isFieldEvent(row.discipline);
    const k = `${key}|${row.year}`;
    const current = best.get(k);
    if (!current || isBetter(value, current.value, field)) best.set(k, { key, year: Number(row.year), value, field, row });
  }
  return [...best.values()];
}

// ─── Comparaison par niveau ─────────────────────────────────────────────────

function average(values) {
  const list = values.filter((v) => v != null && Number.isFinite(v));
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/**
 * Pour chaque niveau : éditions, moyenne d'athlètes et de nations par édition,
 * records, part d'étrangers ; pour chaque épreuve : meilleure perf du niveau
 * et perf gagnante moyenne. results : meetingResults (sans les éditions annulées).
 */
export function computeLevelComparison({ results, language = "fr" }) {
  const byYear = new Map();
  for (const row of results) {
    const year = Number(row.year);
    if (!year || !levelOfYear(year)) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }

  const yearStats = [...byYear.entries()].map(([year, rows]) => {
    const competed = rows.filter((row) => String(row.status || "OK").toUpperCase() !== "DNS");
    const athletes = new Map();
    for (const row of competed) athletes.set(athleteKey(row), row);
    const list = [...athletes.values()];
    return {
      year,
      level: levelOfYear(year).key,
      athletes: list.length,
      nations: new Set(list.map((r) => r.noc).filter(Boolean)).size,
      nationSet: new Set(list.map((r) => r.noc).filter(Boolean)),
      foreign: list.filter((r) => r.noc && r.noc !== "LUX").length,
      meetingRecords: competed.filter((r) => /meeting record/i.test(String(r.notes || ""))).length,
      nationalRecords: competed.filter((r) => /national record/i.test(String(r.notes || ""))).length,
    };
  }).filter((y) => y.athletes).sort((a, b) => a.year - b.year);

  const bests = bestPerEventYear(results).filter((b) => levelOfYear(b.year));
  const seenNations = new Set();

  const levels = MEETING_LEVELS.map((level) => {
    const years = yearStats.filter((y) => y.level === level.key);
    const nationSet = new Set(years.flatMap((y) => [...y.nationSet]));
    const newNations = [...nationSet].filter((n) => !seenNations.has(n));
    newNations.forEach((n) => seenNations.add(n));
    const totalAthletes = years.reduce((s, y) => s + y.athletes, 0);
    return {
      ...level,
      editions: years.length,
      years: years.map((y) => y.year),
      avgAthletes: average(years.map((y) => y.athletes)),
      avgNations: average(years.map((y) => y.nations)),
      nations: nationSet.size,
      newNations,
      foreignShare: totalAthletes ? years.reduce((s, y) => s + y.foreign, 0) / totalAthletes : null,
      meetingRecords: years.reduce((s, y) => s + y.meetingRecords, 0),
      nationalRecords: years.reduce((s, y) => s + y.nationalRecords, 0),
      mrPerEdition: average(years.map((y) => y.meetingRecords)),
      nrPerEdition: average(years.map((y) => y.nationalRecords)),
    };
  });

  // Épreuves : meilleure perf et perf gagnante moyenne par niveau.
  const eventMap = new Map();
  for (const b of bests) {
    if (!eventMap.has(b.key)) {
      eventMap.set(b.key, { key: b.key, discipline: b.row.discipline, gender: b.row.gender, field: b.field, byLevel: {} });
    }
    const event = eventMap.get(b.key);
    const levelKey = levelOfYear(b.year).key;
    if (!event.byLevel[levelKey]) event.byLevel[levelKey] = { marks: [], best: null };
    const slot = event.byLevel[levelKey];
    slot.marks.push(b.value);
    if (!slot.best || isBetter(b.value, slot.best.value, b.field)) slot.best = b;
  }
  const events = [...eventMap.values()]
    .map((event) => {
      const byLevel = {};
      for (const level of MEETING_LEVELS) {
        const slot = event.byLevel[level.key];
        byLevel[level.key] = slot
          ? {
            editions: slot.marks.length,
            average: average(slot.marks),
            best: slot.best.value,
            bestBy: `${formatPersonName(slot.best.row)} (${slot.best.row.noc || "—"})`,
            bestYear: slot.best.year,
          }
          : null;
      }
      return { ...event, label: eventLabel(event.discipline, event.gender, language), byLevel };
    })
    // Seules les épreuves courues sous au moins deux niveaux se comparent.
    .filter((event) => Object.values(event.byLevel).filter(Boolean).length >= 2)
    .sort((a, b) => eventOrder(a.key.split("|")[0]) - eventOrder(b.key.split("|")[0]) || a.gender.localeCompare(b.gender));

  const result = { levels, yearStats, events };
  result.facts = buildLevelFacts(result, language);
  return result;
}

function fmt(n, language, digits = 0) {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: digits }).format(n);
}

/** Phrases prêtes pour le micro / la com. */
function buildLevelFacts({ levels, events }, language = "fr") {
  const fr = language === "fr";
  const tr = (a, b) => (fr ? a : b);
  const name = (level) => (fr ? level.label : level.labelEn);
  const facts = [];
  const [none, bronze, silver] = levels;
  const latest = [...levels].reverse().find((l) => l.editions);
  const base = none.editions ? none : bronze;

  if (latest && base && latest !== base && latest.avgNations && base.avgNations) {
    facts.push({
      category: tr("Nations", "Nations"),
      text: tr(
        `Depuis le passage en ${name(latest)} (${latest.from}), le meeting accueille en moyenne ${fmt(latest.avgNations, language)} nations par édition, contre ${fmt(base.avgNations, language)} ${base.key === "none" ? "avant le label World Athletics" : `en ${name(base)}`}.`,
        `Since becoming ${name(latest)} (${latest.from}), the meeting has welcomed an average of ${fmt(latest.avgNations, language)} nations per edition, against ${fmt(base.avgNations, language)} ${base.key === "none" ? "before the World Athletics label" : `as ${name(base)}`}.`,
      ),
    });
  }
  if (silver?.newNations.length && bronze?.newNations.length) {
    facts.push({
      category: tr("Nouvelles nations", "New nations"),
      text: tr(
        `${bronze.newNations.length + silver.newNations.length} pays sont venus pour la première fois depuis l'obtention du label (${bronze.newNations.length} en Bronze, ${silver.newNations.length} en Silver).`,
        `${bronze.newNations.length + silver.newNations.length} countries came for the first time since the label (${bronze.newNations.length} as Bronze, ${silver.newNations.length} as Silver).`,
      ),
    });
  }
  if (latest && base && latest !== base && latest.foreignShare != null && base.foreignShare != null) {
    facts.push({
      category: tr("International", "International"),
      text: tr(
        `${fmt(latest.foreignShare * 100, language)} % des athlètes viennent de l'étranger en ${name(latest)}, contre ${fmt(base.foreignShare * 100, language)} % ${base.key === "none" ? "avant le label" : `en ${name(base)}`}.`,
        `${fmt(latest.foreignShare * 100, language)}% of the athletes come from abroad as ${name(latest)}, against ${fmt(base.foreignShare * 100, language)}% ${base.key === "none" ? "before the label" : `as ${name(base)}`}.`,
      ),
    });
  }
  if (latest && latest.mrPerEdition != null && base && latest !== base && base.mrPerEdition != null) {
    facts.push({
      category: tr("Records du meeting", "Meeting records"),
      text: tr(
        `${fmt(latest.mrPerEdition, language, 1)} records du meeting par édition en ${name(latest)}, contre ${fmt(base.mrPerEdition, language, 1)} ${base.key === "none" ? "avant le label" : `en ${name(base)}`}.`,
        `${fmt(latest.mrPerEdition, language, 1)} meeting records per edition as ${name(latest)}, against ${fmt(base.mrPerEdition, language, 1)} ${base.key === "none" ? "before the label" : `as ${name(base)}`}.`,
      ),
    });
  }

  // Les plus gros progrès de la perf gagnante moyenne entre « sans label » et le niveau actuel.
  const gains = events
    .map((event) => {
      const from = event.byLevel[base?.key];
      const to = event.byLevel[latest?.key];
      if (!from || !to || base === latest) return null;
      const diff = event.field ? to.average - from.average : from.average - to.average;
      const relative = diff / from.average;
      return { event, from, to, diff, relative };
    })
    .filter((g) => g && g.diff > 0)
    .sort((a, b) => b.relative - a.relative)
    .slice(0, 3);
  for (const g of gains) {
    const verb = betterWord(g.event.key, language);
    facts.push({
      category: g.event.label,
      text: tr(
        `En ${name(latest)}, le ${g.event.label} se gagne en moyenne en ${formatMark(g.to.average, g.event.field)}, soit ${formatGap(g.diff, g.event.field, language)} ${verb} qu'${base.key === "none" ? "avant le label" : `en ${name(base)}`} (${formatMark(g.from.average, g.event.field)}).`,
        `As ${name(latest)}, the ${g.event.label} is won on average in ${formatMark(g.to.average, g.event.field)}: ${formatGap(g.diff, g.event.field, language)} ${verb} than ${base.key === "none" ? "before the label" : `as ${name(base)}`} (${formatMark(g.from.average, g.event.field)}).`,
      ),
    });
  }
  return facts;
}

// ─── Fiches speaker ─────────────────────────────────────────────────────────

const GENDER_SUFFIX_RE = /^(.+?)\s+(W|M|F|H|Women|Men|Femmes?|Hommes?)$/i;
const GENDER_PREFIX_RE = /^(W|M|F|H|Women|Men|Femmes?|Hommes?)\s+(.+)$/i;

function genderOf(token) {
  const g = String(token)[0].toUpperCase();
  return g === "W" || g === "F" ? "W" : "M";
}

/** « 60m W » → { discipline: "60m", gender: "W" } (même convention que la liste des engagés). */
export function parseEntryEvent(raw) {
  const s = String(raw || "").trim();
  if (!s) return { discipline: "", gender: null };
  let m = GENDER_SUFFIX_RE.exec(s);
  if (m) return { discipline: m[1].trim(), gender: genderOf(m[2]) };
  m = GENDER_PREFIX_RE.exec(s);
  if (m) return { discipline: m[2].trim(), gender: genderOf(m[1]) };
  return { discipline: s, gender: null };
}

function isPacer(athlete) {
  return /pace|lièvre|lievre|pacer/i.test(`${athlete.event || ""} ${athlete.notes || ""}`);
}

/** Historique d'un athlète au meeting (toutes épreuves) et dans l'épreuve du jour. */
function athleteHistory(rows, key, field, beforeYear) {
  const own = rows.filter((row) => Number(row.year) < Number(beforeYear) && String(row.status || "OK").toUpperCase() !== "DNS");
  const years = [...new Set(own.map((r) => Number(r.year)))].sort((a, b) => a - b);
  const inEvent = own.filter((r) => eventKey(r.discipline, r.gender) === key && didCompete(r));
  let best = null;
  for (const r of inEvent) {
    const v = markValue(r.result);
    if (v != null && (!best || isBetter(v, best.value, field))) best = { value: v, year: Number(r.year), mark: r.result };
  }
  const finals = inEvent.filter((r) => !r.round || /final/i.test(r.round));
  const ranks = finals.map((r) => Number(r.rank)).filter((n) => Number.isFinite(n) && n > 0);
  const winYears = [...new Set(finals.filter((r) => Number(r.rank) === 1).map((r) => Number(r.year)))].sort((a, b) => a - b);
  return {
    years,
    eventYears: [...new Set(inEvent.map((r) => Number(r.year)))].sort((a, b) => a - b),
    best,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    winYears,
  };
}

/**
 * Une fiche par épreuve de l'édition : record du meeting, meilleures perfs par
 * niveau, derniers vainqueurs, engagés (PB, SB, passé au meeting) et phrases
 * « à dire au micro ».
 */
export function buildSpeakerSheets({ athletes, results, records, winners, year, timetable = [], language = "fr" }) {
  const fr = language === "fr";
  const tr = (a, b) => (fr ? a : b);

  const resultsByAthlete = new Map();
  for (const row of results) {
    const k = athleteKey(row);
    if (!resultsByAthlete.has(k)) resultsByAthlete.set(k, []);
    resultsByAthlete.get(k).push(row);
  }

  const bests = bestPerEventYear(results);
  const groups = new Map();
  for (const athlete of athletes) {
    if (String(athlete.status || "").toLowerCase() === "out") continue;
    const { discipline, gender } = parseEntryEvent(athlete.event);
    if (!discipline || !gender) continue;
    const key = eventKey(discipline, gender);
    if (key.startsWith("|")) continue;
    if (!groups.has(key)) groups.set(key, { key, discipline, gender, athletes: [] });
    const group = groups.get(key);
    // Un athlète en double dans la même épreuve (série + finale importées) ne compte qu'une fois.
    if (!group.athletes.some((a) => athleteKey(a) === athleteKey(athlete))) group.athletes.push(athlete);
  }

  const currentLevel = levelOfYear(year);

  const sheets = [...groups.values()].map((group) => {
    const field = isFieldEvent(group.discipline);
    const label = eventLabel(group.discipline, group.gender, language);
    const record = records.find((r) => eventKey(r.discipline, r.gender) === group.key) || null;
    const recordValue = record ? markValue(record.mark) : null;

    const levelBests = MEETING_LEVELS.map((level) => {
      const inLevel = bests.filter((b) => b.key === group.key && levelOfYear(b.year)?.key === level.key);
      if (!inLevel.length) return { level, best: null, average: null };
      const best = inLevel.reduce((a, b) => (isBetter(b.value, a.value, field) ? b : a));
      return {
        level,
        best: { value: best.value, mark: best.row.result, name: formatPersonName(best.row), noc: best.row.noc, year: best.year },
        average: average(inLevel.map((b) => b.value)),
      };
    });

    const lastWinners = winners
      .filter((w) => eventKey(w.discipline, w.gender) === group.key)
      .sort((a, b) => Number(b.year) - Number(a.year))
      .slice(0, 3);

    const entries = group.athletes.map((athlete) => {
      const history = athleteHistory(resultsByAthlete.get(athleteKey(athlete)) || [], group.key, field, year);
      const pbValue = markValue(athlete.pbIndoor || athlete.pb || athlete.waPbIndoor);
      // Un SB à plus de 15 % du PB vient d'une autre épreuve (ex. 100 m en
      // plein air dans la colonne SB d'un 60 m) : on l'ignore pour les calculs.
      const rawSb = markValue(athlete.sb || athlete.waIndoorSbCurrent || athlete.waIndoorSb);
      const sbValue = rawSb != null && pbValue != null && Math.abs(rawSb - pbValue) / pbValue > 0.15 ? null : rawSb;
      const isRecordHolder = Boolean(record) && samePerson(formatPersonName(record), formatPersonName(athlete));
      const tags = [];
      if (isPacer(athlete)) tags.push({ kind: "muted", text: tr("lièvre", "pacer") });
      if (isRecordHolder) tags.push({ kind: "mr", text: tr("détient le record", "record holder") });
      if (history.winYears.length) tags.push({ kind: "win", text: tr(`vainqueur ${history.winYears.join(", ")}`, `won ${history.winYears.join(", ")}`) });
      if (!history.years.length) tags.push({ kind: "new", text: tr("1re fois au meeting", "first time here") });
      else if (history.years.length >= 3) tags.push({ kind: "loyal", text: tr(`${history.years.length + 1}e participation`, `${history.years.length + 1}th appearance`) });
      if (recordValue && pbValue && !isRecordHolder && isBetter(pbValue, recordValue, field)) tags.push({ kind: "threat", text: tr("PB meilleur que le record", "PB beats the record") });
      if (athlete.nationality === "LUX") tags.push({ kind: "lux", text: "LUX" });
      return { athlete, history, pbValue, sbValue, tags, pacer: isPacer(athlete) };
    }).sort((a, b) => {
      if (a.pacer !== b.pacer) return a.pacer ? 1 : -1;
      const av = a.sbValue ?? a.pbValue;
      const bv = b.sbValue ?? b.pbValue;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return field ? bv - av : av - bv;
    });

    const competitors = entries.filter((e) => !e.pacer);
    const lines = [];
    if (record) {
      const since = Number(year) - Number(record.year);
      lines.push(tr(
        `Record du meeting : ${record.mark} par ${formatPersonName(record)} (${record.noc}) en ${record.year}${since >= 5 ? `, il tient depuis ${since} ans` : ""}.`,
        `Meeting record: ${record.mark} by ${formatPersonName(record)} (${record.noc}) in ${record.year}${since >= 5 ? `, standing for ${since} years` : ""}.`,
      ));
    }
    const threats = competitors.filter((e) => e.tags.some((t) => t.kind === "threat"));
    if (threats.length) {
      lines.push(tr(
        `${threats.length === 1 ? "Un athlète a" : `${threats.length} athlètes ont`} un record personnel meilleur que le record du meeting : ${threats.map((e) => formatPersonName(e.athlete)).join(", ")}. Le record peut tomber !`,
        `${threats.length === 1 ? "One athlete has" : `${threats.length} athletes have`} a personal best better than the meeting record: ${threats.map((e) => formatPersonName(e.athlete)).join(", ")}. The record could fall!`,
      ));
    }
    const pastWinners = competitors.filter((e) => e.history.winYears.length);
    for (const e of pastWinners.slice(0, 2)) {
      const w = e.history.winYears;
      lines.push(tr(
        `${formatPersonName(e.athlete)} a déjà gagné ici (${w.join(", ")})${w[w.length - 1] === Number(year) - 1 ? " et vient défendre son titre" : ""}.`,
        `${formatPersonName(e.athlete)} has already won here (${w.join(", ")})${w[w.length - 1] === Number(year) - 1 ? " and is back to defend the title" : ""}.`,
      ));
    }
    const loyal = competitors.filter((e) => e.history.years.length >= 3).sort((a, b) => b.history.years.length - a.history.years.length)[0];
    if (loyal) {
      lines.push(tr(
        `${formatPersonName(loyal.athlete)} dispute sa ${loyal.history.years.length + 1}e édition (première venue en ${loyal.history.years[0]}).`,
        `${formatPersonName(loyal.athlete)} is competing in their ${loyal.history.years.length + 1}th edition (first visit in ${loyal.history.years[0]}).`,
      ));
    }
    const newcomers = competitors.filter((e) => !e.history.years.length).length;
    if (competitors.length >= 3 && newcomers) {
      lines.push(tr(
        `${newcomers} des ${competitors.length} athlètes découvrent le meeting.`,
        `${newcomers} of the ${competitors.length} athletes are competing here for the first time.`,
      ));
    }
    const nations = new Set(competitors.map((e) => e.athlete.nationality).filter(Boolean));
    if (nations.size >= 3) {
      lines.push(tr(`${nations.size} nations au départ.`, `${nations.size} nations on the start list.`));
    }
    // Meilleure SB au départ comparée au record du meeting.
    const topSb = competitors.filter((e) => e.sbValue != null).sort((a, b) => (field ? b.sbValue - a.sbValue : a.sbValue - b.sbValue))[0];
    if (topSb && recordValue && !threats.length) {
      const gap = field ? recordValue - topSb.sbValue : topSb.sbValue - recordValue;
      if (gap > 0) {
        lines.push(tr(
          `Meilleure perf de la saison au départ : ${formatMark(topSb.sbValue, field)} (${formatPersonName(topSb.athlete)}), à ${formatGap(gap, field, language)} du record du meeting.`,
          `Best season mark on the start list: ${formatMark(topSb.sbValue, field)} (${formatPersonName(topSb.athlete)}), ${formatGap(gap, field, language)} off the meeting record.`,
        ));
      }
    }

    // Passages de l'épreuve au programme horaire (« 16:10 Heat 1 », « 18:30 Final »).
    const slots = timetable
      .filter((row) => row?.type === "event" && row.time && eventKey(row.event, timetableGender(row.gender)) === group.key)
      .map((row) => ({ time: row.time, round: row.round || "" }))
      .sort((a, b) => a.time.localeCompare(b.time));

    return {
      key: group.key,
      label,
      field,
      gender: group.gender,
      record,
      levelBests,
      lastWinners,
      entries,
      lines,
      slots,
    };
  }).sort((a, b) => {
    // Dans l'ordre du programme horaire quand il est publié, sinon par épreuve.
    const at = a.slots[0]?.time || "99:99";
    const bt = b.slots[0]?.time || "99:99";
    return at.localeCompare(bt) || eventOrder(a.key.split("|")[0]) - eventOrder(b.key.split("|")[0]) || a.gender.localeCompare(b.gender);
  });

  return { level: currentLevel, sheets, hasTimetable: sheets.some((sheet) => sheet.slots.length) };
}

function timetableGender(value) {
  const token = String(value || "").toUpperCase();
  if (token.startsWith("W") || token.startsWith("F")) return "W";
  if (token.startsWith("M") || token.startsWith("H")) return "M";
  return "";
}

// ─── L'édition en direct ────────────────────────────────────────────────────

/**
 * Chiffres de l'édition à venir, calculés sur les engagés au fil de leur
 * arrivée et comparés à l'historique. sheets : sortie de buildSpeakerSheets.
 */
export function computeEditionLive({ sheets, results, year, editionNumber = null, language = "fr" }) {
  const fr = language === "fr";
  const tr = (a, b) => (fr ? a : b);
  const competitors = [];
  for (const sheet of sheets) {
    for (const entry of sheet.entries) {
      if (entry.pacer) continue;
      competitors.push({ ...entry, sheet });
    }
  }
  const people = new Map();
  competitors.forEach((entry) => people.set(athleteKey(entry.athlete), entry));
  const list = [...people.values()];

  const nations = new Map();
  list.forEach((entry) => {
    const noc = entry.athlete.nationality;
    if (noc) nations.set(noc, (nations.get(noc) || 0) + 1);
  });

  // Historique : nations déjà venues, dernière édition avec résultats.
  const pastNations = new Set();
  const pastByYear = new Map();
  for (const row of results) {
    const y = Number(row.year);
    if (!y || y >= Number(year) || String(row.status || "OK").toUpperCase() === "DNS") continue;
    if (row.noc) pastNations.add(row.noc);
    if (!pastByYear.has(y)) pastByYear.set(y, { athletes: new Set(), nations: new Set() });
    pastByYear.get(y).athletes.add(athleteKey(row));
    if (row.noc) pastByYear.get(y).nations.add(row.noc);
  }
  const previousYear = Math.max(0, ...pastByYear.keys()) || null;
  const previous = previousYear
    ? { year: previousYear, athletes: pastByYear.get(previousYear).athletes.size, nations: pastByYear.get(previousYear).nations.size }
    : null;
  const firstTimeNations = [...nations.keys()].filter((noc) => !pastNations.has(noc)).sort();

  const newcomers = list.filter((entry) => !entry.history.years.length);
  const returning = list.filter((entry) => entry.history.years.length);
  const lux = list.filter((entry) => entry.athlete.nationality === "LUX");
  const champions = competitors.filter((entry) => entry.history.winYears.includes(Number(year) - 1) || (previousYear && entry.history.winYears.includes(previousYear)));
  const pastWinners = competitors.filter((entry) => entry.history.winYears.length);
  const threats = competitors.filter((entry) => entry.tags.some((tag) => tag.kind === "threat"));
  const ranked = list.filter((entry) => Number(entry.athlete.worldRanking) > 0);
  const top50 = ranked.filter((entry) => Number(entry.athlete.worldRanking) <= 50);
  const withAge = list.filter((entry) => Number(entry.athlete.birthYear) > 1900);
  const youngest = withAge.reduce((best, e) => (!best || Number(e.athlete.birthYear) > Number(best.athlete.birthYear) ? e : best), null);
  const oldest = withAge.reduce((best, e) => (!best || Number(e.athlete.birthYear) < Number(best.athlete.birthYear) ? e : best), null);

  // Épreuve la plus relevée : athlètes dont la SB bat la perf gagnante moyenne Silver (sinon Bronze).
  const strength = sheets.map((sheet) => {
    const ref = [...sheet.levelBests].reverse().find((l) => l.average != null);
    if (!ref) return { sheet, count: 0, ref: null };
    const count = sheet.entries.filter((e) => !e.pacer && e.sbValue != null && (sheet.field ? e.sbValue >= ref.average : e.sbValue <= ref.average)).length;
    return { sheet, count, ref };
  }).sort((a, b) => b.count - a.count);
  const strongest = strength[0]?.count ? strength[0] : null;

  const name = (entry) => formatPersonName(entry.athlete);
  const facts = [];
  if (list.length) {
    facts.push({
      category: tr("Plateau", "Field"),
      text: tr(
        `${editionNumber ? `${editionNumber}e édition : ` : ""}${list.length} athlètes de ${nations.size} nations sont engagés pour l'instant${previous ? ` (${previous.year} : ${previous.athletes} athlètes, ${previous.nations} nations au final)` : ""}.`,
        `${editionNumber ? `Edition no. ${editionNumber}: ` : ""}${list.length} athletes from ${nations.size} nations entered so far${previous ? ` (${previous.year}: ${previous.athletes} athletes, ${previous.nations} nations in the end)` : ""}.`,
      ),
    });
  }
  if (firstTimeNations.length) {
    facts.push({
      category: tr("Nouvelles nations", "New nations"),
      text: tr(
        `${firstTimeNations.length === 1 ? "Une nation vient" : `${firstTimeNations.length} nations viennent`} pour la première fois au meeting : ${firstTimeNations.join(", ")}.`,
        `${firstTimeNations.length === 1 ? "One nation is" : `${firstTimeNations.length} nations are`} at the meeting for the first time: ${firstTimeNations.join(", ")}.`,
      ),
    });
  }
  if (champions.length) {
    facts.push({
      category: tr("Tenants du titre", "Defending champions"),
      text: tr(
        `${champions.length === 1 ? "Un vainqueur" : `${champions.length} vainqueurs`} de ${previousYear || Number(year) - 1} reviennent défendre leur titre : ${champions.map((e) => `${name(e)} (${e.sheet.label})`).join(", ")}.`,
        `${champions.length === 1 ? "One" : champions.length} ${previousYear || Number(year) - 1} winner${champions.length > 1 ? "s are" : " is"} back to defend the title: ${champions.map((e) => `${name(e)} (${e.sheet.label})`).join(", ")}.`,
      ),
    });
  }
  if (threats.length) {
    facts.push({
      category: tr("Records menacés", "Records under threat"),
      text: tr(
        `${threats.length} athlète${threats.length > 1 ? "s ont" : " a"} un record personnel meilleur que le record du meeting de son épreuve : ${threats.map((e) => `${name(e)} (${e.sheet.label})`).join(", ")}.`,
        `${threats.length} athlete${threats.length > 1 ? "s have" : " has"} a personal best better than the meeting record of their event: ${threats.map((e) => `${name(e)} (${e.sheet.label})`).join(", ")}.`,
      ),
    });
  }
  if (strongest) {
    facts.push({
      category: tr("Épreuve la plus relevée", "Strongest event"),
      text: tr(
        `${strongest.sheet.label} : ${strongest.count} athlète${strongest.count > 1 ? "s ont" : " a"} déjà fait mieux cette saison que la perf gagnante moyenne en ${strongest.ref.level.label} (${formatMark(strongest.ref.average, strongest.sheet.field)}).`,
        `${strongest.sheet.label}: ${strongest.count} athlete${strongest.count > 1 ? "s have" : " has"} already done better this season than the average ${strongest.ref.level.labelEn} winning mark (${formatMark(strongest.ref.average, strongest.sheet.field)}).`,
      ),
    });
  }
  if (list.length >= 5) {
    facts.push({
      category: tr("Fidélité", "Loyalty"),
      text: tr(
        `${newcomers.length} athlètes découvrent le meeting, ${returning.length} y sont déjà venus${pastWinners.length ? `, dont ${pastWinners.length} anciens vainqueurs` : ""}.`,
        `${newcomers.length} athletes are new to the meeting, ${returning.length} have been here before${pastWinners.length ? `, including ${pastWinners.length} former winners` : ""}.`,
      ),
    });
  }
  if (lux.length) {
    facts.push({
      category: "Luxembourg",
      text: tr(
        `${lux.length} athlète${lux.length > 1 ? "s" : ""} luxembourgeois au départ : ${lux.map(name).join(", ")}.`,
        `${lux.length} Luxembourg athlete${lux.length > 1 ? "s" : ""} on the start lists: ${lux.map(name).join(", ")}.`,
      ),
    });
  }
  if (top50.length) {
    facts.push({
      category: tr("Classement mondial", "World ranking"),
      text: tr(
        `${top50.length} athlète${top50.length > 1 ? "s" : ""} du top 50 mondial dans ${top50.length > 1 ? "leur" : "son"} épreuve.`,
        `${top50.length} athlete${top50.length > 1 ? "s" : ""} ranked in the world top 50 of their event.`,
      ),
    });
  }
  if (youngest && oldest && youngest !== oldest) {
    facts.push({
      category: tr("Âges", "Ages"),
      text: tr(
        `Le plus jeune : ${name(youngest)} (né·e en ${youngest.athlete.birthYear}). Le plus expérimenté : ${name(oldest)} (né·e en ${oldest.athlete.birthYear}).`,
        `Youngest: ${name(youngest)} (born ${youngest.athlete.birthYear}). Most experienced: ${name(oldest)} (born ${oldest.athlete.birthYear}).`,
      ),
    });
  }

  return {
    athletes: list.length,
    nations: nations.size,
    nationCounts: [...nations.entries()].sort((a, b) => b[1] - a[1]),
    women: list.filter((e) => e.sheet.gender === "W").length,
    men: list.filter((e) => e.sheet.gender === "M").length,
    events: sheets.length,
    previous,
    firstTimeNations,
    newcomers: newcomers.length,
    returning: returning.length,
    lux: lux.length,
    champions,
    threats,
    top50: top50.length,
    facts,
  };
}
