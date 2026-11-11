// Plan zoomé du hall d'entrée de la Coque (jour J) : files d'attente, accueils, barrières, tables,
// chaises et bancs. Remplace l'affiche « Entrance map » faite à la main l'an dernier.
// Même grille que les plans de la Coque (1020 x 1620, niveau des arcades), cadrée sur le hall :
// les positions sont en unités du plan, pour pouvoir un jour reporter le tout sur le plan général.
import {
  PLAN_ARCADES_PATH,
  PLAN_GYM_EDGE,
  PLAN_GYM_PATH,
  PLAN_HALL_FACADE,
  PLAN_HALL_PATH,
  PLAN_ICONS,
  PLAN_PALETTE,
  planIconSvg,
} from "./coque-plan-data";
import { PLAN_WALLS } from "./coque-plan-walls";

// Cadre du zoom (unités du plan) : le hall, le couloir des WC et le bord des tribunes
export const ENTRANCE_VIEW = { x: 664, y: 568, w: 356, h: 384 };
// Échelle approximative du plan retracé (60 m de sprint ≈ 500 unités) : 1 m ≈ 8 unités.
// Sert à dessiner le mobilier à sa vraie taille et à compter les barrières.
export const UNITS_PER_M = 8;
export const BARRIER_M = 2; // une barrière Vauban = 2 m

const cm = (value) => (value / 100) * UNITS_PER_M;
export const toMeters = (units) => units / UNITS_PER_M;

// Mobilier à l'échelle (cm). count : plusieurs pièces côte à côte (rangée de chaises, tables collées).
export const FURNITURE = {
  table: { label: "Table", en: "Table", plural: "tables", pluralEn: "tables", w: 180, d: 75, gap: 0 },
  chair: { label: "Chaise", en: "Chair", plural: "chaises", pluralEn: "chairs", w: 45, d: 45, gap: 10 },
  bench: { label: "Banc bas", en: "Low bench", plural: "bancs bas", pluralEn: "low benches", w: 300, d: 30, gap: 20 },
  high: { label: "Mange-debout", en: "High table", plural: "mange-debout", pluralEn: "high tables", w: 80, d: 80, gap: 40 },
  rollup: { label: "Roll-up", en: "Roll-up banner", plural: "roll-ups", pluralEn: "roll-ups", w: 85, d: 25, gap: 30 },
};

// Lignes : barrière (Vauban, segments de 2 m), séparation, corde / ruban, sens de circulation
export const ENTRANCE_LINE_STYLES = {
  barrier: { label: "Barrière (2 m)", en: "Barrier (2 m)" },
  separation: { label: "Séparation (pointillés)", en: "Separation (dashed)" },
  rope: { label: "Corde / ruban", en: "Rope / tape" },
  flow: { label: "Sens de passage (flèche)", en: "Walking direction (arrow)" },
};

export const ENTRANCE_KINDS = ["zone", "furniture", "line", "mark"];
export const ENTRANCE_COLORS = PLAN_PALETTE;

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const angle = (value) => {
  const deg = Math.round(num(value, 0));
  return ((((deg + 180) % 360) + 360) % 360) - 180;
};
const text = (value, max) => String(value ?? "").slice(0, max);

// Lecture prudente d'un élément enregistré (Firestore)
export function normalizeEntranceItem(raw = {}, index = 0) {
  const kind = ENTRANCE_KINDS.includes(raw.kind) ? raw.kind : "mark";
  const item = {
    id: String(raw.id || `e-${index + 1}`).slice(0, 40),
    kind,
    label: text(raw.label, 40),
    labelEn: text(raw.labelEn, 40),
    desc: text(raw.desc, 400),
    descEn: text(raw.descEn, 400),
    color: /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? raw.color : "#4a5d6c",
    x: clamp(num(raw.x, 850), 0, 1020),
    y: clamp(num(raw.y, 760), 0, 1620),
  };
  if (kind === "zone") {
    item.w = clamp(num(raw.w, 60), 4, 400);
    item.h = clamp(num(raw.h, 30), 4, 400);
    item.rot = angle(raw.rot);
  }
  if (kind === "furniture") {
    item.type = FURNITURE[raw.type] ? raw.type : "table";
    const def = FURNITURE[item.type];
    item.wCm = clamp(Math.round(num(raw.wCm, def.w)), 10, 1000);
    item.dCm = clamp(Math.round(num(raw.dCm, def.d)), 10, 400);
    item.count = clamp(Math.round(num(raw.count, 1)), 1, 30);
    item.rot = angle(raw.rot);
  }
  if (kind === "line") {
    item.style = ENTRANCE_LINE_STYLES[raw.style] ? raw.style : "barrier";
    item.dx = clamp(num(raw.dx, 24), -400, 400);
    item.dy = clamp(num(raw.dy, 0), -400, 400);
  }
  if (kind === "mark") {
    item.icon = PLAN_ICONS[raw.icon] ? raw.icon : "";
    item.showText = item.icon ? Boolean(raw.showText) : true;
    item.rot = angle(raw.rot);
  }
  return item;
}

export const normalizeEntranceItems = (list) =>
  (Array.isArray(list) ? list : []).map((item, index) => normalizeEntranceItem(item, index));

export const entranceLabel = (item, lang = "fr") => (lang === "en" && item.labelEn ? item.labelEn : item.label);
export const entranceDesc = (item, lang = "fr") => (lang === "en" && item.descEn ? item.descEn : item.desc);

// Longueur d'une ligne (m) et nombre de barrières de 2 m pour la couvrir
export const lineMeters = (item) => toMeters(2 * Math.hypot(item.dx, item.dy));
export const barrierCount = (item) => Math.max(1, Math.ceil(lineMeters(item) / BARRIER_M - 0.15));
// Taille réelle d'une rangée de mobilier (unités du plan)
export const furnitureSize = (item) => {
  const def = FURNITURE[item.type];
  return { w: cm(item.wCm * item.count + def.gap * (item.count - 1)), d: cm(item.dCm) };
};

// ─── Plan de départ (à ajuster) : trois files depuis les portes, trois accueils ─────────────
const VIP = "#b8912a";
const STAFF = "#27a9e1";
const MAIN = "#0f8a5f";
const KIDS = "#f07c00";
const GREY = "#4a5d6c";
export const ENTRANCE_DEFAULT_ITEMS = [
  { id: "q-main", kind: "zone", label: "Main entrance", labelEn: "Main entrance", desc: "File du public : billets contrôlés à l'entrée, puis info et vestiaire", descEn: "Public queue: tickets checked at the door, then info and cloakroom", color: MAIN, x: 968, y: 790, w: 62, h: 44 },
  { id: "q-vip", kind: "zone", label: "VIP entrance", labelEn: "VIP entrance", desc: "Invités VIP : sur la liste, retrait du badge à l'accueil VIP", descEn: "VIP guests: on the guest list, badge collected at the VIP welcome", color: VIP, x: 968, y: 826, w: 62, h: 22 },
  { id: "q-staff", kind: "zone", label: "Volunteers · Judges · Press", labelEn: "Volunteers · Judges · Press", desc: "Bénévoles, juges et presse : retrait des badges à leur accueil", descEn: "Volunteers, judges and press: badges collected at their welcome desk", color: STAFF, x: 968, y: 850, w: 62, h: 22 },
  { id: "b-1", kind: "line", style: "barrier", label: "Barrière", labelEn: "Barrier", color: GREY, x: 968, y: 815, dx: 31, dy: 0 },
  { id: "b-2", kind: "line", style: "barrier", label: "Barrière", labelEn: "Barrier", color: GREY, x: 968, y: 838, dx: 31, dy: 0 },
  { id: "b-3", kind: "line", style: "barrier", label: "Barrière", labelEn: "Barrier", color: GREY, x: 968, y: 862, dx: 31, dy: 0 },
  { id: "f-main", kind: "line", style: "flow", label: "", color: MAIN, x: 975, y: 790, dx: -14, dy: 0 },
  { id: "f-vip", kind: "line", style: "flow", label: "", color: VIP, x: 975, y: 826, dx: -14, dy: 0 },
  { id: "f-staff", kind: "line", style: "flow", label: "", color: STAFF, x: 975, y: 850, dx: -14, dy: 0 },

  { id: "w-vip", kind: "mark", label: "VIP welcome", labelEn: "VIP welcome", desc: "Accueil VIP : liste des invités, badges VIP", descEn: "VIP welcome: guest list, VIP badges", icon: "vip", showText: true, color: VIP, x: 800, y: 842 },
  { id: "t-vip", kind: "furniture", type: "table", count: 2, x: 800, y: 858, rot: 0 },
  { id: "c-vip", kind: "furniture", type: "chair", count: 3, x: 800, y: 868, rot: 0 },
  { id: "w-staff", kind: "mark", label: "Volunteers · Judges · Press", labelEn: "Volunteers · Judges · Press", desc: "Accueil bénévoles, juges et presse : retrait des badges", descEn: "Volunteers, judges and press welcome: badge collection", color: STAFF, x: 884, y: 843 },
  { id: "t-staff", kind: "furniture", type: "table", count: 2, x: 893, y: 858, rot: 22 },
  { id: "c-staff", kind: "furniture", type: "chair", count: 3, x: 890, y: 866, rot: 22 },

  { id: "z-kids", kind: "zone", label: "Kids race · U12-U14", labelEn: "Kids race · U12-U14", desc: "Accueil Kids race et U12-U14 : appel, dossards, attente sur les bancs", descEn: "Kids race and U12-U14 welcome: call, bibs, waiting on the benches", color: KIDS, x: 840, y: 790, w: 66, h: 48 },
  { id: "t-kids", kind: "furniture", type: "table", count: 1, x: 840, y: 774, rot: 0 },
  { id: "c-kids", kind: "furniture", type: "chair", count: 2, x: 840, y: 766, rot: 180 },
  { id: "bn-1", kind: "furniture", type: "bench", count: 1, x: 840, y: 796, rot: 0 },
  { id: "bn-2", kind: "furniture", type: "bench", count: 1, x: 840, y: 806, rot: 0 },

  { id: "m-info", kind: "mark", label: "Info", labelEn: "Info", desc: "Point info : objets trouvés, secours", descEn: "Info point: lost property, first aid", icon: "info", color: MAIN, x: 900, y: 762 },
  { id: "m-tickets", kind: "mark", label: "Billetterie", labelEn: "Tickets", desc: "Caisse et contrôle des billets", descEn: "Ticket office and ticket check", icon: "ticket", showText: true, color: MAIN, x: 860, y: 690 },
].map(normalizeEntranceItem);

// ─── Dessin (SVG en texte : le même pour l'éditeur et l'impression) ─────────────────────────

const esc = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v) => Math.round(v * 10) / 10;

let baseCount = 0;
export function entranceBaseSvgInner({ lang = "fr", grid = false } = {}) {
  const en = lang === "en";
  const { x, y, w, h } = ENTRANCE_VIEW;
  const n = ++baseCount;
  const hatch = `ep-hatch-${n}`;
  const label = (lx, ly, txt, size = 9, fill = "#8a9aa7") =>
    `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="1.2" fill="${fill}">${txt}</text>`;
  let gridSvg = "";
  if (grid) {
    const lines = [];
    const step = UNITS_PER_M;
    for (let gx = Math.ceil(x / step) * step; gx <= x + w; gx += step) lines.push(`M${gx} ${y}V${y + h}`);
    for (let gy = Math.ceil(y / step) * step; gy <= y + h; gy += step) lines.push(`M${x} ${gy}H${x + w}`);
    gridSvg = `<path d="${lines.join("")}" stroke="#0d8fd3" stroke-opacity=".12" stroke-width=".4" fill="none" />`;
  }
  // Barre d'échelle 5 m, en bas à gauche
  const sx = x + 8;
  const sy = y + h - 8;
  const s5 = 5 * UNITS_PER_M;
  const scale = `<g font-family="Barlow, Arial, sans-serif" font-size="5.5" font-weight="700" fill="#4a5d6c">
      <rect x="${sx - 3}" y="${sy - 10}" width="${s5 + 18}" height="14" rx="2" fill="#fff" fill-opacity=".85" />
      <path d="M${sx} ${sy - 2}v3h${s5}v-3" fill="none" stroke="#4a5d6c" stroke-width=".9" />
      <path d="M${sx + s5 / 5} ${sy}v1M${sx + (2 * s5) / 5} ${sy}v1M${sx + (3 * s5) / 5} ${sy}v1M${sx + (4 * s5) / 5} ${sy}v1" stroke="#4a5d6c" stroke-width=".6" />
      <text x="${sx + s5 + 3}" y="${sy + 1}">5 m</text>
    </g>`;
  return `<defs><pattern id="${hatch}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d3dae0" stroke-width="1.6" /></pattern></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" />
    <path d="${PLAN_GYM_PATH}" fill="url(#${hatch})" />
    <path d="${PLAN_ARCADES_PATH}" fill="#eef1f4" />
    <path d="${PLAN_HALL_PATH}" fill="#f7f9fa" />
    <path d="M682 568 L682 952" stroke="#c9d3db" stroke-width="10" />
    ${gridSvg}
    <path d="${PLAN_WALLS}" fill="none" stroke="#4a5d6c" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" />
    <path d="${PLAN_HALL_FACADE}" fill="none" stroke="#5f6f7c" stroke-width="2.4" stroke-linejoin="round" />
    <path d="${PLAN_GYM_EDGE}" fill="none" stroke="#5f6f7c" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    ${label(960, 600, en ? "GYM" : "GYMNASE", 10, "#a9b5be")}
    ${label(860, 652, en ? "ENTRANCE HALL" : "HALL D'ENTRÉE", 9)}
    <text x="676" y="${y + h / 2}" transform="rotate(-90 676 ${y + h / 2})" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="7" letter-spacing="1.5" fill="#8a9aa7">${en ? "STANDS · TRACK" : "TRIBUNES · PISTE"}</text>
    <text x="1013" y="830" transform="rotate(90 1013 830)" text-anchor="middle" font-family="Barlow Condensed, Arial, sans-serif" font-weight="800" font-size="6.5" letter-spacing="1.5" fill="#0f8a5f">${en ? "OUTSIDE ▸ DOORS" : "EXTÉRIEUR ▸ PORTES"}</text>
    ${scale}`;
}

// Icône de la bibliothèque des plans, posée dans le SVG (carré de côté size, centré sur cx, cy)
const iconAt = (name, cx, cy, size) =>
  planIconSvg(name).replace("<svg ", `<svg x="${r1(cx - size / 2)}" y="${r1(cy - size / 2)}" width="${r1(size)}" height="${r1(size)}" `);

// Pastille (étiquette) en SVG : fond de couleur, texte blanc. La largeur est estimée, textLength
// la fait tomber juste quelle que soit la police.
function pillSvg(item, label, { size = 6 } = {}) {
  const hasIcon = Boolean(PLAN_ICONS[item.icon]);
  const iconOnly = hasIcon && !item.showText;
  const r = size * 0.95;
  if (iconOnly) {
    return `<circle r="${r + 0.9}" fill="#fff" /><circle r="${r}" fill="${item.color}" />
      ${iconAt(item.icon, 0, 0, r * 1.3)}`;
  }
  const tw = Math.max(size, label.length * size * 0.5);
  const pad = size * 0.55;
  const iw = hasIcon ? size * 1.25 : 0;
  const width = tw + pad * 2 + iw;
  const height = size * 1.75;
  const x0 = -width / 2;
  const icon = hasIcon
    ? iconAt(item.icon, x0 + pad * 0.6 + size * 0.6, 0, size * 1.15)
    : "";
  return `<rect x="${r1(x0)}" y="${r1(-height / 2)}" width="${r1(width)}" height="${r1(height)}" rx="${r1(height / 2)}" fill="${item.color}" stroke="#fff" stroke-width=".8" />
    ${icon}<text x="${r1(x0 + pad + iw + tw / 2)}" y="${r1(size * 0.36)}" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff" textLength="${r1(tw)}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>`;
}

function furnitureSvg(item) {
  const def = FURNITURE[item.type];
  const pw = cm(item.wCm);
  const pd = cm(item.dCm);
  const gap = cm(def.gap);
  const total = pw * item.count + gap * (item.count - 1);
  const pieces = [];
  for (let i = 0; i < item.count; i += 1) {
    const px = -total / 2 + i * (pw + gap);
    if (item.type === "chair") {
      // Assise + dossier (côté haut = derrière la personne)
      pieces.push(`<rect x="${r1(px)}" y="${r1(-pd / 2)}" width="${r1(pw)}" height="${r1(pd)}" rx=".5" fill="#dfe5ea" stroke="#4a5d6c" stroke-width=".45" /><rect x="${r1(px)}" y="${r1(-pd / 2)}" width="${r1(pw)}" height="${r1(pd * 0.22)}" fill="#4a5d6c" />`);
    } else if (item.type === "high") {
      pieces.push(`<ellipse cx="${r1(px + pw / 2)}" cy="0" rx="${r1(pw / 2)}" ry="${r1(pd / 2)}" fill="#fff" stroke="#4a5d6c" stroke-width=".6" /><circle cx="${r1(px + pw / 2)}" cy="0" r=".7" fill="#4a5d6c" />`);
    } else if (item.type === "bench") {
      pieces.push(`<rect x="${r1(px)}" y="${r1(-pd / 2)}" width="${r1(pw)}" height="${r1(pd)}" rx=".4" fill="#d9b27c" stroke="#8a6a3a" stroke-width=".45" />`);
    } else if (item.type === "rollup") {
      pieces.push(`<rect x="${r1(px)}" y="${r1(-pd / 2)}" width="${r1(pw)}" height="${r1(pd)}" fill="#0a2540" />`);
    } else {
      pieces.push(`<rect x="${r1(px)}" y="${r1(-pd / 2)}" width="${r1(pw)}" height="${r1(pd)}" fill="#fff" stroke="#4a5d6c" stroke-width=".6" />`);
    }
  }
  return pieces.join("");
}

function lineSvg(item) {
  const x1 = r1(item.x - item.dx);
  const y1 = r1(item.y - item.dy);
  const x2 = r1(item.x + item.dx);
  const y2 = r1(item.y + item.dy);
  const seg = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
  const len = 2 * Math.hypot(item.dx, item.dy) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  if (item.style === "separation") return `<line ${seg} stroke="${item.color}" stroke-width="1.4" stroke-dasharray="4 3" stroke-linecap="round" />`;
  if (item.style === "rope") {
    return `<line ${seg} stroke="${item.color}" stroke-width=".9" /><circle cx="${x1}" cy="${y1}" r="1.6" fill="${item.color}" /><circle cx="${x2}" cy="${y2}" r="1.6" fill="${item.color}" />`;
  }
  if (item.style === "flow") {
    const head = 4.5;
    const bx = x2 - ux * head;
    const by = y2 - uy * head;
    const nx = -uy * head * 0.6;
    const ny = ux * head * 0.6;
    return `<line x1="${x1}" y1="${y1}" x2="${r1(bx)}" y2="${r1(by)}" stroke="${item.color}" stroke-width="1.8" stroke-linecap="round" />
      <path d="M${x2} ${y2}L${r1(bx + nx)} ${r1(by + ny)}L${r1(bx - nx)} ${r1(by - ny)}Z" fill="${item.color}" />`;
  }
  // Barrière : un trait épais, un pied à chaque jonction (une barrière = 2 m)
  const count = barrierCount(item);
  const nx = -uy * 1.8;
  const ny = ux * 1.8;
  const feet = [];
  for (let i = 0; i <= count; i += 1) {
    const t = Math.min(len, (i * len) / count);
    const fx = x1 + ux * t;
    const fy = y1 + uy * t;
    feet.push(`M${r1(fx - nx)} ${r1(fy - ny)}L${r1(fx + nx)} ${r1(fy + ny)}`);
  }
  return `<line ${seg} stroke="${item.color}" stroke-width="1.6" stroke-linecap="butt" /><path d="${feet.join("")}" stroke="${item.color}" stroke-width=".9" />`;
}

function zoneSvg(item, lang) {
  const label = entranceLabel(item, lang);
  // Taille du texte : jusqu'à 6, réduite pour tenir dans la largeur de la zone
  const fs = Math.max(2.6, Math.min(6, (item.w - 4.4) / (Math.max(4, label.length) * 0.52), item.h * 0.45));
  return `<rect x="${r1(-item.w / 2)}" y="${r1(-item.h / 2)}" width="${item.w}" height="${item.h}" rx="1.5" fill="${item.color}22" stroke="${item.color}" stroke-width=".9" stroke-dasharray="3 2" />
    ${label ? `<text x="${r1(-item.w / 2 + 2.2)}" y="${r1(-item.h / 2 + fs + 1.4)}" font-family="Barlow, Arial, sans-serif" font-weight="800" font-size="${r1(fs)}" fill="${item.color}">${esc(label)}</text>` : ""}`;
}

// Un élément, avec data-id pour l'éditeur (clic, glisser)
export function entranceItemSvg(item, { lang = "fr", selected = false } = {}) {
  const sel = selected ? ` class="is-selected"` : "";
  if (item.kind === "line") {
    const hit = `<line x1="${r1(item.x - item.dx)}" y1="${r1(item.y - item.dy)}" x2="${r1(item.x + item.dx)}" y2="${r1(item.y + item.dy)}" stroke="transparent" stroke-width="7" />`;
    return `<g data-id="${esc(item.id)}"${sel}>${hit}${lineSvg(item)}</g>`;
  }
  const rot = item.rot ? ` rotate(${item.rot})` : "";
  const transform = `translate(${r1(item.x)} ${r1(item.y)})${rot}`;
  if (item.kind === "zone") return `<g data-id="${esc(item.id)}"${sel} transform="${transform}">${zoneSvg(item, lang)}</g>`;
  if (item.kind === "furniture") return `<g data-id="${esc(item.id)}"${sel} transform="${transform}">${furnitureSvg(item)}</g>`;
  return `<g data-id="${esc(item.id)}"${sel} transform="${transform}">${pillSvg(item, entranceLabel(item, lang))}</g>`;
}

const ORDER = { zone: 0, furniture: 1, line: 2, mark: 3 };
export const sortEntranceItems = (items) => [...items].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

// Le plan complet (fond + éléments). selectedId : contour de sélection (éditeur seulement).
export function entranceSvg(items, { lang = "fr", grid = false, selectedId = null, extra = "" } = {}) {
  const { x, y, w, h } = ENTRANCE_VIEW;
  const body = sortEntranceItems(items).map((item) => entranceItemSvg(item, { lang, selected: item.id === selectedId })).join("");
  return `<svg class="entrance-plan__svg" viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${entranceBaseSvgInner({ lang, grid })}${body}${extra}</svg>`;
}

// ─── Légende et matériel ──────────────────────────────────────────────────────────────────

// Une ligne par texte (doublons regroupés) : files et zones, accueils et repères, lignes nommées
export function entranceLegend(items, lang = "fr") {
  const seen = new Set();
  const rows = [];
  for (const item of sortEntranceItems(items)) {
    if (item.kind === "furniture") continue;
    const label = entranceLabel(item, lang);
    const desc = entranceDesc(item, lang);
    if (!label && !desc) continue;
    if (item.kind === "line" && !desc) continue;
    const key = `${item.kind}|${label}|${desc}|${item.color}|${item.style || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, item, label, desc });
  }
  return rows;
}

// Matériel à prévoir : mobilier compté pièce par pièce, barrières de 2 m, mètres de corde
export function entranceTotals(items) {
  const furniture = Object.fromEntries(Object.keys(FURNITURE).map((key) => [key, 0]));
  let barriers = 0;
  let barrierM = 0;
  let ropeM = 0;
  for (const item of items) {
    if (item.kind === "furniture") furniture[item.type] += item.count;
    if (item.kind === "line" && item.style === "barrier") {
      barriers += barrierCount(item);
      barrierM += lineMeters(item);
    }
    if (item.kind === "line" && item.style === "rope") ropeM += lineMeters(item);
  }
  return { furniture, barriers, barrierM: Math.round(barrierM), ropeM: Math.round(ropeM) };
}

export function entranceTotalsText(totals, lang = "fr") {
  const en = lang === "en";
  const parts = Object.entries(totals.furniture)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${n > 1 ? (en ? FURNITURE[key].pluralEn : FURNITURE[key].plural) : (en ? FURNITURE[key].en : FURNITURE[key].label).toLowerCase()}`);
  if (totals.barriers) parts.push(`${totals.barriers} ${en ? "barriers" : "barrières"} (${totals.barrierM} m)`);
  if (totals.ropeM) parts.push(`${totals.ropeM} m ${en ? "of rope / tape" : "de corde / ruban"}`);
  return parts;
}

export const ENTRANCE_NEW_COLOR = PLAN_PALETTE[2];
