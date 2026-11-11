import meetingLogoPrincipalUrl from "../assets/accreditation-meeting-principal.png";
import sponsorCmcmUrl from "../assets/accreditation-sponsor-cmcm.png";
import sponsorCoqueUrl from "../assets/accreditation-sponsor-coque.png";
import sponsorEuropeanAthleticsUrl from "../assets/accreditation-sponsor-european-athletics.svg";
import sponsorLuxembourgUrl from "../assets/accreditation-sponsor-luxembourg.png";
import sponsorVilleLuxembourgUrl from "../assets/accreditation-sponsor-ville-luxembourg.png";
import flaLogoUrl from "../assets/fla-logo.png";
import meetingLogoSvg from "../assets/meeting-logo-principal.svg?raw";
import waIndoorTourUrl from "../assets/wa-indoor-tour-silver.png";
import { BADGE_CATEGORIES } from "./accreditation-config";
import { PLAN_PRINT_CSS, planBoxHtml } from "./coque-plan/coque-plan-data";

// Badges d'accréditation, design retenu (design/accreditation/maquette-accreditation.html, piste B) :
// 100 x 143,5 mm portrait, 4 par A4 bord à bord dans la zone imprimable (marge 5 mm), coins droits
// (coupe au massicot), haut libre pour le trou du porte-badge.
// Recto : bande verticale de la catégorie, logos, sous-rôle, NOM / prénom, QR codes, partenaires.
// Verso : la même bande, les seules zones autorisées (numéro + nom) et le plan de la Coque
// (Accréditations › Plans) avec ces zones allumées dans la couleur de la catégorie.
// Le verso d'une feuille inverse gauche et droite sur chaque ligne (recto-verso bord long).

const BADGES_PER_SHEET = 4;

const PARTNER_LOGOS = [
  [flaLogoUrl, false],
  [sponsorEuropeanAthleticsUrl, false],
  [sponsorCoqueUrl, false],
  [sponsorVilleLuxembourgUrl, false],
  [sponsorCmcmUrl, true],
  [sponsorLuxembourgUrl, true],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const categoryOf = (key) => BADGE_CATEGORIES.find((category) => category.key === key) || BADGE_CATEGORIES.find((category) => category.key === "volunteer");

// Lion du logo officiel en filigrane, dans la couleur de la catégorie : le rouge et le bleu du logo
// prennent cette couleur, le blanc (lion, dents, yeux) reste blanc.
const LION_PATHS = [...meetingLogoSvg.matchAll(/<path class="(cls-\d)" d="([^"]+)"/g)]
  .map(([, cls, d]) => `<path d="${d}" fill="${cls === "cls-1" ? "#fff" : "currentColor"}" />`)
  .join("");
const lionSvg = (color) => `<svg class="lion" viewBox="0 0 443.44 443.44" style="color:${color}" aria-hidden="true">${LION_PATHS}</svg>`;

// « 1. Infield » → { num: 1, name: "Infield" }
function parseZoneLabel(label) {
  const match = String(label || "").match(/^\s*(\d+)\s*[.)-]?\s*(.*)$/);
  return match ? { num: Number(match[1]), name: match[2].trim() } : { num: null, name: String(label || "").trim() };
}

function renderStrip(category) {
  return `<div class="strip" style="background:${category.color}"><span>${escapeHtml(category.label)}</span></div>`;
}

function renderFront(item) {
  if (!item) return `<div class="badge badge--empty"></div>`;
  const category = categoryOf(item.category);
  const lastName = String(item.lastName || "").trim();
  const nameBlock = item.nominative === false || !lastName
    ? `<div class="last">${escapeHtml(category.label)}</div>`
    : `<div class="last">${escapeHtml(lastName)}</div><div class="first">${escapeHtml(item.firstName)}</div>`;
  const cards = (item.resourceCards || []).filter((card) => card?.src && card?.title).slice(0, 4);
  return `<div class="badge">
    ${renderStrip(category)}
    <div class="bg">${lionSvg(category.color)}</div>
    <div class="main">
      <div class="top"><img class="wa" src="${waIndoorTourUrl}" alt="" /><img class="logo" src="${meetingLogoPrincipalUrl}" alt="" /></div>
      <div class="who">
        <div class="role" style="color:${category.color}">${escapeHtml(item.role || "Accreditation")}</div>
        ${nameBlock}
      </div>
      ${cards.length ? `<div class="qrs">${cards.map((card) => `<div class="qr"><img src="${card.src}" alt="" /><b>${escapeHtml(card.title)}</b>${escapeHtml(card.subtitle || "")}</div>`).join("")}</div>` : ""}
      <div class="partners"${cards.length ? "" : ' style="margin-top:auto"'}><small>Partners</small>
        <div class="partner-logos">${PARTNER_LOGOS.map(([src, zoom]) => `<img src="${src}" alt=""${zoom ? ' class="zoom"' : ""} />`).join("")}</div>
      </div>
    </div>
  </div>`;
}

function renderBack(item, planElements) {
  if (!item) return `<div class="badge badge--empty"></div>`;
  const category = categoryOf(item.category);
  const zones = (item.zoneLabels || []).map(parseZoneLabel);
  const allowed = zones.map((zone) => `<div><i style="background:${category.color}">${zone.num ?? "•"}</i>${escapeHtml(zone.name)}</div>`).join("");
  const access = zones.length
    ? `<div class="allowed${zones.length > 3 ? " compact" : ""}">${allowed}</div>`
    : `<div class="no-zone"><b>No restricted zone</b>Access to public areas and your own post only.</div>`;
  const plan = planElements.length
    ? planBoxHtml(planElements, {
        mapKey: "acc",
        crop: true,
        allowedZones: new Set(zones.map((zone) => zone.num).filter(Number.isFinite)),
        accent: category.color,
        lang: "en",
      })
    : "";
  return `<div class="badge badge--back">
    ${renderStrip(category)}
    <div class="main">
      <div class="h"><b>Access zones</b><span>Coque · Luxembourg</span></div>
      ${access}
      <div class="plan">${plan}</div>
      <div class="rules">Personal, non-transferable badge. Wear it visibly at all times. It may be withdrawn in case of misuse.</div>
    </div>
  </div>`;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

// items : { firstName, lastName, category, role, nominative, zoneLabels: ["1. Infield", …], resourceCards }
function buildAccreditationBadgeMarkup(items, { planElements = [] } = {}) {
  const pages = chunk(items, BADGES_PER_SHEET)
    .map((sheet) => {
      const front = [...sheet, ...Array(BADGES_PER_SHEET - sheet.length).fill(null)];
      // Verso : sur chaque ligne, droite puis gauche, pour retomber derrière le bon recto.
      const back = front.flatMap((_, index) => (index % 2 ? [] : [front[index + 1], front[index]]));
      return `<section class="sheet">${front.map(renderFront).join("")}</section>
        <section class="sheet">${back.map((item) => renderBack(item, planElements)).join("")}</section>`;
    })
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Accreditation badges</title>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@500;600;700&display=swap" rel="stylesheet" />
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Barlow, "Segoe UI", Arial, sans-serif; color: #0b1b2b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet { width: 210mm; height: 297mm; padding: 5mm; display: grid; grid-template-columns: repeat(2, 100mm); grid-auto-rows: 143.5mm; align-content: start; page-break-after: always; break-after: page; }
        .sheet:last-child { page-break-after: auto; break-after: auto; }
        .badge { width: 100mm; height: 143.5mm; overflow: hidden; background: #fff; display: flex; position: relative; outline: .2mm solid #9aa8b3; outline-offset: -.1mm; }
        .badge--empty { outline: none; }
        .strip { width: 17mm; flex: none; color: #fff; display: grid; place-items: center; }
        .strip span { writing-mode: vertical-rl; transform: rotate(180deg); font: 800 30pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        .bg { position: absolute; top: 0; right: 0; bottom: 0; left: 17mm; overflow: hidden; pointer-events: none; }
        .lion { position: absolute; width: 98mm; right: -30mm; top: 46mm; opacity: .09; }
        .main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
        .top { padding: 11mm 4mm 0; display: grid; justify-items: center; gap: 2.5mm; }
        .top .wa { height: 12mm; }
        .top .logo { width: 56mm; height: 21mm; object-fit: contain; }
        .who { padding: 4mm 4mm 0; }
        .role { font: 700 8.5pt/1.1 Barlow, Arial, sans-serif; text-transform: uppercase; letter-spacing: .08em; }
        .last { font: 800 24pt/.9 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; margin-top: 1.5mm; overflow-wrap: anywhere; }
        .first { font: 600 14pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; color: #4a5d6c; }
        .qrs { margin: auto 4mm 3mm; display: flex; justify-content: center; gap: 1.5mm; }
        .qr { width: 15.5mm; text-align: center; font-size: 4.8pt; line-height: 1.1; color: #4a5d6c; }
        .qr img { width: 100%; aspect-ratio: 1; display: block; margin-bottom: .7mm; border: .3mm solid #e3e9ee; border-radius: 1.2mm; padding: .6mm; background: #fff; }
        .qr b { display: block; font-size: 5.6pt; color: #0b1b2b; }
        .partners { background: #fff; padding: 2mm 3mm 2.5mm; border-top: .3mm solid #e3e9ee; }
        .partners small { display: block; text-align: center; font-size: 5pt; letter-spacing: .14em; text-transform: uppercase; color: #8a9aa7; margin-bottom: 1.4mm; }
        .partner-logos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.6mm 2.5mm; align-items: center; }
        .partner-logos img { width: 100%; height: 8mm; object-fit: contain; display: block; }
        .partner-logos img.zoom { transform: scale(1.9); }
        .badge--back .main { padding: 11mm 4mm 4mm; gap: 2.5mm; }
        .h { display: flex; justify-content: space-between; align-items: baseline; border-bottom: .3mm solid #dfe6ec; padding-bottom: 2mm; }
        .h b { font: 800 13pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; }
        .h span { font-size: 5.6pt; color: #6c7f8d; text-transform: uppercase; letter-spacing: .12em; }
        .allowed { display: grid; gap: 1.5mm; }
        .allowed div { display: flex; align-items: center; gap: 2.2mm; font: 700 11pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: .02em; }
        .allowed i { font: 800 13pt/1 "Barlow Condensed", Arial, sans-serif; font-style: normal; width: 7.5mm; height: 7.5mm; border-radius: 1.4mm; display: grid; place-items: center; flex: none; color: #fff; }
        .allowed.compact { grid-template-columns: 1fr 1fr; }
        .allowed.compact div { font-size: 9pt; }
        .allowed.compact i { width: 6mm; height: 6mm; font-size: 11pt; }
        .no-zone { padding: 2.5mm; border-radius: 2mm; background: #f2f5f8; font-size: 7.5pt; line-height: 1.35; color: #4a5d6c; }
        .no-zone b { display: block; font: 800 12pt/1.1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; color: #0b1b2b; margin-bottom: .6mm; }
        .plan { flex: 1; min-height: 0; position: relative; }
        .plan .coque-plan { position: absolute; inset: 0; margin: auto; }
        .rules { font-size: 5pt; color: #6c7f8d; line-height: 1.3; border-top: .3mm solid #dfe6ec; padding-top: 1.5mm; }
        ${PLAN_PRINT_CSS}
      </style>
    </head>
    <body>
      ${pages}
      <script>
        window.onload = () => {
          window.print();
        };
      </script>
    </body>
  </html>`;
}

export { buildAccreditationBadgeMarkup };
