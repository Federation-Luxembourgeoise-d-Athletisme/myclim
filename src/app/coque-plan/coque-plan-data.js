// Plans de la Coque : un seul jeu de repères pour les 4 plans (site, bénévoles, verso des badges,
// points de contrôle). Repris de la maquette design/accreditation/plan-coque.js.
// Fond de carte retracé sur le plan d'architecte (Plans Arena.pdf, page Arcades), tourné d'un quart
// de tour : buvette et amphithéâtre en haut, hall d'entrée à droite. Grille 1020 x 1620.
// Un plan = un niveau : la vue d'ensemble montre le niveau des arcades (l'entrée). Seul le verso des
// badges mélange les niveaux, et la liste des zones y dit où chacune se trouve.
import { PLAN_WALLS } from "./coque-plan-walls";

export const PLAN_W = 1020;
export const PLAN_H = 1620;
// Verso des badges : cadré sur la salle
export const PLAN_CROP = { y: 200, h: 1440 };
export const PLAN_ZONE_RED = "#c8102e";

export const PLAN_MAPS = [
  { key: "web", short: "S", label: "Site internet", who: "Public : entrée, stands, WC (niveau des arcades)" },
  { key: "vol", short: "B", label: "Bénévoles", who: "Le plan public + accueils et accès réservés" },
  { key: "acc", short: "A", label: "Accréditations", who: "Verso des badges : zones d'accès (tous niveaux)" },
  { key: "ctrl", short: "C", label: "Points de contrôle", who: "Mise en place du contrôle des badges" },
];
export const PLAN_LEVELS = { piste: "Piste (R-1)", rdc: "Arcades (entrée)", etage: "Galerie (R+1)" };
export const PLAN_PALETTE = ["#e30613", "#0a2540", "#27a9e1", "#0f8a5f", "#f07c00", "#5b2bb5", "#9157e6", "#b8912a", "#e5719a", "#6b7a86", "#4a5d6c"];

// Petites icônes (rond de 20 px) à la place des étiquettes : prennent moins de place, la légende
// dit ce que c'est. Tracés blancs sur une grille de 24. en : nom dans l'éditeur en anglais.
const FILL = `fill="#fff" stroke="none"`;
export const PLAN_ICONS = {
  vip: { label: "VIP", en: "VIP", svg: `<path d="M3.5 8.5l4.3 3.6L12 5.5l4.2 6.6 4.3-3.6-1.6 9H5.1z" ${FILL} /><path d="M5.5 20h13" />` },
  bar: { label: "Bar", en: "Bar", svg: `<path d="M5 4h14l-7 8z" /><path d="M12 12v7" /><path d="M8 20h8" />` },
  food: { label: "Restauration", en: "Food", svg: `<path d="M7 4v6a2 2 0 0 0 4 0V4" /><path d="M9 12v8" /><path d="M16.5 4c-2 2-2 6.5 0 8.5V20" />` },
  coffee: { label: "Café", en: "Coffee", svg: `<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8.5 3.5v2.5M12 3.5v2.5" />` },
  water: { label: "Eau", en: "Water", svg: `<path d="M12 3.5c3.2 4 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.8 2.3-6 5.5-10z" />` },
  ticket: { label: "Vente (cartes)", en: "Sales (cards)", svg: `<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" /><path d="M15 7v10" stroke-dasharray="2 2" />` },
  shop: { label: "Boutique", en: "Shop", svg: `<path d="M5 8.5h14l-1.2 11.5H6.2z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />` },
  signature: { label: "Signing zone", en: "Signing zone", svg: `<path d="M3 16c2.5-1 3.5-8 5.5-8s-1 8 1 8 2-3.5 3-3.5 1 2.5 2 2.5 2-1 3-2" /><path d="M3 20h18" />` },
  camera: { label: "Photobooth", en: "Photobooth", svg: `<path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.2" />` },
  press: { label: "Presse", en: "Press", svg: `<rect x="9" y="3.5" width="6" height="10" rx="3" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v3.5M8.5 20.5h7" />` },
  medal: { label: "Podium", en: "Medals", svg: `<path d="M8 3.5l2.5 6M16 3.5l-2.5 6" /><circle cx="12" cy="15" r="5" /><path d="M12 13v4" />` },
  info: { label: "Info", en: "Info", svg: `<circle cx="12" cy="6.5" r="1.3" ${FILL} /><path d="M12 10.5v8" stroke-width="2.8" />` },
  firstAid: { label: "Secours", en: "First aid", svg: `<path d="M12 5.5v13M5.5 12h13" stroke-width="4" stroke-linecap="butt" />` },
  wc: { label: "WC", en: "WC", svg: `<text x="12" y="16.3" text-anchor="middle" font-family="Arial, sans-serif" font-size="11.5" font-weight="800" ${FILL}>WC</text>` },
  baby: { label: "Change bébé", en: "Baby change", svg: `<circle cx="12" cy="6" r="2.6" /><path d="M7 12.5l5-2.5 5 2.5M12 10v5l-3 5M12 15l3 5" />` },
  accessible: { label: "Accès PMR", en: "Accessible", svg: `<circle cx="11" cy="4.5" r="1.6" ${FILL} /><path d="M11 8v6h5l2.5 5" /><path d="M8 11.5a5 5 0 1 0 6.5 6.5" />` },
  elevator: { label: "Ascenseur", en: "Lift", svg: `<rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 10l3-3 3 3M9 14l3 3 3-3" />` },
  stairs: { label: "Escalier", en: "Stairs", svg: `<path d="M4 19h4.5v-4h4v-4h4V7H20" />` },
  exit: { label: "Sortie", en: "Exit", svg: `<path d="M10 4H5v16h5" /><path d="M13 8l4 4-4 4M17 12H9" />` },
  cloakroom: { label: "Vestiaire", en: "Cloakroom", svg: `<path d="M12 8.5a2 2 0 1 1 2-2" /><path d="M12 8.5v1.5L3.5 16.5h17L12 10" />` },
  parking: { label: "Parking", en: "Parking", svg: `<text x="12" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="800" ${FILL}>P</text>` },
  table: { label: "Table", en: "Table", svg: `<rect x="3.5" y="7" width="17" height="4" rx="1" ${FILL} /><path d="M6 11v8M18 11v8" />` },
  chair: { label: "Chaise", en: "Chair", svg: `<path d="M8 3.5v9h8" /><path d="M8 12.5v8M16 12.5v8" /><path d="M8 7.5h0" />` },
  bench: { label: "Banc", en: "Bench", svg: `<rect x="3" y="10" width="18" height="3.5" rx="1" ${FILL} /><path d="M6 13.5v5M18 13.5v5" />` },
  barrier: { label: "Barrière", en: "Barrier", svg: `<path d="M3.5 9h17M3.5 14h17" /><path d="M6 6v13M18 6v13M12 9v5" />` },
  star: { label: "Étoile", en: "Star", svg: `<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" ${FILL} />` },
};
export const planIconSvg = (name) =>
  PLAN_ICONS[name]
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PLAN_ICONS[name].svg}</svg>`
    : "";

// Icônes ajoutées depuis l'éditeur (fichier SVG/PNG, ramené en PNG de 96 px) : enregistrées dans le
// document du plan, référencées par les repères en « custom:<id> ». mono = silhouette blanche sur
// la couleur du repère (comme les icônes de base) ; sinon l'image garde ses couleurs sur un rond blanc.
export const CUSTOM_ICON_PREFIX = "custom:";
export const isCustomIcon = (icon) => typeof icon === "string" && icon.startsWith(CUSTOM_ICON_PREFIX);
const DATA_IMAGE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/;

export function normalizePlanIcons(list) {
  return (Array.isArray(list) ? list : [])
    .map((raw) => ({
      id: String(raw?.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40),
      label: String(raw?.label ?? "").slice(0, 40),
      labelEn: String(raw?.labelEn ?? "").slice(0, 40),
      src: DATA_IMAGE.test(String(raw?.src || "")) ? raw.src : "",
      srcMono: DATA_IMAGE.test(String(raw?.srcMono || "")) ? raw.srcMono : "",
      mono: raw?.mono !== false,
    }))
    .filter((icon) => icon.id && icon.src);
}

// Repères prêts à dessiner : l'image de l'icône perso est jointe (iconImg), retirée à l'enregistrement.
export function attachPlanIcons(elements, icons) {
  const byKey = new Map(icons.map((icon) => [`${CUSTOM_ICON_PREFIX}${icon.id}`, icon]));
  return elements.map((el) => {
    if (!isCustomIcon(el.icon)) return el;
    const icon = byKey.get(el.icon);
    if (!icon) return el;
    const mono = icon.mono && Boolean(icon.srcMono);
    return { ...el, iconImg: { src: mono ? icon.srcMono : icon.src, mono } };
  });
}

// L'élément a-t-il une icône dessinable (de base ou perso) ?
export const planHasIcon = (el) => Boolean(PLAN_ICONS[el.icon] || el.iconImg?.src);
export const planIconHtml = (el) =>
  PLAN_ICONS[el.icon] ? planIconSvg(el.icon) : el.iconImg?.src ? `<img src="${el.iconImg.src}" alt="" />` : "";
// Rond de l'icône : couleur du repère, ou blanc pour une image gardée en couleurs.
export const planPictoBg = (el, color) => (el.iconImg && !el.iconImg.mono ? "#fff" : color);

// Rotation d'une étiquette de texte (degrés, -180 à 180) ; les icônes et le reste restent droits.
// Icône + texte : l'icône dans l'étiquette (showText sur un repère qui a une icône).
export const planShowsText = (el) => el.kind === "mark" && (!planHasIcon(el) || Boolean(el.showText));
export const planRotation = (el) => (planShowsText(el) ? el.rot || 0 : 0);
// Icône à gauche dans l'étiquette (HTML) : blanche sur la couleur, ou image en couleurs sur un rond blanc.
export const planPillIconHtml = (el) =>
  `<span class="cp-pill__ico${el.iconImg && !el.iconImg.mono ? " is-img" : ""}">${planIconHtml(el)}</span>`;
export const planElTransform = (el) => {
  const rot = planRotation(el);
  return rot ? `translate(-50%, -50%) rotate(${rot}deg)` : undefined;
};

const on = (...keys) => Object.fromEntries(PLAN_MAPS.map((m) => [m.key, keys.includes(m.key)]));
const at = (X, Y) => ({ x: Math.round((X / PLAN_W) * 10000) / 100, y: Math.round((Y / PLAN_H) * 10000) / 100 });
const pts = (list) => list.map(([x, y]) => ({ x, y }));

// Repères de départ (positions en % du plan). kind : zone (numéro du badge), mark (étiquette ou
// icône), area (zone de stand, rectangle w x h ou forme dessinée), door (flèche d'entrée), ctrl.
export const PLAN_DEFAULT_ELEMENTS = [
  { id: "z1", kind: "zone", num: 1, label: "Infield", level: "piste", ...at(420, 826), maps: on("acc", "ctrl") },
  { id: "z2", kind: "zone", num: 2, label: "Warm-up", level: "rdc", ...at(262, 1305), maps: on("acc", "ctrl") },
  { id: "z3a", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(224, 826), maps: on("acc", "ctrl") },
  { id: "z3b", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(612, 705), maps: on("acc", "ctrl") },
  { id: "z3c", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(612, 950), maps: on("acc", "ctrl") },
  { id: "z4", kind: "zone", labelEn: "Judges Room", descEn: "In the VIP lounge", num: 4, label: "Judges Room", desc: "Dans le salon VIP", level: "rdc", ...at(735, 828), maps: on("acc", "ctrl") },
  { id: "z5", kind: "zone", labelEn: "Mixed Zone", descEn: "At the track entrance", num: 5, label: "Mixed Zone", desc: "À l'entrée de la piste", level: "piste", ...at(420, 400), maps: on("acc", "ctrl") },
  { id: "z6", kind: "zone", num: 6, label: "VIP Zone", level: "etage", ...at(690, 470), maps: on("acc", "ctrl") },

  { id: "m1", kind: "mark", labelEn: "Entrance · Info", descEn: "Main entrance and info point: ask here for first aid or lost property", label: "Entrée · Info", desc: "Entrée principale et point info : le contact en cas de besoin (secours, objets trouvés)", color: "#0f8a5f", level: "rdc", ...at(935, 790), maps: on("web", "vol", "acc") },
  { id: "m9", kind: "mark", labelEn: "Tickets", descEn: "Ticket office and ticket check", label: "Billetterie", desc: "Caisse et contrôle des billets (un seul point)", color: "#0f8a5f", level: "rdc", ...at(860, 690), maps: on("web", "vol") },
  { id: "m7", kind: "mark", label: "VIP", desc: "Accueil VIP et retrait des badges VIP", color: "#b8912a", level: "rdc", ...at(800, 862), maps: on("vol") },
  { id: "m8", kind: "mark", labelEn: "Staff", descEn: "Volunteers, judges and press welcome", label: "Staff", desc: "Accueil bénévoles, juges et presse, retrait des badges", color: "#27a9e1", level: "rdc", ...at(928, 850), maps: on("vol", "acc") },

  { id: "m3", kind: "mark", labelEn: "Drink cards", descEn: "Drink cards on sale at the bar", icon: "ticket", label: "Drink cards", desc: "Vente des drink cards, à la buvette", color: "#e5719a", level: "rdc", ...at(420, 335), maps: on("web", "vol") },
  { id: "m2", kind: "mark", labelEn: "Bar & food", descEn: "Bar and food along the gym wall", icon: "bar", label: "Bar & food", desc: "Bar et restauration, le long du mur du gymnase", color: "#e5719a", level: "rdc", ...at(700, 445), maps: on("web", "vol") },
  {
    id: "m5", kind: "area", labelEn: "Discovery corner", descEn: "Athletics Discovery Corner: workshops for kids, between the bar and the amphitheatre", label: "Discovery corner", color: "#e30613", level: "rdc", ...at(530, 180), bg: "piste",
    desc: "Athletics Discovery Corner : ateliers pour les enfants, dans le couloir entre la buvette et l'amphithéâtre",
    shape: pts([[-100, -67], [56, -136], [60, -120], [23, -92], [15, -40], [30, 15], [70, 46], [95, 42], [128, 103], [31, 116], [-45, 47], [-74, 10]]),
    pictos: [{ t: "runner", dx: -28, dy: -66, sc: 1.7 }, { t: "hurdle", dx: 40, dy: 75, sc: 1.4 }, { t: "star", dx: 30, dy: -108, sc: 1 }, { t: "star", dx: -40, dy: -30, sc: 0.8 }, { t: "star", dx: 85, dy: 60, sc: 0.9 }],
    maps: on("web", "vol"),
  },
  { id: "m16", kind: "mark", labelEn: "Photobooth", descEn: "Photobooth", icon: "camera", label: "Photobooth", desc: "Photobooth (à placer sur le plan)", color: "#9157e6", level: "rdc", ...at(900, 1150), maps: on("web", "vol") },
  { id: "m17", kind: "mark", labelEn: "Asport", descEn: "Asport stand: sports clothing", label: "Asport", desc: "Stand Asport : vêtements (à placer sur le plan)", color: "#0d8fd3", level: "rdc", ...at(900, 1215), maps: on("web", "vol") },
  { id: "m4", kind: "mark", labelEn: "Autographs", descEn: "Signing zone: meet the athletes", icon: "signature", label: "Autographes", desc: "Signing zone : rencontre avec les athlètes", color: "#6b7a86", level: "rdc", ...at(240, 420), maps: on("web", "vol") },

  { id: "wf1", kind: "mark", labelEn: "WC ♀", descEn: "Toilets (women)", label: "WC ♀", desc: "Toilettes femmes", color: "#3a7ca5", level: "rdc", ...at(326, 252), maps: on("web", "vol") },
  { id: "wf2", kind: "mark", labelEn: "WC ♀", descEn: "Toilets (women)", label: "WC ♀", desc: "Toilettes femmes", color: "#3a7ca5", level: "rdc", ...at(496, 262), maps: on("web", "vol") },
  { id: "wh1", kind: "mark", labelEn: "WC ♂", descEn: "Toilets (men)", label: "WC ♂", desc: "Toilettes hommes", color: "#3a7ca5", level: "rdc", ...at(484, 208), maps: on("web", "vol") },
  { id: "wm1", kind: "mark", labelEn: "WC ♀♂", descEn: "Toilets", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 652), maps: on("web", "vol") },
  { id: "wm2", kind: "mark", labelEn: "WC ♀♂", descEn: "Toilets", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 738), maps: on("web", "vol") },
  { id: "wm3", kind: "mark", labelEn: "WC ♀♂", descEn: "Toilets", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 921), maps: on("web", "vol") },
  { id: "wf3", kind: "mark", labelEn: "WC ♀", descEn: "Warm-up toilets (women)", label: "WC ♀", desc: "Toilettes femmes du warm-up (athlètes)", color: "#3a7ca5", level: "rdc", ...at(320, 1420), maps: on("vol", "acc") },
  { id: "wh2", kind: "mark", labelEn: "WC ♂", descEn: "Warm-up toilets (men)", label: "WC ♂", desc: "Toilettes hommes du warm-up (athlètes)", color: "#3a7ca5", level: "rdc", ...at(532, 1340), maps: on("vol", "acc") },

  { id: "m11", kind: "mark", labelEn: "VIP", descEn: "VIP access to the gallery", icon: "vip", label: "VIP", desc: "Accès VIP à la galerie : l'entrée à gauche de l'escalier", color: "#b8912a", level: "rdc", ...at(700, 605), maps: on("vol", "acc") },
  { id: "m13", kind: "mark", labelEn: "↑ Volunteers", descEn: "Spiral staircase to the volunteers area", label: "↑ Bénévoles", desc: "Escalier en colimaçon vers l'espace bénévoles (galerie)", color: "#4a5d6c", level: "rdc", ...at(436, 138), maps: on("vol", "acc") },
  { id: "d1", kind: "door", label: "Amphi", desc: "Entrée de l'amphithéâtre (salle aussi utilisée par les bénévoles)", color: "#4a5d6c", angle: 0, level: "rdc", ...at(550, 166), maps: on("vol") },
  { id: "m14", kind: "mark", labelEn: "Call room", descEn: "Call room: in the warm-up, behind the stands, before going down to the track", label: "Call room", desc: "Call room : dans le warm-up, derrière les gradins, avant la descente vers la piste", color: "#f07c00", level: "rdc", ...at(112, 800), maps: on("vol", "acc", "ctrl") },

  { id: "m6", kind: "mark", labelEn: "First aid", descEn: "First aid, at track level (R-1)", label: "Secours", desc: "Premiers secours, au niveau de la piste (R-1)", color: "#e30613", level: "piste", ...at(300, 470), maps: on("acc") },
  { id: "m12", kind: "mark", label: "Bénévoles", desc: "Espace bénévoles (nouveau en 2027), galerie R+1", color: "#27a9e1", level: "etage", ...at(418, 125), maps: on() },

  { id: "c1", kind: "ctrl", label: "A", desc: "", color: "#0a2540", level: "rdc", ...at(760, 870), maps: on("ctrl") },
  { id: "c2", kind: "ctrl", label: "B", desc: "", color: "#0a2540", level: "rdc", ...at(640, 700), maps: on("ctrl") },
  { id: "c3", kind: "ctrl", label: "C", desc: "", color: "#0a2540", level: "rdc", ...at(640, 950), maps: on("ctrl") },
  { id: "c4", kind: "ctrl", label: "D", desc: "", color: "#0a2540", level: "rdc", ...at(640, 560), maps: on("ctrl") },
  { id: "c5", kind: "ctrl", label: "E", desc: "", color: "#0a2540", level: "rdc", ...at(560, 1160), maps: on("ctrl") },
  { id: "c6", kind: "ctrl", label: "F", desc: "", color: "#0a2540", level: "rdc", ...at(150, 860), maps: on("ctrl") },
];

const KINDS = ["zone", "mark", "area", "door", "ctrl", "facility", "line"];

// Aires de la piste (dessinées dans l'infield, à afficher ou non sur chaque plan, comme un repère).
// Positions fixes, en unités du plan. Le plan détaillé de l'infield (juges) viendra plus tard.
const TRACK_BLUE = "#6f9fd4";
const SAND = "#e8d39e";
const MAT = "#34558b";
export const PLAN_FACILITIES = {
  sprint: { label: "Piste du 60 m", en: "60 m track" },
  long: { label: "Longueur / triple", en: "Long / triple jump" },
  pole: { label: "Perche", en: "Pole vault" },
  shot: { label: "Poids", en: "Shot put" },
  high: { label: "Hauteur", en: "High jump" },
};
const FACILITY_SVG = {
  // 8 couloirs de 1,22 m, départ en bas, arrivée 60 m plus haut
  sprint: () => {
    const x0 = 384;
    const lanes = Array.from({ length: 9 }, (_, i) => `<line x1="${x0 + i * 9}" y1="560" x2="${x0 + i * 9}" y2="1125" />`).join("");
    return `<rect x="${x0}" y="560" width="72" height="565" fill="${TRACK_BLUE}" /><g stroke="#fff" stroke-width="1.1">${lanes}</g>
      <line x1="${x0}" y1="1105" x2="${x0 + 72}" y2="1105" stroke="#fff" stroke-width="2.5" /><line x1="${x0}" y1="601" x2="${x0 + 72}" y2="601" stroke="#fff" stroke-width="3.5" />`;
  },
  long: () => `<rect x="478" y="610" width="10" height="378" fill="${TRACK_BLUE}" /><rect x="478" y="984" width="10" height="4" fill="#fff" />
    <rect x="471" y="1000" width="24" height="76" rx="2" fill="${SAND}" stroke="#c4a86a" stroke-width="1.5" />`,
  pole: () => `<rect x="512" y="640" width="10" height="362" fill="${TRACK_BLUE}" /><path d="M513 1002h8l-4 7z" fill="#4a5d6c" />
    <rect x="497" y="1010" width="40" height="40" rx="3" fill="${MAT}" />`,
  shot: () => {
    const cx = 336;
    const cy = 650;
    const a = (17.46 * Math.PI) / 180;
    const L = 150;
    const ex = L * Math.sin(a);
    const ey = cy + L * Math.cos(a);
    return `<path d="M${cx} ${cy} L${cx - ex} ${ey} M${cx} ${cy} L${cx + ex} ${ey}" stroke="#5f7f9f" stroke-width="1.6" fill="none" />
      <path d="M${cx - ex} ${ey} Q${cx} ${ey + 14} ${cx + ex} ${ey}" stroke="#5f7f9f" stroke-width="1" stroke-dasharray="4 4" fill="none" />
      <circle cx="${cx}" cy="${cy}" r="9" fill="#c9d3db" stroke="#4a5d6c" stroke-width="1.6" /><path d="M${cx - 6} ${cy + 10}h12" stroke="#fff" stroke-width="2.5" />`;
  },
  high: () => `<path d="M296 1000 L296 920 A40 40 0 0 1 376 920 L376 1000 Z" fill="${TRACK_BLUE}" fill-opacity=".55" />
    <rect x="316" y="956" width="40" height="24" rx="2" fill="${MAT}" /><path d="M312 953h48" stroke="#fff" stroke-width="2" /><circle cx="312" cy="953" r="2.2" fill="#4a5d6c" /><circle cx="360" cy="953" r="2.2" fill="#4a5d6c" />`,
};
// Aires absentes d'un plan enregistré avant leur arrivée : ajoutées, masquées partout.
const DEFAULT_FACILITIES = Object.keys(PLAN_FACILITIES).map((key) => ({ id: `fac-${key}`, kind: "facility", facility: key, label: PLAN_FACILITIES[key].label, labelEn: PLAN_FACILITIES[key].en, maps: {} }));

// Lignes (barrière, séparation) : centre x/y en % du plan, demi-vecteur dx/dy en unités du plan.
export const PLAN_LINE_STYLES = {
  barrier: { label: "Barrière", en: "Barrier" },
  separation: { label: "Séparation (pointillés)", en: "Separation (dashed)" },
  rope: { label: "Corde / ruban", en: "Rope / tape" },
};
const lineSvg = (el, X, Y) => {
  const x1 = X - el.dx;
  const y1 = Y - el.dy;
  const x2 = X + el.dx;
  const y2 = Y + el.dy;
  const seg = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
  if (el.style === "separation") return `<line ${seg} stroke="${el.color}" stroke-width="3.5" stroke-dasharray="10 7" stroke-linecap="round" />`;
  if (el.style === "rope") return `<line ${seg} stroke="${el.color}" stroke-width="2.2" stroke-linecap="round" /><circle cx="${x1}" cy="${y1}" r="4" fill="${el.color}" /><circle cx="${x2}" cy="${y2}" r="4" fill="${el.color}" />`;
  return `<line ${seg} stroke="${el.color}" stroke-width="7" stroke-linecap="butt" /><line ${seg} stroke="#fff" stroke-width="2.4" stroke-dasharray="7 7" />`;
};
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// Lecture prudente d'un repère enregistré (Firestore) : valeurs par défaut, cases des 4 plans.
export function normalizePlanElement(raw = {}, index = 0) {
  const kind = KINDS.includes(raw.kind) ? raw.kind : "mark";
  const maps = Object.fromEntries(PLAN_MAPS.map((m) => [m.key, Boolean(raw.maps?.[m.key])]));
  const element = {
    id: String(raw.id || `el-${index + 1}`),
    kind,
    label: String(raw.label ?? "").slice(0, 40),
    desc: String(raw.desc ?? ""),
    // Textes du site et des documents en anglais (badges, roadbook) : à défaut, le texte français
    labelEn: String(raw.labelEn ?? "").slice(0, 40),
    descEn: String(raw.descEn ?? ""),
    color: String(raw.color || (kind === "zone" ? PLAN_ZONE_RED : PLAN_PALETTE[1])),
    level: PLAN_LEVELS[raw.level] ? raw.level : "rdc",
    x: Math.min(100, Math.max(0, num(raw.x, 50))),
    y: Math.min(100, Math.max(0, num(raw.y, 50))),
    maps,
  };
  if (kind === "zone") element.num = Math.max(1, Math.round(num(raw.num, 1)));
  if (kind === "mark") {
    element.icon = PLAN_ICONS[raw.icon] || (isCustomIcon(raw.icon) && raw.icon.length < 60) ? raw.icon : "";
    // Rotation de l'étiquette en degrés (repères existants : 0)
    const rot = Math.round(num(raw.rot, 0));
    element.rot = ((((rot + 180) % 360) + 360) % 360) - 180;
    // Icône + texte (repères existants : icône seule)
    element.showText = Boolean(raw.showText) && Boolean(element.icon);
  }
  if (kind === "door") element.angle = num(raw.angle, 0);
  if (kind === "facility") element.facility = PLAN_FACILITIES[raw.facility] ? raw.facility : "sprint";
  if (kind === "line") {
    element.dx = Math.max(-600, Math.min(600, num(raw.dx, 60)));
    element.dy = Math.max(-900, Math.min(900, num(raw.dy, 0)));
    element.style = PLAN_LINE_STYLES[raw.style] ? raw.style : "barrier";
  }
  // Point de contrôle : numéros des zones du badge qu'il garde (Accréditations › Contrôles)
  if (kind === "ctrl") {
    element.badgeTypes = [...new Set((Array.isArray(raw.badgeTypes) ? raw.badgeTypes : []).map(String).filter((t) => CTRL_BADGE_NAMES[t]))];
    element.zoneNums = [...new Set((Array.isArray(raw.zoneNums) ? raw.zoneNums : []).map((n) => Math.round(num(n))).filter((n) => n >= 1 && n <= 20))].sort((a, b) => a - b);
  }
  if (kind === "area") {
    if (Array.isArray(raw.shape) && raw.shape.length >= 3) {
      element.shape = raw.shape.map((p) => ({ x: num(p?.x), y: num(p?.y) }));
      element.bg = raw.bg === "piste" ? "piste" : "";
      element.pictos = Array.isArray(raw.pictos)
        ? raw.pictos.map((p) => ({ t: String(p?.t || ""), dx: num(p?.dx), dy: num(p?.dy), sc: num(p?.sc, 1) }))
        : [];
    } else {
      element.w = Math.max(20, num(raw.w, 140));
      element.h = Math.max(20, num(raw.h, 90));
    }
  }
  return element;
}

export function normalizePlanElements(list) {
  const elements = (Array.isArray(list) ? list : [])
    .map((el, index) => normalizePlanElement(el, index))
    .filter((el) => el.kind !== "facility" || PLAN_FACILITIES[el.facility]);
  // Une seule aire de chaque sorte ; celles qui manquent arrivent masquées
  const seen = new Set();
  const unique = elements.filter((el) => el.kind !== "facility" || (!seen.has(el.facility) && seen.add(el.facility)));
  const missing = DEFAULT_FACILITIES.filter((f) => !seen.has(f.facility)).map((f, i) => normalizePlanElement(f, unique.length + i));
  return [...unique, ...missing];
}

// Texte affiché selon la langue du document (le site, les badges et le roadbook sont en anglais).
export const planLabel = (el, lang = "fr") => (lang === "en" && el.labelEn ? el.labelEn : el.label);
export const planDesc = (el, lang = "fr") => (lang === "en" && el.descEn ? el.descEn : el.desc);

// Badges acceptés d'office à un point de contrôle, quel que soit le numéro : catégories des badges,
// plus le badge VIP (qui ne porte pas de numéro de zone, le badge suffit).
export const CTRL_BADGE_NAMES = {
  vip: "VIP",
  organisation: "Organisation",
  technical: "Technical",
  judge: "Judge",
  athlete: "Athlete",
  coach: "Coach",
  press: "Press",
  photographer: "Photographer",
  volunteer: "Volunteer",
};

// Texte automatique d'un point de contrôle : les zones qu'il garde (avec leur nom sur le plan)
// et les badges acceptés d'office.
export function planCtrlText(el, elements = [], lang = "fr") {
  const en = lang === "en";
  const nums = el.zoneNums || [];
  const types = (el.badgeTypes || []).map((t) => CTRL_BADGE_NAMES[t]).filter(Boolean);
  if (!nums.length && !types.length) return "";
  const names = nums.map((n) => {
    const zone = elements.find((item) => item.kind === "zone" && item.num === n);
    return zone ? `${n} ${planLabel(zone, lang)}` : String(n);
  });
  const parts = [
    names.length ? `zone ${names.join(", ")}` : "",
    types.length ? `badge ${types.join(", ")}` : "",
  ].filter(Boolean);
  return `${en ? "Badge check: " : "Contrôle des badges : "}${parts.join(en ? " or " : " ou ")}`;
}

export const planColorOf = (el) => (el.kind === "zone" ? PLAN_ZONE_RED : el.color);

const LEVEL_NOTE = { piste: " · piste (R-1)", etage: " · galerie (R+1)" };
const LEVEL_NOTE_EN = { piste: " · track level (R-1)", etage: " · gallery (R+1)" };

// Légende d'un plan : une ligne par numéro de zone, puis repères (doublons regroupés), flèches,
// contrôles. C'est là que vont les textes longs.
export function planLegendItems(elements, mapKey, lang = "fr") {
  const seen = new Set();
  const items = elements
    .filter((el) => el.maps?.[mapKey] && el.kind !== "facility" && (el.kind !== "line" || el.label || el.desc))
    .sort((a, b) => (a.kind === "zone" ? a.num : 99) - (b.kind === "zone" ? b.num : 99));
  const lines = [];
  for (const el of items) {
    const key = el.kind === "zone" ? `zone|${el.num}` : `${el.kind}|${el.label}|${el.desc}|${el.color}|${el.level}|${el.icon || ""}|${el.style || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ key, el, level: el.level, where: (lang === "en" ? LEVEL_NOTE_EN : LEVEL_NOTE)[el.level] || "" });
  }
  return lines;
}

export const planPos = (el, crop = false) =>
  crop ? { x: el.x, y: (((el.y / 100) * PLAN_H - PLAN_CROP.y) / PLAN_CROP.h) * 100 } : { x: el.x, y: el.y };

// Contours partagés avec le plan zoomé de l'entrée (entrance-plan-data.js)
export const PLAN_ARCADES_PATH = "M418 108 C300 230 120 470 62 740 L62 930 C120 1190 290 1400 418 1530 C560 1400 720 1180 772 930 L716 930 L716 640 L773 630 L892 602 C860 585 830 555 798 520 C770 490 735 440 713 403 C700 380 676 330 658 283 L625 222 C600 228 575 215 560 195 C538 160 548 80 590 60 L586 44 Z";
export const PLAN_GYM_PATH = "M625 222 L658 283 C676 330 700 380 713 403 C735 440 770 490 798 520 C830 555 860 585 892 602 L1020 602 L1020 30 L690 30 L662 60 L662 120 L640 205 Z";
export const PLAN_GYM_EDGE = "M625 222 L658 283 C676 330 700 380 713 403 C735 440 770 490 798 520 C830 555 860 585 892 602";
export const PLAN_HALL_PATH = "M716 640 L773 630 L893 600 L920 627 L924 705 L1001 739 L1001 921 L847 857 L824 898 L772 930 L716 930 Z";
export const PLAN_HALL_FACADE = "M893 600 L920 627 L924 705 L1001 739 L1001 921 L847 857 L824 898 L772 930";

let planSvgCount = 0;

// Fond de carte (niveau des arcades). crop = true cadre sur la salle (verso des badges).
// Infield et Warm-up peuvent être colorés (zones autorisées du badge).
export function planBaseSvg({ infield = "#e3edf8", warmup = "#c9d9ee", crop = false, lang = "fr" } = {}) {
  const en = lang === "en";
  const viewBox = crop ? `0 ${PLAN_CROP.y} ${PLAN_W} ${PLAN_CROP.h}` : `0 0 ${PLAN_W} ${PLAN_H}`;
  const n = ++planSvgCount;
  const hatch = `coque-hatch-${n}`;
  const clip = `coque-clip-${n}`;
  const oval = (r) => `M${420 - r} 634 A${r} ${r} 0 0 1 ${420 + r} 634 L${420 + r} 1018 A${r} ${r} 0 0 1 ${420 - r} 1018 Z`;
  const arcades = PLAN_ARCADES_PATH;
  const label = (x, y, text, size = 22, fill = "#7d8d99") =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="2" fill="${fill}">${text}</text>`;
  const gaps = [[420, 634, -137, "#f4f6f8"], [420, 634, -44, "#f4f6f8"], [420, 1018, 137, warmup], [420, 1018, 38, warmup]]
    .map(([cx, cy, a, fill]) => `<rect x="203" y="-8" width="62" height="16" fill="${fill}" transform="translate(${cx} ${cy}) rotate(${a})" />`)
    .join("");
  return `<svg class="coque-plan__base" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <clipPath id="${clip}"><path d="${arcades}" /></clipPath>
      <pattern id="${hatch}" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" stroke="#d3dae0" stroke-width="3" /></pattern>
    </defs>
    <path d="${PLAN_GYM_PATH}" fill="url(#${hatch})" />
    ${label(885, 330, en ? "GYM" : "GYMNASE", 26, "#a9b5be")}
    <path d="${PLAN_HALL_PATH}" fill="#f4f6f8" />
    <path d="${PLAN_HALL_FACADE}" fill="none" stroke="#5f6f7c" stroke-width="3" stroke-linejoin="round" />
    ${label(880, 650, en ? "ENTRANCE HALL" : "HALL D'ENTRÉE", 18, "#7d8d99")}
    <path d="M1018 810 L1004 830 L1018 850 Z" fill="#0f8a5f" />
    <path d="${arcades}" fill="#f4f6f8" />
    <path d="M0 1085 L${PLAN_W} 1085 L${PLAN_W} 1700 L0 1700 Z M0 700 L300 700 L300 1085 L0 1085 Z" fill="${warmup}" clip-path="url(#${clip})" />
    <path d="M418 108 C300 230 120 470 62 740 L62 930 C120 1190 290 1400 418 1530 C560 1400 720 1180 772 930 M625 222 C600 228 575 215 560 195 C538 160 548 80 590 60 L586 44 L418 108" fill="none" stroke="#5f6f7c" stroke-width="6" stroke-linejoin="round" />
    <path d="${PLAN_GYM_EDGE}" fill="none" stroke="#5f6f7c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M590 60 C548 80 538 160 560 195 C575 215 600 228 625 222 C645 205 660 165 662 120 C662 95 658 70 654 52 Z" fill="#e4e9ed" stroke="#4a5d6c" stroke-width="4" stroke-linejoin="round" />
    <rect x="562" y="100" width="9" height="62" rx="2" fill="#9aa8b3" />
    <path d="M592 86 Q616 131 592 186 M608 76 Q640 131 606 200 M624 68 Q660 131 620 212" fill="none" stroke="#b9c5ce" stroke-width="3" />
    ${label(600, 26, en ? "AMPHITHEATRE" : "AMPHITHÉÂTRE", 16)}
    <path d="M300 296 L561 296 L485 227 L456 190 L380 190 L351 227 Z" fill="#e4e9ed" stroke="#4a5d6c" stroke-width="3" stroke-linejoin="round" />
    <circle cx="418" cy="172" r="16" fill="#fff" stroke="#4a5d6c" stroke-width="3" />
    <path d="M300 1352 L561 1352 L485 1420 L456 1458 L380 1458 L351 1420 Z" fill="#e4e9ed" stroke="#4a5d6c" stroke-width="3" stroke-linejoin="round" />
    <path d="${oval(262)}" fill="#c9d3db" />
    <path d="${oval(246)} ${oval(230)} ${oval(214)}" fill="none" stroke="#dbe2e8" stroke-width="2" />
    <rect x="394" y="368" width="52" height="64" fill="#f4f6f8" />
    <rect x="394" y="1220" width="52" height="64" fill="${warmup}" />
    ${gaps}
    <rect x="155" y="626" width="62" height="16" fill="#f4f6f8" />
    <rect x="623" y="626" width="62" height="16" fill="#f4f6f8" />
    <rect x="155" y="1010" width="62" height="16" fill="${warmup}" />
    <rect x="623" y="1010" width="62" height="16" fill="#f4f6f8" />
    <path d="${oval(205)}" fill="#fff" />
    <path d="${oval(192)}" fill="#8db4de" />
    <path d="${[141, 151, 161, 171, 181].map(oval).join(" ")}" fill="none" stroke="#fff" stroke-width="1.1" stroke-opacity=".9" />
    <path d="${oval(192)} ${oval(131)}" fill="none" stroke="#fff" stroke-width="2.2" />
    <path d="M551 826 H612" stroke="#fff" stroke-width="3" />
    <path d="${oval(131)}" fill="${infield}" />
    <path d="${PLAN_WALLS}" fill="none" stroke="#4a5d6c" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

// Pictos des zones dessinées « piste » (Discovery corner) : enfant qui court, haie, étoiles.
const PICTOS = {
  runner: `<path d="M-34 -16 L-24 -16 M-38 -5 L-26 -5 M-33 6 L-24 6" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8" />
    <circle cx="9" cy="-21" r="9.5" fill="#fff" />
    <path d="M5 -10 L-3 6 M3 -7 L13 -1 L19 -10 M1 -6 L-9 -10 L-15 -2 M-3 6 L9 9 L7 21 M-3 6 L-11 15 L-21 14" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`,
  hurdle: `<path d="M-16 -6 L16 -6 M-13 -6 L-13 17 M13 -6 L13 17 M-17 17 L-9 17 M9 17 L17 17" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" /><path d="M-16 -1 L16 -1" stroke="#ffd34d" stroke-width="4" stroke-linecap="round" />`,
  star: `<path d="M0 -10 L3 -3 L10 0 L3 3 L0 10 L-3 3 L-10 0 L-3 -3 Z" fill="#ffd34d" />`,
};

let shapeCount = 0;

// Zones dessinées (forme libre) d'une liste de repères, en un SVG posé sur le fond.
export function planShapesSvg(list, crop = false) {
  const shapes = list.filter((el) => el.kind === "area" && el.shape);
  const facilities = list.filter((el) => el.kind === "facility");
  const lines = list.filter((el) => el.kind === "line");
  if (!shapes.length && !facilities.length && !lines.length) return "";
  const vb = crop ? `0 ${PLAN_CROP.y} ${PLAN_W} ${PLAN_CROP.h}` : `0 0 ${PLAN_W} ${PLAN_H}`;
  const facilitiesSvg = facilities.map((el) => FACILITY_SVG[el.facility]?.() || "").join("");
  const linesSvg = lines.map((el) => lineSvg(el, (el.x / 100) * PLAN_W, (el.y / 100) * PLAN_H)).join("");
  return `<svg class="coque-plan__shapes" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${facilitiesSvg}${shapes.map((el) => {
    const X = (el.x / 100) * PLAN_W;
    const Y = (el.y / 100) * PLAN_H;
    const points = el.shape.map((p) => `${X + p.x},${Y + p.y}`).join(" ");
    if (el.bg !== "piste") {
      return `<polygon points="${points}" fill="${el.color}2e" stroke="${el.color}" stroke-width="3" stroke-dasharray="10 6" stroke-linejoin="round" />`;
    }
    const id = `coque-piste-${++shapeCount}`;
    return `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="60" height="26" patternTransform="rotate(-28)"><rect width="60" height="26" fill="#2f78c4" /><line x1="0" y1="13" x2="60" y2="13" stroke="#fff" stroke-width="2.4" stroke-opacity=".85" /></pattern></defs>
      <polygon points="${points}" fill="url(#${id})" fill-opacity=".9" stroke="#1d5a9e" stroke-width="3" stroke-linejoin="round" />
      ${(el.pictos || []).map((p) => `<g transform="translate(${X + p.dx} ${Y + p.dy}) scale(${p.sc || 1})">${PICTOS[p.t] || ""}</g>`).join("")}`;
  }).join("")}${linesSvg}</svg>`;
}

// ─── Impression (fenêtre d'impression des badges : pas de React, du HTML) ─────

const escapePlanText = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Un repère en HTML, mêmes classes que PlanMarker (coque-plan-view.jsx).
export function planMarkerHtml(el, color = planColorOf(el), lang = "fr") {
  const label = escapePlanText(planLabel(el, lang));
  if (el.kind === "zone") return `<span class="cp-zone" style="background:${color}">${el.num}</span>`;
  if (el.kind === "ctrl") return `<span class="cp-ctrl" style="background:${color}">${label}</span>`;
  if (el.kind === "door") return `<span class="cp-door" style="background:${color}"><span style="display:inline-block;transform:rotate(${el.angle || 0}deg)">➜</span></span>`;
  if (el.kind === "area" && el.shape) return `<span class="cp-area-label" style="color:${color}">${label}</span>`;
  if (el.kind === "area") return `<span class="cp-area" style="background:${color}1f;border-color:${color};color:${color}">${label}</span>`;
  if (planHasIcon(el) && el.showText) return `<span class="cp-pill cp-pill--icon" style="background:${color}">${planPillIconHtml(el)}${label}</span>`;
  if (planHasIcon(el)) return `<span class="cp-picto${el.iconImg ? " cp-picto--img" : ""}" style="background:${planPictoBg(el, color)}">${planIconHtml(el)}</span>`;
  return `<span class="cp-pill" style="background:${color}">${label}</span>`;
}

// Le plan complet en HTML : fond (Infield / Warm-up teintés si autorisés), formes, repères du plan
// choisi. allowedZones : numéros de zones autorisées, allumés dans la couleur accent ; les autres en gris.
export function planBoxHtml(elements, { mapKey = "acc", crop = true, allowedZones = null, accent = PLAN_ZONE_RED, lang = "fr" } = {}) {
  const shown = elements.filter((el) => el.maps?.[mapKey]);
  const isAllowed = (n) => !allowedZones || allowedZones.has(n);
  const base = planBaseSvg({
    crop,
    lang,
    infield: allowedZones ? (isAllowed(1) ? `${accent}40` : "#eef1f4") : undefined,
    warmup: allowedZones ? (isAllowed(2) ? `${accent}40` : "#e6ebef") : undefined,
  });
  const markers = [...shown.filter((el) => el.kind === "area"), ...shown.filter((el) => el.kind !== "area" && el.kind !== "facility" && el.kind !== "line")]
    .map((el) => {
      const { x, y } = planPos(el, crop);
      if (y < 0 || y > 100) return "";
      const size = el.kind === "area" && !el.shape
        ? `width:${(el.w / PLAN_W) * 100}%;height:${(el.h / (crop ? PLAN_CROP.h : PLAN_H)) * 100}%;`
        : "";
      const color = el.kind === "zone" && allowedZones ? (isAllowed(el.num) ? accent : "#c3ccd3") : planColorOf(el);
      const turn = planElTransform(el);
      return `<div class="coque-plan__el" style="left:${x}%;top:${y}%;${size}${turn ? `transform:${turn};` : ""}">${planMarkerHtml(el, color, lang)}</div>`;
    })
    .join("");
  return `<div class="coque-plan${crop ? " coque-plan--crop" : ""}"><div class="coque-plan__layer">${base}</div><div class="coque-plan__layer">${planShapesSvg(shown, crop)}</div>${markers}</div>`;
}

// CSS du plan pour une page imprimée (tailles en mm, pour un badge de ~90 mm de large).
export const PLAN_PRINT_CSS = `
  .coque-plan { position: relative; height: 100%; max-width: 100%; aspect-ratio: ${PLAN_W} / ${PLAN_H}; margin: 0 auto; }
  .coque-plan--crop { aspect-ratio: ${PLAN_W} / ${PLAN_CROP.h}; }
  .coque-plan__layer, .coque-plan__layer > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .coque-plan__el { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; }
  .cp-zone, .cp-ctrl, .cp-door, .cp-picto { display: grid; place-items: center; color: #fff; border: .35mm solid #fff; }
  .cp-zone { width: 4.2mm; height: 4.2mm; border-radius: 50%; font: 800 7.5pt/1 "Barlow Condensed", Arial, sans-serif; }
  .cp-ctrl { width: 3.6mm; height: 3.6mm; border-radius: .8mm; font: 800 6.5pt/1 "Barlow Condensed", Arial, sans-serif; }
  .cp-door { width: 3.8mm; height: 3.8mm; border-radius: 50%; font: 900 6pt/1 Arial, sans-serif; }
  .cp-picto { width: 3.6mm; height: 3.6mm; border-radius: 50%; border-width: .25mm; }
  .cp-picto svg { width: 62%; height: 62%; display: block; }
  .cp-picto img { width: 72%; height: 72%; display: block; object-fit: contain; }
  .cp-pill--icon { display: inline-flex; align-items: center; gap: .6mm; padding-left: .6mm; }
  .cp-pill__ico { width: 2.4mm; height: 2.4mm; display: grid; place-items: center; border-radius: 50%; }
  .cp-pill__ico.is-img { background: #fff; }
  .cp-pill__ico svg, .cp-pill__ico img { width: 100%; height: 100%; display: block; object-fit: contain; }
  .cp-pill__ico.is-img img { width: 78%; height: 78%; }
  .cp-pill { display: inline-block; padding: .5mm 1.3mm; border-radius: 99px; color: #fff; font: 700 4.6pt/1 Arial, "Segoe UI Symbol", sans-serif; font-variant-emoji: text; border: .25mm solid #fff; }
  .cp-picto--img { box-shadow: 0 0 0 .2mm #c9d3db; }
  .cp-area { display: grid; place-items: center; width: 100%; height: 100%; box-sizing: border-box; border: .3mm dashed; border-radius: 1.5mm; font: 800 4.6pt/1 Arial, sans-serif; text-align: center; }
  .cp-area-label { display: inline-block; font: 800 4.6pt/1 Arial, sans-serif; background: #fff; border-radius: 99px; padding: .5mm 1.2mm; }
`;
