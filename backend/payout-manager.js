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

// USDC.e bridged — DEVE coincidere col token del contratto ROG distribuito (constant immutabile).
// Override via env USDC_CONTRACT_ADDRESS.
const USDC_CONTRACT  = process.env.USDC_CONTRACT_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Polygon USDC.e
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

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

    console.log(`💸 [PAYOUT] Invio ${importoUsdc} USDC → ${destinatario} (${motivo})`);

    const tx = await usdc.transfer(destinatario, amount, {
      gasLimit: 100000,
      maxPriorityFeePerGas: ethers.utils.parseUnits('100', 'gwei'),
      maxFeePerGas:         ethers.utils.parseUnits('300', 'gwei'),
    });

    console.log(`   ⏳ TX inviata: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   ✅ [PAYOUT] Confermato: ${receipt.transactionHash} (block ${receipt.blockNumber})`);

    return { success: true, txHash: receipt.transactionHash };

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

module.exports = { inviaPagamento, getSaldoTreasury };
