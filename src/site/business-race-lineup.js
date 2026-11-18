// Business Race dans l'e-magazine : les équipes viennent des portails des
// entreprises (siteContent/businessRaceLineup, tenu à jour par la Cloud
// Function syncBusinessRaceLineup*). Une fiche saisie dans l'e-magazine avec
// le même id (br-…) ajoute couloir, photo, Instagram ou texte ; une fiche br-…
// dont l'équipe n'existe plus est ignorée ; les autres fiches saisies à la main
// restent en plus. Testé dans tests/business-race-lineup.test.js.

const text = (value) => String(value ?? "").trim();

const PARTICIPANT_FIELDS = ["lane", "name", "photoUrl", "instagram", "description", "nationality", "team"];

function toParticipant(participant = {}, index = 0) {
  const result = { id: text(participant.id) || `participant-${index + 1}` };
  PARTICIPANT_FIELDS.forEach((field) => {
    result[field] = text(participant[field]);
  });
  return result;
}

function mergeBusinessRaceLineup(participants = [], lineupTeams = []) {
  const manual = (Array.isArray(participants) ? participants : []).map(toParticipant);
  const manualById = new Map(manual.map((participant) => [participant.id, participant]));
  const fromPortals = (Array.isArray(lineupTeams) ? lineupTeams : [])
    .filter((team) => text(team?.id))
    .map((team) => {
      const extra = manualById.get(text(team.id)) || {};
      const runners = (Array.isArray(team.runners) ? team.runners : []).map(text).filter(Boolean);
      return {
        id: text(team.id),
        lane: extra.lane || "",
        name: text(team.teamName) || text(team.organization),
        photoUrl: extra.photoUrl || "",
        instagram: extra.instagram || "",
        description: extra.description || runners.join(" · "),
        nationality: extra.nationality || "",
        team: text(team.organization),
      };
    });
  const portalIds = new Set(fromPortals.map((entry) => entry.id));
  const manualOnly = manual.filter((participant) => !portalIds.has(participant.id) && !participant.id.startsWith("br-"));
  return [...fromPortals, ...manualOnly];
}

export { mergeBusinessRaceLineup };
