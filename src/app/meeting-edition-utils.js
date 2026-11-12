export function getEditionDisplayNumber(edition) {
  if (!edition) return null;

  const rawEdition = Number(edition.edition);
  const year = Number(edition.year ?? edition.id);

  if (!Number.isFinite(rawEdition)) return null;
  if (year === 2022 || edition.cancelled) return null;

  return year >= 2023 ? rawEdition - 1 : rawEdition;
}

export function formatEditionLabel(edition, options = {}) {
  const { prefix = "Edition ", withHash = false, fallback = null } = options;
  const displayNumber = getEditionDisplayNumber(edition);

  if (!displayNumber) return fallback;

  return `${prefix}${withHash ? "#" : ""}${displayNumber}`;
}

// Numéro d'une édition pas encore numérotée dans les réglages (ex. l'édition
// à venir) : déduit de la dernière édition numérotée qui la précède.
export function inferEditionDisplayNumber(edition, knownEditions = []) {
  const direct = getEditionDisplayNumber(edition);
  if (direct) return direct;

  const year = Number(edition?.year ?? edition?.id);
  if (!Number.isFinite(year)) return null;

  const previous = knownEditions
    .map((candidate) => ({ year: Number(candidate?.year ?? candidate?.id), number: getEditionDisplayNumber(candidate) }))
    .filter((candidate) => candidate.number && candidate.year < year)
    .sort((left, right) => right.year - left.year)[0];

  return previous ? previous.number + (year - previous.year) : null;
}

// Date d'une édition (Timestamp Firestore, Date ou « AAAA-MM-JJ ») → « AAAA-MM-JJ »
// ou "". Site web › Édition l'enregistre comme Timestamp (midi, heure locale).
export function editionDateYmd(value) {
  if (!value) return "";
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  const date = typeof value.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
