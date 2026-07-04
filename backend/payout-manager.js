'use strict';
/**
 * 💸 PAYOUT MANAGER
 *
 * Invia USDC on-chain dalla tesoreria a un wallet destinatario.
 * Usato per pagamenti automatici (es. uscita FONDO da Venere/L3).
 *
 * Richiede la variabile d'ambiente TREASURY_PRIVATE_KEY (impostata su Coolify).
 * In assenza della chiave, logga un warning ma non blocca il flusso.
 */

// USDC NATIVO Polygon (0x3c49…) — token realmente detenuto/usato dalla Cassa URANUS 0x4f53…
// (verificato on-chain 02/07/2026). Override via env USDC_CONTRACT_ADDRESS (deve restare il nativo).
const USDC_CONTRACT  = process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Polygon USDC nativo
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

const alerts = require('./alert-manager');

// Denylist pagamenti (unica fonte di verita, riusata anche da /api/admin/invia-payout).
const PAYOUT_DENYLIST = new Set([
  '0xa54fff2ada3aa8a14e62afca8a31010f8b28ee98', // wallet giro-di-conti errato: NON usare mai
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002', // vecchio placeholder Cassa
  '0x1111111111111111111111111111111111111111',
]);

/** true se il destinatario e un indirizzo valido e NON in denylist. */
function isDestinatarioConsentito(destinatario) {
  const dest = String(destinatario || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(dest)) return false;
  if (PAYOUT_DENYLIST.has(dest)) return false;
  return true;
}

// REDIRECT DEBITORE -> FORTUNATO (mod 8): i doni destinati al wallet del debitore vengono
// dirottati a Fortunato finche il debito non e coperto (auto-stop a soglia DEBTOR_DEBT_USDC).
const FORTUNATO_WALLET  = '0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4'; // pos 0 / FONDO (hardcoded, legge committente)
const DEBTOR_WALLET     = (process.env.DEBTOR_WALLET || '0x49cEB4EfD91cfFeA8de4e81C2C894C2FF182CEC5').toLowerCase();
const DEBTOR_DEBT_USDC  = Number(process.env.DEBTOR_DEBT_USDC || 11440.50);

/** Totale USDC finora dirottato dal debitore (persistito in state_persistence). */
async function _debitoreRedirectTotale() {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(`SELECT (value->>'total')::numeric AS total FROM state_persistence WHERE key = 'debtor_redirect'`);
  return Number(row?.total) || 0;
}

/** Incrementa (atomico) il totale dirottato e ritorna il nuovo totale. */
async function _addDebitoreRedirect(importo) {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(
    `INSERT INTO state_persistence (key, value, updated_at)
     VALUES ('debtor_redirect', jsonb_build_object('total', $1::numeric), NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = jsonb_build_object('total', (COALESCE((state_persistence.value->>'total')::numeric, 0) + $1::numeric)),
           updated_at = NOW()
     RETURNING (value->>'total')::numeric AS total`,
    [importo]
  );
  return Number(row?.total) || 0;
}

/**
 * Invia importoUsdc USDC dalla tesoreria al wallet destinatario.
 *
 * @param {string} destinatario  - Wallet ricevente (es. FONDO wallet)
 * @param {number} importoUsdc   - Importo in USDC (es. 500)
 * @param {string} motivo        - Stringa di log (es. "USCITA_L3 Turno 1")
 * @returns {{ success: boolean, txHash?: string, error?: string }}
 */
async function inviaPagamento(destinatario, importoUsdc, motivo = '') {
  const privKey = process.env.TREASURY_PRIVATE_KEY
  const rpcUrl  = process.env.POLYGON_RPC_URL;

  if (!privKey) {
    console.warn('⚠️  [PAYOUT] TREASURY_PRIVATE_KEY non impostata — payout saltato.');
    return { success: false, error: 'TREASURY_PRIVATE_KEY mancante' };
  }
  if (!rpcUrl) {
    console.warn('⚠️  [PAYOUT] POLYGON_RPC_URL non impostata — payout saltato.');
    return { success: false, error: 'POLYGON_RPC_URL mancante' };
  }
  if (!destinatario || importoUsdc <= 0) {
    return { success: false, error: 'Parametri non validi' };
  }

  // 🔒 GUARDRAIL SICUREZZA (anti-errore / anti-address-poisoning):
  //   - il destinatario deve essere un indirizzo Ethereum ben formato;
  //   - mai pagare wallet in denylist (giro-conti errato, placeholder di sistema).
  const dest = String(destinatario).toLowerCase();
  if (!isDestinatarioConsentito(dest)) {
    console.error(`🚨 [PAYOUT] Destinatario non consentito (formato/denylist): ${destinatario} — ${motivo}`);
    return { success: false, error: `Destinatario non consentito: ${destinatario}` };
  }

  // 🔁 REDIRECT DEBITORE -> FORTUNATO (mod 8): finche il debito non e coperto, i doni del
  // debitore vengono dirottati a Fortunato; poi (soglia raggiunta) il debitore torna a ricevere.
  let effettivoDest    = dest;
  let redirectDebitore = false;
  if (DEBTOR_WALLET && dest === DEBTOR_WALLET) {
    let recuperato = 0;
    try { recuperato = await _debitoreRedirectTotale(); } catch (_) { recuperato = 0; }
    if (recuperato < DEBTOR_DEBT_USDC) {
      effettivoDest    = FORTUNATO_WALLET;
      redirectDebitore = true;
    } else {
      console.log(`✅ [PAYOUT] Debito coperto (${recuperato}/${DEBTOR_DEBT_USDC} USDC) -> ${dest} riceve normalmente`);
    }
  }

  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer   = new ethers.Wallet(privKey, provider);
    const usdc     = new ethers.Contract(USDC_CONTRACT, USDC_ABI, signer);
    
    // Verifica saldo tesoreria
    const balance = await usdc.balanceOf(signer.address);
    const amount  = ethers.utils.parseUnits(importoUsdc.toString(), 6);

    if (balance.lt(amount)) {
      const bal = ethers.utils.formatUnits(balance, 6);
      console.error(`❌ [PAYOUT] Saldo insufficiente: ${bal} USDC (richiesti ${importoUsdc})`);
      return { success: false, error: `Saldo insufficiente: ${bal} USDC` };
    }

    console.log(`💸 [PAYOUT] Invio ${importoUsdc} USDC → ${effettivoDest}${redirectDebitore ? ' (DIROTTATO da debitore)' : ''} (${motivo})`);

    const tx = await usdc.transfer(effettivoDest, amount, {
      gasLimit: 100000,
      maxPriorityFeePerGas: ethers.utils.parseUnits('100', 'gwei'),
      maxFeePerGas:         ethers.utils.parseUnits('300', 'gwei'),
    });

    console.log(`   ⏳ TX inviata: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   ✅ [PAYOUT] Confermato: ${receipt.transactionHash} (block ${receipt.blockNumber})`);

    // 🔁 Aggiorna il totale recuperato dal debitore + avvisa Isa (best-effort)
    if (redirectDebitore) {
      let nuovoTot = 0;
      try { nuovoTot = await _addDebitoreRedirect(Number(importoUsdc)); } catch (_) {}
      console.log(`🔁 [PAYOUT] Dono del debitore ${dest} dirottato a Fortunato - recuperato ${nuovoTot}/${DEBTOR_DEBT_USDC} USDC`);
      try {
        alerts.sendTelegramAlert(
          `🔁 <b>DONO DIROTTATO (debitore)</b>\n` +
          `Importo: <b>${Number(importoUsdc).toLocaleString()} USDC</b>\n` +
          `Da <code>${dest.slice(0, 8)}...${dest.slice(-4)}</code> → <b>Fortunato</b>\n` +
          `Debito recuperato: <b>${Number(nuovoTot).toFixed(2)} / ${DEBTOR_DEBT_USDC.toFixed(2)} USDC</b>\n` +
          `🔗 https://polygonscan.com/tx/${receipt.transactionHash}`
        ).catch(() => {});
      } catch (_) {}
    }

    // 💸 Alert uscita cassa (best-effort)
    try {
      alerts.alertUscitaCassa({
        destinatario: effettivoDest,
        importoUsdc,
        motivo: redirectDebitore ? `${motivo} [dirottato da debitore]` : motivo,
        txHash: receipt.transactionHash,
      });
    } catch (_) {}

    return { success: true, txHash: receipt.transactionHash, redirected: redirectDebitore, destinatarioEffettivo: effettivoDest };

  } catch (err) {
    console.error(`❌ [PAYOUT] Errore: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Legge il saldo USDC del wallet che ESEGUE i payout (tesoreria/cassa URANUS,
 * derivato da TREASURY_PRIVATE_KEY — lo stesso su cui inviaPagamento verifica il
 * balanceOf prima del transfer). È la fonte autorevole per stabilire se un dono
 * è "pronto" da distribuire (fondi già presenti in cassa).
 * @returns {Promise<number|null>} saldo in USDC, oppure null se non leggibile.
 */
async function getSaldoTreasury() {
  const privKey = process.env.TREASURY_PRIVATE_KEY;
  const rpcUrl  = process.env.POLYGON_RPC_URL;
  if (!privKey || !rpcUrl) return null;
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer   = new ethers.Wallet(privKey, provider);
    const usdc     = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);
    const balance  = await usdc.balanceOf(signer.address);
    return Number(ethers.utils.formatUnits(balance, 6));
  } catch (err) {
    console.warn(`⚠️  [PAYOUT] getSaldoTreasury fallito: ${err.message}`);
    return null;
  }
}

module.exports = { inviaPagamento, getSaldoTreasury, isDestinatarioConsentito };
