/**
 * Check das regras puras dos criadores sintéticos. Roda com:
 *   node --experimental-strip-types src/lib/creators-core.test.ts
 */
import assert from 'node:assert/strict';

import { clampStart, isVideoPending, maxWords, motionDurations, videoStatusLabel, wordCount } from './creators-core.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('creators-core');

test('counts words and matches the backend word cap', () => {
  assert.equal(wordCount('  oi tudo   bem '), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(maxWords(5, 2.6), 13);
  assert.equal(maxWords(15, 2.6), 39);
});

test('labels and pending states', () => {
  assert.match(videoStatusLabel('voice'), /voice/i);
  assert.equal(isVideoPending('video'), true);
  assert.equal(isVideoPending('done'), false);
  assert.equal(isVideoPending('failed'), false);
});

test('a motion video only allows durations it can cover (same 0.5 s slack as the backend)', () => {
  assert.deepEqual(motionDurations([5, 10, 15], 12), [5, 10]);
  assert.deepEqual(motionDurations([5, 10, 15], 4.6), [5]);
  assert.deepEqual(motionDurations([5, 10, 15], 3), []);
  assert.deepEqual(motionDurations([5, 10, 15], 0), []);
});

test('the picked part never runs past the end of the video', () => {
  assert.equal(clampStart(10, 50, 5), 10);
  assert.equal(clampStart(48, 50, 5), 45);
  assert.equal(clampStart(-3, 50, 5), 0);
  assert.equal(clampStart(10, 4, 5), 0);
});
