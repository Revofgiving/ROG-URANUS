/**
 * 💱 USDC ERC-20 — Interazioni on-chain su Polygon
 *
 * Gestisce il trasferimento USDC (ERC-20) verso il wallet del fondo URANO.
 * Nessuna dipendenza esterna — encoding ABI manuale.
 */

const USDC_DECIMALS = 6;
const USDC_CONTRACT =
  process.env.NEXT_PUBLIC_USDC_CONTRACT ||
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const FUND_WALLET =
  process.env.NEXT_PUBLIC_FUND_WALLET ||
  "0x4f53c4277E2e738CDb71375253b3fE30BBca95ce";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Codifica una chiamata ERC-20 transfer(address,uint256).
 * Puro encoding ABI — nessuna dipendenza.
 */
function encodeTransfer(to: string, amountUsdc: number): string {
  // transfer(address,uint256) → selector 0xa9059cbb
  const selector = "a9059cbb";
  const paddedTo = to.replace("0x", "").toLowerCase().padStart(64, "0");
  const amountSmallestUnit = BigInt(
    Math.round(amountUsdc * 10 ** USDC_DECIMALS)
  );
  const paddedAmount = amountSmallestUnit.toString(16).padStart(64, "0");
  return "0x" + selector + paddedTo + paddedAmount;
}

/**
 * Invia USDC su Polygon via MetaMask.
 * Chiama il contratto USDC con transfer(FUND_WALLET, amount).
 *
 * @param ethereum  Provider MetaMask (window.ethereum)
 * @param from      Wallet mittente
 * @param amountUsdc  Importo in USDC (es. 20, 40, 60...)
 * @returns txHash della transazione
 */
export async function sendUsdc(
  ethereum: EthereumProvider,
  from: string,
  amountUsdc: number
): Promise<string> {
  if (amountUsdc <= 0) throw new Error("Importo deve essere > 0");

  const data = encodeTransfer(FUND_WALLET, amountUsdc);

  const txHash = (await ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: USDC_CONTRACT,
        data,
        value: "0x0", // Nessun token nativo, solo ERC-20
      },
    ],
  })) as string;

  return txHash;
}

export { USDC_CONTRACT, FUND_WALLET, USDC_DECIMALS };
