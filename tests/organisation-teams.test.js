import test from 'node:test';
import assert from 'node:assert/strict';


test('member access defaults and account status', async () => {
  const { normalizeMember, getMemberAccountStatus } = await import('../src/app/organisation-teams.js');
  assert.equal(normalizeMember({ firstName: 'A' }).access, 'none');
  assert.equal(normalizeMember({ email: 'a@b.lu' }).access, 'organisation');
  assert.equal(normalizeMember({ email: 'a@b.lu', access: 'staff' }).access, 'staff');
  const staff = { access: 'staff', email: 'a@b.lu' };
  const orga = { access: 'organisation', email: 'a@b.lu' };
  assert.equal(getMemberAccountStatus({ access: 'none' }), 'no-access');
  assert.equal(getMemberAccountStatus(staff), 'none');
  assert.equal(getMemberAccountStatus(staff, { user: { userTypes: ['benevole'] } }), 'missing-role');
  assert.equal(getMemberAccountStatus(staff, { user: { userTypes: ['gestionnaire'] } }), 'active');
  assert.equal(getMemberAccountStatus(orga, { user: { userTypes: ['gestionnaire'] } }), 'active');
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);
  assert.equal(getMemberAccountStatus(orga, { invitation: { status: 'pending', expiresAt: future } }), 'invited');
  assert.equal(getMemberAccountStatus(orga, { invitation: { status: 'pending', expiresAt: past } }), 'none');
});

test('LUNEX Student access gives the gestionnaire role, like Staff FLA', async () => {
  const { normalizeMember, getAccessOption, getMemberAccountStatus } = await import('../src/app/organisation-teams.js');
  assert.equal(normalizeMember({ email: 'a@b.lu', access: 'lunex' }).access, 'lunex');
  assert.equal(getAccessOption('lunex').role, 'gestionnaire');
  assert.equal(getMemberAccountStatus({ access: 'lunex' }, { user: { userTypes: ['gestionnaire'] } }), 'active');
});

test('team modules reach every member with an account, and only them', async () => {
  const { buildModulesByEmail, normalizeOrganisationTeams, buildDefaultOrganisationTeams } = await import('../src/app/organisation-teams.js');
  const teams = normalizeOrganisationTeams({
    teams: [
      { id: 'speakers', name: 'Speakers (Athle.ch)', modules: ['animation', 'unknown'], members: [
        { firstName: 'A', email: 'A@athle.ch', access: 'organisation' },
        { firstName: 'B', access: 'none' },
        { firstName: 'C', email: 'c@athle.ch', access: 'none' },
      ] },
      { id: 'tv', name: 'TV', members: [{ firstName: 'D', email: 'a@athle.ch', access: 'organisation' }] },
    ],
  });
  assert.deepEqual(teams[0].modules, ['animation']);
  assert.deepEqual(teams[1].modules, []);
  assert.deepEqual(buildModulesByEmail(teams), { 'a@athle.ch': ['animation'] });
  assert.deepEqual(buildDefaultOrganisationTeams().find((team) => team.id === 'speakers').modules, ['animation']);
});
