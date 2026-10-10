/**
 * Check das regras do fluxo de cortes. Roda com:
 *   node --experimental-strip-types src/lib/clips.test.ts
 *
 * O que mais importa aqui é `clipFlow`: a tela de um vídeo decide o que
 * mostrar só por ele, então um passo errado deixa o creator sem botão (ou com
 * o botão de gerar de novo enquanto ainda renderiza).
 */
import assert from 'node:assert/strict';

import {
  addGlossaryTerms,
  clipExcerpt,
  clipFileName,
  clipFlow,
  clipsPollMs,
  formatClipSpan,
  formatBytes,
  formatClock,
  formatEta,
  GLOSSARY_MAX_TERMS,
  isStale,
  mediaFilterCounts,
  mediaFilterOf,
  mediaListStatus,
  pendingSuggestions,
  mediaPollMs,
  STALE_MS,
  uploadEtaSeconds,
} from './clips.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('clips');

const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const FRESH = '2026-10-09T17:55:00.123456+00:00';
const OLD = '2026-10-09T11:00:00.123456+00:00'; // 7 h antes de NOW (o prazo de travado é 6 h)

const video = (
  status: 'pending' | 'uploaded' | 'transcribing' | 'transcribed' | 'failed' | 'expired',
  error: string | null = null,
  updated_at: string | null = FRESH,
) => ({ kind: 'video' as const, status, error, updated_at });

const clip = (status: 'pending' | 'rendering' | 'ready' | 'failed', updated_at: string | null = FRESH) => ({
  status,
  updated_at,
});

test('upload não confirmado e transcrição em andamento', () => {
  assert.deepEqual(clipFlow(video('pending'), [], NOW), { step: 'upload-incomplete' });
  assert.deepEqual(clipFlow(video('uploaded'), [], NOW), { step: 'upload-incomplete' });
  assert.deepEqual(clipFlow(video('transcribing'), [], NOW), { step: 'transcribing' });
});

test('falha na transcrição leva a mensagem do backend (ou uma padrão)', () => {
  assert.deepEqual(clipFlow(video('failed', 'quota'), [], NOW), { step: 'transcription-failed', error: 'quota' });
  assert.equal((clipFlow(video('failed'), [], NOW) as { error: string }).error, 'The transcription failed.');
});

test('áudio transcrito não gera corte', () => {
  assert.deepEqual(clipFlow({ kind: 'audio', status: 'transcribed', error: null, updated_at: null }, [], NOW), {
    step: 'audio-only',
  });
});

test('vídeo transcrito sem cortes pede o layout', () => {
  assert.deepEqual(clipFlow(video('transcribed'), [], NOW), { step: 'choose-layout' });
});

test('renderizando enquanto houver corte pending/rendering; senão done', () => {
  assert.deepEqual(
    clipFlow(video('transcribed'), [clip('ready'), clip('rendering'), clip('pending')], NOW),
    { step: 'rendering', ready: 1, total: 3 },
  );
  assert.deepEqual(
    clipFlow(video('transcribed'), [clip('ready'), clip('failed'), clip('ready')], NOW),
    { step: 'done', ready: 2, failed: 1 },
  );
});

test('transcrição parada há mais de STALE_MS vira stalled; recém-escrita (null) não', () => {
  assert.deepEqual(clipFlow(video('transcribing', null, OLD), [], NOW), { step: 'transcription-stalled' });
  assert.deepEqual(clipFlow(video('transcribing', null, null), [], NOW), { step: 'transcribing' });
});

test('render só trava quando TODOS os cortes em andamento envelheceram (regra do backend)', () => {
  assert.deepEqual(
    clipFlow(video('transcribed'), [clip('ready'), clip('rendering', OLD), clip('pending', OLD)], NOW),
    { step: 'rendering-stalled', ready: 1, total: 3 },
  );
  assert.deepEqual(
    clipFlow(video('transcribed'), [clip('rendering', OLD), clip('pending', FRESH)], NOW),
    { step: 'rendering', ready: 0, total: 2 },
  );
});

test('isStale aceita microssegundos e fuso, e respeita o limite', () => {
  assert.equal(isStale(OLD, NOW), true);
  assert.equal(isStale(FRESH, NOW), false);
  assert.equal(isStale(new Date(NOW - STALE_MS + 1000).toISOString(), NOW), false);
  assert.equal(isStale('garbage', NOW), false);
});

test('consulta o backend só enquanto ele trabalha', () => {
  assert.equal(mediaPollMs('transcribing'), 3_000);
  assert.equal(mediaPollMs('transcribed'), undefined);
  assert.equal(mediaPollMs(undefined), undefined);
  assert.equal(clipsPollMs([clip('ready'), clip('rendering')]), 4_000);
  assert.equal(clipsPollMs([clip('ready'), clip('failed')]), undefined);
  assert.equal(clipsPollMs(null), undefined);
});

test('formatClock com e sem hora', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(75.9), '1:15');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-3), '0:00');
});

test('formatClipSpan mostra o trecho e a duração', () => {
  assert.equal(formatClipSpan(754, 785.4), '12:34–13:05 · 31s');
});

const segments = [
  { start: 0, end: 5, text: 'Intro que fica de fora.' },
  { start: 5, end: 10, text: ' Primeira  frase do corte,' },
  { start: 10, end: 15, text: 'segunda frase do corte.' },
  { start: 15, end: 20, text: 'Depois do corte.' },
];

test('clipExcerpt pega só os segmentos que tocam o corte', () => {
  assert.equal(clipExcerpt(segments, 5, 15), 'Primeira frase do corte, segunda frase do corte.');
});

test('clipExcerpt corta em palavra inteira, sem pontuação pendurada', () => {
  assert.equal(clipExcerpt(segments, 5, 15, 26), 'Primeira frase do corte…');
  assert.equal(clipExcerpt([], 0, 10), '');
});

test('addGlossaryTerms separa por vírgula/linha e ignora repetido', () => {
  const { terms, rejected } = addGlossaryTerms(['XiaoLee'], 'xiaolee, Arc  Testnet\nUSDC,, ');
  assert.deepEqual(terms, ['XiaoLee', 'Arc Testnet', 'USDC']);
  assert.deepEqual(rejected, []);
});

test('addGlossaryTerms recusa termo longo demais e o que passa do limite', () => {
  const long = 'x'.repeat(41);
  assert.deepEqual(addGlossaryTerms([], long).rejected, [long]);
  const full = Array.from({ length: GLOSSARY_MAX_TERMS }, (_, i) => `t${i}`);
  assert.deepEqual(addGlossaryTerms(full, 'extra'), { terms: full, rejected: ['extra'] });
});

test('clipFileName: sem acento/símbolo, com o id do corte', () => {
  assert.equal(clipFileName({ id: 7, title: 'Por que o USDC na Arc é rápido?' }), 'xiaolee-por-que-o-usdc-na-arc-e-rapido-7.mp4');
  assert.equal(clipFileName({ id: 3, title: '🔥!!' }), 'xiaolee-clip-3.mp4');
  assert.ok(clipFileName({ id: 1, title: 'a'.repeat(100) }).length <= 'xiaolee--1.mp4'.length + 48);
});

console.log('clips · lista');

const item = (
  status: 'pending' | 'uploaded' | 'transcribing' | 'transcribed' | 'failed' | 'expired',
  [clips_total, clips_ready, clips_in_progress] = [0, 0, 0],
  kind: 'video' | 'audio' = 'video',
) => ({ kind, status, clips_total, clips_ready, clips_in_progress });

test('mediaListStatus: transcrito com cortes renderizando NÃO é "pronto"', () => {
  assert.deepEqual(mediaListStatus(item('transcribed', [3, 1, 2])), {
    label: 'Rendering 1/3',
    group: 'processing',
    tone: 'progress',
  });
  assert.deepEqual(mediaListStatus(item('transcribed', [3, 3, 0])), {
    label: '3 clips ready',
    group: 'ready',
    tone: 'success',
  });
});

test('mediaListStatus: sem cortes pede ação; falhas parciais e totais', () => {
  assert.equal(mediaListStatus(item('transcribed')).label, 'Generate clips');
  assert.equal(mediaListStatus(item('transcribed')).group, 'attention');
  assert.equal(mediaListStatus(item('transcribed', [3, 2, 0])).label, '2 of 3 ready');
  assert.deepEqual(mediaListStatus(item('transcribed', [3, 0, 0])), {
    label: 'Render failed',
    group: 'attention',
    tone: 'danger',
  });
  assert.equal(mediaListStatus(item('transcribed', [1, 1, 0])).label, '1 clip ready');
});

test('mediaListStatus: estados antes dos cortes e áudio', () => {
  assert.equal(mediaListStatus(item('transcribing')).label, 'Transcribing');
  assert.equal(mediaListStatus(item('failed')).group, 'attention');
  assert.equal(mediaListStatus(item('pending')).label, 'Upload incomplete');
  assert.equal(mediaListStatus(item('uploaded')).group, 'attention');
  assert.equal(mediaListStatus(item('transcribed', [0, 0, 0], 'audio')).label, 'Audio only');
});

test('mediaFilterCounts soma pelo estado real (cortes incluídos) e "all" é o total', () => {
  const counts = mediaFilterCounts([
    item('transcribed', [3, 3, 0]),
    item('transcribed', [3, 1, 2]), // renderizando: processing, não ready
    item('transcribing'),
    item('failed'),
    item('pending'),
  ]);
  assert.deepEqual(counts, { all: 5, processing: 2, ready: 1, attention: 2 });
  assert.equal(mediaFilterOf(item('transcribed', [3, 1, 2])), 'processing');
});

test('formatBytes escolhe a unidade', () => {
  assert.equal(formatBytes(2_300_000_000), '2.1 GB');
  assert.equal(formatBytes(420 * 1024 ** 2), '420 MB');
  assert.equal(formatBytes(900), '1 KB');
});

test('uploadEtaSeconds só estima quando o ritmo já é confiável', () => {
  assert.equal(uploadEtaSeconds(1, 10_000), null); // menos de 3%
  assert.equal(uploadEtaSeconds(40, 2_000), null); // menos de 4 s medidos
  assert.equal(uploadEtaSeconds(100, 60_000), null); // terminou
  assert.equal(uploadEtaSeconds(25, 30_000), 90); // 25% em 30 s → faltam 90 s
});

test('formatEta fala em minutos e horas, sem falsa precisão', () => {
  assert.equal(formatEta(20), 'less than a minute left');
  assert.equal(formatEta(60), 'about 1 min left');
  assert.equal(formatEta(130), 'about 2 min left');
  assert.equal(formatEta(3600), 'about 1 h left');
  assert.equal(formatEta(4000), 'about 1 h 7 min left');
});

test('vídeo expirado (retenção do backend) não oferece gerar nem tocar', () => {
  assert.deepEqual(clipFlow(video('expired'), [], NOW), { step: 'expired' });
  assert.deepEqual(mediaListStatus(item('expired')), { label: 'Expired', group: 'attention', tone: 'muted' });
});

test('transcrição longa legítima (2 h) ainda não é "travada"', () => {
  const twoHoursAgo = new Date(NOW - 2 * 60 * 60_000).toISOString();
  assert.deepEqual(clipFlow(video('transcribing', null, twoHoursAgo), [], NOW), { step: 'transcribing' });
});

test('pendingSuggestions esconde o que já está na lista, repetidas e respeita limite e glossário cheio', () => {
  const sug = [
    { term: 'XiaoLee', count: 9 },
    { term: 'Arc', count: 5 },
    { term: 'arc', count: 4 },
    { term: 'Wesley', count: 3 },
    { term: '  ', count: 2 },
  ];
  assert.deepEqual(
    pendingSuggestions(sug, ['xiaolee']).map((s) => s.term),
    ['Arc', 'Wesley'],
  );
  assert.deepEqual(pendingSuggestions(sug, [], 1).map((s) => s.term), ['XiaoLee']);
  const full = Array.from({ length: GLOSSARY_MAX_TERMS }, (_, i) => `t${i}`);
  assert.deepEqual(pendingSuggestions(sug, full), []);
});

