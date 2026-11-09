import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAddTeamPatch,
  buildMemberRolePatch,
  buildRemoveTeamPatch,
  buildTeamBoard,
  getStatusAfterInform,
  needsInforming,
  suggestTeams,
} from '../src/app/volunteer-assignment-helpers.js';

const teams = [
  { id: 'a', roleName: 'Accueil', neededCount: 2, expectedLeadCount: 1, requiredLanguages: ['Français', 'Anglais'] },
  { id: 'c', roleName: 'Call room', neededCount: 1, expectedLeadCount: 1, requiredLanguages: ['Anglais'] },
  { id: 'w', roleName: 'Warm-up', neededCount: 3, expectedLeadCount: 0, requiredLanguages: [] },
];

test('adding a first team sets Affecté and asks for the email again', () => {
  const patch = buildAddTeamPatch({ workflowStatus: 'Candidature reçue' }, 'Accueil');
  assert.equal(patch.workflowStatus, 'Affecté');
  assert.equal(patch.teamEmailSent, false);
  assert.deepEqual(patch.assignedRoles, ['Accueil']);
  assert.equal(patch.teamRoleAssignments.Accueil, 'Bénévole');
});

test('a second team keeps the first team and its function', () => {
  const volunteer = {
    workflowStatus: 'Informé',
    teamEmailSent: true,
    assignedRoles: ['Accueil'],
    teamRoleAssignments: { Accueil: "Chef d'équipe" },
  };
  const patch = buildAddTeamPatch(volunteer, 'Warm-up');
  assert.deepEqual(patch.assignedRoles, ['Accueil', 'Warm-up']);
  assert.equal(patch.teamRoleAssignments.Accueil, "Chef d'équipe");
  assert.equal(patch.teamRole, "Chef d'équipe");
  assert.equal(patch.workflowStatus, 'Affecté');
  assert.equal(buildAddTeamPatch(volunteer, 'accueil'), null);
});

test('removing the last team goes back to Candidature reçue; cancelled stays cancelled', () => {
  const volunteer = { workflowStatus: 'Affecté', assignedRoles: ['Accueil'] };
  assert.equal(buildRemoveTeamPatch(volunteer, 'Accueil').workflowStatus, 'Candidature reçue');
  assert.equal(buildRemoveTeamPatch({ ...volunteer, workflowStatus: 'Annulé' }, 'Accueil').workflowStatus, 'Annulé');
  assert.equal(buildRemoveTeamPatch(volunteer, 'Warm-up'), null);
});

test('changing only the function keeps status and email state', () => {
  const patch = buildMemberRolePatch(
    { assignedRoles: ['Accueil', 'Warm-up'], teamRoleAssignments: { Accueil: 'Bénévole', 'Warm-up': 'Bénévole' } },
    'Warm-up',
    'Remplaçant',
  );
  assert.deepEqual(patch, { teamRoleAssignments: { Accueil: 'Bénévole', 'Warm-up': 'Remplaçant' }, teamRole: 'Bénévole' });
});

test('informing sets Informé unless cancelled', () => {
  assert.equal(getStatusAfterInform({ workflowStatus: 'Affecté' }), 'Informé');
  assert.equal(getStatusAfterInform({ workflowStatus: 'Annulé' }), 'Annulé');
});

test('board counts places without replacements and flags missing leads', () => {
  const volunteers = [
    { id: '1', lastName: 'B', assignedRoles: ['Accueil'], teamRoleAssignments: { Accueil: 'Bénévole' } },
    { id: '2', lastName: 'A', assignedRoles: ['Accueil', 'Warm-up'], teamRoleAssignments: { Accueil: 'Remplaçant' }, teamEmailSent: true },
    { id: '3', lastName: 'C', assignedRoles: ['Call room'], teamRoleAssignments: { 'Call room': "Chef d'équipe" } },
    { id: '4', lastName: 'D', assignedRoles: ['Accueil'], workflowStatus: 'Annulé' },
  ];
  const [accueil, callRoom, warmUp] = buildTeamBoard(teams, volunteers);
  assert.equal(accueil.members.length, 2);
  assert.equal(accueil.placed, 1);
  assert.equal(accueil.missing, 1);
  assert.equal(accueil.missingLead, true);
  assert.equal(accueil.toInform, 1);
  assert.equal(callRoom.missing, 0);
  assert.equal(callRoom.missingLead, false);
  assert.equal(warmUp.missingLead, false);
  assert.equal(needsInforming(volunteers[3]), false);
});

test('suggestions favour preferences, then languages, and skip current teams', () => {
  const board = buildTeamBoard(teams, []);
  const suggestions = suggestTeams(
    { missionPreferences: ['Warm-up'], languages: ['Français', 'Anglais'], assignedRoles: ['Call room'] },
    board,
  );
  assert.deepEqual(suggestions.map((s) => s.teamName), ['Warm-up', 'Accueil']);
  assert.equal(suggestions[0].prefers, true);
  assert.equal(suggestions[1].speaks, true);
  assert.deepEqual(suggestTeams({ languages: ['Portugais'] }, board), []);
});
