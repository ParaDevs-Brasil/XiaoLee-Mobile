import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconArrowRight, IconArrowUp, IconCheck, IconClose, IconEdit } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { AskQuestion, CardAsk } from '@/lib/chat-cards';

/**
 * Perguntas da Xiaolee na conversa, nos dois formatos do desenho do Josh:
 *  - `form`: todas as perguntas de uma vez, em chips ("Plan your campaign"), e um botão de continuar;
 *  - `wizard`: uma pergunta por vez, com "1 of 3", opções numeradas, "Something else", Skip e um resumo no fim.
 * Responder = uma mensagem comum no chat (`onAnswer`); nada é feito além disso.
 */

type Answers = Record<string, string[]>;

/** "Goal: Awareness. Where: X, Telegram." — o que vai para a Xiaolee e o que o resumo mostra. */
function summarize(questions: AskQuestion[], answers: Answers): { label: string; value: string }[] {
  return questions
    .filter((q) => answers[q.id]?.length)
    .map((q) => ({ label: q.short, value: answers[q.id].join(', ') }));
}

export function AskCard({ ask, onAnswer }: { ask: CardAsk; onAnswer: (text: string) => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function finish(final: Answers) {
    setAnswers(final);
    setDone(true);
    const rows = summarize(ask.questions, final);
    onAnswer(`${ask.title}. ${rows.map((r) => `${r.label}: ${r.value}.`).join(' ')}`.trim());
  }

  if (done) return <AskDone ask={ask} answers={answers} />;
  return ask.mode === 'wizard' ? (
    <Wizard ask={ask} onFinish={finish} onDismiss={() => setDismissed(true)} />
  ) : (
    <Form ask={ask} onFinish={finish} />
  );
}

/** Depois de responder: a linha verde (formulário) ou o resumo (passo a passo). */
function AskDone({ ask, answers }: { ask: CardAsk; answers: Answers }) {
  const colors = useTheme();
  const styles = useStyles();
  if (ask.mode === 'form') {
    return (
      <View style={styles.sentLine}>
        <IconCheck size={14} sw={2.4} color={colors.success} />
        <Text style={styles.sentText}>Answers sent to Xiaolee</Text>
      </View>
    );
  }
  return (
    <View style={styles.summary}>
      <View style={styles.sentLine}>
        <IconCheck size={14} sw={2.4} color={colors.success} />
        <Text style={styles.sentText}>{ask.doneTitle ?? 'Sent to Xiaolee'}</Text>
      </View>
      {summarize(ask.questions, answers).map((r) => (
        <View key={r.label} style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{r.label}:</Text>
          <Text style={styles.summaryValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Formulário: tudo de uma vez ─────────────────────────────────────────────

function Form({ ask, onFinish }: { ask: CardAsk; onFinish: (a: Answers) => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const [answers, setAnswers] = useState<Answers>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [text, setText] = useState<Record<string, string>>({});

  const pick = (q: AskQuestion, option: string) =>
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      const next = q.multi ? (cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option]) : [option];
      return { ...a, [q.id]: next };
    });

  const final = (): Answers => {
    const out: Answers = {};
    for (const q of ask.questions) {
      if (q.text) {
        if (text[q.id]?.trim()) out[q.id] = [text[q.id].trim()];
        continue;
      }
      const list = [...(answers[q.id] ?? [])];
      if (otherOpen[q.id] && other[q.id]?.trim()) list.push(other[q.id].trim());
      if (list.length) out[q.id] = list;
    }
    return out;
  };
  const ready = ask.questions.every((q) => q.optional || (final()[q.id]?.length ?? 0) > 0);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{ask.title}</Text>
      {ask.subtitle ? <Text style={styles.subtitle}>{ask.subtitle}</Text> : null}

      {ask.questions.map((q) => (
        <View key={q.id} style={styles.block}>
          <Text style={styles.label}>
            {q.label}
            {q.optional ? <Text style={styles.optional}>  optional</Text> : null}
          </Text>
          {q.text ? (
            <TextInput
              value={text[q.id] ?? ''}
              onChangeText={(v) => setText((t) => ({ ...t, [q.id]: v }))}
              multiline
              placeholder={q.optional ? 'Optional' : 'Type here'}
              placeholderTextColor={colors.ink3}
              style={styles.textarea}
              accessibilityLabel={q.label}
            />
          ) : (
            <>
              <View style={styles.chips}>
                {q.options.map((o) => (
                  <Chip key={o} label={o} on={answers[q.id]?.includes(o) ?? false} onPress={() => pick(q, o)} />
                ))}
                {q.other ? (
                  <Chip label="Other" on={otherOpen[q.id] ?? false} onPress={() => setOtherOpen((s) => ({ ...s, [q.id]: !s[q.id] }))} />
                ) : null}
              </View>
              {otherOpen[q.id] ? (
                <TextInput
                  value={other[q.id] ?? ''}
                  onChangeText={(v) => setOther((o) => ({ ...o, [q.id]: v }))}
                  autoFocus
                  placeholder="Type it here"
                  placeholderTextColor={colors.ink3}
                  style={[styles.textarea, styles.textareaOn, { minHeight: 44 }]}
                  accessibilityLabel={`${q.label}, other`}
                />
              ) : null}
            </>
          )}
        </View>
      ))}

      <Pressable
        onPress={() => onFinish(final())}
        disabled={!ready}
        style={({ pressed }) => [styles.submit, !ready && styles.submitOff, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.submitText}>{ask.submit ?? 'Continue'}</Text>
        <IconArrowRight size={16} sw={2.2} color={colors.onAccent} />
      </Pressable>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      {on ? <IconCheck size={13} sw={2.6} color={colors.onAccent} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// ── Passo a passo: uma pergunta por vez ─────────────────────────────────────

function Wizard({ ask, onFinish, onDismiss }: { ask: CardAsk; onFinish: (a: Answers) => void; onDismiss: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const total = ask.questions.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState('');
  const q = ask.questions[step];

  /** Grava a resposta desta pergunta (ou nenhuma, no Skip) e vai para a próxima; na última, termina. */
  function advance(value: string[]) {
    const next = value.length ? { ...answers, [q.id]: value } : answers;
    setAnswers(next);
    setSelected([]);
    setOtherOpen(false);
    setOther('');
    if (step + 1 >= total) onFinish(next);
    else setStep(step + 1);
  }

  const toggle = (option: string) => {
    if (q.multi) setSelected((s) => (s.includes(option) ? s.filter((o) => o !== option) : [...s, option]));
    else advance([option]);
  };
  const sendOther = () => {
    if (other.trim()) advance(q.multi ? [...selected, other.trim()] : [other.trim()]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.stepRow}>
        <Text style={styles.stepCount}>
          {step + 1} of {total}
        </Text>
        <View style={styles.dots}>
          {ask.questions.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
          ))}
        </View>
        <Pressable onPress={onDismiss} hitSlop={Spacing.two} accessibilityRole="button" accessibilityLabel="Close">
          <IconClose size={18} color={colors.ink2} />
        </Pressable>
      </View>

      <Text style={styles.question}>{q.label}</Text>

      <View style={{ gap: Spacing.two }}>
        {q.options.map((o, i) => {
          const on = selected.includes(o);
          return (
            <Pressable
              key={o}
              onPress={() => toggle(o)}
              style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.num, on && styles.numOn]}>
                <Text style={[styles.numText, on && styles.numTextOn]}>{i + 1}</Text>
              </View>
              <Text style={[styles.optionText, on && styles.optionTextOn]}>{o}</Text>
              {on ? <IconCheck size={16} sw={2.4} color={colors.accent} /> : null}
            </Pressable>
          );
        })}

        {otherOpen ? (
          <View style={styles.otherRow}>
            <TextInput
              value={other}
              onChangeText={setOther}
              autoFocus
              multiline
              placeholder="Something else"
              placeholderTextColor={colors.ink3}
              style={styles.otherInput}
              accessibilityLabel="Something else"
            />
            <Pressable
              onPress={sendOther}
              disabled={!other.trim()}
              style={[styles.sendCircle, !other.trim() && styles.submitOff]}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              <IconArrowUp size={16} sw={2.4} color={colors.onAccent} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setOtherOpen(true)}
            style={({ pressed }) => [styles.option, styles.optionDashed, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={styles.num}>
              <IconEdit size={13} color={colors.ink2} />
            </View>
            <Text style={styles.optionText}>Something else</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => advance([])} hitSlop={Spacing.two} accessibilityRole="button">
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
        {q.multi ? (
          <Pressable
            onPress={() => advance(selected)}
            disabled={!selected.length}
            style={({ pressed }) => [styles.next, !selected.length && styles.submitOff, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.submitText}>{step + 1 >= total ? 'Done' : 'Next'}</Text>
            <IconArrowRight size={16} sw={2.2} color={colors.onAccent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pressed: { opacity: 0.75 },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2, marginTop: -Spacing.two },
  block: { gap: Spacing.two },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  optional: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipOn: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  chipText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  chipTextOn: { fontFamily: Fonts.bold, color: colors.onAccent },
  textarea: {
    minHeight: 76,
    padding: Spacing.two + 4,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: 'transparent',
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  textareaOn: { borderColor: colors.accent, backgroundColor: colors.card },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
  },
  submitOff: { opacity: 0.5 },
  submitText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },

  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepCount: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto', marginRight: Spacing.three },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotOn: { width: 20, backgroundColor: colors.accentFill },
  question: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  optionDashed: { borderStyle: 'dashed', borderColor: colors.borderStrong },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  numOn: { backgroundColor: colors.accentFill },
  numText: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  numTextOn: { color: colors.onAccent },
  optionText: { flex: 1, fontFamily: Fonts.medium, fontSize: 14, color: colors.ink },
  optionTextOn: { fontFamily: Fonts.bold },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  otherInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, color: colors.ink, paddingVertical: 10, maxHeight: 96 },
  sendCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  skip: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink3 },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 20,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },

  sentLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.success },
  summary: { gap: 6, padding: Spacing.three, borderRadius: Radius.lg, backgroundColor: colors.successSoft },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryLabel: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2 },
  summaryValue: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink, flexShrink: 1 },
}));
