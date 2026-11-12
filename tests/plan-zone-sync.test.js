import test from 'node:test';
import assert from 'node:assert/strict';

import { getZonePlacement, syncPlanZones } from '../src/app/coque-plan/plan-zone-sync.js';

const zones = [
  { id: 'zone-infield', order: 1, name: 'Infield' },
  { id: 'zone-mixed', order: 5, name: 'Mixed Zone' },
];

test('plan zone markers take the name of the accreditation zone with the same number', () => {
  const elements = [
    { id: 'z1', kind: 'zone', num: 1, label: 'Old name', labelEn: 'Old EN' },
    { id: 'z5', kind: 'zone', num: 5, label: 'Mixed Zone', labelEn: '' },
    { id: 'm1', kind: 'mark', label: 'Bar' },
    { id: 'z9', kind: 'zone', num: 9, label: 'Unknown' },
  ];
  const synced = syncPlanZones(elements, zones);
  assert.equal(synced[0].label, 'Infield');
  assert.equal(synced[0].labelEn, '');
  assert.equal(synced[1], elements[1]);
  assert.equal(synced[2], elements[2]);
  assert.equal(synced[3].label, 'Unknown');
});

test('placement counts badge-map markers per zone and lists markers with no zone', () => {
  const elements = [
    { kind: 'zone', num: 1, maps: { acc: true } },
    { kind: 'zone', num: 1, maps: { acc: true } },
    { kind: 'zone', num: 5, maps: { acc: false } },
    { kind: 'zone', num: 7, maps: { acc: true } },
  ];
  const { counts, orphans } = getZonePlacement(elements, zones);
  assert.equal(counts.get(1), 2);
  assert.equal(counts.get(5), 0);
  assert.deepEqual(orphans, [7]);
});
