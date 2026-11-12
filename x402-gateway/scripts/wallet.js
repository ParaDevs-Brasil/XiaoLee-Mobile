// Carteira compradora de teste, p/ cada pessoa do time.
//   node scripts/wallet.js new            -> gera chave em ~/.config/xiaolee/buyer-<nome>.env (chmod 600), imprime SÓ o endereço
//   node scripts/wallet.js deposit <usdc> -> deposita no Gateway (1x; depois disso as compras são sem gás)
// Rede: X402_CHAIN (padrão arcTestnet; mainnet = arc). Chave lida de BUYER_PRIVATE_KEY.
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [cmd, arg] = process.argv.slice(2);
const chain = process.env.X402_CHAIN ?? "arcTestnet";

if (cmd === "new") {
  const dir = join(homedir(), ".config", "xiaolee");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `buyer-${process.env.USER ?? "dev"}-${chain}.env`);
  const key = generatePrivateKey();
  writeFileSync(file, `BUYER_PRIVATE_KEY=${key}\n`, { mode: 0o600, flag: "wx" });
  console.log(`endereço: ${privateKeyToAccount(key).address}\nchave salva em ${file} (NUNCA compartilhe/commite)`);
} else if (cmd === "deposit") {
  const client = new GatewayClient({ chain, privateKey: process.env.BUYER_PRIVATE_KEY, rpcUrl: process.env.ARC_RPC });
  const r = await client.deposit(arg);
  console.log("depositado:", JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
} else {
  console.log("uso: node scripts/wallet.js new | deposit <usdc>");
  process.exit(1);
}
