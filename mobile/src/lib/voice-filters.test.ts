import assert from 'node:assert/strict';
import test from 'node:test';

import { accentOf, activeCount, matchesFilters, NO_FILTERS, toneOf } from './voice-filters.ts';
import { toggleFavorite } from './voice-favorites.ts';

const v = (gender: 'female' | 'male', description: string, category = 'Narrators') => ({ gender, description, category });

test('tone is read from the description', () => {
  assert.equal(toneOf(v('male', 'Deep cinematic announcer')), 'deep');
  assert.equal(toneOf(v('female', 'Soft, Calm, Soothing')), 'soft');
  assert.equal(toneOf(v('female', 'Bright, Energetic, Expressive')), 'bright');
  assert.equal(toneOf(v('female', 'Confident')), null);
});

test('accent comes from category and description', () => {
  assert.equal(accentOf(v('male', 'Narrator', 'Brazilian')), 'brazilian');
  assert.equal(accentOf(v('male', 'The Gruff Old British Wizard', 'Wise')), 'british');
  assert.equal(accentOf(v('male', 'Evil & Villainous', 'Villains')), 'other');
});

test('filters combine and count', () => {
  const wizard = v('male', 'The Gruff Old British Wizard', 'Wise');
  assert.equal(matchesFilters(wizard, NO_FILTERS), true);
  assert.equal(matchesFilters(wizard, { gender: 'female', tone: null, accent: null }), false);
  assert.equal(matchesFilters(wizard, { gender: 'male', tone: 'deep', accent: 'british' }), true);
  assert.equal(activeCount({ gender: 'male', tone: 'deep', accent: null }), 2);
});

test('toggleFavorite adds then removes', () => {
  assert.deepEqual(toggleFavorite(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleFavorite(['a', 'b'], 'a'), ['b']);
});
