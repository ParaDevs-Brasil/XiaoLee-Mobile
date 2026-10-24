/**
 * Check do casamento de cards com as mensagens restauradas. Roda com:
 *   node --experimental-strip-types src/lib/chat-cards.test.ts
 *
 * O caso que motiva o arquivo: reabrir uma conversa trazia só o texto e o
 * botão de assinar / o comprovante da transação se perdia.
 */
import assert from 'node:assert/strict';

import { askFrom, campaignsFrom, draftFrom, insightsFrom, matchCards, optionsFrom, radarFrom, trendsFrom, type StoredWithCards } from './chat-cards.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const transfer = { to: '0xdead', amountUsdc: 0.01 };
const stored: StoredWithCards[] = [
  { role: 'user', content: 'envia 0.01', at: '1' },
  { role: 'assistant', content: 'Pronto para enviar', at: '2', transfer, txHash: '0xabc' },
  { role: 'assistant', content: 'Pronto para enviar', at: '3', transfer },
  { role: 'assistant', content: 'só texto', at: '4' },
];

test('devolve o card e o comprovante da mensagem de mesmo texto', () => {
  const [, m] = matchCards(
    [{ role: 'user', content: 'envia 0.01' }, { role: 'assistant', content: 'Pronto para enviar' }],
    stored,
  );
  assert.equal(m?.txHash, '0xabc');
  assert.deepEqual(m?.transfer, transfer);
  assert.equal(m?.at, '2');
});

test('dois pedidos idênticos casam cada um com o seu, na ordem', () => {
  const r = matchCards(
    [{ role: 'assistant', content: 'Pronto para enviar' }, { role: 'assistant', content: 'Pronto para enviar' }],
    stored,
  );
  assert.equal(r[0]?.txHash, '0xabc');
  assert.equal(r[1]?.txHash, undefined);
  assert.equal(r[1]?.at, '3');
});

test('mensagem do usuário e texto sem card não ganham nada', () => {
  const r = matchCards(
    [{ role: 'user', content: 'Pronto para enviar' }, { role: 'assistant', content: 'só texto' }],
    stored,
  );
  assert.equal(r[0], undefined);
  assert.equal(r[1], undefined);
});

test('ignora espaços nas pontas na comparação', () => {
  const [m] = matchCards([{ role: 'assistant', content: '  Pronto para enviar\n' }], stored);
  assert.equal(m?.at, '2');
});

test('card de swap (pendente e assinado) também volta', () => {
  const swap = { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1' };
  const withSwap: StoredWithCards[] = [
    { role: 'assistant', content: 'Preparei o swap', at: '9', swap, swapTxHash: '0xfeed', swapAmountOut: '1.25' },
  ];
  const [m] = matchCards([{ role: 'assistant', content: 'Preparei o swap' }], withSwap);
  assert.deepEqual(m?.swap, swap);
  assert.equal(m?.swapTxHash, '0xfeed');
  assert.equal(m?.swapAmountOut, '1.25');
});

test('o card de post e o link publicado sobrevivem a reabrir a conversa', () => {
  const post = { platform: 'bluesky', handle: '@ana', text: 'oi', clipId: 3 };
  const [m] = matchCards(
    [{ role: 'assistant', content: 'Posto?' }],
    [{ role: 'assistant', content: 'Posto?', at: '9', post, postUrl: 'https://bsky.app/x' }],
  );
  assert.deepEqual(m?.post, post);
  assert.equal(m?.postUrl, 'https://bsky.app/x');
});

test('o card de métricas vem do execution do backend e sobrevive a reabrir a conversa', () => {
  const insights = insightsFrom({
    status: 'insights_ready',
    insights: {
      platform: 'x', handle: '@ana', followers: 91, posts_total: 169, window_days: 29, engagement_rate: 9.3,
      totals: { posts: 2, impressions: 86, engagements: 8, profile_clicks: 1, link_clicks: 1 },
      top_posts: [{ text: 'oi', url: 'https://x.com/i/status/1', impressions: 60, likes: 4 }],
    },
  });
  assert.equal(insights?.followers, 91);
  assert.equal(insights?.totals.profileClicks, 1);
  assert.equal(insights?.topPosts[0].impressions, 60);
  assert.equal(insightsFrom({ status: 'post_ready' }), undefined);
  const [m] = matchCards(
    [{ role: 'assistant', content: 'Seu perfil:' }],
    [{ role: 'assistant', content: 'Seu perfil:', at: '9', insights }],
  );
  assert.deepEqual(m?.insights, insights);
});

test('formulário de rascunho e opções de post vêm do execution e voltam ao reabrir a conversa', () => {
  const draft = draftFrom({ status: 'draft_open', draft: { networks: [{ platform: 'x', handle: '@ana' }] } });
  assert.deepEqual(draft, { networks: [{ platform: 'x', handle: '@ana' }] });
  assert.equal(draftFrom({ status: 'draft_open', draft: { networks: [] } }), undefined);
  assert.equal(draftFrom({ status: 'post_ready' }), undefined);

  const options = optionsFrom({ status: 'post_options', options: { platform: 'x', handle: '@ana', texts: ['a', ' b ', ''] } });
  assert.deepEqual(options, { platform: 'x', handle: '@ana', texts: ['a', 'b'] });
  assert.equal(optionsFrom({ status: 'post_options', options: { platform: 'x', texts: ['só uma'] } }), undefined);

  const [m] = matchCards(
    [{ role: 'assistant', content: 'Escolhe:' }],
    [{ role: 'assistant', content: 'Escolhe:', at: '9', draft, options }],
  );
  assert.deepEqual(m?.draft, draft);
  assert.deepEqual(m?.options, options);
});

test('radar: só o card pendente com job vira card; qualquer outra coisa é ignorada', () => {
  assert.deepEqual(radarFrom({ status: 'radar_pending', radar: { job_id: 'abc', niche: 'IA' } }), {
    jobId: 'abc', niche: 'IA', status: 'pending', trends: [],
  });
  assert.equal(radarFrom({ status: 'radar_pending', radar: {} }), undefined);
  assert.equal(radarFrom({ status: 'post_ready' }), undefined);
  assert.equal(radarFrom(undefined), undefined);
});

test('radar: tendências sem tópico caem, no máximo 5, campos ausentes viram texto vazio', () => {
  const t = trendsFrom([{ topic: ' A ', why: 'w' }, { why: 'sem topic' }, null, ...Array.from({ length: 8 }, (_, i) => ({ topic: `t${i}` }))]);
  assert.equal(t.length, 5);
  assert.deepEqual(t[0], { topic: 'A', why: 'w', hook: '', angles: [] });
  assert.deepEqual(trendsFrom('lixo'), []);
});

test('radar: o resultado guardado volta junto da mensagem ao reabrir a conversa', () => {
  const radar = { jobId: 'abc', niche: 'IA', status: 'ready' as const, trends: [{ topic: 'A', why: '', hook: '', angles: [] }] };
  const out = matchCards(
    [{ role: 'assistant', content: 'Fui vasculhar o X' }],
    [{ role: 'assistant', content: 'Fui vasculhar o X', at: '9', radar }],
  );
  assert.deepEqual(out[0]?.radar, radar);
});

test('askFrom: cartão de perguntas só com status ask_open e pelo menos uma pergunta', () => {
  assert.equal(askFrom(undefined), undefined);
  assert.equal(askFrom({ status: 'ask_open', ask: { questions: [] } }), undefined);
  const ask = askFrom({
    status: 'ask_open',
    ask: { mode: 'form', title: 'Plan', questions: [{ id: 'q0', label: 'Goal?', short: 'Goal', options: ['A', ' B '], multi: true, other: true }] },
  });
  assert.deepEqual(ask, {
    mode: 'form', title: 'Plan',
    questions: [{ id: 'q0', label: 'Goal?', short: 'Goal', options: ['A', 'B'], multi: true, other: true }],
  });
  assert.equal(askFrom({ status: 'ask_open', ask: { questions: [{ label: 'x', options: [] }] } })?.mode, 'wizard');
});

test('campaignsFrom: só com status campaigns_listed, até 5 ids inteiros', () => {
  assert.equal(campaignsFrom(undefined), undefined);
  assert.equal(campaignsFrom({ status: 'campaigns_listed', campaign_ids: [] }), undefined);
  assert.deepEqual(campaignsFrom({ status: 'campaigns_listed', campaign_ids: [3, '4', 'x', 5, 6, 7, 8] }), { ids: [3, 4, 5, 6, 7] });
  assert.equal(campaignsFrom({ status: 'info', campaign_ids: [1] }), undefined);
});
