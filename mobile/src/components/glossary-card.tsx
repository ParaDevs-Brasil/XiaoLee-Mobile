import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getGlossary, getGlossarySuggestions, updateGlossary } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconCheck, IconChevronDown, IconClose, IconPlus, IconSpark } from '@/components/icons';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { addGlossaryTerms, GLOSSARY_MAX_TERM_LEN, GLOSSARY_MAX_TERMS, pendingSuggestions } from '@/lib/clips';

/**
 * Glossário do creator: nomes, marcas e gírias que a transcrição precisa
 * escrever certo — vai como dica para o Whisper e, por consequência, para a
 * legenda dos cortes. Vale para os próximos uploads, não refaz os antigos.
 *
 * Mora em `/v1/media/glossary` e é editado aqui: só faz sentido para quem
 * está mandando vídeo, e é na hora do upload que o creator lembra dele.
 *
 * Como é pensado para ser óbvio:
 * - **Salva sozinho.** Adicionar ou tirar uma palavra já grava (com um aviso
 *   discreto "Saving… / Saved"); não existe "Save"/"Discard" para esquecer. Em
 *   troca, tirar uma palavra por engano se desfaz com "Undo".
 * - **Nasce aberto quando está vazio**, com o campo à vista: quem nunca usou vê
 *   o que fazer sem precisar descobrir um chevron.
 * - **Fechado, mostra as palavras** em vez de só a contagem.
 * - **Vírgula ou Enter adiciona** — e dá para colar uma lista inteira.
 * - **Sugere** nomes que o creator repete nas próprias transcrições
 *   (`/v1/media/glossary/suggestions`): um toque adiciona, pelo mesmo caminho
 *   do campo de texto (salva sozinho, sai da lista de sugestões).
 */

/** Espera o usuário parar de mexer antes de gravar: vários toques seguidos viram uma gravação só. */
const SAVE_DELAY_MS = 500;
const UNDO_MS = 6_000;
/** Quantas palavras aparecem no resumo do card fechado. */
const PREVIEW_COUNT = 5;
/** A partir daqui mostra "N/60": antes disso o limite não interessa a ninguém. */
const COUNT_VISIBLE_FROM = 45;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function GlossaryCard() {
  const glossary = useBackendData(getGlossary);
  // Sugestões são um extra: se a busca falhar, a seção só não aparece.
  const suggestions = useBackendData(getGlossarySuggestions);
  /** `null` = automático: aberto enquanto a lista está vazia, fechado depois. */
  const [open, setOpen] = useState<boolean | null>(null);
  /** Lista local enquanto uma gravação está pendente; `null` = vale a do backend. */
  const [local, setLocal] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [undo, setUndo] = useState<{ term: string; index: number } | null>(null);

  // Estado mutável que não é de tela: timers, a gravação pendente e uma versão
  // para descartar resposta velha. Só é lido/escrito em handlers e no cleanup.
  const box = useRef({
    pending: null as string[] | null,
    saveTimer: null as ReturnType<typeof setTimeout> | null,
    undoTimer: null as ReturnType<typeof setTimeout> | null,
    version: 0,
  });

  // Saiu da tela com uma gravação ainda esperando o atraso: grava agora, senão
  // a última palavra digitada se perderia.
  useEffect(() => {
    const state = box.current;
    return () => {
      if (state.saveTimer) clearTimeout(state.saveTimer);
      if (state.undoTimer) clearTimeout(state.undoTimer);
      if (state.pending) updateGlossary(state.pending).catch(() => {});
    };
  }, []);

  const loaded = glossary.data !== null;
  const terms = local ?? glossary.data ?? [];
  const expanded = open ?? (loaded && terms.length === 0);

  const flush = async () => {
    const list = box.current.pending;
    if (!list) return;
    box.current.pending = null;
    box.current.saveTimer = null;
    const mine = box.current.version;
    try {
      glossary.replace(await updateGlossary(list));
      // Se o usuário mexeu de novo durante a gravação, a lista local já é mais
      // nova que a resposta: segue valendo ela, e a próxima gravação a alcança.
      if (box.current.version === mine) {
        setLocal(null);
        setStatus('saved');
      }
    } catch (err) {
      if (box.current.version === mine) {
        setStatus('error');
        setNotice(err instanceof ApiError ? err.message : null);
      }
    }
  };

  const commit = (next: string[]) => {
    box.current.version += 1;
    box.current.pending = next;
    if (box.current.saveTimer) clearTimeout(box.current.saveTimer);
    box.current.saveTimer = setTimeout(flush, SAVE_DELAY_MS);
    setLocal(next);
    setStatus('saving');
  };

  const add = (raw: string) => {
    const { terms: next, rejected } = addGlossaryTerms(terms, raw);
    setInput('');
    setUndo(null);
    if (rejected.length) {
      setNotice(`Not added: ${rejected.join(', ')} — up to ${GLOSSARY_MAX_TERMS} words of ${GLOSSARY_MAX_TERM_LEN} characters.`);
    } else if (next.length === terms.length && raw.replace(/[,\n]/g, '').trim()) {
      setNotice('That one is already on your list.');
    } else {
      setNotice(null);
    }
    if (next.length !== terms.length) commit(next);
  };

  const onChangeText = (value: string) => {
    // Vírgula ou quebra de linha fecham a palavra (e uma lista colada vira várias).
    if (/[,\n]/.test(value)) add(value);
    else setInput(value);
  };

  const remove = (term: string) => {
    const index = terms.indexOf(term);
    if (index < 0) return;
    commit(terms.filter((t) => t !== term));
    setNotice(null);
    setUndo({ term, index });
    if (box.current.undoTimer) clearTimeout(box.current.undoTimer);
    box.current.undoTimer = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const restore = () => {
    if (!undo) return;
    const next = [...terms];
    next.splice(Math.min(undo.index, next.length), 0, undo.term);
    commit(next);
    setUndo(null);
  };

  const suggested = loaded ? pendingSuggestions(suggestions.data ?? [], terms) : [];
  const preview = terms.slice(0, PREVIEW_COUNT);
  const hidden = terms.length - preview.length;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen(!expanded)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Words to get right"
        accessibilityHint={expanded ? 'Collapses the list' : 'Opens the list to add or remove words'}
      >
        <View style={styles.leadIcon}>
          <IconSpark size={18} color={Colors.light.ink2} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Words to get right</Text>
          <Text style={styles.subtitle}>
            {terms.length
              ? `${terms.length} ${terms.length === 1 ? 'word' : 'words'} · your captions will spell them right`
              : 'Teach it names, brands and slang so captions spell them right.'}
          </Text>
        </View>
        <View style={expanded ? styles.chevronOpen : undefined}>
          <IconChevronDown size={18} sw={2.2} color={Colors.light.ink3} />
        </View>
      </Pressable>

      {/* Fechado: as palavras à vista, só leitura — abrir é para mudar. */}
      {!expanded && terms.length ? (
        <View style={[styles.chips, styles.previewChips]}>
          {preview.map((term) => (
            <View key={term} style={styles.chip}>
              <Text style={styles.chipText}>{term}</Text>
            </View>
          ))}
          {hidden > 0 ? (
            <Pressable onPress={() => setOpen(true)} style={styles.more} accessibilityRole="button">
              <Text style={styles.moreText}>+{hidden} more</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.body}>
          {!loaded ? (
            glossary.error ? (
              <View style={styles.loadFailed}>
                <Text style={styles.error}>{glossary.error}</Text>
                <Pressable onPress={glossary.reload} hitSlop={Spacing.two} accessibilityRole="button">
                  <Text style={styles.retry}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator color={Colors.light.accent} />
            )
          ) : (
            <>
              <View style={styles.inputRow}>
                <TextInput
                  value={input}
                  onChangeText={onChangeText}
                  onSubmitEditing={() => add(input)}
                  placeholder="Type a word and press add"
                  placeholderTextColor={Colors.light.ink2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  // Mantém o teclado aberto: quem cadastra vários nomes não quer reabri-lo a cada um.
                  submitBehavior="submit"
                  maxLength={GLOSSARY_MAX_TERM_LEN * 8}
                  style={styles.input}
                  accessibilityLabel="New word"
                />
                <Pressable
                  onPress={() => add(input)}
                  disabled={!input.trim()}
                  style={({ pressed }) => [styles.add, !input.trim() && styles.addOff, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Add word"
                >
                  <Text style={styles.addText}>Add</Text>
                </Pressable>
              </View>

              <Text style={styles.helper}>
                Names, brands, slang — anything the captions got wrong. Use commas to add several. Applies to
                videos you upload from now on.
              </Text>

              {terms.length ? (
                <View style={styles.chips}>
                  {terms.map((term) => (
                    <View key={term} style={styles.chip}>
                      <Text style={styles.chipText}>{term}</Text>
                      <Pressable
                        onPress={() => remove(term)}
                        hitSlop={Spacing.two + 2}
                        style={styles.chipRemove}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${term}`}
                      >
                        <IconClose size={12} sw={2.6} color={Colors.light.ink3} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              {suggested.length ? (
                <View style={styles.suggestions}>
                  <Text style={styles.suggestionsTitle}>Suggested from your videos</Text>
                  <View style={styles.chips}>
                    {suggested.map(({ term, count }) => (
                      <Pressable
                        key={term}
                        onPress={() => add(term)}
                        style={({ pressed }) => [styles.chip, styles.suggestion, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${term}`}
                        accessibilityHint={`You said it ${count} times in your videos`}
                      >
                        <IconPlus size={12} sw={2.6} color={Colors.light.ink2} />
                        <Text style={[styles.chipText, styles.suggestionText]}>{term}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {notice ? <Text style={styles.error}>{notice}</Text> : null}

              {status !== 'idle' || terms.length >= COUNT_VISIBLE_FROM ? (
                <View style={styles.footer}>
                  <SaveIndicator status={status} onRetry={() => commit(terms)} />
                  {terms.length >= COUNT_VISIBLE_FROM ? (
                    <Text style={styles.count}>
                      {terms.length}/{GLOSSARY_MAX_TERMS}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {undo ? (
                <View style={styles.undoBar}>
                  <Text style={styles.undoText} numberOfLines={1}>
                    Removed “{undo.term}”
                  </Text>
                  <Pressable onPress={restore} hitSlop={Spacing.two} accessibilityRole="button">
                    <Text style={styles.undoAction}>Undo</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** "Saving…" enquanto grava, "Saved" ao terminar, e a saída quando falha. Some em `idle`. */
function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'saving') {
    return (
      <View style={styles.indicator} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={Colors.light.ink3} />
        <Text style={styles.indicatorText}>Saving…</Text>
      </View>
    );
  }
  if (status === 'saved') {
    return (
      <View style={styles.indicator} accessibilityLiveRegion="polite">
        <IconCheck size={14} sw={2.6} color={Colors.light.success} />
        <Text style={[styles.indicatorText, styles.indicatorSaved]}>Saved</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={styles.indicator} accessibilityLiveRegion="polite">
        <Text style={[styles.indicatorText, styles.indicatorError]}>Couldn’t save</Text>
        <Pressable onPress={onRetry} hitSlop={Spacing.two} accessibilityRole="button">
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return <View />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
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
    backgroundColor: Colors.light.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Colors.light.ink2, marginTop: 2 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  body: { gap: Spacing.three - 4, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.bg,
    paddingLeft: Spacing.three - 4,
    paddingRight: Spacing.one + 2,
    minHeight: 48,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two + 1,
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: Colors.light.ink,
  },
  add: {
    minHeight: 36,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  addOff: { backgroundColor: Colors.light.border },
  addText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.card },
  helper: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Colors.light.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  previewChips: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, marginTop: -Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    minHeight: 32,
    paddingHorizontal: Spacing.three - 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  chipText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink },
  chipRemove: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  suggestions: { gap: Spacing.two },
  suggestionsTitle: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink2 },
  // Neutro como os chips da lista (rosa só nos botões principais); o tracejado e o "+" dizem
  // "ainda não está na lista, toque para pôr".
  suggestion: { borderStyle: 'dashed', borderWidth: 1, borderColor: Colors.light.ink3, backgroundColor: Colors.light.card },
  suggestionText: { color: Colors.light.ink2 },
  more: { minHeight: 32, justifyContent: 'center', paddingHorizontal: Spacing.two },
  moreText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink2 },
  error: { fontFamily: Fonts.semibold, fontSize: 12, lineHeight: 17, color: Colors.light.danger },
  loadFailed: { gap: Spacing.two },
  retry: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.accent },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3 },
  indicator: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  indicatorText: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink3 },
  indicatorSaved: { color: Colors.light.success },
  indicatorError: { color: Colors.light.danger },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three - 4,
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.ink,
  },
  undoText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: Colors.light.card },
  undoAction: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.card, textDecorationLine: 'underline' },
});
