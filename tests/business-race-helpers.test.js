import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBusinessRacePortalFields,
  buildBusinessRaceTeams,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamLabel,
  getBusinessRaceTeamStatus,
  listBusinessRaceRunners,
} from '../src/app/business-race-helpers.js';

const runner = (firstName, lastName, gender) => ({ firstName, lastName, gender });

test('team count is 0 for a plain VIP portal, capped and at least 1 otherwise', () => {
  assert.equal(getBusinessRaceTeamCount({ vipPlacesCap: 4 }), 0);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true }), 1);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true, businessRaceTeams: 3 }), 3);
  assert.equal(getBusinessRaceTeamCount({ businessRace: true, businessRaceTeams: 99 }), 10);
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
