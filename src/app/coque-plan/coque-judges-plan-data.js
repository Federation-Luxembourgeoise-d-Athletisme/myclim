// Plan de l'infield pour les juges (Accréditations › Plan juges) : le fond des plans de la Coque
// (niveau 0 : vrais murs, gradins, warm-up, salon VIP) cadré sur la salle, l'infield dessiné en détail
// (sens des aires vérifié sur le plan d'architecte R-1), la position des juges par équipe (ronds de
// couleur), les chambres d'appel, la scène, les haies, l'entrée de l'infield, la salle et la tribune
// des juges, les bancs d'attente : chacun à sa place réelle, comme sur l'ancien plan des juges.
// Même grille que les plans de la Coque (unités du plan) ; positions des éléments en % du cadre.
import { lineSvg, normalizePlanElement, PLAN_PALETTE, planBaseSvg } from "./coque-plan-data";

// Cadre (unités du plan) : la salle autour de la piste (gradins, warm-up, salon VIP), format A4 portrait.
export const JUDGES_BOX = { x: 30, y: 260, w: 800, h: 1130 };
const B = JUDGES_BOX;

const TRACK_BLUE = "#6f9fd4";
const SAND = "#e8d39e";
const MAT = "#34558b";
const INK = "#34558b";

export const JUDGES_FACILITIES = {
  sprint: { label: "Ligne droite du 60 m", en: "60 m straight" },
  pole: { label: "Perche", en: "Pole vault" },
  long: { label: "Longueur / triple", en: "Long / triple jump" },
  shot: { label: "Poids", en: "Shot put" },
  high: { label: "Hauteur", en: "High jump" },
};

const txt = (x, y, text, { size = 8, fill = INK, rot = 0, weight = 800, anchor = "middle" } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Barlow Condensed, Arial, sans-serif" font-weight="${weight}" font-size="${size}" letter-spacing=".6" fill="${fill}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ""}>${text}</text>`;

// Aires dessinées en détail (mêmes positions que les versions simplifiées de coque-plan-data.js).
const FACILITY_SVG = {
  // 8 couloirs de 9 unités, départ en bas (y 1105), arrivée 60 m plus haut (y 601), dégagement au-delà
  sprint: (en) => {
    const x0 = 384;
    const lanes = Array.from({ length: 9 }, (_, i) => `<line x1="${x0 + i * 9}" y1="560" x2="${x0 + i * 9}" y2="1125" />`).join("");
    const nums = Array.from({ length: 8 }, (_, i) => txt(x0 + 4.5 + i * 9, 1115, i + 1, { size: 7, fill: "#fff" })).join("");
    // Arrivée en damier
    const checks = Array.from({ length: 16 }, (_, i) => `<rect x="${x0 + i * 4.5}" y="${i % 2 ? 599 : 601}" width="4.5" height="2" fill="#0b1b2b" />`).join("");
    return `<rect x="${x0}" y="560" width="72" height="565" fill="${TRACK_BLUE}" /><g stroke="#fff" stroke-width="1.1">${lanes}</g>
      <rect x="${x0}" y="599" width="72" height="4" fill="#fff" />${checks}
      <line x1="${x0}" y1="1105" x2="${x0 + 72}" y2="1105" stroke="#fff" stroke-width="2.5" />${nums}
      ${txt(420, 1123, en ? "START" : "DÉPART", { size: 6.5, fill: "#fff" })}
      ${txt(420, 592, en ? "FINISH" : "ARRIVÉE", { size: 6.5, fill: "#fff" })}
      ${txt(420, 552, "60 m", { size: 9 })}`;
  },
  // Plan d'architecte (R-1) : fosse côté arrivée du 60 m, élan depuis le côté départ.
  // Planches longueur (2 m de la fosse) et triple (11 et 13 m).
  long: (en) => {
    const board = (y) => `<rect x="478" y="${y - 1.5}" width="10" height="3" fill="#fff" stroke="#4a5d6c" stroke-width=".6" />`;
    return `<rect x="478" y="658" width="10" height="442" fill="${TRACK_BLUE}" />
      ${board(675)}${board(750)}${board(767)}
      ${txt(491, 677.5, en ? "LJ" : "L", { size: 6, anchor: "start" })}${txt(491, 752.5, "T11", { size: 6, anchor: "start" })}${txt(491, 769.5, "T13", { size: 6, anchor: "start" })}
      <rect x="471" y="582" width="24" height="76" rx="2" fill="${SAND}" stroke="#c4a86a" stroke-width="1.5" />
      ${txt(474, 1020, en ? "LONG / TRIPLE" : "LONGUEUR / TRIPLE", { size: 8, rot: -90 })}`;
  },
  // Élan, butoir, tapis de réception, sautoirs et barre
  pole: (en) => `<rect x="512" y="640" width="10" height="362" fill="${TRACK_BLUE}" /><path d="M513 1002h8l-4 8z" fill="#4a5d6c" />
    <rect x="497" y="1010" width="40" height="40" rx="3" fill="${MAT}" />
    <path d="M500 1013 H534" stroke="#fff" stroke-width="1.6" /><circle cx="500" cy="1013" r="2.4" fill="#0b1b2b" /><circle cx="534" cy="1013" r="2.4" fill="#0b1b2b" />
    ${txt(530, 760, en ? "POLE VAULT" : "PERCHE", { size: 8, rot: -90 })}`,
  // Plan d'architecte : cercle côté départ du 60 m, lancer vers l'arrivée. Cercle (2,135 m),
  // butoir, secteur de 34,92°, arcs à 10 et 15 m.
  shot: (en) => {
    const cx = SHOT.cx;
    const cy = SHOT.cy;
    const a = (17.46 * Math.PI) / 180;
    const ray = (L) => [L * Math.sin(a), cy - L * Math.cos(a)];
    const [ex, ey] = ray(140);
    const arc = (L, label) => {
      const [dx, y] = ray(L);
      return `<path d="M${cx - dx} ${y} Q${cx} ${y - L * 0.1} ${cx + dx} ${y}" stroke="#5f7f9f" stroke-width=".9" stroke-dasharray="3 3" fill="none" />${txt(cx + dx + 3, y + 2, label, { size: 6, anchor: "start", weight: 700 })}`;
    };
    return `<path d="M${cx - ex} ${ey} L${cx} ${cy} L${cx + ex} ${ey} Q${cx} ${ey - 14} ${cx - ex} ${ey} Z" fill="#dfe8f0" />
      <path d="M${cx} ${cy} L${cx - ex} ${ey} M${cx} ${cy} L${cx + ex} ${ey}" stroke="#5f7f9f" stroke-width="1.6" fill="none" />
      ${arc(84, "10 m")}${arc(126, "15 m")}
      <circle cx="${cx}" cy="${cy}" r="9" fill="#c9d3db" stroke="#4a5d6c" stroke-width="1.6" /><path d="M${cx - 6} ${cy - 10.5}h12" stroke="#fff" stroke-width="3" />
      ${txt(cx, ey - 16, en ? "SHOT PUT" : "POIDS", { size: 8 })}`;
  },
  // Plan d'architecte : tapis contre le bord gauche de l'infield, côté arrivée ; élan en éventail
  // ouvert vers les couloirs du 60 m. Barre et sautoirs devant le tapis.
  high: (en) => `<path d="M328 735 L384 662 L384 848 L328 775 Z" fill="${TRACK_BLUE}" fill-opacity=".55" />
    <rect x="296" y="735" width="30" height="40" rx="2" fill="${MAT}" /><path d="M329 732v46" stroke="#fff" stroke-width="2" /><circle cx="329" cy="732" r="2.4" fill="#0b1b2b" /><circle cx="329" cy="778" r="2.4" fill="#0b1b2b" />
    ${txt(336, 650, en ? "HIGH JUMP" : "HAUTEUR", { size: 8 })}`,
};
const SHOT = { cx: 334, cy: 1095 };

// Fond : le niveau 0 des plans de la Coque (murs, gradins, piste de 6 couloirs, warm-up teinté),
// cadré ; par-dessus, les aires de concours et les lignes.
export function judgesPlanSvg(elements, lang = "fr") {
  const en = lang === "en";
  const viewBox = `${B.x} ${B.y} ${B.w} ${B.h}`;
  const base = planBaseSvg({ lang, infield: "#e9eff5", warmup: "#f6ecb8" }).replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  const facilities = elements
    .filter((el) => el.kind === "facility" && !el.hidden)
    .map((el) => FACILITY_SVG[el.facility]?.(en) || "")
    .join("");
  const lines = elements
    .filter((el) => el.kind === "line")
    .map((el) => lineSvg(el, B.x + (el.x / 100) * B.w, B.y + (el.y / 100) * B.h))
    .join("");
  return `${base}<svg viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">
    ${facilities}${lines}
    ${txt(150, 1250, "WARM-UP", { size: 22, fill: "#b8a24a", rot: -52 })}
  </svg>`;
}

// ─── Équipes et éléments de départ ───────────────────────────────────────────

export const JUDGES_DEFAULT_TEAMS = [
  { id: "start", label: "Départ 60 m", labelEn: "60 m start", color: "#0f8a5f" },
  { id: "finish", label: "Arrivée", labelEn: "Finish", color: "#0a2540" },
  { id: "hurdles", label: "Équipe haies", labelEn: "Hurdles crew", color: "#f07c00" },
  { id: "pole", label: "Perche", labelEn: "Pole vault", color: "#5b2bb5" },
  { id: "long", label: "Longueur / triple", labelEn: "Long / triple jump", color: "#b8912a" },
  { id: "shot", label: "Poids", labelEn: "Shot put", color: "#e30613" },
  { id: "high", label: "Hauteur", labelEn: "High jump", color: "#27a9e1" },
  { id: "callroom", label: "Chambre d'appel", labelEn: "Call room", color: "#6b7a86" },
  { id: "infield", label: "Commissaires infield", labelEn: "Infield marshals", color: "#e5719a" },
];

const at = (X, Y) => ({ x: Math.round(((X - B.x) / B.w) * 10000) / 100, y: Math.round(((Y - B.y) / B.h) * 10000) / 100 });
let seq = 0;
const judge = (team, label, desc, descEn, X, Y, labelEn = "") => ({ id: `j-${team}-${++seq}`, kind: "judge", team, label, labelEn, desc, descEn, ...at(X, Y) });

export const JUDGES_DEFAULT_ELEMENTS = [
  ...Object.keys(JUDGES_FACILITIES).map((key) => ({ id: `fac-${key}`, kind: "facility", facility: key })),

  judge("start", "S", "Starter", "Starter", 476, 1112),
  judge("start", "R", "Starter de rappel", "Recall starter", 372, 1134),
  judge("start", "A", "Aide-starter", "Starter's assistant", 445, 1140),
  judge("finish", "PF", "Photo-finish", "Photo finish", 468, 590),
  judge("finish", "1", "Juge à l'arrivée", "Finish judge", 360, 586),
  judge("finish", "2", "Juge à l'arrivée", "Finish judge", 360, 608),
  judge("hurdles", "1", "Mise en place des haies", "Hurdle set-up", 300, 1205),
  judge("hurdles", "2", "Mise en place des haies", "Hurdle set-up", 360, 1205),
  judge("pole", "C", "Chef de concours", "Chief judge", 544, 985),
  judge("pole", "1", "Sautoirs et barre", "Uprights and bar", 544, 1022),
  judge("pole", "2", "Derrière le tapis", "Behind the landing mat", 517, 1064),
  judge("pole", "3", "Élan (drapeau, chrono)", "Runway (flag, clock)", 532, 860),
  judge("long", "C", "Chef de concours, planche", "Chief judge, take-off board", 466, 678),
  judge("long", "1", "Mesure", "Measurement", 466, 625),
  judge("long", "2", "Ratissage de la fosse", "Pit raking", 500, 600),
  judge("long", "V", "Anémomètre", "Wind gauge", 466, 790, "W"),
  judge("shot", "C", "Chef de concours, cercle", "Chief judge, circle", 316, 1100),
  judge("shot", "1", "Cercle", "Circle", 352, 1100),
  judge("shot", "2", "Mesure", "Measurement", 300, 1000),
  judge("shot", "3", "Retour des engins", "Implement return", 370, 1000),
  judge("high", "C", "Chef de concours", "Chief judge", 302, 700),
  judge("high", "1", "Sautoir haut", "Upper upright", 346, 724),
  judge("high", "2", "Sautoir bas", "Lower upright", 346, 786),
  judge("callroom", "1", "Chambre d'appel 1", "Call room 1", 160, 905),
  judge("callroom", "2", "Chambre d'appel 2", "Call room 2", 236, 1000),
  judge("infield", "M", "Commissaire infield", "Infield marshal", 330, 560),
  judge("infield", "M", "Commissaire infield", "Infield marshal", 510, 560),

  { id: "stage", kind: "area", label: "Scène", labelEn: "Stage", desc: "Scène (présentations, cérémonies), au bout de la piste côté départ", descEn: "Stage (presentations, ceremonies), at the start end of the track", color: "#e0601a", w: 70, h: 26, ...at(420, 1252) },
  { id: "hurdles", kind: "area", label: "Haies", labelEn: "Hurdles", desc: "Stockage des haies", descEn: "Hurdles storage", color: "#f07c00", w: 44, h: 40, ...at(330, 1180) },
  { id: "entry", kind: "door", label: "Entrée infield", labelEn: "Infield entry", desc: "Entrée de l'infield, à côté de la salle des juges", descEn: "Infield entry, next to the judges' room", color: "#e30613", angle: 180, ...at(640, 848) },
  { id: "room", kind: "mark", label: "Salle des juges", labelEn: "Judges' room", desc: "Salle des juges : salon VIP (niveau 0)", descEn: "Judges' room: VIP lounge (level 0)", color: "#e30613", icon: "", ...at(735, 822) },
  { id: "stand", kind: "mark", label: "Tribune juges", labelEn: "Judges' stand", desc: "Tribune des juges, dans les gradins", descEn: "Judges' stand, in the stands", color: "#c8102e", icon: "", rot: -90, ...at(668, 925) },
  { id: "team-h", kind: "mark", label: "Team haies", labelEn: "Hurdles team", desc: "Équipe haies : local au pied des gradins", descEn: "Hurdles team: room at the foot of the stands", color: "#0f8a5f", icon: "", rot: -90, ...at(690, 1010) },
  { id: "cr1", kind: "mark", label: "CR1", labelEn: "CR1", desc: "Call room 1 et contrôle du poids : dans le warm-up", descEn: "Call room 1 and shot put implement control: in the warm-up", color: "#8e2a8e", icon: "", ...at(120, 905) },
  { id: "cr2", kind: "mark", label: "CR2", labelEn: "CR2", desc: "Call room 2 : au pied des gradins, côté warm-up", descEn: "Call room 2: at the foot of the stands, warm-up side", color: "#8e2a8e", icon: "", ...at(236, 970) },
  { id: "b-60", kind: "mark", label: "Bancs 60 m", labelEn: "Benches 60 m", desc: "Bancs d'attente : 60 m", descEn: "Waiting benches: 60 m", color: "#4a5d6c", icon: "bench", ...at(395, 1140) },
  { id: "b-pole", kind: "mark", label: "Bancs perche", labelEn: "Benches PV", desc: "Bancs d'attente : perche", descEn: "Waiting benches: pole vault", color: "#4a5d6c", icon: "bench", ...at(544, 920) },
  { id: "b-long", kind: "mark", label: "Bancs longueur", labelEn: "Benches LJ/TJ", desc: "Bancs d'attente : longueur / triple", descEn: "Waiting benches: long / triple jump", color: "#4a5d6c", icon: "bench", ...at(466, 880) },
  { id: "b-shot", kind: "mark", label: "Bancs poids", labelEn: "Benches SP", desc: "Bancs d'attente : poids", descEn: "Waiting benches: shot put", color: "#4a5d6c", icon: "bench", ...at(300, 1060) },
  { id: "b-high", kind: "mark", label: "Bancs hauteur", labelEn: "Benches HJ", desc: "Bancs d'attente : hauteur", descEn: "Waiting benches: high jump", color: "#4a5d6c", icon: "bench", ...at(300, 840) },
  { id: "b-out", kind: "mark", label: "Bancs d'attente", labelEn: "Waiting benches", desc: "Bancs d'attente des athlètes, hors de l'infield", descEn: "Athletes' waiting benches, outside the infield", color: "#9157e6", icon: "", ...at(660, 600) },
];

// ─── Lecture prudente (Firestore) ────────────────────────────────────────────

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clampPct = (value) => Math.min(100, Math.max(0, num(value, 50)));

export function normalizeJudgesTeams(list) {
  const seen = new Set();
  const teams = (Array.isArray(list) ? list : JUDGES_DEFAULT_TEAMS)
    .map((raw, index) => ({
      id: String(raw?.id || `team-${index + 1}`).replace(/[^a-z0-9-]/gi, "").slice(0, 40) || `team-${index + 1}`,
      label: String(raw?.label ?? "").slice(0, 40),
      labelEn: String(raw?.labelEn ?? "").slice(0, 40),
      color: /^#[0-9a-f]{6}$/i.test(String(raw?.color || "")) ? raw.color : PLAN_PALETTE[index % PLAN_PALETTE.length],
    }))
    .filter((team) => !seen.has(team.id) && seen.add(team.id));
  return teams;
}

export function normalizeJudgesElements(list, teams) {
  const teamIds = new Set(teams.map((t) => t.id));
  const elements = (Array.isArray(list) ? list : JUDGES_DEFAULT_ELEMENTS)
    .map((raw, index) => {
      const id = String(raw?.id || `el-${index + 1}`);
      if (raw?.kind === "facility") {
        return JUDGES_FACILITIES[raw.facility] ? { id, kind: "facility", facility: raw.facility, hidden: Boolean(raw.hidden) } : null;
      }
      if (raw?.kind === "judge") {
        return {
          id,
          kind: "judge",
          team: teamIds.has(raw.team) ? raw.team : teams[0]?.id || "",
          label: String(raw.label ?? "").slice(0, 3),
          labelEn: String(raw.labelEn ?? "").slice(0, 3),
          desc: String(raw.desc ?? "").slice(0, 80),
          descEn: String(raw.descEn ?? "").slice(0, 80),
          x: clampPct(raw.x),
          y: clampPct(raw.y),
        };
      }
      // Repères, zones, flèches, lignes : mêmes règles que les plans de la Coque (sans niveau ni plans)
      const { maps, level, ...el } = normalizePlanElement(raw, index); // eslint-disable-line no-unused-vars
      if (!["mark", "area", "door", "line"].includes(el.kind)) return null;
      if (el.kind === "area") {
        delete el.shape;
        el.w = Math.max(20, num(raw.w, 76));
        el.h = Math.max(20, num(raw.h, 56));
      }
      return el;
    })
    .filter(Boolean);
  // Une seule aire de chaque sorte ; celles qui manquent reviennent (visibles)
  const seen = new Set();
  const unique = elements.filter((el) => el.kind !== "facility" || (!seen.has(el.facility) && seen.add(el.facility)));
  const missing = Object.keys(JUDGES_FACILITIES).filter((key) => !seen.has(key)).map((key) => ({ id: `fac-${key}`, kind: "facility", facility: key, hidden: false }));
  return [...missing, ...unique];
}

// ─── Textes ──────────────────────────────────────────────────────────────────

export const jText = (item, field, lang) => (lang === "en" && item?.[`${field}En`] ? item[`${field}En`] : item?.[field] || "");
export const teamColor = (teams, id) => teams.find((t) => t.id === id)?.color || "#6b7a86";

// Position en unités du plan (lignes, poignées) et taille d'une zone en % du cadre
export const jPoint = (el) => ({ X: B.x + (el.x / 100) * B.w, Y: B.y + (el.y / 100) * B.h });
export const jAreaSize = (el) => ({ width: `${(el.w / B.w) * 100}%`, height: `${(el.h / B.h) * 100}%` });

