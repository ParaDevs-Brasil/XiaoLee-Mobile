import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { createSwapPreview, getSwapPreview, type CreatorPreview } from '@/api/backend';
import { ApiError } from '@/api/client';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { SectionCard } from '@/components/section-card';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { uploadMotion, type PickedMotion } from '@/lib/creators';
import { clampStart } from '@/lib/creators-core';

const POLL_MS = 3000;

/**
 * Prévia do Swap: o quadro do vídeo com o personagem no lugar da pessoa. É grátis (o backend limita por dia) e vem
 * antes do pagamento — o usuário só cria o vídeo se o quadro estiver certo. Quem paga é a tela da persona.
 */
export function SwapPreview({
  creatorId,
  motion,
  windowS,
  rights,
  motionKey,
  onMotionKey,
  preview,
  onPreview,
  onError,
}: {
  creatorId: number;
  motion: PickedMotion | null;
  /** Duração escolhida: o trecho do vídeo que o preview mostra começa no corte e dura isso. */
  windowS: number;
  rights: boolean;
  /** Chave do vídeo já enviado ao storage (reaproveitada no pagamento, sem subir de novo). */
  motionKey: string | null;
  onMotionKey: (key: string) => void;
  preview: CreatorPreview | null;
  onPreview: (p: CreatorPreview | null) => void;
  onError: (e: unknown) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const working = busy || preview?.status === 'working';

  useEffect(() => {
    if (preview?.status !== 'working') return;
    const t = setInterval(() => {
      getSwapPreview(preview.id).then(onPreview).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [preview?.status, preview?.id, onPreview]);

  async function make() {
    if (!motion || !rights || working) return;
    setBusy(true);
    try {
      const key = motionKey ?? (await uploadMotion(motion));
      onMotionKey(key);
      onPreview(await createSwapPreview(creatorId, {
          motion_key: key,
          motion_rights_confirmed: true,
          motion_start_s: clampStart(motion.startS, motion.seconds, windowS),
        }));
    } catch (e) {
      onError(e instanceof ApiError || e instanceof Error ? e : new Error('Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const can = Boolean(motion && rights) && !working;
  return (
    <SectionCard title="Preview" subtitle="See your character in the video before you pay. Previews are free.">
      {preview?.status === 'ready' && preview.frame_url ? (
        <>
          <Image
            source={{ uri: preview.frame_url }}
            style={{ width: '100%', height: 380, borderRadius: Radius.md, backgroundColor: colors.bg }}
            contentFit="contain"
          />
          <Text style={styles.desc}>Looks right? Create the video below. If not, make a new preview.</Text>
        </>
      ) : null}
      {working ? (
        <Text style={[styles.desc, { textAlign: 'center', paddingVertical: Spacing.two }]}>Making your preview… about 20 seconds.</Text>
      ) : null}
      {preview?.status === 'failed' ? <Text style={styles.error}>{preview.error ?? 'We couldn’t make the preview. Try again.'}</Text> : null}
      <Pressable
        onPress={make}
        disabled={!can}
        style={[styles.primary, !can && styles.disabled]}
        accessibilityRole="button"
      >
        {working ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.btnText}>{preview?.status === 'ready' ? 'Make a new preview' : 'Make a preview'}</Text>
        )}
      </Pressable>
      {!motion || !rights ? <Text style={styles.desc}>Choose your video and confirm the box above first.</Text> : null}
    </SectionCard>
  );
}
