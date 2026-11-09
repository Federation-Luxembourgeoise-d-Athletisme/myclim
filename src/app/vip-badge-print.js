import meetingLogoPrincipalUrl from "../assets/accreditation-meeting-principal.png";
import qrEmagazineUrl from "../assets/accreditation-qr-emagazine-athlete.png";
import qrResultsLiveUrl from "../assets/accreditation-qr-results-live-athlete.png";
import qrVipContactUrl from "../assets/accreditation-qr-vip-contact.png";
import sponsorCmcmUrl from "../assets/accreditation-sponsor-cmcm.png";
import sponsorCoqueUrl from "../assets/accreditation-sponsor-coque.png";
import sponsorEuropeanAthleticsUrl from "../assets/accreditation-sponsor-european-athletics.svg";
import sponsorLuxembourgUrl from "../assets/accreditation-sponsor-luxembourg.png";
import sponsorVilleLuxembourgUrl from "../assets/accreditation-sponsor-ville-luxembourg.png";
import flaLogoUrl from "../assets/fla-logo.png";
import waIndoorTourUrl from "../assets/wa-indoor-tour-silver.png";

// Badge VIP, d'après la maquette retenue (design/accreditation, piste B) :
// format réduit 100 x 71,75 mm paysage, 8 par A4, bande dorée « VIP »,
// entreprise + nom, 3 QR codes (e-magazine, résultats live, contact), partenaires.
// Recto et verso identiques : la page verso inverse gauche et droite sur chaque
// ligne pour que chaque badge retombe derrière lui-même (recto-verso bord long).

const VIP_COLOR = "#b8912a";
const BADGES_PER_SHEET = 8;

const VIP_QRS = [
  [qrEmagazineUrl, "E-magazine"],
  [qrResultsLiveUrl, "Live results"],
  [qrVipContactUrl, "Contact"],
];

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

// Une inscription donne un badge, plus un pour l'accompagnant s'il est nommé.
function buildVipBadgeItems(registrations = []) {
  return registrations.flatMap((registration) => {
    const company = String(registration.organization || "").trim();
    const items = [
      {
        registrationId: registration.id,
        company,
        firstName: String(registration.firstName || "").trim(),
        lastName: String(registration.lastName || "").trim(),
      },
    ];
    const guestFirstName = String(registration.guestFirstName || "").trim();
    const guestLastName = String(registration.guestLastName || "").trim();
    if (guestFirstName || guestLastName) {
      items.push({
        registrationId: registration.id,
        company,
        firstName: guestFirstName,
        lastName: guestLastName,
        isGuest: true,
      });
    }
    return items;
  });
}

function renderVipBadge(item, editionYear) {
  if (!item) return `<div class="vip vip--empty"></div>`;
  return `<div class="vip">
    <div class="strip"><span>VIP</span></div>
    <div class="main">
      <div class="head">
        <img class="logo" src="${meetingLogoPrincipalUrl}" alt="" />
        <img class="wa" src="${waIndoorTourUrl}" alt="" />
      </div>
      <div class="event">CMCM Luxembourg Indoor Meeting ${escapeHtml(editionYear)} · Coque</div>
      <div class="body">
        <div class="who">
          ${item.company ? `<div class="company">${escapeHtml(item.company)}</div>` : ""}
          <div class="last">${escapeHtml(item.lastName)}</div>
          <div class="first">${escapeHtml(item.firstName)}</div>
        </div>
        <div class="qrcol">${VIP_QRS.map(
          ([src, title]) => `<div class="qr"><img src="${src}" alt="" /><b>${title}</b></div>`,
        ).join("")}</div>
      </div>
      <div class="partners"><div class="partner-logos">${PARTNER_LOGOS.map(
        ([src, zoom]) => `<img src="${src}" alt=""${zoom ? ' class="zoom"' : ""} />`,
      ).join("")}</div></div>
    </div>
  </div>`;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function buildVipBadgePrintMarkup(items, { editionYear = "" } = {}) {
  const sheets = chunk(items, BADGES_PER_SHEET);
  const pages = sheets
    .map((sheet) => {
      // Verso : sur chaque ligne de deux, droite puis gauche ; une case vide garde la place.
      const back = sheet.flatMap((_, index) => (index % 2 ? [] : [sheet[index + 1] ?? null, sheet[index]]));
      return `<section class="sheet">${sheet.map((item) => renderVipBadge(item, editionYear)).join("")}</section>
        <section class="sheet">${back.map((item) => renderVipBadge(item, editionYear)).join("")}</section>`;
    })
    .join("");

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>Badges VIP</title>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@500;600;700&display=swap" rel="stylesheet" />
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Barlow, "Segoe UI", Arial, sans-serif; color: #0b1b2b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet { width: 210mm; height: 297mm; padding: 5mm; display: grid; grid-template-columns: repeat(2, 100mm); grid-auto-rows: 71.75mm; align-content: start; page-break-after: always; break-after: page; }
        .sheet:last-child { page-break-after: auto; break-after: auto; }
        .vip { width: 100mm; height: 71.75mm; overflow: hidden; background: #fff; display: flex; outline: .2mm solid #9aa8b3; outline-offset: -.1mm; }
        .vip--empty { outline: none; }
        .strip { width: 11mm; flex: none; background: ${VIP_COLOR}; color: #fff; display: grid; place-items: center; }
        .strip span { writing-mode: vertical-rl; transform: rotate(180deg); font: 800 24pt/1 "Barlow Condensed", Arial, sans-serif; letter-spacing: .12em; }
        .main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 8.5mm 3mm 0 3.5mm; }
        .head { display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
        .head .logo { height: 10.5mm; width: auto; }
        .head .wa { height: 9mm; width: auto; }
        .event { font-size: 4.8pt; letter-spacing: .12em; text-transform: uppercase; color: #8a9aa7; margin-top: 1.4mm; }
        .body { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 1.8mm 0 1.6mm; }
        .who { min-width: 0; }
        .company { font: 800 13pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: .04em; color: ${VIP_COLOR}; }
        .last { font: 800 28pt/.9 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; margin-top: 1mm; overflow-wrap: anywhere; }
        .first { font: 600 16pt/1 "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; color: #4a5d6c; }
        .qrcol { display: flex; gap: 2.5mm; }
        .qr { width: 13mm; text-align: center; line-height: 1.1; color: #4a5d6c; }
        .qr img { width: 10.5mm; aspect-ratio: 1; display: block; margin: 0 auto .4mm; padding: .4mm; border: .3mm solid #e3e9ee; border-radius: 1.2mm; background: #fff; }
        .qr b { display: block; font-size: 4.4pt; color: #0b1b2b; }
        .partners { margin: 0 -3mm 0 -3.5mm; padding: 1.4mm 3mm 1.6mm; border-top: .3mm solid #e3e9ee; }
        .partner-logos { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2mm; align-items: center; }
        .partner-logos img { width: 100%; height: 5.5mm; object-fit: contain; display: block; }
        .partner-logos img.zoom { transform: scale(1.9); }
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

export { buildVipBadgeItems, buildVipBadgePrintMarkup };
