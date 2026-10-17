import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ackNotification, listNotifications, type NotificationItem } from '@/api/backend';
import { EmptyState, ErrorState, ConnectWalletButton, Skeleton } from '@/components/feedback';
import {
  IconAlert,
  IconBell,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconInbox,
  IconRefresh,
  IconSend,
  IconUser,
  type IconProps,
} from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { reportIdOf } from '@/lib/creator-report';
import { formatTokenAmount, shortHash } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Tela de Notifications — porta de `frontend/src/app/notifications/page.tsx`.
 *
 * É o destino do sino, que estava no `HeaderBar` de todas as telas sem levar a
 * lugar nenhum.
 *
 * Diverge do web em três pontos, todos deliberados: os contadores viraram
 * filtros, o `metadata` virou linhas rotuladas em vez de JSON cru, e o bloco
 * "Devnet context" saiu — hash de sessão truncado é diagnóstico, e o app já
 * tem `/diagnostics` para isso.
 */

/**
 * Os três status que o modelo grava (`database/models.py:260`), não dois.
 *
 * O web ramifica só entre `delivered` e o resto, e a primeira porta desta tela
 * copiou isso — o que fazia uma notificação **falhada** aparecer em âmbar como
 * pendente, com um botão oferecendo reconhecer uma entrega que não aconteceu.
 * `failed` é gravado pelo webhook do Helius quando o envio pelo Telegram não
 * sai (`helius_routes.py:203`).
 *
 * O motivo da falha existe na tabela (`error_message`) mas não é exposto pelo
 * schema da rota, então dá para marcar a falha e não para explicá-la.
 */
type Tone = 'delivered' | 'pending' | 'failed';

function toneOf(status: string): Tone {
  if (status === 'delivered') return 'delivered';
  if (status === 'failed') return 'failed';
  return 'pending';
}

type Filter = 'all' | 'pending' | 'failed';

/** De onde a notificação chegou. `in_app` é o padrão da coluna. */
const CHANNEL: Record<string, { Icon: (p: IconProps) => React.ReactElement; label: string }> = {
  in_app: { Icon: IconBell, label: 'In app' },
  telegram: { Icon: IconSend, label: 'Telegram' },
};

/**
 * Sem sessão não há o que buscar: a rota resolve o usuário pelo `Bearer` e
 * responderia 401. Devolver lista vazia deixa a tela mostrar o estado de
 * convidado, que é o correto — não ter entrado ainda não é erro.
 *
 * Lê a sessão a cada chamada, e não uma vez no mount, para que o `reload`
 * funcione no instante seguinte ao login sem precisar remontar a tela.
 */
async function fetchNotifications(): Promise<NotificationItem[]> {
  const session = await getSession();
  if (!session) return [];
  return listNotifications();
}

export default function NotificationsScreen() {
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchNotifications);

  const [filter, setFilter] = useState<Filter>('all');
  // Falha do ack vive à parte da falha de carga: são ações diferentes, e uma
  // não deve apagar a mensagem da outra.
  const [ackError, setAckError] = useState<string | null>(null);
  const [acking, setAcking] = useState<number | null>(null);
  /**
   * Status confirmados pelo servidor depois do ack, por id.
   *
   * A primeira versão recarregava a lista inteira. Além de lento, ligava o
   * `refreshing` — então tocar num botão fazia aparecer o spinner de "puxar
   * para atualizar", que é gesto nenhum que o usuário fez. O `AckResponse`
   * devolve o status daquele id, então a resposta do próprio servidor é o que
   * sobrescreve a linha; nada aqui é adivinhado.
   */
  const [acked, setAcked] = useState<Record<number, string>>({});

  const items = (data ?? []).map((item) => ({
    ...item,
    status: acked[item.id] ?? item.status,
  }));

  const counts: Record<Filter, number> = {
    all: items.length,
    pending: items.filter((item) => toneOf(item.status) === 'pending').length,
    failed: items.filter((item) => toneOf(item.status) === 'failed').length,
  };

  const visible = filter === 'all' ? items : items.filter((item) => toneOf(item.status) === filter);

  const acknowledge = async (id: number) => {
    setAcking(id);
    setAckError(null);
    try {
      const response = await ackNotification(id);
      setAcked((current) => ({ ...current, [id]: response.status }));
    } catch (err) {
      setAckError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcking(null);
    }
  };

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={Colors.light.accent}
            colors={[Colors.light.accent]}
          />
        }
      >
        <PageHeading
          title="Notifications"
          subtitle="Receipts and campaign updates from your connected wallet."
        />

        {/* Aparece mesmo com lista na tela: uma recarga que falhou em silêncio
            faria recibos velhos passarem por atuais. */}
        {error && hasSession ? (
          <ErrorState title="Couldn't load notifications" message={error} onRetry={reload} />
        ) : null}

        {ackError ? (
          <ErrorState title="Couldn't acknowledge" message={ackError} onRetry={reload} />
        ) : null}

        {loading && !data ? <NotificationsSkeleton /> : null}

        {data && hasSession && items.length > 0 ? (
          <FilterBar current={filter} counts={counts} onChange={setFilter} />
        ) : null}

        {data ? (
          <SectionCard
            title="Receipts"
            subtitle="Delivery status of every notification"
            action={
              <Pressable
                onPress={reload}
                hitSlop={Spacing.two}
                accessibilityRole="button"
                accessibilityLabel="Refresh"
              >
                <IconRefresh size={15} color={Colors.light.ink3} />
              </Pressable>
            }
          >
            {!hasSession ? (
              <GuestState />
            ) : items.length === 0 ? (
              <EmptyState
                Icon={IconInbox}
                title="Nothing here yet"
                text="Join a campaign and its receipts will land in this list."
              />
            ) : (
              visible.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  busy={acking === item.id}
                  onAck={() => acknowledge(item.id)}
                />
              ))
            )}
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

/**
 * Filtros no lugar dos três contadores do web.
 *
 * Lá são números inertes, e dois deles dizem a mesma coisa (pendente é o total
 * menos o entregue). Como chip eles continuam informando a contagem e passam a
 * servir para alguma coisa: numa lista de vinte recibos, achar os três
 * pendentes era caçar ponto âmbar rolando a tela.
 *
 * Chip zerado fica desabilitado — filtrar para o vazio é beco sem saída.
 */
function FilterBar({
  current,
  counts,
  onChange,
}: {
  current: Filter;
  counts: Record<Filter, number>;
  onChange: (next: Filter) => void;
}) {
  const chips: { id: Filter; label: string; Icon: (p: IconProps) => React.ReactElement }[] = [
    { id: 'all', label: 'All', Icon: IconInbox },
    { id: 'pending', label: 'Pending', Icon: IconClock },
    { id: 'failed', label: 'Failed', Icon: IconAlert },
  ];

  return (
    <View style={styles.filters}>
      {chips.map(({ id, label, Icon }) => {
        const active = current === id;
        const empty = counts[id] === 0 && id !== 'all';

        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            disabled={empty}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              empty && styles.chipEmpty,
              pressed && !empty && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: empty }}
            accessibilityLabel={`${label}, ${counts[id]}`}
          >
            <Icon size={13} color={active ? Colors.light.card : Colors.light.ink3} />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            <Text style={[styles.chipCount, active && styles.chipTextActive]}>{counts[id]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Estado de convidado. Conectar acontece aqui mesmo: mandar para o chat era
 * mandar para uma tela onde o botão de conectar também não está à vista — ele
 * vive no painel de perfil, atrás do avatar do header.
 */
function GuestState() {
  return (
    <View style={styles.guest}>
      <View style={styles.guestIcon}>
        <IconUser size={22} color={Colors.light.ink3} />
      </View>
      <Text style={styles.guestTitle}>No wallet connected</Text>
      <Text style={styles.guestText}>
        Notifications are tied to your connected wallet. Connect one to see your receipts.
      </Text>
      <ConnectWalletButton />
    </View>
  );
}

function NotificationRow({
  item,
  busy,
  onAck,
}: {
  item: NotificationItem;
  busy: boolean;
  onAck: () => void;
}) {
  const tone = toneOf(item.status);
  const router = useRouter();
  const channel = CHANNEL[item.channel] ?? { Icon: IconBell, label: item.channel };
  // Relatório de 30 dias: o metadata é só o ponteiro (`kind`, `report_id`) —
  // em vez de linhas rotuladas, o card inteiro abre a tela do relatório.
  const reportId = reportIdOf(item.metadata);
  const meta = reportId ? [] : metadataRows(item.metadata);

  // Abrir o relatório é ler a notificação: conta como ack, e o badge do sino some.
  const openReport = () => {
    if (tone === 'pending') onAck();
    router.push({ pathname: '/reports/[id]', params: { id: String(reportId) } });
  };

  const content = (
    <>
      <View style={styles.rowTop}>
        <View style={[styles.dot, DOT[tone]]} />

        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={[styles.badge, BADGE[tone]]}>
          <Text style={[styles.badgeText, BADGE_TEXT[tone]]}>{item.status}</Text>
        </View>
      </View>

      <Text style={styles.rowBody}>{item.body}</Text>

      {item.related_signature ? (
        <View style={styles.receipt}>
          <Text style={styles.receiptLabel}>Receipt</Text>
          <Text style={styles.receiptValue}>{item.related_signature}</Text>
        </View>
      ) : null}

      {reportId ? (
        <View style={styles.openReport}>
          <Text style={styles.openReportText}>Open report</Text>
          <IconChevronRight size={13} sw={2.2} color={Colors.light.accent} />
        </View>
      ) : null}

      {meta.length > 0 ? (
        <View style={styles.meta}>
          {meta.map(([label, value]) => (
            <View key={label} style={styles.metaRow}>
              <Text style={styles.metaLabel}>{label}</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.rowFooter}>
        <View style={styles.channel}>
          <channel.Icon size={11} color={Colors.light.ink3} />
          <Text style={styles.channelText}>{channel.label}</Text>
        </View>

        {/* Só o pendente oferece ack. Entregue não tem o que reconhecer, e
            falhado menos ainda — reconhecer uma entrega que não aconteceu não
            quer dizer nada. */}
        {tone === 'pending' ? (
          <Pressable
            onPress={onAck}
            disabled={busy}
            style={({ pressed }) => [styles.ack, busy && styles.ackBusy, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={`Acknowledge ${item.title}`}
          >
            <Text style={styles.ackText}>{busy ? 'Acknowledging…' : 'Acknowledge'}</Text>
          </Pressable>
        ) : tone === 'delivered' ? (
          <View style={styles.marker}>
            <IconCheck size={12} color={Colors.light.success} />
            <Text style={[styles.markerText, styles.markerDone]}>Done</Text>
          </View>
        ) : (
          <View style={styles.marker}>
            <IconAlert size={12} color={Colors.light.danger} />
            <Text style={[styles.markerText, styles.markerFailed]}>Delivery failed</Text>
          </View>
        )}
      </View>
    </>
  );

  if (!reportId) return <View style={styles.row}>{content}</View>;

  return (
    <Pressable
      onPress={openReport}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. Open report`}
    >
      {content}
    </Pressable>
  );
}

/**
 * `metadata` em linhas rotuladas, no lugar do `JSON.stringify` que o web
 * despeja na tela.
 *
 * Não há schema fixo — são três produtores com chaves diferentes (resgate de
 * campanha, webhook do Helius e Telegram) —, mas todos gravam objeto plano,
 * então rotular genericamente funciona para os três e para o próximo.
 */
function metadataRows(metadata: Record<string, unknown>): [string, string][] {
  return Object.entries(metadata ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]): [string, string] => [humanizeKey(key), formatMetaValue(value)]);
}

/** `campaign_id` → `Campaign id`. As chaves vêm em snake_case do backend. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatMetaValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatTokenAmount(value);
  // Chave de wallet cabe na linha só encurtada; o resto passa direto.
  if (typeof value === 'string') return value.length > 24 ? shortHash(value) : value;
  return JSON.stringify(value);
}

/**
 * Esqueleto da primeira carga. Alturas medidas contra o layout real — um
 * esqueleto de altura errada promete uma silhueta e entrega outra, e aí a tela
 * pula do mesmo jeito.
 */
function NotificationsSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading notifications">
      <Skeleton height={34} radius={Radius.pill} />
      <Skeleton height={196} radius={Radius.lg} />
      <Skeleton height={196} radius={Radius.lg} />
    </View>
  );
}

const DOT: Record<Tone, { backgroundColor: string }> = {
  delivered: { backgroundColor: Colors.light.success },
  pending: { backgroundColor: Colors.light.warn },
  failed: { backgroundColor: Colors.light.danger },
};

const BADGE: Record<Tone, { backgroundColor: string }> = {
  delivered: { backgroundColor: Colors.light.successSoft },
  pending: { backgroundColor: Colors.light.warnSoft },
  failed: { backgroundColor: Colors.light.dangerSoft },
};

const BADGE_TEXT: Record<Tone, { color: string }> = {
  delivered: { color: Colors.light.success },
  pending: { color: Colors.light.warn },
  failed: { color: Colors.light.danger },
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  skeleton: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },

  // ── Filtros ────────────────────────────────────────────────────────────
  filters: { flexDirection: 'row', gap: Spacing.two - 2 },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 3,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  chipActive: { backgroundColor: Colors.light.accent, borderColor: Colors.light.accent },
  chipEmpty: { opacity: 0.45 },
  chipText: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.light.ink2 },
  chipCount: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.light.ink3 },
  chipTextActive: { color: Colors.light.card },

  // ── Convidado ──────────────────────────────────────────────────────────
  guest: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  guestIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.bg,
  },
  guestTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  guestText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.light.ink2,
    textAlign: 'center',
  },

  // ── Linha de notificação ───────────────────────────────────────────────
  row: {
    gap: Spacing.two - 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.bg,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  dot: { width: 8, height: 8, borderRadius: Radius.pill },
  rowTitle: { flex: 1, fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink },
  badge: { paddingHorizontal: Spacing.two - 2, paddingVertical: 1, borderRadius: Radius.pill },
  badgeText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  rowBody: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: Colors.light.ink2 },

  receipt: {
    gap: 1,
    padding: Spacing.two - 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.light.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  receiptLabel: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.accent,
  },
  receiptValue: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.light.ink2 },

  openReport: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accentSoft,
  },
  openReportText: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.light.accent },

  meta: {
    gap: 2,
    padding: Spacing.two - 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.light.card,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  metaLabel: { fontFamily: Fonts.sans, fontSize: 10, color: Colors.light.ink3 },
  metaValue: { flexShrink: 1, fontFamily: Fonts.medium, fontSize: 10, color: Colors.light.ink2 },

  // ── Rodapé da linha ────────────────────────────────────────────────────
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  channel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 3 },
  channelText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
  },
  ack: {
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.success,
  },
  ackBusy: { opacity: 0.55 },
  ackText: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.light.card },
  marker: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 3 },
  markerText: { fontFamily: Fonts.bold, fontSize: 11 },
  markerDone: { color: Colors.light.success },
  markerFailed: { color: Colors.light.danger },
});
