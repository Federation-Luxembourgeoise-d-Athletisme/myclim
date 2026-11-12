// Liens déjà saisis ailleurs dans MyCLIM, repris par les QR des badges
// (Margot, 12/11/2026 : « les liens doivent être repris des onglets de
// paramétrage où on les met déjà »). L'app fabrique le QR à partir du lien au
// moment de l'impression. Règles pures, testées dans tests/qr-link-sources.test.js.

// Adresse imprimée dans les QR : toujours le site public, même quand l'app
// est ouverte en local (comme le QR de la page liens).
const PUBLIC_SITE_URL = "https://cmcm-luxembourg-indoor-meeting.lu";

const QR_LINK_SOURCES = [
  { key: "results", label: "Résultats live", where: "Site web › Édition › Résultats en direct" },
  { key: "photos", label: "Photos du jour J", where: "Site web › Page liens › Photos" },
  { key: "emagazine", label: "E-magazine", where: "page publique /e-magazine" },
  { key: "athleteRoadbook", label: "Roadbook athlètes", where: "page publique /roadbook" },
  { key: "links", label: "Page liens", where: "page publique /links" },
];

// Source d'une ressource QR enregistrée : celle choisie si elle a été
// enregistrée (même vide = lien saisi à la main) ; sinon, une ressource sans
// lien ni document reprend la source prévue pour elle.
function pickQrSource(resource = {}, plannedSource = "") {
  const stored = typeof resource.source === "string" ? resource.source : undefined;
  const hasOwnTarget = Boolean(String(resource.url || "").trim() || String(resource.documentId || "").trim());
  const candidate = stored !== undefined ? stored : hasOwnTarget ? "" : plannedSource || "";
  return QR_LINK_SOURCES.some((item) => item.key === candidate) ? candidate : "";
}

export { PUBLIC_SITE_URL, QR_LINK_SOURCES, pickQrSource };
