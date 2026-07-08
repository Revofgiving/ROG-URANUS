/**
 * pending-donation-store.js
 * 
 * Store condiviso per le donazioni pendenti.
 * Permette al listener USDC di recuperare i dati della donazione
 * (incluso beneficiaryWallet per Carte Regalo) registrata dal frontend
 * prima di processarla.
 */

// In-memory store per donazioni pendenti
const pendingDonations = new Map();

/**
 * Registra una donazione pendente
 * @param {string} donationId - ID univoco della donazione
 * @param {Object} data - Dati della donazione
 */
function register(donationId, data) {
  const id = String(donationId);
  pendingDonations.set(id, {
    ...data,
    registeredAt: data.registeredAt || new Date().toISOString()
  });
  console.log(`📥 Donazione pendente registrata: ${id} (txHash: ${data.txHash?.slice(0, 10)}...)`);
}

/**
 * Recupera una donazione pendente per ID
 * @param {string} donationId - ID della donazione
 * @returns {Object|null} Dati della donazione o null se non trovata
 */
function get(donationId) {
  return pendingDonations.get(String(donationId)) || null;
}

/**
 * Cerca una donazione pendente per txHash
 * @param {string} txHash - Hash della transazione
 * @returns {Object|null} Dati della donazione o null se non trovata
 */
function findByTxHash(txHash) {
  if (!txHash) return null;
  const normalizedTxHash = txHash.toLowerCase();
  
  for (const [id, data] of pendingDonations.entries()) {
    if (data.txHash && data.txHash.toLowerCase() === normalizedTxHash) {
      return { donationId: id, ...data };
    }
  }
  return null;
}

/**
 * Cerca una donazione pendente per wallet donor (ultima registrata, non completata)
 * Utile quando il listener USDC riceve il transfer prima che il frontend aggiorni il txHash
 * @param {string} donorWallet - Wallet del donatore
 * @returns {Object|null} Dati della donazione o null se non trovata
 */
function findByDonor(donorWallet) {
  if (!donorWallet) return null;
  const normalizedWallet = donorWallet.toLowerCase();
  
  let latestPending = null;
  let latestTime = 0;
  
  for (const [id, data] of pendingDonations.entries()) {
    // Cerca donazioni non ancora completate per questo wallet
    if (data.donor && data.donor.toLowerCase() === normalizedWallet && data.status !== 'COMPLETED') {
      const regTime = new Date(data.registeredAt || 0).getTime();
      if (regTime > latestTime) {
        latestTime = regTime;
        latestPending = { donationId: id, ...data };
      }
    }
  }
  return latestPending;
}

/**
 * Aggiorna una donazione pendente
 * @param {string} donationId - ID della donazione
 * @param {Object} updates - Campi da aggiornare
 */
function update(donationId, updates) {
  const id = String(donationId);
  const existing = pendingDonations.get(id);
  if (existing) {
    pendingDonations.set(id, { ...existing, ...updates });
  }
}

/**
 * Rimuove una donazione pendente
 * @param {string} donationId - ID della donazione
 */
function remove(donationId) {
  pendingDonations.delete(String(donationId));
}

/**
 * Verifica se esiste una donazione pendente
 * @param {string} donationId - ID della donazione
 * @returns {boolean}
 */
function has(donationId) {
  return pendingDonations.has(String(donationId));
}

/**
 * Ritorna il numero di donazioni pendenti
 * @returns {number}
 */
function size() {
  return pendingDonations.size;
}

module.exports = {
  register,
  get,
  findByTxHash,
  findByDonor,
  update,
  remove,
  has,
  size
};
