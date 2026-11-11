// Plan de l'infield pour les juges (Accréditations › Plan juges) : vue rapprochée de la piste de la
// Coque, aires de concours dessinées en détail, position des juges par équipe (ronds de couleur),
// chambres d'appel, scène, haies, entrée de l'infield, salle et tribune des juges, bancs d'attente.
// Même grille que les plans de la Coque (unités du plan, 8,4 unités ≈ 1 m), cadrée sur la piste :
// les aires sont au même endroit que sur la vue d'ensemble. Positions des éléments en % du cadre.
import { lineSvg, normalizePlanElement, PLAN_PALETTE, planBaseSvg } from "./coque-plan-data";

// Cadre (unités du plan) : la piste et une bande autour, au format A4 portrait (≈ 1 : 1,414).
export const JUDGES_BOX = { x: 110, y: 386, w: 620, h: 880 };
const B = JUDGES_BOX;
// Encart « niveau 0 » (arcades) : salle des juges et chambres d'appel ne sont pas au niveau de la piste.
// Même fond que les plans de la Coque, cadré sur le warm-up, la salle et le salon VIP.
export const JUDGES_INSET = { x: 20, y: 560, w: 900, h: 740 };
const I = JUDGES_INSET;
export const JUDGES_LEVELS = { piste: ["Piste (R-1)", "Track (R-1)"], rdc: ["Niveau 0 (arcades)", "Level 0 (arcades)"] };
export const judgesInsetSvg = (lang = "fr") =>
  planBaseSvg({ lang }).replace(/viewBox="[^"]*"/, `viewBox="${I.x} ${I.y} ${I.w} ${I.h}"`);

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

// Fond : sol, piste de 200 m (6 couloirs), infield ; les aires visibles par-dessus.
export function judgesPlanSvg(elements, lang = "fr") {
  const en = lang === "en";
  const oval = (r) => `M${420 - r} 634 A${r} ${r} 0 0 1 ${420 + r} 634 L${420 + r} 1018 A${r} ${r} 0 0 1 ${420 - r} 1018 Z`;
  const facilities = elements
    .filter((el) => el.kind === "facility" && !el.hidden)
    .map((el) => FACILITY_SVG[el.facility]?.(en) || "")
    .join("");
  const lines = elements
    .filter((el) => el.kind === "line")
    .map((el) => lineSvg(el, B.x + (el.x / 100) * B.w, B.y + (el.y / 100) * B.h))
    .join("");
  return `<svg viewBox="${B.x} ${B.y} ${B.w} ${B.h}" preserveAspectRatio="none" aria-hidden="true">
    <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" fill="#f4f6f8" />
    <path d="${oval(205)}" fill="#fff" />
    <path d="${oval(192)}" fill="#8db4de" />
    <path d="${[141, 151, 161, 171, 181].map(oval).join(" ")}" fill="none" stroke="#fff" stroke-width="1.1" stroke-opacity=".9" />
    <path d="${oval(192)} ${oval(131)}" fill="none" stroke="#fff" stroke-width="2.2" />
    <path d="M551 826 H612" stroke="#fff" stroke-width="3" />
    <path d="${oval(131)}" fill="#e9eff5" />
    ${facilities}${lines}
    ${txt(B.x + 10, B.y + 18, en ? "TRACK LEVEL (R-1)" : "NIVEAU PISTE (R-1)", { size: 10, fill: "#9aa8b3", anchor: "start" })}
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
// Niveau 0 : positions en unités des plans de la Coque, dans le cadre de l'encart
const at0 = (X, Y) => ({ level: "rdc", x: Math.round(((X - I.x) / I.w) * 10000) / 100, y: Math.round(((Y - I.y) / I.h) * 10000) / 100 });

export const JUDGES_DEFAULT_ELEMENTS = [
  ...Object.keys(JUDGES_FACILITIES).map((key) => ({ id: `fac-${key}`, kind: "facility", facility: key })),

  judge("start", "S", "Starter", "Starter", 476, 1112),
  judge("start", "R", "Starter de rappel", "Recall starter", 372, 1134),
  judge("start", "A", "Aide-starter", "Starter's assistant", 445, 1140),
  judge("finish", "PF", "Photo-finish", "Photo finish", 468, 590),
  judge("finish", "1", "Juge à l'arrivée", "Finish judge", 360, 586),
  judge("finish", "2", "Juge à l'arrivée", "Finish judge", 360, 608),
  judge("hurdles", "1", "Mise en place des haies", "Hurdle set-up", 214, 1146),
  judge("hurdles", "2", "Mise en place des haies", "Hurdle set-up", 234, 1160),
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
  { ...judge("callroom", "1", "Chambre d'appel 1", "Call room 1", 0, 0), ...at0(212, 760) },
  { ...judge("callroom", "2", "Chambre d'appel 2", "Call room 2", 0, 0), ...at0(212, 900) },
  judge("infield", "M", "Commissaire infield", "Infield marshal", 330, 560),
  judge("infield", "M", "Commissaire infield", "Infield marshal", 510, 560),

  { id: "stage", kind: "area", label: "Scène", labelEn: "Stage", desc: "Scène (présentations, cérémonies)", descEn: "Stage (presentations, ceremonies)", color: "#9157e6", w: 76, h: 150, ...at(680, 826) },
  { id: "stand", kind: "area", label: "Tribune juges", labelEn: "Judges' stand", desc: "Tribune des juges, dans l'axe de l'arrivée", descEn: "Judges' stand, in line with the finish", color: "#0a2540", w: 76, h: 56, ...at(680, 600) },
  { id: "hurdles", kind: "area", label: "Haies", labelEn: "Hurdles", desc: "Stockage des haies", descEn: "Hurdles storage", color: "#f07c00", w: 84, h: 56, ...at(160, 1190) },
  { id: "entry", kind: "door", label: "Entrée infield", labelEn: "Infield entry", desc: "Entrée de l'infield : tunnel depuis le warm-up (niveau 0)", descEn: "Infield entry: tunnel from the warm-up (level 0)", color: "#0f8a5f", angle: 270, ...at(420, 1238) },
  { id: "b-60", kind: "mark", label: "Bancs 60 m", labelEn: "Benches 60 m", desc: "Bancs d'attente : 60 m", descEn: "Waiting benches: 60 m", color: "#4a5d6c", icon: "bench", ...at(395, 1140) },
  { id: "b-pole", kind: "mark", label: "Bancs perche", labelEn: "Benches PV", desc: "Bancs d'attente : perche", descEn: "Waiting benches: pole vault", color: "#4a5d6c", icon: "bench", ...at(544, 920) },
  { id: "b-long", kind: "mark", label: "Bancs longueur", labelEn: "Benches LJ/TJ", desc: "Bancs d'attente : longueur / triple", descEn: "Waiting benches: long / triple jump", color: "#4a5d6c", icon: "bench", ...at(466, 880) },
  { id: "b-shot", kind: "mark", label: "Bancs poids", labelEn: "Benches SP", desc: "Bancs d'attente : poids", descEn: "Waiting benches: shot put", color: "#4a5d6c", icon: "bench", ...at(300, 1060) },
  { id: "b-high", kind: "mark", label: "Bancs hauteur", labelEn: "Benches HJ", desc: "Bancs d'attente : hauteur", descEn: "Waiting benches: high jump", color: "#4a5d6c", icon: "bench", ...at(300, 840) },

  // Niveau 0 (arcades) : dans l'encart
  { id: "room", kind: "mark", label: "Salle des juges", labelEn: "Judges' room", desc: "Salle des juges : salon VIP", descEn: "Judges' room: VIP lounge", color: "#0a2540", icon: "", ...at0(735, 828) },
  { id: "cr1", kind: "mark", label: "CR1", labelEn: "CR1", desc: "Chambre d'appel 1 : warm-up, derrière les gradins", descEn: "Call room 1: warm-up, behind the stands", color: "#6b7a86", icon: "", ...at0(150, 760) },
  { id: "cr2", kind: "mark", label: "CR2", labelEn: "CR2", desc: "Chambre d'appel 2 : warm-up, derrière les gradins", descEn: "Call room 2: warm-up, behind the stands", color: "#6b7a86", icon: "", ...at0(150, 900) },
  { id: "down", kind: "door", label: "Vers la piste", labelEn: "To the track", desc: "Descente vers la piste (tunnel) puis entrée de l'infield", descEn: "Way down to the track (tunnel), then the infield entry", color: "#0f8a5f", angle: 270, ...at0(420, 1250) },
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
          level: raw.level === "rdc" ? "rdc" : "piste",
          x: clampPct(raw.x),
          y: clampPct(raw.y),
        };
      }
      // Repères, zones, flèches, lignes : mêmes règles que les plans de la Coque (sans niveau ni plans)
      const { maps, level, ...el } = normalizePlanElement(raw, index); // eslint-disable-line no-unused-vars
      if (!["mark", "area", "door", "line"].includes(el.kind)) return null;
      // Lignes : seulement au niveau de la piste
      el.level = raw.level === "rdc" && el.kind !== "line" ? "rdc" : "piste";
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
export const jAreaSize = (el) => {
  const box = el.level === "rdc" ? I : B;
  return { width: `${(el.w / box.w) * 100}%`, height: `${(el.h / box.h) * 100}%` };
};
export const jOnTrack = (el) => el.level !== "rdc";
