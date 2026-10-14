// Contrôle des entrées du jour J : logique pure (sans Firebase) partagée entre l'admin
// (/app/caisse) et l'écran des postes d'entrée (/caisse), testée dans
// tests/cash-desk-helpers.test.js.

const CASH_POST_KINDS = [
  { value: "public", label: "Entrée public" },
  { value: "vip", label: "Entrée VIP" },
];

// Postes créés par le bouton « Créer les postes par défaut » de l'admin.
const DEFAULT_CASH_POSTS = [
  { id: "public-1", name: "Entrée public 1", kind: "public", showVipLists: false, sortOrder: 1 },
  { id: "public-2", name: "Entrée public 2", kind: "public", showVipLists: false, sortOrder: 2 },
  { id: "public-3", name: "Entrée public 3", kind: "public", showVipLists: false, sortOrder: 3 },
  { id: "vip", name: "Entrée VIP", kind: "vip", showVipLists: true, sortOrder: 4 },
];

const DOOR_GUEST_LIST_CATEGORIES = [
  { value: "sponsors", label: "Sponsors / partenaires" },
  { value: "athletes", label: "Athlètes / accompagnants" },
  { value: "officials", label: "Officiels / fédération" },
  { value: "free", label: "Liste libre" },
];

// Sur quels postes une liste d'invités est consultable.
const DOOR_GUEST_LIST_SCOPES = [
  { value: "all", label: "Tous les postes" },
  { value: "public", label: "Entrées public" },
  { value: "vip", label: "Entrée VIP" },
];

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

function guestListIsVisibleForPost(list, post) {
  if (!list || list.active === false) return false;
  const scope = list.postScope || "all";
  return scope === "all" || scope === post?.kind;
}

function buildCheckInKey(editionId, sourceType, sourceId) {
  return [editionId, sourceType, sourceId]
    .map((part) => String(part || "").replace(/[/\s]+/g, "-"))
    .join("__");
}

function getVipPlaces(record = {}) {
  return buildPersonName(record.guestFirstName, record.guestLastName) ? 2 : 1;
}

function getVipDedupKey(record = {}) {
  const email = normalizeSearchValue(record.email);
  if (email) return `email:${email}`;
  const name = normalizeSearchValue(buildPersonName(record.firstName, record.lastName));
  return name ? `name:${name}` : "";
}

function mapVipRecordToDoorEntry(record, sourceType, sourceId, editionId) {
  const companion = buildPersonName(record.guestFirstName, record.guestLastName);
  return {
    key: buildCheckInKey(editionId, sourceType, sourceId),
    sourceType,
    sourceId,
    sourceLabel: VIP_SOURCE_LABELS[sourceType] || "VIP",
    isVip: true,
    listId: "vip",
    listName: "VIP",
    fullName: buildPersonName(record.firstName, record.lastName),
    organization: normalizeCashText(record.organization),
    companions: companion ? [companion] : [],
    places: getVipPlaces(record),
    notes: normalizeCashText(record.notes),
  };
}

// Regroupe les invités consultables à l'entrée en une seule liste :
// - VIP (3 sources) si le poste les affiche ; une même personne inscrite via
//   plusieurs sources (même e-mail, sinon même nom) n'apparaît qu'une fois,
//   en gardant l'ajout orga, puis le portail partenaire, puis le formulaire ;
// - invités des listes génériques visibles sur ce poste.
// Les check-ins déjà enregistrés sont rattachés par clé.
function buildDoorEntries({
  editionId,
  post,
  vipAdminRegistrations = [],
  vipPortalEntries = [],
  vipPublicRegistrations = [],
  guestLists = [],
  guests = [],
  checkIns = [],
} = {}) {
  const entries = [];

  if (post?.showVipLists) {
    const seenVipKeys = new Set();
    const vipSources = [
      ...vipAdminRegistrations
        .filter((record) => record.registrationStatus !== "cancelled")
        .map((record) => ({ record, sourceType: "vip_admin", sourceId: record.id })),
      ...vipPortalEntries.map((record) => ({
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
  }

  const visibleLists = new Map(
    guestLists.filter((list) => guestListIsVisibleForPost(list, post)).map((list) => [list.id, list]),
  );

  guests.forEach((guest) => {
    const list = visibleLists.get(guest.listId);
    if (!list) return;
    entries.push({
      key: buildCheckInKey(editionId, "door_guest", guest.id),
      sourceType: "door_guest",
      sourceId: guest.id,
      sourceLabel: list.name,
      isVip: false,
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
    .sort((left, right) => normalizeSearchValue(left.fullName).localeCompare(normalizeSearchValue(right.fullName)));
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

// Code d'accès d'un poste : saisi tel quel ou avec espaces/tirets, comparé en
// majuscules sans séparateurs (même normalisation côté Cloud Function).
function normalizeCashPostCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export {
  CASH_POST_KINDS,
  DEFAULT_CASH_POSTS,
  DOOR_GUEST_LIST_CATEGORIES,
  DOOR_GUEST_LIST_SCOPES,
  buildCheckInKey,
  buildDoorEntries,
  buildPersonName,
  evaluateCheckIn,
  filterDoorEntries,
  guestListIsVisibleForPost,
  normalizeCashPostCode,
  normalizeSearchValue,
  parseGuestImportRows,
};
