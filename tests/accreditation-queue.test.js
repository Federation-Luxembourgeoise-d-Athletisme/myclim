import test from 'node:test';
import assert from 'node:assert/strict';

import { MODIFIED_MESSAGE, enterQueue, leaveQueue, leaveQueueSimple } from '../src/app/accreditation-queue.js';

test('a never-printed badge goes back to Non-imprimé', () => {
  const queued = enterQueue({ printStatus: 'Non-imprimé', warningMessage: '' });
  assert.equal(queued.printStatus, 'Dans la file');
  const back = leaveQueue(queued, { zoneIds: [], roleLabel: 'Entrance' });
  assert.equal(back.printStatus, 'Non-imprimé');
  assert.equal(back.warningMessage, '');
  assert.equal(back.lastQueuedAt, null);
});

test('a printed badge queued for a reprint goes back to Imprimé when nothing changed', () => {
  const printed = { printStatus: 'Imprimé', lastPrintedAt: '2026-11-01', printedSnapshot: { roleLabel: 'VIP team', zoneIds: ['z6'] } };
  const back = leaveQueue(enterQueue(printed), { zoneIds: ['z6'], roleLabel: 'VIP team' });
  assert.equal(back.printStatus, 'Imprimé');
});

test('a printed badge whose zones changed while queued becomes à réimprimer', () => {
  const printed = { printStatus: 'Imprimé', lastPrintedAt: '2026-11-01', printedSnapshot: { roleLabel: 'VIP team', zoneIds: ['z6'] } };
  const back = leaveQueue(enterQueue(printed), { zoneIds: ['z6', 'z1'], roleLabel: 'VIP team' });
  assert.equal(back.printStatus, 'Non-imprimé');
  assert.equal(back.warningMessage, MODIFIED_MESSAGE);
});

test('a modified badge gets its alert back when removed from the queue', () => {
  const modified = { printStatus: 'Non-imprimé', warningMessage: MODIFIED_MESSAGE, lastPrintedAt: '2026-11-01' };
  const queued = enterQueue(modified);
  assert.equal(queued.warningMessage, '');
  const back = leaveQueue(queued, {});
  assert.equal(back.printStatus, 'Non-imprimé');
  assert.equal(back.warningMessage, MODIFIED_MESSAGE);
});

test('an old queued entry without memory goes back to Non-imprimé', () => {
  assert.equal(leaveQueue({ printStatus: 'Dans la file', lastPrintedAt: '2026-11-01' }, {}).printStatus, 'Non-imprimé');
});

test('judges and press keep a printed badge as printed', () => {
  assert.deepEqual(leaveQueueSimple({ printStatus: 'Dans la file', lastPrintedAt: '2026-11-01' }), { printStatus: 'Imprimé' });
  assert.deepEqual(leaveQueueSimple({ printStatus: 'Dans la file' }), { printStatus: 'Non-imprimé' });
  assert.deepEqual(leaveQueueSimple({ printStatus: 'Imprimé' }), {});
});
