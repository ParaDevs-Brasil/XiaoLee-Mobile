/**
 * Check das regras da Dashboard do criador. Roda com:
 *   node --experimental-strip-types src/lib/creator-home-core.test.ts
 */
import assert from 'node:assert/strict';

import { aiSpend, claimable, earnings, nextStep } from './creator-home-core.ts';
import type { WalletReceipt } from './creator-wallet';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('creator-home-core');

const NOW = Date.parse('2026-10-22T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const receipt = (over: Partial<WalletReceipt>): WalletReceipt => ({
  id: 'r', source: 'campaign', title: 't', payer: null, amountUsdc: 1, txHash: null, createdAt: day(1), status: 'confirmed', ...over,
});

test('earnings: 30-day window vs all time, only confirmed, split by source', () => {
  const { last30, all } = earnings(
    [
      receipt({ amountUsdc: 2, createdAt: day(3) }),
      receipt({ amountUsdc: 5, source: 'purchase', createdAt: day(10) }),
      receipt({ amountUsdc: 7, createdAt: day(45) }),
      receipt({ amountUsdc: 9, status: 'pending', createdAt: day(1) }),
    ],
    NOW,
  );
  assert.equal(last30.total, 7);
  assert.equal(last30.purchase, 5);
  assert.equal(all.total, 14);
});

test('aiSpend ignores failed videos (they are refunded)', () => {
  assert.equal(aiSpend([{ status: 'done', price_usdc: 1.26 }, { status: 'failed', price_usdc: 5 }, { status: 'video', price_usdc: 0.7 }]), 1.96);
  assert.equal(aiSpend([]), 0);
});

test('claimable counts verified, unclaimed rewards', () => {
  const c = claimable([
    { participation_status: 'tasks_verified', tasks_claimed: false, reward_per_participant: 0.3 },
    { participation_status: 'tasks_verified', tasks_claimed: true, reward_per_participant: 1 },
    { participation_status: 'joined', tasks_claimed: false, reward_per_participant: 2 },
    { participation_status: 'tasks_verified', tasks_claimed: false, reward_per_participant: 0.5 },
  ]);
  assert.equal(c.count, 2);
  assert.equal(c.usdc.toFixed(2), '0.80');
});

test('next step: money waiting beats everything', () => {
  const s = nextStep({
    campaigns: [{ participation_status: 'tasks_verified', tasks_claimed: false, reward_per_participant: 0.5 }],
    videos: [],
    uploads: 0,
  });
  assert.equal(s.id, 'claim');
  assert.equal(s.title, 'Claim 0.50 USDC');
});

test('next step: first creation, then clips, then a campaign, then keep going', () => {
  assert.equal(nextStep({ campaigns: [], videos: [], uploads: 0 }).id, 'first-video');
  assert.equal(nextStep({ campaigns: [], videos: [{ status: 'done', price_usdc: 1 }], uploads: 0 }).id, 'first-clips');
  assert.equal(nextStep({ campaigns: [], videos: [{ status: 'done', price_usdc: 1 }], uploads: 2 }).id, 'join-campaign');
  assert.equal(nextStep({ campaigns: [{ participation_status: 'joined', tasks_claimed: false, reward_per_participant: 1 }], videos: [{ status: 'done', price_usdc: 1 }], uploads: 2 }).id, 'keep-creating');
});

test('next step never claims "first" about something it could not read', () => {
  assert.equal(nextStep({ campaigns: null, videos: null, uploads: null }).id, 'keep-creating');
  assert.equal(nextStep({ campaigns: [], videos: null, uploads: 3 }).id, 'join-campaign');
});
