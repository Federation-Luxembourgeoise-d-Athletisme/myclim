// Badges réglés dans la matrice « Zones par rôle » à côté des rôles bénévoles
// (Margot, 12/11/2026) :
//  - les badges sans nom (Athlete, Coach, + types ajoutés : accompagnateur,
//    prestataire…) : nom imprimé, couleur de bande, zones ;
//  - le badge nominatif des athlètes des courses nationales (pré-programme) :
//    couleur et zones ; le nom vient des athlètes sélectionnés.
// Avant, Athlete et Coach étaient écrits en dur : ce sont les valeurs de départ.
// Règles pures, testées dans tests/extra-badge-types.test.js.

const NAMELESS_BADGE_SEED = [
  { id: "athlete", label: "Athlete", category: "athlete", zoneIds: ["zone-infield", "zone-warmup", "zone-mixed", "zone-vip"], builtIn: true },
  { id: "coach", label: "Coach", category: "coach", zoneIds: ["zone-warmup", "zone-coaching"], builtIn: true },
];

const NATIONAL_BADGE_SEED = { label: "National race", category: "athlete", zoneIds: ["zone-warmup", "zone-infield"] };

const BAND_KEYS = ["organisation", "athlete", "coach", "judge", "press", "photographer", "volunteer", "technical"];

function cleanZoneIds(value, availableZoneIds) {
  const list = Array.isArray(value) ? value.map(String) : [];
  return [...new Set(list)].filter((id) => !availableZoneIds || availableZoneIds.has(id));
}

function cleanCategory(value, fallback) {
  return BAND_KEYS.includes(value) ? value : fallback;
}

// Types sans nom enregistrés ; Athlete et Coach existent toujours.
function normalizeNamelessBadgeTypes(stored, availableZoneIds = null) {
  const source = Array.isArray(stored) ? stored : [];
  const byId = new Map(source.filter((item) => item && item.id).map((item) => [String(item.id), item]));
  const builtIns = NAMELESS_BADGE_SEED.map((seed) => {
    const saved = byId.get(seed.id) || {};
    return {
      id: seed.id,
      label: String(saved.label || seed.label).trim() || seed.label,
      category: cleanCategory(saved.category, seed.category),
      zoneIds: cleanZoneIds(Array.isArray(saved.zoneIds) ? saved.zoneIds : seed.zoneIds, availableZoneIds),
      builtIn: true,
    };
  });
  const custom = source
    .filter((item) => item && item.id && !NAMELESS_BADGE_SEED.some((seed) => seed.id === String(item.id)))
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || "").trim() || "Badge",
      category: cleanCategory(item.category, "organisation"),
      zoneIds: cleanZoneIds(item.zoneIds, availableZoneIds),
      builtIn: false,
    }));
  return [...builtIns, ...custom];
}

function normalizeNationalBadge(stored, availableZoneIds = null) {
  const saved = stored && typeof stored === "object" ? stored : {};
  return {
    label: String(saved.label || NATIONAL_BADGE_SEED.label).trim() || NATIONAL_BADGE_SEED.label,
    category: cleanCategory(saved.category, NATIONAL_BADGE_SEED.category),
    zoneIds: cleanZoneIds(Array.isArray(saved.zoneIds) ? saved.zoneIds : NATIONAL_BADGE_SEED.zoneIds, availableZoneIds),
  };
}

function toggleZone(zoneIds = [], zoneId) {
  return zoneIds.includes(zoneId) ? zoneIds.filter((id) => id !== zoneId) : [...zoneIds, zoneId];
}

// Clé du badge d'un athlète de course nationale dans les suivis d'impression
// (volunteerOverrides) : un préfixe pour ne jamais croiser un bénévole.
function nationalBadgeKey(requestId) {
  return `nr-${requestId}`;
}

export {
  NAMELESS_BADGE_SEED,
  NATIONAL_BADGE_SEED,
  nationalBadgeKey,
  normalizeNamelessBadgeTypes,
  normalizeNationalBadge,
  toggleZone,
};
