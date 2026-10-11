/**
 * Check das regras do card "Format ideas". Roda com:
 *   node --experimental-strip-types src/lib/format-ideas.test.ts
 */
import assert from 'node:assert/strict';

import { formatIdeaMeta, formatIdeasError, formatIdeasSource, platformLabel } from './format-ideas.ts';

assert.equal(platformLabel('tiktok'), 'TikTok');
assert.equal(platformLabel('x'), 'X');
assert.equal(platformLabel('kwai'), 'kwai');

assert.equal(formatIdeaMeta({ platform: 'tiktok', duration_s: 45 }), 'TikTok · 45 s');
assert.equal(formatIdeaMeta({ platform: 'reels', duration_s: 90 }), 'Reels · 1 min 30 s');
assert.equal(formatIdeaMeta({ platform: 'shorts', duration_s: 120 }), 'Shorts · 2 min');
assert.equal(formatIdeaMeta({ platform: 'x', duration_s: 29.6 }), 'X · 30 s');

assert.match(formatIdeasSource(0), /interests\. Upload a video/);
assert.equal(formatIdeasSource(1), 'Based on your interests and your last video.');
assert.equal(formatIdeasSource(5), 'Based on your interests and your last 5 videos.');

assert.deepEqual(formatIdeasError(503).retry, false);
assert.deepEqual(formatIdeasError(401).retry, false);
assert.deepEqual(formatIdeasError(502).retry, true);
assert.deepEqual(formatIdeasError(null).retry, true);

console.log('format-ideas: ok');
