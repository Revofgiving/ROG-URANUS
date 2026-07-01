/**
 * 🪩 URANUS — Gold Converter
 *
 * Converte importi XAUt0 (oro) in equivalente USDC e viceversa.
 * Usato OVUNQUE nel sistema per mostrare alle persone
 * quanto vale il loro oro in USDC.
 *
 * Esempio output:
 *   "0.005 XAUt0 = 20.00 USDC"
 *   "0.120 XAUt0 = 480.00 USDC"
 *
 * Il prezzo dell'oro è configurabile via GOLD_PRICE_USD nel .env
 * (default: $4.000 per oncia troy = 1 XAUt0 — cambio più basso, allineato a verifier e frontend).
 */
'use strict';

// Prezzo oro in USD per 1 XAUt0 (= 1 oncia troy)
function getGoldPrice() {
  return Number(process.env.GOLD_PRICE_USD || 4000);
}

/**
 * Converte XAUt0 → USDC equivalente
 * @param {number} xautAmount - Importo in XAUt0
 * @returns {number} Equivalente in USDC
 */
function xautToUsdc(xautAmount) {
  return xautAmount * getGoldPrice();
}

/**
 * Converte USDC → XAUt0 equivalente
 * @param {number} usdcAmount - Importo in USDC
 * @returns {number} Equivalente in XAUt0
 */
function usdcToXaut(usdcAmount) {
  return usdcAmount / getGoldPrice();
}

/**
 * Formatta un importo con il suo equivalente USDC.
 * Se il token è già USDC, ritorna solo l'importo.
 * Se è XAUt0, aggiunge " = XX.XX USDC"
 *
 * @param {number} amount - Importo
 * @param {string} token - 'USDC' o 'XAUt0' o 'XAUT0'
 * @returns {string} Stringa formattata
 *
 * Esempi:
 *   formatWithUsdc(20, 'USDC')      → "20.00 USDC"
 *   formatWithUsdc(0.004, 'XAUt0')  → "0.004000 XAUt0 = 20.00 USDC"
 *   formatWithUsdc(0.096, 'XAUt0')  → "0.096000 XAUt0 = 480.00 USDC"
 */
function formatWithUsdc(amount, token) {
  if (!token || token === 'USDC') {
    return `${amount.toFixed(2)} USDC`;
  }
  // XAUt0 → mostra equivalente USDC
  const usdcEquiv = xautToUsdc(amount);
  return `${amount.toFixed(6)} XAUt0 = ${usdcEquiv.toFixed(2)} USDC`;
}

/**
 * Crea un oggetto con importo + equivalente USDC per le API responses.
 * Il frontend può usare questi dati per mostrare entrambi i valori.
 *
 * @param {number} amount - Importo
 * @param {string} token - 'USDC' o 'XAUt0'
 * @returns {Object} { amount, token, usdcEquivalent, display }
 */
function toDisplayObject(amount, token) {
  if (!token || token === 'USDC') {
    return {
      amount,
      token: 'USDC',
      usdcEquivalent: amount,
      display: `${amount.toFixed(2)} USDC`,
    };
  }
  const usdcEquiv = xautToUsdc(amount);
  return {
    amount,
    token: 'XAUt0',
    usdcEquivalent: parseFloat(usdcEquiv.toFixed(2)),
    goldPriceUsed: getGoldPrice(),
    display: `${amount.toFixed(6)} XAUt0 = ${usdcEquiv.toFixed(2)} USDC`,
  };
}

module.exports = {
  xautToUsdc,
  usdcToXaut,
  formatWithUsdc,
  toDisplayObject,
  getGoldPrice,
};
