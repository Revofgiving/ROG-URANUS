/**
 * 🌉 ROG PONTI MANAGER - Sistema Ponti e Affitto Invitati
 * 
 * Gestisce:
 * - Classificazione utenti (INVITANTE/SEMI_INVITANTE/NON_INVITANTE)
 * - Sistema FIFO per accoppiamento ponti
 * - Accoppiamenti permanenti (8 cicli LARGE)
 * - Distribuzione doni con percentuali (100%/75%/50%)
 * 
 * MOMENTO CLASSIFICAZIONE: 3ª stellina verde MEDIUM (fine 3° ciclo MEDIUM)
 * 
 * @author Warp AI Agent
 * @version 1.0.0 - Sistema Ponti Completo
 */

const statePg = require('./state-persistence-pg');
const referralManager = require('./referral-manager');

// ========================================
// CONFIGURAZIONE
// ========================================

const STATE_KEY = 'ponti';

// Wallet speciali
const PILETTA_WALLET = '0x96e6a17f968b73d10263072899c95b83305281fe';
const ROG_WALLET = '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790';
const AVENGERS_WALLET = '0x7978c4423b4fd17fa05df593b4c05e138606f972';

// ========================================
// STRUTTURA PONTI STATE
// ========================================

/**
 * Struttura ponti-state.json:
 * {
 *   accoppiamenti: {
 *     "0xwallet": {
 *       wallet, nome, classificazione, numeroInvitati,
 *       classificazioneCongelata, dataClassificazione,
 *       ponti: [{ ponteWallet, ponteNome, percentuale, totaleRicevuto, cicliCompletati }]
 *     }
 *   },
 *   fifoQueue: [{ wallet, nome, numeroInvitati, invitatiDisponibili, dataIngresso, posizione }],
 *   classificazioni: {
 *     "0xwallet": { classificazione, numeroInvitati, dataCongelamento, congelata }
 *   }
 * }
 */

// ========================================
// CLASSE PRINCIPALE
// ========================================

class PontiManager {
  constructor() {
    this.state = {
      accoppiamenti: {},
      fifoQueue: [],
      classificazioni: {}
    };
    this.initialized = false;
  }

  /**
   * Inizializza il manager
   */
  async init() {
    if (this.initialized) return;

    console.log('🌉 Inizializzazione Ponti Manager...');

    // Carica stato ponti
    await this.loadState();

    // Inizializza referral manager
    await referralManager.init();

    this.initialized = true;
    console.log('✅ Ponti Manager pronto');
  }

  /**
   * Carica stato da PostgreSQL
   */
  async loadState() {
    try {
      const saved = await statePg.getState(STATE_KEY, {
        accoppiamenti: {},
        fifoQueue: [],
        classificazioni: {}
      });
      this.state = { ...this.state, ...saved };

      console.log(`✅ Ponti state caricato (PostgreSQL)`);
      console.log(`   Accoppiamenti: ${Object.keys(this.state.accoppiamenti).length}`);
      console.log(`   FIFO queue: ${this.state.fifoQueue.length}`);
      console.log(`   Classificazioni: ${Object.keys(this.state.classificazioni).length}`);

    } catch (error) {
      console.error('❌ Errore caricamento ponti state:', error.message);
    }
  }

  /**
   * Salva stato su PostgreSQL
   */
  async saveState() {
    await statePg.setState(STATE_KEY, this.state);
  }

  // ========================================
  // CLASSIFICAZIONE UTENTI
  // ========================================

  /**
   * Classifica utente al 3° ciclo MEDIUM (3ª stellina verde)
   * 
   * @param {string} wallet - Wallet utente
   * @param {string} nome - Nome utente
   * @returns {Object} Classificazione
   */
  async classificaUtente(wallet, nome) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    // Verifica se già classificato
    if (this.state.classificazioni[walletNorm]?.congelata) {
      console.log(`⚠️  Utente ${wallet} già classificato`);
      return this.state.classificazioni[walletNorm];
    }

    // Conta invitati in questo momento
    const numeroInvitati = await referralManager.contaInvitati(wallet);

    // Determina classificazione
    let classificazione;
    if (numeroInvitati >= 2) {
      classificazione = 'INVITANTE';
    } else if (numeroInvitati === 1) {
      classificazione = 'SEMI_INVITANTE';
    } else {
      classificazione = 'NON_INVITANTE';
    }

    // Congela classificazione
    const classificazioneData = {
      wallet: walletNorm,
      nome,
      classificazione,
      numeroInvitati,
      dataCongelamento: new Date().toISOString(),
      congelata: true
    };

    this.state.classificazioni[walletNorm] = classificazioneData;
    await this.saveState();

    console.log(`\n🔒 CLASSIFICAZIONE CONGELATA`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   Nome: ${nome}`);
    console.log(`   Invitati: ${numeroInvitati}`);
    console.log(`   Classificazione: ${classificazione}`);
    console.log(`   Data: ${classificazioneData.dataCongelamento}`);

    // Se ha 2+ invitati, aggiungi a FIFO
    if (numeroInvitati >= 2) {
      await this.aggiungiAFIFO(wallet, nome, numeroInvitati);
    }

    return classificazioneData;
  }

  /**
   * Ottiene classificazione utente
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object|null} Classificazione o null se non trovata
   */
  async getClassificazione(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();
    return this.state.classificazioni[walletNorm] || null;
  }

  // ========================================
  // SISTEMA FIFO
  // ========================================

  /**
   * Aggiungi utente a coda FIFO
   * 
   * @param {string} wallet - Wallet utente
   * @param {string} nome - Nome utente
   * @param {number} numeroInvitati - Numero invitati
   */
  async aggiungiAFIFO(wallet, nome, numeroInvitati) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    // Verifica se già in FIFO
    const esistente = this.state.fifoQueue.find(e => e.wallet === walletNorm);
    if (esistente) {
      console.log(`⚠️  ${wallet} già in FIFO`);
      return;
    }

    const entry = {
      wallet: walletNorm,
      nome,
      numeroInvitati,
      invitatiDisponibili: numeroInvitati,
      dataIngresso: new Date().toISOString(),
      posizione: this.state.fifoQueue.length + 1
    };

    this.state.fifoQueue.push(entry);
    await this.saveState();

    console.log(`✅ Aggiunto a FIFO: ${nome} (${numeroInvitati} invitati disponibili)`);
  }

  /**
   * Ottiene prossimo ponte da FIFO
   * 
   * @returns {Object|null} Ponte o null se FIFO vuota
   */
  async getProssimoPonteFIFO() {
    await this.init();

    // Cerca primo utente con invitati disponibili
    for (let i = 0; i < this.state.fifoQueue.length; i++) {
      const ponte = this.state.fifoQueue[i];
      
      if (ponte.invitatiDisponibili > 0) {
        // Decrementa invitati disponibili
        ponte.invitatiDisponibili--;
        
        // Se finiti, rimuovi da FIFO
        if (ponte.invitatiDisponibili === 0) {
          this.state.fifoQueue.splice(i, 1);
          console.log(`   FIFO: ${ponte.nome} ha esaurito gli invitati disponibili`);
        }
        
        await this.saveState();
        return ponte;
      }
    }

    console.log(`⚠️  FIFO VUOTA - Nessun ponte disponibile!`);
    return null;
  }

  /**
   * Ottiene stato FIFO
   */
  async getFIFO() {
    await this.init();
    return [...this.state.fifoQueue];
  }

  // ========================================
  // ACCOPPIAMENTI
  // ========================================

  /**
   * Crea accoppiamento per utente che entra in LARGE
   * 
   * @param {string} wallet - Wallet utente
   * @param {string} nome - Nome utente
   * @returns {Object} Dettagli accoppiamento
   */
  async creaAccoppiamento(wallet, nome) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    // Verifica se già accoppiato
    if (this.state.accoppiamenti[walletNorm]) {
      console.log(`⚠️  ${wallet} già accoppiato`);
      return this.state.accoppiamenti[walletNorm];
    }

    // Ottieni classificazione
    const classificazione = await this.getClassificazione(wallet);

    if (!classificazione) {
      throw new Error(`Classificazione non trovata per ${wallet} - deve essere classificato prima di entrare in LARGE`);
    }

    const ponti = [];

    // In base a classificazione, crea accoppiamenti
    if (classificazione.classificazione === 'INVITANTE') {
      // Nessun accoppiamento necessario
      console.log(`\n✅ ${nome} (INVITANTE) - Nessun ponte necessario (100% doni)`);

    } else if (classificazione.classificazione === 'SEMI_INVITANTE') {
      // Cerca invitante diretto
      const invitanteDiretto = await referralManager.getInvitanteDiretto(wallet);

      if (invitanteDiretto) {
        ponti.push({
          ponteWallet: invitanteDiretto.wallet,
          ponteNome: invitanteDiretto.nome,
          percentuale: 25,
          totaleRicevutoDaPonte: 0,
          cicliCompletati: 0,
          permanente: true,
          dataAccoppiamento: new Date().toISOString()
        });

        console.log(`\n✅ ${nome} (SEMI_INVITANTE) accoppiato con:`);
        console.log(`   Ponte: ${invitanteDiretto.nome} (25%)`);
      } else {
        console.log(`⚠️  Invitante diretto non trovato per ${wallet} - cerco in FIFO`);
        const ponte1 = await this.getProssimoPonteFIFO();
        if (ponte1) {
          ponti.push({
            ponteWallet: ponte1.wallet,
            ponteNome: ponte1.nome,
            percentuale: 25,
            totaleRicevutoDaPonte: 0,
            cicliCompletati: 0,
            permanente: true,
            dataAccoppiamento: new Date().toISOString()
          });
        }
      }

    } else if (classificazione.classificazione === 'NON_INVITANTE') {
      // Cerca 2 ponti in FIFO
      console.log(`\n🔍 ${nome} (NON_INVITANTE) - cerco 2 ponti in FIFO...`);

      const ponte1 = await this.getProssimoPonteFIFO();
      const ponte2 = await this.getProssimoPonteFIFO();

      if (ponte1) {
        ponti.push({
          ponteWallet: ponte1.wallet,
          ponteNome: ponte1.nome,
          percentuale: 25,
          totaleRicevutoDaPonte: 0,
          cicliCompletati: 0,
          permanente: true,
          dataAccoppiamento: new Date().toISOString()
        });
      }

      if (ponte2) {
        ponti.push({
          ponteWallet: ponte2.wallet,
          ponteNome: ponte2.nome,
          percentuale: 25,
          totaleRicevutoDaPonte: 0,
          cicliCompletati: 0,
          permanente: true,
          dataAccoppiamento: new Date().toISOString()
        });
      }

      console.log(`✅ ${nome} accoppiato con:`);
      ponti.forEach((p, i) => {
        console.log(`   Ponte #${i + 1}: ${p.ponteNome} (${p.percentuale}%)`);
      });
    }

    // Salva accoppiamento
    this.state.accoppiamenti[walletNorm] = {
      wallet: walletNorm,
      nome,
      classificazione: classificazione.classificazione,
      numeroInvitati: classificazione.numeroInvitati,
      classificazioneCongelata: true,
      dataClassificazione: classificazione.dataCongelamento,
      ponti,
      totaleRicevuto: 0,
      totaleDistribuitoAPonti: 0
    };

    await this.saveState();

    return this.state.accoppiamenti[walletNorm];
  }

  /**
   * Ottiene accoppiamenti per un wallet
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object|null} Accoppiamenti o null
   */
  async getAccoppiamenti(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();
    return this.state.accoppiamenti[walletNorm] || null;
  }

  // ========================================
  // DISTRIBUZIONE DONI LARGE
  // ========================================

  /**
   * Calcola distribuzione doni per ciclo LARGE
   * 
   * @param {string} walletRicevente - Wallet ricevente
   * @param {number} importoBase - Importo base donazione (200€, 400€, etc)
   * @param {number} ciclo - Numero ciclo LARGE (1-8)
   * @returns {Object} Dettagli distribuzione
   */
  async calcolaDistribuzioneLarge(walletRicevente, importoBase, ciclo) {
    await this.init();

    const walletNorm = walletRicevente.toLowerCase();

    // Ottieni classificazione e accoppiamenti
    const classificazione = await this.getClassificazione(walletRicevente);
    const accoppiamenti = await this.getAccoppiamenti(walletRicevente);

    if (!classificazione) {
      throw new Error(`Classificazione non trovata per ${walletRicevente}`);
    }

    // Calcola percentuale ricevente
    let percentualeRicevente;
    if (classificazione.classificazione === 'INVITANTE') {
      percentualeRicevente = 100;
    } else if (classificazione.classificazione === 'SEMI_INVITANTE') {
      percentualeRicevente = 75;
    } else {
      percentualeRicevente = 50;
    }

    const importoRicevente = importoBase * (percentualeRicevente / 100);
    const importoRestante = importoBase - importoRicevente;

    const distribuzione = {
      walletRicevente: walletNorm,
      ciclo,
      importoBase,
      percentualeRicevente,
      importoRicevente,
      ponti: [],
      totaleAPonti: 0
    };

    // Distribuzione ai ponti
    if (accoppiamenti && accoppiamenti.ponti.length > 0) {
      for (const ponte of accoppiamenti.ponti) {
        const importoPonte = importoBase * (ponte.percentuale / 100);

        distribuzione.ponti.push({
          wallet: ponte.ponteWallet,
          nome: ponte.ponteNome,
          percentuale: ponte.percentuale,
          importo: importoPonte
        });

        distribuzione.totaleAPonti += importoPonte;
      }
    }

    return distribuzione;
  }

  /**
   * Registra distribuzione effettuata
   * 
   * @param {string} walletRicevente - Wallet ricevente
   * @param {number} ciclo - Ciclo LARGE
   * @param {Object} distribuzione - Dettagli distribuzione
   */
  async registraDistribuzione(walletRicevente, ciclo, distribuzione) {
    await this.init();

    const walletNorm = walletRicevente.toLowerCase();
    const accoppiamenti = this.state.accoppiamenti[walletNorm];

    if (!accoppiamenti) {
      return; // Nessun accoppiamento da aggiornare
    }

    // Aggiorna totali
    accoppiamenti.totaleRicevuto += distribuzione.importoRicevente;
    accoppiamenti.totaleDistribuitoAPonti += distribuzione.totaleAPonti;

    // Aggiorna ponti
    for (const ponteDist of distribuzione.ponti) {
      const ponte = accoppiamenti.ponti.find(p => p.ponteWallet === ponteDist.wallet);
      if (ponte) {
        ponte.totaleRicevutoDaPonte += ponteDist.importo;
        ponte.cicliCompletati = ciclo;
      }
    }

    await this.saveState();

    console.log(`\n💰 DISTRIBUZIONE REGISTRATA - Ciclo ${ciclo}`);
    console.log(`   Ricevente: ${walletRicevente}`);
    console.log(`   Importo ricevente: ${distribuzione.importoRicevente}€`);
    console.log(`   Totale ai ponti: ${distribuzione.totaleAPonti}€`);

    distribuzione.ponti.forEach(p => {
      console.log(`   - ${p.nome}: ${p.importo}€ (${p.percentuale}%)`);
    });
  }

  // ========================================
  // GESTIONE SPECIALE PILETTA
  // ========================================

  /**
   * Redistribuzione speciale per PILETTA
   * 
   * @param {number} importoPiletta - Importo ricevuto da Piletta
   * @returns {Object} Redistribuzione
   */
  async redistribuzioniPiletta(importoPiletta) {
    const redistribuzione = {
      importoOriginale: importoPiletta,
      nuovePosizioniPiletta: importoPiletta * 0.5,
      avengers: importoPiletta * 0.1,
      rog: importoPiletta * 0.4
    };

    console.log(`\n🔄 REDISTRIBUZIONE PILETTA`);
    console.log(`   Importo: ${importoPiletta}€`);
    console.log(`   50% Nuove posizioni PILETTA: ${redistribuzione.nuovePosizioniPiletta}€`);
    console.log(`   10% AVENGERS: ${redistribuzione.avengers}€`);
    console.log(`   40% ROG: ${redistribuzione.rog}€`);

    return redistribuzione;
  }

  // ========================================
  // UTILITY
  // ========================================

  /**
   * Ottiene statistiche complete sistema ponti
   */
  async getStatistiche() {
    await this.init();

    const stats = {
      totaleClassificati: Object.keys(this.state.classificazioni).length,
      invitanti: 0,
      semiInvitanti: 0,
      nonInvitanti: 0,
      totaleAccoppiati: Object.keys(this.state.accoppiamenti).length,
      fifoSize: this.state.fifoQueue.length,
      invitatiDisponibiliFIFO: this.state.fifoQueue.reduce((sum, p) => sum + p.invitatiDisponibili, 0)
    };

    // Conta per classificazione
    Object.values(this.state.classificazioni).forEach(c => {
      if (c.classificazione === 'INVITANTE') stats.invitanti++;
      else if (c.classificazione === 'SEMI_INVITANTE') stats.semiInvitanti++;
      else if (c.classificazione === 'NON_INVITANTE') stats.nonInvitanti++;
    });

    return stats;
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

const pontiManager = new PontiManager();

module.exports = pontiManager;
