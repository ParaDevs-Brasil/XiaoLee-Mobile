import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconArrowRight, IconCheck } from '@/components/icons';
import { NETWORK_NAMES, SocialLogo } from '@/components/social-logos';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CardDraft } from '@/lib/chat-cards';

const GOALS = ['Grow my audience', 'Promote something', 'Share news', 'Start a conversation', 'Teach something'];
const TONES = ['Casual', 'Professional', 'Playful', 'Bold'];
const AUDIENCES = ['Crypto natives', 'New to crypto', 'Mixed'];

function Chip({ label, on, onPress, children }: { label: string; on: boolean; onPress: () => void; children?: React.ReactNode }) {
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
      {children}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Formulário de rascunho na conversa (`open_post_draft`): o creator escreve a ideia, escolhe objetivo, tom e rede, e
 * manda para a Xiaolee, que devolve as opções de post. Mandar = uma mensagem comum no chat (`onAsk`); nada é postado.
 */
export function PostDraftCard({ draft, onAsk }: { draft: CardDraft; onAsk: (message: string) => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const [platform, setPlatform] = useState(draft.networks[0].platform);
  const [idea, setIdea] = useState('');
  const [goal, setGoal] = useState(GOALS[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [audience, setAudience] = useState(AUDIENCES[2]);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View style={styles.sent}>
        <IconCheck size={14} color={colors.success} />
        <Text style={styles.sentText}>Idea sent to Xiaolee</Text>
      </View>
    );
  }

  function submit() {
    const name = NETWORK_NAMES[platform] ?? platform;
    setSent(true);
    onAsk(`Write post options for ${name}. Idea: ${idea.trim()}. Goal: ${goal}. Tone: ${tone}. Audience: ${audience}.`);
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>New post</Text>
        <View style={styles.tagPill}>
          <Text style={styles.tag}>Draft</Text>
        </View>
      </View>

      {draft.networks.length > 1 ? (
        <>
          <Text style={styles.label}>Network</Text>
          <View style={styles.chips}>
            {draft.networks.map((n) => (
              <Chip key={n.platform} label={n.platform === 'x' ? 'X (Twitter)' : (NETWORK_NAMES[n.platform] ?? n.platform)} on={platform === n.platform} onPress={() => setPlatform(n.platform)}>
                <SocialLogo platform={n.platform} ink={colors.ink} size={14} />
              </Chip>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Your idea</Text>
      <TextInput
        value={idea}
        onChangeText={setIdea}
        multiline
        placeholder="What do you want to say? A rough idea is enough."
        placeholderTextColor={colors.ink3}
        style={[styles.input, idea.trim() ? styles.inputOn : null]}
        accessibilityLabel="Post idea"
      />

      <Text style={styles.label}>Goal</Text>
      <View style={styles.chips}>
        {GOALS.map((g) => (
          <Chip key={g} label={g} on={goal === g} onPress={() => setGoal(g)} />
        ))}
      </View>

      <Text style={styles.label}>Who reads you</Text>
      <View style={styles.chips}>
        {AUDIENCES.map((a) => (
          <Chip key={a} label={a} on={audience === a} onPress={() => setAudience(a)} />
        ))}
      </View>

      <Text style={styles.label}>Tone</Text>
      <View style={styles.chips}>
        {TONES.map((t) => (
          <Chip key={t} label={t} on={tone === t} onPress={() => setTone(t)} />
        ))}
      </View>

      <Pressable
        onPress={submit}
        disabled={!idea.trim()}
        style={({ pressed }) => [styles.submit, !idea.trim() && styles.submitOff, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.submitText}>Generate post</Text>
        <IconArrowRight size={16} sw={2.2} color={colors.onAccent} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pressed: { opacity: 0.7 },
  card: {
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  tagPill: { paddingHorizontal: 10, height: 22, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.bg },
  tag: { fontFamily: Fonts.medium, fontSize: 11, color: colors.ink3 },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink, marginTop: Spacing.one },
  inputOn: { borderColor: colors.accent, backgroundColor: colors.card },
  input: {
    minHeight: 84,
    padding: Spacing.two + 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.bg,
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: 'top',
  },
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
  submit: {
    height: 48,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
  },
  submitOff: { opacity: 0.5 },
  submitText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.success },
}));
