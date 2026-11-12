import test from 'node:test';
import assert from 'node:assert/strict';

import { canPrintStep, countSteps, getBadgeStep } from '../src/app/accreditation-steps.js';

test('stored statuses map to the 3 steps plus À traiter', () => {
  assert.deepEqual(getBadgeStep({ printStatus: 'Non-imprimé' }), { step: 'todo', reason: '' });
  assert.deepEqual(getBadgeStep({ printStatus: 'Dans la file' }), { step: 'todo', reason: '' });
  assert.deepEqual(getBadgeStep({ printStatus: 'Imprimé' }), { step: 'done', reason: '' });
  assert.deepEqual(getBadgeStep({ printStatus: 'Imprimé', handedOverAt: '2027-01-17' }), { step: 'given', reason: '' });
  assert.deepEqual(getBadgeStep({ printStatus: 'Non-imprimé', warningMessage: 'Attention modification' }), { step: 'attn', reason: 'modified' });
  assert.deepEqual(getBadgeStep({ printStatus: 'Imprimé à détruire' }), { step: 'attn', reason: 'recover' });
});

test('cancelled or destroyed badges leave the list', () => {
  assert.equal(getBadgeStep({ printStatus: 'Annulé' }).step, null);
  assert.equal(getBadgeStep({ printStatus: 'Imprimé à détruire', destroyedAt: '2027-01-01' }).step, null);
});

test('only badges to print or to reprint can be printed', () => {
  assert.equal(canPrintStep({ step: 'todo' }), true);
  assert.equal(canPrintStep({ step: 'attn', reason: 'modified' }), true);
  assert.equal(canPrintStep({ step: 'attn', reason: 'recover' }), false);
  assert.equal(canPrintStep({ step: 'done' }), false);
});

test('countSteps counts each step', () => {
  assert.deepEqual(
    countSteps([{ printStatus: 'Non-imprimé' }, { printStatus: 'Imprimé' }, { printStatus: 'Imprimé', handedOverAt: 'x' }, { printStatus: 'Annulé' }]),
    { todo: 1, done: 1, given: 1, attn: 0 },
  );
});
