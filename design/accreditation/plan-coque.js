// Plan de la Coque partagé par les maquettes (éditeur de plans et badges) : un seul jeu de repères.
// Positions en % de l'image du plan 2026 (portrait : Warm-up en bas, entrée principale à droite).
// Chaque repère choisit sur quels plans il apparaît (maps) et à quel niveau il se trouve (level).
// Sur le plan : un texte court (label). Le détail va dans la légende (desc).
const PLAN_IMAGE = "assets/plan-coque-2026.png";
// Le plan a été prolongé vers le haut (couloir après le bar, amphithéâtre) : 600 unités de plus
// au-dessus de la grille 2026 (1415 x 2000). Le verso des badges reste cadré sur la salle (crop).
const PLAN_TOP = 600;
const PLAN_H = 2000 + PLAN_TOP;
const PLAN_RATIO = `1415 / ${PLAN_H}`;
const PLAN_RATIO_CROP = "1415 / 2000";
const PLAN_ZONE_RED = "#c8102e";
const PLAN_STORE = "myclim-maquette-plans-v3";
const PLAN_STORE_V2 = "myclim-maquette-plans-v2";
// % de la grille 2026 -> % du plan prolongé, et inversement pour le cadrage badge
const planYFromGrid2026 = (y) => Math.round(((y * 20 + PLAN_TOP) / PLAN_H) * 10000) / 100;
const planPos = (el, crop = false) => (crop ? { x: el.x, y: (el.y * PLAN_H / 100 - PLAN_TOP) / 20 } : { x: el.x, y: el.y });

// Les 4 plans dont on a besoin
const PLAN_MAPS = [
  { key: "web", short: "S", label: "Site internet", who: "Public : entrée et stands" },
  { key: "vol", short: "B", label: "Bénévoles", who: "Pareil que le site + mise en place de l'entrée" },
  { key: "acc", short: "A", label: "Accréditations", who: "Verso des badges : zones d'accès" },
  { key: "ctrl", short: "C", label: "Points de contrôle", who: "Mise en place du contrôle des badges" },
];
const PLAN_LEVELS = { rdc: "Rez-de-chaussée", etage: "Étage" };

const on = (...keys) => Object.fromEntries(PLAN_MAPS.map((m) => [m.key, keys.includes(m.key)]));

// Positions écrites sur la grille 2026, converties plus bas vers le plan prolongé
const PLAN_DEFAULT_ELEMENTS = [
  // Zones d'accès (numéros du badge)
  { id: "z1", kind: "zone", num: 1, label: "Infield", level: "rdc", x: 35.3, y: 50, maps: on("acc", "ctrl") },
  { id: "z2", kind: "zone", num: 2, label: "Warm-up", level: "rdc", x: 23, y: 85, maps: on("acc", "ctrl") },
  { id: "z3a", kind: "zone", num: 3, label: "Coaching Zone", level: "rdc", x: 16.4, y: 50, maps: on("acc", "ctrl") },
  { id: "z3b", kind: "zone", num: 3, label: "Coaching Zone", level: "rdc", x: 54.6, y: 44, maps: on("acc", "ctrl") },
  { id: "z3c", kind: "zone", num: 3, label: "Coaching Zone", level: "rdc", x: 54.6, y: 62, maps: on("acc", "ctrl") },
  { id: "z4", kind: "zone", num: 4, label: "Judges Room", level: "rdc", x: 58.4, y: 58.5, maps: on("acc", "ctrl") },
  { id: "z5", kind: "zone", num: 5, label: "Mixed Zone", level: "rdc", x: 54.4, y: 52, maps: on("acc", "ctrl") },
  { id: "z6", kind: "zone", num: 6, label: "VIP Zone", level: "etage", x: 61.5, y: 35, maps: on("acc", "ctrl") },

  // Entrée : un mot sur le plan, le détail dans la légende
  { id: "m1", kind: "mark", label: "Entrée", desc: "Entrée principale (public)", color: "#0f8a5f", level: "rdc", x: 86, y: 61, maps: on("web", "vol", "acc") },
  { id: "m9", kind: "mark", label: "Caisse", desc: "Billetterie sur place", color: "#0f8a5f", level: "rdc", x: 86, y: 53, maps: on("vol") },
  { id: "m10", kind: "mark", label: "Billets", desc: "Contrôle des billets du public", color: "#0f8a5f", level: "rdc", x: 71, y: 55, maps: on("vol") },
  { id: "m7", kind: "mark", label: "VIP", desc: "Accueil VIP et retrait des badges VIP", color: "#b8912a", level: "rdc", x: 76, y: 66, maps: on("vol") },
  { id: "m8", kind: "mark", label: "Staff", desc: "Accueil bénévoles, juges et presse, retrait des badges", color: "#27a9e1", level: "rdc", x: 74, y: 72, maps: on("vol", "acc") },

  // Stands et services
  { id: "m2", kind: "mark", label: "Bar", desc: "Bar", color: "#e5719a", level: "rdc", x: 36, y: 15, maps: on("web", "vol") },
  { id: "m3", kind: "mark", label: "Jetons", desc: "Vente des cartes boissons", color: "#e5719a", level: "rdc", x: 69, y: 47, maps: on("web", "vol") },
  { id: "m4", kind: "mark", label: "Autographes", desc: "Signing zone : rencontre avec les athlètes", color: "#6b7a86", level: "rdc", x: 63, y: 26, maps: on("web", "vol") },
  { id: "m5", kind: "mark", label: "Discovery", desc: "Athletics Discovery Corner : ateliers pour les enfants, dans le couloir après le bar", color: "#e30613", level: "rdc", x: 45.2, y: 3, maps: on("web", "vol") },
  { id: "m6", kind: "mark", label: "Secours", desc: "Premiers secours", color: "#e30613", level: "rdc", x: 23, y: 29, maps: on("web", "vol", "acc") },

  // Étage : on y monte par le haut des gradins
  { id: "m11", kind: "mark", label: "↑ Étage", desc: "Accès à l'étage par le haut des gradins", color: "#4a5d6c", level: "rdc", x: 72, y: 31, maps: on("web", "vol", "acc") },
  { id: "m12", kind: "mark", label: "Bénévoles", desc: "Espace bénévoles (nouveau en 2027)", color: "#27a9e1", level: "etage", x: 70, y: 22, maps: on("vol", "acc") },

  // Points de contrôle des badges
  { id: "c1", kind: "ctrl", label: "A", desc: "", color: "#0a2540", level: "rdc", x: 76, y: 63, maps: on("ctrl") },
  { id: "c2", kind: "ctrl", label: "B", desc: "", color: "#0a2540", level: "rdc", x: 63.6, y: 49, maps: on("ctrl") },
  { id: "c3", kind: "ctrl", label: "C", desc: "", color: "#0a2540", level: "rdc", x: 62, y: 55, maps: on("ctrl") },
  { id: "c4", kind: "ctrl", label: "D", desc: "", color: "#0a2540", level: "rdc", x: 61.5, y: 41, maps: on("ctrl") },
  { id: "c5", kind: "ctrl", label: "E", desc: "", color: "#0a2540", level: "rdc", x: 56, y: 67, maps: on("ctrl") },
  { id: "c6", kind: "ctrl", label: "F", desc: "", color: "#0a2540", level: "rdc", x: 17.7, y: 79, maps: on("ctrl") },
].map((el) => ({ ...el, y: planYFromGrid2026(el.y) }));

// Plan simplifié, redessiné d'après le plan d'architecte 2026 (grille 1415 x 2000), prolongé de 600
// vers le haut : le couloir après le bar et l'amphithéâtre (schématique, d'après le plan d'un autre
// événement à la Coque). crop = true cadre sur la salle seule, pour le verso des badges.
// Infield et Warm-up peuvent être colorés (badge).
function planBaseSvg({ infield = "#e3edf8", warmup = "#c9d9ee", crop = false } = {}) {
  const viewBox = crop ? "0 0 1415 2000" : `0 ${-PLAN_TOP} 1415 ${PLAN_H}`;
  return `<svg class="plan-base" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">
    <path d="M505 187 L555 225 C760 390 960 560 1065 780 L1110 785 L1125 815 L1135 940 L1360 960 C1340 1110 1270 1230 1180 1290 L1045 1100 L955 1140 C910 1330 880 1460 820 1580 C720 1740 610 1850 515 1935 C330 1760 160 1520 80 1280 L45 1220 L80 1165 L80 960 L45 905 L80 830 C130 560 300 330 505 187 Z" fill="#f7f9fb" stroke="#5f6f7c" stroke-width="7" stroke-linejoin="round" />
    <!-- Prolongement : couloir après le bar puis amphithéâtre. Le fond recouvre l'ancien bord du haut
         (c'est ouvert), seul le contour extérieur est tracé. -->
    <path d="M300 340 L150 -20 A560 560 0 0 1 1130 -20 L840 470 Z" fill="#f7f9fb" />
    <path d="M300 340 L150 -20 A560 560 0 0 1 1130 -20 L847 482" fill="none" stroke="#5f6f7c" stroke-width="7" stroke-linejoin="round" />
    <path d="M276.3 -70 A420 420 0 0 1 1003.7 -70 L839.2 25 A230 230 0 0 0 440.8 25 Z" fill="#dfe5ea" />
    <path d="M399.2 1 A278 278 0 0 1 880.8 1 M357.7 -23 A326 326 0 0 1 922.3 -23 M316.1 -47 A374 374 0 0 1 963.9 -47" fill="none" stroke="#c3ccd3" stroke-width="3" />
    <text x="640" y="-140" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="44" letter-spacing="4" fill="#8a9aa7">AMPHITHÉÂTRE</text>
    <text x="640" y="150" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-weight="700" font-size="30" letter-spacing="3" fill="#a9b5be">COULOIR</text>
    <!-- Warm-up : passe sous les tribunes, dessinées par-dessus, pour s'arrêter pile à leur bord -->
    <path d="M45 905 L400 895 L500 1300 L745 1535 L825 1580 C720 1740 610 1850 515 1935 C330 1760 160 1520 80 1280 L45 1220 L80 1165 L80 960 Z" fill="${warmup}" />
    <path d="M350 395 L425 262 L505 222 L588 262 L668 395 Z" fill="#dfe5ea" />
    <path d="M770 595 C842 650 912 722 946 800 L900 830 L830 805 Z" fill="#dfe5ea" />
    <path d="M795 890 L880 890 L880 1000 A60 60 0 0 1 880 1120 L880 1235 L795 1235 Z" fill="#dfe5ea" />
    <path d="M1192 1040 L1318 1000 L1250 1200 L1186 1178 Z" fill="#e9eef2" />
    <ellipse cx="1318" cy="960" rx="48" ry="32" fill="#e9eef2" />
    <ellipse cx="1148" cy="1248" rx="38" ry="45" fill="#e9eef2" />
    <rect x="175" y="465" width="655" height="1180" rx="327" fill="#e7ecf0" stroke="#b9c5ce" stroke-width="3" />
    <rect x="232" y="535" width="541" height="1040" rx="270" fill="#fff" />
    <rect x="248" y="568" width="504" height="992" rx="252" fill="#cfe0f3" />
    <rect x="292" y="612" width="416" height="904" rx="208" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="14 10" />
    <rect x="335" y="660" width="330" height="810" rx="165" fill="${infield}" />
  </svg>`;
}

// Les modifications faites dans l'éditeur sont gardées dans le navigateur ; les badges les relisent.
function loadPlanElements() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAN_STORE));
    if (Array.isArray(stored)) return stored;
    // Repères déplacés avant le prolongement du plan : on garde les modifications, positions converties
    const before = JSON.parse(localStorage.getItem(PLAN_STORE_V2));
    if (Array.isArray(before)) {
      const moved = before.map((el) => ({ ...el, y: planYFromGrid2026(el.y) }));
      const discovery = moved.find((el) => el.id === "m5");
      const fresh = PLAN_DEFAULT_ELEMENTS.find((el) => el.id === "m5");
      if (discovery && fresh) Object.assign(discovery, { x: fresh.x, y: fresh.y });
      savePlanElements(moved);
      return moved;
    }
  } catch { /* pas de mémoire : plan de départ */ }
  return structuredClone(PLAN_DEFAULT_ELEMENTS);
}

function savePlanElements(elements) {
  try { localStorage.setItem(PLAN_STORE, JSON.stringify(elements)); } catch { /* aperçu sans mémoire */ }
}
