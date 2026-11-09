// Plan de la Coque partagé par les maquettes (éditeur de plans et badges) : un seul jeu de repères.
// Fond de carte retracé sur le plan d'architecte « CNSC d'Coque – Rénovation » (Plans Arena.pdf,
// page Arcades), tourné d'un quart de tour : buvette et amphithéâtre en haut, hall d'entrée à droite.
// Grille 1020 x 1620 = la page du PDF à 2000 px de large, tournée (X = 1020 - y, Y = x) : le calque
// architecte de l'éditeur tombe pile dessous.
// Un plan = un niveau : la vue d'ensemble montre le niveau des arcades (l'entrée). Seul le verso
// des badges mélange les niveaux, et la liste des zones y dit où chacune se trouve.
const PLAN_W = 1020;
const PLAN_H = 1620;
const PLAN_RATIO = `${PLAN_W} / ${PLAN_H}`;
// Verso des badges : cadré sur la salle
const PLAN_CROP = { y: 200, h: 1440 };
const PLAN_RATIO_CROP = `${PLAN_W} / ${PLAN_CROP.h}`;
const PLAN_ZONE_RED = "#c8102e";
const PLAN_STORE = "myclim-maquette-plans-v10";
const PLAN_STORE_PREV = "myclim-maquette-plans-v9";
const planPos = (el, crop = false) =>
  crop ? { x: el.x, y: ((el.y / 100) * PLAN_H - PLAN_CROP.y) / PLAN_CROP.h * 100 } : { x: el.x, y: el.y };

// Les 4 plans de la vue d'ensemble
const PLAN_MAPS = [
  { key: "web", short: "S", label: "Site internet", who: "Public : entrée, stands, WC (niveau des arcades)" },
  { key: "vol", short: "B", label: "Bénévoles", who: "Le plan public + accueils et accès réservés" },
  { key: "acc", short: "A", label: "Accréditations", who: "Verso des badges : zones d'accès (tous niveaux)" },
  { key: "ctrl", short: "C", label: "Points de contrôle", who: "Mise en place du contrôle des badges" },
];
const PLAN_LEVELS = { piste: "Piste (R-1)", rdc: "Arcades (entrée)", etage: "Galerie (R+1)" };

const on = (...keys) => Object.fromEntries(PLAN_MAPS.map((m) => [m.key, keys.includes(m.key)]));
const at = (X, Y) => ({ x: Math.round((X / PLAN_W) * 10000) / 100, y: Math.round((Y / PLAN_H) * 10000) / 100 });

const PLAN_DEFAULT_ELEMENTS = [
  // Zones d'accès (numéros du badge) — le niveau s'affiche dans la liste du badge
  { id: "z1", kind: "zone", num: 1, label: "Infield", level: "piste", ...at(420, 826), maps: on("acc", "ctrl") },
  { id: "z2", kind: "zone", num: 2, label: "Warm-up", level: "rdc", ...at(262, 1305), maps: on("acc", "ctrl") },
  { id: "z3a", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(224, 826), maps: on("acc", "ctrl") },
  { id: "z3b", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(612, 705), maps: on("acc", "ctrl") },
  { id: "z3c", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(612, 950), maps: on("acc", "ctrl") },
  { id: "z4", kind: "zone", num: 4, label: "Judges Room", desc: "Dans le salon VIP", level: "rdc", ...at(735, 828), maps: on("acc", "ctrl") },
  { id: "z5", kind: "zone", num: 5, label: "Mixed Zone", desc: "À l'entrée de la piste", level: "piste", ...at(420, 400), maps: on("acc", "ctrl") },
  { id: "z6", kind: "zone", num: 6, label: "VIP Zone", level: "etage", ...at(690, 470), maps: on("acc", "ctrl") },

  // Hall d'entrée : l'entrée est aussi le point info et contact (secours, objets trouvés)
  { id: "m1", kind: "mark", label: "Entrée · Info", desc: "Entrée principale et point info : le contact en cas de besoin (secours, objets trouvés)", color: "#0f8a5f", level: "rdc", ...at(935, 790), maps: on("web", "vol", "acc") },
  { id: "m9", kind: "mark", label: "Billetterie", desc: "Caisse et contrôle des billets (un seul point)", color: "#0f8a5f", level: "rdc", ...at(860, 690), maps: on("web", "vol") },
  { id: "m7", kind: "mark", label: "VIP", desc: "Accueil VIP et retrait des badges VIP", color: "#b8912a", level: "rdc", ...at(830, 880), maps: on("vol") },
  { id: "m8", kind: "mark", label: "Staff", desc: "Accueil bénévoles, juges et presse, retrait des badges", color: "#27a9e1", level: "rdc", ...at(930, 905), maps: on("vol", "acc") },

  // Stands (niveau des arcades)
  { id: "m3", kind: "mark", label: "Drink cards", desc: "Vente des drink cards, à la buvette", color: "#e5719a", level: "rdc", ...at(420, 335), maps: on("web", "vol") },
  { id: "m2", kind: "mark", label: "Bar & food", desc: "Bar et restauration, le long du mur du gymnase", color: "#e5719a", level: "rdc", ...at(700, 445), maps: on("web", "vol") },
  // Les stands qui occupent un espace sont des zones (w x h en unités du plan), les points restent des étiquettes
  { id: "m5", kind: "area", label: "Discovery", desc: "Athletics Discovery Corner : ateliers pour les enfants, dans le couloir entre la buvette et l'amphithéâtre", color: "#e30613", level: "rdc", ...at(530, 180), shape: [[-92,-73],[-35,-88],[46,-122],[20,-105],[18,-68],[16,-6],[18,26],[43,46],[68,81],[73,99],[60,114],[42,102],[22,79],[-2,54],[-23,35],[-39,19],[-59,-4],[-73,-31],[-81,-56]], maps: on("web", "vol") },
  { id: "m16", kind: "mark", label: "Photobooth", desc: "Photobooth (à placer sur le plan)", color: "#9157e6", level: "rdc", ...at(900, 1150), maps: on("web", "vol") },
  { id: "m17", kind: "mark", label: "Asport", desc: "Stand Asport : vêtements (à placer sur le plan)", color: "#0d8fd3", level: "rdc", ...at(900, 1215), maps: on("web", "vol") },
  { id: "m4", kind: "mark", label: "Autographes", desc: "Signing zone : rencontre avec les athlètes", color: "#6b7a86", level: "rdc", ...at(240, 420), maps: on("web", "vol") },

  // Toilettes : à la porte de chaque bloc, femmes / hommes comme sur le plan d'architecte
  // (buvette : deux blocs femmes sur les côtés, hommes en haut ; salons : trois blocs mixtes ;
  // bâtiment du bas : femmes à gauche, hommes à droite, réservés au warm-up)
  { id: "wf1", kind: "mark", label: "WC ♀", desc: "Toilettes femmes", color: "#3a7ca5", level: "rdc", ...at(326, 252), maps: on("web", "vol") },
  { id: "wf2", kind: "mark", label: "WC ♀", desc: "Toilettes femmes", color: "#3a7ca5", level: "rdc", ...at(496, 262), maps: on("web", "vol") },
  { id: "wh1", kind: "mark", label: "WC ♂", desc: "Toilettes hommes", color: "#3a7ca5", level: "rdc", ...at(484, 208), maps: on("web", "vol") },
  { id: "wm1", kind: "mark", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 652), maps: on("web", "vol") },
  { id: "wm2", kind: "mark", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 738), maps: on("web", "vol") },
  { id: "wm3", kind: "mark", label: "WC ♀♂", desc: "Toilettes femmes et hommes", color: "#3a7ca5", level: "rdc", ...at(736, 921), maps: on("web", "vol") },
  { id: "wf3", kind: "mark", label: "WC ♀", desc: "Toilettes femmes du warm-up (athlètes)", color: "#3a7ca5", level: "rdc", ...at(320, 1420), maps: on("vol", "acc") },
  { id: "wh2", kind: "mark", label: "WC ♂", desc: "Toilettes hommes du warm-up (athlètes)", color: "#3a7ca5", level: "rdc", ...at(532, 1340), maps: on("vol", "acc") },

  // Accès réservés depuis les arcades
  { id: "m11", kind: "door", label: "Galerie VIP", desc: "Accès VIP à la galerie : par le salon de presse, puis la cage d'escalier", color: "#b8912a", angle: 0, level: "rdc", ...at(712, 607), maps: on("vol", "acc") },
  { id: "m13", kind: "mark", label: "↑ Bénévoles", desc: "Escalier en colimaçon vers l'espace bénévoles (galerie)", color: "#4a5d6c", level: "rdc", ...at(436, 138), maps: on("vol", "acc") },
  { id: "d1", kind: "door", label: "Amphi", desc: "Entrée de l'amphithéâtre (salle aussi utilisée par les bénévoles)", color: "#4a5d6c", angle: 0, level: "rdc", ...at(550, 166), maps: on("vol") },
  { id: "m14", kind: "mark", label: "Call room", desc: "Call room : dans le warm-up, derrière les gradins, avant la descente vers la piste", color: "#f07c00", level: "rdc", ...at(112, 800), maps: on("vol", "acc", "ctrl") },

  // Sur la piste (R-1) : utile aux bénévoles et à l'organisation, pas au public
  { id: "m6", kind: "mark", label: "Secours", desc: "Premiers secours, au niveau de la piste (R-1)", color: "#e30613", level: "piste", ...at(300, 470), maps: on("acc") },
  // Galerie (R+1) : sera sur le plan détaillé de la galerie
  { id: "m12", kind: "mark", label: "Bénévoles", desc: "Espace bénévoles (nouveau en 2027), galerie R+1", color: "#27a9e1", level: "etage", ...at(418, 125), maps: on() },

  // Points de contrôle des badges
  { id: "c1", kind: "ctrl", label: "A", desc: "", color: "#0a2540", level: "rdc", ...at(760, 870), maps: on("ctrl") },
  { id: "c2", kind: "ctrl", label: "B", desc: "", color: "#0a2540", level: "rdc", ...at(640, 700), maps: on("ctrl") },
  { id: "c3", kind: "ctrl", label: "C", desc: "", color: "#0a2540", level: "rdc", ...at(640, 950), maps: on("ctrl") },
  { id: "c4", kind: "ctrl", label: "D", desc: "", color: "#0a2540", level: "rdc", ...at(640, 560), maps: on("ctrl") },
  { id: "c5", kind: "ctrl", label: "E", desc: "", color: "#0a2540", level: "rdc", ...at(560, 1160), maps: on("ctrl") },
  { id: "c6", kind: "ctrl", label: "F", desc: "", color: "#0a2540", level: "rdc", ...at(150, 860), maps: on("ctrl") },
];

let planSvgCount = 0;

// Vue d'ensemble, niveau des arcades. crop = true cadre sur la salle seule (verso des badges).
// Infield et Warm-up peuvent être colorés (badge).
function planBaseSvg({ infield = "#e3edf8", warmup = "#c9d9ee", crop = false } = {}) {
  const viewBox = crop ? `0 ${PLAN_CROP.y} ${PLAN_W} ${PLAN_CROP.h}` : `0 0 ${PLAN_W} ${PLAN_H}`;
  const n = ++planSvgCount;
  const hatch = `coque-hatch-${n}`;
  const clip = `coque-clip-${n}`;
  // Piste et tribunes : ovales centrés sur (420, 826), lignes droites de 634 à 1018 (mesures du plan)
  const oval = (r) => `M${420 - r} 634 A${r} ${r} 0 0 1 ${420 + r} 634 L${420 + r} 1018 A${r} ${r} 0 0 1 ${420 - r} 1018 Z`;
  // Les arcades : tout le niveau d'entrée, jusqu'à la buvette et au couloir de l'amphithéâtre
  const arcades = "M418 108 C300 230 120 470 62 740 L62 930 C120 1190 290 1400 418 1530 C560 1400 720 1180 772 930 L772 745 L770 655 L773 630 L892 602 C860 585 830 555 798 520 C770 490 735 440 713 403 C700 380 676 330 658 283 L625 222 C600 228 575 215 560 195 C538 160 548 80 590 60 L586 44 Z";
  const label = (x, y, text, size = 22, fill = "#7d8d99") =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="2" fill="${fill}">${text}</text>`;
  return `<svg class="plan-base" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <clipPath id="${clip}"><path d="${arcades}" /></clipPath>
      <pattern id="${hatch}" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" stroke="#d3dae0" stroke-width="3" /></pattern>
    </defs>

    <!-- Gymnase et ses locaux : fermés, derrière le mur courbe de la rampe -->
    <path d="M625 222 L658 283 C676 330 700 380 713 403 C735 440 770 490 798 520 C830 555 860 585 892 602 L1020 602 L1020 30 L690 30 L662 60 L662 120 L640 205 Z" fill="url(#${hatch})" />
    ${label(885, 330, "GYMNASE", 26, "#a9b5be")}

    <!-- Hall d'entrée -->
    <path d="M773 630 L892 602 L968 723 L988 935 L848 860 L790 905 L772 930 L772 745 L770 655 Z" fill="#eaf4ee" stroke="#5f6f7c" stroke-width="5" stroke-linejoin="round" />
    ${label(880, 650, "HALL D'ENTRÉE", 18, "#6b8a75")}
    <path d="M1015 790 L985 810 L1015 830 Z M1015 804 L1020 804 L1020 816 L1015 816 Z" fill="#0f8a5f" />

    <!-- Arcades -->
    <path d="${arcades}" fill="#f4f6f8" />
    <!-- Warm-up : niveau des arcades, le bas de la salle jusqu'aux gradins et le côté gauche -->
    <path d="M0 1085 L${PLAN_W} 1085 L${PLAN_W} 1700 L0 1700 Z M0 700 L300 700 L300 1085 L0 1085 Z" fill="${warmup}" clip-path="url(#${clip})" />
    <path d="${arcades}" fill="none" stroke="#5f6f7c" stroke-width="6" stroke-linejoin="round" />
    <!-- Le mur qui sépare du gymnase (bord de la rampe), tracé sur la ligne indiquée par Margot -->
    <path d="M625 222 L658 283 C676 330 700 380 713 403 C735 440 770 490 798 520 C830 555 860 585 892 602" fill="none" stroke="#5f6f7c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
    <!-- Salon de presse (pièce contre la tribune) et sa cage d'escalier vers la galerie (accès VIP) -->
    <path d="M635 480 L713 480 C720 520 727 552 729 580 L729 625 L684 625 C680 580 668 525 635 480 Z" fill="#fff" stroke="#9aa8b3" stroke-width="3" stroke-linejoin="round" />
    ${label(700, 545, "PRESSE", 13, "#9aa8b3")}
    <path d="M729 580 L747 565 L760 575 L773 630 L770 655 L733 661 Z" fill="#dfe5ea" stroke="#5f6f7c" stroke-width="3" stroke-linejoin="round" />
    <path d="M738 622 L766 622 M738 629 L767 629 M738 636 L768 636 M738 643 L768 643 M738 650 L768 650" stroke="#9aa8b3" stroke-width="2" />

    <!-- Amphithéâtre, comme sur le plan d'architecte : bâtiment arrondi, scène côté buvette,
         gradins en éventail ; on y entre par les deux sas (en haut et en bas, côté gymnase) -->
    <path d="M590 60 C548 80 538 160 560 195 C575 215 600 228 625 222 C645 205 660 165 662 120 C662 95 658 70 654 52 Z" fill="#e4e9ed" stroke="#5f6f7c" stroke-width="5" stroke-linejoin="round" />
    <rect x="563" y="96" width="12" height="68" rx="3" fill="#9aa8b3" />
    <path d="M594 84 Q622 130 596 196 M604 76 Q640 130 604 206 M614 68 Q658 130 610 214" fill="none" stroke="#b9c5ce" stroke-width="3" />
    ${label(600, 26, "AMPHITHÉÂTRE", 16)}

    <!-- Buvette (en haut, avec l'escalier en colimaçon) et bâtiment du bas -->
    <path d="M300 296 L561 296 L485 227 L456 190 L380 190 L351 227 Z" fill="#dfe5ea" stroke="#9aa8b3" stroke-width="3" stroke-linejoin="round" />
    <circle cx="418" cy="168" r="21" fill="#fff" stroke="#9aa8b3" stroke-width="3" />
    <path d="M418 168 L418 149 M418 168 L434 178 M418 168 L402 178" stroke="#9aa8b3" stroke-width="3" />
    <path d="M300 1352 L561 1352 L485 1420 L456 1458 L380 1458 L351 1420 Z" fill="#dfe5ea" stroke="#9aa8b3" stroke-width="3" stroke-linejoin="round" />

    <!-- Tribunes, avec les passages vers la piste aux deux bouts -->
    <path d="${oval(262)}" fill="#c9d3db" />
    <path d="${oval(246)} ${oval(230)} ${oval(214)}" fill="none" stroke="#dbe2e8" stroke-width="2" />
    <rect x="394" y="368" width="52" height="64" fill="#f4f6f8" />
    <rect x="394" y="1220" width="52" height="64" fill="${warmup}" />
    <!-- Entrées des gradins (plan d'architecte) : coupures dans les virages et aux jonctions avec les lignes droites -->
    ${[[420, 634, -137, "#f4f6f8"], [420, 634, -44, "#f4f6f8"], [420, 1018, 137, warmup], [420, 1018, 38, warmup]]
      .map(([cx, cy, a, fill]) => `<rect x="203" y="-8" width="62" height="16" fill="${fill}" transform="translate(${cx} ${cy}) rotate(${a})" />`).join("")}
    <rect x="155" y="626" width="62" height="16" fill="#f4f6f8" />
    <rect x="623" y="626" width="62" height="16" fill="#f4f6f8" />
    <rect x="155" y="1010" width="62" height="16" fill="${warmup}" />
    <rect x="623" y="1010" width="62" height="16" fill="#f4f6f8" />

    <!-- Piste, en contrebas -->
    <path d="${oval(205)}" fill="#fff" />
    <path d="${oval(192)}" fill="#cfe0f3" />
    <path d="${oval(155)}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="12 9" />
    <path d="${oval(131)}" fill="${infield}" />
  </svg>`;
}

// Repères enregistrés avant ce fond de carte : chacun reprend sa nouvelle place et ses nouveaux
// réglages ; on garde seulement les textes que tu avais réécrits (Bar & food, drink cards).
function migrateFromPrev(old) {
  const fresh = structuredClone(PLAN_DEFAULT_ELEMENTS);
  for (const id of ["m2", "m3"]) {
    const before = old.find((el) => el.id === id);
    const now = fresh.find((el) => el.id === id);
    if (before && now) Object.assign(now, { label: before.label, desc: before.desc });
  }
  const known = new Set([...fresh.map((el) => el.id), "m10", "m15", "w1", "w2", "w3", "w4", "w5"]);
  return [...fresh, ...old.filter((el) => !known.has(el.id))];
}

// Les modifications faites dans l'éditeur sont gardées dans le navigateur ; les badges les relisent.
function loadPlanElements() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAN_STORE));
    if (Array.isArray(stored)) return stored;
    const before = JSON.parse(localStorage.getItem(PLAN_STORE_PREV));
    if (Array.isArray(before)) {
      const moved = migrateFromPrev(before);
      savePlanElements(moved);
      return moved;
    }
  } catch { /* pas de mémoire : plan de départ */ }
  return structuredClone(PLAN_DEFAULT_ELEMENTS);
}

function savePlanElements(elements) {
  try { localStorage.setItem(PLAN_STORE, JSON.stringify(elements)); } catch { /* aperçu sans mémoire */ }
}
