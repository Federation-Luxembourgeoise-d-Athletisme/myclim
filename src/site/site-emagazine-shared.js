import {
  buildAthleteIdentityKeys,
  resolveAthleteBirthYear,
} from "../app/athlete-portal-hooks";

function normalizeText(value) {
  return String(value || "").trim();
}

function makeStableId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

export const DEFAULT_EMAGAZINE_CONFIG = {
  cover: {
    imageUrl: "",
  },
  welcome: {
    title: "Welcome",
    intro: "",
    body: "",
    photoUrl: "",
    personName: "",
    personTitle: "",
  },
  sponsorPages: [],
  specialRaces: {
    influencerRace: {
      enabled: true,
      title: "Influencer Race",
      subtitle: "A fast and fun pre-programme battle on the track.",
      eventLabel: "60m",
      participants: [],
    },
    businessRace: {
      enabled: true,
      title: "Business Race",
      subtitle: "Companies step onto the track before the elite session.",
      eventLabel: "Business race",
      participants: [],
    },
  },
  highlightPages: [],
  partnerPages: [],
  pageOrder: [],
};

function buildOfficialStartlistPageIds(edition) {
  return buildOfficialStartlistGroups(edition?.disciplines || [], [])
    .map((group) => `official-startlist:${group.id}`);
}

function buildDefaultPageOrder(config, edition) {
  return [
    "cover",
    "welcome",
    "timetable",
    "sponsors",
    "special:influencerRace",
    "special:businessRace",
    ...config.highlightPages.map((page) => `highlight:${page.id}`),
    ...config.partnerPages.map((page) => `partner:${page.id}`),
    ...buildOfficialStartlistPageIds(edition),
  ];
}

function normalizePageOrder(pageOrder, config, edition) {
  const officialStartlistIds = buildOfficialStartlistPageIds(edition);
  const knownIds = new Set(buildDefaultPageOrder(config, edition));
  const normalizedRaw = Array.isArray(pageOrder)
    ? pageOrder.flatMap((value) => {
      const normalizedValue = normalizeText(value);
      if (normalizedValue === "official-startlists") return officialStartlistIds;
      return normalizedValue ? [normalizedValue] : [];
    }).filter((value) => knownIds.has(value))
    : [];
  const normalized = normalizedRaw.filter((value, index) => normalizedRaw.indexOf(value) === index);
  const missing = buildDefaultPageOrder(config, edition).filter((id) => !normalized.includes(id));
  return [...normalized, ...missing];
}

export function buildEmagazinePageRegistry(config, edition) {
  const officialStartlists = buildOfficialStartlistGroups(edition?.disciplines || [], []);
  return [
    { id: "cover", kind: "core", title: "Cover", editorAnchor: "emag-cover", sourcePath: "/app/website/emagazine" },
    { id: "welcome", kind: "core", title: "Welcome", editorAnchor: "emag-welcome", sourcePath: "/app/website/emagazine" },
    { id: "timetable", kind: "core", title: "Timetable", editorAnchor: null, sourcePath: "/app/website/edition" },
    {
      id: "sponsors",
      kind: "core",
      title: "Sponsor overview",
      editorAnchor: "emag-sponsor-pages",
      sourcePath: config.sponsorPages.length ? "/app/website/emagazine" : "/app/website/sponsors",
    },
    {
      id: "special:influencerRace",
      kind: "special",
      title: config.specialRaces.influencerRace.title || "Influencer Race",
      editorAnchor: "emag-races",
      sourcePath: "/app/website/emagazine",
      enabled: config.specialRaces.influencerRace.enabled,
    },
    {
      id: "special:businessRace",
      kind: "special",
      title: config.specialRaces.businessRace.title || "Business Race",
      editorAnchor: "emag-races",
      sourcePath: "/app/website/emagazine",
      enabled: config.specialRaces.businessRace.enabled,
    },
    ...config.highlightPages.map((page) => ({
      id: `highlight:${page.id}`,
      kind: "highlight",
      sourceId: page.id,
      title: page.title || "Highlight page",
      editorAnchor: `emag-highlight-${page.id}`,
      sourcePath: "/app/website/emagazine",
    })),
    ...config.partnerPages.map((page) => ({
      id: `partner:${page.id}`,
      kind: "partner",
      sourceId: page.id,
      title: page.headline || "Partner page",
      editorAnchor: `emag-partner-${page.id}`,
      sourcePath: "/app/website/emagazine",
    })),
    ...officialStartlists.map((group) => ({
      id: `official-startlist:${group.id}`,
      kind: "auto",
      title: group.title,
      editorAnchor: null,
      sourcePath: "/app/athlete-portal/athletes",
    })),
  ];
}

function normalizeParticipant(participant, index) {
  return {
    id: participant?.id || makeStableId("participant", index),
    lane: normalizeText(participant?.lane),
    name: normalizeText(participant?.name),
    photoUrl: normalizeText(participant?.photoUrl),
    instagram: normalizeText(participant?.instagram),
    description: normalizeText(participant?.description),
    nationality: normalizeText(participant?.nationality),
    team: normalizeText(participant?.team),
  };
}

function normalizeHighlightPage(page, index) {
  const athleteIds = Array.isArray(page?.athleteIds)
    ? page.athleteIds.map((value) => normalizeText(value)).filter(Boolean)
    : [];

  const athletePhotosSource = page?.athletePhotos && typeof page.athletePhotos === "object" ? page.athletePhotos : {};
  const athletePhotos = Object.entries(athletePhotosSource).reduce((accumulator, [athleteId, url]) => {
    const normalizedUrl = normalizeText(url);
    if (normalizedUrl) accumulator[athleteId] = normalizedUrl;
    return accumulator;
  }, {});

  return {
    id: page?.id || makeStableId("highlight", index),
    type: normalizeText(page?.type) || "duel",
    title: normalizeText(page?.title),
    subtitle: normalizeText(page?.subtitle),
    body: normalizeText(page?.body),
    imageUrl: normalizeText(page?.imageUrl),
    athleteIds,
    athletePhotos,
  };
}

function normalizePartnerPage(page, index) {
  return {
    id: page?.id || makeStableId("partner", index),
    sponsorId: normalizeText(page?.sponsorId),
    headline: normalizeText(page?.headline),
    body: normalizeText(page?.body),
    imageUrl: normalizeText(page?.imageUrl),
    ctaLabel: normalizeText(page?.ctaLabel),
    ctaUrl: normalizeText(page?.ctaUrl),
  };
}

function normalizeImportedPage(page, index, prefix) {
  return {
    id: page?.id || makeStableId(prefix, index),
    title: normalizeText(page?.title),
    imageUrl: normalizeText(page?.imageUrl),
  };
}

export function normalizeEmagazineConfig(rawConfig, edition) {
  const currentYear = edition?.year || edition?.id || "";
  const welcomeDefaults = {
    ...DEFAULT_EMAGAZINE_CONFIG.welcome,
    title: `Welcome to the ${currentYear} edition`,
  };

  const specialRaces = rawConfig?.specialRaces || {};

  const normalized = {
    cover: {
      imageUrl: normalizeText(rawConfig?.cover?.imageUrl),
    },
    welcome: {
      ...welcomeDefaults,
      ...(rawConfig?.welcome || {}),
      title: normalizeText(rawConfig?.welcome?.title) || welcomeDefaults.title,
      intro: normalizeText(rawConfig?.welcome?.intro),
      body: normalizeText(rawConfig?.welcome?.body),
      photoUrl: normalizeText(rawConfig?.welcome?.photoUrl),
      personName: normalizeText(rawConfig?.welcome?.personName),
      personTitle: normalizeText(rawConfig?.welcome?.personTitle),
    },
    specialRaces: {
      influencerRace: {
        ...DEFAULT_EMAGAZINE_CONFIG.specialRaces.influencerRace,
        ...(specialRaces.influencerRace || {}),
        participants: (specialRaces.influencerRace?.participants || []).map(normalizeParticipant),
      },
      businessRace: {
        ...DEFAULT_EMAGAZINE_CONFIG.specialRaces.businessRace,
        ...(specialRaces.businessRace || {}),
        participants: (specialRaces.businessRace?.participants || []).map(normalizeParticipant),
      },
    },
    highlightPages: (rawConfig?.highlightPages || []).map(normalizeHighlightPage),
    partnerPages: (rawConfig?.partnerPages || []).map(normalizePartnerPage),
    sponsorPages: (rawConfig?.sponsorPages || []).map((page, index) => normalizeImportedPage(page, index, "sponsor-page")),
    pageOrder: [],
  };

  normalized.pageOrder = normalizePageOrder(rawConfig?.pageOrder, normalized, edition);
  return normalized;
}

const GENDER_SUFFIX_RE = /^(.+?)\s+(W|M|F|H|Women|Men|Females?|Males?)$/i;
const GENDER_PREFIX_RE = /^(W|M|F|H)\s+(.+)$/i;

export function parseEventField(raw) {
  if (!raw) return { discipline: "", gender: null };
  const value = String(raw).trim();
  let match = GENDER_SUFFIX_RE.exec(value);
  if (match) {
    const gender = match[2][0].toUpperCase();
    return { discipline: match[1].trim(), gender: gender === "W" || gender === "F" ? "W" : "M" };
  }
  match = GENDER_PREFIX_RE.exec(value);
  if (match) {
    const gender = match[1][0].toUpperCase();
    return { discipline: match[2].trim(), gender: gender === "W" || gender === "F" ? "W" : "M" };
  }
  return { discipline: value, gender: null };
}

function normalizeDisciplineToken(value) {
  return String(value || "")
    .replace(/(\d)\s+(m\b)/gi, "$1$2")
    .replace(/\s+/g, "")
    .replace(/hurdles/gi, "H")
    .toLowerCase();
}

const DISCIPLINE_ORDER = [
  "50m",
  "60m",
  "60mH",
  "100m",
  "110mH",
  "200m",
  "400m",
  "400mH",
  "600m",
  "800m",
  "1000m",
  "1500m",
  "1mile",
  "2000m",
  "3000m",
  "3000mSC",
  "5000m",
  "10000m",
  "HighJump",
  "LongJump",
  "PoleVault",
  "ShotPut",
  "TripleJump",
  "WeightThrow",
];

export function findMeetingRecord(records = [], discipline, gender) {
  const normalizedDiscipline = normalizeDisciplineToken(discipline);
  const normalizedGender = String(gender || "").toUpperCase();
  return records.find((record) => (
    normalizeDisciplineToken(record?.discipline) === normalizedDiscipline
    && String(record?.gender || "").toUpperCase() === normalizedGender
  )) || null;
}

export function disciplineSortIndex(value) {
  const token = normalizeDisciplineToken(value);
  const index = DISCIPLINE_ORDER.findIndex((item) => token === item.toLowerCase());
  return index === -1 ? 999 : index;
}

function toLaneNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 999;
}

function toHeatNumber(value) {
  const clean = String(value || "").trim().replace(/[^\d]/g, "");
  const numeric = Number(clean);
  return Number.isFinite(numeric) && clean ? numeric : 999;
}

function compareStartlistEntries(a, b) {
  const heatDiff = toHeatNumber(a.heat) - toHeatNumber(b.heat);
  if (heatDiff !== 0) return heatDiff;
  const laneDiff = toLaneNumber(a.lane) - toLaneNumber(b.lane);
  if (laneDiff !== 0) return laneDiff;
  return `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`);
}

export function buildOfficialStartlistGroups(disciplines = [], athletes = []) {
  const configuredGroups = [];

  disciplines.forEach((discipline) => {
    if (discipline?.womenPrize) {
      configuredGroups.push({
        id: `${discipline.event}-W`,
        discipline: discipline.event,
        gender: "W",
        title: `${discipline.event} Women`,
      });
    }
    if (discipline?.menPrize) {
      configuredGroups.push({
        id: `${discipline.event}-M`,
        discipline: discipline.event,
        gender: "M",
        title: `${discipline.event} Men`,
      });
    }
  });

  return configuredGroups
    .map((group) => {
      const entries = athletes
        .filter((athlete) => String(athlete?.status || "").toLowerCase() !== "out")
        .filter((athlete) => {
          const parsed = parseEventField(athlete.event);
          return normalizeDisciplineToken(parsed.discipline) === normalizeDisciplineToken(group.discipline)
            && (!parsed.gender || parsed.gender === group.gender);
        })
        .sort(compareStartlistEntries);

      return { ...group, entries };
    })
    .sort((a, b) => {
      const disciplineDiff = disciplineSortIndex(a.discipline) - disciplineSortIndex(b.discipline);
      if (disciplineDiff !== 0) return disciplineDiff;
      if (a.gender !== b.gender) return a.gender === "W" ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}

export function buildSpecialRaceStartlistGroups(config) {
  const races = [
    { key: "influencerRace", label: "Influencer Race" },
    { key: "businessRace", label: "Business Race" },
  ];

  return races
    .map(({ key, label }) => {
      const race = config?.specialRaces?.[key];
      if (!race?.enabled) return null;
      const entries = (race.participants || [])
        .map(normalizeParticipant)
        .filter((participant) => participant.name)
        .sort((a, b) => toLaneNumber(a.lane) - toLaneNumber(b.lane) || a.name.localeCompare(b.name));
      return {
        id: key,
        discipline: normalizeText(race.eventLabel) || label,
        title: normalizeText(race.title) || label,
        subtitle: normalizeText(race.subtitle),
        entries,
      };
    })
    .filter(Boolean);
}

function mergeAthleteCard(base, overlay) {
  if (!overlay) return base;
  return {
    ...base,
    ...overlay,
    lastName: overlay.lastName || base.lastName,
    firstName: overlay.firstName || base.firstName,
    nationality: overlay.nationality || base.nationality,
    birthYear: overlay.birthYear || base.birthYear,
    waid: overlay.waid || base.waid,
    waUrl: overlay.waUrl || base.waUrl,
    editions: Array.isArray(base.editions) ? base.editions : [],
  };
}

function registryKeyForAthlete(athlete, registryMap, waidMap, identityMap) {
  if (athlete?.registryAthleteId && registryMap.has(athlete.registryAthleteId)) {
    return athlete.registryAthleteId;
  }
  if (athlete?.waid && waidMap.has(String(athlete.waid))) {
    return waidMap.get(String(athlete.waid));
  }
  const keys = buildAthleteIdentityKeys(athlete);
  for (const key of keys) {
    if (identityMap.has(key)) return identityMap.get(key);
  }
  return null;
}

export function buildAthleteLookup(registry = [], athletes = []) {
  const byId = new Map();
  const byWaid = new Map();
  const byIdentity = new Map();

  registry.forEach((entry) => {
    if (!entry?._docId) return;
    byId.set(entry._docId, {
      ...entry,
      editions: Array.isArray(entry.editions) ? entry.editions : [],
      birthYear: entry.birthYear || entry.yob || resolveAthleteBirthYear(entry),
    });
    if (entry.waid != null && entry.waid !== "") {
      byWaid.set(String(entry.waid), entry._docId);
    }
    buildAthleteIdentityKeys(entry).forEach((key) => {
      if (key && !byIdentity.has(key)) {
        byIdentity.set(key, entry._docId);
      }
    });
  });

  athletes.forEach((athlete) => {
    const registryId = registryKeyForAthlete(athlete, byId, byWaid, byIdentity);
    const baseCard = {
      _docId: registryId || athlete.id,
      lastName: athlete.lastName || "",
      firstName: athlete.firstName || "",
      nationality: athlete.nationality || "",
      birthYear: resolveAthleteBirthYear(athlete),
      waid: athlete.waid || null,
      waUrl: athlete.waUrl || "",
      event: athlete.event || "",
      waPbIndoor: athlete.waPbIndoor || athlete.pbIndoor || "",
      waPbOutdoor: athlete.waPbOutdoor || athlete.pbOutdoor || "",
      waIndoorSbCurrent: athlete.waIndoorSbCurrent || "",
      waIndoorSb: athlete.waIndoorSb || athlete.sb || "",
      waOutdoorSb: athlete.waOutdoorSb || "",
      editions: [],
    };

    if (!registryId) {
      byId.set(baseCard._docId, mergeAthleteCard(byId.get(baseCard._docId) || {}, baseCard));
      return;
    }

    const merged = mergeAthleteCard(byId.get(registryId), baseCard);
    byId.set(registryId, merged);
  });

  return byId;
}

export function athleteDisplayName(athlete) {
  return [athlete?.firstName, athlete?.lastName].filter(Boolean).join(" ").trim();
}

export function athleteSubtitle(athlete) {
  const bits = [];
  if (athlete?.nationality) bits.push(athlete.nationality);
  if (athlete?.birthYear) bits.push(String(athlete.birthYear));
  return bits.join(" • ");
}

export function athleteStats(athlete) {
  return [
    athlete?.waPbIndoor ? { label: "PB indoor", value: athlete.waPbIndoor } : null,
    athlete?.waIndoorSbCurrent ? { label: "SB indoor", value: athlete.waIndoorSbCurrent } : null,
    !athlete?.waIndoorSbCurrent && athlete?.waIndoorSb ? { label: "SB indoor", value: athlete.waIndoorSb } : null,
    athlete?.waPbOutdoor ? { label: "PB outdoor", value: athlete.waPbOutdoor } : null,
  ].filter(Boolean);
}

export function athleteParticipationSummary(athlete) {
  const editions = Array.isArray(athlete?.editions) ? athlete.editions : [];
  if (!editions.length) return [];
  return editions
    .slice()
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))
    .slice(0, 5);
}

export function buildAthleteOptions(registry = [], athletes = []) {
  const lookup = buildAthleteLookup(registry, athletes);
  return [...lookup.values()]
    .map((athlete) => ({
      value: athlete._docId,
      label: `${athleteDisplayName(athlete)}${athlete.nationality ? ` (${athlete.nationality})` : ""}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
