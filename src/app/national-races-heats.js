// Séries et couloirs des courses nationales. Module sans dépendance (testé
// sous node dans tests/national-races-heats.test.js).
// - L'admin fixe, par course et par édition, le nombre de séries (et le
//   nombre de couloirs / positions de départ) : nationalRaceConfigs/{édition}.
// - La commission des athlètes place chaque athlète retenu (et le lièvre)
//   dans une série et un couloir : champs heat / lane de la demande.

const NATIONAL_RACE_CONFIG_COLLECTION = "nationalRaceConfigs";
const NATIONAL_RACE_DEFAULT_HEATS = 1;
const NATIONAL_RACE_DEFAULT_LANES = 8;
const NATIONAL_RACE_MAX_HEATS = 6;
const NATIONAL_RACE_MAX_LANES = 10;

function toBoundedInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, max);
}

// { NAT60F: { heats, lanes }, ... } avec les valeurs par défaut des
// définitions (1 série, couloirs de la course) pour les courses non réglées.
function normalizeNationalRaceConfig(data, definitions = []) {
  const races = data?.races || {};
  return Object.fromEntries(
    definitions.map((race) => {
      const defaultLanes = toBoundedInteger(race.lanes, NATIONAL_RACE_DEFAULT_LANES, NATIONAL_RACE_MAX_LANES);
      const saved = races[race.code] || {};
      return [
        race.code,
        {
          heats: toBoundedInteger(saved.heats, NATIONAL_RACE_DEFAULT_HEATS, NATIONAL_RACE_MAX_HEATS),
          lanes: toBoundedInteger(saved.lanes, defaultLanes, NATIONAL_RACE_MAX_LANES),
        },
      ];
    }),
  );
}

function getAssignedNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : null;
}

function hasNationalRaceLane(request) {
  return getAssignedNumber(request?.heat) !== null && getAssignedNumber(request?.lane) !== null;
}

// Seuls les retenus (athlètes et lièvres) occupent un couloir.
function isPlaceable(request) {
  return request?.status === "selected";
}

// Vérifie un placement avant de l'écrire. heat / lane à null = retirer le
// placement (toujours permis). Codes d'erreur :
// - heat_out_of_range / lane_out_of_range : hors du réglage de la course ;
// - lane_taken : couloir déjà pris dans cette série (conflict = la demande) ;
// - heat_full : plus aucun couloir libre dans cette série ;
// - not_selected : seuls les retenus sont placés.
function validateNationalRaceLane({ request, heat, lane, raceRequests = [], config }) {
  const targetHeat = getAssignedNumber(heat);
  const targetLane = getAssignedNumber(lane);
  if (targetHeat === null && targetLane === null) return { ok: true };
  if (!isPlaceable(request)) return { ok: false, code: "not_selected" };

  const heats = config?.heats || NATIONAL_RACE_DEFAULT_HEATS;
  const lanes = config?.lanes || NATIONAL_RACE_DEFAULT_LANES;
  if (targetHeat === null || targetHeat > heats) return { ok: false, code: "heat_out_of_range", heat: targetHeat, heats };

  const others = raceRequests.filter(
    (other) => other.id !== request.id && isPlaceable(other) && getAssignedNumber(other.heat) === targetHeat && getAssignedNumber(other.lane) !== null,
  );
  // Déjà dans cette série : il garde sa place même si elle est pleine.
  const alreadyInHeat = getAssignedNumber(request.heat) === targetHeat && getAssignedNumber(request.lane) !== null;
  if (!alreadyInHeat && others.filter((other) => getAssignedNumber(other.lane) <= lanes).length >= lanes) {
    return { ok: false, code: "heat_full", heat: targetHeat, lanes };
  }
  if (targetLane === null) return { ok: true };
  if (targetLane > lanes) return { ok: false, code: "lane_out_of_range", lane: targetLane, lanes };

  const conflict = others.find((other) => getAssignedNumber(other.lane) === targetLane);
  if (conflict) return { ok: false, code: "lane_taken", heat: targetHeat, lane: targetLane, conflict };
  return { ok: true };
}

// Premier couloir libre d'une série (null si elle est pleine).
function getFirstFreeLane({ heat, raceRequests = [], config, excludeId = "" }) {
  const lanes = config?.lanes || NATIONAL_RACE_DEFAULT_LANES;
  const taken = new Set(
    raceRequests
      .filter((other) => other.id !== excludeId && isPlaceable(other) && getAssignedNumber(other.heat) === heat)
      .map((other) => getAssignedNumber(other.lane)),
  );
  for (let lane = 1; lane <= lanes; lane += 1) {
    if (!taken.has(lane)) return lane;
  }
  return null;
}

// Startlist d'une course : séries 1..n triées par couloir, puis les retenus
// non placés. Un placement hors réglage (séries réduites après coup) ou en
// doublon est renvoyé dans « unplaced » avec la raison, pour être corrigé.
function buildNationalRaceStartList(raceRequests = [], config) {
  const heats = config?.heats || NATIONAL_RACE_DEFAULT_HEATS;
  const lanes = config?.lanes || NATIONAL_RACE_DEFAULT_LANES;
  const selected = raceRequests.filter(isPlaceable);
  const heatRows = Array.from({ length: heats }, (_, index) => ({ heat: index + 1, lanes, entries: [] }));
  const unplaced = [];
  const seen = new Set();

  selected.forEach((request) => {
    const heat = getAssignedNumber(request.heat);
    const lane = getAssignedNumber(request.lane);
    if (heat === null || lane === null) {
      unplaced.push({ request, reason: "" });
      return;
    }
    if (heat > heats || lane > lanes) {
      unplaced.push({ request, reason: "out_of_range" });
      return;
    }
    const key = `${heat}-${lane}`;
    if (seen.has(key)) {
      unplaced.push({ request, reason: "duplicate" });
      return;
    }
    seen.add(key);
    heatRows[heat - 1].entries.push({ request, lane });
  });

  heatRows.forEach((row) => {
    row.entries.sort((left, right) => left.lane - right.lane);
    row.full = row.entries.length >= lanes;
    row.freeLanes = Array.from({ length: lanes }, (_, index) => index + 1).filter(
      (lane) => !row.entries.some((entry) => entry.lane === lane),
    );
  });

  return { heats: heatRows, unplaced, placedCount: selected.length - unplaced.length };
}

const PLACEMENT_LABELS = {
  fr: { heat: "Série {heat}", lane: "couloir {lane}" },
  en: { heat: "Heat {heat}", lane: "lane {lane}" },
};

// « Série 1 · couloir 4 » ; vide tant que la série et le couloir ne sont
// pas fixés tous les deux.
function formatNationalRaceLane(request, language = "fr", separator = " · ") {
  if (!hasNationalRaceLane(request)) return "";
  const labels = PLACEMENT_LABELS[language] || PLACEMENT_LABELS.en;
  return `${labels.heat.replace("{heat}", request.heat)}${separator}${labels.lane.replace("{lane}", request.lane)}`;
}

// Variable {placement} des modèles de mails. Un modèle enregistré avant
// l'ajout des séries ne la contient pas : la ligne est alors insérée avant
// le dernier paragraphe (la signature).
function fillNationalRacePlacement(body, placement) {
  const text = String(body || "");
  if (text.includes("{placement}")) return text.replace(/\{placement\}/g, placement ? `${placement}\n\n` : "");
  if (!placement) return text;
  const paragraphs = text.split("\n\n");
  if (paragraphs.length < 2) return `${text}\n\n${placement}`;
  return [...paragraphs.slice(0, -1), placement, paragraphs[paragraphs.length - 1]].join("\n\n");
}

export {
  NATIONAL_RACE_CONFIG_COLLECTION,
  fillNationalRacePlacement,
  NATIONAL_RACE_DEFAULT_HEATS,
  NATIONAL_RACE_DEFAULT_LANES,
  NATIONAL_RACE_MAX_HEATS,
  NATIONAL_RACE_MAX_LANES,
  buildNationalRaceStartList,
  formatNationalRaceLane,
  getFirstFreeLane,
  hasNationalRaceLane,
  normalizeNationalRaceConfig,
  validateNationalRaceLane,
};
