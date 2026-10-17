import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { getHealth, getTractionStats, type HealthResponse, type TractionSnapshot } from '@/api/backend';
import { ApiError } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_URL, API_URL_SOURCE } from '@/lib/config';

const SOURCE_LABEL: Record<typeof API_URL_SOURCE, string> = {
  env: 'EXPO_PUBLIC_API_URL',
  packager: 'host do Metro',
  fallback: 'padrão da plataforma',
};

interface BackendState {
  health: HealthResponse | null;
  traction: TractionSnapshot | null;
  error: string | null;
}

const EMPTY: BackendState = { health: null, traction: null, error: null };

/**
 * Busca o estado do backend sem tocar em state do React — assim tanto o efeito
 * de montagem quanto o botão de refresh reusam a mesma lógica, cada um
 * decidindo quando (e se) aplicar o resultado.
 */
async function fetchBackendState(): Promise<BackendState> {
  try {
    // `/health` prova que o backend responde; `/v1/traction/stats` prova que
    // o dado real do produto chega — as duas rotas são públicas.
    const [health, traction] = await Promise.all([getHealth(), getTractionStats()]);
    return { health, traction, error: null };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    return { health: null, traction: null, error: message };
  }
}

/**
 * Tela de diagnóstico da conexão com o backend FastAPI.
 *
 * É a primeira tela do app de propósito: antes de portar chat, campanhas e
 * agente, é preciso conseguir ver de dentro do aparelho se `API_URL` está
 * certa — o erro mais comum aqui é apontar para `localhost`, que no device
 * resolve para o próprio aparelho e não para a máquina de desenvolvimento.
 */
export default function ConnectionScreen() {
  const theme = useTheme();
  const [state, setState] = useState<BackendState>(EMPTY);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    setLoading(true);
    setState(await fetchBackendState());
    setLoading(false);
  }, []);

  // `loading` já nasce `true`, então a checagem de montagem não precisa (nem
  // deve) chamar setState de forma síncrona aqui — o React Compiler trata isso
  // como render em cascata (`react-hooks/set-state-in-effect`).
  useEffect(() => {
    let cancelled = false;

    fetchBackendState().then((next) => {
      if (cancelled) return;
      setState(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const connected = state.health !== null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={check} />}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            BACKEND
          </ThemedText>
          <ThemedText type="code">{API_URL}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            resolvido via {SOURCE_LABEL[API_URL_SOURCE]}
          </ThemedText>
        </ThemedView>

        {loading && !state.health && !state.error ? (
          <ThemedView style={styles.centered}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">
              conectando…
            </ThemedText>
          </ThemedView>
        ) : null}

        {state.error ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="danger">
              SEM CONEXÃO
            </ThemedText>
            <ThemedText type="small">{state.error}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Suba o backend com `make dev-backend` na raiz do repositório. Ele precisa escutar em
              0.0.0.0:8000 para o aparelho alcançá-lo pela rede.
            </ThemedText>
          </ThemedView>
        ) : null}

        {connected && state.health ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="success">
              CONECTADO
            </ThemedText>
            <Row label="serviço" value={state.health.service} />
            <Row label="versão" value={state.health.version} />
            <Row label="ambiente" value={state.health.environment} />
            <Row label="cluster solana" value={state.health.solana_cluster} />
            <Row label="gemini" value={state.health.gemini_enabled ? 'ativo' : 'desativado'} />
          </ThemedView>
        ) : null}

        {state.traction ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              TRACTION
            </ThemedText>
            <Row label="USDC liquidado" value={`$${state.traction.total_usdc.toFixed(2)}`} />
            <Row label="pagamentos" value={String(state.traction.total_payments)} />
            <Row label="creators ativos" value={String(state.traction.active_creators)} />
            <Row label="latência média" value={`${Math.round(state.traction.avg_latency_ms)} ms`} />
          </ThemedView>
        ) : null}

        <Pressable
          onPress={check}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.backgroundSelected, opacity: pressed || loading ? 0.6 : 1 },
          ]}>
          <ThemedText type="smallBold">{loading ? 'Verificando…' : 'Testar conexão'}</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  centered: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
