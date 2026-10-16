/**
 * Rede Arc que o app usa, escolhida em build time por `EXPO_PUBLIC_ARC_NETWORK`
 * (`mainnet` | `testnet`; qualquer outro valor = testnet, o default histórico).
 *
 * Fica fora de `wallet.tsx` para `explorer.ts` poder ler sem puxar o Privy.
 * Precisa bater com o `ARC_CHAIN_ID` / `ARC_RPC_URL` do backend: o app assina e
 * lê saldo nesta chain, o backend liquida na dele.
 */
const isMainnet = process.env.EXPO_PUBLIC_ARC_NETWORK?.trim() === 'mainnet';

export const ARC_NETWORK = isMainnet
  ? {
      isMainnet: true,
      chainId: 5042,
      name: 'Arc',
      rpcUrl: 'https://rpc.mainnet.arc.io',
      explorerName: 'Arc Explorer',
      explorerUrl: 'https://explorer.arc.io',
    }
  : {
      isMainnet: false,
      chainId: 5042002,
      name: 'Arc Testnet',
      rpcUrl: 'https://rpc.testnet.arc.network',
      explorerName: 'Arcscan',
      explorerUrl: 'https://testnet.arcscan.app',
    };
