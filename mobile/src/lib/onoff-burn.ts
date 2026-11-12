/**
 * Monta as duas transações do saque entre redes (Arc -> Base/Ethereum) que a carteira do USUÁRIO assina:
 * `approve` do USDC e `depositForBurnWithHook` do CCTP V2 (a Circle faz o mint no destino).
 *
 * O backend só cota a taxa; o que decide para onde o dinheiro vai é o que a pessoa digitou aqui. Por isso
 * o contrato (TokenMessengerV2), o domínio, o destinatário, o valor e o teto de taxa são conferidos contra o
 * pedido e contra constantes do app antes de qualquer assinatura — resposta adulterada do backend não move fundos.
 * Sem imports do React Native: roda em `node --experimental-strip-types`.
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi } from 'viem';

/** TokenMessengerV2 da Arc mainnet — developers.circle.com/cctp/references/contract-addresses. */
export const ARC_TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
export const ARC_DOMAIN = 26;
export const NETWORK_DOMAIN = { base: 6, ethereum: 0 } as const;
export type ChainNetwork = keyof typeof NETWORK_DOMAIN;
/** Hook estático do Forwarding Service (`cctp-forward`, versão 0, tamanho 0). */
export const FORWARD_HOOK_DATA = '0x636374702d666f72776172640000000000000000000000000000000000000000';
/** Teto absoluto de taxa aceito (USDC): cota normal é centavos; acima disso algo está errado. */
const MAX_FEE_CAP_MINOR = 2_000_000n;
const ZERO32 = `0x${'0'.repeat(64)}` as `0x${string}`;

const abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
]);

/** O que `POST /v1/onoff/withdraw` devolve em `burn`. */
export interface BurnParams {
  token_messenger: string;
  usdc: string;
  source_domain: number;
  destination_domain: number;
  mint_recipient: string;
  destination_caller: string;
  burn_amount: string;
  max_fee: string;
  min_finality_threshold: number;
  hook_data: string;
}

export interface BurnInput {
  amountUsdc: number;
  network: ChainNetwork;
  address: string;
}

export interface Tx {
  to: string;
  data: string;
}

export function usdcMinor(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Levanta `Error` com a razão se algo da cotação não bate com o pedido; senão devolve as duas txs. */
export function buildBurnTxs(input: BurnInput, p: BurnParams): { approve: Tx; burn: Tx } {
  if (!isAddress(input.address)) throw new Error('Endereço de destino inválido.');
  if (!(input.amountUsdc > 0)) throw new Error('Valor inválido.');
  const burn = BigInt(p.burn_amount);
  const fee = BigInt(p.max_fee);
  const want = usdcMinor(input.amountUsdc);

  if (!same(p.token_messenger, ARC_TOKEN_MESSENGER)) throw new Error('Contrato de saque inesperado.');
  if (!isAddress(p.usdc)) throw new Error('Token inesperado.');
  if (p.source_domain !== ARC_DOMAIN) throw new Error('Rede de origem inesperada.');
  if (p.destination_domain !== NETWORK_DOMAIN[input.network]) throw new Error('Rede de destino inesperada.');
  if (!same(p.mint_recipient, `0x${'0'.repeat(24)}${input.address.slice(2)}`)) throw new Error('Destinatário inesperado.');
  if (!same(p.destination_caller, ZERO32)) throw new Error('Parâmetro inesperado.');
  if (!same(p.hook_data, FORWARD_HOOK_DATA)) throw new Error('Hook inesperado.');
  if (fee < 0n || fee > MAX_FEE_CAP_MINOR) throw new Error('Taxa fora do esperado.');
  if (burn !== want + fee) throw new Error('Valor da cotação não bate com o pedido.');

  return {
    approve: {
      to: getAddress(p.usdc),
      data: encodeFunctionData({ abi, functionName: 'approve', args: [getAddress(ARC_TOKEN_MESSENGER), burn] }),
    },
    burn: {
      to: getAddress(ARC_TOKEN_MESSENGER),
      data: encodeFunctionData({
        abi,
        functionName: 'depositForBurnWithHook',
        args: [
          burn,
          p.destination_domain,
          p.mint_recipient as `0x${string}`,
          getAddress(p.usdc),
          ZERO32,
          fee,
          p.min_finality_threshold,
          FORWARD_HOOK_DATA,
        ],
      }),
    },
  };
}
