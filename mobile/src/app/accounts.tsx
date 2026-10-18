import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  connectSocialAccount,
  disconnectSocialAccount,
  listSocialAccounts,
  type SocialAccounts,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconCheck, IconShare } from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { SocialLogo } from '@/components/social-logos';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { getSession } from '@/lib/session';

/** Redes na ordem em que aparecem. `soon` = ainda sem publicação direta (depende de OAuth/auditoria da rede). */
const NETWORKS = [
  { platform: 'telegram', name: 'Telegram', soon: false },
  { platform: 'bluesky', name: 'Bluesky', soon: false },
  { platform: 'x', name: 'X', soon: true },
  { platform: 'tiktok', name: 'TikTok', soon: true },
] as const;

/** Campos que cada rede pede para conectar. `secret` esconde o que o creator digita. */
const FIELDS: Record<string, { key: string; label: string; placeholder: string; secret?: boolean }[]> = {
  telegram: [{ key: 'channel', label: 'Channel', placeholder: '@yourchannel' }],
  bluesky: [
    { key: 'identifier', label: 'Handle', placeholder: 'you.bsky.social' },
    { key: 'app_password', label: 'App password', placeholder: 'xxxx-xxxx-xxxx-xxxx', secret: true },
  ],
};

/** Sem sessão a rota responde 401 — `null` deixa a tela no estado de convidado. */
async function fetchAccounts(): Promise<SocialAccounts | null> {
  const session = await getSession();
  if (!session) return null;
  return listSocialAccounts();
}

/** Contas onde a Xiaolee posta pelo creator: conecta, valida na própria rede e desconecta. */
export default function AccountsScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchAccounts);
  const [open, setOpen] = useState<string | null>(null);

  // 404 = publicação desligada no backend (`SOCIAL_TOOLS_ENABLED`): não é falha, é recurso que ainda não chegou.
  const unavailable = error !== null && /not found/i.test(error);

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom + 56 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <PageHeading
          title="Accounts"
          subtitle="Connect your networks and Xiaolee posts for you, only when you confirm."
        />

        {error && hasSession && !unavailable ? (
          <ErrorState title="Couldn't load your accounts" message={error} onRetry={reload} />
        ) : null}

        {loading && !data && !error ? <Skeleton height={260} radius={Radius.lg} /> : null}

        {!hasSession || unavailable ? (
          <SectionCard title="Networks">
            <EmptyState
              Icon={IconShare}
              title={hasSession ? 'Posting is not available yet' : 'Sign in to connect your networks'}
              text="Xiaolee will post to the accounts you connect here."
            />
          </SectionCard>
        ) : null}

        {data ? (
          <SectionCard title="Networks" subtitle="Disconnect any time and your access is deleted.">
            {NETWORKS.map(({ platform, name, soon }) => {
              const account = data.accounts.find((a) => a.platform === platform);
              const supported = !soon && data.available.includes(platform);
              return (
                <View key={platform} style={styles.item}>
                  <View style={styles.row}>
                    <View style={styles.logo}>
                      <SocialLogo platform={platform} ink={colors.ink} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.name}>{name}</Text>
                      {account ? (
                        <View style={styles.status}>
                          <IconCheck size={13} sw={2.6} color={colors.success} />
                          <Text style={styles.connected} numberOfLines={1}>
                            Connected · {account.handle}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.muted}>{supported ? 'Not connected' : 'Coming soon'}</Text>
                      )}
                    </View>
                    {account ? (
                      <DisconnectButton
                        name={name}
                        platform={platform}
                        onDone={() => {
                          setOpen(null);
                          reload();
                        }}
                      />
                    ) : supported ? (
                      <Pressable
                        onPress={() => setOpen(open === platform ? null : platform)}
                        style={({ pressed }) => [styles.connect, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Connect ${name}`}
                      >
                        <Text style={styles.connectText}>{open === platform ? 'Cancel' : 'Connect'}</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.soon}>
                        <Text style={styles.soonText}>Soon</Text>
                      </View>
                    )}
                  </View>

                  {!account && supported && open === platform ? (
                    <ConnectForm
                      platform={platform}
                      botName={data.hints.telegram_bot}
                      onConnected={() => {
                        setOpen(null);
                        reload();
                      }}
                    />
                  ) : null}
                </View>
              );
            })}
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

/** Formulário de conexão: o backend confere na rede (bot admin do canal, app password) e devolve o motivo se falhar. */
function ConnectForm({
  platform,
  botName,
  onConnected,
}: {
  platform: string;
  botName: string;
  onConnected: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const fields = FIELDS[platform] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = fields.every((f) => (values[f.key] ?? '').trim());

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await connectSocialAccount(platform, values);
      onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.helper}>
        {platform === 'telegram'
          ? `Add ${botName ? `@${botName}` : 'the Xiaolee bot'} as an admin of your channel, with permission to post. Then enter the channel here.`
          : 'Create an app password in Bluesky (Settings → Privacy and security → App passwords) and paste it here. Never use your main password.'}
      </Text>
      {fields.map((f) => (
        <View key={f.key} style={styles.field}>
          <Text style={styles.label}>{f.label}</Text>
          <TextInput
            value={values[f.key] ?? ''}
            onChangeText={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))}
            placeholder={f.placeholder}
            placeholderTextColor={colors.ink3}
            secureTextEntry={f.secret}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel={f.label}
          />
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={submit}
        disabled={!ready || busy}
        style={({ pressed }) => [styles.submit, (!ready || busy) && styles.submitOff, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <Text style={styles.submitText}>Connect and verify</Text>
        )}
      </Pressable>
    </View>
  );
}

/** Duas etapas (tocar, confirmar): desconectar apaga o acesso guardado, e refazer dá trabalho. */
function DisconnectButton({
  name,
  platform,
  onDone,
}: {
  name: string;
  platform: string;
  onDone: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectSocialAccount(platform);
      onDone();
    } catch {
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (busy) return <ActivityIndicator size="small" color={colors.ink3} />;

  return confirming ? (
    <View style={styles.confirm}>
      <Pressable onPress={() => setConfirming(false)} hitSlop={Spacing.two} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={disconnect}
        style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Confirm disconnect ${name}`}
      >
        <Text style={styles.dangerText}>Disconnect</Text>
      </Pressable>
    </View>
  ) : (
    <Pressable
      onPress={() => setConfirming(true)}
      hitSlop={Spacing.two}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={`Disconnect ${name}`}
    >
      <Text style={styles.cancelText}>Disconnect</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  pressed: { opacity: 0.7 },
  item: { borderRadius: Radius.md, backgroundColor: colors.bg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, padding: Spacing.two + 2 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  muted: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink3, marginTop: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  connected: { flex: 1, fontFamily: Fonts.sans, fontSize: 12, color: colors.success },
  connect: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  connectText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  soon: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  soonText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink3 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  cancelText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  danger: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.dangerFill,
  },
  dangerText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  form: {
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingBottom: Spacing.two + 2,
  },
  helper: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  field: { gap: 4 },
  label: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink2 },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three - 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: colors.ink,
  },
  error: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.danger },
  submit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  submitOff: { opacity: 0.5 },
  submitText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
}));
