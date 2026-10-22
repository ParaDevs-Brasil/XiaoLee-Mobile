/**
 * Check do formatador de texto da Xiaolee. Roda com:
 *   node --experimental-strip-types src/lib/rich-text-core.test.ts
 */
import assert from 'node:assert/strict';

import { parseInline } from './rich-text-core.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('rich-text-core');

test('bold, code and italic come out as spans and the markers disappear', () => {
  assert.deepEqual(parseInline('Your wallet (`0xe8EC…7999`) has **85.1 USDC** on *Arc*.'), [
    { text: 'Your wallet (' },
    { text: '0xe8EC…7999', code: true },
    { text: ') has ' },
    { text: '85.1 USDC', bold: true },
    { text: ' on ' },
    { text: 'Arc', italic: true },
    { text: '.' },
  ]);
});

test('plain text and stray asterisks are left alone', () => {
  assert.deepEqual(parseInline('hello'), [{ text: 'hello' }]);
  assert.deepEqual(parseInline(''), [{ text: '' }]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ text: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('* item one'), [{ text: '* item one' }]);
  assert.deepEqual(parseInline('a **unclosed'), [{ text: 'a **unclosed' }]);
});

test('two bold parts in a row stay separate', () => {
  assert.deepEqual(
    parseInline('**a** and **b**').map((s) => [s.text, !!s.bold]),
    [['a', true], [' and ', false], ['b', true]],
  );
});
