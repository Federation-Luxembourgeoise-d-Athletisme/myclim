// Page « liens » grand public (/links, derrière le QR code affiché à la Coque).
// Réglages éditables dans siteContent/linksPage (admin : Site web → Page liens).
// Les infos d'édition (date, lieu, résultats en direct, streaming, horaire,
// e-magazine) viennent de meetingEditions et ne sont pas dupliquées ici.
// Logique pure, testée dans tests/links-page-config.test.js.

const LINKS_PAGE_DOC_ID = "linksPage";
// Adresse imprimée dans le QR code : toujours le site en production, même
// quand l'admin est ouvert en local.
const PUBLIC_LINKS_URL = "https://cmcm-luxembourg-indoor-meeting.lu/links";
// Ancienne adresse de la page Facebook, qui ne fonctionne plus.
const OLD_FACEBOOK_URL = "https://www.facebook.com/LuxembourgIndoorMeeting";
const MEETING_TIME_ZONE = "Europe/Luxembourg";

function L(en, fr) {
  return { en, fr };
}

const LINKS_PAGE_BLOCKS = [
  { key: "now", label: "Maintenant sur la piste (jour J, à partir de l'horaire)" },
  { key: "results", label: "Résultats en direct" },
  { key: "stream", label: "Regarder le direct" },
  { key: "tickets", label: "Billets" },
  { key: "timetable", label: "Horaire" },
  { key: "emagazine", label: "E-magazine" },
  { key: "photos", label: "Photos" },
  { key: "access", label: "Venir à la Coque" },
  { key: "social", label: "Réseaux sociaux" },
  { key: "partners", label: "Partenaires" },
];

const DEFAULT_LINKS_PAGE = {
  // auto : mode « jour J » le jour de l'édition ; on / off : forcé.
  liveMode: "auto",
  blocks: Object.fromEntries(LINKS_PAGE_BLOCKS.map((block) => [block.key, true])),
  tickets: {
    url: "https://www.ticket-regional.lu/",
    note: L("From €8 · free for under-18s", "Dès 8 € · gratuit pour les moins de 18 ans"),
    dayNote: L("On sale at the entrance", "Vente sur place à l'entrée"),
  },
  photos: {
    // Galerie du meeting en cours (Sprintshot, renseignée le jour J).
    currentUrl: "",
    currentCredit: "@cmcm_lux_indoor_meet - Sprintshot",
    // Galerie de l'édition précédente (galerie de la fédération).
    previousUrl: "https://flaphoto.net/galerie/index.php?/category/1240",
    previousLabel: L("Photos of the previous edition", "Photos de l'édition précédente"),
  },
  access: {
    doors: L("", ""),
    transport: L("Bus 2, 18, 30 — free public transport", "Bus 2, 18, 30 — transports publics gratuits"),
    parking: L("", ""),
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Coque+Luxembourg",
    infoUrl: "/event",
  },
  social: {
    instagram: "https://www.instagram.com/cmcm_lux_indoor_meet/",
    facebook: "https://www.facebook.com/search/top?q=cmcm%20luxembourg%20indoor%20meeting",
  },
  contactEmail: "events@fla.lu",
};

function text(value) {
  return String(value ?? "").trim();
}

function normalizeLocalized(value, fallback) {
  if (value && typeof value === "object") {
    return { en: text(value.en), fr: text(value.fr) };
  }
  return { ...fallback };
}

function normalizeLinksPage(stored = {}) {
  const base = DEFAULT_LINKS_PAGE;
  const source = stored && typeof stored === "object" ? stored : {};
  const pick = (value, fallback) => (value === undefined || value === null ? fallback : text(value));

  return {
    liveMode: ["auto", "on", "off"].includes(source.liveMode) ? source.liveMode : base.liveMode,
    blocks: Object.fromEntries(
      LINKS_PAGE_BLOCKS.map(({ key }) => [key, source.blocks?.[key] === undefined ? true : Boolean(source.blocks[key])]),
    ),
    tickets: {
      url: pick(source.tickets?.url, base.tickets.url),
      note: normalizeLocalized(source.tickets?.note, base.tickets.note),
      dayNote: normalizeLocalized(source.tickets?.dayNote, base.tickets.dayNote),
    },
    photos: {
      currentUrl: pick(source.photos?.currentUrl, base.photos.currentUrl),
      currentCredit: pick(source.photos?.currentCredit, base.photos.currentCredit),
      previousUrl: pick(source.photos?.previousUrl, base.photos.previousUrl),
      previousLabel: normalizeLocalized(source.photos?.previousLabel, base.photos.previousLabel),
    },
    access: {
      doors: normalizeLocalized(source.access?.doors, base.access.doors),
      transport: normalizeLocalized(source.access?.transport, base.access.transport),
      parking: normalizeLocalized(source.access?.parking, base.access.parking),
      mapsUrl: pick(source.access?.mapsUrl, base.access.mapsUrl),
      infoUrl: pick(source.access?.infoUrl, base.access.infoUrl),
    },
    social: {
      instagram: pick(source.social?.instagram, base.social.instagram),
      // Remplace l'ancienne adresse Facebook si elle est restée enregistrée.
      facebook: source.social?.facebook === OLD_FACEBOOK_URL ? base.social.facebook : pick(source.social?.facebook, base.social.facebook),
    },
    contactEmail: pick(source.contactEmail, base.contactEmail),
  };
}

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Jour (AAAA-MM-JJ) d'une date à Luxembourg, quel que soit le fuseau du téléphone.
function luxembourgDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MEETING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function luxembourgMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: MEETING_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .reduce((accumulator, part) => ({ ...accumulator, [part.type]: part.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isLiveDay(settings, edition, now = new Date()) {
  if (settings?.liveMode === "on") return true;
  if (settings?.liveMode === "off") return false;
  const editionDate = toDate(edition?.date);
  return Boolean(editionDate) && luxembourgDayKey(editionDate) === luxembourgDayKey(now);
}

function parseTimeToMinutes(value) {
  const match = text(value).match(/^(\d{1,2})[:h.](\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Épreuve en cours (la dernière commencée) et les suivantes, d'après
// l'horaire publié de l'édition. Avant la 1re épreuve : les premières à venir.
function getNowOnTrack(timetable = [], now = new Date(), count = 3) {
  const events = (Array.isArray(timetable) ? timetable : [])
    .filter((entry) => entry?.type === "event")
    .map((entry) => ({ ...entry, minutes: parseTimeToMinutes(entry.time) }))
    .filter((entry) => entry.minutes !== null)
    .sort((left, right) => left.minutes - right.minutes);
  if (!events.length) return { current: null, upcoming: [] };

  const nowMinutes = luxembourgMinutes(now);
  const startedIndex = events.reduce((index, entry, position) => (entry.minutes <= nowMinutes ? position : index), -1);
  if (startedIndex === -1) return { current: null, upcoming: events.slice(0, count) };
  if (startedIndex === events.length - 1 && nowMinutes - events[startedIndex].minutes > 60) {
    return { current: null, upcoming: [], finished: true };
  }
  return { current: events[startedIndex], upcoming: events.slice(startedIndex + 1, startedIndex + count) };
}

// Galerie à afficher : celle du meeting dès qu'elle est renseignée, sinon
// celle de l'édition précédente.
function resolvePhotos(photos) {
  if (text(photos?.currentUrl)) {
    return { url: text(photos.currentUrl), kind: "current", credit: text(photos.currentCredit) };
  }
  if (text(photos?.previousUrl)) {
    return { url: text(photos.previousUrl), kind: "previous", credit: "" };
  }
  return null;
}

export {
  DEFAULT_LINKS_PAGE,
  LINKS_PAGE_BLOCKS,
  LINKS_PAGE_DOC_ID,
  PUBLIC_LINKS_URL,
  getNowOnTrack,
  isLiveDay,
  luxembourgDayKey,
  normalizeLinksPage,
  parseTimeToMinutes,
  resolvePhotos,
};
