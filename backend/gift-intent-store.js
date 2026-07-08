/**
 * gift-intent-store.js
 *
 * Store DUREVOLE (PostgreSQL) per gli intenti di Carta Regalo.
 *
 * Obiettivo: rendere il regalo INDISTRUTTIBILE. Il legame
 *   (donatore → beneficiario, importo) viene persistito su PostgreSQL
 * prima/durante il pagamento, così sopravvive a:
 *   - chiusura del browser dopo il transfer USDC
 *   - riavvio del backend (lo store in-memory pending-donation-store no)
 *   - mancata chiamata a /api/donation/verify
 *
 * Il gift-reconciler legge gli intenti PENDING con tx_hash reale e li completa
 * in modo idempotente (processDonation deduplica per tx_hash + mutex per-tx).
 */

const pg = require('./pg-connection-manager');

function normalizeWallet(w) {
  return String(w || '').trim().toLowerCase();
}

// Normalizza il tx_hash: i placeholder ('pending', vuoto) diventano null,
// così non sovrascrivono un tx_hash reale già salvato (vedi COALESCE in upsert).
function normalizeTxHash(txHash) {
  const t = String(txHash || '').trim().toLowerCase();
  if (!t || t === 'pending') return null;
  return t;
}

/**
 * Crea o aggiorna un intento di carta regalo (idempotente su gift_id).
 * - Non sovrascrive un tx_hash reale con un placeholder (COALESCE).
 * - Aggiorna solo finché lo stato è ancora PENDING.
 */
async function upsertIntent({ giftId, donor, beneficiaryWallet, amountUSDC, giftMessage, txHash }) {
  const id = String(giftId || '').trim();
  const donorNorm = normalizeWallet(donor);
  const benefNorm = normalizeWallet(beneficiaryWallet);
  const amount = Number(amountUSDC);
  const tx = normalizeTxHash(txHash);

  if (!id || !donorNorm || !benefNorm || !Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Parametri intento regalo non validi' };
  }

  try {
    await pg.query(
      `
      INSERT INTO gift_intents (gift_id, donor_wallet, beneficiary_wallet, amount_usdc, gift_message, tx_hash, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
      ON CONFLICT (gift_id) DO UPDATE SET
        beneficiary_wallet = EXCLUDED.beneficiary_wallet,
        amount_usdc        = EXCLUDED.amount_usdc,
        gift_message       = COALESCE(EXCLUDED.gift_message, gift_intents.gift_message),
        tx_hash            = COALESCE(EXCLUDED.tx_hash, gift_intents.tx_hash),
        updated_at         = NOW()
      WHERE gift_intents.status = 'PENDING'
      `,
      [id, donorNorm, benefNorm, amount, giftMessage || null, tx]
    );
    return { success: true };
  } catch (error) {
    console.error('[gift-intent-store] upsertIntent error:', error.message || error);
    return { success: false, error: error.message };
  }
}

/**
 * Lega un tx_hash reale a un intento ancora privo di tx_hash (solo se PENDING).
 * Ritorna true se l'aggiornamento ha effettivamente legato la transazione
 * (utile per evitare doppi binding concorrenti).
 */
async function bindTxHash(giftId, txHash) {
  const id = String(giftId || '').trim();
  const tx = normalizeTxHash(txHash);
  if (!id || !tx) return false;

  try {
    const res = await pg.query(
      `
      UPDATE gift_intents
      SET tx_hash = $2, updated_at = NOW()
      WHERE gift_id = $1 AND status = 'PENDING' AND tx_hash IS NULL
      `,
      [id, tx]
    );
    return (res.rowCount || 0) > 0;
  } catch (error) {
    console.error('[gift-intent-store] bindTxHash error:', error.message || error);
    return false;
  }
}

async function markCompleted(giftId) {
  const id = String(giftId || '').trim();
  if (!id) return;
  try {
    await pg.query(
      `UPDATE gift_intents SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE gift_id = $1`,
      [id]
    );
  } catch (error) {
    console.error('[gift-intent-store] markCompleted error:', error.message || error);
  }
}

async function incrementAttempt(giftId, errMessage) {
  const id = String(giftId || '').trim();
  if (!id) return;
  try {
    await pg.query(
      `UPDATE gift_intents SET attempts = attempts + 1, last_error = $2, updated_at = NOW() WHERE gift_id = $1`,
      [id, String(errMessage || '').slice(0, 500)]
    );
  } catch (error) {
    console.error('[gift-intent-store] incrementAttempt error:', error.message || error);
  }
}

/**
 * Intenti PENDING pronti per la riconciliazione:
 * - hanno un tx_hash reale (il pagamento è avvenuto)
 * - sono più vecchi di graceSeconds (diamo tempo al flusso frontend /verify)
 * - non hanno superato maxAttempts
 */
async function getReconcilable({ graceSeconds = 45, maxAttempts = 20, limit = 50 } = {}) {
  try {
    const rows = await pg.queryMany(
      `
      SELECT gift_id, donor_wallet, beneficiary_wallet, amount_usdc, gift_message, tx_hash, attempts
      FROM gift_intents
      WHERE status = 'PENDING'
        AND tx_hash IS NOT NULL
        AND attempts < $1
        AND created_at < NOW() - (INTERVAL '1 second' * $2::int)
      ORDER BY created_at ASC
      LIMIT $3
      `,
      [maxAttempts, graceSeconds, limit]
    );
    return rows || [];
  } catch (error) {
    console.error('[gift-intent-store] getReconcilable error:', error.message || error);
    return [];
  }
}

/**
 * Cerca l'intento PENDING più vecchio, ancora privo di tx_hash, che combacia
 * esattamente per (donatore, importo). Usato dal listener/backfill USDC per
 * legare una transazione on-chain a un regalo il cui frontend è morto prima di
 * comunicare il tx_hash reale.
 */
async function findPendingByDonorAmount(donor, amountUSDC) {
  const donorNorm = normalizeWallet(donor);
  const amount = Number(amountUSDC);
  if (!donorNorm || !Number.isFinite(amount) || amount <= 0) return null;

  try {
    const row = await pg.queryOne(
      `
      SELECT gift_id, donor_wallet, beneficiary_wallet, amount_usdc, gift_message
      FROM gift_intents
      WHERE status = 'PENDING'
        AND tx_hash IS NULL
        AND LOWER(donor_wallet) = $1
        AND amount_usdc = $2::numeric
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [donorNorm, amount]
    );
    return row || null;
  } catch (error) {
    console.error('[gift-intent-store] findPendingByDonorAmount error:', error.message || error);
    return null;
  }
}

module.exports = {
  upsertIntent,
  bindTxHash,
  markCompleted,
  incrementAttempt,
  getReconcilable,
  findPendingByDonorAmount,
  normalizeWallet,
  normalizeTxHash
};
