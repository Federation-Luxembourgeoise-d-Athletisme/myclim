import {
  buildAthleteIdentityKeys,
  resolveAthleteBirthYear,
} from "../app/athlete-portal-hooks";
// Cut-out portrait of the 2026 magazine: photo of the prefilled athlete page.
import vanDerWekenPhoto from "../assets/emag-athlete-van-der-weken.png";
// Photos of the 2026 duel pages: sample highlight pages to try the layouts.
import bredauPhoto from "../assets/emag-samples/bredau.jpg";
import iguacelPhoto from "../assets/emag-samples/iguacel.jpg";
import fernandezPhoto from "../assets/emag-samples/fernandez.jpg";
import martinezPhoto from "../assets/emag-samples/martinez.jpg";
import szymanskiPhoto from "../assets/emag-samples/szymanski.jpg";
import czykierPhoto from "../assets/emag-samples/czykier.jpg";
import llopisPhoto from "../assets/emag-samples/llopis.jpg";
import verheydenPhoto from "../assets/emag-samples/verheyden.jpg";
import querinjeanPhoto from "../assets/emag-samples/querinjean.jpg";

function normalizeText(value) {
  return String(value || "").trim();
}

function makeStableId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

export const DEFAULT_EMAGAZINE_CONFIG = {
  cover: {
    // Full A4 page designed elsewhere; replaces the built-in cover.
    imageUrl: "",
    // Landscape key visual shown in the built-in cover.
    visualUrl: "",
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
  // One page per Luxembourg athlete. Bests come from World Athletics and the
  // meeting stats from the meeting results, both loaded in the admin.
  athletePages: [
    {
      id: "athlete-van-der-weken",
      firstName: "Patrizia",
      lastName: "Van der Weken",
      country: "Luxembourg",
      waid: "14621598",
      photoUrl: vanDerWekenPhoto,
      text: "",
      events: [
        { id: "wa-60", disciplineCode: "60", event: "60m", pb: "7.01", pbYear: "2026", record: "NR", sb: "7.01", sbYear: "2026", shown: true },
        { id: "wa-200", disciplineCode: "200", event: "200m", pb: "23.09", pbYear: "2026", record: "NR", sb: "23.09", sbYear: "2026", shown: true },
        { id: "wa-50", disciplineCode: "50", event: "50m", pb: "6.12", pbYear: "2025", record: "NR", sb: "", sbYear: "", shown: false },
        { id: "wa-300", disciplineCode: "300", event: "300m", pb: "39.55", pbYear: "2021", record: "", sb: "", sbYear: "", shown: false },
      ],
      waUpdatedAt: "2026-11-03",
      meetingStats: {
        editions: 10,
        firstYear: 2015,
        wins: 7,
        bests: [
          { event: "60m", mark: "7.07", year: 2025 },
          { event: "200m", mark: "23.17", year: 2025 },
          { event: "50m", mark: "6.37", year: 2019 },
        ],
      },
      showMeetingStats: true,
    },
  ],
  partnerPages: [],
  // Header photo of each official start list page, by group id ("60m-W").
  startlistPhotos: {},
  // Closing "Thank you" page, prefilled with the 2026 text.
  thanks: {
    title: "Thank you",
    intro: "To all the people and institutions without whom this magnificent event could not have taken place.",
    names: [
      "CMCM",
      "Ville de Luxembourg",
      "Luxembourg Let’s Make It Happen",
      "The Ministry of Sports",
      "Institutional partners: the Coque, European Athletics, LUNEX",
      "The judges",
      "The volunteers",
      "LUNEX students",
      "FLA staff",
      "The meeting director",
    ],
    closing: "Without the 250 people who have worked on this project over the last 6 months, the event would not have been possible. Thank you all for your commitment — see you next year!",
    photoUrl: "",
  },
  pageOrder: [],
};

// 2026 duel pages with their World Athletics PBs (November 2026), added to
// every edition until they are deleted in the admin.
const SAMPLE_HIGHLIGHT_PAGES = [
  {
    id: "sample-duel",
    type: "duel",
    title: "3000m Men",
    event: "3000m",
    athletes: [
      { id: "wa-14754671", firstName: "Ruben", lastName: "Verheyden", nationality: "BEL", waid: "14754671", pb: "7:39.90", record: "", photoUrl: verheydenPhoto },
      { id: "wa-14929147", firstName: "Ruben", lastName: "Querinjean", nationality: "LUX", waid: "14929147", pb: "7:40.64", record: "NR", photoUrl: querinjeanPhoto },
    ],
  },
  {
    id: "sample-trio",
    type: "trio",
    title: "Athletes to watch",
    subtitle: "400m Men",
    event: "400m",
    athletes: [
      { id: "wa-14771929", firstName: "Jean Paul", lastName: "Bredau", nationality: "GER", waid: "14771929", pb: "45.94", record: "", photoUrl: bredauPhoto },
      { id: "wa-14564235", firstName: "Christian", lastName: "Iguacel", nationality: "BEL", waid: "14564235", pb: "46.48", record: "", photoUrl: iguacelPhoto },
      { id: "wa-14932553", firstName: "Markel", lastName: "Fernandez", nationality: "ESP", waid: "14932553", pb: "45.95", record: "", photoUrl: fernandezPhoto },
    ],
  },
  {
    id: "sample-quatuor",
    type: "quatuor",
    title: "Pick your podium",
    subtitle: "60m hurdles Men",
    event: "60m hurdles",
    athletes: [
      { id: "wa-14734118", firstName: "Asier", lastName: "Martínez", nationality: "ESP", waid: "14734118", pb: "7.49", record: "", photoUrl: martinezPhoto },
      { id: "wa-14799803", firstName: "Jakub", lastName: "Szymański", nationality: "POL", waid: "14799803", pb: "7.37", record: "NR", photoUrl: szymanskiPhoto },
      { id: "wa-14434325", firstName: "Damian", lastName: "Czykier", nationality: "POL", waid: "14434325", pb: "7.48", record: "", photoUrl: czykierPhoto },
      { id: "wa-14711683", firstName: "Enrique", lastName: "Llopis", nationality: "ESP", waid: "14711683", pb: "7.42", record: "NR", photoUrl: llopisPhoto },
    ],
  },
];

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
    ...config.athletePages.map((page) => `athlete:${page.id}`),
    ...config.highlightPages.map((page) => `highlight:${page.id}`),
    ...config.partnerPages.map((page) => `partner:${page.id}`),
    ...buildOfficialStartlistPageIds(edition),
    "clubs",
    "thanks",
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
  // A page new to a saved order goes after the page it follows by default.
  const defaultOrder = buildDefaultPageOrder(config, edition);
  defaultOrder.forEach((id, index) => {
    if (normalized.includes(id)) return;
    const previous = defaultOrder.slice(0, index).reverse().find((entry) => normalized.includes(entry));
    normalized.splice(previous ? normalized.indexOf(previous) + 1 : 0, 0, id);
  });
  return normalized;
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
    ...config.athletePages.map((page) => ({
      id: `athlete:${page.id}`,
      kind: "athlete",
      sourceId: page.id,
      title: [page.firstName, page.lastName].filter(Boolean).join(" ") || "Athlete page",
      editorAnchor: null,
      sourcePath: "/app/website/emagazine",
    })),
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
      editorAnchor: "emag-startlist-photos",
      sourcePath: "/app/athlete-portal/athletes",
    })),
    // FLA clubs and how to join them (list in src/data/flaClubs.json).
    { id: "clubs", kind: "closing", title: "Athletics clubs", editorAnchor: null, sourcePath: "/e-magazine" },
    { id: "thanks", kind: "closing", title: "Thank you", editorAnchor: null, sourcePath: "/app/website/emagazine" },
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
    // Event of the World Athletics PBs ("400m", "60m hurdles").
    event: normalizeText(page?.event),
    // Athletes saved with the page (name, flag, WA PB, photo): the public can
    // read them, unlike the athlete database behind the older athleteIds.
    athletes: (Array.isArray(page?.athletes) ? page.athletes : []).map((athlete, athleteIndex) => ({
      id: athlete?.id || makeStableId("athlete", athleteIndex),
      firstName: normalizeText(athlete?.firstName),
      lastName: normalizeText(athlete?.lastName),
      nationality: normalizeText(athlete?.nationality),
      waid: normalizeText(athlete?.waid),
      pb: normalizeText(athlete?.pb),
      record: normalizeText(athlete?.record),
      photoUrl: normalizeText(athlete?.photoUrl),
    })),
    athleteIds,
    athletePhotos,
  };
}

function normalizeAthletePage(page, index) {
  return {
    id: page?.id || makeStableId("athlete", index),
    firstName: normalizeText(page?.firstName),
    lastName: normalizeText(page?.lastName),
    country: normalizeText(page?.country),
    waid: normalizeText(page?.waid),
    photoUrl: normalizeText(page?.photoUrl),
    text: normalizeText(page?.text),
    events: (Array.isArray(page?.events) ? page.events : []).map((entry, eventIndex) => ({
      id: entry?.id || makeStableId("event", eventIndex),
      disciplineCode: normalizeText(entry?.disciplineCode),
      event: normalizeText(entry?.event),
      pb: normalizeText(entry?.pb),
      pbYear: normalizeText(entry?.pbYear),
      record: normalizeText(entry?.record),
      sb: normalizeText(entry?.sb),
      sbYear: normalizeText(entry?.sbYear),
      shown: entry?.shown !== false,
    })),
    waUpdatedAt: normalizeText(page?.waUpdatedAt),
    meetingStats: page?.meetingStats && typeof page.meetingStats === "object" ? page.meetingStats : null,
    showMeetingStats: page?.showMeetingStats !== false,
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

function normalizeThanks(raw) {
  const defaults = DEFAULT_EMAGAZINE_CONFIG.thanks;
  if (!raw || typeof raw !== "object") return { ...defaults, names: [...defaults.names] };
  return {
    title: normalizeText(raw.title) || defaults.title,
    intro: normalizeText(raw.intro),
    names: Array.isArray(raw.names) ? raw.names.map(normalizeText).filter(Boolean) : [...defaults.names],
    closing: normalizeText(raw.closing),
    photoUrl: normalizeText(raw.photoUrl),
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
      visualUrl: normalizeText(rawConfig?.cover?.visualUrl),
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
    highlightPages: [
      ...(rawConfig?.highlightPages || []),
      ...SAMPLE_HIGHLIGHT_PAGES.filter((page) => !(rawConfig?.highlightPages || []).some((saved) => saved?.id === page.id)
        && !(rawConfig?.dismissedSamples || []).includes(page.id)),
    ].map(normalizeHighlightPage),
    dismissedSamples: Array.isArray(rawConfig?.dismissedSamples) ? rawConfig.dismissedSamples.map(normalizeText).filter(Boolean) : [],
    athletePages: (Array.isArray(rawConfig?.athletePages) ? rawConfig.athletePages : DEFAULT_EMAGAZINE_CONFIG.athletePages)
      .map(normalizeAthletePage),
    partnerPages: (rawConfig?.partnerPages || []).map(normalizePartnerPage),
    sponsorPages: (rawConfig?.sponsorPages || []).map((page, index) => normalizeImportedPage(page, index, "sponsor-page")),
    startlistPhotos: Object.entries(rawConfig?.startlistPhotos || {}).reduce((accumulator, [groupId, url]) => {
      const normalizedUrl = normalizeText(url);
      if (normalizedUrl) accumulator[groupId] = normalizedUrl;
      return accumulator;
    }, {}),
    thanks: normalizeThanks(rawConfig?.thanks),
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
