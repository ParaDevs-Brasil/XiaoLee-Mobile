import { useRouter } from 'expo-router';

import { ScreenShell } from '@/components/screen-shell';
import { WalletBreakdownView } from '@/components/wallet-breakdown-view';
import { useCreatorWallet, useWalletMockMode, walletKey } from '@/hooks/use-creator-wallet';
import { useWallet } from '@/hooks/use-wallet';

/**
 * Detalhamento das entradas — o "Details ›" do cartão de saldo. O que
 * aparece vive em `components/wallet-breakdown-view.tsx`.
 */
export default function BreakdownScreen() {
  const { address, loading } = useWallet();
  const mode = useWalletMockMode((state) => state.mode);
  return <Breakdown key={walletKey(address, mode)} address={address} addressLoading={loading} />;
}

function Breakdown({ address, addressLoading }: { address: string | undefined; addressLoading: boolean }) {
  const router = useRouter();
  const wallet = useCreatorWallet(address, addressLoading);

  return (
    <ScreenShell>
      <WalletBreakdownView
        wallet={wallet}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))}
        onOpenPayments={(filter) => router.push({ pathname: '/wallet/receipts', params: { filter } })}
      />
    </ScreenShell>
  );
}
