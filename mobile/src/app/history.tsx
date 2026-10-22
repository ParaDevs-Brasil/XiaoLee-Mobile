import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Skeleton } from '@/components/feedback';
import { IconInbox, IconSpark, IconUser } from '@/components/icons';
import { RichText } from '@/components/rich-text';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { loadChatHistory, type StoredMessage } from '@/lib/chat-history';
import { parseTimestamp, shortHash, timeAgo } from '@/lib/format';

/**
 * Tela de History — terceiro destino do `ProfileMenu`.
 *
 * Porta `frontend/src/components/navbar/Historico.tsx` na anatomia — filtros
 * por autor, uma linha por mensagem —, mas lê de `lib/chat-history.ts`, não do
 * backend: `GET /user/{id}` devolve `chat_history` vazio fixo
 * (`campaigns_routes.py:557`), e o web já sabe disso — a tela dele também não
 * lê do backend, lê do `localStorage` que `ChatPanel.tsx` grava a cada troca.
 *
 * Diferente de Wallet e Transactions, **esta tela não exige sessão** — o chat
 * funciona sem login (o backend trata como `web_anonymous`, ver
 * `api/backend.ts::sendChatMessage`). Mas quando há sessão, o histórico é da
 * conta: `loadChatHistory` escopa a chave por `twitterUserId`
 * (`lib/chat-history.ts`), e `useBackendData` já reroda a leitura quando o
 * `sessionId` muda — entrar ou sair troca qual gaveta esta tela lê, sem
 * precisar de nada especial aqui.
 *
 * A ordem de leitura é a de uma conversa, não a de um extrato: mais antiga
 * primeiro, como o web (`Historico.tsx` ordena por `timestamp` crescente) e ao
 * contrário de Traction, Notifications e Transactions, que lideram com o mais
 * novo. Inverter aqui faria a resposta aparecer acima da pergunta.
 */

type Filter = StoredMessage['role'] | 'all';

const dayKey = (iso: string) => new Date(parseTimestamp(iso)).toDateString();

/** "Today", "Yesterday" ou "Oct 6": o dia da mensagem, para a lista longa ter por onde ser percorrida. */
function dayLabel(iso: string, now: number): string {
  const at = parseTimestamp(iso);
  if (Number.isNaN(at)) return '';
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'You' },
  { id: 'assistant', label: 'Xiaolee' },
];

export default function HistoryScreen() {
  const colors = useTheme();
  const styles = useStyles();
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  // `loadChatHistory` nunca lança — armazenamento corrompido já vira lista
  // vazia dentro dela —, então não há bloco de erro nesta tela.
  const { data, loading, refreshing, reload } = useBackendData(loadChatHistory);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // Relógio lido uma vez: o React Compiler trata `Date.now()` no render como impuro.
  const [now] = useState(() => Date.now());
  // A lista é cronológica (a resposta fica abaixo da pergunta), então a mensagem de hoje é a última: abrir já no fim, como
  // um app de conversa, em vez de fazer o usuário rolar dias de histórico. Só na primeira carga.
  const scrollRef = useRef<ScrollView>(null);
  const jumped = useRef(false);

  const messages = data ?? [];
  const counts = {
    all: messages.length,
    user: messages.filter((item) => item.role === 'user').length,
    assistant: messages.filter((item) => item.role === 'assistant').length,
  };

  const term = search.trim().toLowerCase();
  const byRole = filter === 'all' ? messages : messages.filter((item) => item.role === filter);
  const visible = term ? byRole.filter((item) => item.content.toLowerCase().includes(term)) : byRole;

  return (
    <ScreenShell>
      <ScrollView
        ref={scrollRef}
        onContentSizeChange={() => {
          if (!jumped.current && messages.length > 0) {
            jumped.current = true;
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
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
          title="History"
          subtitle="Your conversations with Xiaolee, kept on this device."
        />

        {loading && !data ? <HistorySkeleton /> : null}

        {data && messages.length > 0 ? (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search your messages"
              placeholderTextColor={colors.ink3}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.search}
              accessibilityLabel="Search your messages"
            />
            <FilterBar current={filter} counts={counts} onChange={setFilter} />
          </>
        ) : null}

        {data ? (
          <SectionCard title="Conversation" subtitle={term ? `${visible.length} found` : 'Oldest first · opens at the latest'}>
            {/* Só um vazio, para a lista inteira — não um por aba como em
                Transactions. Um filtro sem mensagem fica desabilitado no chip
                acima, então não há como entrar numa aba vazia para precisar de
                um texto próprio para ela. */}
            {messages.length === 0 ? (
              <EmptyState
                Icon={IconInbox}
                title="No messages yet"
                text="Chat with Xiaolee and your conversation will be kept here."
              />
            ) : (
              visible.map((message, index) => (
                // Sem id próprio no histórico local — a posição é estável
                // porque a lista só cresce no fim (`appendChatMessage`).
                <View key={index}>
                  {index === 0 || dayKey(visible[index - 1].at) !== dayKey(message.at) ? (
                    <Text style={styles.day}>{dayLabel(message.at, now)}</Text>
                  ) : null}
                  <MessageRow message={message} />
                </View>
              ))
            )}
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

/**
 * Filtros por autor. Chip zerado fica desabilitado, como em Notifications —
 * filtrar para o vazio é beco sem saída. Na prática quase não acontece aqui,
 * porque toda troca grava as duas mensagens (`appendChatMessage` é chamada
 * duas vezes por `send()`), mas continua alcançável logo depois de enviar,
 * antes da resposta chegar.
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
  const styles = useStyles();
  return (
    <View style={styles.filters}>
      {FILTERS.map(({ id, label }) => {
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
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            <Text style={[styles.chipCount, active && styles.chipTextActive]}>{counts[id]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MessageRow({ message }: { message: StoredMessage }) {
  const colors = useTheme();
  const styles = useStyles();
  const mine = message.role === 'user';

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.roleIcon, mine ? styles.roleIconUser : styles.roleIconAssistant]}>
          {mine ? (
            <IconUser size={12} color={colors.ink2} />
          ) : (
            <IconSpark size={11} color={colors.accent} />
          )}
        </View>
        <Text style={styles.roleLabel}>{mine ? 'You' : 'Xiaolee'}</Text>
        <Text style={styles.rowTime}>{timeAgo(message.at)}</Text>
      </View>

      {/* Sem `numberOfLines`: é o único lugar do app onde a mensagem inteira
          é o ponto — cortar o texto derrotaria a tela. */}
      {mine ? (
        <Text style={styles.rowContent}>{message.content}</Text>
      ) : (
        <RichText text={message.content} style={styles.rowContent} />
      )}
      {/* Comprovante do card de ação — só texto, o visual fino é do frontend. */}
      {message.txHash ? <Text style={styles.rowContent}>Sent · {shortHash(message.txHash)}</Text> : null}
      {message.claimReceiptId ? <Text style={styles.rowContent}>Claimed · {message.claimReceiptId}</Text> : null}
    </View>
  );
}

/**
 * Esqueleto da primeira carga. Alturas medidas contra o layout real — um
 * esqueleto de altura errada promete uma silhueta e entrega outra, e aí a tela
 * pula do mesmo jeito.
 */
function HistorySkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading history">
      <Skeleton height={44} radius={Radius.pill} />
      <Skeleton height={280} radius={Radius.lg} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  skeleton: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },

  // ── Filtros ────────────────────────────────────────────────────────────
  filters: { flexDirection: 'row', gap: Spacing.two - 2 },
  search: {
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: colors.ink,
  },
  day: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
    paddingTop: Spacing.three - 4,
    paddingBottom: Spacing.one,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 3,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  chipEmpty: { opacity: 0.45 },
  chipText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink2 },
  chipCount: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink3 },
  chipTextActive: { color: colors.onAccent },

  // ── Linha de mensagem ──────────────────────────────────────────────────
  row: {
    gap: Spacing.one + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  roleIcon: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconUser: { backgroundColor: colors.border },
  roleIconAssistant: { backgroundColor: colors.accentSoft },
  roleLabel: { flex: 1, fontFamily: Fonts.bold, fontSize: 12, color: colors.ink },
  rowTime: { fontFamily: Fonts.sans, fontSize: 10, color: colors.ink3 },
  rowContent: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, color: colors.ink2 },
}));
