// Roadbook athlètes : modèle de contenu partagé entre l'admin
// (/app/athlete-roadbook) et la page publique (/athletes/roadbook).
// Stocké dans athleteRoadbooks/{année de l'édition}. Chaque texte est
// bilingue { en, fr } ; un texte sur plusieurs lignes s'affiche en liste.
// Contenu par défaut = roadbook 2026, corrigé (AM/PM, coquilles).

const ROADBOOK_LANGUAGES = ["en", "fr"];
const ROADBOOK_COLLECTION = "athleteRoadbooks";

const SCHEDULE_ITEM_ICONS = [
  { value: "gym", label: "Salle de sport", emoji: "🏋️" },
  { value: "coque", label: "Coque", emoji: "🏟️" },
  { value: "lunch", label: "Déjeuner", emoji: "🥗" },
  { value: "dinner", label: "Dîner", emoji: "🍽️" },
  { value: "shuttle", label: "Navette", emoji: "🚌" },
  { value: "physio", label: "Kiné", emoji: "💆" },
  { value: "info", label: "Info", emoji: "ℹ️" },
];

function getScheduleIconEmoji(icon) {
  return SCHEDULE_ITEM_ICONS.find((option) => option.value === icon)?.emoji || "ℹ️";
}

// Colonnes du tableau des call times (modèle 2026). Les alias servent à
// reconnaître les en-têtes de l'Excel importé (anglais ou français).
const CALL_TIME_COLUMNS = [
  { key: "event", label: { en: "Event", fr: "Épreuve" }, aliases: ["event", "epreuve", "discipline"] },
  { key: "firstCall", label: { en: "1st Call 10'", fr: "1er appel 10'" }, aliases: ["1st call", "1st call 10'", "first call", "1er appel", "premier appel"] },
  { key: "lastCall", label: { en: "Last Call 3'", fr: "Dernier appel 3'" }, aliases: ["last call", "last call 3'", "dernier appel"] },
  { key: "officialCall", label: { en: "Official Call Room Time", fr: "Heure chambre d'appel" }, aliases: ["official call room time", "official call room", "official call", "chambre d'appel", "heure chambre d'appel", "heure officielle chambre d'appel"] },
  { key: "callRoomOut", label: { en: "Call Room Out", fr: "Sortie chambre d'appel" }, aliases: ["call room out", "sortie chambre d'appel", "sortie chambre d appel", "sortie"] },
  { key: "warmUp", label: { en: "Warm-Up Infield", fr: "Échauffement infield" }, aliases: ["warm-up infield", "warm up infield", "warm-up", "warmup", "echauffement", "echauffement infield"] },
  { key: "presentation", label: { en: "Presentation Start", fr: "Présentation" }, aliases: ["presentation start", "presentation", "presentati on start", "debut presentation"] },
  { key: "start", label: { en: "Event Start", fr: "Départ" }, aliases: ["event start", "start", "depart", "debut epreuve", "heure de depart"] },
];

const L = (en, fr) => ({ en, fr });

const DEFAULT_ROADBOOK = {
  status: "draft",
  intro: L(
    "Everything you need for your stay at the CMCM Luxembourg Indoor Meeting.",
    "Tout ce qu'il faut savoir pour ton séjour au CMCM Luxembourg Indoor Meeting.",
  ),
  hotel: "Meliá Luxembourg Hotel",
  arrival: {
    meetingPoint: L(
      "Someone from the organisation will be waiting for you at the meeting point.",
      "Une personne de l'organisation t'attend au point de rendez-vous.",
    ),
    fromAirport: L(
      "Go to the tram station (public transport is free in Luxembourg)\nTake tram T1 towards « Stadion / Lycée Bouneweg »\nGet off at Kirchberg, Philharmonie / Mudam\nWalk to the Meliá Luxembourg Hotel",
      "Rejoins la station de tram (les transports publics sont gratuits au Luxembourg)\nPrends le tram T1 direction « Stadion / Lycée Bouneweg »\nDescends à Kirchberg, Philharmonie / Mudam\nRejoins à pied l'hôtel Meliá Luxembourg",
    ),
    toAirport: L(
      "Take tram T1 towards « Findel – Luxembourg Airport »\nGet off at the terminus: Luxembourg Airport",
      "Prends le tram T1 direction « Findel – Luxembourg Airport »\nDescends au terminus : Luxembourg Airport",
    ),
    tramHours: L(
      "First tram to Findel Airport: 4:00 AM from Stadion\nFirst tram to the Gare Centrale: 4:20 AM from Findel\nLast tram at midnight\nAirport ↔ hotel: about 18 minutes by tram",
      "Premier tram vers l'aéroport du Findel : 4h00 depuis Stadion\nPremier tram vers la Gare Centrale : 4h20 depuis le Findel\nDernier tram à minuit\nAéroport ↔ hôtel : environ 18 minutes en tram",
    ),
    fromTrainStation: L(
      "Go to the tram station (public transport is free in Luxembourg)\nTake tram T1 towards « Findel – Luxembourg Airport » / « Luxexpo »\nGet off at Kirchberg, Philharmonie / Mudam\nWalk to the Meliá Luxembourg Hotel",
      "Rejoins la station de tram (les transports publics sont gratuits au Luxembourg)\nPrends le tram T1 direction « Findel – Luxembourg Airport » / « Luxexpo »\nDescends à Kirchberg, Philharmonie / Mudam\nRejoins à pied l'hôtel Meliá Luxembourg",
    ),
    toTrainStation: L(
      "Take tram T1 towards « Stadion » / « Lycée Bouneweg »\nGet off at « Gare Centrale »",
      "Prends le tram T1 direction « Stadion » / « Lycée Bouneweg »\nDescends à « Gare Centrale »",
    ),
    airportMapUrl: "",
    trainStationMapUrl: "",
  },
  // offsetDays : décalage par rapport au jour de compétition (date de
  // l'édition), pour que les intitulés de jour suivent la date du meeting.
  schedule: [
    {
      id: "day-2",
      offsetDays: -2,
      access: L("Access to the Coque by the ARENA entrance", "Accès à la Coque par l'entrée ARENA"),
      highlight: false,
      items: [
        { id: "d2-gym", icon: "gym", title: L("Hotel: gym & fitness center", "Hôtel : salle de sport & fitness"), lines: L("", "") },
        {
          id: "d2-coque",
          icon: "coque",
          title: L("Coque center (bus shuttle available)", "Coque (navette disponible)"),
          lines: L("Gym open from 4:00 PM to 7:00 PM\nTrack open from 5:30 PM to 8:00 PM", "Salle de sport ouverte de 16h00 à 19h00\nPiste accessible de 17h30 à 20h00"),
        },
        { id: "d2-dinner", icon: "dinner", title: L("Dinner at the hotel", "Dîner à l'hôtel"), lines: L("Served from 7:00 PM to 9:00 PM", "Servi de 19h00 à 21h00") },
      ],
    },
    {
      id: "day-1",
      offsetDays: -1,
      access: L("Access to the Coque by the ARENA entrance", "Accès à la Coque par l'entrée ARENA"),
      highlight: false,
      items: [
        { id: "d1-gym", icon: "gym", title: L("Hotel: gym & fitness center", "Hôtel : salle de sport & fitness"), lines: L("", "") },
        {
          id: "d1-coque",
          icon: "coque",
          title: L("Coque center (bus shuttle available)", "Coque (navette disponible)"),
          lines: L(
            "Gym open from 4:00 PM to 7:00 PM\nTrack open from 10:30 AM to 12:30 PM and from 4:00 PM to 7:00 PM",
            "Salle de sport ouverte de 16h00 à 19h00\nPiste accessible de 10h30 à 12h30 et de 16h00 à 19h00",
          ),
        },
        { id: "d1-lunch", icon: "lunch", title: L("Lunch at the hotel", "Déjeuner à l'hôtel"), lines: L("Served from 12:00 PM to 2:30 PM", "Servi de 12h00 à 14h30") },
        { id: "d1-dinner", icon: "dinner", title: L("Dinner at the hotel", "Dîner à l'hôtel"), lines: L("Served from 7:00 PM to 10:00 PM", "Servi de 19h00 à 22h00") },
      ],
    },
    {
      id: "day-0",
      offsetDays: 0,
      access: L(
        "Competition day: access to the Coque by the ATHLETE entrance. Bus shuttle.",
        "Jour de compétition : accès à la Coque par l'entrée ATHLÈTES. Navette en bus.",
      ),
      highlight: true,
      items: [
        { id: "d0-gym", icon: "gym", title: L("Hotel: gym & fitness center", "Hôtel : salle de sport & fitness"), lines: L("", "") },
        { id: "d0-lunch", icon: "lunch", title: L("Lunch at the hotel", "Déjeuner à l'hôtel"), lines: L("Served from 12:00 PM to 2:00 PM", "Servi de 12h00 à 14h00") },
        { id: "d0-dinner", icon: "dinner", title: L("Dinner at the hotel", "Dîner à l'hôtel"), lines: L("Served from 7:30 PM to 10:00 PM", "Servi de 19h30 à 22h00") },
        {
          id: "d0-shuttle",
          icon: "shuttle",
          title: L("Shuttle to the Coque", "Navette vers la Coque"),
          lines: L("In front of the hotel and at the Coque at all times", "Devant l'hôtel et à la Coque en continu"),
        },
      ],
    },
  ],
  competitionInfo: [
    { id: "ci-60", event: L("60m W + 60mH M/W", "60m F + 60m haies H/F"), rule: L("2 heats, 3Q + 2q", "2 séries, 3Q + 2q") },
    {
      id: "ci-200-400",
      event: L("200m W + 400m M", "200m F + 400m H"),
      rule: L("2 timed races, with ONE combined result for both races", "2 courses au temps, avec UN classement commun aux deux courses"),
    },
    { id: "ci-lj", event: L("Long jump", "Saut en longueur"), rule: L("Order changes after rounds 3 and 5", "Changement d'ordre après les essais 3 et 5") },
    {
      id: "ci-pv",
      event: L("Pole vault", "Saut à la perche"),
      rule: L("Progression: 4.10m, 4.25m, 4.35m, 4.40m, then +5cm. Jump-off for the victory", "Progression : 4,10m, 4,25m, 4,35m, 4,40m, puis +5cm. Barrage pour la victoire"),
    },
  ],
  venue: {
    intro: L(
      "By tram: take the tram towards « Findel »\nMeeting point at the hotel front desk to go to training",
      "En tram : prends le tram direction « Findel »\nRendez-vous à la réception de l'hôtel pour aller à l'entraînement",
    ),
    zones: L(
      "Infield\nWarm-up\nCoaching zone\nJudges room\nMixed zone\nVIP zone",
      "Infield\nÉchauffement\nZone coachs\nSalle des juges\nZone mixte\nZone VIP",
    ),
    planImageUrl: "",
  },
  photos: {
    text: L(
      "You can use the pictures freely, provided you always credit the meeting by tagging and mentioning it. Instagram: @cmcm_lux_indoor_meet",
      "Tu peux utiliser les photos librement, à condition de toujours créditer le meeting en le taguant et en le mentionnant. Instagram : @cmcm_lux_indoor_meet",
    ),
    url: "",
  },
  links: {
    emagazineUrl: "",
    liveResultsUrl: "",
  },
  emergency: {
    label: L("Emergency contact", "Contact d'urgence"),
    name: "",
    phone: "",
  },
  callTimes: [],
  callTimesFileName: "",
};

function cloneDefaultRoadbook() {
  return JSON.parse(JSON.stringify(DEFAULT_ROADBOOK));
}

function normalizeLocalized(value, fallback = L("", "")) {
  if (typeof value === "string") return { en: value, fr: value };
  return {
    en: typeof value?.en === "string" ? value.en : fallback.en,
    fr: typeof value?.fr === "string" ? value.fr : fallback.fr,
  };
}

// Fusionne un roadbook stocké avec la structure par défaut, pour que les
// champs ajoutés plus tard existent toujours côté éditeur et page publique.
function normalizeRoadbook(stored) {
  const base = cloneDefaultRoadbook();
  if (!stored || typeof stored !== "object") return base;

  const arrival = stored.arrival || {};
  return {
    ...base,
    status: stored.status === "published" ? "published" : "draft",
    intro: normalizeLocalized(stored.intro, base.intro),
    hotel: typeof stored.hotel === "string" ? stored.hotel : base.hotel,
    arrival: {
      meetingPoint: normalizeLocalized(arrival.meetingPoint, base.arrival.meetingPoint),
      fromAirport: normalizeLocalized(arrival.fromAirport, base.arrival.fromAirport),
      toAirport: normalizeLocalized(arrival.toAirport, base.arrival.toAirport),
      tramHours: normalizeLocalized(arrival.tramHours, base.arrival.tramHours),
      fromTrainStation: normalizeLocalized(arrival.fromTrainStation, base.arrival.fromTrainStation),
      toTrainStation: normalizeLocalized(arrival.toTrainStation, base.arrival.toTrainStation),
      airportMapUrl: String(arrival.airportMapUrl || ""),
      trainStationMapUrl: String(arrival.trainStationMapUrl || ""),
    },
    schedule: Array.isArray(stored.schedule)
      ? stored.schedule.map((day, dayIndex) => ({
          id: String(day.id || `day-${dayIndex}`),
          offsetDays: Number.isFinite(Number(day.offsetDays)) ? Number(day.offsetDays) : 0,
          access: normalizeLocalized(day.access),
          highlight: Boolean(day.highlight),
          items: (Array.isArray(day.items) ? day.items : []).map((item, itemIndex) => ({
            id: String(item.id || `${day.id || dayIndex}-${itemIndex}`),
            icon: String(item.icon || "info"),
            title: normalizeLocalized(item.title),
            lines: normalizeLocalized(item.lines),
          })),
        }))
      : base.schedule,
    competitionInfo: Array.isArray(stored.competitionInfo)
      ? stored.competitionInfo.map((entry, index) => ({
          id: String(entry.id || `ci-${index}`),
          event: normalizeLocalized(entry.event),
          rule: normalizeLocalized(entry.rule),
        }))
      : base.competitionInfo,
    venue: {
      intro: normalizeLocalized(stored.venue?.intro, base.venue.intro),
      zones: normalizeLocalized(stored.venue?.zones, base.venue.zones),
      planImageUrl: String(stored.venue?.planImageUrl || ""),
    },
    photos: {
      text: normalizeLocalized(stored.photos?.text, base.photos.text),
      url: String(stored.photos?.url || ""),
    },
    links: {
      emagazineUrl: String(stored.links?.emagazineUrl || ""),
      liveResultsUrl: String(stored.links?.liveResultsUrl || ""),
    },
    emergency: {
      label: normalizeLocalized(stored.emergency?.label, base.emergency.label),
      name: String(stored.emergency?.name || ""),
      phone: String(stored.emergency?.phone || ""),
    },
    callTimes: Array.isArray(stored.callTimes) ? stored.callTimes.map(normalizeCallTimeRow) : [],
    callTimesFileName: String(stored.callTimesFileName || ""),
  };
}

function pickText(value, language) {
  const localized = normalizeLocalized(value);
  return (language === "fr" ? localized.fr || localized.en : localized.en || localized.fr).trim();
}

function splitLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// « Friday, January 15 » / « vendredi 15 janvier » à partir de la date de
// l'édition (jour de compétition) et du décalage du jour.
function formatScheduleDay(editionDate, offsetDays, language) {
  const competitionDate = toDate(editionDate);
  if (!competitionDate) {
    const relative = {
      en: offsetDays === 0 ? "Competition day" : `Competition day ${offsetDays > 0 ? "+" : "−"}${Math.abs(offsetDays)}`,
      fr: offsetDays === 0 ? "Jour de compétition" : `Jour de compétition ${offsetDays > 0 ? "+" : "−"}${Math.abs(offsetDays)}`,
    };
    return relative[language] || relative.en;
  }

  const day = new Date(competitionDate);
  day.setDate(day.getDate() + offsetDays);
  return day.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Les heures Excel arrivent soit en texte (« 15:43 », « 16:01 - 16:04 »),
// soit en fraction de jour (0.655…) quand la cellule est au format heure.
function formatCallTimeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeCallTimeRow(row = {}) {
  return CALL_TIME_COLUMNS.reduce(
    (accumulator, column) => ({ ...accumulator, [column.key]: formatCallTimeCell(row[column.key]) }),
    { id: String(row.id || "") },
  );
}

// rows : tableau de lignes (première ligne contenant « Event » = en-têtes).
// Les lignes au-dessus des en-têtes (titre, logo…) sont ignorées.
function parseCallTimeRows(rows = []) {
  const headerIndex = rows.findIndex((row) =>
    (row || []).some((cell) => CALL_TIME_COLUMNS[0].aliases.includes(normalizeHeader(cell))),
  );
  if (headerIndex < 0) return { rows: [], error: "missing_event_column" };

  const columns = {};
  rows[headerIndex].forEach((cell, index) => {
    const header = normalizeHeader(cell);
    const column = CALL_TIME_COLUMNS.find(
      (candidate) => columns[candidate.key] === undefined && candidate.aliases.includes(header),
    );
    if (column) columns[column.key] = index;
  });

  const missingColumns = CALL_TIME_COLUMNS.filter((column) => columns[column.key] === undefined).map((column) => column.label.en);

  const parsedRows = rows
    .slice(headerIndex + 1)
    .map((row, index) => {
      const entry = { id: `ct-${index + 1}` };
      CALL_TIME_COLUMNS.forEach((column) => {
        entry[column.key] = columns[column.key] === undefined ? "" : formatCallTimeCell(row?.[columns[column.key]]);
      });
      return entry;
    })
    .filter((entry) => entry.event);

  return { rows: parsedRows, missingColumns };
}

export {
  CALL_TIME_COLUMNS,
  DEFAULT_ROADBOOK,
  ROADBOOK_COLLECTION,
  ROADBOOK_LANGUAGES,
  SCHEDULE_ITEM_ICONS,
  cloneDefaultRoadbook,
  formatCallTimeCell,
  formatScheduleDay,
  getScheduleIconEmoji,
  normalizeRoadbook,
  parseCallTimeRows,
  pickText,
  splitLines,
};
