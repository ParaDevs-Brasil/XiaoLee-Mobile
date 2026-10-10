import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { TITLE_MAX_LENGTH } from '@/api/backend';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/**
 * Sheet para renomear um corte ou um vídeo.
 *
 * Quem usa monta o componente só enquanto a edição está aberta (`{editing ?
 * <RenameSheet … /> : null}`): o rascunho nasce do `initial` a cada abertura,
 * sem efeito para "limpar" o estado ao fechar. Mesmo formato do
 * `ConnectWalletSheet` — `Modal` com `KeyboardAvoidingView` próprio, porque o
 * `Modal` abre uma janela nativa e desde o edge-to-edge a janela não encolhe
 * quando o teclado sobe.
 */
export function RenameSheet({
  heading,
  initial,
  onSave,
  onClose,
}: {
  /** "Rename clip", "Rename video" — diz o que está sendo editado. */
  heading: string;
  initial: string;
  /** Rejeitar mantém o sheet aberto e mostra a mensagem; resolver fecha. */
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.replace(/\s+/g, ' ').trim();
  const canSave = trimmed.length > 0 && trimmed !== initial && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the new name. Try again.");
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={saving ? undefined : onClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Spacing.three + insets.bottom }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.handle} />
            <Text style={styles.heading}>{heading}</Text>

            <View style={styles.field}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoFocus
                selectTextOnFocus
                multiline
                maxLength={TITLE_MAX_LENGTH}
                editable={!saving}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={save}
                placeholder="Give it a name"
                placeholderTextColor={Colors.light.ink3}
                style={styles.input}
                accessibilityLabel={heading}
              />
              <Text style={[styles.counter, draft.length >= TITLE_MAX_LENGTH && styles.counterFull]}>
                {draft.length}/{TITLE_MAX_LENGTH}
              </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                disabled={saving}
                style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={!canSave}
                style={({ pressed }) => [styles.save, !canSave && styles.saveOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave, busy: saving }}
              >
                {saving ? <ActivityIndicator size="small" color={Colors.light.card} /> : null}
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(26,25,23,0.35)', justifyContent: 'flex-end' },
  sheet: {
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.light.card,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.border,
    marginBottom: Spacing.one,
  },
  heading: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.light.ink },
  field: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.accent,
    backgroundColor: Colors.light.bg,
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  input: {
    minHeight: 48,
    maxHeight: 120,
    padding: 0,
    fontFamily: Fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.light.ink,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3 },
  counterFull: { color: Colors.light.danger },
  error: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: Colors.light.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.three },
  cancel: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.two },
  cancelText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.ink2 },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    minWidth: 112,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  saveOff: { opacity: 0.4 },
  saveText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },
  pressed: { opacity: 0.7 },
});
