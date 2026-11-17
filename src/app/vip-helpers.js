const VIP_TOUR_OPTIONS = [
  {
    value: "coque",
    label: "14h15 : la Coque comme vous ne l'avez jamais vue",
  },
  {
    value: "coulisses",
    label: "14h15 : les coulisses du meeting",
  },
  {
    value: "none",
    label: "Non, je ne souhaite pas participer au tour VIP",
  },
];

const VIP_INVITATION_CATEGORY_SUGGESTIONS = [
  "Comité directeur",
  "Président(e) de club",
  "Partenaire",
  "Institution",
  "Presse",
  "Invité d'honneur",
];

const VIP_PICKUP_POINT_OPTIONS = [
  "Accueil VIP",
  "Accueil principal",
  "Billetterie",
];

function createEmptyVipFormData(overrides = {}) {
  return {
    firstName: "",
    lastName: "",
    organization: "",
    email: "",
    phone: "",
    vipTourChoice: "coque",
    guestFirstName: "",
    guestLastName: "",
    guestEmail: "",
    notes: "",
    ...overrides,
  };
}

function normalizeVipText(value) {
  return String(value || "").trim();
}

function getVipTourChoiceLabel(value) {
  return VIP_TOUR_OPTIONS.find((option) => option.value === value)?.label || "Tour VIP non renseigné";
}

function buildVipFullName(record = {}) {
  return [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
}

function getVipPartnerPortalLabel(portalId) {
  const normalizedPortalId = String(portalId || "").trim();
  if (!normalizedPortalId) return "Partenaire VIP";

  return normalizedPortalId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function normalizeVipComparableValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getVipEmailKey(record = {}) {
  return normalizeVipComparableValue(record.email);
}

function getVipNameKey(record = {}) {
  return normalizeVipComparableValue(buildVipFullName(record)).replace(/\s+/g, " ");
}

function findMatchingVipRegistration(registrations = [], invitation = {}) {
  const emailKey = getVipEmailKey(invitation);
  if (emailKey) {
    const byEmail = registrations.find((registration) => getVipEmailKey(registration) === emailKey);
    if (byEmail) return byEmail;
  }

  const nameKey = getVipNameKey(invitation);
  if (!nameKey) return null;

  return registrations.find((registration) => getVipNameKey(registration) === nameKey) || null;
}

function findMatchingVipInvitation(invitations = [], registration = {}) {
  const emailKey = getVipEmailKey(registration);
  if (emailKey) {
    const byEmail = invitations.find((invitation) => getVipEmailKey(invitation) === emailKey);
    if (byEmail) return byEmail;
  }

  const nameKey = getVipNameKey(registration);
  if (!nameKey) return null;

  return invitations.find((invitation) => getVipNameKey(invitation) === nameKey) || null;
}

function buildVipRegistrationPayload(formData = {}, overrides = {}) {
  return {
    firstName: normalizeVipText(formData.firstName),
    lastName: normalizeVipText(formData.lastName),
    organization: normalizeVipText(formData.organization),
    email: normalizeVipText(formData.email).toLowerCase(),
    phone: normalizeVipText(formData.phone),
    vipTourChoice: normalizeVipText(formData.vipTourChoice) || "coque",
    guestFirstName: normalizeVipText(formData.guestFirstName),
    guestLastName: normalizeVipText(formData.guestLastName),
    guestEmail: normalizeVipText(formData.guestEmail).toLowerCase(),
    // Accompagnant annoncé, même sans nom (« + 1 »).
    hasCompanion: Boolean(formData.hasCompanion) || Boolean(normalizeVipText(formData.guestFirstName) || normalizeVipText(formData.guestLastName)),
    notes: normalizeVipText(formData.notes),
    ...overrides,
  };
}

function createEmptyVipInvitationData(overrides = {}) {
  return {
    firstName: "",
    lastName: "",
    email: "",
    organization: "",
    category: "Partenaire",
    invitationMailLanguage: "fr",
    mailGreetingLabel: "",
    invitedThisEdition: "oui",
    notes: "",
    ...overrides,
  };
}

function createEmptyVipPortalContact(overrides = {}) {
  return { firstName: "", lastName: "", email: "", phone: "", ...overrides };
}

function createEmptyVipPartnerPortalData(overrides = {}) {
  return {
    portalId: "",
    organizationName: "",
    contacts: [createEmptyVipPortalContact()],
    meetingContact: createEmptyVipPortalContact(DEFAULT_VIP_MEETING_CONTACT),
    vipPlacesCap: "",
    standardPlacesCap: "",
    companionsAllowed: true,
    accessPassword: "",
    notes: "",
    ...overrides,
  };
}

// Contacts d'un portail : liste « contacts » (prénom / nom séparés) ; les
// anciens portails n'ont qu'un contactName / contactEmail / contactPhone.
function getVipPortalContacts(portal = {}) {
  if (Array.isArray(portal.contacts) && portal.contacts.length) {
    return portal.contacts.map((contact) => createEmptyVipPortalContact(contact));
  }
  const legacyName = normalizeVipText(portal.contactName);
  if (!legacyName && !portal.contactEmail && !portal.contactPhone) return [];
  const [firstName = "", ...rest] = legacyName.split(/\s+/);
  return [
    createEmptyVipPortalContact({
      firstName,
      lastName: rest.join(" "),
      email: normalizeVipText(portal.contactEmail),
      phone: normalizeVipText(portal.contactPhone),
    }),
  ];
}

// Contact côté meeting affiché sur le portail (« Votre contact au meeting ») ;
// par défaut Margot, modifiable portail par portail dans l'admin.
const DEFAULT_VIP_MEETING_CONTACT = Object.freeze({
  firstName: "Margot",
  lastName: "Laporte",
  email: "margot.laporte@fla.lu",
  phone: "",
});

function getVipPortalMeetingContact(portal = {}) {
  const contact = portal.meetingContact || {};
  const hasContact = ["firstName", "lastName", "email", "phone"].some((key) => normalizeVipText(contact[key]));
  return createEmptyVipPortalContact(hasContact ? contact : DEFAULT_VIP_MEETING_CONTACT);
}

function normalizeVipPortalContacts(contacts = []) {
  return contacts
    .map((contact) => ({
      firstName: normalizeVipText(contact.firstName),
      lastName: normalizeVipText(contact.lastName),
      email: normalizeVipText(contact.email).toLowerCase(),
      phone: normalizeVipText(contact.phone),
    }))
    .filter((contact) => contact.firstName || contact.lastName || contact.email || contact.phone);
}

// Plafond saisi : vide = pas de limite (null), sinon entier >= 0.
function parseVipPlacesCap(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Math.floor(Number(text));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeVipPlacesCap(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// Types de places d'un portail. Places VIP : sans plafond = illimitées
// (comportement historique), plafond 0 = aucune. Places normales : proposées
// seulement quand un plafond est fixé (> 0).
function getVipPortalPlaceTypes(portal = {}) {
  const vipCap = normalizeVipPlacesCap(portal.vipPlacesCap);
  const standardCap = normalizeVipPlacesCap(portal.standardPlacesCap);
  const types = [];
  if (vipCap === null || vipCap > 0) types.push("vip");
  if (standardCap !== null && standardCap > 0) types.push("standard");
  return types.length ? types : ["vip"];
}

function getVipEntryPlaceType(entry = {}) {
  return entry.placeType === "standard" ? "standard" : "vip";
}

// Accompagnant : nommé, ou simplement annoncé (« + 1 », nom inconnu).
function vipEntryHasCompanion(entry = {}) {
  return Boolean(entry.hasCompanion) || Boolean(buildVipFullName({ firstName: entry.guestFirstName, lastName: entry.guestLastName }));
}

// Nombre de personnes d'une fiche : 1, 2 avec un accompagnant.
function countVipEntryPlaces(entry = {}) {
  return 1 + (vipEntryHasCompanion(entry) ? 1 : 0);
}

// Accompagnants autorisés sur un portail (1 par invité) ; oui par défaut.
function vipPortalAllowsCompanions(portal = {}) {
  return portal.companionsAllowed !== false;
}

// Le quota compte les invitations (invités principaux) ; chaque invitation
// peut amener 1 accompagnant si le portail l'autorise, donc un quota de 10
// donne jusqu'à 20 places. `seats` = personnes réellement inscrites.
function computeVipPortalPlaces(portal = {}, entries = []) {
  const used = { vip: 0, standard: 0 };
  const seats = { vip: 0, standard: 0 };
  entries.forEach((entry) => {
    const type = getVipEntryPlaceType(entry);
    used[type] += 1;
    seats[type] += countVipEntryPlaces(entry);
  });
  // VIP sans plafond = illimité (null) ; places normales sans plafond = aucune (0).
  const caps = { vip: normalizeVipPlacesCap(portal.vipPlacesCap), standard: normalizeVipPlacesCap(portal.standardPlacesCap) ?? 0 };
  const remaining = {
    vip: caps.vip === null ? null : Math.max(0, caps.vip - used.vip),
    standard: caps.standard === null ? null : Math.max(0, caps.standard - used.standard),
  };
  return { used, seats, caps, remaining };
}

function buildVipPortalId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Libellés courts du tour pour l'écran d'administration (listes, filtres).
const VIP_TOUR_SHORT_LABEL_KEYS = {
  coque: "vipTourShortCoque",
  coulisses: "vipTourShortCoulisses",
  none: "vipTourShortNone",
};

function createEmptyVipAdminRegistrationData(overrides = {}) {
  return {
    ...createEmptyVipFormData(),
    // Ajout manuel : pas de tour tant qu'on ne l'a pas choisi (avant, la
    // valeur par défaut « Coque » inscrivait tout le monde au tour sans le dire).
    vipTourChoice: "none",
    pickupPoint: "Accueil VIP",
    badgePrintStatus: "non_imprime",
    registrationStatus: "confirmed",
    ...overrides,
  };
}

export {
  VIP_TOUR_OPTIONS,
  VIP_TOUR_SHORT_LABEL_KEYS,
  VIP_INVITATION_CATEGORY_SUGGESTIONS,
  VIP_PICKUP_POINT_OPTIONS,
  buildVipRegistrationPayload,
  buildVipFullName,
  createEmptyVipFormData,
  createEmptyVipAdminRegistrationData,
  createEmptyVipInvitationData,
  createEmptyVipPartnerPortalData,
  createEmptyVipPortalContact,
  computeVipPortalPlaces,
  countVipEntryPlaces,
  vipEntryHasCompanion,
  vipPortalAllowsCompanions,
  getVipEntryPlaceType,
  DEFAULT_VIP_MEETING_CONTACT,
  getVipPortalContacts,
  getVipPortalMeetingContact,
  getVipPortalPlaceTypes,
  normalizeVipPlacesCap,
  normalizeVipPortalContacts,
  parseVipPlacesCap,
  findMatchingVipInvitation,
  findMatchingVipRegistration,
  buildVipPortalId,
  getVipPartnerPortalLabel,
  getVipTourChoiceLabel,
  normalizeVipComparableValue,
  normalizeVipText,
};
