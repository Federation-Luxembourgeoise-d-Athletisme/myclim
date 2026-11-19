import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBusinessRacePortalFields,
  buildBusinessRaceTeams,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamLabel,
  getBusinessRaceTeamStatus,
  getBillingMissingFields,
  getRunnerMissingDetails,
  listBusinessRaceRunners,
  normalizeBusinessRaceBilling,
  normalizeBusinessRaceRunner,
} from '../src/app/business-race-helpers.js';

const details = {
  email: 'a@b.lu',
  phone: '+352 621 000 000',
  birthYear: '1990',
  emergencyFirstName: 'Eva',
  emergencyLastName: 'Lux',
  emergencyPhone: '+352 621 111 111',
  rulesAccepted: true,
};
const runner = (firstName, lastName, gender) => ({ firstName, lastName, gender, ...details });

test('runner details: nothing missing until the name is entered, then each item checked', () => {
  assert.deepEqual(getRunnerMissingDetails({ firstName: '', lastName: '' }), []);
  assert.deepEqual(getRunnerMissingDetails(runner('A', 'B', 'F')), []);
  assert.deepEqual(
    getRunnerMissingDetails({ firstName: 'A', lastName: 'B' }),
    ['email', 'phone', 'birthYear', 'rules'],
  );
  assert.deepEqual(getRunnerMissingDetails({ ...runner('A', 'B', 'F'), email: 'nope', birthYear: '19' }), ['email', 'birthYear']);
  // Le contact d'urgence est facultatif.
  assert.deepEqual(getRunnerMissingDetails({ ...runner('A', 'B', 'F'), emergencyFirstName: '', emergencyLastName: '', emergencyPhone: '' }), []);
});

test('runner normalisation keeps digits of the birth year and lower-cases the email', () => {
  const normalized = normalizeBusinessRaceRunner({ firstName: ' A ', email: ' Ana@Firm.LU ', birthYear: '19 88x' });
  assert.equal(normalized.firstName, 'A');
  assert.equal(normalized.email, 'ana@firm.lu');
  assert.equal(normalized.birthYear, '1988');
  assert.equal(normalized.rulesAccepted, false);
});

test('a team with missing runner details is not complete', () => {
  const team = {
    runners: [runner('A', 'A', 'F'), runner('B', 'B', 'M'), runner('C', 'C', 'F'), { firstName: 'D', lastName: 'D', gender: 'M' }],
  };
  const status = getBusinessRaceTeamStatus(team);
  assert.equal(status.missingDetails, 1);
  assert.equal(status.complete, false);
  // Le remplaçant compte aussi.
  const withReserve = { runners: team.runners.slice(0, 3).concat(runner('D', 'D', 'M')), reserve: { firstName: 'R', lastName: 'R', gender: 'F' } };
  assert.equal(getBusinessRaceTeamStatus(withReserve).missingDetails, 1);
});

test('billing: required fields and a valid email', () => {
  assert.deepEqual(getBillingMissingFields({}), ['companyName', 'address', 'postalCode', 'city', 'country', 'contactFirstName', 'contactLastName', 'email']);
  const full = { companyName: 'ACME SA', address: '1 rue X', postalCode: 'L-1234', city: 'Luxembourg', country: 'Luxembourg', contactFirstName: 'A', contactLastName: 'B', email: 'Invoices@ACME.lu' };
  assert.deepEqual(getBillingMissingFields(full), []);
  assert.deepEqual(getBillingMissingFields({ ...full, email: 'bad' }), ['email']);
  assert.equal(normalizeBusinessRaceBilling(full).email, 'invoices@acme.lu');
  assert.equal(normalizeBusinessRaceBilling(full).vatNumber, '');
});

test('team count is 0 for a plain VIP portal, capped and at least 1 otherwise', () => {
  assert.equal(getBusinessRaceTeamCount({ vipPlacesCap: 4 }), 0);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true }), 1);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true, businessRaceTeams: 2 }), 2);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true, businessRaceTeams: 99 }), 2);
});

test('teams are listed 1..N with empty slots filled in', () => {
  const teams = buildBusinessRaceTeams({ businessRace: true, businessRaceTeams: 2 }, [
    { teamNumber: 2, teamName: 'Speedy', runners: [runner('Ana', 'Lux', 'F')] },
  ]);
  assert.deepEqual(teams.map((t) => t.id), ['team-1', 'team-2']);
  assert.equal(teams[0].runners.length, 4);
  assert.equal(teams[1].teamName, 'Speedy');
  assert.equal(teams[1].runners[0].firstName, 'Ana');
  assert.equal(teams[1].runners[3].firstName, '');
});

test('a team is complete with 4 runners, 2 women and 2 men', () => {
  const full = {
    runners: [runner('A', 'A', 'F'), runner('B', 'B', 'M'), runner('C', 'C', 'F'), runner('D', 'D', 'M')],
  };
  assert.equal(getBusinessRaceTeamStatus(full).state, 'complete');

  const wrongMix = { runners: [runner('A', 'A', 'F'), runner('B', 'B', 'F'), runner('C', 'C', 'F'), runner('D', 'D', 'M')] };
  const status = getBusinessRaceTeamStatus(wrongMix);
  assert.equal(status.filled, 4);
  assert.equal(status.genderOk, false);
  assert.equal(status.state, 'partial');

  assert.equal(getBusinessRaceTeamStatus({}).state, 'empty');
  assert.equal(getBusinessRaceTeamStatus({ runners: [runner('A', '', 'F')] }).filled, 0);
});

test('team label falls back to the company, numbered when there are several teams', () => {
  assert.equal(getBusinessRaceTeamLabel({ teamName: 'Rockets', teamNumber: 1 }, 'ACME', 2), 'Rockets');
  assert.equal(getBusinessRaceTeamLabel({ teamNumber: 2 }, 'ACME', 2), 'ACME 2');
  assert.equal(getBusinessRaceTeamLabel({ teamNumber: 1 }, 'ACME', 1), 'ACME');
});

test('runners to accredit: only filled slots, reserve included, sorted by company and leg', () => {
  const portals = [
    { id: 'zeta', organizationName: 'Zeta', businessRace: true, businessRaceTeams: 1 },
    { id: 'acme', organizationName: 'ACME', businessRace: true, businessRaceTeams: 1 },
    { id: 'vip-only', organizationName: 'VIP only' },
  ];
  const runners = listBusinessRaceRunners(portals, {
    acme: [{ teamNumber: 1, runners: [runner('Leg', 'One', 'F'), runner('', '', ''), runner('Leg', 'Three', 'M')], reserve: runner('Res', 'Erve', 'M') }],
    zeta: [{ teamNumber: 1, runners: [runner('Zed', 'Z', 'M')] }],
    'vip-only': [{ teamNumber: 1, runners: [runner('No', 'Pe', 'M')] }],
  });
  assert.deepEqual(
    runners.map((r) => `${r.organization}:${r.isReserve ? 'R' : r.leg}:${r.firstName}`),
    ['ACME:1:Leg', 'ACME:3:Leg', 'ACME:R:Res', 'Zeta:1:Zed'],
  );
  assert.equal(runners[0].key, 'br-acme-1-leg1');
  assert.equal(runners[2].key, 'br-acme-1-reserve');
});

test('portal fields from the admin form', () => {
  assert.deepEqual(buildBusinessRacePortalFields({ businessRacePack: 'experience', businessRaceTeams: '2' }), {
    businessRace: true,
    businessRacePack: 'experience',
    businessRaceTeams: 2,
  });
  assert.equal(buildBusinessRacePortalFields({ businessRacePack: 'nope', businessRaceTeams: '' }).businessRacePack, 'custom');
  assert.equal(buildBusinessRacePortalFields({ businessRaceTeams: '0' }).businessRaceTeams, 1);
});

test('runner VIP flag is kept and counted per team', async () => {
  const { countTeamVipRunners, buildRunnerVipEntryId, listBusinessRaceRunners: list } = await import('../src/app/business-race-helpers.js');
  const team = { teamNumber: 1, runners: [{ firstName: 'A', lastName: 'A', gender: 'F', vip: true }, { firstName: '', lastName: '', vip: true }], reserve: { firstName: 'R', lastName: 'R', vip: true } };
  assert.equal(countTeamVipRunners(team), 2);
  assert.equal(buildRunnerVipEntryId(1, 'reserve'), 'br-runner-1-reserve');
  const runners = list([{ id: 'acme', businessRace: true }], { acme: [team] });
  assert.deepEqual(runners.map((r) => r.vip), [true, true]);
});

test('settings default to 7 Jan deadline and 15 Jan 14:00 training; teams lock after the deadline day', async () => {
  const { normalizeBusinessRaceSettings, areBusinessRaceTeamsLocked } = await import('../src/app/business-race-helpers.js');
  const defaults = normalizeBusinessRaceSettings(undefined);
  assert.equal(defaults.teamsDeadline, '2027-01-07');
  assert.equal(defaults.trainings[0].date, '2027-01-15');
  assert.equal(defaults.trainings[0].time, '14:00');
  assert.equal(normalizeBusinessRaceSettings({ teamsDeadline: 'nope' }).teamsDeadline, '2027-01-07');
  assert.equal(normalizeBusinessRaceSettings({ teamsDeadline: '2027-01-05' }).teamsDeadline, '2027-01-05');
  assert.equal(areBusinessRaceTeamsLocked({ teamsDeadline: '2027-01-07' }, new Date('2027-01-07T20:00:00')), false);
  assert.equal(areBusinessRaceTeamsLocked({ teamsDeadline: '2027-01-07' }, new Date('2027-01-08T08:00:00')), true);
  assert.equal(areBusinessRaceTeamsLocked({ teamsDeadline: '' }, new Date('2030-01-01')), false);
});

test('a team sees the training lines it is ticked in, otherwise the lines for all teams', async () => {
  const { getTeamTrainings } = await import('../src/app/business-race-helpers.js');
  const settings = {
    trainings: [
      { id: 't1', date: '2027-01-15', time: '14:00', teamKeys: [] },
      { id: 't2', date: '2027-01-13', time: '18:30', teamKeys: ['acme#2'] },
      { id: 't3', date: '2027-01-14', time: '12:00', teamKeys: ['acme#2', 'zeta#1'] },
    ],
  };
  assert.deepEqual(getTeamTrainings(settings, 'acme', 1).map((t) => t.id), ['t1']);
  assert.deepEqual(getTeamTrainings(settings, 'acme', 2).map((t) => t.id), ['t2', 't3']);
  assert.deepEqual(getTeamTrainings(settings, 'zeta', 1).map((t) => t.id), ['t3']);
});
