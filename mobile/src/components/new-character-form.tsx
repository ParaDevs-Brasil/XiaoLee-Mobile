import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import type { CreatorCatalog, SyntheticCreator } from '@/api/backend';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { useGridStyles } from '@/components/creator-grid-styles';
import { IconCheck, IconChevronLeft, IconChevronRight, IconMic, IconShield } from '@/components/icons';
import { UploadTile } from '@/components/upload-tile';
import { VoiceSheet } from '@/components/voice-sheet';
import { useTheme } from '@/hooks/use-theme';
import { createPersona, pickReferenceImage, type PickedImage } from '@/lib/creators';

/**
 * Formulário de novo personagem (foto, nome, voz e o termo). Vive aqui para as duas portas de entrada usarem o mesmo:
 * a lista de personagens e o "quem aparece no vídeo", onde dá para criar um personagem sem sair do fluxo.
 * `person`: o modo "Add a person" do Mimic e do Replace: só foto e nome (opcional), sem escolher voz — a voz não
 * entra nesses formatos, a não ser que a pessoa escolha o som "Voice" na tela do vídeo, onde dá para trocá-la.
 */
export function NewCharacterForm({
  catalog,
  onCreated,
  onCancel,
  onError,
  person = false,
  defaultName = 'Person',
}: {
  catalog: CreatorCatalog | null;
  onCreated: (creator: SyntheticCreator) => void;
  /** Sem `onCancel` não há para onde voltar (a tela não tem mais nada): a seta some. */
  onCancel?: () => void;
  onError: (e: unknown) => void;
  person?: boolean;
  /** Nome usado quando a pessoa deixa o campo em branco (só no modo `person`). */
  defaultName?: string;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const grid = useGridStyles();
  const [name, setName] = useState('');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [rights, setRights] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  async function pick() {
    try {
      const picked = await pickReferenceImage();
      if (picked) setImage(picked);
    } catch (e) {
      onError(e);
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      onCreated(await createPersona(person ? name.trim() || defaultName : name, voice!, image!));
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }

  const voiceName = (id: string) => catalog?.voices.find((v) => v.id === id)?.name ?? '';
  // No modo `person` a voz é a 1ª do catálogo; dá para trocar depois, na tela do vídeo.
  const voice = person ? (catalog?.voices[0]?.id ?? null) : voiceId;
  const canSave = Boolean((person || name.trim()) && voice && image && rights) && !saving;

  return (
    <>
      <View style={grid.formHead}>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            disabled={saving}
            style={grid.back}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
          </Pressable>
        ) : null}
        <View style={styles.rowBody}>
          <Text style={grid.title}>{person ? 'Add a person' : 'New character'}</Text>
          <Text style={grid.sub}>{person ? 'A clear photo is all it takes' : 'Add a photo, a name and a voice'}</Text>
        </View>
      </View>

      <UploadTile
        title="Add a photo"
        hint="Vertical and full body works best."
        onPress={pick}
        previewUri={image?.uri}
        changeLabel="Change photo"
        height={image ? 440 : 190}
        accessibilityLabel={person ? 'Add a photo of the person' : 'Add a photo of your character'}
      />

      <View style={grid.field}>
        <Text style={grid.label}>{person ? 'Name (optional)' : 'Name'}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={person ? defaultName : 'Character name'}
          placeholderTextColor={colors.ink3}
          maxLength={60}
          style={grid.input}
        />
      </View>

      {person ? null : (
      <View style={grid.field}>
        <Text style={grid.label}>Voice for talking videos</Text>
        <Pressable
          onPress={() => setVoiceOpen(true)}
          style={({ pressed }) => [grid.voiceRow, pressed && grid.pressed]}
          accessibilityRole="button"
          accessibilityLabel={voiceId ? `Voice: ${voiceName(voiceId)}. Change` : 'Choose a voice'}
        >
          <View style={grid.voiceIcon}>
            <IconMic size={20} sw={2} color={colors.accent} />
          </View>
          <View style={styles.rowBody}>
            <Text style={grid.voiceTitle}>{voiceId ? voiceName(voiceId) : 'Choose a voice'}</Text>
            <Text style={grid.voiceSub} numberOfLines={1}>
              {voiceId
                ? (catalog?.voices.find((v) => v.id === voiceId)?.description ?? '')
                : 'Brazilian, narrators, villains and more'}
            </Text>
          </View>
          <IconChevronRight size={18} sw={2.2} color={colors.ink3} />
        </Pressable>
      </View>
      )}

      <View style={grid.rules}>
        <View style={grid.ruleRow}>
          <IconShield size={18} color={colors.ink2} />
          <Text style={[grid.ruleText, styles.rowBody]}>No sexual content, no minors, and no pretending to be someone else.</Text>
        </View>
        <View style={grid.divider} />
        <Pressable
          onPress={() => setRights((v) => !v)}
          style={grid.ruleRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rights }}
        >
          <View style={[styles.checkbox, rights && styles.chipActive]}>
            {rights ? <IconCheck size={14} sw={3} color={colors.onAccent} /> : null}
          </View>
          <Text style={[grid.rightsText, styles.rowBody]}>
            This image is mine, or it&apos;s fan art or parody. I won&apos;t use it to deceive or harass anyone.
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={save}
        disabled={!canSave}
        style={({ pressed }) => [grid.firstBtn, !canSave && styles.disabled, pressed && grid.pressed]}
        accessibilityRole="button"
      >
        {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={grid.firstBtnText}>{person ? 'Add person' : 'Create character'}</Text>}
      </Pressable>
      <Text style={[grid.firstHint, grid.center]}>You pay per video, in USDC.</Text>
      {voiceOpen ? (
        <VoiceSheet voices={catalog?.voices ?? []} value={voiceId} onConfirm={setVoiceId} onClose={() => setVoiceOpen(false)} />
      ) : null}
    </>
  );
}
