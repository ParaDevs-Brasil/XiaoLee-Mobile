import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { IconEdit, IconTrash } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/**
 * O menu "⋯" de um vídeo ou de um corte: renomear e apagar.
 *
 * Apagar é em dois passos dentro do próprio sheet — a lista de ações e, ao
 * escolher "Delete", uma tela de confirmação que diz o que some junto. Nada é
 * apagado no primeiro toque, e a confirmação nomeia o item e as consequências
 * em vez de um genérico "Are you sure?".
 *
 * Quem usa monta o componente só enquanto o menu está aberto (mesmo acordo do
 * `RenameSheet`): o passo volta ao início a cada abertura, sem efeito de limpeza.
 */
export function ItemMenu({
  heading,
  kind,
  consequence,
  onRename,
  onDelete,
  onClose,
}: {
  /** O nome do item — aparece no topo, para o menu dizer sobre o que é. */
  heading: string;
  /** "clip" ou "video": entra nos rótulos ("Rename clip", "Delete video"). */
  kind: 'clip' | 'video';
  /** O que some junto com o item, em uma frase ("…and its 3 clips"). */
  consequence: string;
  onRename: () => void;
  /** Rejeitar mantém o sheet aberto com a mensagem; resolver fecha. */
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'menu' | 'confirm'>('menu');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't delete the ${kind}. Try again.`);
      setDeleting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={deleting ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={deleting ? undefined : onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Spacing.three + insets.bottom }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />

          {step === 'menu' ? (
            <>
              <Text style={styles.heading} numberOfLines={2}>
                {heading}
              </Text>

              <View style={styles.list}>
                <Pressable
                  onPress={() => {
                    onClose();
                    // O sheet de renomear é outro `Modal`: abrir um no mesmo instante em que o outro fecha
                    // deixa o do Android preso na tela. Um respiro dá tempo de o primeiro sair.
                    setTimeout(onRename, 350);
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={styles.rowIcon}>
                    <IconEdit size={18} sw={2} color={Colors.light.ink} />
                  </View>
                  <Text style={styles.rowText}>Rename {kind}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setStep('confirm')}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={[styles.rowIcon, styles.rowIconDanger]}>
                    <IconTrash size={18} sw={2} color={Colors.light.danger} />
                  </View>
                  <Text style={[styles.rowText, styles.dangerText]}>Delete {kind}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.confirmIcon}>
                <IconTrash size={24} sw={2} color={Colors.light.danger} />
              </View>
              <Text style={styles.confirmTitle}>Delete this {kind}?</Text>
              <Text style={styles.confirmName} numberOfLines={2}>
                “{heading}”
              </Text>
              <Text style={styles.confirmText}>{consequence} This can’t be undone.</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  onPress={onClose}
                  disabled={deleting}
                  style={({ pressed }) => [styles.keep, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.keepText}>Keep it</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDelete}
                  disabled={deleting}
                  style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ busy: deleting }}
                >
                  {deleting ? <ActivityIndicator size="small" color={Colors.light.card} /> : null}
                  <Text style={styles.deleteText}>Delete {kind}</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  heading: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: Colors.light.ink2 },
  list: { gap: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    minHeight: 56,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: Colors.light.dangerSoft },
  rowText: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.ink },
  dangerText: { color: Colors.light.danger },
  pressed: { opacity: 0.7 },
  confirmIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.light.ink },
  confirmName: { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 21, color: Colors.light.ink2 },
  confirmText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Colors.light.ink2 },
  error: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: Colors.light.danger },
  actions: { flexDirection: 'row', gap: Spacing.three - 4, marginTop: Spacing.two },
  keep: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  keepText: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.ink },
  delete: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.danger,
  },
  deleteText: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.card },
});
