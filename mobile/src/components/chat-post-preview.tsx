import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { publishSocialPost } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconCheck, IconSend } from '@/components/icons';
import { NETWORK_NAMES, SocialLogo } from '@/components/social-logos';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CardPost } from '@/lib/chat-cards';

/** O que a rede aceita (o backend confere de novo). Telegram só limita a legenda quando vai com vídeo. */
function limitFor(post: CardPost): number {
  if (post.platform === 'x') return 280;
  if (post.platform === 'bluesky') return 300;
  return post.clipId != null ? 1024 : 4000;
}

/**
 * Prévia do post que a Xiaolee deixou pronto (`prepare_social_post`): o creator vê como vai sair, ajusta o texto
 * ali mesmo e só então toca em postar — nada vai para a conta dele antes disso. Falha da rede volta com o motivo
 * e deixa tentar de novo.
 */
export function PostPreview({
  post,
  postedUrl,
  onPosted,
}: {
  post: CardPost;
  postedUrl?: string;
  onPosted: (url: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const [text, setText] = useState(post.text);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  const name = NETWORK_NAMES[post.platform] ?? post.platform;
  const limit = limitFor(post);
  const over = text.length > limit;
  const blocked = posting || over || !text.trim();

  if (postedUrl) {
    return (
      <Pressable
        onPress={() => postedUrl !== 'posted' && void WebBrowser.openBrowserAsync(postedUrl)}
        style={styles.done}
        accessibilityRole="link"
      >
        <IconCheck size={14} color={colors.success} />
        <Text style={styles.doneText}>Posted on {name}</Text>
      </Pressable>
    );
  }

  async function publish() {
    setPosting(true);
    setError(undefined);
    try {
      const result = await publishSocialPost(post.platform, text.trim(), post.clipId);
      if (result.status === 'published') onPosted(result.url ?? 'posted');
      else setError(result.error ?? 'Could not post');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SocialLogo platform={post.platform} ink={colors.ink} size={18} />
        <Text style={styles.who} numberOfLines={1}>
          {name}
          {post.handle ? ` · ${post.handle}` : ''}
        </Text>
        <Text style={styles.tag}>Preview</Text>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!posting}
        placeholderTextColor={colors.ink3}
        style={styles.input}
        accessibilityLabel="Post text"
      />
      {post.clipId != null ? <Text style={styles.chip}>Video clip attached</Text> : null}
      <View style={styles.foot}>
        <Text style={[styles.count, over && styles.countOver]}>
          {text.length}/{limit}
        </Text>
        <Text style={styles.hint}>Tap the text to edit</Text>
      </View>
      <Pressable
        onPress={publish}
        disabled={blocked}
        style={({ pressed }) => [styles.post, blocked && styles.postOff, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Post to ${name}`}
      >
        {posting ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            <IconSend size={15} color={colors.onAccent} />
            <Text style={styles.postText}>Post to {name}</Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pressed: { opacity: 0.7 },
  card: {
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  who: { flex: 1, fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  tag: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  input: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20, color: colors.ink, minHeight: 64, padding: 0, textAlignVertical: 'top' },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: colors.ink2,
  },
  foot: { flexDirection: 'row', justifyContent: 'space-between' },
  count: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink3 },
  countOver: { color: colors.danger },
  hint: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  post: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  postOff: { opacity: 0.5 },
  postText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
  error: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.danger },
  done: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.success },
}));
