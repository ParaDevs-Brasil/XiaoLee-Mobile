/**
 * Testes de `post-images.ts` (fotos do post). Rodar:
 *   node --experimental-strip-types src/lib/post-images.test.ts
 * O módulo importa o seletor do Expo só para `pickPostImages`; aqui só se testam as funções puras.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_IMAGE_BYTES, base64Bytes, mergeImages, moveImage } from './post-images-core.ts';

const img = (n: number, size = 4) => ({ uri: `file:///${n}.jpg`, mime: 'image/jpeg', base64: 'AAAA'.repeat(size) });

test('base64Bytes conta os bytes reais, com e sem padding', () => {
  assert.equal(base64Bytes('QUJD'), 3); // "ABC"
  assert.equal(base64Bytes('QUI='), 2); // "AB"
  assert.equal(base64Bytes('QQ=='), 1); // "A"
});

test('junta sem repetir a mesma foto e para em 4', () => {
  const { images, overLimit } = mergeImages([img(1), img(2)], [img(2), img(3), img(4), img(5)]);
  assert.deepEqual(images.map((i) => i.uri), ['file:///1.jpg', 'file:///2.jpg', 'file:///3.jpg', 'file:///4.jpg']);
  assert.equal(overLimit, 1);
});

test('foto acima de 5 MB é separada, não entra', () => {
  const big = { uri: 'file:///big.jpg', mime: 'image/jpeg', base64: 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) };
  const { images, tooBig } = mergeImages([], [big, img(1)]);
  assert.equal(tooBig, 1);
  assert.deepEqual(images.map((i) => i.uri), ['file:///1.jpg']);
});

test('moveImage reordena e ignora posições inválidas', () => {
  assert.deepEqual(moveImage(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveImage(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveImage(['a', 'b'], 0, 5), ['a', 'b']);
});
