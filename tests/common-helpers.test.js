import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUserIdentitySet,
  formatVolunteerApplicationStatus,
  getAssignedTeamNames,
  getDocumentUploadErrorMessage,
  getWorkflowStatusClass,
  isTeamLeadAssignment,
} from '../src/app/common-helpers.js';

test('getDocumentUploadErrorMessage maps permission-denied clearly', () => {
  assert.equal(
    getDocumentUploadErrorMessage({ code: 'permission-denied' }),
    "Écriture Firestore refusée. Vérifiez les règles Firestore pour la collection documents.",
  );
});

test('getDocumentUploadErrorMessage falls back to message then generic text', () => {
  assert.equal(getDocumentUploadErrorMessage({ message: 'boom' }), 'boom');
  assert.equal(getDocumentUploadErrorMessage({}), "L'enregistrement du document a échoué.");
});

test('formatVolunteerApplicationStatus normalizes known statuses', () => {
  assert.equal(formatVolunteerApplicationStatus('candidature_recue'), 'Candidature reçue');
  assert.equal(formatVolunteerApplicationStatus('pending_guardian_approval'), 'Accord parental attendu');
  assert.equal(formatVolunteerApplicationStatus('custom'), 'custom');
});

test('buildUserIdentitySet includes uid, emails and full names in lowercase', () => {
  const identities = buildUserIdentitySet(
    { uid: 'USER-1', email: 'Profile@Mail.com', firstName: 'Ada', lastName: 'Lovelace' },
    { uid: 'AUTH-1', email: 'Login@Mail.com' },
  );

  assert.equal(identities.has('user-1'), true);
  assert.equal(identities.has('auth-1'), true);
  assert.equal(identities.has('profile@mail.com'), true);
  assert.equal(identities.has('login@mail.com'), true);
  assert.equal(identities.has('ada lovelace'), true);
});

test('getAssignedTeamNames keeps non-empty values in order', () => {
  assert.deepEqual(
    getAssignedTeamNames({
      assignedRole: 'Accueil',
      teamName: 'Logistique',
      assignedTeams: ['Accueil', '', 'Terrain'],
    }),
    ['Accueil', 'Logistique', 'Accueil', 'Terrain'],
  );
});

test('isTeamLeadAssignment accepts normalized chef role and rejects others', () => {
  assert.equal(isTeamLeadAssignment({ teamRole: "Chef d'équipe" }), true);
  assert.equal(isTeamLeadAssignment({ teamRole: 'chef_equipe' }), true);
  assert.equal(isTeamLeadAssignment({ teamRole: 'Bénévole' }), false);
});

test('getWorkflowStatusClass returns expected classes', () => {
  assert.equal(getWorkflowStatusClass('Annulé'), 'workflow-pill workflow-pill--cancelled');
  assert.equal(getWorkflowStatusClass('Affecté'), 'workflow-pill workflow-pill--assigned');
  assert.equal(getWorkflowStatusClass('Informé'), 'workflow-pill workflow-pill--informed');
  assert.equal(getWorkflowStatusClass('Confirmé'), 'workflow-pill workflow-pill--confirmed');
  assert.equal(getWorkflowStatusClass('Autre'), 'workflow-pill workflow-pill--received');
});
