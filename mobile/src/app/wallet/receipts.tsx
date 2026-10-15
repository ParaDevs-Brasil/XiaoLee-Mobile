import { useLocalSearchParams, useRouter } from 'expo-router';

import { ScreenShell } from '@/components/screen-shell';
import { WalletReceiptsView } from '@/components/wallet-receipts-view';
import { useCreatorWallet, useWalletMockMode, walletKey } from '@/hooks/use-creator-wallet';
import { useWallet } from '@/hooks/use-wallet';

/**
 * Recebimentos da carteira do creator — o "See all" da Wallet. O que aparece
 * vive em `components/wallet-receipts-view.tsx`.
 */
export default function ReceiptsScreen() {
  const { address, loading } = useWallet();
  const mode = useWalletMockMode((state) => state.mode);
  return <Receipts key={walletKey(address, mode)} address={address} addressLoading={loading} />;
}

function Receipts({ address, addressLoading }: { address: string | undefined; addressLoading: boolean }) {
  const router = useRouter();
  // O detalhamento abre a lista já filtrada (`?filter=campaign`).
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const wallet = useCreatorWallet(address, addressLoading);

  return (
    <ScreenShell>
      <WalletReceiptsView
        wallet={wallet}
        initialFilter={filter === 'campaign' || filter === 'purchase' ? filter : 'all'}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))}
      />
    </ScreenShell>
  );
}
