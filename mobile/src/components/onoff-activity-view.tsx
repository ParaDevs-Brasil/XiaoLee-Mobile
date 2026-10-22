import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listOnoffIntents, type OnoffIntent, type OnoffStatus } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronLeft, IconInbox, IconPlus, IconUpload } from '@/components/icons';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { formatDate, formatUSDC, parseTimestamp, timeAgo } from '@/lib/format';

/**
 * Histórico do on/off-ramp: o que entrou (Add money) e o que saiu (Withdraw), do mais novo para o mais
 * antigo, cada linha com o estado em palavras. Só leitura — o backend é a fonte (`GET /v1/onoff/intents`).
 */

/** Igual ao `SESSION_TTL` do backend: passado isso a cotação do saque já não vale. */
const QUOTE_STALE_MS = 30 * 60 * 1000;

type Tone = 'success' | 'warn' | 'danger' | 'muted';

/** Estado do intent em palavra de usuário. O que ainda anda é `warn`; o que fechou bem é `success`. */
function describe(i: OnoffIntent, now: number): { label: string; tone: Tone } {
  const s: OnoffStatus = i.status;
  if (s === 'settled' || s === 'paid_out') return { label: i.direction === 'deposit' ? 'Added' : 'Delivered', tone: 'success' };
  if (s === 'rejected' || s === 'failed') return { label: 'Failed', tone: 'danger' };
  if (s === 'review') return { label: 'In review', tone: 'warn' };
  if (s === 'expired') return { label: 'Expired', tone: 'muted' };
  if (s === 'refunded') return { label: 'Refunded', tone: 'muted' };
  if (i.direction === 'deposit') return { label: s === 'funds_received' ? 'Confirming' : 'Waiting for payment', tone: 'warn' };
  if (s === 'created') {
    // Cotação que ninguém assinou. O backend não a expira (o burn pode ter saído e o registro se perdido), então
    // depois do prazo da cotação dizemos só o que sabemos — "não confirmado" — em vez de "aguardando" para sempre.
    const age = i.created_at ? now - parseTimestamp(i.created_at) : 0;
    return age > QUOTE_STALE_MS ? { label: 'Not confirmed', tone: 'muted' } : { label: 'Awaiting signature', tone: 'warn' };
  }
  return { label: 'On its way', tone: 'warn' };
}

function title(i: OnoffIntent): string {
  if (i.direction === 'deposit') return i.method === 'pix' ? 'Added with Pix' : 'Added with card';
  return i.method === 'chain' && i.dest_network ? `Sent to ${i.dest_network[0].toUpperCase()}${i.dest_network.slice(1)}` : 'Withdrawal';
}

/** Hora se foi hoje, senão a data — "3min ago" não serve para uma linha de dias atrás. */
function when(iso: string | null, now: number): string {
  if (!iso) return '';
  const at = parseTimestamp(iso);
  if (Number.isNaN(at)) return '';
  return now - at < 24 * 3600 * 1000 ? timeAgo(iso, now) : formatDate(iso);
}

export function OnoffActivityView({ onBack }: { onBack: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const data = useBackendData(listOnoffIntents);
  const items = data.data;
  const error = data.error;
  // Relógio lido uma vez: o React Compiler trata `Date.now()` no render como impuro.
  const [now] = useState(() => Date.now());

  const tone = (t: Tone) => (t === 'success' ? colors.success : t === 'warn' ? colors.warn : t === 'danger' ? colors.danger : colors.ink3);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.six + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.reload} tintColor={colors.accent} colors={[colors.accent]} />}
    >
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Back to wallet"
        >
          <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.meta}>Money you added and sent out</Text>
        </View>
      </View>

      {error && !items ? <ErrorState title="Couldn't load your activity" message={error} onRetry={data.reload} /> : null}

      {!error && !items ? (
        <View style={styles.card} accessible accessibilityLabel="Loading activity">
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton height={40} width={40} radius={Radius.md} />
              <View style={styles.flex}>
                <Skeleton height={13} width="60%" />
                <Skeleton height={10} width="40%" />
              </View>
              <Skeleton height={14} width={48} />
            </View>
          ))}
        </View>
      ) : null}

      {items && items.length === 0 ? (
        <View style={styles.card}>
          <EmptyState
            Icon={IconInbox}
            title="Nothing here yet"
            text="Money you add with Pix or card, and money you send to another network, shows up here."
          />
        </View>
      ) : null}

      {items && items.length > 0 ? (
        <View style={styles.card}>
          {items.map((i, n) => {
            const st = describe(i, now);
            const Icon = i.direction === 'deposit' ? IconPlus : IconUpload;
            return (
              <View key={i.intent_id} style={[styles.row, n > 0 && styles.divider]} accessible accessibilityLabel={`${title(i)}, ${formatUSDC(i.amount_usdc)} USDC, ${st.label}`}>
                <View style={styles.mark}>
                  <Icon size={17} sw={2.2} color={colors.accent} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{title(i)}</Text>
                  <Text style={styles.detail} numberOfLines={1}>
                    <Text style={{ color: tone(st.tone) }}>{st.label}</Text>
                    {i.created_at ? ` · ${when(i.created_at, now)}` : ''}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{i.direction === 'deposit' ? '+' : '−'}{formatUSDC(i.amount_usdc)}</Text>
                  <Text style={styles.unit}>USDC</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, gap: 2 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three, gap: Spacing.three },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  back: { width: 44, height: 44, marginLeft: -Spacing.two, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  meta: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink3 },
  card: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, minHeight: 56, paddingVertical: Spacing.two },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  mark: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  detail: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  right: { alignItems: 'flex-end', gap: 3 },
  amount: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: Fonts.bold, fontSize: 9, letterSpacing: 0.6, color: colors.ink3 },
}));
