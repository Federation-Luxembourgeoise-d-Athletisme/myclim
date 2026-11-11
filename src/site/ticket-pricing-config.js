// Billetterie du CMCM Luxembourg Indoor Meeting : dates de vente et prix.
// Réglés dans l'admin (Site web › Page liens (QR) › Billets), enregistrés avec la page liens
// (siteContent/linksPage, champ tickets). Les valeurs ci-dessous servent de départ tant que
// rien n'est enregistré. Logique pure, testée dans tests/ticketing-utils.test.js.

export const TICKET_TYPES = [
  { key: "regular", label: "Billet" },
  { key: "vip", label: "VIP" },
  { key: "under18", label: "Moins de 18 ans" },
];
export const TICKET_PRICE_KINDS = [
  { key: "earlyBird", label: "Early-bird" },
  { key: "online", label: "En ligne" },
  { key: "onSite", label: "Sur place" },
];

export const DEFAULT_TICKET_SALE = {
  // Jour (AAAA-MM-JJ) et heure d'ouverture de la vente, à Luxembourg
  saleOpensDate: "2026-11-10",
  saleOpensTime: "10:00",
  // Dernier jour de l'early-bird (jusqu'à 23:59, à Luxembourg)
  earlyBirdEndsDate: "2026-12-18",
  prices: {
    regular: { earlyBird: 8, online: 12, onSite: 15 },
    vip: { earlyBird: 60, online: 75, onSite: 90 },
    under18: { earlyBird: 0, online: 0, onSite: 0 },
  },
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function price(value, fallback) {
  const number = Number(String(value ?? "").replace(",", "."));
  return value === "" || value === null || value === undefined || !Number.isFinite(number) || number < 0 ? fallback : number;
}

// Lecture prudente des réglages enregistrés (valeurs de départ pour ce qui manque).
export function normalizeTicketSale(source = {}) {
  const base = DEFAULT_TICKET_SALE;
  const day = (value, fallback) => (DAY_PATTERN.test(String(value || "")) ? String(value) : fallback);
  return {
    saleOpensDate: day(source.saleOpensDate, base.saleOpensDate),
    saleOpensTime: TIME_PATTERN.test(String(source.saleOpensTime || "")) ? String(source.saleOpensTime) : base.saleOpensTime,
    earlyBirdEndsDate: day(source.earlyBirdEndsDate, base.earlyBirdEndsDate),
    prices: Object.fromEntries(
      TICKET_TYPES.map(({ key }) => [
        key,
        Object.fromEntries(TICKET_PRICE_KINDS.map(({ key: kind }) => [kind, price(source.prices?.[key]?.[kind], base.prices[key][kind])])),
      ]),
    ),
  };
}

// Décalage horaire de Luxembourg à cette date (« +01:00 » en hiver, « +02:00 » en été).
function luxembourgOffset(dayKey) {
  const probe = new Date(`${dayKey}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Luxembourg", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((part) => part.type === "timeZoneName")?.value || "GMT+1";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "+01:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`;
}

function dayLabel(dayKey, options) {
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
}

// Ce qu'utilise le site : dates complètes (heure de Luxembourg), libellés en anglais et prix.
export function buildTicketPricing(sale = DEFAULT_TICKET_SALE) {
  const settings = normalizeTicketSale(sale);
  const { saleOpensDate, saleOpensTime, earlyBirdEndsDate, prices } = settings;
  const endsMonthDay = dayLabel(earlyBirdEndsDate, { day: "numeric", month: "long" });
  return {
    saleOpensAt: `${saleOpensDate}T${saleOpensTime}:00${luxembourgOffset(saleOpensDate)}`,
    saleOpensLabel: `${dayLabel(saleOpensDate, { day: "numeric", month: "long" })}, ${saleOpensTime}`,
    earlyBirdEndsAt: `${earlyBirdEndsDate}T23:59:59${luxembourgOffset(earlyBirdEndsDate)}`,
    earlyBirdEndsLabel: endsMonthDay,
    earlyBirdDeadlineLabel: dayLabel(earlyBirdEndsDate, { day: "numeric", month: "short", year: "numeric" }).replace(/^(\d+) (\w+) /, "$2 $1, "),
    ...prices,
  };
}

// Prix de départ (avant tout réglage enregistré).
export const TICKET_PRICING = buildTicketPricing();
