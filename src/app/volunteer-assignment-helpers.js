// Équipes & affectations › Affectations : règles pures (sans Firebase) de
// l'écran unique d'affectation, testées dans
// tests/volunteer-assignment-helpers.test.js.
//
// Décisions de Margot (09/11/2026) :
//  - affecter (ou changer d'équipe) passe le dossier à « Affecté » ; l'e-mail
//    d'affectation envoyé le passe à « Informé » ;
//  - un bénévole peut être dans plusieurs équipes ;
//  - on suggère les équipes qui correspondent aux préférences et aux langues ;
//  - une équipe sans chef est signalée.

const TEAM_LEAD_ROLE = "Chef d'équipe";
const REPLACEMENT_ROLE = "Remplaçant";
const DEFAULT_MEMBER_ROLE = "Bénévole";

function cleanList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sameName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function getAssignedTeams(volunteer = {}) {
  return cleanList(
    Array.isArray(volunteer.assignedRoles)
      ? volunteer.assignedRoles
      : volunteer.assignedRole
        ? [volunteer.assignedRole]
        : [],
  );
}

function getMemberRole(volunteer = {}, teamName) {
  const assignments =
    volunteer.teamRoleAssignments && typeof volunteer.teamRoleAssignments === "object"
      ? volunteer.teamRoleAssignments
      : {};
  const key = Object.keys(assignments).find((name) => sameName(name, teamName));
  return String((key && assignments[key]) || DEFAULT_MEMBER_ROLE);
}

function isCancelled(volunteer = {}) {
  return volunteer.workflowStatus === "Annulé";
}

// Statut du dossier après un changement d'équipes : plus d'équipe → retour à
// « Candidature reçue », sinon « Affecté » (l'e-mail est à renvoyer).
function getStatusAfterTeamChange(volunteer, nextTeams) {
  if (isCancelled(volunteer)) return "Annulé";
  return nextTeams.length ? "Affecté" : "Candidature reçue";
}

function getStatusAfterInform(volunteer) {
  return isCancelled(volunteer) ? "Annulé" : "Informé";
}

// Patch de candidature quand on ajoute / retire une équipe. La fonction de
// chaque équipe restante est conservée ; la nouvelle équipe démarre en
// « Bénévole ». L'équipe principale (assignedRole) reste la première.
function buildTeamChangePatch(volunteer, nextTeams, extra = {}) {
  const teams = cleanList(nextTeams);
  const teamRoleAssignments = teams.reduce((accumulator, teamName) => {
    accumulator[teamName] = getMemberRole(volunteer, teamName);
    return accumulator;
  }, {});
  const primaryTeam = teams[0] || "";
  return {
    assignedRole: primaryTeam,
    assignedRoles: teams,
    teamRoleAssignments,
    teamRole: primaryTeam ? teamRoleAssignments[primaryTeam] : DEFAULT_MEMBER_ROLE,
    workflowStatus: getStatusAfterTeamChange(volunteer, teams),
    teamEmailSent: false,
    ...extra,
  };
}

function buildAddTeamPatch(volunteer, teamName) {
  const current = getAssignedTeams(volunteer);
  if (current.some((name) => sameName(name, teamName))) return null;
  return buildTeamChangePatch(volunteer, [...current, teamName]);
}

function buildRemoveTeamPatch(volunteer, teamName) {
  const current = getAssignedTeams(volunteer);
  if (!current.some((name) => sameName(name, teamName))) return null;
  return buildTeamChangePatch(
    volunteer,
    current.filter((name) => !sameName(name, teamName)),
  );
}

// Changer seulement la fonction (bénévole, chef, remplaçant…) est une
// correction mineure : le statut et l'état « informé » ne bougent pas.
function buildMemberRolePatch(volunteer, teamName, memberRole) {
  const teams = getAssignedTeams(volunteer);
  const teamRoleAssignments = teams.reduce((accumulator, name) => {
    accumulator[name] = sameName(name, teamName) ? memberRole : getMemberRole(volunteer, name);
    return accumulator;
  }, {});
  const primaryTeam = teams[0] || "";
  return {
    teamRoleAssignments,
    teamRole: primaryTeam ? teamRoleAssignments[primaryTeam] : DEFAULT_MEMBER_ROLE,
  };
}

function needsInforming(volunteer = {}) {
  return !isCancelled(volunteer) && getAssignedTeams(volunteer).length > 0 && !volunteer.teamEmailSent;
}

// Composition et écarts de chaque équipe, calculés depuis les candidatures
// (la source de vérité des affectations).
function buildTeamBoard(teams = [], volunteers = []) {
  const active = volunteers.filter((volunteer) => !isCancelled(volunteer));
  return teams.map((team) => {
    const members = active
      .filter((volunteer) => getAssignedTeams(volunteer).some((name) => sameName(name, team.roleName)))
      .map((volunteer) => ({ volunteer, memberRole: getMemberRole(volunteer, team.roleName) }))
      .sort(
        (left, right) =>
          Number(right.memberRole === TEAM_LEAD_ROLE) - Number(left.memberRole === TEAM_LEAD_ROLE) ||
          `${left.volunteer.lastName} ${left.volunteer.firstName}`.localeCompare(
            `${right.volunteer.lastName} ${right.volunteer.firstName}`,
            "fr",
          ),
      );
    const placed = members.filter((member) => member.memberRole !== REPLACEMENT_ROLE).length;
    const leads = members.filter((member) => member.memberRole === TEAM_LEAD_ROLE).length;
    const needed = Number(team.neededCount) || 0;
    const expectedLeads = Number.isFinite(Number(team.expectedLeadCount)) ? Number(team.expectedLeadCount) : 1;
    return {
      team,
      members,
      placed,
      needed,
      missing: Math.max(needed - placed, 0),
      leads,
      missingLead: expectedLeads > 0 && leads < expectedLeads,
      toInform: members.filter((member) => needsInforming(member.volunteer)).length,
    };
  });
}

// Équipes suggérées pour un bénévole : préférence exprimée (+2), toutes les
// langues demandées par l'équipe parlées (+1), place encore libre (+1). Les
// équipes où il est déjà sont exclues ; une équipe qui ne correspond ni aux
// préférences ni aux langues n'est pas suggérée.
function suggestTeams(volunteer, board, limit = 3) {
  const assigned = getAssignedTeams(volunteer);
  const preferences = cleanList(volunteer?.missionPreferences);
  const languages = cleanList(volunteer?.languages).map((language) => language.toLowerCase());
  return board
    .filter((entry) => !assigned.some((name) => sameName(name, entry.team.roleName)))
    .map((entry) => {
      const required = cleanList(entry.team.requiredLanguages).map((language) => language.toLowerCase());
      const prefers = preferences.some((name) => sameName(name, entry.team.roleName));
      const speaks = required.length > 0 && required.every((language) => languages.includes(language));
      const score = (prefers ? 2 : 0) + (speaks ? 1 : 0);
      return { entry, prefers, speaks, score: score > 0 && entry.missing > 0 ? score + 1 : score };
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.missing - left.entry.missing)
    .slice(0, limit)
    .map(({ entry, prefers, speaks }) => ({ teamName: entry.team.roleName, prefers, speaks }));
}

export {
  DEFAULT_MEMBER_ROLE,
  REPLACEMENT_ROLE,
  TEAM_LEAD_ROLE,
  buildAddTeamPatch,
  buildMemberRolePatch,
  buildRemoveTeamPatch,
  buildTeamBoard,
  getAssignedTeams,
  getMemberRole,
  getStatusAfterInform,
  needsInforming,
  suggestTeams,
};
