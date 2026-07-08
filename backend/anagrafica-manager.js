/**
 * 📊 ROG ANAGRAFICA MANAGER
 * 
 * Gestisce la lettura e conteggio posizioni dal file anagrafica TXT
 * Usato come fallback quando PostgreSQL non è disponibile
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const ANAGRAFICA_FILE = path.join(__dirname, 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');

/**
 * Conta il numero totale di posizioni nel file anagrafica
 * Il file ha formato:
 * posizione\tNome
 * wallet
 * posizione\tNome
 * wallet
 * ...
 * 
 * @returns {Promise<number>} Numero di posizioni
 */
async function contaPosizioni() {
  try {
    // Verifica che il file esista
    if (!fs.existsSync(ANAGRAFICA_FILE)) {
      console.warn('⚠️  File anagrafica non trovato:', ANAGRAFICA_FILE);
      return 0;
    }

    const content = fs.readFileSync(ANAGRAFICA_FILE, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    // Il file ha 2 righe per posizione: header + wallet
    // Quindi il numero di posizioni è lines.length / 2
    const numPosizioni = Math.floor(lines.length / 2);
    
    console.log(`📊 Posizioni contate da file TXT: ${numPosizioni}`);
    return numPosizioni;
    
  } catch (error) {
    console.error('❌ Errore conteggio posizioni:', error);
    return 0;
  }
}

/**
 * Trova tutte le posizioni di un wallet nel file anagrafica
 * @param {string} walletAddress - Indirizzo wallet (0x...)
 * @returns {Promise<Array>} Array di numeri posizione
 */
async function getPosizioniWallet(walletAddress) {
  try {
    if (!fs.existsSync(ANAGRAFICA_FILE)) {
      return [];
    }

    const walletLower = walletAddress.toLowerCase();
    const content = fs.readFileSync(ANAGRAFICA_FILE, 'utf8');
    const lines = content.split(/\r?\n/);
    
    const posizioni = [];
    
    for (let i = 0; i < lines.length - 1; i++) {
      const headerLine = lines[i].trim();
      const walletLine = lines[i + 1].trim().toLowerCase();
      
      // Se il wallet corrisponde, estrai il numero di posizione dall'header
      if (walletLine === walletLower && headerLine) {
        const parts = headerLine.split('\t');
        const posNum = parseInt(parts[0]);
        if (!isNaN(posNum)) {
          posizioni.push(posNum);
        }
      }
    }
    
    return posizioni;
    
  } catch (error) {
    console.error('❌ Errore ricerca posizioni wallet:', error);
    return [];
  }
}

module.exports = {
  contaPosizioni,
  getPosizioniWallet
};
