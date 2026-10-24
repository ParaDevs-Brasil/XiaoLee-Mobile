/**
 * Links para o explorer de blocos da Arc.
 *
 * O feed de traction mostra o hash da transação, mas hash truncado não é prova
 * de nada para quem está olhando a tela — é prova quando dá para abrir. Daí
 * este módulo existir: a linha do feed vira um link verificável.
 */

import { ARC_NETWORK } from '@/lib/arc-network';

/** Explorer da rede escolhida no build (`EXPO_PUBLIC_ARC_NETWORK`). */
const ARC_EXPLORER_URL = ARC_NETWORK.explorerUrl;

/**
 * Nem todo pagamento do feed tem transação na chain: com a chain fora do ar o
 * agente enfileira e responde `"status": "queued"`, e sem chave de admin ele
 * roda em `dry_run`. Nesses casos o campo `tx` carrega um marcador, não um
 * hash — o backend repassa o valor como veio, sem normalizar.
 *
 * Por isso o teste é positivo (parece um hash de transação EVM) e não negativo
 * (não é um marcador conhecido): assim um marcador novo do backend deixa de
 * ser link em vez de virar um link quebrado.
 *
 * Sem `0x` na frente de propósito: `web3.py` (`arc_native.py`,
 * `send_raw_transaction(...).hex()`) devolve o hash sem o prefixo, e é esse
 * valor cru que chega até aqui — tanto no `tx_hash` da tabela `arc_transfers`
 * quanto no `message.txHash` do chat. Exigir `0x` faria o teste falhar pra
 * toda transação real.
 */
export function isOnChainTx(tx: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(tx);
}

export function txExplorerUrl(tx: string): string {
  return `${ARC_EXPLORER_URL}/tx/${tx.startsWith('0x') ? tx : `0x${tx}`}`;
}
