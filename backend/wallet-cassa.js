'use strict';
/**
 * 🏛️ URANUS — Riferimento UNICO alla cassa Uranus (= tesoreria on-chain 0x4f53…).
 *
 * Legge committente (02/07/2026): un solo riferimento, per non avere dubbi di nessun genere.
 *  - Canonico:  URANUS_CASSA_WALLET
 *  - Fallback retro-compatibile ai vecchi nomi (URANO_FUND_WALLET, CASSA_WALLET) così i deploy
 *    esistenti su Coolify NON si rompono anche se la nuova variabile non è ancora impostata.
 *
 * ⚠️ NON confondere con la cassa ROG (CASSA_ROG_WALLET 0xD5bCC7…), che è un wallet DIVERSO
 *    di un altro movimento e resta gestito separatamente.
 */
const URANUS_CASSA_WALLET = (
  process.env.URANUS_CASSA_WALLET ||
  process.env.URANO_FUND_WALLET ||
  process.env.CASSA_WALLET ||
  '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce'
).toLowerCase();

module.exports = { URANUS_CASSA_WALLET };
