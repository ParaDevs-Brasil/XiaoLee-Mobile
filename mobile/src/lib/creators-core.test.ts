/**
 * Check das regras puras dos criadores sintéticos. Roda com:
 *   node --experimental-strip-types src/lib/creators-core.test.ts
 */
import assert from 'node:assert/strict';

import { isVideoPending, maxWords, videoStatusLabel, wordCount } from './creators-core.ts';

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
