import admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

const REGION = "europe-west1";
const LINEUP_DOC = ["siteContent", "businessRaceLineup"];
const MAX_TEAMS = 10;

// Line-up public de la Business Race pour l'e-magazine : une ligne par équipe
// saisie par les entreprises sur leur portail (vipPartnerPortals/{id}/teams).
// Les équipes ne sont lisibles que par l'organisation ; ce document public
// (siteContent, lecture pour tous) n'en garde que les noms à afficher.
// Mêmes règles que src/app/business-race-helpers.js (équipes 1..N, nom de
// l'équipe sinon celui de l'entreprise).

const clean = (value) => String(value ?? "").trim();
const runnerName = (runner) => [clean(runner?.firstName), clean(runner?.lastName)].filter(Boolean).join(" ");
const runnerFilled = (runner) => Boolean(clean(runner?.firstName) && clean(runner?.lastName));

function teamCount(portal) {
  const count = Math.floor(Number(portal.businessRaceTeams));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, MAX_TEAMS);
}

export function buildBusinessRaceLineup(portals, teamsByPortal) {
  const lineup = [];
  portals
    .filter((portal) => portal.businessRace === true)
    .sort((left, right) => clean(left.organizationName || left.id).localeCompare(clean(right.organizationName || right.id), "fr"))
    .forEach((portal) => {
      const organization = clean(portal.organizationName) || portal.id;
      const count = teamCount(portal);
      const stored = teamsByPortal[portal.id] || [];
      for (let teamNumber = 1; teamNumber <= count; teamNumber += 1) {
        const team = stored.find((item) => Math.floor(Number(item.teamNumber)) === teamNumber) || {};
        const legs = (Array.isArray(team.runners) ? team.runners : []).slice(0, 4).filter(runnerFilled).map(runnerName);
        const teamName = clean(team.teamName);
        // Équipe encore vide (ni nom ni coureur) : pas encore dans le line-up.
        if (!teamName && !legs.length) continue;
        lineup.push({
          id: `br-${portal.id}-${teamNumber}`,
          teamName: teamName || (count > 1 ? `${organization} ${teamNumber}` : organization),
          organization,
          runners: legs,
          reserve: runnerFilled(team.reserve) ? runnerName(team.reserve) : "",
        });
      }
    });
  return lineup;
}

async function rebuildLineup() {
  const db = admin.firestore();
  const [portalsSnapshot, teamsSnapshot] = await Promise.all([
    db.collection("vipPartnerPortals").where("businessRace", "==", true).get(),
    db.collectionGroup("teams").get(),
  ]);
  const portals = portalsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const teamsByPortal = {};
  teamsSnapshot.docs
    .filter((entry) => entry.ref.path.startsWith("vipPartnerPortals/"))
    .forEach((entry) => {
      const portalId = entry.ref.path.split("/")[1] || "";
      (teamsByPortal[portalId] ||= []).push(entry.data());
    });
  const teams = buildBusinessRaceLineup(portals, teamsByPortal);
  await db.doc(LINEUP_DOC.join("/")).set({ teams, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  logger.info("Business Race line-up rebuilt", { teams: teams.length });
}

// Une équipe change (nom, coureurs) → line-up à jour.
export const syncBusinessRaceLineupOnTeam = onDocumentWritten(
  { document: "vipPartnerPortals/{portalId}/teams/{teamId}", region: REGION },
  rebuildLineup,
);

// Une entreprise change (nom, nombre d'équipes, retrait de la Business Race).
export const syncBusinessRaceLineupOnPortal = onDocumentWritten(
  { document: "vipPartnerPortals/{portalId}", region: REGION },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.businessRace !== true && after.businessRace !== true) return;
    const keys = ["businessRace", "businessRaceTeams", "organizationName"];
    if (event.data?.before?.exists && event.data?.after?.exists && keys.every((key) => before[key] === after[key])) return;
    await rebuildLineup();
  },
);
