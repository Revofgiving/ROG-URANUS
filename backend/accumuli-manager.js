const fs = require('fs').promises;
const path = require('path');

const ACCUMULI_FILE = path.join(__dirname, 'data', 'accumuli.json');

/**
 * ACCUMULI MANAGER
 * 
 * Gestisce gli accumuli per le transizioni di movimento:
 * - SMALL → MEDIUM: richiede 10€ accumulati
 * - MEDIUM → LARGE: richiede 100€ accumulati
 * 
 * Gli accumuli si formano durante i cicli:
 * - SMALL Ciclo 2: +2€ al ricevente
 * - SMALL Ciclo 3: +4€ al ricevente (D1 + D2) → totale 10€ per transizione
 * - MEDIUM Ciclo 2: +10€ al ricevente
 * - MEDIUM Ciclo 3: +20€ al ricevente → continua fino a 100€ per transizione LARGE
 */

class AccumuliManager {
  constructor() {
    this.accumuli = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    try {
      const data = await fs.readFile(ACCUMULI_FILE, 'utf8');
      this.accumuli = JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File non esiste, creo struttura vuota
        this.accumuli = {
          accumuliSmallToMedium: {}, // wallet -> importo accumulato verso MEDIUM
          accumuliMediumToLarge: {}  // wallet -> importo accumulato verso LARGE
        };
        await this.save();
      } else {
        throw err;
      }
    }
    
    this.initialized = true;
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(ACCUMULI_FILE), { recursive: true });
      await fs.writeFile(ACCUMULI_FILE, JSON.stringify(this.accumuli, null, 2), 'utf8');
    } catch (err) {
      console.error('❌ Errore salvataggio accumuli:', err);
      throw err;
    }
  }

  /**
   * Aggiunge accumulo per transizione SMALL → MEDIUM
   * @param {string} wallet - Wallet utente
   * @param {number} importo - Importo da aggiungere (2€ o 4€)
   */
  async aggiungiAccumuloSmallToMedium(wallet, importo) {
    await this.init();
    
    const walletLower = wallet.toLowerCase();
    const currentAccumulo = this.accumuli.accumuliSmallToMedium[walletLower] || 0;
    const newAccumulo = currentAccumulo + importo;
    
    this.accumuli.accumuliSmallToMedium[walletLower] = newAccumulo;
    await this.save();
    
    console.log(`💰 Accumulo SMALL→MEDIUM: ${walletLower} = ${newAccumulo}€`);
    
    return {
      wallet: walletLower,
      accumuloPrecedente: currentAccumulo,
      accumuloAttuale: newAccumulo,
      completo: newAccumulo >= 10
    };
  }

  /**
   * Aggiunge accumulo per transizione MEDIUM → LARGE
   * @param {string} wallet - Wallet utente
   * @param {number} importo - Importo da aggiungere (10€ o 20€)
   */
  async aggiungiAccumuloMediumToLarge(wallet, importo) {
    await this.init();
    
    const walletLower = wallet.toLowerCase();
    const currentAccumulo = this.accumuli.accumuliMediumToLarge[walletLower] || 0;
    const newAccumulo = currentAccumulo + importo;
    
    this.accumuli.accumuliMediumToLarge[walletLower] = newAccumulo;
    await this.save();
    
    console.log(`💰 Accumulo MEDIUM→LARGE: ${walletLower} = ${newAccumulo}€`);
    
    // PUNTO 49: Verifica soglia ZK-KYC (100€)
    if (newAccumulo >= 100 && currentAccumulo < 100) {
      console.log(`   🔐 Soglia ZK-KYC raggiunta! Attivazione verifica...`);
      
      try {
        const zkKYCManager = require('./zkkyc-manager');
        
        // Ottieni nome utente da users-data.json
        const usersDataPath = require('path').join(__dirname, 'users-data.json');
        let nome = walletLower; // Default: usa wallet come nome
        
        try {
          const usersData = JSON.parse(require('fs').readFileSync(usersDataPath, 'utf8'));
          if (usersData[walletLower] && usersData[walletLower].nome) {
            nome = usersData[walletLower].nome;
          }
        } catch (err) {
          console.log(`   ⚠️  Impossibile leggere nome da users-data.json, uso wallet`);
        }
        
        // Invia notifica ZK-KYC
        await zkKYCManager.checkAndNotifyZKKYC(wallet, nome, newAccumulo);
      } catch (error) {
        console.error(`   ❌ Errore attivazione notifica ZK-KYC:`, error);
        // Non bloccare il flusso principale se notifica fallisce
      }
    }
    
    return {
      wallet: walletLower,
      accumuloPrecedente: currentAccumulo,
      accumuloAttuale: newAccumulo,
      completo: newAccumulo >= 100
    };
  }

  /**
   * Ottiene accumulo corrente per SMALL → MEDIUM
   */
  async getAccumuloSmallToMedium(wallet) {
    await this.init();
    const walletLower = wallet.toLowerCase();
    return this.accumuli.accumuliSmallToMedium[walletLower] || 0;
  }

  /**
   * Ottiene accumulo corrente per MEDIUM → LARGE
   */
  async getAccumuloMediumToLarge(wallet) {
    await this.init();
    const walletLower = wallet.toLowerCase();
    return this.accumuli.accumuliMediumToLarge[walletLower] || 0;
  }

  /**
   * Resetta accumulo SMALL→MEDIUM dopo transizione completata
   */
  async resetAccumuloSmallToMedium(wallet) {
    await this.init();
    const walletLower = wallet.toLowerCase();
    const old = this.accumuli.accumuliSmallToMedium[walletLower] || 0;
    
    delete this.accumuli.accumuliSmallToMedium[walletLower];
    await this.save();
    
    console.log(`🔄 Reset accumulo SMALL→MEDIUM: ${walletLower} (era ${old}€)`);
    return old;
  }

  /**
   * Resetta accumulo MEDIUM→LARGE dopo transizione completata
   */
  async resetAccumuloMediumToLarge(wallet) {
    await this.init();
    const walletLower = wallet.toLowerCase();
    const old = this.accumuli.accumuliMediumToLarge[walletLower] || 0;
    
    delete this.accumuli.accumuliMediumToLarge[walletLower];
    await this.save();
    
    console.log(`🔄 Reset accumulo MEDIUM→LARGE: ${walletLower} (era ${old}€)`);
    return old;
  }

  /**
   * Verifica se utente ha completato accumulo per transizione SMALL→MEDIUM
   */
  async haAccumuloCompletoSmallToMedium(wallet) {
    const accumulo = await this.getAccumuloSmallToMedium(wallet);
    return accumulo >= 10;
  }

  /**
   * Verifica se utente ha completato accumulo per transizione MEDIUM→LARGE
   */
  async haAccumuloCompletoMediumToLarge(wallet) {
    const accumulo = await this.getAccumuloMediumToLarge(wallet);
    return accumulo >= 100;
  }

  /**
   * Ottiene tutti gli accumuli (per debug/admin)
   */
  async getAllAccumuli() {
    await this.init();
    return {
      smallToMedium: { ...this.accumuli.accumuliSmallToMedium },
      mediumToLarge: { ...this.accumuli.accumuliMediumToLarge }
    };
  }
}

// Singleton instance
const accumuliManager = new AccumuliManager();

module.exports = accumuliManager;
