import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getFormatSuggestions, type FormatSuggestions } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconChevronDown, IconScissors } from '@/components/icons';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { formatIdeaMeta, formatIdeasError, formatIdeasSource } from '@/lib/format-ideas';

/**
 * "Format ideas" (XIAOLEEACE-32): a IA olha o perfil do onboarding (interesses,
 * bio, redes) e os vídeos que o creator já mandou, e sugere 2-3 formatos para
 * publicar — `GET /v1/media/format-suggestions`, no mesmo worker dos cortes.
 *
 * Só pede quando o creator toca (cada pedido novo é uma chamada ao modelo);
 * o backend guarda a resposta por contexto, então abrir de novo sem vídeo novo
 * não custa nada. Fechar e reabrir o card mantém o que já veio nesta visita.
 */

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; data: FormatSuggestions }
  | { phase: 'error'; message: string; retry: boolean };

export function FormatIdeasCard({ bare = false }: { bare?: boolean }) {
  const colors = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(bare);
  const [state, setState] = useState<State>({ phase: bare ? 'loading' : 'idle' });
  /** Descarta resposta de um pedido antigo (dois toques seguidos em "Try again"). */
  const version = useRef(0);

  const request = async () => {
    const mine = ++version.current;
    try {
      const data = await getFormatSuggestions();
      if (mine === version.current) setState({ phase: 'done', data });
    } catch (err) {
      if (mine !== version.current) return;
      setState({ phase: 'error', ...formatIdeasError(err instanceof ApiError ? err.status : null) });
    }
  };

  const load = () => {
    setState({ phase: 'loading' });
    return request();
  };

  // Aberto pelo atalho do Studio: o pedido sai na hora, sem o cabeçalho para tocar.
  useEffect(() => {
    if (!bare) return;
    const mine = ++version.current;
    getFormatSuggestions().then(
      (data) => {
        if (mine === version.current) setState({ phase: 'done', data });
      },
      (err) => {
        if (mine === version.current) setState({ phase: 'error', ...formatIdeasError(err instanceof ApiError ? err.status : null) });
      },
    );
  }, [bare]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.phase === 'idle') load();
  };

  return (
    <View style={styles.card}>
      {bare ? null : (
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Format ideas"
        accessibilityHint={open ? 'Collapses the ideas' : 'Suggests content formats for you'}
      >
        <View style={styles.leadIcon}>
          <IconScissors size={18} color={colors.ink2} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Format ideas</Text>
          <Text style={styles.subtitle}>
            {state.phase === 'done'
              ? `${state.data.suggestions.length} formats picked for you`
              : 'What to post next, from your interests and videos.'}
          </Text>
        </View>
        <View style={open ? styles.chevronOpen : undefined}>
          <IconChevronDown size={18} sw={2.2} color={colors.ink3} />
        </View>
      </Pressable>
      )}

      {open ? (
        <View style={[styles.body, bare && styles.bodyBare]}>
          {state.phase === 'loading' ? (
            <View style={styles.loading} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.helper}>Looking at your profile and videos…</Text>
            </View>
          ) : null}

          {state.phase === 'error' ? (
            <View style={styles.loadFailed} accessibilityLiveRegion="polite">
              <Text style={styles.error}>{state.message}</Text>
              {state.retry ? (
                <Pressable onPress={load} hitSlop={Spacing.two} accessibilityRole="button">
                  <Text style={styles.retry}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {state.phase === 'done' ? (
            <>
              {state.data.suggestions.map((s, i) => (
                <View key={s.format} style={styles.idea}>
                  <View style={styles.ideaHead}>
                    <Text style={styles.ideaIndex}>{i + 1}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.ideaTitle}>{s.format}</Text>
                      <Text style={styles.ideaMeta}>{formatIdeaMeta(s)}</Text>
                    </View>
                  </View>
                  <Text style={styles.ideaWhy}>{s.why}</Text>
                  <View style={styles.hook}>
                    <Text style={styles.hookLabel}>Open with</Text>
                    <Text style={styles.hookText}>“{s.hook}”</Text>
                  </View>
                </View>
              ))}
              <Text style={styles.helper}>{formatIdeasSource(state.data.based_on_videos)}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...CardShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three - 4,
    paddingRight: Spacing.three,
  },
  leadIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  bodyBare: { paddingTop: Spacing.three },
  body: { gap: Spacing.three - 4, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  helper: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2 },
  loadFailed: { gap: Spacing.two },
  error: { fontFamily: Fonts.semibold, fontSize: 12, lineHeight: 17, color: colors.danger },
  retry: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  idea: {
    gap: Spacing.two,
    padding: Spacing.three - 4,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ideaHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 2 },
  ideaIndex: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  ideaTitle: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 19, color: colors.ink },
  ideaMeta: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3, marginTop: 1 },
  ideaWhy: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: colors.ink2 },
  hook: { gap: 2, paddingLeft: Spacing.two + 2, borderLeftWidth: 2, borderLeftColor: colors.accent },
  hookLabel: { fontFamily: Fonts.semibold, fontSize: 11, color: colors.ink3, textTransform: 'uppercase' },
  hookText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink },
}));
