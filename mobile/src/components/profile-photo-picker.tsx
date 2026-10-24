import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconEdit, IconUser } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useProfilePhoto } from '@/hooks/use-profile-photo';

/**
 * Avatar tocável do "Edit profile": mostra a foto atual e abre a galeria.
 *
 * A foto escolhida aqui é a mesma do card de compartilhar e do menu de
 * perfil (`useProfilePhoto`) — escolher uma vez vale para os três.
 */
export function ProfilePhotoPicker() {
  const colors = useTheme();
  const styles = useStyles();
  const { photo, busy, pick, canPick } = useProfilePhoto();
  const [error, setError] = useState(false);

  if (!canPick) return null;

  async function onPress() {
    setError(false);
    try {
      await pick();
    } catch {
      setError(true);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={photo ? 'Change profile photo' : 'Add profile photo'}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
        ) : (
          <IconUser size={36} sw={2} color={colors.onAccent} />
        )}
        {busy ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.onMedia} />
          </View>
        ) : null}
      </Pressable>
      <View style={styles.badge} pointerEvents="none">
        <IconEdit size={13} sw={2} color={colors.card} />
      </View>
      <Text style={styles.label}>
        {error ? "Couldn't load that photo" : photo ? 'Change photo' : 'Add a profile photo'}
      </Text>
    </View>
  );
}

const SIZE = 88;

const useStyles = makeStyles((colors) => ({
  wrap: { alignItems: 'center', gap: Spacing.two },
  avatar: {
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
    borderWidth: 3,
    borderColor: colors.accentSoft,
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,25,23,0.35)',
  },
  // Selo sobre a borda do avatar, canto inferior direito.
  badge: {
    position: 'absolute',
    top: SIZE - 26,
    left: '50%',
    marginLeft: SIZE / 2 - 22,
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.card,
  },
  label: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },
  pressed: { opacity: 0.7 },
}));
