/**
 * 💰 CASSA ROG MANAGER - Gestione Finanziaria Completa
 * 
 * Gestisce il wallet CASSA ROG (0xD5bCC7acc9d6862c784807134c1F70c3e7f9F790)
 * come serbatoio totale con partizioni interne:
 * 
 * 1. CASSA ACCUMULI - Accumuli per transizioni SMALL→MEDIUM (10€) e MEDIUM→LARGE (100€)
 * 2. CASSA DONI - Doni distribuiti agli utenti
 * 3. CASSA PONTI - Ponti tra movimenti
 * 4. CASSA PROGETTI - Progetti DAO
 * 5. CASSA SERVIZI - Servizi piattaforma
 * 6. CASSA DONO AL VOLO - Dono al volo
 * 
 * Ogni sezione traccia:
 * - ENTRATE: con timestamp, importo, causale, riferimento
 * - USCITE: con timestamp, importo, causale, destinatario
 * - SALDO: entrate - uscite
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 17 Novembre 2025
 */

const path = require('path');
const statePg = require('./state-persistence-pg');

// Wallet CASSA ROG (serbatoio totale) - Punto 80
const CASSA_ROG_WALLET = '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790';

const STATE_KEY = 'cassa_rog';
const SCHEDE_DIR = path.join(__dirname, '..', 'SCHEDE_FINANZIARIE');

/**
 * Nomi sezioni CASSA ROG
 */
const SEZIONI = {
  ACCUMULI: 'ACCUMULI',
  DONI: 'DONI',
  PONTI: 'PONTI',
  PROGETTI: 'PROGETTI',
  SERVIZI: 'SERVIZI',
  DONO_AL_VOLO: 'DONO_AL_VOLO'
};

class CassaROGManager {
  constructor() {
    this.state = {
      cassaWallet: CASSA_ROG_WALLET,
      sezioni: {},
      ultimoAggiornamento: null
    };
    
    // Inizializza sezioni
    Object.values(SEZIONI).forEach(sezione => {
      this.state.sezioni[sezione] = {
        nome: sezione,
        entrate: [],
        uscite: [],
        saldo: 0
      };
    });
    
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const saved = await statePg.getState(STATE_KEY, this.state);
      this.state = { ...this.state, ...saved };
      
      // Assicurati che tutte le sezioni esistano
      Object.values(SEZIONI).forEach(sezione => {
        if (!this.state.sezioni[sezione]) {
          this.state.sezioni[sezione] = {
            nome: sezione,
            entrate: [],
            uscite: [],
            saldo: 0
          };
        }
      });
      
    } catch (err) {
      console.error('❌ Errore init cassa-rog:', err.message);
    }

    this.initialized = true;
    console.log('💰 Cassa ROG Manager inizializzato (PostgreSQL)');
  }

  async saveState() {
    this.state.ultimoAggiornamento = new Date().toISOString();
    await statePg.setState(STATE_KEY, this.state);
  }

  /**
   * Registra ENTRATA in una sezione
   * 
   * @param {string} sezione - Nome sezione (ACCUMULI, DONI, ecc.)
   * @param {number} importo - Importo entrata (€)
   * @param {string} causale - Descrizione causale
   * @param {Object} dettagli - Dettagli aggiuntivi (wallet, level, cycle, ecc.)
   */
  async registraEntrata(sezione, importo, causale, dettagli = {}) {
    await this.init();

    if (!this.state.sezioni[sezione]) {
      throw new Error(`Sezione non valida: ${sezione}`);
    }

    const entrata = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      importo: parseFloat(importo),
      causale,
      dettagli
    };

    this.state.sezioni[sezione].entrate.push(entrata);
    this.state.sezioni[sezione].saldo += entrata.importo;
    
    await this.saveState();
    
    console.log(`✅ ENTRATA ${sezione}: +${importo}€ - ${causale}`);
    
    return entrata;
  }

  /**
   * Registra USCITA da una sezione
   * 
   * @param {string} sezione - Nome sezione
   * @param {number} importo - Importo uscita (€)
   * @param {string} causale - Descrizione causale
   * @param {Object} dettagli - Dettagli aggiuntivi (wallet destinatario, ecc.)
   */
  async registraUscita(sezione, importo, causale, dettagli = {}) {
    await this.init();

    if (!this.state.sezioni[sezione]) {
      throw new Error(`Sezione non valida: ${sezione}`);
    }

    const uscita = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      importo: parseFloat(importo),
      causale,
      dettagli
    };

    this.state.sezioni[sezione].uscite.push(uscita);
    this.state.sezioni[sezione].saldo -= uscita.importo;
    
    await this.saveState();
    
    console.log(`✅ USCITA ${sezione}: -${importo}€ - ${causale}`);
    
    return uscita;
  }

  /**
   * Ottiene saldo di una sezione
   */
  async getSaldo(sezione) {
    await this.init();
    
    if (!this.state.sezioni[sezione]) {
      throw new Error(`Sezione non valida: ${sezione}`);
    }
    
    return this.state.sezioni[sezione].saldo;
  }

  /**
   * Ottiene statistiche di una sezione
   */
  async getStatisticheSezione(sezione) {
    await this.init();
    
    if (!this.state.sezioni[sezione]) {
      throw new Error(`Sezione non valida: ${sezione}`);
    }
    
    const sez = this.state.sezioni[sezione];
    const totaleEntrate = sez.entrate.reduce((sum, e) => sum + e.importo, 0);
    const totaleUscite = sez.uscite.reduce((sum, u) => sum + u.importo, 0);
    
    return {
      nome: sez.nome,
      totaleEntrate,
      totaleUscite,
      saldo: sez.saldo,
      numeroEntrate: sez.entrate.length,
      numeroUscite: sez.uscite.length
    };
  }

  /**
   * Ottiene bilancio complessivo CASSA ROG
   */
  async getBilancioComplessivo() {
    await this.init();
    
    const bilancio = {
      cassaWallet: CASSA_ROG_WALLET,
      sezioni: {},
      totaleEntrate: 0,
      totaleUscite: 0,
      saldoComplessivo: 0,
      ultimoAggiornamento: this.state.ultimoAggiornamento
    };
    
    for (const sezione of Object.values(SEZIONI)) {
      const stats = await this.getStatisticheSezione(sezione);
      bilancio.sezioni[sezione] = stats;
      bilancio.totaleEntrate += stats.totaleEntrate;
      bilancio.totaleUscite += stats.totaleUscite;
      bilancio.saldoComplessivo += stats.saldo;
    }
    
    return bilancio;
  }

  /**
   * Genera SCHEDA FINANZIARIA per una sezione specifica
   */
  async generaSchedaSezione(sezione) {
    await this.init();
    
    if (!this.state.sezioni[sezione]) {
      throw new Error(`Sezione non valida: ${sezione}`);
    }
    
    const sez = this.state.sezioni[sezione];
    const stats = await this.getStatisticheSezione(sezione);
    
    let scheda = `═══════════════════════════════════════════════════════════════════════════════\n`;
    scheda += `   SCHEDA FINANZIARIA CASSA ${sezione}\n`;
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n\n`;
    scheda += `🏦 Wallet CASSA ROG: ${CASSA_ROG_WALLET}\n`;
    scheda += `📅 Ultimo aggiornamento: ${this.state.ultimoAggiornamento || 'N/A'}\n\n`;
    
    // Riepilogo
    scheda += `📊 RIEPILOGO\n`;
    scheda += `${'─'.repeat(79)}\n`;
    scheda += `Totale ENTRATE:  ${this.formatEuro(stats.totaleEntrate)} (${stats.numeroEntrate} operazioni)\n`;
    scheda += `Totale USCITE:   ${this.formatEuro(stats.totaleUscite)} (${stats.numeroUscite} operazioni)\n`;
    scheda += `SALDO:           ${this.formatEuro(stats.saldo)}\n\n`;
    
    // ENTRATE
    scheda += `💰 ENTRATE\n`;
    scheda += `${'─'.repeat(79)}\n`;
    if (sez.entrate.length === 0) {
      scheda += `Nessuna entrata registrata.\n\n`;
    } else {
      scheda += `DATA                 | IMPORTO   | CAUSALE\n`;
      scheda += `${'─'.repeat(79)}\n`;
      sez.entrate.forEach(e => {
        const data = this.formatData(e.timestamp);
        const importo = this.formatEuro(e.importo);
        const causale = this.truncate(e.causale, 45);
        scheda += `${data} | ${importo.padEnd(9)} | ${causale}\n`;
      });
      scheda += `\n`;
    }
    
    // USCITE
    scheda += `💸 USCITE\n`;
    scheda += `${'─'.repeat(79)}\n`;
    if (sez.uscite.length === 0) {
      scheda += `Nessuna uscita registrata.\n\n`;
    } else {
      scheda += `DATA                 | IMPORTO   | CAUSALE\n`;
      scheda += `${'─'.repeat(79)}\n`;
      sez.uscite.forEach(u => {
        const data = this.formatData(u.timestamp);
        const importo = this.formatEuro(u.importo);
        const causale = this.truncate(u.causale, 45);
        scheda += `${data} | ${importo.padEnd(9)} | ${causale}\n`;
      });
      scheda += `\n`;
    }
    
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n`;
    scheda += `Fine scheda finanziaria CASSA ${sezione}\n`;
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n`;
    
    return scheda;
  }

  /**
   * Genera SCHEDA FINANZIARIA CASSA ROG complessiva
   */
  async generaSchedaComplessiva() {
    await this.init();
    
    const bilancio = await this.getBilancioComplessivo();
    
    let scheda = `═══════════════════════════════════════════════════════════════════════════════\n`;
    scheda += `   SCHEDA FINANZIARIA CASSA ROG - BILANCIO COMPLESSIVO\n`;
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n\n`;
    scheda += `🏦 Wallet CASSA ROG: ${CASSA_ROG_WALLET}\n`;
    scheda += `📅 Ultimo aggiornamento: ${bilancio.ultimoAggiornamento || 'N/A'}\n\n`;
    
    // Riepilogo generale
    scheda += `📊 BILANCIO GENERALE\n`;
    scheda += `${'─'.repeat(79)}\n`;
    scheda += `Totale ENTRATE:  ${this.formatEuro(bilancio.totaleEntrate)}\n`;
    scheda += `Totale USCITE:   ${this.formatEuro(bilancio.totaleUscite)}\n`;
    scheda += `SALDO TOTALE:    ${this.formatEuro(bilancio.saldoComplessivo)}\n\n`;
    
    // Dettaglio sezioni
    scheda += `💼 DETTAGLIO SEZIONI\n`;
    scheda += `${'─'.repeat(79)}\n`;
    scheda += `SEZIONE          | ENTRATE   | USCITE    | SALDO     | OPS\n`;
    scheda += `${'─'.repeat(79)}\n`;
    
    for (const [nome, stats] of Object.entries(bilancio.sezioni)) {
      const sezione = nome.padEnd(16);
      const entrate = this.formatEuro(stats.totaleEntrate).padEnd(9);
      const uscite = this.formatEuro(stats.totaleUscite).padEnd(9);
      const saldo = this.formatEuro(stats.saldo).padEnd(9);
      const ops = `${stats.numeroEntrate}E/${stats.numeroUscite}U`;
      scheda += `${sezione} | ${entrate} | ${uscite} | ${saldo} | ${ops}\n`;
    }
    
    scheda += `\n`;
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n`;
    scheda += `Note:\n`;
    scheda += `- Tutti i doni vanno al wallet CASSA ROG\n`;
    scheda += `- Le sezioni rappresentano partizioni contabili INTERNE\n`;
    scheda += `- Non ci sono transazioni blockchain tra sezioni\n`;
    scheda += `- CASSA ACCUMULI: accumuli per transizioni SMALL→MEDIUM (10€) e MEDIUM→LARGE (100€)\n`;
    scheda += `- CASSA DONI: doni distribuiti agli utenti\n`;
    scheda += `- CASSA PONTI: ponti conoscenze tra movimenti\n`;
    scheda += `- CASSA PROGETTI: progetti DAO\n`;
    scheda += `- CASSA SERVIZI: servizi piattaforma\n`;
    scheda += `- CASSA DONO AL VOLO: dono al volo\n`;
    scheda += `═══════════════════════════════════════════════════════════════════════════════\n`;
    
    return scheda;
  }

  /**
   * Salva tutte le schede finanziarie su file
   */
  async salvaSchedeFinanziarie() {
    await this.init();
    
    // Crea directory schede
    await fs.mkdir(SCHEDE_DIR, { recursive: true });
    
    const files = [];
    
    // 1. Scheda complessiva CASSA ROG
    const schedaComplessiva = await this.generaSchedaComplessiva();
    const fileComplessivo = path.join(SCHEDE_DIR, 'SCHEDA FINANZIARIA CASSA ROG.txt');
    await fs.writeFile(fileComplessivo, schedaComplessiva, 'utf8');
    files.push(fileComplessivo);
    console.log(`✅ Salvata: SCHEDA FINANZIARIA CASSA ROG.txt`);
    
    // 2. Schede singole sezioni
    for (const sezione of Object.values(SEZIONI)) {
      const schedaSezione = await this.generaSchedaSezione(sezione);
      const fileName = `SCHEDA FINANZIARIA CASSA ${sezione}.txt`;
      const filePath = path.join(SCHEDE_DIR, fileName);
      await fs.writeFile(filePath, schedaSezione, 'utf8');
      files.push(filePath);
      console.log(`✅ Salvata: ${fileName}`);
    }
    
    return files;
  }

  /**
   * Helper: genera ID univoco
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper: formatta data
   */
  formatData(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('it-IT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Helper: formatta importo in euro
   */
  formatEuro(importo) {
    return `${importo.toFixed(2)}€`;
  }

  /**
   * Helper: tronca stringa
   */
  truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }
}

// Export singleton
const cassaROGManager = new CassaROGManager();
module.exports = cassaROGManager;
module.exports.SEZIONI = SEZIONI;
module.exports.CASSA_ROG_WALLET = CASSA_ROG_WALLET;
