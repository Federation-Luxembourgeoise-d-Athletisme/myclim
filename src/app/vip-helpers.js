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

function createEmptyVipPartnerPortalData(overrides = {}) {
  return {
    portalId: "",
    organizationName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    accessPassword: "",
    notes: "",
    ...overrides,
  };
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
  findMatchingVipInvitation,
  findMatchingVipRegistration,
  buildVipPortalId,
  getVipPartnerPortalLabel,
  getVipTourChoiceLabel,
  normalizeVipComparableValue,
  normalizeVipText,
};
