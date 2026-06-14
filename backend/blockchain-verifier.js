/**
 * ⛓️ URANO v2 — Blockchain Verifier
 *
 * Verifica le transazioni USDC on-chain su Polygon prima di
 * posizionare il donatore in tavola.
 *
 * Controlli eseguiti:
 *  1. La transazione esiste su Polygon
 *  2. La transazione è confermata (status = 1)
 *  3. Il mittente corrisponde al wallet dichiarato
 *  4. C'è un evento Transfer USDC verso URANO_FUND_WALLET
 *  5. L'importo è >= 20 USDC (1 coppia HUMAN + CASSA_ROG)
 *  6. La tx non è già stata usata (anti-replay)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { ethers } = require('ethers');
const pg = require('./pg-connection-manager');

// ABI minima ERC-20: solo l'evento Transfer
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// ── TOKEN ACCETTATI ──────────────────────────────────────────────────
// URANUS accetta donazioni in USDC e XAUt0 (Tether Gold) su Polygon
const ACCEPTED_TOKENS = {
  USDC: {
    address: (process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359').toLowerCase(),
    decimals: 6,
    symbol: 'USDC',
    minDonation: 20,  // 20 USDC minimo
  },
  XAUT0: {
    address: (process.env.XAUT0_CONTRACT_ADDRESS || '0xF1815bd50389c46847f0Bda824eC8da914045D14').toLowerCase(),
    decimals: 6,
    symbol: 'XAUt0',
    minDonation: 0.004,  // ~20 USD in oro (~0.004 oz a ~$5.000/oz)
  },
};

// Mappa indirizzo → token per lookup veloce
const TOKEN_BY_ADDRESS = {};
for (const [key, token] of Object.entries(ACCEPTED_TOKENS)) {
  TOKEN_BY_ADDRESS[token.address] = { ...token, key };
}

// ========================================
// PROVIDER POLYGON
// ========================================

let provider = null;

function getProvider() {
  if (!provider) {
    const rpcUrl = process.env.POLYGON_RPC_URL;
    if (!rpcUrl) throw new Error('POLYGON_RPC_URL non configurata');
    provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

// ========================================
// VERIFICA TX
// ========================================

/**
 * Verifica che una transazione USDC su Polygon sia valida per URANO.
 * Restituisce l'importo effettivo trasferito, che sarà usato per auto-calcolare
 * il numero di coppie (importoEffettivo ÷ 20 = coppie HUMAN + CASSA_ROG).
 *
 * @param {Object} params
 * @param {string} params.txHash          - Hash della transazione da verificare
 * @param {string} params.walletMittente  - Wallet che dichiara di aver pagato
 * @param {number} [params.importoMinimo] - Importo minimo accettabile in USDC (default: 20)
 * @returns {Object} { valida: true, txHash, wallet, importoEffettivo, numeroPosizioni }
 * @throws {Error} se la transazione non è valida
 */
async function verificaDonazione({ txHash, walletMittente, importoMinimo = 20 }) {
  const destinatario = process.env.URANO_FUND_WALLET;

  if (!destinatario) throw new Error('URANO_FUND_WALLET non configurato');

  // 0. Validazione formato input (prima di qualsiasi chiamata esterna)
  const TXHASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
  const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

  if (!txHash || typeof txHash !== 'string' || !TXHASH_REGEX.test(txHash)) {
    throw new Error('txHash non valido (formato: 0x + 64 hex chars)');
  }
  if (!walletMittente || typeof walletMittente !== 'string' || !WALLET_REGEX.test(walletMittente)) {
    throw new Error('walletMittente non valido (formato: 0x + 40 hex chars)');
  }
  if (!WALLET_REGEX.test(destinatario)) {
    throw new Error('URANO_FUND_WALLET non è un indirizzo Ethereum valido');
  }
  // Validazione indirizzi token accettati
  for (const [key, token] of Object.entries(ACCEPTED_TOKENS)) {
    if (!WALLET_REGEX.test(token.address)) {
      throw new Error(`${key} contract address non è un indirizzo Ethereum valido: ${token.address}`);
    }
  }

  // 1. Anti-replay: verifica che la tx non sia già stata usata
  const txGiaUsata = await pg.queryOne(
    `SELECT id FROM donazioni WHERE tx_hash = $1`,
    [txHash.toLowerCase()]
  );
  if (txGiaUsata) {
    throw new Error(`Transazione già registrata nel sistema`);
  }

  // 2. Recupera la ricevuta della transazione da Polygon
  const prov = getProvider();
  let receipt;
  try {
    receipt = await prov.getTransactionReceipt(txHash);
  } catch (e) {
    // Errore transitorio di rete/RPC: la coda puo ritentare.
    const err = new Error(`Impossibile contattare Polygon: ${e.message}`);
    err.code = 'RPC_ERROR';
    err.retryable = true;
    throw err;
  }

  if (!receipt) {
    // Tx non ancora minata (pending) o non ancora propagata: ritentabile dalla coda.
    const err = new Error(`Transazione ${txHash} non trovata su Polygon (potrebbe essere in pending)`);
    err.code = 'TX_PENDING';
    err.retryable = true;
    throw err;
  }

  // 3. Verifica conferma
  if (receipt.status !== 1) {
    throw new Error(`Transazione ${txHash} fallita on-chain (status=${receipt.status})`);
  }

  // 4. Verifica mittente
  if (receipt.from.toLowerCase() !== walletMittente.toLowerCase()) {
    throw new Error(
      `Mittente non corrisponde: atteso ${walletMittente}, trovato ${receipt.from}`
    );
  }

  // 5. Cerca evento Transfer di QUALSIASI token accettato verso il wallet del fondo
  const iface = new ethers.utils.Interface(ERC20_ABI);

  let importoEffettivoWei = null;
  let tokenTrovato = null;

  for (const log of receipt.logs) {
    // Cerca in tutti i token accettati
    const tokenInfo = TOKEN_BY_ADDRESS[log.address.toLowerCase()];
    if (!tokenInfo) continue;

    try {
      const parsed = iface.parseLog(log);
      if (parsed.name !== 'Transfer') continue;

      const from  = parsed.args.from.toLowerCase();
      const to    = parsed.args.to.toLowerCase();
      const value = parsed.args.value; // BigNumber

      if (
        from === walletMittente.toLowerCase() &&
        to   === destinatario.toLowerCase()
      ) {
        importoEffettivoWei = value;
        tokenTrovato = tokenInfo;
        break;
      }
    } catch (_) {
      continue; // log non parsabile, ignora
    }
  }

  if (!importoEffettivoWei || !tokenTrovato) {
    const tokenNames = Object.values(ACCEPTED_TOKENS).map(t => t.symbol).join(', ');
    throw new Error(
      `Nessun trasferimento ${tokenNames} da ${walletMittente} verso ${destinatario} trovato in ${txHash}`
    );
  }

  // 6. Verifica importo >= minimo
  const minimo = tokenTrovato.minDonation;
  const importoMinimoWei = ethers.utils.parseUnits(minimo.toString(), tokenTrovato.decimals);
  if (importoEffettivoWei.lt(importoMinimoWei)) {
    const effettivo = ethers.utils.formatUnits(importoEffettivoWei, tokenTrovato.decimals);
    throw new Error(
      `Importo insufficiente: minimo ${minimo} ${tokenTrovato.symbol}, trovato ${effettivo} ${tokenTrovato.symbol}`
    );
  }

  const importoEffettivo = parseFloat(
    ethers.utils.formatUnits(importoEffettivoWei, tokenTrovato.decimals)
  );

  // Auto-calcolo coppie (per USDC: importo/20, per XAUt0: in base al valore in USD)
  let numeroPosizioni;
  if (tokenTrovato.key === 'XAUT0') {
    // XAUt0: 1 token ≈ 1 oncia troy ≈ ~$4.675 USD (aggiornare GOLD_PRICE_USD su Coolify)
    // Usa Math.round + tolleranza di 0.5 USDC per evitare errori di arrotondamento
    // (es. 0.008556 XAUt0 × 4675 = 39.998 ≈ 40 USDC → deve dare 2 posizioni)
    const GOLD_PRICE_USD = Number(process.env.GOLD_PRICE_USD || 4675);
    const usdEquivalent = importoEffettivo * GOLD_PRICE_USD;
    // Tolleranza di 1 USDC per gestire arrotondamenti floating-point
    numeroPosizioni = Math.max(1, Math.floor((usdEquivalent + 1.0) / 20));
    console.log(`   ✅ TX verificata: ${txHash}`);
    console.log(`   🪩 Importo: ${importoEffettivo} ${tokenTrovato.symbol} (≈$${usdEquivalent.toFixed(2)} USD, prezzo oro $${GOLD_PRICE_USD}) → ${numeroPosizioni} coppie`);
  } else {
    numeroPosizioni = Math.max(1, Math.floor(importoEffettivo / 20));
    console.log(`   ✅ TX verificata: ${txHash}`);
    console.log(`   💵 Importo: ${importoEffettivo} ${tokenTrovato.symbol} → ${numeroPosizioni} coppia${numeroPosizioni > 1 ? 'e' : ''} (HUMAN + CASSA)`);
  }

  return {
    valida: true,
    txHash,
    wallet: walletMittente,
    importoEffettivo,
    numeroPosizioni,
    token: tokenTrovato.symbol,
    tokenKey: tokenTrovato.key,
  };
}

// ========================================
// BYPASS VERIFICA (solo sviluppo locale)
// ========================================

/**
 * In sviluppo locale (NODE_ENV != 'production') permette di saltare
 * la verifica on-chain passando txHash = 'DEV_SKIP'.
 */
function isDevSkip(txHash) {
  if (txHash === 'DEV_SKIP') {
    if (process.env.NODE_ENV === 'production') {
      console.error('🚨 [SECURITY] TENTATIVO DEV_SKIP IN PRODUZIONE — BLOCCATO');
      try { require('./alert-manager').sendAlert('CRITICAL', 'DEV_SKIP_BLOCKED', 'Tentativo di usare DEV_SKIP in produzione!'); } catch(_) {}
      return false; // BLOCCATO in produzione
    }
    return true; // permesso solo in sviluppo
  }
  return false;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  verificaDonazione,
  isDevSkip
};
