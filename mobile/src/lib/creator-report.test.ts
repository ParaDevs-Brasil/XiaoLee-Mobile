/**
 * Check das regras da tela do relatório de 30 dias. Roda com:
 *   node --experimental-strip-types src/lib/creator-report.test.ts
 */
import assert from 'node:assert/strict';

import {
  formatMetricValue,
  isEmptyPeriod,
  nextReportLabel,
  reportHighlights,
  reportIdOf,
  reportMetricRows,
  reportPeriodLabel,
} from './creator-report.ts';

assert.equal(reportIdOf({ kind: 'creator_report', report_id: 7 }), 7);
assert.equal(reportIdOf({ kind: 'creator_report', report_id: '7' }), 7);
assert.equal(reportIdOf({ kind: 'creator_report', report_id: 0 }), null);
assert.equal(reportIdOf({ kind: 'campaign_claim', report_id: 7 }), null);
assert.equal(reportIdOf({}), null);
assert.equal(reportIdOf(null), null);

const rows = reportMetricRows(
  {
    videos: 3,
    video_minutes: 12.25,
    clips: 0,
    campaigns_joined: 1,
    usdc_received: 7.5,
  },
  { videos: 1, video_minutes: 12.25, clips: 4, campaigns_joined: 0 },
);
const by = Object.fromEntries(rows.map((r) => [r.key, r]));
assert.deepEqual(
  rows.map((r) => r.key),
  ['videos', 'video_minutes', 'clips', 'campaigns_joined', 'usdc_received'],
);
assert.equal(by.videos.value, '3');
assert.equal(by.videos.delta, '+2 vs previous 30 days');
assert.equal(by.videos.tone, 'up');
assert.deepEqual([by.videos.now, by.videos.before], [3, 1]);
assert.deepEqual([by.usdc_received.now, by.usdc_received.before], [7.5, 0]);
assert.equal(by.video_minutes.value, '12.3');
assert.equal(by.video_minutes.delta, 'Same as before');
assert.equal(by.clips.delta, '−4 vs previous 30 days');
assert.equal(by.clips.tone, 'down');
assert.equal(by.campaigns_joined.tone, 'new');
assert.equal(by.usdc_received.value, '7.50');
assert.equal(by.usdc_received.delta, 'New this period');

const zeros = reportMetricRows({}, {});
assert.ok(zeros.every((r) => r.value === '0' || r.value === '0.00'));
assert.ok(zeros.every((r) => r.delta === '' && r.tone === 'flat'));
assert.equal(isEmptyPeriod({}), true);
assert.equal(isEmptyPeriod({ clips: 1 }), false);

assert.equal(
  reportPeriodLabel('2026-09-16T12:00:00', '2026-10-16T12:00:00'),
  'Sep 16 – Oct 16, 2026',
);
assert.equal(
  reportPeriodLabel('2026-09-30T23:30:00', '2026-10-30T23:30:00Z'),
  'Sep 30 – Oct 30, 2026',
);
assert.equal(reportPeriodLabel('nope', '2026-10-16T12:00:00'), '');

assert.equal(nextReportLabel('2026-10-16T12:00:00'), 'Nov 15');
assert.equal(nextReportLabel('nope'), '');

assert.equal(formatMetricValue('videos', 2.6), '3');
assert.equal(formatMetricValue('video_minutes', 12.25), '12.3');
assert.equal(formatMetricValue('usdc_received', 7.5), '7.50');
assert.equal(formatMetricValue('usdc_received', 0), '0.00');

// videos/minutos/cortes/campanhas: 3 subiram (um é "new"), 1 caiu, 1 igual.
assert.deepEqual(reportHighlights(rows), { up: 3, down: 1 });
assert.deepEqual(reportHighlights(zeros), { up: 0, down: 0 });

console.log('creator-report: ok');
