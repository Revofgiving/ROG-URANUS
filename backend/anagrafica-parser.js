// ========================================
// PARSER ANAGRAFICA ROG
// Gestisce 17,235+ posizioni
// ========================================

const fs = require('fs');
const path = require('path');

const ANAGRAFICA_PATH = path.join(__dirname, '..', 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');

/**
 * Legge e parsa l'anagrafica completa
 * @returns {Array} Array di posizioni [{id, nome, wallet}]
 */
function readAnagrafica() {
  try {
    if (!fs.existsSync(ANAGRAFICA_PATH)) {
      console.error('❌ Anagrafica non trovata:', ANAGRAFICA_PATH);
      return [];
    }

    const content = fs.readFileSync(ANAGRAFICA_PATH, 'utf8');
    const lines = content.trim().split('\n');
    
    const posizioni = lines.map(line => {
      const [id, nome, wallet] = line.split('\t');
      return {
        id: parseInt(id),
        nome: nome.trim(),
        wallet: wallet.trim().toLowerCase()
      };
    });

    console.log(`✅ Anagrafica caricata: ${posizioni.length} posizioni`);
    return posizioni;
    
  } catch (error) {
    console.error('❌ Errore lettura anagrafica:', error);
    return [];
  }
}

/**
 * Verifica se un wallet è presente nell'anagrafica
 * @param {string} walletAddress - Indirizzo wallet da verificare
 * @returns {boolean}
 */
function isWalletRegistered(walletAddress) {
  const posizioni = readAnagrafica();
  const walletLower = walletAddress.toLowerCase();
  
  return posizioni.some(p => p.wallet === walletLower);
}

/**
 * Ottiene tutte le posizioni di un wallet
 * @param {string} walletAddress
 * @returns {Array} Array di posizioni del wallet
 */
function getWalletPositions(walletAddress) {
  const posizioni = readAnagrafica();
  const walletLower = walletAddress.toLowerCase();
  
  return posizioni.filter(p => p.wallet === walletLower);
}

/**
 * Conta posizioni totali per wallet
 * @param {string} walletAddress
 * @returns {number}
 */
function countWalletPositions(walletAddress) {
  return getWalletPositions(walletAddress).length;
}

/**
 * Ottiene wallet unici dall'anagrafica
 * @returns {Array} Array di wallet unici
 */
function getUniqueWallets() {
  const posizioni = readAnagrafica();
  const walletsSet = new Set(posizioni.map(p => p.wallet));
  return Array.from(walletsSet);
}

/**
 * Aggiungi nuova posizione all'anagrafica
 * @param {string} nome - Nome utente
 * @param {string} wallet - Wallet address
 * @returns {boolean} Success
 */
function addPosition(nome, wallet) {
  try {
    const posizioni = readAnagrafica();
    const newId = posizioni.length > 0 ? Math.max(...posizioni.map(p => p.id)) + 1 : 1;
    
    const newLine = `${newId}\t${nome}\t${wallet.toLowerCase()}\n`;
    fs.appendFileSync(ANAGRAFICA_PATH, newLine, 'utf8');
    
    console.log(`✅ Posizione aggiunta: ${newId} - ${nome} - ${wallet}`);
    return true;
    
  } catch (error) {
    console.error('❌ Errore aggiunta posizione:', error);
    return false;
  }
}

/**
 * Statistiche anagrafica
 * @returns {Object} Statistiche complete
 */
function getStats() {
  const posizioni = readAnagrafica();
  const uniqueWallets = getUniqueWallets();
  
  // Conta posizioni per wallet
  const walletCounts = {};
  posizioni.forEach(p => {
    walletCounts[p.wallet] = (walletCounts[p.wallet] || 0) + 1;
  });
  
  const maxPositions = Math.max(...Object.values(walletCounts));
  const avgPositions = (posizioni.length / uniqueWallets.length).toFixed(2);
  
  return {
    totalPositions: posizioni.length,
    uniqueWallets: uniqueWallets.length,
    maxPositionsPerWallet: maxPositions,
    avgPositionsPerWallet: parseFloat(avgPositions)
  };
}

module.exports = {
  readAnagrafica,
  isWalletRegistered,
  getWalletPositions,
  countWalletPositions,
  getUniqueWallets,
  addPosition,
  getStats
};
