import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CreatorVoice, SyntheticCreator } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconChevronRight, IconMic } from '@/components/icons';
import { VoiceSheet } from '@/components/voice-sheet';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

const NAME_MAX = 60;

/**
 * Edit a character: name and voice. The photo stays as it is (the rights term covers that exact image).
 *
 * Mount only while open, like `RenameSheet`: the draft is born from `creator` on each opening. `onSave` receives only
 * what changed; rejecting keeps the sheet open with the message, resolving closes it.
 */
export function CreatorEditSheet({
  creator,
  voices,
  onSave,
  onClose,
}: {
  creator: SyntheticCreator;
  voices: CreatorVoice[];
  onSave: (patch: { name?: string; voice_id?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(creator.name);
  const [voiceId, setVoiceId] = useState(creator.voice_id);
  const [pickingVoice, setPickingVoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.replace(/\s+/g, ' ').trim();
  const voice = voices.find((v) => v.id === voiceId);
  const changed = trimmed !== creator.name || voiceId !== creator.voice_id;
  const canSave = trimmed.length > 0 && changed && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...(trimmed !== creator.name ? { name: trimmed } : {}),
        ...(voiceId !== creator.voice_id ? { voice_id: voiceId } : {}),
      });
      onClose();
    } catch (err) {
      // 404/405 = the server doesn't have the edit route yet.
      const missing = err instanceof ApiError && (err.status === 404 || err.status === 405);
      setError(missing ? 'Editing characters isn’t available yet.' : err instanceof ApiError ? err.message : 'Couldn’t save. Try again.');
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={saving ? undefined : onClose}>
          <Pressable style={[styles.sheet, { paddingBottom: Spacing.three + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.heading}>Edit character</Text>

            <View style={styles.group}>
              <Text style={styles.label}>Name</Text>
              <View style={styles.field}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  maxLength={NAME_MAX}
                  editable={!saving}
                  returnKeyType="done"
                  placeholder="Character name"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                  accessibilityLabel="Character name"
                />
                <Text style={[styles.counter, name.length >= NAME_MAX && styles.counterFull]}>
                  {name.length}/{NAME_MAX}
                </Text>
              </View>
            </View>

            <View style={styles.group}>
              <Text style={styles.label}>Voice for talking videos</Text>
              <Pressable
                onPress={() => setPickingVoice(true)}
                disabled={saving}
                style={({ pressed }) => [styles.voiceRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Voice: ${voice?.name ?? 'none'}. Change`}
              >
                <View style={styles.voiceIcon}>
                  <IconMic size={20} sw={2} color={colors.accent} />
                </View>
                <View style={styles.voiceBody}>
                  <Text style={styles.voiceTitle}>{voice?.name ?? 'Choose a voice'}</Text>
                  {voice?.description ? (
                    <Text style={styles.voiceSub} numberOfLines={1}>
                      {voice.description}
                    </Text>
                  ) : null}
                </View>
                <IconChevronRight size={18} sw={2.2} color={colors.ink3} />
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable onPress={onClose} disabled={saving} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={!canSave}
                style={({ pressed }) => [styles.save, !canSave && styles.saveOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave, busy: saving }}
              >
                {saving ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
      {pickingVoice ? <VoiceSheet voices={voices} value={voiceId} onConfirm={setVoiceId} onClose={() => setPickingVoice(false)} /> : null}
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: colors.card,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.pill, backgroundColor: colors.border, marginBottom: Spacing.one },
  heading: { fontFamily: Fonts.bold, fontSize: 18, color: colors.ink },
  group: { gap: Spacing.one + 2 },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  field: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.bg,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two,
  },
  input: { minHeight: 36, padding: 0, fontFamily: Fonts.semibold, fontSize: 16, color: colors.ink },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  counterFull: { color: colors.danger },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    minHeight: 64,
    padding: Spacing.three - 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  voiceIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  voiceBody: { flex: 1, gap: 2 },
  voiceTitle: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  voiceSub: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  error: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.three },
  cancel: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.two },
  cancelText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink2 },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    minWidth: 112,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  saveOff: { opacity: 0.4 },
  saveText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
  pressed: { opacity: 0.7 },
}));
