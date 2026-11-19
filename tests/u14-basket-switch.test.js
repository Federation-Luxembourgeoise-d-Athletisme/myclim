import test from 'node:test';
import assert from 'node:assert/strict';

import { buildU14SwitchToBasketFields, canSwitchU14RequestToBasket } from '../src/app/u14-basket-switch.js';

const either = { requestType: 'preprogram_ou_porte_panier', status: 'confirmed', allocationMode: 'platform', raceCode: 'U12F60', raceLabel: 'U12 Filles - 60 m' };

test('only active "race or basket" requests without a protected place can switch', () => {
  assert.equal(canSwitchU14RequestToBasket(either), true);
  assert.equal(canSwitchU14RequestToBasket({ ...either, status: 'waitlisted' }), true);
  assert.equal(canSwitchU14RequestToBasket({ ...either, requestType: 'preprogram' }), false);
  assert.equal(canSwitchU14RequestToBasket({ ...either, requestType: 'porte_panier' }), false);
  assert.equal(canSwitchU14RequestToBasket({ ...either, status: 'declined' }), false);
  assert.equal(canSwitchU14RequestToBasket({ ...either, allocationMode: 'protected' }), false);
  assert.equal(canSwitchU14RequestToBasket(either, { id: 'invite-1' }), false);
});

test('switch fields: basket request retained, race place released, original race kept', () => {
  const deadline = new Date('2026-11-29T23:59:00');
  const fields = buildU14SwitchToBasketFields({ ...either, acceptedPosition: 8 }, deadline);
  assert.equal(fields.requestType, 'porte_panier');
  assert.equal(fields.allocationMode, 'porte_panier');
  assert.equal(fields.status, 'confirmed');
  assert.equal(fields.adminApprovalStatus, 'approved');
  assert.equal(fields.parentDecisionStatus, 'pending');
  assert.equal(fields.acceptedPosition, null);
  assert.equal(fields.previousRequestType, 'preprogram_ou_porte_panier');
  assert.equal(fields.previousRaceCode, 'U12F60');
  assert.equal(fields.confirmationDeadline, deadline);
});
