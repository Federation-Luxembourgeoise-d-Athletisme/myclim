import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeBusinessRaceLineup } from '../src/site/business-race-lineup.js';
import { buildBusinessRaceLineup } from '../functions/src/business-race.js';

const runner = (firstName, lastName) => ({ firstName, lastName, gender: 'F' });

test('line-up: one row per team with a name or runners, numbered when a company has several', () => {
  const lineup = buildBusinessRaceLineup(
    [
      { id: 'zeta', organizationName: 'Zeta', businessRace: true, businessRaceTeams: 2 },
      { id: 'acme', organizationName: 'ACME', businessRace: true, businessRaceTeams: 1 },
      { id: 'vip', organizationName: 'VIP only' },
    ],
    {
      zeta: [{ teamNumber: 1, runners: [runner('Zoe', 'Z')] }, { teamNumber: 2, teamName: '' }],
      acme: [{ teamNumber: 1, teamName: 'Rockets', runners: [runner('Ana', 'A'), runner('', 'x')], reserve: runner('Res', 'R') }],
      vip: [{ teamNumber: 1, teamName: 'Nope' }],
    },
  );
  assert.deepEqual(lineup.map((team) => [team.id, team.teamName, team.runners.join('|')]), [
    ['br-acme-1', 'Rockets', 'Ana A'],
    ['br-zeta-1', 'Zeta 1', 'Zoe Z'],
  ]);
  assert.equal(lineup[0].reserve, 'Res R');
});

test('e-magazine: only portal teams, with extras added by hand; stale and hand-entered rows dropped', () => {
  const merged = mergeBusinessRaceLineup(
    [
      { id: 'br-acme-1', lane: '3', photoUrl: 'p.jpg' },
      { id: 'br-gone-1', name: 'Old team' },
      { id: 'participant-1', name: 'Guest team', team: 'Partner' },
    ],
    [{ id: 'br-acme-1', teamName: 'Rockets', organization: 'ACME', runners: ['Ana A', 'Ben B'] }],
  );
  assert.deepEqual(merged.map((entry) => entry.id), ['br-acme-1']);
  assert.equal(merged[0].lane, '3');
  assert.equal(merged[0].photoUrl, 'p.jpg');
  assert.equal(merged[0].description, 'Ana A · Ben B');
  assert.equal(merged[0].team, 'ACME');
});
