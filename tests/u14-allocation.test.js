import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAllocation, splitRaceCandidates } from '../functions/src/u14-allocation.js';

const pools = { U12F: 0, U12M: 0, U14F: 0, U14M: 0 };

function boys60(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    raceCode: 'U14M60',
    requestType: 'preprogram',
    category: 'U14',
    gender: 'garcon',
    childFirstName: `Child${String(index + 1).padStart(2, '0')}`,
    submittedAt: new Date(Date.UTC(2026, 10, 16, 8, index)).toISOString(),
    status: 'confirmed',
    ...overrides[index + 1],
  }));
}

const retained = { adminApprovalStatus: 'approved', parentDecisionStatus: 'confirmed' };

test('a retained child keeps the place when an earlier request takes the capacity', () => {
  // 16 places : l'enfant 16 est retenu et confirmé, puis une 17e demande
  // plus ancienne arrive (ou la réserve bloque une place) : il reste dans la course.
  const requests = boys60(17, { 17: retained });
  requests[16].submittedAt = new Date(Date.UTC(2026, 10, 16, 9, 0)).toISOString();
  const states = computeAllocation({ requests, invites: [], pools, reserveReleased: true });
  assert.equal(states.get('r17').status, 'confirmed');
  // La place libre suivante est prise par l'enfant non retenu le plus récent.
  assert.equal(states.get('r16').status, 'waitlisted');
  assert.equal(states.get('r16').waitlistPosition, 1);
});

test('a reserve that grows never demotes retained children; others go to the waiting list', () => {
  const requests = boys60(16, { 14: retained, 15: retained, 16: retained });
  const states = computeAllocation({ requests, invites: [], pools: { ...pools, U14M: 3 }, reserveReleased: false });
  ['r14', 'r15', 'r16'].forEach((id) => assert.equal(states.get(id).status, 'confirmed'));
  const waitlisted = [...states.entries()].filter(([, state]) => state.status === 'waitlisted').map(([id]) => id);
  assert.deepEqual(waitlisted, ['r11', 'r12', 'r13']);
});

test('without retained children, places still follow the order of arrival', () => {
  const { seated, waitlisted } = splitRaceCandidates(boys60(5), 3);
  assert.deepEqual(seated.map((request) => request.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(waitlisted.map((request) => request.id), ['r4', 'r5']);
});

test('a waitlisted child is never treated as retained, even with an old approval', () => {
  const requests = boys60(3, { 3: { status: 'waitlisted', adminApprovalStatus: 'approved' } });
  const { seated, waitlisted } = splitRaceCandidates(requests, 2);
  assert.deepEqual(seated.map((request) => request.id), ['r1', 'r2']);
  assert.deepEqual(waitlisted.map((request) => request.id), ['r3']);
});
