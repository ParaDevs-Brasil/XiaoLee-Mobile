import * as WebBrowser from 'expo-web-browser';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getTractionStats, type PaymentEvent } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import {
  IconActivity,
  IconChevronRight,
  IconDollar,
  IconInbox,
  IconUser,
  IconUsers,
  IconZap,
} from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Sparkline } from '@/components/sparkline';
import { MiniStat, StatCard } from '@/components/stat-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useTractionStream } from '@/hooks/use-traction-stream';
import { isOnChainTx, txExplorerUrl } from '@/lib/explorer';
import { formatUSDC, shortHash, timeAgo } from '@/lib/format';

/**
 * Tela de Traction — o painel público de USDC liquidado pelo agente na Arc.
 *
 * Porta `frontend/src/app/traction/page.tsx` para o vocabulário do mobile. A
 * rota (`GET /v1/traction/stats`) é pública: não exige sessão, então esta é a
 * única tela do app que mostra dado real sem login — de propósito, é a que o
 * júri do hackathon abre.
 *
 * A hierarquia é deliberada: o total liquidado é a métrica que a tela existe
 * para comunicar, então ele vem sozinho e grande, e as outras três descem para
 * uma faixa de apoio. Numa grade de quatro cartões iguais, como era antes, o
 * número que importa lia com o mesmo peso de "Registered".
 */

/** Acima disto a liquidação deixa de parecer instantânea — mesmo corte do web. */
const LATENCY_OK_MS = 500;

export default function TractionScreen() {
  const colors = useTheme();
  const styles = useStyles();
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  // `getTractionStats` é função de módulo, então a identidade é estável e o
  // hook não recarrega a cada render.
  const { data, error, loading, refreshing, reload } = useBackendData(getTractionStats);

  // O stream é uma camada por cima, não um substituto: o polling continua
  // sendo o que garante a primeira carga e o puxar-para-atualizar em rede que
  // não sustenta conexão longa. Quando o stream conecta, ele manda um snapshot
  // inteiro e passa a ser a fonte — daí `live` vencer `data` quando existe.
  const { live, connected } = useTractionStream();
  const snapshot = live ?? data;

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <PageHeading
          title="Traction"
          subtitle="USDC the agent has settled on Arc — pull to refresh."
        />

        {/* Aparece mesmo com dado na tela: uma recarga que falhou em silêncio
            faria o usuário ler números velhos como se fossem atuais. */}
        {error ? (
          <ErrorState title="Couldn't load traction" message={error} onRetry={reload} />
        ) : null}

        {loading && !snapshot ? <TractionSkeleton /> : null}

        {snapshot ? (
          <>
            <TractionHero
              total={snapshot.total_usdc}
              payments={snapshot.total_payments}
              feed={snapshot.feed}
            />

            <View style={styles.strip}>
              <MiniStat
                Icon={IconActivity}
                label="Payments"
                value={String(snapshot.total_payments)}
              />
              <MiniStat
                Icon={IconUsers}
                label="Active creators"
                value={String(snapshot.active_creators)}
              />
              <MiniStat
                Icon={IconUser}
                label="Registered"
                value={String(snapshot.registered_creators)}
              />
            </View>

            <LatencyBar
              avg={snapshot.avg_latency_ms}
              p95={snapshot.p95_latency_ms}
              payments={snapshot.total_payments}
            />

            <SectionCard
              title="Payment feed"
              subtitle="Newest first · tap a row to verify on Arc"
              action={connected ? <LiveBadge /> : null}
            >
              {snapshot.feed.length === 0 ? (
                <EmptyState
                  Icon={IconInbox}
                  title="No payments yet"
                  text="When the agent settles a nanopayment, it lands here."
                />
              ) : (
                snapshot.feed.map((event) => <FeedRow key={event.intent_id} event={event} />)
              )}
            </SectionCard>
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

/**
 * Selo de stream conectado.
 *
 * Sem ele não há como distinguir "nada aconteceu" de "a conexão caiu e a tela
 * congelou" — e as duas coisas parecem idênticas numa tela parada. Fica no
 * cabeçalho do feed porque é ali que as linhas novas nascem.
 */
function LiveBadge() {
  const styles = useStyles();
  return (
    <View style={styles.live}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>Live</Text>
    </View>
  );
}

/** Contrato de stat tile: doze pontos de tendência, nem mais nem menos. */
const SPARK_POINTS = 12;
/** Com menos que isto não há forma para ler — dois pontos não são tendência. */
const SPARK_MIN_POINTS = 3;

/**
 * O número que a tela existe para comunicar.
 *
 * O total sozinho é um enquadramento fraco de um ativo forte: um nanopagamento
 * gira em torno de 5 USDC (`creator_pay_tools.py`), então o acumulado de uma
 * campanha é de dezenas de dólares — e dezenas de dólares em 48px lê como
 * "foi só isso". O que reposiciona o número é a frase em volta dele: quem
 * pagou foi o agente, sozinho, e valor baixo é o **ponto** de um trilho de
 * nanopagamento, não uma limitação.
 *
 * Daí o herói carregar três coisas em vez do número seco: o rótulo diz quem
 * pagou, a linha de apoio diz quantos e quando, e o sparkline mostra o agente
 * dimensionando cada pagamento — que é o acumulado virando fluxo.
 */
function TractionHero({
  total,
  payments,
  feed,
}: {
  total: number;
  payments: number;
  feed: PaymentEvent[];
}) {
  const spark = sparkValues(feed);

  return (
    <StatCard
      size="lg"
      tone="accent"
      Icon={IconDollar}
      label="USDC settled by the agent"
      value={`$${formatUSDC(total)}`}
      sub={heroSubLabel(payments, feed)}
      chart={
        spark ? (
          <Sparkline
            values={spark}
            caption={`Last ${spark.length} settlements · the agent sizes each one`}
          />
        ) : null
      }
    />
  );
}

/**
 * Os pontos do sparkline, do mais antigo para o mais recente.
 *
 * O feed vem do backend do mais novo para o mais antigo (`metrics.py` insere
 * na posição 0), então inverter é o que faz o tempo correr para a direita.
 *
 * O que está plotado é o valor de cada pagamento, não o acumulado: o acumulado
 * sobre uma janela dos últimos doze começaria do zero e daria a entender que
 * nada foi pago antes dela. Valor por pagamento também é o dado mais
 * interessante — a variação entre as barras é o agente decidindo quanto cada
 * creator vale, que é literalmente o que `pay_creator_nanopayment` pede a ele.
 */
function sparkValues(feed: PaymentEvent[]): number[] | null {
  if (feed.length < SPARK_MIN_POINTS) return null;
  return feed
    .slice(0, SPARK_POINTS)
    .map((event) => event.amount)
    .reverse();
}

/**
 * Linha de apoio do herói: quantos pagamentos e há quanto tempo foi o último.
 *
 * O acumulado sozinho não diz se a coisa está viva — "$412.80" pode ser de
 * hoje ou do mês passado.
 */
function heroSubLabel(payments: number, feed: PaymentEvent[]): string {
  const unit = payments === 1 ? 'nanopayment' : 'nanopayments';
  const latest = feed[0];
  if (!latest) return `${payments} ${unit}`;

  // `timeAgo` devolve vazio se a data não parsear — nesse caso corta o trecho
  // em vez de escrever "last ".
  const ago = timeAgo(latest.ts);
  return ago ? `${payments} ${unit} · last ${ago}` : `${payments} ${unit}`;
}

/**
 * Saúde da liquidação em uma linha.
 *
 * Três estados, não dois: rápido, degradado e sem medida. Degradado é âmbar
 * (`warn`) e não vermelho — o pagamento liquidou, só que devagar, e pintar
 * isso de `danger` faria a tela anunciar uma falha que não houve.
 *
 * O verde daqui é o único que **não** virou acento quando o resto da tela
 * padronizou em rosa: verde/âmbar/vermelho aqui é escala de estado, não
 * decoração. Pintar "rápido" de rosa deixaria "degradado" em âmbar sem começo
 * de escala, e a linha pararia de comunicar saúde.
 */
function LatencyBar({ avg, p95, payments }: { avg: number; p95: number; payments: number }) {
  const colors = useTheme();
  const styles = useStyles();
  // Sem pagamento nenhum a média chega como 0, que passa no teste de "rápido"
  // e anunciaria liquidação instantânea numa tela que nunca liquidou nada.
  if (payments === 0) {
    return (
      <View style={[styles.latency, styles.latencyIdle]}>
        <View style={[styles.latencyIcon, styles.latencyIconIdle]}>
          <IconZap size={18} color={colors.ink3} />
        </View>

        <View style={styles.flex}>
          <Text style={styles.latencyIdleTitle}>No settlements measured yet</Text>
          <Text style={styles.latencySub}>Decision to on-chain settlement</Text>
        </View>
      </View>
    );
  }

  const ok = avg < LATENCY_OK_MS;
  const color = ok ? colors.success : colors.warn;

  return (
    <View style={[styles.latency, ok ? styles.latencyOk : styles.latencyWarn]}>
      <View style={[styles.latencyIcon, ok ? styles.latencyIconOk : styles.latencyIconWarn]}>
        <IconZap size={18} color={color} />
      </View>

      <View style={styles.flex}>
        <Text style={[styles.latencyTitle, { color }]}>
          {ok ? 'Settlement is fast' : 'Settlement is degraded'} · {Math.round(avg)}ms avg
        </Text>
        <Text style={styles.latencySub}>
          {p95 > 0
            ? `P95 ${Math.round(p95)}ms · decision to on-chain settlement`
            : 'Decision to on-chain settlement'}
        </Text>
      </View>
    </View>
  );
}

/**
 * Abre a transação no explorer da Arc.
 *
 * `openBrowserAsync` rejeita quando não há navegador disponível. A tela não
 * tem superfície para reportar isso, e um alerta por um link que não abriu
 * seria mais ruído do que ajuda — o toque simplesmente não faz nada.
 */
function openTx(tx: string) {
  WebBrowser.openBrowserAsync(txExplorerUrl(tx)).catch(() => {});
}

/**
 * Uma liquidação do feed.
 *
 * Hash truncado na tela não prova nada para quem está olhando; prova quando dá
 * para abrir. Por isso a linha vira link — mas só quando existe transação de
 * verdade: um pagamento em `dry_run` ou enfileirado não tem hash, e mandar o
 * usuário para uma página de "não encontrado" seria pior do que não linkar.
 */
function FeedRow({ event }: { event: PaymentEvent }) {
  const colors = useTheme();
  const styles = useStyles();
  const linkable = isOnChainTx(event.tx);

  const content = (
    <>
      <View style={styles.feedIcon}>
        <IconDollar size={14} color={colors.accent} />
      </View>

      <View style={styles.flex}>
        <Text style={styles.feedCreator} numberOfLines={1}>
          {event.creator}
        </Text>
        <Text style={linkable ? styles.feedTx : styles.feedNoTx} numberOfLines={1}>
          {linkable ? shortHash(event.tx) : 'No transaction hash'}
        </Text>
      </View>

      <View style={styles.feedRight}>
        <Text style={styles.feedAmount}>+${formatUSDC(event.amount)}</Text>
        <Text style={styles.feedTime}>{timeAgo(event.ts)}</Text>
      </View>

      {/* A seta é o que diferencia a linha que abre da que não abre. */}
      {linkable ? <IconChevronRight size={14} color={colors.ink3} /> : null}
    </>
  );

  if (!linkable) return <View style={styles.feedRow}>{content}</View>;

  return (
    <Pressable
      onPress={() => openTx(event.tx)}
      style={({ pressed }) => [styles.feedRow, pressed && styles.feedRowPressed]}
      accessibilityRole="link"
      accessibilityLabel={`${event.creator}, ${formatUSDC(event.amount)} USDC — open the transaction in the Arc explorer`}
    >
      {content}
    </Pressable>
  );
}

/**
 * Esqueleto da primeira carga, na silhueta do resultado.
 *
 * Substitui o spinner centralizado que havia aqui: ele ocupava uma altura que
 * não era a do conteúdo, então a tela inteira pulava no instante em que o dado
 * chegava — logo no primeiro segundo de uma demo.
 */
function TractionSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading traction">
      <Skeleton height={SKELETON.hero} radius={Radius.lg} />

      <View style={styles.strip}>
        <Skeleton height={SKELETON.mini} radius={Radius.lg} style={styles.flex} />
        <Skeleton height={SKELETON.mini} radius={Radius.lg} style={styles.flex} />
        <Skeleton height={SKELETON.mini} radius={Radius.lg} style={styles.flex} />
      </View>

      <Skeleton height={SKELETON.latency} radius={Radius.lg} />
      <Skeleton height={SKELETON.feed} radius={Radius.lg} />
    </View>
  );
}

/**
 * Alturas medidas contra o layout real, não chutadas.
 *
 * Um esqueleto com a altura errada é pior do que nenhum: ele promete uma
 * silhueta e entrega outra, então a tela pula do mesmo jeito — só que depois
 * de o usuário já ter começado a ler. Se o herói ou o cartão de métrica
 * mudarem de anatomia, estes números têm de mudar junto.
 */
const SKELETON = {
  /** Cabeçalho + número de 48px + linha de apoio + sparkline com legenda. */
  hero: 216,
  /** Ícone + número + rótulo de até duas linhas, com o padding do cartão. */
  mini: 92,
  /** Uma linha só: o chip de 36px mais o padding. */
  latency: 66,
  /** Cabeçalho da seção mais três linhas de feed. */
  feed: 228,
} as const;

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },

  // ── Métricas ───────────────────────────────────────────────────────────
  // Três colunas fixas: são números curtos, e um `wrap` deixaria o terceiro
  // cartão sozinho numa linha só em aparelho estreito.
  strip: { flexDirection: 'row', gap: Spacing.two + 2 },

  // ── Selo de stream ─────────────────────────────────────────────────────
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.successSoft,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: colors.success,
  },
  liveText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.success,
  },
  skeleton: { gap: Spacing.three - 4 },

  // ── Barra de latência ──────────────────────────────────────────────────
  latency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three - 4,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  latencyOk: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  latencyWarn: { backgroundColor: colors.warnSoft, borderColor: colors.warnBorder },
  latencyIdle: { backgroundColor: colors.card, borderColor: colors.border },
  latencyIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  latencyIconOk: { backgroundColor: colors.successBorder },
  latencyIconWarn: { backgroundColor: colors.warnBorder },
  latencyIconIdle: { backgroundColor: colors.bg },
  latencyTitle: { fontFamily: Fonts.bold, fontSize: 13 },
  latencyIdleTitle: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  latencySub: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink2, marginTop: 1 },

  // ── Feed ───────────────────────────────────────────────────────────────
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  feedRowPressed: { backgroundColor: colors.border },
  feedIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  feedCreator: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink },
  feedTx: { fontFamily: Fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
  feedNoTx: { fontFamily: Fonts.sans, fontSize: 10, color: colors.ink3, marginTop: 2 },
  feedRight: { alignItems: 'flex-end' },
  feedAmount: { fontFamily: Fonts.bold, fontSize: 13, color: colors.success },
  feedTime: { fontFamily: Fonts.sans, fontSize: 10, color: colors.ink3, marginTop: 2 },
}));
