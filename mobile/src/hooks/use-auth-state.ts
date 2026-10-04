import { usePrivy } from '@privy-io/expo';

import { useSession } from '@/hooks/use-session';
import { deriveAuthState, isRealSession, type AuthState } from '@/lib/auth-state';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Estado do login que o gate de rotas (`app/_layout.tsx`) e a tela de login
 * leem. Só junta as três fontes reais — sessão guardada, Privy e o resultado da
 * troca de token — a regra em si vive em `lib/auth-state.ts`, onde é testada.
 *
 * Tem que rodar dentro do `PrivyProvider` e do `WalletProvider`.
 */
export function useAuthState(): AuthState {
  const { session, loading } = useSession();
  const { isReady, user } = usePrivy();
  const { sessionError } = usePrivyWallet();

  return deriveAuthState({
    sessionLoaded: !loading,
    hasSession: isRealSession(session),
    privyReady: isReady,
    hasPrivyUser: Boolean(user),
    sessionError,
  });
}
