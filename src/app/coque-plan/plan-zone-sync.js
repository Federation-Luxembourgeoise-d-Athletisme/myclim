// Zones du plan de la Coque reliées à la liste des zones des accréditations
// (Margot, 12/11/2026 : « la liste des zones ne devrait pas être reliée à
// l'accréditation ? »). La liste des accréditations (numéro + nom) fait foi :
// un repère « zone » du plan porte un numéro, son nom vient de cette liste.
// Règles pures, testées dans tests/plan-zone-sync.test.js.

// Le nom de chaque repère « zone » suit la zone d'accréditation du même numéro.
// Les noms de zone sont les mêmes en français et en anglais (Infield, Warm-up…) :
// pas de texte anglais à part.
function syncPlanZones(elements = [], zones = []) {
  const byNumber = new Map(zones.map((zone) => [Number(zone.order), zone]));
  return elements.map((element) => {
    if (element.kind !== "zone") return element;
    const zone = byNumber.get(Number(element.num));
    if (!zone) return element;
    if (element.label === zone.name && !element.labelEn) return element;
    return { ...element, label: zone.name, labelEn: "" };
  });
}

// Pour chaque zone : combien de repères la placent sur le plan des badges
// (carte « acc »). Et les repères dont le numéro ne correspond à aucune zone.
function getZonePlacement(elements = [], zones = []) {
  const numbers = new Set(zones.map((zone) => Number(zone.order)));
  const counts = new Map(zones.map((zone) => [Number(zone.order), 0]));
  const orphans = [];
  elements
    .filter((element) => element.kind === "zone" && element.maps?.acc !== false)
    .forEach((element) => {
      const n = Number(element.num);
      if (numbers.has(n)) counts.set(n, counts.get(n) + 1);
      else orphans.push(n);
    });
  return { counts, orphans: [...new Set(orphans)].sort((a, b) => a - b) };
}

export { getZonePlacement, syncPlanZones };
