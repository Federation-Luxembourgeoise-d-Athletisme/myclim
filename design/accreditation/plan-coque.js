// Plan de la Coque partagé par les maquettes (éditeur de plans et badges) : un seul jeu de repères.
// Redessiné d'après le plan d'architecte « CNSC d'Coque – Rénovation » (Plans Arena.pdf, 3 niveaux),
// tourné d'un quart de tour : amphithéâtre et buvette en haut, hall d'entrée à droite, vestiaires en bas.
// Positions des repères en % du plan. Chaque repère choisit sur quels plans il apparaît (maps)
// et à quel niveau il se trouve (level). Sur le plan : un texte court (label), le détail en légende (desc).
const PLAN_W = 1020;
const PLAN_H = 1620;
const PLAN_RATIO = `${PLAN_W} / ${PLAN_H}`;
// Verso des badges : cadré sur la salle (on coupe le gymnase et le haut de l'amphithéâtre)
const PLAN_CROP = { y: 200, h: 1440 };
const PLAN_RATIO_CROP = `${PLAN_W} / ${PLAN_CROP.h}`;
const PLAN_ZONE_RED = "#c8102e";
const PLAN_STORE = "myclim-maquette-plans-v4";
const PLAN_STORE_V3 = "myclim-maquette-plans-v3";
const planPos = (el, crop = false) =>
  crop ? { x: el.x, y: ((el.y / 100) * PLAN_H - PLAN_CROP.y) / PLAN_CROP.h * 100 } : { x: el.x, y: el.y };

// Les 4 plans dont on a besoin
const PLAN_MAPS = [
  { key: "web", short: "S", label: "Site internet", who: "Public : entrée et stands" },
  { key: "vol", short: "B", label: "Bénévoles", who: "Pareil que le site + mise en place de l'entrée" },
  { key: "acc", short: "A", label: "Accréditations", who: "Verso des badges : zones d'accès" },
  { key: "ctrl", short: "C", label: "Points de contrôle", who: "Mise en place du contrôle des badges" },
];
// Les 3 niveaux de la Coque : la piste est en contrebas, on entre par les arcades (haut des
// tribunes basses), la galerie est au-dessus.
const PLAN_LEVELS = { piste: "Piste (R-1)", rdc: "Arcades · entrée", etage: "Galerie (R+1)" };

const on = (...keys) => Object.fromEntries(PLAN_MAPS.map((m) => [m.key, keys.includes(m.key)]));
const at = (X, Y) => ({ x: Math.round((X / PLAN_W) * 10000) / 100, y: Math.round((Y / PLAN_H) * 10000) / 100 });

const PLAN_DEFAULT_ELEMENTS = [
  // Zones d'accès (numéros du badge)
  { id: "z1", kind: "zone", num: 1, label: "Infield", level: "piste", ...at(420, 845), maps: on("acc", "ctrl") },
  { id: "z2", kind: "zone", num: 2, label: "Warm-up", level: "rdc", ...at(270, 1385), maps: on("acc", "ctrl") },
  { id: "z3a", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(242, 845), maps: on("acc", "ctrl") },
  { id: "z3b", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(598, 700), maps: on("acc", "ctrl") },
  { id: "z3c", kind: "zone", num: 3, label: "Coaching Zone", level: "piste", ...at(598, 990), maps: on("acc", "ctrl") },
  { id: "z4", kind: "zone", num: 4, label: "Judges Room", level: "piste", ...at(658, 960), maps: on("acc", "ctrl") },
  { id: "z5", kind: "zone", num: 5, label: "Mixed Zone", level: "piste", ...at(658, 800), maps: on("acc", "ctrl") },
  { id: "z6", kind: "zone", num: 6, label: "VIP Zone", level: "etage", ...at(700, 470), maps: on("acc", "ctrl") },

  // Hall d'entrée
  { id: "m1", kind: "mark", label: "Entrée", desc: "Entrée principale (public)", color: "#0f8a5f", level: "rdc", ...at(905, 850), maps: on("web", "vol", "acc") },
  { id: "m9", kind: "mark", label: "Caisse", desc: "Billetterie sur place", color: "#0f8a5f", level: "rdc", ...at(905, 720), maps: on("vol") },
  { id: "m10", kind: "mark", label: "Billets", desc: "Contrôle des billets du public", color: "#0f8a5f", level: "rdc", ...at(815, 770), maps: on("vol") },
  { id: "m7", kind: "mark", label: "VIP", desc: "Accueil VIP et retrait des badges VIP", color: "#b8912a", level: "rdc", ...at(850, 960), maps: on("vol") },
  { id: "m8", kind: "mark", label: "Staff", desc: "Accueil bénévoles, juges et presse, retrait des badges", color: "#27a9e1", level: "rdc", ...at(850, 1010), maps: on("vol", "acc") },

  // Stands et services (niveau des arcades)
  { id: "m2", kind: "mark", label: "Bar & food", desc: "Bar et restauration, le long du mur côté gymnase, avant l'amphithéâtre", color: "#e5719a", level: "rdc", ...at(632, 430), maps: on("web", "vol") },
  { id: "m3", kind: "mark", label: "Drink cards", desc: "Vente des drink cards, à la buvette", color: "#e5719a", level: "rdc", ...at(420, 332), maps: on("web", "vol") },
  { id: "m4", kind: "mark", label: "Autographes", desc: "Signing zone : rencontre avec les athlètes", color: "#6b7a86", level: "rdc", ...at(205, 458), maps: on("web", "vol") },
  { id: "m5", kind: "mark", label: "Discovery", desc: "Athletics Discovery Corner : ateliers pour les enfants, après la buvette", color: "#e30613", level: "rdc", ...at(590, 372), maps: on("web", "vol") },
  { id: "m6", kind: "mark", label: "Secours", desc: "Premiers secours", color: "#e30613", level: "rdc", ...at(190, 400), maps: on("web", "vol", "acc") },

  // Toilettes publiques, aux emplacements du plan d'architecte (niveau arcades) :
  // bâtiment de la buvette (deux côtés), derrière la tribune côté hall (deux blocs), bâtiment du bas
  { id: "w1", kind: "mark", label: "WC", desc: "Toilettes", color: "#3a7ca5", level: "rdc", ...at(362, 268), maps: on("web", "vol") },
  { id: "w5", kind: "mark", label: "WC", desc: "Toilettes", color: "#3a7ca5", level: "rdc", ...at(478, 268), maps: on("web", "vol") },
  { id: "w2", kind: "mark", label: "WC", desc: "Toilettes", color: "#3a7ca5", level: "rdc", ...at(728, 705), maps: on("web", "vol") },
  { id: "w3", kind: "mark", label: "WC", desc: "Toilettes", color: "#3a7ca5", level: "rdc", ...at(728, 915), maps: on("web", "vol") },
  { id: "w4", kind: "mark", label: "WC", desc: "Toilettes", color: "#3a7ca5", level: "rdc", ...at(420, 1400), maps: on("web", "vol") },

  // Galerie (R+1) : les VIP entrent par la porte du salon de presse, les bénévoles par l'escalier en colimaçon de la buvette
  { id: "m11", kind: "mark", label: "↑ Galerie VIP", desc: "Entrée des VIP vers la galerie (R+1), par la porte du salon de presse", color: "#b8912a", level: "rdc", ...at(705, 575), maps: on("vol", "acc") },
  { id: "m13", kind: "mark", label: "↑ Bénévoles", desc: "Escalier en colimaçon vers l'espace bénévoles (R+1)", color: "#4a5d6c", level: "rdc", ...at(420, 203), maps: on("vol", "acc") },
  { id: "m12", kind: "mark", label: "Bénévoles", desc: "Espace bénévoles (nouveau en 2027), en haut de l'escalier en colimaçon", color: "#27a9e1", level: "etage", ...at(420, 122), maps: on("vol", "acc") },

  // Points de contrôle des badges
  { id: "c1", kind: "ctrl", label: "A", desc: "", color: "#0a2540", level: "rdc", ...at(780, 940), maps: on("ctrl") },
  { id: "c2", kind: "ctrl", label: "B", desc: "", color: "#0a2540", level: "rdc", ...at(660, 720), maps: on("ctrl") },
  { id: "c3", kind: "ctrl", label: "C", desc: "", color: "#0a2540", level: "rdc", ...at(660, 950), maps: on("ctrl") },
  { id: "c4", kind: "ctrl", label: "D", desc: "", color: "#0a2540", level: "rdc", ...at(650, 560), maps: on("ctrl") },
  { id: "c5", kind: "ctrl", label: "E", desc: "", color: "#0a2540", level: "rdc", ...at(560, 1180), maps: on("ctrl") },
  { id: "c6", kind: "ctrl", label: "F", desc: "", color: "#0a2540", level: "rdc", ...at(200, 1270), maps: on("ctrl") },
];

let planSvgCount = 0;

// Plan simplifié. crop = true cadre sur la salle seule (verso des badges).
// Infield et Warm-up peuvent être colorés (badge).
function planBaseSvg({ infield = "#e3edf8", warmup = "#c9d9ee", crop = false } = {}) {
  const viewBox = crop ? `0 ${PLAN_CROP.y} ${PLAN_W} ${PLAN_CROP.h}` : `0 0 ${PLAN_W} ${PLAN_H}`;
  const n = ++planSvgCount;
  const hatch = `coque-hatch-${n}`;
  const clip = `coque-clip-${n}`;
  const arcades = "M420 60 C640 250 780 600 775 850 C770 1150 620 1400 420 1590 C220 1400 70 1150 75 850 C80 600 200 250 420 60 Z";
  // Tribunes et piste : ovales verticaux centrés sur (420, 845), lignes droites de 640 à 1050
  const oval = (r) => `M${420 - r} 640 A${r} ${r} 0 0 1 ${420 + r} 640 L${420 + r} 1050 A${r} ${r} 0 0 1 ${420 - r} 1050 Z`;
  const label = (x, y, text, size = 24, fill = "#7d8d99") =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="2" fill="${fill}">${text}</text>`;
  return `<svg class="plan-base" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="${clip}"><path d="${arcades}" /></clipPath><pattern id="${hatch}" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" stroke="#cdd5dc" stroke-width="3" /></pattern></defs>

    <!-- Reste du bâtiment, fermé : gymnase -->
    <path d="M600 300 L700 215 L770 40 L1000 40 L1000 575 L748 575 C735 480 690 380 600 300 Z" fill="url(#${hatch})" stroke="#cdd5dc" stroke-width="3" />
    ${label(880, 330, "GYMNASE", 26, "#a9b5be")}

    <!-- Hall d'entrée, devant la salle -->
    <path d="M760 690 L955 625 L955 1065 L760 1010 Z" fill="#eaf4ee" stroke="#5f6f7c" stroke-width="6" stroke-linejoin="round" />
    <path d="M1012 822 L978 845 L1012 868 Z M1012 838 L1018 838 L1018 852 L1012 852 Z" fill="#0f8a5f" />

    <!-- Arcades : tout le niveau d'entrée autour des tribunes -->
    <path d="${arcades}" fill="#f4f6f8" stroke="#5f6f7c" stroke-width="6" stroke-linejoin="round" />

    <!-- Warm-up : niveau des arcades, tout le bas de la salle jusqu'aux gradins, et le long des tribunes à gauche -->
    <path d="M0 1085 L${PLAN_W} 1085 L${PLAN_W} 1700 L0 1700 Z M0 700 L300 700 L300 1085 L0 1085 Z" fill="${warmup}" clip-path="url(#${clip})" />
    <path d="${arcades}" fill="none" stroke="#5f6f7c" stroke-width="6" stroke-linejoin="round" />

    <!-- Amphithéâtre, au bout après la buvette -->
    <ellipse cx="600" cy="135" rx="108" ry="96" fill="#e4e9ed" stroke="#8a9aa7" stroke-width="4" />
    <rect x="562" y="50" width="76" height="20" rx="3" fill="#b9c5ce" />
    <path d="M560 78 A40 36 0 0 0 640 78 M538 78 A62 60 0 0 0 662 78 M515 78 A85 85 0 0 0 685 78" fill="none" stroke="#c3ccd3" stroke-width="3" />
    ${label(600, 208, "AMPHITHÉÂTRE", 20)}

    <!-- Bâtiments : buvette (en haut) et bâtiment du bas -->
    <path d="M420 150 L548 305 L292 305 Z" fill="#d5dde3" stroke="#9aa8b3" stroke-width="3" stroke-linejoin="round" />
    <circle cx="420" cy="205" r="20" fill="#fff" stroke="#9aa8b3" stroke-width="3" />
    <path d="M420 205 L420 187 M420 205 L436 214 M420 205 L404 214" stroke="#9aa8b3" stroke-width="3" />
    <path d="M300 1335 L540 1335 L420 1500 Z" fill="#d5dde3" stroke="#9aa8b3" stroke-width="3" stroke-linejoin="round" />

    <!-- Tribunes : anneau avec passages aux deux bouts -->
    <path d="${oval(272)}" fill="#c9d3db" />
    <path d="${oval(255)} ${oval(238)} ${oval(222)}" fill="none" stroke="#dbe2e8" stroke-width="2" />
    <rect x="392" y="360" width="56" height="44" fill="#f4f6f8" />
    <rect x="392" y="1286" width="56" height="44" fill="${warmup}" />

    <!-- Galerie (R+1), au-dessus des arcades : le long des tribunes côté salons (VIP), et l'espace
         bénévoles au-dessus de la buvette. D'après le plan R+1 annoté par Margot. -->
    <path d="M307 330 A330 330 0 0 1 750 640 L750 1050 A330 330 0 0 1 706 1215 L661 1189 A278 278 0 0 0 698 1050 L698 640 A278 278 0 0 0 325 379 Z" fill="rgba(122,79,208,.13)" stroke="#7a4fd0" stroke-width="3" stroke-dasharray="10 7" stroke-linejoin="round" />
    <rect x="345" y="92" width="150" height="58" rx="10" fill="rgba(122,79,208,.13)" stroke="#7a4fd0" stroke-width="3" stroke-dasharray="10 7" />
    <text x="724" y="850" transform="rotate(90 724 850)" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="20" letter-spacing="3" fill="#7a4fd0">GALERIE (R+1)</text>

    <!-- Piste en contrebas -->
    <path d="${oval(208)}" fill="#fff" />
    <path d="${oval(200)}" fill="#cfe0f3" />
    <path d="${oval(175)}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="12 9" />
    <path d="${oval(150)}" fill="${infield}" />
  </svg>`;
}

// Repères enregistrés avant ce nouveau dessin : les repères connus reprennent leur nouvelle place,
// en gardant tes textes, couleurs et cases cochées ; les repères ajoutés à la main sont convertis.
function migrateFromV3(old) {
  return old.map((el) => {
    const fresh = PLAN_DEFAULT_ELEMENTS.find((item) => item.id === el.id);
    if (fresh) return { ...el, x: fresh.x, y: fresh.y, level: el.level === "etage" ? "etage" : fresh.level };
    const X = 420 + (el.x * 14.15 - 502) * 0.824;
    const Y = 845 + (el.y * 26 - 600 - 1055) * 0.805;
    const clamp = (v) => Math.min(98, Math.max(2, Math.round(v * 100) / 100));
    return { ...el, x: clamp((X / PLAN_W) * 100), y: clamp((Y / PLAN_H) * 100) };
  });
}

// Les modifications faites dans l'éditeur sont gardées dans le navigateur ; les badges les relisent.
function loadPlanElements() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAN_STORE));
    if (Array.isArray(stored)) return stored;
    const before = JSON.parse(localStorage.getItem(PLAN_STORE_V3));
    if (Array.isArray(before)) {
      const moved = migrateFromV3(before);
      savePlanElements(moved);
      return moved;
    }
  } catch { /* pas de mémoire : plan de départ */ }
  return structuredClone(PLAN_DEFAULT_ELEMENTS);
}

function savePlanElements(elements) {
  try { localStorage.setItem(PLAN_STORE, JSON.stringify(elements)); } catch { /* aperçu sans mémoire */ }
}
