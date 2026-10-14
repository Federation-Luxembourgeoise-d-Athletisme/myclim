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
