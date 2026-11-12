import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgrammeColumns,
  getColumnActivities,
  getTrackEntries,
  getVolunteerColumns,
  getVolunteerTimeline,
  importLegacySunday,
  layoutLanes,
  normalizeProgramme,
} from '../src/app/meeting-day-programme.js';

const teams = [
  { id: 'accueil', roleName: 'Accueil & billetterie', subRoles: ['Billets'] },
  { id: 'hurdles', roleName: 'Hurdles', subRoles: [] },
];

test('columns: general, teams (split into sub-roles when asked), then free columns', () => {
  const programme = normalizeProgramme({
    splitTeamIds: ['accueil'],
    subRoleColumns: { accueil: ['Runner inside', 'billets'] },
    extraColumns: [{ id: 'apex', name: 'Apex' }],
  });
  const keys = buildProgrammeColumns(teams, programme).map((column) => column.key);
  assert.deepEqual(keys, ['general', 'sub:accueil:Billets', 'sub:accueil:Runner inside', 'team:hurdles', 'extra:apex']);
  assert.deepEqual(buildProgrammeColumns(teams, normalizeProgramme({})).map((c) => c.key), ['general', 'team:accueil', 'team:hurdles']);
});

test('an activity on a whole team shows in each of its sub-role columns', () => {
  const programme = normalizeProgramme({
    splitTeamIds: ['accueil'],
    activities: [
      { id: 'a', title: 'Mise en place', start: '13:00', end: '13:30', columns: ['team:accueil'] },
      { id: 'b', title: 'Briefing billets', start: '09:30', end: '10:30', columns: ['sub:accueil:Billets'] },
    ],
  });
  const [, billets] = buildProgrammeColumns(teams, programme);
  assert.deepEqual(getColumnActivities(programme.activities, billets).map((a) => a.id), ['b', 'a']);
});

test('volunteers see the general column plus their team, or their own sub-role', () => {
  const programme = normalizeProgramme({ splitTeamIds: ['accueil'], subRoleColumns: { accueil: ['Runner inside'] } });
  const columns = buildProgrammeColumns(teams, programme);
  const ticket = getVolunteerColumns(columns, ['Accueil & billetterie'], { 'Accueil & billetterie': 'billets' });
  assert.deepEqual(ticket.map((c) => c.key), ['general', 'sub:accueil:Billets']);
  const plain = getVolunteerColumns(columns, ['Accueil & billetterie'], { 'Accueil & billetterie': 'Bénévole' });
  assert.deepEqual(plain.map((c) => c.key), ['general', 'sub:accueil:Billets', 'sub:accueil:Runner inside']);
  assert.deepEqual(getVolunteerColumns(columns, ['hurdles']).map((c) => c.key), ['general', 'team:hurdles']);
});

test('volunteer timeline is sorted, without duplicates, general activities flagged', () => {
  const programme = normalizeProgramme({
    activities: [
      { id: 'g', title: 'Arrivée', start: '08:30', end: '09:00', columns: ['general'] },
      { id: 'h', title: 'Briefing Hurdles', start: '12:00', end: '12:30', columns: ['team:hurdles', 'team:accueil'] },
    ],
  });
  const columns = buildProgrammeColumns(teams, programme);
  const timeline = getVolunteerTimeline(programme.activities, getVolunteerColumns(columns, ['Hurdles', 'Accueil & billetterie']));
  assert.deepEqual(timeline.map((a) => [a.id, a.general]), [['g', true], ['h', false]]);
});

test('overlapping activities get separate lanes', () => {
  const { laneById, laneCount } = layoutLanes([
    { id: 'a', start: '09:00', end: '10:00' },
    { id: 'b', start: '09:30', end: '10:30' },
    { id: 'c', start: '10:00', end: '10:30' },
  ]);
  assert.equal(laneCount, 2);
  assert.deepEqual([laneById.get('a'), laneById.get('b'), laneById.get('c')], [0, 1, 0]);
});

test('track entries come from the edition timetable, headers skipped', () => {
  const entries = getTrackEntries([
    { type: 'header', label: 'PRE-PROGRAM' },
    { type: 'event', time: '16:10', gender: 'WOMEN', event: '60m', round: 'Heat 1' },
    { type: 'info', time: '13:30', label: 'U12 60m' },
  ]);
  assert.deepEqual(entries, [{ time: '13:30', label: 'U12 60m' }, { time: '16:10', label: 'W 60m Heat 1' }]);
});

test('last year import maps teams, entrance sub-roles, free columns and general', () => {
  const legacy = {
    columns: [
      { id: 'c1', name: 'Briefings' },
      { id: 'c2', name: 'Entrance – Billets' },
      { id: 'c3', name: 'Entrance – Runner inside' },
      { id: 'c4', name: 'Hurdles' },
      { id: 'c5', name: 'Blocks' },
    ],
    activities: [
      { title: 'ARRIVAL OF LUNEX', start: '08:30', end: '09:00', cols: ['c1', 'c2', 'c3', 'c4', 'c5'] },
      { title: 'Briefing Entrance (Ticket)', start: '09:30', end: '10:30', cols: ['c2'] },
      { title: 'Briefing Hurdles', start: '12:00', end: '12:30', cols: ['c4', 'c5'] },
    ],
  };
  const programme = importLegacySunday(legacy, teams);
  assert.deepEqual(programme.splitTeamIds, ['accueil']);
  assert.deepEqual(programme.subRoleColumns.accueil, ['Billets', 'Runner inside']);
  assert.deepEqual(programme.extraColumns.map((c) => c.name), ['Briefings', 'Blocks']);
  assert.deepEqual(programme.activities.map((a) => a.columns), [
    ['general'],
    ['sub:accueil:Billets'],
    ['team:hurdles', 'extra:legacy-4'],
  ]);
  assert.equal(programme.activities[1].category, 'briefing');
});

test('getPlanningDayDate accepts the Firestore Timestamp saved by Site web › Édition', async () => {
  const { getPlanningDayDate } = await import('../src/app/meeting-day-programme.js');
  const { editionDateYmd } = await import('../src/app/meeting-edition-utils.js');
  const timestamp = { toDate: () => new Date(2027, 0, 17, 12) };
  assert.equal(editionDateYmd(timestamp), '2027-01-17');
  assert.equal(editionDateYmd('2027-01-17'), '2027-01-17');
  assert.equal(editionDateYmd(null), '');
  const friday = getPlanningDayDate(timestamp, 'friday');
  assert.equal(friday.getDate(), 15);
});

test('suggestColumnMatch links a free column to the closest team, or nothing', async () => {
  const { getColumnMatchTargets, suggestColumnMatch, normalizeProgramme } = await import('../src/app/meeting-day-programme.js');
  const teams = [
    { id: 't1', roleName: 'Porte-paniers' },
    { id: 't2', roleName: 'Haies & blocs', subRoles: ['Hurdles', 'Blocks'] },
    { id: 't3', roleName: 'Transport athlètes' },
  ];
  const orgTeams = [{ id: 'o1', name: 'Officials' }];
  const targets = getColumnMatchTargets(teams, normalizeProgramme(), orgTeams);
  assert.equal(suggestColumnMatch('Porte panier', targets), 'team:t1');
  assert.equal(suggestColumnMatch('Hurdles', targets), 'sub:t2:Hurdles');
  assert.equal(suggestColumnMatch('Transport', targets), 'team:t3');
  assert.equal(suggestColumnMatch('Officials', targets), 'org:o1');
  assert.equal(suggestColumnMatch('Patator', targets), '');
});

test('mergeExtraColumn moves the activities and shows the target column', async () => {
  const { mergeExtraColumn, normalizeProgramme } = await import('../src/app/meeting-day-programme.js');
  const programme = normalizeProgramme({
    hiddenTeamIds: ['t2'],
    extraColumns: [{ id: 'x1', name: 'Hurdles' }, { id: 'x2', name: 'Patator' }],
    activities: [
      { id: 'a1', title: 'Mise en place', start: '09:00', end: '10:00', columns: ['extra:x1', 'team:t1'] },
      { id: 'a2', title: 'Briefing', start: '10:00', end: '10:30', columns: ['extra:x1', 'sub:t2:Hurdles'] },
      { id: 'a3', title: 'Patator', start: '11:00', end: '12:00', columns: ['extra:x2'] },
    ],
  });
  const next = mergeExtraColumn(programme, 'x1', 'sub:t2:Hurdles');
  assert.deepEqual(next.extraColumns.map((column) => column.id), ['x2']);
  assert.deepEqual(next.activities.find((a) => a.id === 'a1').columns.sort(), ['sub:t2:Hurdles', 'team:t1']);
  assert.deepEqual(next.activities.find((a) => a.id === 'a2').columns, ['sub:t2:Hurdles']);
  assert.deepEqual(next.activities.find((a) => a.id === 'a3').columns, ['extra:x2']);
  assert.ok(!next.hiddenTeamIds.includes('t2'));
  assert.ok(next.splitTeamIds.includes('t2'));
  const org = mergeExtraColumn(programme, 'x2', 'org:o1');
  assert.ok(org.visibleOrgTeamIds.includes('o1'));
});

test('getColumnSuggestion prefers the sub-role sharing most words, and flags weak guesses', async () => {
  const { getColumnMatchTargets, getColumnSuggestion, normalizeProgramme } = await import('../src/app/meeting-day-programme.js');
  const teams = [
    { id: 'tr', roleName: 'Transport', subRoles: ['runner'] },
    { id: 'en', roleName: 'Entrance', subRoles: ['runner', 'desk'] },
    { id: 'yr', roleName: 'Young reporter' },
  ];
  const targets = getColumnMatchTargets(teams, normalizeProgramme(), []);
  assert.deepEqual(getColumnSuggestion('Entrance – Runner inside', targets), { key: 'sub:en:runner', strong: true });
  assert.deepEqual(getColumnSuggestion('Entrance – Billets', targets), { key: 'team:en', strong: false });
  assert.deepEqual(getColumnSuggestion('Young Volunteer', targets), { key: 'team:yr', strong: false });
});
