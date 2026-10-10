/**
 * Check dos helpers de upload de mídia. Roda com:
 *   node --experimental-strip-types src/lib/media.test.ts
 */
import assert from 'node:assert/strict';

import { mediaContentType, uploadPercent } from './media.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('media');

test('usa o MIME do seletor quando é vídeo/áudio', () => {
  assert.equal(mediaContentType('x.bin', 'video/quicktime'), 'video/quicktime');
  assert.equal(mediaContentType('x', 'audio/mpeg'), 'audio/mpeg');
});

test('ignora MIME genérico e deduz pela extensão (case-insensitive)', () => {
  assert.equal(mediaContentType('Podcast Ep1.MP4', 'application/octet-stream'), 'video/mp4');
  assert.equal(mediaContentType('voz.m4a', null), 'audio/mp4');
  assert.equal(mediaContentType('clip.mov'), 'video/quicktime');
});

test('recusa o que não é mídia', () => {
  assert.equal(mediaContentType('doc.pdf', 'application/pdf'), null);
  assert.equal(mediaContentType('sem-extensao', null), null);
});

test('uploadPercent limita a 0–100 e não divide por zero', () => {
  assert.equal(uploadPercent(50, 200), 25);
  assert.equal(uploadPercent(999, 100), 100);
  assert.equal(uploadPercent(-5, 100), 0);
  assert.equal(uploadPercent(10, 0), 0);
});
