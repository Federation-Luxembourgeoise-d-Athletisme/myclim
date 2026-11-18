import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELEBRITY_RACE_STARTER_LIST,
  applyFollowUpDone,
  applyStatusChange,
  getCelebrityDisplayName,
  getFollowUpDate,
  isFollowUpDue,
  normalizeCelebrityContact,
  summarizeCelebrityRace,
} from '../src/app/celebrity-race-helpers.js';

const opts = { todayIso: '2026-11-18', nowIso: '2026-11-18T10:00:00.000Z', by: 'Margot' };

test('display name is first + last name, else the handle', () => {
  assert.equal(getCelebrityDisplayName(normalizeCelebrityContact({ firstName: 'Michel', lastName: 'Ries' })), 'Michel Ries');
  assert.equal(getCelebrityDisplayName(normalizeCelebrityContact({ alias: 'jf.socialpitstop' })), 'jf.socialpitstop');
});

test('first move to "asked" records the request date and logs it', () => {
  const contact = normalizeCelebrityContact({ firstName: 'Vera', lastName: 'Hoffmann' });
  const asked = applyStatusChange(contact, 'asked', opts);
  assert.equal(asked.askedAt, '2026-11-18');
  assert.deepEqual(asked.history, [{ at: opts.nowIso, status: 'asked', note: '', by: 'Margot' }]);
  // The request date is kept on later changes.
  const confirmed = applyStatusChange(asked, 'confirmed', { ...opts, todayIso: '2026-11-25' });
  assert.equal(confirmed.askedAt, '2026-11-18');
  assert.equal(applyStatusChange(confirmed, 'confirmed', opts), confirmed);
});

test('follow-up is due a week after the request, or on the chosen date', () => {
  const asked = normalizeCelebrityContact({ status: 'asked', askedAt: '2026-11-10' });
  assert.equal(getFollowUpDate(asked), '2026-11-17');
  assert.equal(isFollowUpDue(asked, '2026-11-16'), false);
  assert.equal(isFollowUpDue(asked, '2026-11-17'), true);
  assert.equal(isFollowUpDue({ ...asked, followUpAt: '2026-11-30' }, '2026-11-20'), false);
  assert.equal(isFollowUpDue(normalizeCelebrityContact({ status: 'no_reply' }), '2026-11-18'), true);
  assert.equal(isFollowUpDue(normalizeCelebrityContact({ status: 'confirmed', askedAt: '2026-01-01' }), '2026-11-18'), false);
});

test('logging a follow-up pushes the next one a week later', () => {
  const asked = normalizeCelebrityContact({ status: 'asked', askedAt: '2026-11-01' });
  const done = applyFollowUpDone(asked, opts);
  assert.equal(done.followUpAt, '2026-11-25');
  assert.equal(isFollowUpDue(done, '2026-11-18'), false);
  assert.equal(done.history.at(-1).note, 'Relance');
});

test('starter list and summary', () => {
  const contacts = CELEBRITY_RACE_STARTER_LIST.map((entry) => normalizeCelebrityContact(entry));
  const influencers = summarizeCelebrityRace(contacts, 'influencer', '2026-11-18');
  const athletes = summarizeCelebrityRace(contacts, 'athlete', '2026-11-18');
  assert.equal(influencers.total, 10);
  assert.equal(influencers.confirmed, 6);
  assert.deepEqual(influencers.byGender, { women: 3, men: 3 });
  assert.equal(athletes.total, 11);
  assert.equal(athletes.confirmed, 3);
  assert.equal(athletes.toAsk, 5);
  assert.equal(athletes.waiting, 3);
});
