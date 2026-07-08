/**
 * 🌊 ROG CASCATA MANAGER - Distribuzione Cascata Generazionale LARGE
 * 
 * Gestisce la distribuzione a cascata per generazioni H:
 * 
 * PUNTO 55-57: Distribuzione sequenziale per generazione
 * - H10 riceve tutti C1 → poi H8 riceve tutti C2 → poi H6 tutti C3 → H4 tutti C4 → H2 tutti C5
 * - Si attende completamento intera generazione prima di passare alla successiva
 * 
 * PUNTO 59-62: Apertura nuove generazioni
 * - Quando tutti H2 hanno ricevuto C5, si apre generazione H11
 * - H11 C1 → H9 C2 → H7 C3 → H5 C4 → H3 C5 → H1 C6
 * - Pattern continua infinitamente: H12, H13, H14...
 * 
 * PUNTO 58: Gestione doni mancanti
 * - Recupero da doni_mancanti.txt e importazione in database
 * - Distribuzione doni pendenti prima di aprire nuove generazioni
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 16 Novembre 2025
 */

const statePg = require('./state-persistence-pg');

// ========================================
// CONFIGURAZIONE
// ========================================

const STATE_KEY = 'cascata';

// ========================================
// CLASSE MANAGER
// ========================================

class CascataManager {
  constructor() {
    this.state = {
      hCorrente: 10,
      cicloCorrente: 1,
      statoSistema: 'IN_DISTRIBUZIONE', // IN_DISTRIBUZIONE, IN_ATTESA, APERTURA_NUOVA_GENERAZIONE
      ultimaGenerazioneAperta: 10,
      ultimaGenerazioneCompletata: 2,
      generazioni: {},  // { h: { stato, ciclo, riceventi, completati } }
      cascataCorrente: null, // { h, ciclo, iniziata, completata }
      doniMancanti: []
    };
    this.initialized = false;
  }

  /**
   * Inizializza manager
   */
  async init() {
    if (this.initialized) return;

    console.log('🌊 Inizializzazione Cascata Manager...');

    await this.loadState();

    this.initialized = true;
    console.log('✅ Cascata Manager pronto');
    console.log(`   H corrente: ${this.state.hCorrente}`);
    console.log(`   Ciclo corrente: ${this.state.cicloCorrente}`);
    console.log(`   Stato: ${this.state.statoSistema}`);
  }

  /**
   * Carica stato da PostgreSQL
   */
  async loadState() {
    try {
      const saved = await statePg.getState(STATE_KEY, this.state);
      this.state = { ...this.state, ...saved };
      console.log('✅ Cascata state caricato (PostgreSQL)');
    } catch (error) {
      console.error('❌ Errore caricamento cascata state:', error.message);
    }
  }

  /**
   * Salva stato su PostgreSQL
   */
  async saveState() {
    await statePg.setState(STATE_KEY, this.state);
  }

  // ========================================
  // GESTIONE GENERAZIONI
  // ========================================

  /**
   * Registra generazione H con i suoi riceventi
   * 
   * @param {number} h - Numero generazione H
   * @param {Array} riceventi - Array di riceventi {wallet, nome, posizione, molecola}
   */
  async registraGenerazione(h, riceventi) {
    await this.init();

    if (this.state.generazioni[h]) {
      console.log(`⚠️  Generazione H${h} già registrata`);
      return this.state.generazioni[h];
    }

    // Calcola ciclo da ricevere per questa generazione
    const cicloDaRicevere = this.calcolaCicloDaRicevere(h);

    const generazione = {
      h,
      cicloDaRicevere,
      stato: 'APERTA',
      dataApertura: new Date().toISOString(),
      totaleRiceventi: riceventi.length,
      riceventiCompletati: 0,
      riceventi: riceventi.map(r => ({
        wallet: r.wallet.toLowerCase(),
        nome: r.nome,
        posizione: r.posizione,
        molecola: r.molecola,
        classificazione: null, // Da determinare al momento distribuzione
        statoDono: 'PENDENTE',
        importoDovuto: null,
        importoRicevuto: 0,
        dataDistribuzione: null
      }))
    };

    this.state.generazioni[h] = generazione;
    this.state.ultimaGenerazioneAperta = h;
    
    await this.saveState();

    console.log(`\\n✅ GENERAZIONE H${h} REGISTRATA`);
    console.log(`   Ciclo da ricevere: ${cicloDaRicevere}`);
    console.log(`   Totale riceventi: ${riceventi.length}`);

    return generazione;
  }

  /**
   * Calcola quale ciclo deve ricevere una generazione H
   * 
   * Formula: ciclo = ((h - 2) % 6) + 1
   * - H2 → C5 (eccetto prima volta)
   * - H4 → C4
   * - H6 → C3
   * - H8 → C2
   * - H10 → C1
   * - H11 → C1
   * - H12 → C6 (per H1 da H11)
   * 
   * @param {number} h - Numero H
   * @returns {number} Ciclo da ricevere
   */
  calcolaCicloDaRicevere(h) {
    // Formula cascata
    if (h === 2) return 5; // H2 riceve C5
    if (h === 4) return 4;
    if (h === 6) return 3;
    if (h === 8) return 2;
    if (h === 10 || h === 11) return 1;

    // Per H >= 12, calcola in base al pattern
    // H12 per H1 (C6), H13 per H2 (C1), H14 per H3 (C6), ...
    const offset = (h - 10) % 6;
    if (offset === 2) return 6; // H12, H18, H24 → C6
    if (offset === 3) return 1; // H13, H19, H25 → C1
    if (offset === 4) return 2; // H14, H20, H26 → C2
    if (offset === 5) return 3; // H15, H21, H27 → C3
    if (offset === 0) return 4; // H16, H22, H28 → C4
    if (offset === 1) return 5; // H17, H23, H29 → C5

    return 1; // Default
  }

  /**
   * Ottiene generazione H
   */
  async getGenerazione(h) {
    await this.init();
    return this.state.generazioni[h] || null;
  }

  /**
   * Verifica se generazione H ha completato tutti i doni
   */
  async isGenerazioneCompletata(h) {
    await this.init();

    const gen = this.state.generazioni[h];
    if (!gen) return false;

    return gen.riceventiCompletati >= gen.totaleRiceventi;
  }

  // ========================================
  // CASCATA DISTRIBUZIONE
  // ========================================

  /**
   * Ottiene prossima cascata da distribuire
   * 
   * Logica:
   * 1. Se H corrente non completata, continua con essa
   * 2. Se completata, passa a H-2 (ciclo successivo)
   * 3. Se tutti completati fino a H2, apri nuova generazione
   * 
   * @returns {Object|null} {h, ciclo, riceventiPendenti}
   */
  async getProssimaCascata() {
    await this.init();

    // Verifica se cascata corrente è completata
    if (this.state.cascataCorrente) {
      const h = this.state.cascataCorrente.h;
      const completata = await this.isGenerazioneCompletata(h);

      if (!completata) {
        console.log(`   Cascata H${h} ancora in corso...`);
        return this.state.cascataCorrente;
      }

      // Cascata completata, segna come tale
      console.log(`\\n✅ CASCATA H${h} C${this.state.cascataCorrente.ciclo} COMPLETATA`);
      this.state.cascataCorrente.completata = true;
      this.state.ultimaGenerazioneCompletata = h;
    }

    // Determina prossima cascata
    const prossima = await this.determinaProssimaCascata();

    if (!prossima) {
      console.log(`\\n⏸️  Nessuna cascata disponibile - Sistema in attesa`);
      this.state.statoSistema = 'IN_ATTESA';
      await this.saveState();
      return null;
    }

    // Inizia nuova cascata
    this.state.cascataCorrente = {
      h: prossima.h,
      ciclo: prossima.ciclo,
      iniziata: new Date().toISOString(),
      completata: false
    };

    this.state.hCorrente = prossima.h;
    this.state.cicloCorrente = prossima.ciclo;
    this.state.statoSistema = 'IN_DISTRIBUZIONE';

    await this.saveState();

    console.log(`\\n🌊 NUOVA CASCATA INIZIATA`);
    console.log(`   H: ${prossima.h}`);
    console.log(`   Ciclo: ${prossima.ciclo}`);
    console.log(`   Riceventi: ${prossima.riceventiPendenti}`);

    return this.state.cascataCorrente;
  }

  /**
   * Determina quale deve essere la prossima cascata
   * 
   * @returns {Object|null} {h, ciclo, riceventiPendenti}
   */
  async determinaProssimaCascata() {
    // Ordine cascata: H più alto disponibile con doni pendenti

    // Prima: controlla doni mancanti (H8, H6, H4 da file)
    const doniMancanti = await this.getDoniMancanti();
    if (doniMancanti.length > 0) {
      // Trova H più alta con doni mancanti
      const hMancanti = doniMancanti.map(d => d.h).sort((a, b) => b - a);
      const hMax = hMancanti[0];

      return {
        h: hMax,
        ciclo: this.calcolaCicloDaRicevere(hMax),
        riceventiPendenti: doniMancanti.filter(d => d.h === hMax).length
      };
    }

    // Poi: cerca generazioni con stato APERTA
    const generazioniAperte = Object.values(this.state.generazioni)
      .filter(g => g.stato === 'APERTA' && g.riceventiCompletati < g.totaleRiceventi)
      .sort((a, b) => b.h - a.h); // Ordina per H decrescente

    if (generazioniAperte.length > 0) {
      const gen = generazioniAperte[0];
      return {
        h: gen.h,
        ciclo: gen.cicloDaRicevere,
        riceventiPendenti: gen.totaleRiceventi - gen.riceventiCompletati
      };
    }

    // Se tutte completate, verifica se aprire nuova generazione
    if (await this.puoAprireNuovaGenerazione()) {
      const nuovoH = this.state.ultimaGenerazioneAperta + 1;
      console.log(`\\n🆕 Aprendo nuova generazione H${nuovoH}...`);
      this.state.statoSistema = 'APERTURA_NUOVA_GENERAZIONE';
      await this.saveState();

      return {
        h: nuovoH,
        ciclo: this.calcolaCicloDaRicevere(nuovoH),
        riceventiPendenti: 0, // Sarà popolato quando registrata
        nuovaGenerazione: true
      };
    }

    return null;
  }

  /**
   * Verifica se può aprire nuova generazione
   * 
   * Condizione: Tutte le generazioni fino a H2 devono essere completate
   */
  async puoAprireNuovaGenerazione() {
    // Verifica che H2, H4, H6, H8, H10, ... siano tutte completate
    const hMinima = 2;
    const ultimaAperta = this.state.ultimaGenerazioneAperta;

    for (let h = ultimaAperta; h >= hMinima; h -= 2) {
      const gen = this.state.generazioni[h];
      if (!gen) continue;

      if (!await this.isGenerazioneCompletata(h)) {
        console.log(`   ⏸️  Generazione H${h} non ancora completata`);
        return false;
      }
    }

    console.log(`   ✅ Tutte generazioni completate - Pronta per apertura H${ultimaAperta + 1}`);
    return true;
  }

  // ========================================
  // DISTRIBUZIONE SINGOLA
  // ========================================

  /**
   * Registra distribuzione effettuata per un ricevente
   * 
   * @param {number} h - Generazione H
   * @param {string} wallet - Wallet ricevente
   * @param {number} importo - Importo distribuito
   */
  async registraDistribuzione(h, wallet, importo) {
    await this.init();

    const gen = this.state.generazioni[h];
    if (!gen) {
      throw new Error(`Generazione H${h} non trovata`);
    }

    const walletNorm = wallet.toLowerCase();
    const ricevente = gen.riceventi.find(r => r.wallet === walletNorm);

    if (!ricevente) {
      throw new Error(`Ricevente ${wallet} non trovato in H${h}`);
    }

    ricevente.statoDono = 'DISTRIBUITO';
    ricevente.importoRicevuto = importo;
    ricevente.dataDistribuzione = new Date().toISOString();

    gen.riceventiCompletati++;

    // Verifica se generazione completata
    if (gen.riceventiCompletati >= gen.totaleRiceventi) {
      gen.stato = 'COMPLETATA';
      gen.dataCompletamento = new Date().toISOString();
      console.log(`\\n🎉 GENERAZIONE H${h} COMPLETATA!`);
    }

    await this.saveState();

    console.log(`✅ Distribuzione registrata: H${h} ${wallet.substring(0, 10)}... → ${importo}€`);
    console.log(`   Completati: ${gen.riceventiCompletati}/${gen.totaleRiceventi}`);

    return {
      ricevente,
      generazioneCompletata: gen.stato === 'COMPLETATA'
    };
  }

  // ========================================
  // DONI MANCANTI (PUNTO 58)
  // ========================================

  /**
   * Carica doni mancanti da file txt
   */
  async caricaDoniMancanti() {
    try {
      const content = await fs.readFile(DONI_MANCANTI_FILE, 'utf8');
      const lines = content.split('\\n');

      const doni = [];
      let hCorrente = null;
      let cicloCorrente = null;

      for (const line of lines) {
        const trimmed = line.trim();

        // Identifica sezione H
        if (trimmed.startsWith('H')) {
          const match = trimmed.match(/H(\\d+):/);
          if (match) {
            hCorrente = parseInt(match[1]);

            // Estrai importo ciclo
            if (trimmed.includes('400€')) cicloCorrente = 2;
            else if (trimmed.includes('800€')) cicloCorrente = 3;
            else if (trimmed.includes('1.600€')) cicloCorrente = 4;
          }
          continue;
        }

        // Salta righe vuote e intestazioni
        if (!trimmed || trimmed.includes('ELENCO') || trimmed.includes('le seguenti')) {
          continue;
        }

        // Parse posizione utente (formato: "posizione\\tNome\\twallet")
        const parts = trimmed.split('\\t').filter(p => p);
        if (parts.length >= 3 && hCorrente && cicloCorrente) {
          const posizione = parseInt(parts[0]);
          const nome = parts[1];
          const wallet = parts[2];

          if (!isNaN(posizione) && wallet.startsWith('0x')) {
            doni.push({
              h: hCorrente,
              ciclo: cicloCorrente,
              posizione,
              nome,
              wallet: wallet.toLowerCase()
            });
          }
        }
      }

      this.state.doniMancanti = doni;
      await this.saveState();

      console.log(`\\n📋 DONI MANCANTI CARICATI`);
      console.log(`   H8: ${doni.filter(d => d.h === 8).length} riceventi`);
      console.log(`   H6: ${doni.filter(d => d.h === 6).length} riceventi`);
      console.log(`   H4: ${doni.filter(d => d.h === 4).length} riceventi`);

      return doni;

    } catch (error) {
      console.warn(`⚠️  Impossibile caricare doni_mancanti.txt:`, error.message);
      return [];
    }
  }

  /**
   * Ottiene doni mancanti
   */
  async getDoniMancanti() {
    await this.init();

    if (this.state.doniMancanti.length === 0) {
      await this.caricaDoniMancanti();
    }

    return this.state.doniMancanti.filter(d => d.statoDono !== 'DISTRIBUITO');
  }

  /**
   * Marca dono mancante come distribuito
   */
  async marcaDonMancanteDistribuito(h, wallet) {
    const walletNorm = wallet.toLowerCase();
    const dono = this.state.doniMancanti.find(
      d => d.h === h && d.wallet === walletNorm
    );

    if (dono) {
      dono.statoDono = 'DISTRIBUITO';
      dono.dataDistribuzione = new Date().toISOString();
      await this.saveState();
    }
  }

  // ========================================
  // UTILITY
  // ========================================

  /**
   * Ottiene stato cascata
   */
  async getStatoCascata() {
    await this.init();

    return {
      hCorrente: this.state.hCorrente,
      cicloCorrente: this.state.cicloCorrente,
      statoSistema: this.state.statoSistema,
      ultimaGenerazioneAperta: this.state.ultimaGenerazioneAperta,
      ultimaGenerazioneCompletata: this.state.ultimaGenerazioneCompletata,
      cascataCorrente: this.state.cascataCorrente,
      doniMancantiPendenti: this.state.doniMancanti.filter(d => !d.statoDono || d.statoDono === 'PENDENTE').length
    };
  }

  /**
   * Ottiene statistiche complete
   */
  async getStatistiche() {
    await this.init();

    const generazioniArray = Object.values(this.state.generazioni);

    return {
      totaleGenerazioni: generazioniArray.length,
      generazioniCompletate: generazioniArray.filter(g => g.stato === 'COMPLETATA').length,
      generazioniAperte: generazioniArray.filter(g => g.stato === 'APERTA').length,
      totaleDistribuzioni: generazioniArray.reduce((sum, g) => sum + g.riceventiCompletati, 0),
      distribuzioniPendenti: generazioniArray.reduce((sum, g) => sum + (g.totaleRiceventi - g.riceventiCompletati), 0),
      doniMancanti: this.state.doniMancanti.filter(d => !d.statoDono || d.statoDono === 'PENDENTE').length
    };
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

const cascataManager = new CascataManager();

module.exports = cascataManager;
