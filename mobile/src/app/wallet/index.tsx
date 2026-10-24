import { useRouter } from 'expo-router';

import { listMyCampaigns, type UserCampaignParticipation } from '@/api/backend';
import { ScreenShell } from '@/components/screen-shell';
import { WalletHomeView } from '@/components/wallet-home-view';
import { useBackendData } from '@/hooks/use-backend-data';
import { useCreatorWallet, useWalletMockMode, walletKey } from '@/hooks/use-creator-wallet';
import { useSession } from '@/hooks/use-session';
import { useWallet } from '@/hooks/use-wallet';
import { getSession } from '@/lib/session';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Tela de Wallet — a carteira do creator na Arc, destino da primeira linha do
 * `ProfileMenu`. Esta rota só junta as fontes (Privy, sessão, backend); o que
 * aparece na tela vive em `components/wallet-home-view.tsx`.
 */

/**
 * Sem sessão não há o que buscar: a rota resolve o participante pelo `Bearer` e
 * responderia 401. Lista vazia deixa a tela mostrar o estado de convidado, que
 * é o correto — não ter entrado ainda não é erro.
 */
async function fetchRewards(): Promise<UserCampaignParticipation[]> {
  const session = await getSession();
  if (!session) return [];
  return listMyCampaigns();
}

export default function WalletScreen() {
  const { address, loading } = useWallet();
  const mode = useWalletMockMode((state) => state.mode);
  // Remonta ao trocar de endereço ou de modo: a busca do saldo depende dos
  // dois, e `useBackendData` só refaz sozinho quando a sessão muda.
  return <WalletHome key={walletKey(address, mode)} address={address} addressLoading={loading} />;
}

function WalletHome({ address, addressLoading }: { address: string | undefined; addressLoading: boolean }) {
  const router = useRouter();
  const { hasSession } = useSession();
  const { isConnected, disconnect } = usePrivyWallet();
  const wallet = useCreatorWallet(address, addressLoading);
  const rewards = useBackendData(fetchRewards);

  return (
    <ScreenShell deferContent>
      <WalletHomeView
        wallet={wallet}
        hasSession={hasSession}
        rewards={rewards}
        isConnected={isConnected}
        onSignOut={disconnect}
        onSeeAllReceipts={() => router.push('/wallet/receipts')}
        onSeeActivity={() => router.push('/wallet/activity')}
        onOpenBreakdown={() => router.push('/wallet/breakdown')}
      />
    </ScreenShell>
  );
}
