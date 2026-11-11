// Impression A4 du plan des juges : une page, le plan à gauche, la légende (juges par équipe,
// repères) à droite. HTML autonome pour une fenêtre d'impression, comme les badges.
import { PLAN_ICONS, planElTransform, planMarkerHtml } from "./coque-plan-data";
import { JUDGES_BOX, JUDGES_FACILITIES, jAreaSize, jText, judgesPlanSvg, teamColor } from "./coque-judges-plan-data";

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const judgeDotHtml = (el, color, lang) => `<span class="cp-judge" style="background:${color}">${esc(jText(el, "label", lang))}</span>`;

// Éléments posés (zones, repères, flèches, juges), en HTML
function itemsHtml(elements, teams, lang) {
  return [
    ...elements.filter((el) => el.kind === "area"),
    ...elements.filter((el) => el.kind === "mark" || el.kind === "door"),
    ...elements.filter((el) => el.kind === "judge"),
  ]
    .map((el) => {
      const size = el.kind === "area" ? jAreaSize(el) : null;
      const turn = planElTransform(el);
      const style = `left:${el.x}%;top:${el.y}%;${size ? `width:${size.width};height:${size.height};` : ""}${turn ? `transform:${turn};` : ""}`;
      const inner = el.kind === "judge" ? judgeDotHtml(el, teamColor(teams, el.team), lang) : planMarkerHtml(el, el.color, lang);
      return `<div class="coque-plan__el" style="${style}">${inner}</div>`;
    })
    .join("");
}

// Le plan seul (fond + éléments), en HTML : sert à l'impression.
export function judgesPlanBoxHtml(elements, teams, lang = "fr") {
  return `<div class="judges-plan"><div class="coque-plan__layer">${judgesPlanSvg(elements, lang)}</div>${itemsHtml(elements, teams, lang)}</div>`;
}

export function judgesPlanPrintHtml(elements, teams, { lang = "fr", title = "", autoPrint = true } = {}) {
  const en = lang === "en";
  const t = (fr, enText) => (en ? enText : fr);
  const teamBlocks = teams
    .map((team) => {
      const judges = elements.filter((el) => el.kind === "judge" && el.team === team.id);
      if (!judges.length) return "";
      return `<section class="jp-team"><h3><span class="jp-swatch" style="background:${team.color}"></span>${esc(jText(team, "label", lang))}<small>${judges.length}</small></h3>
        ${judges.map((el) => `<div class="jp-row">${judgeDotHtml(el, team.color, lang)}<span>${esc(jText(el, "desc", lang))}</span></div>`).join("")}</section>`;
    })
    .join("");
  const seen = new Set();
  const others = elements
    .filter((el) => ["area", "mark", "door", "line"].includes(el.kind) && (el.kind !== "line" || el.label || el.desc))
    .filter((el) => {
      const key = `${el.kind}|${el.label}|${el.desc}|${el.color}|${el.icon || ""}`;
      return !seen.has(key) && seen.add(key);
    })
    .map((el) => {
      const key = el.kind === "line"
        ? `<span class="jp-line" style="border-color:${el.color}"></span>`
        : el.kind === "area"
          ? `<span class="jp-area" style="background:${el.color}1f;border-color:${el.color}"></span>`
          : el.kind === "mark" && !PLAN_ICONS[el.icon]
            ? `<span class="jp-dot" style="background:${el.color}"></span>`
            : planMarkerHtml({ ...el, showText: false }, el.color, lang);
      const label = jText(el, "label", lang);
      const desc = jText(el, "desc", lang);
      return `<div class="jp-row"><span class="jp-key">${key}</span><span><b>${esc(label)}</b>${desc && desc !== label ? ` — ${esc(desc)}` : ""}</span></div>`;
    })
    .join("");
  const facilities = elements
    .filter((el) => el.kind === "facility" && !el.hidden)
    .map((el) => t(JUDGES_FACILITIES[el.facility].label, JUDGES_FACILITIES[el.facility].en))
    .join(" · ");
  const printedOn = new Date().toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const heading = title || t("Plan de l'infield — juges", "Infield plan — judges");

  return `<!doctype html><html lang="${en ? "en" : "fr"}"><head><meta charset="utf-8"><title>${esc(heading)}</title>
<style>
  @page { size: A4 portrait; margin: 9mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 7.4pt/1.3 Arial, "Segoe UI Symbol", sans-serif; color: #0b1b2b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .jp-sheet { width: 192mm; height: 278mm; display: grid; grid-template-rows: auto 1fr; gap: 3mm; margin: 0 auto; }
  .jp-head { display: flex; justify-content: space-between; align-items: end; border-bottom: .5mm solid #0b1b2b; padding-bottom: 1.5mm; }
  .jp-head h1 { margin: 0; font: 800 15pt/1 "Barlow Condensed", Arial, sans-serif; letter-spacing: .02em; text-transform: uppercase; }
  .jp-head p { margin: .8mm 0 0; color: #4a5d6c; }
  .jp-head small { color: #6c7f8d; text-align: right; }
  .jp-main { display: grid; grid-template-columns: 143mm 1fr; gap: 4mm; align-items: start; min-height: 0; }
  .judges-plan { position: relative; width: 100%; aspect-ratio: ${JUDGES_BOX.w} / ${JUDGES_BOX.h}; border: .25mm solid #c9d3db; overflow: hidden; }
  .coque-plan__layer, .coque-plan__layer > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .coque-plan__el { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; }
  .cp-judge { display: grid; place-items: center; min-width: 3.6mm; height: 3.6mm; padding: 0 .5mm; border-radius: 99px; color: #fff; border: .3mm solid #fff; font: 800 6.2pt/1 "Barlow Condensed", Arial, sans-serif; }
  .cp-door, .cp-picto { display: grid; place-items: center; color: #fff; border: .3mm solid #fff; }
  .cp-door { width: 4.2mm; height: 4.2mm; border-radius: 50%; font: 900 7pt/1 Arial, sans-serif; }
  .cp-picto { width: 4mm; height: 4mm; border-radius: 50%; }
  .cp-picto svg { width: 62%; height: 62%; display: block; }
  .cp-pill { display: inline-block; padding: .7mm 1.6mm; border-radius: 99px; color: #fff; font: 700 6pt/1 Arial, sans-serif; border: .3mm solid #fff; }
  .cp-pill--icon { display: inline-flex; align-items: center; gap: .7mm; padding-left: .7mm; }
  .cp-pill__ico { width: 2.8mm; height: 2.8mm; display: grid; place-items: center; }
  .cp-pill__ico svg { width: 100%; height: 100%; display: block; }
  .cp-area { display: grid; place-items: center; width: 100%; height: 100%; border: .35mm dashed; border-radius: 1.2mm; font: 800 6.2pt/1.05 Arial, sans-serif; text-align: center; white-space: normal; }
  .jp-legend { display: grid; align-content: start; gap: 2.2mm; min-width: 0; }
  .jp-legend h2 { margin: 0; font: 800 8pt/1 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #6c7f8d; }
  .jp-team h3 { display: flex; align-items: center; gap: 1.2mm; margin: 0 0 .8mm; font: 800 7.6pt/1.1 Arial, sans-serif; }
  .jp-team h3 small { margin-left: auto; color: #8a9aa7; font-weight: 600; }
  .jp-swatch { width: 2.6mm; height: 2.6mm; border-radius: 50%; flex: none; }
  .jp-row { display: grid; grid-template-columns: 5mm 1fr; gap: 1.2mm; align-items: center; margin: .5mm 0; }
  .jp-row .cp-judge { justify-self: start; }
  .jp-key { display: inline-flex; }
  .jp-key .cp-pill { padding: .6mm 1.2mm; font-size: 5.5pt; }
  .jp-area { width: 4.2mm; height: 3mm; border: .3mm dashed; border-radius: .6mm; }
  .jp-line { width: 4.4mm; border-top: .8mm solid; }
  .jp-foot { color: #6c7f8d; font-size: 6.6pt; margin: 0; }
  .jp-left { display: grid; gap: 2.5mm; align-content: start; }
  .jp-others { display: grid; grid-template-columns: 1fr 1fr; gap: 0 4mm; }
  .jp-dot { width: 3mm; height: 3mm; border-radius: 50%; }
</style></head><body>
<div class="jp-sheet">
  <header class="jp-head"><div><h1>${esc(heading)}</h1><p>CMCM Luxembourg Indoor Meeting · Coque · ${t("niveau 0 et infield", "level 0 and infield")}</p></div><small>${t("Imprimé le", "Printed on")} ${esc(printedOn)}</small></header>
  <main class="jp-main">
    <div class="jp-left">
      ${judgesPlanBoxHtml(elements, teams, lang)}
      ${others ? `<div class="jp-legend"><h2>${t("Repères", "Key")}</h2><div class="jp-others">${others}</div></div>` : ""}
      ${facilities ? `<p class="jp-foot">${t("Aires", "Areas")} : ${esc(facilities)}</p>` : ""}
    </div>
    <aside class="jp-legend">
      <h2>${t("Juges", "Judges")}</h2>
      ${teamBlocks || `<p class="jp-foot">${t("Aucun juge placé.", "No judge placed.")}</p>`}
    </aside>
  </main>
</div>
${autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>` : ""}
</body></html>`;
}
