import test from 'node:test';
import assert from 'node:assert/strict';

import { nationalBadgeKey, normalizeNamelessBadgeTypes, normalizeNationalBadge, toggleZone } from '../src/app/extra-badge-types.js';

test('Athlete and Coach start from their former fixed zones', () => {
  const types = normalizeNamelessBadgeTypes(undefined);
  assert.deepEqual(types.map((t) => t.id), ['athlete', 'coach']);
  assert.deepEqual(types[1].zoneIds, ['zone-warmup', 'zone-coaching']);
  assert.equal(types[0].category, 'athlete');
});

test('saved settings win, custom types are kept, unknown zones dropped', () => {
  const zones = new Set(['zone-warmup', 'zone-infield']);
  const types = normalizeNamelessBadgeTypes(
    [
      { id: 'coach', zoneIds: ['zone-warmup', 'zone-gone'], category: 'technical' },
      { id: 'escort', label: 'Accompagnateur', zoneIds: ['zone-infield'], category: 'nope' },
    ],
    zones,
  );
  const coach = types.find((t) => t.id === 'coach');
  assert.deepEqual(coach.zoneIds, ['zone-warmup']);
  assert.equal(coach.category, 'technical');
  const escort = types.find((t) => t.id === 'escort');
  assert.equal(escort.label, 'Accompagnateur');
  assert.equal(escort.category, 'organisation');
  assert.equal(escort.builtIn, false);
  assert.equal(types.find((t) => t.id === 'athlete').builtIn, true);
});

test('national race badge has defaults and keeps saved zones', () => {
  assert.deepEqual(normalizeNationalBadge(undefined).zoneIds, ['zone-warmup', 'zone-infield']);
  assert.deepEqual(normalizeNationalBadge({ zoneIds: [] }).zoneIds, []);
  assert.equal(nationalBadgeKey('abc'), 'nr-abc');
});

test('toggleZone adds or removes', () => {
  assert.deepEqual(toggleZone(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleZone(['a', 'b'], 'a'), ['b']);
});
