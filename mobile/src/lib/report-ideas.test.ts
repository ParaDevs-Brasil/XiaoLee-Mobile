/**
 * Check das regras de "ideias feitas" do relatório. Roda com:
 *   node --experimental-strip-types src/lib/report-ideas.test.ts
 */
import assert from 'node:assert/strict';

import { doneSummary, ideasStorageKey, parseDone, toggleDone } from './report-ideas.ts';

assert.equal(ideasStorageKey(7), 'xiaolee_report_ideas_done:7');

assert.deepEqual(parseDone('[2,0]', 3), [0, 2]);
assert.deepEqual(parseDone('[0,0,1]', 3), [0, 1]);
assert.deepEqual(parseDone('[0,5,-1,1.5,"1"]', 3), [0]);
assert.deepEqual(parseDone('{"a":1}', 3), []);
assert.deepEqual(parseDone('not json', 3), []);
assert.deepEqual(parseDone(null, 3), []);
assert.deepEqual(parseDone('[0,1]', 0), []);

assert.deepEqual(toggleDone([], 1), [1]);
assert.deepEqual(toggleDone([2], 0), [0, 2]);
assert.deepEqual(toggleDone([0, 2], 2), [0]);

assert.equal(doneSummary(0, 3), '0 of 3 done');
assert.equal(doneSummary(2, 3), '2 of 3 done');
assert.equal(doneSummary(3, 3), 'All 3 done — nice work');
assert.equal(doneSummary(0, 0), '');

console.log('report-ideas: ok');
