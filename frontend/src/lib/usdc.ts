/**
 * 💱 Token ERC-20 — Interazioni on-chain su Polygon
 *
 * Gestisce il trasferimento USDC e XAUt0 (Tether Gold) verso il wallet del fondo URANO.
 * Nessuna dipendenza esterna — encoding ABI manuale.
 */

const FUND_WALLET =
  process.env.NEXT_PUBLIC_FUND_WALLET ||
  "0x4f53c4277E2e738CDb71375253b3fE30BBca95ce";

// ── TOKEN ACCETTATI ──────────────────────────────────────────────────

const TOKENS = {
  USDC: {
    // USDC NATIVO Polygon (0x3c49…) — token realmente usato dalla Cassa URANUS 0x4f53…
    // (verificato on-chain 02/07/2026). Override via env NEXT_PUBLIC_USDC_CONTRACT (tenere il nativo).
    address:
      process.env.NEXT_PUBLIC_USDC_CONTRACT ||
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
    symbol: "USDC",
    minDonation: 20,
  },
  XAUT0: {
    address:
      process.env.NEXT_PUBLIC_XAUT0_CONTRACT ||
      "0xF1815bd50389c46847f0Bda824eC8da914045D14",
    decimals: 6,
    symbol: "XAUt0",
    minDonation: 0.005, // 20 USD in oro = 0,005 oz a 4.000 $/oz
  },
} as const;

type TokenKey = keyof typeof TOKENS;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

// Alias retrocompatibili
const USDC_CONTRACT = TOKENS.USDC.address;
const USDC_DECIMALS = TOKENS.USDC.decimals;

/**
 * Codifica una chiamata ERC-20 transfer(address,uint256).
 * Puro encoding ABI — nessuna dipendenza.
 */
function encodeTransfer(to: string, amount: number, decimals: number): string {
  const selector = "a9059cbb";
  const paddedTo = to.replace("0x", "").toLowerCase().padStart(64, "0");
  const amountSmallestUnit = BigInt(
    Math.round(amount * 10 ** decimals)
  );
  const paddedAmount = amountSmallestUnit.toString(16).padStart(64, "0");
  return "0x" + selector + paddedTo + paddedAmount;
}

/**
 * Invia USDC su Polygon via MetaMask.
 * Retrocompatibile: chiama sendToken con token USDC.
 */
export async function sendUsdc(
  ethereum: EthereumProvider,
  from: string,
  amountUsdc: number
): Promise<string> {
  return sendToken(ethereum, from, amountUsdc, "USDC");
}

/**
 * Invia XAUt0 (Tether Gold) su Polygon via MetaMask.
 */
export async function sendXaut(
  ethereum: EthereumProvider,
  from: string,
  amountXaut: number
): Promise<string> {
  return sendToken(ethereum, from, amountXaut, "XAUT0");
}

/**
 * Invia un token ERC-20 accettato su Polygon via MetaMask.
 *
 * @param ethereum  Provider MetaMask (window.ethereum)
 * @param from      Wallet mittente
 * @param amount    Importo nel token scelto
 * @param token     "USDC" | "XAUT0"
 * @returns txHash della transazione
 */
export async function sendToken(
  ethereum: EthereumProvider,
  from: string,
  amount: number,
  token: TokenKey = "USDC"
): Promise<string> {
  if (amount <= 0) throw new Error("Importo deve essere > 0");

  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Token non supportato: ${token}`);

  const data = encodeTransfer(FUND_WALLET, amount, tokenInfo.decimals);

  const txHash = (await ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: tokenInfo.address,
        data,
        value: "0x0",
      },
    ],
  })) as string;

  return txHash;
}

export { TOKENS, USDC_CONTRACT, FUND_WALLET, USDC_DECIMALS };
export type { TokenKey };
