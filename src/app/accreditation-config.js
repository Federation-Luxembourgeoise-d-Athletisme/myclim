import { defaultTeamRoles } from "./team-config";
import { QR_LINK_SOURCES, pickQrSource } from "./qr-link-sources.js";
import { normalizeNamelessBadgeTypes, normalizeNationalBadge } from "./extra-badge-types.js";
import accreditationQrEmagazineAthleteUrl from "../assets/accreditation-qr-emagazine-athlete.png";
import accreditationQrPhotosUrl from "../assets/accreditation-qr-photos.png";
import accreditationQrResultsLiveAthleteUrl from "../assets/accreditation-qr-results-live-athlete.png";
import accreditationQrRoadbookAthleteUrl from "../assets/accreditation-qr-roadbook-athlete.png";
import accreditationQrRoadbookUrl from "../assets/accreditation-qr-roadbook.png";

const accreditationZoneSeed = [
  { id: "zone-infield", order: 1, name: "Infield" },
  { id: "zone-warmup", order: 2, name: "Warm-up" },
  { id: "zone-coaching", order: 3, name: "Coaching Zone" },
  { id: "zone-judges", order: 4, name: "Judges Room" },
  { id: "zone-mixed", order: 5, name: "Mixed Zone" },
  { id: "zone-vip", order: 6, name: "VIP Zone" },
];

const roleAccreditationSeed = {
  Transport: ["zone-mixed", "zone-vip"],
  "Warm-up": ["zone-infield", "zone-warmup", "zone-coaching"],
  "Call room": ["zone-judges", "zone-mixed"],
};

const volunteerAccreditationOverrideSeed = {
  "vol-002": {
    addZoneIds: ["zone-vip"],
    removeZoneIds: [],
    printStatus: "Non-imprimé",
  },
  "vol-003": {
    addZoneIds: ["zone-infield"],
    removeZoneIds: ["zone-mixed"],
    printStatus: "Imprimé",
  },
  "vol-005": {
    addZoneIds: [],
    removeZoneIds: ["zone-vip"],
    printStatus: "Imprimé",
  },
};
// Catégories des badges (design piste B) : la couleur de la bande verticale ; le sous-rôle
// (rôle bénévole, type de presse…) s'écrit sur le badge. Couleurs choisies par Margot :
// Organisation rouge, Judge bleu foncé, Volunteer bleu clair, Press et Photographer violets proches.
const BADGE_CATEGORIES = [
  { key: "organisation", label: "Organisation", color: "#e30613" },
  { key: "athlete", label: "Athlete", color: "#0f8a5f" },
  { key: "coach", label: "Coach", color: "#f07c00" },
  { key: "judge", label: "Judge", color: "#0a2540" },
  { key: "press", label: "Press", color: "#5b2bb5" },
  { key: "photographer", label: "Photographer", color: "#9157e6" },
  { key: "volunteer", label: "Volunteer", color: "#27a9e1" },
  { key: "technical", label: "Technical", color: "#4a5056" },
];
const DEFAULT_ROLE_BADGE_CATEGORY = "volunteer";

const ACCREDITATION_PRINT_STATUS_OPTIONS = [
  "Non-imprimé",
  "Dans la file",
  "Imprimé",
  "Annulé",
  "Imprimé à détruire",
];
const BADGE_STORAGE_LOCATIONS = [];
const NON_NOMINATIVE_BADGE_TEMPLATES = [
  {
    id: "athlete",
    label: "Athlete",
    badgeLabel: "Athlete",
    defaultZoneIds: ["zone-infield", "zone-warmup", "zone-mixed", "zone-vip"],
  },
  {
    id: "coach",
    label: "Coach",
    badgeLabel: "Coach",
    defaultZoneIds: ["zone-warmup", "zone-coaching"],
  },
];
const ACCREDITATION_BADGE_VISUALS = [
  {
    id: "volunteer",
    label: "Bénévole nominatif",
    description: "Badge nominatif pour les bénévoles affectés.",
  },
  {
    id: "athlete",
    label: "Athlete non nominatif",
    description: "Lot d'accréditations Athlete non nominatives.",
  },
  {
    id: "coach",
    label: "Coach non nominatif",
    description: "Lot d'accréditations Coach non nominatives.",
  },
  {
    id: "judge",
    label: "Judge nominatif",
    description: "Badge nominatif pour les juges.",
  },
  {
    id: "press",
    label: "Presse nominatif",
    description: "Badge nominatif pour les accrédités presse (journalistes, photographes).",
  },
  {
    id: "vip",
    label: "VIP nominatif",
    description: "Badge nominatif pour les invités VIP, mêmes zones que les autres badges mais visuel dédié.",
  },
];
const ACCREDITATION_QR_RESOURCE_SEED = [
  {
    id: "results-live",
    label: "Live results",
    subtitle: "Follow the results",
    source: "results",
    targetType: "url",
    url: "",
    documentId: "",
    legacyImageUrl: accreditationQrResultsLiveAthleteUrl,
  },
  {
    id: "volunteer-roadbook",
    label: "Volunteer roadbook",
    subtitle: "Useful info for volunteers",
    targetType: "url",
    url: "",
    documentId: "",
    legacyImageUrl: accreditationQrRoadbookUrl,
  },
  {
    id: "photos-live",
    label: "Photos",
    subtitle: "Event album",
    source: "photos",
    targetType: "url",
    url: "",
    documentId: "",
    legacyImageUrl: accreditationQrPhotosUrl,
  },
  {
    id: "athlete-roadbook",
    label: "Athlete roadbook",
    subtitle: "Useful meeting info",
    source: "athleteRoadbook",
    targetType: "url",
    url: "",
    documentId: "",
    legacyImageUrl: accreditationQrRoadbookAthleteUrl,
  },
  {
    id: "emagazine-athlete",
    label: "E-magazine",
    subtitle: "Meeting stories",
    source: "emagazine",
    targetType: "url",
    url: "",
    documentId: "",
    legacyImageUrl: accreditationQrEmagazineAthleteUrl,
  },
];
const ACCREDITATION_QR_VISUAL_ASSIGNMENT_SEED = {
  volunteer: ["results-live", "volunteer-roadbook", "photos-live"],
  athlete: ["athlete-roadbook", "results-live", "photos-live", "emagazine-athlete"],
  coach: ["athlete-roadbook", "results-live", "photos-live", "emagazine-athlete"],
  judge: ["results-live"],
  press: [],
  vip: [],
};

function normalizeSubRoles(subRoles) {
  if (!Array.isArray(subRoles)) return [];
  const seen = new Set();
  return subRoles
    .map((subRole) => String(subRole || "").trim())
    .filter((subRole) => {
      if (!subRole) return false;
      const normalizedSubRole = subRole.toLowerCase();
      if (seen.has(normalizedSubRole)) return false;
      seen.add(normalizedSubRole);
      return true;
    });
}

function normalizeAccreditationZone(zone, index = 0) {
  const fallbackZone = accreditationZoneSeed[index] ?? accreditationZoneSeed[0] ?? {};
  const normalizedOrder = Number(zone?.order);

  return {
    id: String(zone?.id || fallbackZone.id || `zone-${index + 1}`),
    order: Number.isFinite(normalizedOrder) && normalizedOrder > 0 ? normalizedOrder : index + 1,
    name: String(zone?.name || fallbackZone.name || `Zone ${index + 1}`),
  };
}

function normalizeAccreditationOverride(override = {}, availableZoneIds = new Set()) {
  const normalizedPrintStatus = ACCREDITATION_PRINT_STATUS_OPTIONS.includes(String(override?.printStatus || "").trim())
    ? String(override.printStatus).trim()
    : override?.badgeStatus === "Imprimé" || override?.badgeStatus === "Remis"
      ? "Imprimé"
      : "Non-imprimé";

  return {
    addZoneIds: normalizeSubRoles(Array.isArray(override?.addZoneIds) ? override.addZoneIds : []).filter((zoneId) =>
      availableZoneIds.has(zoneId),
    ),
    removeZoneIds: normalizeSubRoles(Array.isArray(override?.removeZoneIds) ? override.removeZoneIds : []).filter(
      (zoneId) => availableZoneIds.has(zoneId),
    ),
    printStatus: normalizedPrintStatus,
    badgeLabel: String(override?.badgeLabel || "").trim(),
    warningMessage: String(override?.warningMessage || "").trim(),
    lastQueuedAt: override?.lastQueuedAt || null,
    // Statut et alerte d'avant l'entrée dans la file (accreditation-queue.js).
    queuedFrom:
      ACCREDITATION_PRINT_STATUS_OPTIONS.includes(String(override?.queuedFrom || "")) && override.queuedFrom !== "Dans la file"
        ? override.queuedFrom
        : "",
    queuedWarning: String(override?.queuedWarning || "").trim(),
    lastPrintedAt: override?.lastPrintedAt || null,
    destroyedAt: override?.destroyedAt || null,
    // Distinct from "Rangé" (badge printed and put in a pickup box, not yet in the
    // volunteer's hands): handedOverAt is the terminal step where the badge has
    // actually been given to the person. Read by both the accreditation screen and
    // the Présences "Welcome pack" action, so the two stay in sync.
    handedOverAt: override?.handedOverAt || null,
    handedOverBy: String(override?.handedOverBy || "").trim(),
    printedSnapshot: {
      roleLabel: String(override?.printedSnapshot?.roleLabel || "").trim(),
      roleNames: normalizeSubRoles(Array.isArray(override?.printedSnapshot?.roleNames) ? override.printedSnapshot.roleNames : []),
      zoneIds: normalizeSubRoles(Array.isArray(override?.printedSnapshot?.zoneIds) ? override.printedSnapshot.zoneIds : []).filter(
        (zoneId) => availableZoneIds.has(zoneId),
      ),
    },
  };
}

function normalizePrintHistoryItem(entry = {}, index = 0) {
  return {
    id: String(entry?.id || `print-history-item-${index + 1}`),
    volunteerId: String(entry?.volunteerId || "").trim(),
    name: String(entry?.name || "").trim(),
    roleLabel: String(entry?.roleLabel || "").trim(),
    roleNames: normalizeSubRoles(Array.isArray(entry?.roleNames) ? entry.roleNames : []),
    zoneLabels: normalizeSubRoles(Array.isArray(entry?.zoneLabels) ? entry.zoneLabels : []),
    printedAt: entry?.printedAt || null,
    generatedBy: String(entry?.generatedBy || "").trim(),
    reviewStatus: String(entry?.reviewStatus || "").trim(),
    reviewComment: String(entry?.reviewComment || "").trim(),
  };
}

function normalizePrintHistoryBatch(batch = {}, index = 0) {
  const items = Array.isArray(batch?.items)
    ? batch.items.map((item, itemIndex) => normalizePrintHistoryItem(item, itemIndex))
    : [];
  const firstItem = items[0] || null;

  return {
    id: String(batch?.id || `print-batch-${index + 1}`),
    printedAt: batch?.printedAt || firstItem?.printedAt || null,
    generatedBy: String(batch?.generatedBy || firstItem?.generatedBy || "").trim(),
    items,
  };
}

function normalizeAccreditationQrResource(resource = {}, index = 0) {
  const fallback =
    ACCREDITATION_QR_RESOURCE_SEED.find((seed) => seed.id === resource?.id) ?? ACCREDITATION_QR_RESOURCE_SEED[index] ?? {};
  // Ressource sans lien ni document saisis : elle reprend la source prévue.
  const source = pickQrSource(resource || {}, fallback.source);
  const normalizedTargetType = String(resource?.targetType || fallback.targetType || "url").trim() === "document"
    ? "document"
    : "url";

  return {
    id: String(resource?.id || fallback.id || `qr-resource-${index + 1}`),
    label: String(resource?.label || fallback.label || `Ressource QR ${index + 1}`).trim(),
    subtitle: String(resource?.subtitle || fallback.subtitle || "").trim(),
    targetType: normalizedTargetType,
    source,
    documentId: String(resource?.documentId || fallback.documentId || "").trim(),
    url: String(resource?.url || fallback.url || "").trim(),
    legacyImageUrl: String(resource?.legacyImageUrl || fallback.legacyImageUrl || "").trim(),
  };
}

function normalizeAccreditationQrVisualAssignments(assignments = {}, availableResourceIds = new Set()) {
  return ACCREDITATION_BADGE_VISUALS.reduce((accumulator, visual) => {
    const storedAssignments = assignments?.[visual.id];
    const fallbackAssignments = ACCREDITATION_QR_VISUAL_ASSIGNMENT_SEED[visual.id] ?? [];

    accumulator[visual.id] = normalizeSubRoles(
      Array.isArray(storedAssignments) ? storedAssignments : fallbackAssignments,
    ).filter((resourceId) => availableResourceIds.has(resourceId));

    return accumulator;
  }, {});
}

function normalizeAccreditationConfigurationPayload(data, roles = defaultTeamRoles) {
  const zonesSource = Array.isArray(data?.zones) && data.zones.length > 0 ? data.zones : accreditationZoneSeed;
  const zones = zonesSource.map((zone, index) => normalizeAccreditationZone(zone, index));
  const availableZoneIds = new Set(zones.map((zone) => zone.id));
  const storedRoleZoneAssignments =
    data?.roleZoneAssignments && typeof data.roleZoneAssignments === "object" ? data.roleZoneAssignments : {};
  const storedVolunteerOverrides =
    data?.volunteerOverrides && typeof data.volunteerOverrides === "object" ? data.volunteerOverrides : {};

  const roleZoneAssignments = roles.reduce((accumulator, role) => {
    const storedZoneIds = storedRoleZoneAssignments[role.id];
    const fallbackZoneIds = roleAccreditationSeed[role.roleName] ?? [];

    accumulator[role.id] = normalizeSubRoles(Array.isArray(storedZoneIds) ? storedZoneIds : fallbackZoneIds).filter(
      (zoneId) => availableZoneIds.has(zoneId),
    );
    return accumulator;
  }, {});

  // Catégorie de badge par rôle bénévole (Réglages) ; Volunteer par défaut.
  const storedRoleBadgeCategories =
    data?.roleBadgeCategories && typeof data.roleBadgeCategories === "object" ? data.roleBadgeCategories : {};
  const roleBadgeCategories = Object.fromEntries(
    roles.map((role) => {
      const stored = storedRoleBadgeCategories[role.id];
      return [role.id, BADGE_CATEGORIES.some((category) => category.key === stored) ? stored : DEFAULT_ROLE_BADGE_CATEGORY];
    }),
  );

  const volunteerOverrideSource = Object.keys(storedVolunteerOverrides).length
    ? storedVolunteerOverrides
    : volunteerAccreditationOverrideSeed;

  const volunteerOverrides = Object.fromEntries(
    Object.entries(volunteerOverrideSource).map(([volunteerId, override]) => [
      String(volunteerId || "").trim(),
      normalizeAccreditationOverride(override, availableZoneIds),
    ]),
  );
  const printHistory = Array.isArray(data?.printHistory)
    ? (
      data.printHistory.length > 0 && Array.isArray(data.printHistory[0]?.items)
        ? data.printHistory.map((batch, index) => normalizePrintHistoryBatch(batch, index))
        : Object.values(
            data.printHistory.reduce((accumulator, entry, index) => {
              const normalizedEntry = normalizePrintHistoryItem(entry, index);
              const groupingKey = `${normalizedEntry.printedAt || "unknown"}::${normalizedEntry.generatedBy || "unknown"}`;

              if (!accumulator[groupingKey]) {
                accumulator[groupingKey] = {
                  id: `legacy-batch-${index + 1}`,
                  printedAt: normalizedEntry.printedAt,
                  generatedBy: normalizedEntry.generatedBy,
                  items: [],
                };
              }

              accumulator[groupingKey].items.push(normalizedEntry);
              return accumulator;
            }, {}),
          ).map((batch, index) => normalizePrintHistoryBatch(batch, index))
    )
    : [];

  const badgeStorageLocations =
    data?.badgeStorageLocations && typeof data.badgeStorageLocations === "object"
      ? Object.fromEntries(
          Object.entries(data.badgeStorageLocations).map(([k, v]) => [k, String(v || "").trim()]),
        )
      : {};

  const customStorageLocations = Array.isArray(data?.customStorageLocations)
    ? data.customStorageLocations.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const qrResourceSource =
    Array.isArray(data?.qrResources) && data.qrResources.length > 0
      ? data.qrResources
      : ACCREDITATION_QR_RESOURCE_SEED;
  const qrResources = qrResourceSource.map((resource, index) => normalizeAccreditationQrResource(resource, index));
  const availableQrResourceIds = new Set(qrResources.map((resource) => resource.id));
  const qrVisualAssignments = normalizeAccreditationQrVisualAssignments(
    data?.qrVisualAssignments && typeof data.qrVisualAssignments === "object" ? data.qrVisualAssignments : {},
    availableQrResourceIds,
  );

  return {
    zones,
    roleZoneAssignments,
    roleBadgeCategories,
    volunteerOverrides,
    printHistory,
    badgeStorageLocations,
    customStorageLocations,
    qrResources,
    qrVisualAssignments,
    // Badges sans nom et badge des courses nationales (extra-badge-types.js).
    namelessBadgeTypes: normalizeNamelessBadgeTypes(data?.namelessBadgeTypes, availableZoneIds),
    nationalBadge: normalizeNationalBadge(data?.nationalBadge, availableZoneIds),
  };
}

export {
  QR_LINK_SOURCES,
  BADGE_CATEGORIES,
  DEFAULT_ROLE_BADGE_CATEGORY,
  ACCREDITATION_BADGE_VISUALS,
  ACCREDITATION_PRINT_STATUS_OPTIONS,
  ACCREDITATION_QR_RESOURCE_SEED,
  BADGE_STORAGE_LOCATIONS,
  NON_NOMINATIVE_BADGE_TEMPLATES,
  normalizeAccreditationConfigurationPayload,
  normalizeAccreditationOverride,
};
