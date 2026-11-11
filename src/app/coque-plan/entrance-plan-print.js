// Impression A4 (portrait) du plan de l'entrée : le plan en grand, la légende, le matériel à prévoir.
import { PLAN_ICONS, planIconSvg } from "./coque-plan-data";
import { entranceLegend, entranceSvg, entranceTotals, entranceTotalsText, UNITS_PER_M } from "./entrance-plan-data";

const esc = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Petite clé de légende (même dessin que sur le plan)
function legendKey(item) {
  if (item.kind === "zone") return `<span class="k k-zone" style="border-color:${item.color};background:${item.color}22"></span>`;
  if (item.kind === "line") {
    const dash = item.style === "separation" ? "3 2" : "";
    const head = item.style === "flow" ? `<path d="M22 5l-5 -3v6z" fill="${item.color}" />` : "";
    return `<svg class="k" viewBox="0 0 24 10"><line x1="1" y1="5" x2="${item.style === "flow" ? 18 : 23}" y2="5" stroke="${item.color}" stroke-width="${item.style === "barrier" ? 2.4 : 1.8}" ${dash ? `stroke-dasharray="${dash}"` : ""} />${head}</svg>`;
  }
  if (PLAN_ICONS[item.icon]) return `<span class="k k-ico" style="background:${item.color}">${planIconSvg(item.icon)}</span>`;
  return `<span class="k k-dot" style="background:${item.color}"></span>`;
}

export function printEntrancePlan(items, { lang = "fr" } = {}) {
  const en = lang === "en";
  const t = (fr, enText) => (en ? enText : fr);
  const legend = entranceLegend(items, lang)
    .map(({ key, item, label, desc }) => `<div class="row" data-key="${esc(key)}">${legendKey(item)}<p><b>${esc(label)}</b>${label && desc ? " — " : ""}${esc(desc)}</p></div>`)
    .join("");
  const totals = entranceTotalsText(entranceTotals(items), lang);
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${t("Plan de l'entrée · Coque", "Entrance plan · Coque")}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;700;800&family=Barlow+Condensed:wght@800&display=swap" />
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Barlow, Arial, sans-serif; color: #0b1b2b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: .5mm solid #0b1b2b; padding-bottom: 2mm; margin-bottom: 3mm; }
      h1 { margin: 0; font: 800 17pt/1 "Barlow Condensed", Arial, sans-serif; letter-spacing: .02em; text-transform: uppercase; }
      header p { margin: 1mm 0 0; font-size: 9pt; color: #4a5d6c; }
      header .tag { font: 800 9pt/1 "Barlow Condensed", Arial, sans-serif; letter-spacing: .12em; color: #c8102e; text-transform: uppercase; }
      .plan { border: .3mm solid #c9d3db; border-radius: 1.5mm; overflow: hidden; }
      .plan svg { display: block; width: 100%; height: auto; max-height: 190mm; }
      .bottom { display: grid; grid-template-columns: 1fr 52mm; gap: 5mm; margin-top: 3mm; }
      .legend { columns: 2; column-gap: 5mm; }
      .row { display: grid; grid-template-columns: 6mm 1fr; gap: 2mm; align-items: start; break-inside: avoid; margin-bottom: 1.4mm; }
      .row p { margin: 0; font-size: 8pt; line-height: 1.3; color: #4a5d6c; }
      .row b { color: #0b1b2b; }
      .k { display: block; width: 6mm; height: 3.4mm; margin-top: .4mm; }
      .k-zone { border: .35mm dashed; border-radius: .6mm; }
      .k-dot { width: 3.4mm; border-radius: 50%; }
      .k-ico { width: 3.6mm; height: 3.6mm; border-radius: 50%; display: grid; place-items: center; }
      .k-ico svg { width: 70%; height: 70%; }
      .kit { background: #f2f5f8; border-radius: 1.5mm; padding: 2.5mm 3mm; font-size: 8.5pt; }
      .kit h2 { margin: 0 0 1.5mm; font: 800 9pt/1 "Barlow Condensed", Arial, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
      .kit ul { margin: 0; padding-left: 3.5mm; }
      .kit li { margin-bottom: .6mm; }
      .note { margin-top: 2mm; font-size: 7pt; color: #8a9aa7; }
    </style></head><body>
    <header>
      <div><div class="tag">CMCM Luxembourg Indoor Meeting</div><h1>${t("Plan de l'entrée", "Entrance plan")}</h1><p>${t("Coque · hall d'entrée, mise en place du jour J", "Coque · entrance hall, meeting-day set-up")}</p></div>
      <p>${t("Files d'attente, accueils, barrières et mobilier", "Queues, welcome desks, barriers and furniture")}</p>
    </header>
    <div class="plan">${entranceSvg(items, { lang })}</div>
    <div class="bottom">
      <div class="legend">${legend}</div>
      <div class="kit">
        <h2>${t("Matériel à prévoir", "Equipment needed")}</h2>
        ${totals.length ? `<ul>${totals.map((part) => `<li>${esc(part)}</li>`).join("")}</ul>` : `<p>${t("Rien de placé.", "Nothing placed.")}</p>`}
        <p class="note">${t(
          `Mobilier dessiné à l'échelle (1 m ≈ ${UNITS_PER_M} unités du plan) ; barrières de 2 m. Échelle approximative, à vérifier sur place.`,
          `Furniture drawn to scale (1 m ≈ ${UNITS_PER_M} plan units); 2 m barriers. Approximate scale, to check on site.`,
        )}</p>
      </div>
    </div>
    <script>window.onload = () => setTimeout(() => window.print(), 500);</${"script"}></body></html>`);
  win.document.close();
}
