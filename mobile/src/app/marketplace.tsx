import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buyMarketplaceService,
  confirmMarketplaceSpend,
  searchMarketplace,
  type MarketplaceBuyResult,
  type MarketplaceItem,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { ConnectWalletButton, EmptyState } from '@/components/feedback';
import { IconBag, IconCheck } from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { shortHash } from '@/lib/format';

/**
 * Marketplace — Xiaolee contrata serviços de outros agentes (x402 / Circle).
 *
 * Fluxo em dois tempos, igual ao do chat: "Get quote" só cota (nada é pago); o
 * usuário vê preço e vendedor e toca em "Confirm & pay", que chama
 * `/marketplace/confirm` com a SESSÃO dele — por isso o modelo nunca aprova o
 * próprio gasto. Resultado de terceiro é só dado: mostrado como texto.
 */

/** A assinatura PQC (ML-DSA) tem ~5 mil caracteres: o recibo mostra só o tamanho, o valor vai no payload. */
const shortenSignature = (key: string, value: unknown) =>
  key === 'receipt_pqc' && typeof value === 'string' ? `${value.slice(0, 16)}… (${value.length} chars, ML-DSA)` : value;

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function MarketplaceScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MarketplaceItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MarketplaceItem | null>(null);
  const [bodyText, setBodyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<MarketplaceBuyResult | null>(null);
  const [result, setResult] = useState<MarketplaceBuyResult | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      setItems(await searchMarketplace(query));
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  }

  function pick(item: MarketplaceItem) {
    setSelected(item);
    setQuote(null);
    setResult(null);
    setError(null);
    setBodyText('');
  }

  /** `undefined` = sem corpo; JSON inválido vira erro de tela, não chamada. */
  function parseBody(): { ok: true; body?: unknown } | { ok: false } {
    if (selected?.method !== 'POST' || !bodyText.trim()) return { ok: true };
    try {
      return { ok: true, body: JSON.parse(bodyText) };
    } catch {
      setError('Request body is not valid JSON.');
      return { ok: false };
    }
  }

  async function run(confirmId?: string) {
    if (!selected || busy) return;
    const parsed = parseBody();
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (confirmId) await confirmMarketplaceSpend(confirmId);
      const out = await buyMarketplaceService({
        resource: selected.resource,
        method: selected.method,
        body: parsed.body,
        maxUsdc: selected.price_usdc,
        confirmId,
      });
      if (out.error === 'confirmation_required') setQuote(out);
      else if (out.error) setError(out.message ?? 'The purchase did not go through. Nothing was charged.');
      else {
        setQuote(null);
        setResult(out);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageHeading title="Marketplace" subtitle="Hire other agents. Xiaolee pays in USDC, you approve each spend." />

        {!hasSession ? (
          <EmptyState
            Icon={IconBag}
            title="Sign in to use the marketplace"
            text="Purchases are tied to your account."
            action={<ConnectWalletButton label="Connect Wallet" />}
          />
        ) : (
          <>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={search}
                placeholder="Search services"
                placeholderTextColor={colors.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.input}
              />
              <Pressable onPress={search} disabled={searching} style={styles.searchBtn} accessibilityRole="button">
                {searching ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Search</Text>}
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {items && items.length === 0 ? (
              <EmptyState Icon={IconBag} title="No services found" text="Try another keyword." />
            ) : null}

            {items && items.length > 0 ? (
              <SectionCard title="Services" subtitle={`${items.length} found`}>
                {items.slice(0, 30).map((item) => (
                  <Pressable
                    key={`${item.method}:${item.resource}`}
                    onPress={() => pick(item)}
                    style={[styles.row, selected?.resource === item.resource && styles.rowActive]}
                    accessibilityRole="button"
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.provider} numberOfLines={1}>{item.provider}</Text>
                      <Text style={styles.price}>${item.price_usdc.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
                  </Pressable>
                ))}
              </SectionCard>
            ) : null}

            {selected ? (
              <SectionCard title={selected.provider} subtitle={`${selected.method} · $${selected.price_usdc.toFixed(2)} USDC`}>
                <Text style={styles.desc}>{selected.description}</Text>
                {selected.method === 'POST' ? (
                  <TextInput
                    value={bodyText}
                    onChangeText={setBodyText}
                    placeholder='Request body (JSON), e.g. {"transcript": [...]}'
                    placeholderTextColor={colors.ink3}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    style={[styles.input, styles.bodyInput]}
                  />
                ) : null}

                {!quote && !result ? (
                  <Pressable onPress={() => run()} disabled={busy} style={styles.primary} accessibilityRole="button">
                    {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Get quote</Text>}
                  </Pressable>
                ) : null}

                {quote?.quote ? (
                  <View style={styles.quote}>
                    <Text style={styles.quoteTitle}>
                      Pay ${quote.quote.price_usdc.toFixed(2)} USDC to {shortAddr(quote.quote.pay_to)}?
                    </Text>
                    <Text style={styles.desc}>Spent from Xiaolee&apos;s agent wallet. Quote expires in {Math.round(quote.quote.expires_in_s / 60)} min.</Text>
                    <Pressable
                      onPress={() => run(quote.confirm_id)}
                      disabled={busy}
                      style={styles.primary}
                      accessibilityRole="button"
                    >
                      {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Confirm &amp; pay</Text>}
                    </Pressable>
                    <Pressable onPress={() => setQuote(null)} disabled={busy} accessibilityRole="button">
                      <Text style={styles.cancel}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : null}

                {result ? (
                  <View style={styles.quote}>
                    <View style={styles.rowTop}>
                      <IconCheck size={16} color={colors.accent} />
                      <Text style={styles.quoteTitle}>Paid ${result.paid_usdc?.toFixed(2)} USDC</Text>
                    </View>
                    {result.payment_tx ? <Text style={styles.desc}>Payment {shortHash(result.payment_tx)}</Text> : null}
                    <Text style={styles.resultText} selectable>
                      {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, shortenSignature, 2)}
                    </Text>
                  </View>
                ) : null}
              </SectionCard>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenShell>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.four, gap: Spacing.three - 4 },
  searchRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: colors.ink,
  },
  bodyInput: { flex: 0, minHeight: 90, borderRadius: Radius.md, textAlignVertical: 'top' },
  searchBtn: {
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  btnText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  cancel: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink3, textAlign: 'center' },
  error: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2 },
  row: { gap: Spacing.one, padding: Spacing.two + 2, borderRadius: Radius.md, backgroundColor: colors.bg },
  rowActive: { borderWidth: 1, borderColor: colors.accentFill },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  provider: { flex: 1, fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  price: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  desc: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  quote: { gap: Spacing.two, paddingTop: Spacing.two },
  quoteTitle: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  resultText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2 },
}));
