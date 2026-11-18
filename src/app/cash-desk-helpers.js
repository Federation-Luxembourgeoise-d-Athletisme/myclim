// Contrôle des entrées du jour J : logique pure (sans Firebase) partagée entre l'admin
// (/app/caisse) et l'écran des postes d'entrée (/caisse), testée dans
// tests/cash-desk-helpers.test.js.

// Postes créés par le bouton « Créer les postes par défaut » de l'admin. Un
// poste n'est qu'un nom : il sert à savoir par quelle porte chacun est entré.
const DEFAULT_CASH_POSTS = [
  { id: "public-1", name: "Entrée public 1", sortOrder: 1 },
  { id: "public-2", name: "Entrée public 2", sortOrder: 2 },
  { id: "public-3", name: "Entrée public 3", sortOrder: 3 },
  { id: "vip", name: "Entrée VIP", sortOrder: 4 },
];

const DOOR_GUEST_LIST_CATEGORIES = [
  { value: "sponsors", label: "Sponsors / partenaires", labelEn: "Sponsors / partners" },
  { value: "athletes", label: "Athlètes / accompagnants", labelEn: "Athletes / companions" },
  { value: "officials", label: "Officiels / fédération", labelEn: "Officials / federation" },
  { value: "free", label: "Liste libre", labelEn: "Other" },
];

// Badge court affiché à l'entrée, par type d'invité.
const DOOR_ENTRY_KINDS = {
  vip: { fr: "VIP", en: "VIP" },
  sponsors: { fr: "Sponsor", en: "Sponsor" },
  athletes: { fr: "Athlète", en: "Athlete" },
  officials: { fr: "Officiel", en: "Official" },
  national_race: { fr: "Courses nat.", en: "National races" },
  free: { fr: "Invité", en: "Guest" },
};

const PARTNER_STANDARD_LIST_ID = "partner_standard";

const VIP_SOURCE_LABELS = {
  vip_public: "VIP — formulaire",
  vip_admin: "VIP — ajout orga",
  vip_portal: "VIP — portail partenaire",
};

function normalizeCashText(value) {
  return String(value || "").trim();
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildPersonName(firstName, lastName) {
  return [normalizeCashText(firstName), normalizeCashText(lastName)].filter(Boolean).join(" ");
}

function buildCheckInKey(editionId, sourceType, sourceId) {
  return [editionId, sourceType, sourceId]
    .map((part) => String(part || "").replace(/[/\s]+/g, "-"))
    .join("__");
}

// Accompagnant nommé, ou annoncé sans nom (« + 1 » sur les portails partenaires).
function getVipCompanionLabel(record = {}) {
  const name = buildPersonName(record.guestFirstName, record.guestLastName);
  if (name) return name;
  return record.hasCompanion ? "Accompagnant (+1)" : "";
}

function getVipPlaces(record = {}) {
  return getVipCompanionLabel(record) ? 2 : 1;
}

function getVipDedupKey(record = {}) {
  const email = normalizeSearchValue(record.email);
  if (email) return `email:${email}`;
  const name = normalizeSearchValue(buildPersonName(record.firstName, record.lastName));
  return name ? `name:${name}` : "";
}

function mapVipRecordToDoorEntry(record, sourceType, sourceId, editionId) {
  const companion = getVipCompanionLabel(record);
  return {
    key: buildCheckInKey(editionId, sourceType, sourceId),
    sourceType,
    sourceId,
    sourceLabel: VIP_SOURCE_LABELS[sourceType] || "VIP",
    isVip: true,
    kind: "vip",
    listId: "vip",
    listName: "VIP",
    fullName: buildPersonName(record.firstName, record.lastName),
    organization: normalizeCashText(record.organization),
    companions: companion ? [companion] : [],
    places: getVipPlaces(record),
    notes: normalizeCashText(record.notes),
  };
}

// Regroupe tous les invités en une seule liste, identique sur tous les postes
// (et dans l'admin) :
// - athlètes retenus des courses nationales ;
// - VIP (3 sources) ; une même personne inscrite via plusieurs sources (même
//   e-mail, sinon même nom) n'apparaît qu'une fois, en gardant l'ajout orga,
//   puis le portail partenaire, puis le formulaire ;
// - invités des listes actives.
// Les check-ins déjà enregistrés sont rattachés par clé.
function buildDoorEntries({
  editionId,
  vipAdminRegistrations = [],
  vipPortalEntries = [],
  vipPublicRegistrations = [],
  guestLists = [],
  guests = [],
  nationalRaceAthletes = [],
  checkIns = [],
} = {}) {
  const entries = [];

  // Athlètes retenus des courses nationales : l'athlète entre avec son
  // accréditation par l'entrée athlètes (warm-up) ; la caisse remet 1 ticket
  // gratuit à l'accompagnateur, qui donne le nom de l'athlète.
  nationalRaceAthletes
    .filter((record) => record.status === "selected" && (!record.editionId || String(record.editionId) === String(editionId)))
    .forEach((record) => {
      const raceLabel = `${normalizeCashText(record.event)} ${record.gender === "femme" ? "F" : "H"}`.trim();
      entries.push({
        key: buildCheckInKey(editionId, "national_race", record.id),
        sourceType: "national_race",
        sourceId: record.id,
        sourceLabel: `Courses nationales · ${raceLabel}`,
        isVip: false,
        kind: "national_race",
        listId: "national_races",
        listName: "Courses nationales",
        fullName: buildPersonName(record.firstName, record.lastName),
        organization: normalizeCashText(record.isLuxLicensed ? record.club : record.foreignClub),
        companions: [],
        places: 1,
        notes: `1 ticket accompagnateur de l'athlète${record.role === "pacer" ? " (lièvre)" : ""}. L'athlète entre avec son accréditation par l'entrée athlètes (warm-up).`,
      });
    });

  // Places normales des portails partenaires : entrée en tribune, pas VIP.
  // Elles ont leur propre liste à la caisse (badge « Sponsor »).
  vipPortalEntries
    .filter((record) => record.placeType === "standard")
    .forEach((record) => {
      const companion = getVipCompanionLabel(record);
      entries.push({
        key: buildCheckInKey(editionId, "vip_portal", `${record.portalId || "portail"}-${record.id}`),
        sourceType: "vip_portal",
        sourceId: `${record.portalId || "portail"}-${record.id}`,
        sourceLabel: "Portail partenaire · place normale",
        isVip: false,
        kind: "sponsors",
        listId: PARTNER_STANDARD_LIST_ID,
        listName: "Partenaires — places normales",
        fullName: buildPersonName(record.firstName, record.lastName),
        organization: normalizeCashText(record.organization),
        companions: companion ? [companion] : [],
        places: getVipPlaces(record),
        notes: normalizeCashText(record.notes),
      });
    });

  const seenVipKeys = new Set();
  const vipSources = [
    ...vipAdminRegistrations
      .filter((record) => record.registrationStatus !== "cancelled")
      .map((record) => ({ record, sourceType: "vip_admin", sourceId: record.id })),
    ...vipPortalEntries.filter((record) => record.placeType !== "standard").map((record) => ({
      record,
      sourceType: "vip_portal",
      sourceId: `${record.portalId || "portail"}-${record.id}`,
    })),
    ...vipPublicRegistrations.map((record) => ({ record, sourceType: "vip_public", sourceId: record.id })),
  ];

  vipSources.forEach(({ record, sourceType, sourceId }) => {
    const dedupKey = getVipDedupKey(record);
    if (dedupKey && seenVipKeys.has(dedupKey)) return;
    if (dedupKey) seenVipKeys.add(dedupKey);
    entries.push(mapVipRecordToDoorEntry(record, sourceType, sourceId, editionId));
  });

  const activeLists = new Map(guestLists.filter((list) => list && list.active !== false).map((list) => [list.id, list]));

  guests.forEach((guest) => {
    const list = activeLists.get(guest.listId);
    if (!list) return;
    entries.push({
      key: buildCheckInKey(editionId, "door_guest", guest.id),
      sourceType: "door_guest",
      sourceId: guest.id,
      sourceLabel: list.name,
      isVip: false,
      kind: DOOR_ENTRY_KINDS[list.category] ? list.category : "free",
      listId: list.id,
      listName: list.name,
      fullName: buildPersonName(guest.firstName, guest.lastName),
      organization: normalizeCashText(guest.organization),
      companions: [],
      places: Math.max(1, Math.floor(Number(guest.places) || 1)),
      notes: normalizeCashText(guest.notes),
    });
  });

  const checkInsByKey = new Map(checkIns.map((checkIn) => [checkIn.id || checkIn.key, checkIn]));

  return entries
    .filter((entry) => entry.fullName || entry.organization)
    .map((entry) => {
      const checkIn = checkInsByKey.get(entry.key) || null;
      const admittedCount = Math.max(0, Number(checkIn?.admittedCount) || 0);
      return {
        ...entry,
        checkIn,
        admittedCount,
        remainingPlaces: Math.max(0, entry.places - admittedCount),
      };
    })
    .sort((left, right) =>
      normalizeSearchValue(left.fullName || left.organization).localeCompare(normalizeSearchValue(right.fullName || right.organization)),
    );
}

function filterDoorEntries(entries = [], query = "") {
  const terms = normalizeSearchValue(query).split(" ").filter(Boolean);
  if (!terms.length) return entries;

  return entries.filter((entry) => {
    const haystack = normalizeSearchValue(
      [entry.fullName, entry.organization, entry.listName, ...entry.companions].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

// Historique à plat de tous les passages (entrées et annulations), du plus
// récent au plus ancien : journal de l'admin et « Dernières entrées » des postes.
function flattenCheckInEvents(checkIns = []) {
  const events = [];
  checkIns.forEach((checkIn) => {
    (Array.isArray(checkIn.history) ? checkIn.history : []).forEach((event, index) => {
      const date = event.at?.toDate?.() || (event.at ? new Date(event.at) : null);
      events.push({
        id: `${checkIn.id || checkIn.key}#${index}`,
        checkInId: checkIn.id || checkIn.key,
        displayName: checkIn.displayName || checkIn.organization || "",
        organization: checkIn.organization || "",
        listName: checkIn.listName || "",
        postId: event.postId || "",
        postName: event.postName || event.postId || "",
        operator: event.operator || "",
        count: Number(event.count) || 0,
        forced: Boolean(event.forced),
        time: date && !Number.isNaN(date.getTime()) ? date.getTime() : 0,
      });
    });
  });
  return events.sort((left, right) => right.time - left.time);
}

// Entrées nettes par poste (les annulations sont déduites).
function countEntriesByPost(events = []) {
  const counts = new Map();
  events.forEach((event) => {
    counts.set(event.postId, (counts.get(event.postId) || 0) + event.count);
  });
  return counts;
}

// Validation d'une entrée (count > 0) ou d'une annulation (count < 0) par
// rapport à l'état courant du check-in. Retourne le nouveau compteur, ou une
// raison de refus (« overflow » peut être forcé par le caissier).
function evaluateCheckIn({ places, admittedCount = 0, count, force = false }) {
  const delta = Math.trunc(Number(count) || 0);
  const current = Math.max(0, Math.trunc(Number(admittedCount) || 0));
  const totalPlaces = Math.max(1, Math.trunc(Number(places) || 1));

  if (!delta) return { ok: false, reason: "invalid" };
  if (delta < 0 && current + delta < 0) return { ok: false, reason: "nothing_to_undo" };
  if (delta > 0 && current + delta > totalPlaces && !force) {
    return { ok: false, reason: "overflow", remaining: Math.max(0, totalPlaces - current) };
  }

  return { ok: true, nextCount: current + delta };
}

// Lecture d'une liste d'invités Excel : première feuille, première ligne =
// en-têtes. Colonnes reconnues (FR/EN, accents et casse ignorés).
const GUEST_IMPORT_HEADER_ALIASES = {
  firstName: ["prenom", "first name", "firstname", "vorname"],
  lastName: ["nom", "last name", "lastname", "surname", "nachname", "nom de famille"],
  // Reconnue seulement pour refuser le fichier : prénom et nom doivent
  // toujours être deux colonnes séparées (règle de toute l'app).
  fullName: ["nom complet", "full name", "name", "invite", "invité"],
  organization: ["organisation", "organization", "societe", "société", "entreprise", "company", "club"],
  email: ["email", "e-mail", "mail", "courriel"],
  places: ["places", "nombre", "nb", "nb places", "nombre de places", "quantite", "quantité", "seats", "pax"],
  notes: ["notes", "note", "remarque", "remarques", "commentaire", "comment"],
};

function mapGuestImportHeaders(headerRow = []) {
  const columns = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeSearchValue(cell);
    Object.entries(GUEST_IMPORT_HEADER_ALIASES).forEach(([field, aliases]) => {
      if (columns[field] !== undefined) return;
      if (aliases.some((alias) => normalizeSearchValue(alias) === normalized)) {
        columns[field] = index;
      }
    });
  });
  return columns;
}

function parseGuestImportRows(rows = []) {
  if (!rows.length) return { guests: [], skipped: 0, columns: {} };

  const columns = mapGuestImportHeaders(rows[0]);
  const hasSeparateNames = columns.firstName !== undefined && columns.lastName !== undefined;
  if (!hasSeparateNames) {
    const error = columns.fullName !== undefined ? "full_name_only" : "missing_name_column";
    return { guests: [], skipped: rows.length - 1, columns, error };
  }

  const read = (row, field) => (columns[field] === undefined ? "" : normalizeCashText(row[columns[field]]));
  const guests = [];
  let skipped = 0;

  rows.slice(1).forEach((row) => {
    const firstName = read(row, "firstName");
    const lastName = read(row, "lastName");
    const organization = read(row, "organization");

    if (!firstName && !lastName && !organization) {
      skipped += 1;
      return;
    }

    const parsedPlaces = Number.parseInt(read(row, "places"), 10);
    guests.push({
      firstName,
      lastName,
      organization,
      email: read(row, "email").toLowerCase(),
      places: Number.isFinite(parsedPlaces) && parsedPlaces > 0 ? parsedPlaces : 1,
      notes: read(row, "notes"),
    });
  });

  return { guests, skipped, columns };
}

// Code d'accès de la caisse : saisi tel quel ou avec espaces/tirets, comparé
// en majuscules sans séparateurs (même normalisation côté Cloud Function).
function normalizeCashPostCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export {
  DEFAULT_CASH_POSTS,
  DOOR_ENTRY_KINDS,
  DOOR_GUEST_LIST_CATEGORIES,
  PARTNER_STANDARD_LIST_ID,
  buildCheckInKey,
  buildDoorEntries,
  buildPersonName,
  countEntriesByPost,
  evaluateCheckIn,
  filterDoorEntries,
  flattenCheckInEvents,
  normalizeCashPostCode,
  normalizeSearchValue,
  parseGuestImportRows,
};
