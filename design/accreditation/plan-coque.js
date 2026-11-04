// Plan de la Coque partagé par les maquettes (éditeur de plans et badges) : un seul jeu de repères.
// Positions en % de l'image du plan 2026 (portrait : Warm-up en bas, entrée principale à droite).
// a = plan des accréditations (verso des badges), s = plan spectateurs (venue map).
const PLAN_IMAGE = "assets/plan-coque-2026.png";
const PLAN_RATIO = "1872 / 2646";
const PLAN_ZONE_RED = "#c8102e";
const PLAN_STORE = "myclim-maquette-plans";
const PLAN_DEFAULT_ELEMENTS = [
  { id: "z1", kind: "zone", num: 1, label: "Infield", x: 35.3, y: 50, a: true, s: false },
  { id: "z2", kind: "zone", num: 2, label: "Warm-up", x: 23, y: 85, a: true, s: false },
  { id: "z3a", kind: "zone", num: 3, label: "Coaching Zone", x: 16.4, y: 50, a: true, s: false },
  { id: "z3b", kind: "zone", num: 3, label: "Coaching Zone", x: 54.6, y: 44, a: true, s: false },
  { id: "z3c", kind: "zone", num: 3, label: "Coaching Zone", x: 54.6, y: 62, a: true, s: false },
  { id: "z4", kind: "zone", num: 4, label: "Judges Room", x: 58.4, y: 58.5, a: true, s: false },
  { id: "z5", kind: "zone", num: 5, label: "Mixed Zone", x: 54.4, y: 52, a: true, s: false },
  { id: "z6", kind: "zone", num: 6, label: "VIP Zone", x: 61.5, y: 35, a: true, s: false },
  { id: "m1", kind: "mark", label: "Main Entrance", color: "#0f8a5f", x: 80, y: 58, a: true, s: true },
  { id: "m2", kind: "mark", label: "Bar", color: "#e5719a", x: 36, y: 15, a: false, s: true },
  { id: "m3", kind: "mark", label: "Drink cards", color: "#e5719a", x: 69, y: 47, a: false, s: true },
  { id: "m4", kind: "mark", label: "Signing Zone", color: "#6b7a86", x: 63, y: 26, a: false, s: true },
  { id: "m5", kind: "mark", label: "Athletics workshop", color: "#e30613", x: 47, y: 9, a: false, s: true },
  { id: "m6", kind: "mark", label: "First aid", color: "#e30613", x: 23, y: 29, a: true, s: true },
  { id: "m7", kind: "mark", label: "VIP Welcome", color: "#b8912a", x: 74, y: 66, a: true, s: false },
  { id: "m8", kind: "mark", label: "Volunteers · Judges · Press welcome", color: "#27a9e1", x: 73, y: 71, a: true, s: false },
  { id: "c1", kind: "ctrl", label: "A", color: "#0a2540", x: 76, y: 63, a: true, s: false },
  { id: "c2", kind: "ctrl", label: "B", color: "#0a2540", x: 63.6, y: 49, a: true, s: false },
  { id: "c3", kind: "ctrl", label: "C", color: "#0a2540", x: 62, y: 55, a: true, s: false },
  { id: "c4", kind: "ctrl", label: "D", color: "#0a2540", x: 61.5, y: 41, a: true, s: false },
  { id: "c5", kind: "ctrl", label: "E", color: "#0a2540", x: 56, y: 67, a: true, s: false },
  { id: "c6", kind: "ctrl", label: "F", color: "#0a2540", x: 17.7, y: 79, a: true, s: false },
];

// Plan simplifié, redessiné d'après le plan d'architecte 2026 sur la même grille (1415 x 2000) :
// les repères en % tombent au même endroit. Infield et Warm-up peuvent être colorés (badge).
function planBaseSvg({ infield = "#e3edf8", warmup = "#c9d9ee" } = {}) {
  return `<svg class="plan-base" viewBox="0 0 1415 2000" preserveAspectRatio="none" aria-hidden="true">
    <path d="M505 187 L555 225 C760 390 960 560 1065 780 L1110 785 L1125 815 L1135 940 L1360 960 C1340 1110 1270 1230 1180 1290 L1045 1100 L955 1140 C910 1330 880 1460 820 1580 C720 1740 610 1850 515 1935 C330 1760 160 1520 80 1280 L45 1220 L80 1165 L80 960 L45 905 L80 830 C130 560 300 330 505 187 Z" fill="#f7f9fb" stroke="#5f6f7c" stroke-width="7" stroke-linejoin="round" />
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
  } catch { /* pas de mémoire : plan de départ */ }
  return structuredClone(PLAN_DEFAULT_ELEMENTS);
}

function savePlanElements(elements) {
  try { localStorage.setItem(PLAN_STORE, JSON.stringify(elements)); } catch { /* aperçu sans mémoire */ }
}
