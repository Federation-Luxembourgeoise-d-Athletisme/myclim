import test from 'node:test';
import assert from 'node:assert/strict';

import { pickQrSource } from '../src/app/qr-link-sources.js';

test('a QR resource without its own link takes the planned MyCLIM source', () => {
  assert.equal(pickQrSource({ id: 'results-live', url: '' }, 'results'), 'results');
});

test('a QR resource with its own link or document keeps it', () => {
  assert.equal(pickQrSource({ url: 'https://x/roadbook' }, 'athleteRoadbook'), '');
  assert.equal(pickQrSource({ documentId: 'doc1' }, 'photos'), '');
});

test('a saved choice wins, even "typed by hand" (empty source)', () => {
  assert.equal(pickQrSource({ source: '' }, 'photos'), '');
  assert.equal(pickQrSource({ source: 'emagazine', url: 'https://old' }, 'results'), 'emagazine');
});

test('unknown sources are ignored', () => {
  assert.equal(pickQrSource({ source: 'nope' }, 'results'), '');
});
