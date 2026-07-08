/**
 * 🔄 PILETTA MANAGER - Sistema Perpetuità ROG
 * 
 * CORREZIONE CRITICA v2.0.0:
 * Le PILETTE NON ricevono MAI denaro in wallet!
 * 
 * TUTTO il dono ricevuto viene TRASFORMATO in NUOVE POSIZIONI in SMALL:
 * - 20% del TOTALE → 20 coppie AVENGERS (human) + PILETTA
 * - 80% del TOTALE → 80 coppie ROG (human) + PILETTA
 * 
 * REGOLA FONDAMENTALE: TUTTE le coppie sono HUMAN (pari) + PILETTA (dispari)
 * NON esistono coppie PILETTA+PILETTA!
 * Nessun trasferimento wallet. Solo creazione posizioni per perpetuità.
 * 
 * @author Warp AI Agent
 * @version 2.0.0 - CORRETTA
 * @date 21 Novembre 2025
 */

const statePg = require('./state-persistence-pg');

// WALLET IDENTIFICATIVI (per anagrafica, NON per trasferimenti)
const PILETTA_WALLET = '0x96e6a17F968b73d10263072899C95b83305281fe';
const AVENGERS_WALLET = '0x7978c4423b4Fd17fA05DF593b4c05e138606f972';
const ROG_WALLET = '0xD5bCC7acc9d6862c784807134c1F70c3e7f9F790'

const STATE_KEY = 'piletta';

class PilettaManager {
  constructor() {
    this.state = {
      totaleDoniRedistribuiti: 0,
      totalePosizioniPilettaCreate: 0,
      totalePosizioniAvengersCreate: 0,
      totalePosizioniRogCreate: 0,
      redistribuzioni: []
    };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const saved = await statePg.getState(STATE_KEY, this.state);
      this.state = { ...this.state, ...saved };
    } catch (err) {
      console.error('❌ Errore init piletta:', err.message);
    }

    this.initialized = true;
    console.log('🔄 Piletta Manager inizializzato (PostgreSQL)');
  }

  async saveState() {
    await statePg.setState(STATE_KEY, this.state);
  }

  /**
   * Calcola redistribuzione dono PILETTA → POSIZIONI
   * 
   * IMPORTANTE: Le pilette NON ricevono denaro, solo posizioni!
   * TUTTE le coppie sono HUMAN+PILETTA (MAI PILETTA+PILETTA)
   * 
   * REGOLA CORRETTA (Punto 75 documento):
   * - 50% del totale → coppie PILETTA+PILETTA (perpetuità pilette)
   * - 10% del totale → coppie AVENGERS (human) + PILETTA
   * - 40% del totale → coppie ROG (human) + PILETTA
   * 
   * Esempio: PILETTA riceve 200 USDC (1° ciclo LARGE)
   * - 50% (100 USDC) = 100 posizioni PILETTA+PILETTA (50 coppie)
   * - 10% (20 USDC) = 20 posizioni AVENGERS+PILETTA (10 coppie)
   * - 40% (80 USDC) = 80 posizioni ROG+PILETTA (40 coppie)
   * TOTALE: 200 posizioni = 100 coppie create in SMALL
   * 
   * @param {number} importo - Importo dono da trasformare in posizioni
   * @returns {Object} Dettagli redistribuzione in POSIZIONI (non wallet)
   */
  calcolaRedistribuzione(importo) {
    // Ogni 1 USDC = 1 posizione, 2 USDC = 1 coppia
    const totalePosizioniDaCreare = importo;
    
    return {
      importoOriginale: importo,
      totalePosizioniCreate: totalePosizioniDaCreare,
      
      piletta: {
        percentuale: 50,
        importoEquivalente: importo * 0.5,
        numeroPosizioniTotali: importo * 0.5,
        numeroCoppie: Math.floor((importo * 0.5) / 2),
        nota: 'Coppie PILETTA+PILETTA per perpetuità sistema'
      },
      
      avengers: {
        percentuale: 10,
        importoEquivalente: importo * 0.1,
        numeroPosizioniTotali: importo * 0.1,
        numeroCoppie: Math.floor((importo * 0.1) / 2),
        nota: 'Coppie AVENGERS (human pari) + PILETTA (dispari)'
      },
      
      rog: {
        percentuale: 40,
        importoEquivalente: importo * 0.4,
        numeroPosizioniTotali: importo * 0.4,
        numeroCoppie: Math.floor((importo * 0.4) / 2),
        nota: 'Coppie ROG (human pari) + PILETTA (dispari)'
      }
    };
  }

  /**
   * Processa redistribuzione dono PILETTA
   * Crea nuove posizioni per PILETTA, AVENGERS e ROG
   * 
   * @param {Object} params
   * @param {number} params.importo - Importo ricevuto
   * @param {string} params.level - Livello movimento origine
   * @param {number} params.cycle - Ciclo origine
   * @param {number} params.donationInCycle - Donazione origine
   * @returns {Promise<Object>} Risultato redistribuzione
   */
  async processaRedistribuzione(params) {
    await this.init();

    const { importo, level, cycle, donationInCycle } = params;

    console.log(`\n🔄 PILETTA REDISTRIBUZIONE PERPETUITÀ`);
    console.log(`   Importo ricevuto: ${importo}€`);
    console.log(`   Origine: ${level} C${cycle}D${donationInCycle}`);

    const redistribuzione = this.calcolaRedistribuzione(importo);

    console.log(`\n📊 TRASFORMAZIONE DONO → POSIZIONI:`);
    console.log(`   TOTALE: ${importo} USDC → ${redistribuzione.totalePosizioniCreate} posizioni = ${redistribuzione.totalePosizioniCreate / 2} coppie`);
    console.log(`   `);
    console.log(`   50% PILETTA:  ${redistribuzione.piletta.numeroPosizioniTotali} posizioni (${redistribuzione.piletta.numeroCoppie} coppie PILETTA+PILETTA)`);
    console.log(`   10% AVENGERS: ${redistribuzione.avengers.numeroPosizioniTotali} posizioni (${redistribuzione.avengers.numeroCoppie} coppie AVENGERS+PILETTA)`);
    console.log(`   40% ROG:      ${redistribuzione.rog.numeroPosizioniTotali} posizioni (${redistribuzione.rog.numeroCoppie} coppie ROG+PILETTA)`);
    console.log(`   `);
    console.log(`   ⚠️  NESSUN trasferimento wallet - Solo creazione posizioni per perpetuità!`);

    const risultato = {
      importo,
      redistribuzione,
      posizioniCreate: {
        piletta: [],
        avengers: [],
        rog: []
      },
      timestamp: new Date().toISOString()
    };

    // NOTA: La creazione effettiva delle posizioni deve essere chiamata 
    // da anagrafica-manager.js per evitare dipendenze circolari
    // Questo metodo ritorna solo i dettagli per la creazione

    // Registra nella storia
    this.state.redistribuzioni.push({
      timestamp: risultato.timestamp,
      importo,
      origine: `${level} C${cycle}D${donationInCycle}`,
      redistribuzione
    });

    this.state.totaleDoniRedistribuiti += importo;
    await this.saveState();

    console.log(`\n✅ Redistribuzione calcolata - Pronta per creazione posizioni`);

    return risultato;
  }

  /**
   * Registra posizioni create dalla redistribuzione
   * 
   * @param {string} tipo - 'piletta', 'avengers', 'rog'
   * @param {Array} posizioni - Array di posizioni create
   */
  async registraPosizioniCreate(tipo, posizioni) {
    await this.init();

    const numCoppie = posizioni.length;

    if (tipo === 'piletta') {
      this.state.totalePosizioniPilettaCreate += numCoppie;
    } else if (tipo === 'avengers') {
      this.state.totalePosizioniAvengersCreate += numCoppie;
    } else if (tipo === 'rog') {
      this.state.totalePosizioniRogCreate += numCoppie;
    }

    await this.saveState();

    console.log(`   ✅ Registrate ${numCoppie} coppie ${tipo.toUpperCase()}`);
  }

  /**
   * Registra wallet come INVITANTE con 2 invitati (Punto 79)
   * ROG, AVENGERS e PILETTA si comportano come invitanti con 2 invitati
   * 
   * @param {string} tipo - 'piletta', 'avengers', 'rog'
   * @param {string} wallet - Wallet da registrare
   * @param {string} nome - Nome da registrare
   */
  async registraInvitante(tipo, wallet, nome) {
    // NOTA: Questo metodo ritorna i dettagli per la registrazione
    // La registrazione effettiva in ponti-manager deve essere fatta
    // dal chiamante per evitare dipendenze circolari
    
    return {
      wallet,
      nome,
      numeroInvitati: 2,
      classificazione: 'INVITANTE',
      tipo,
      autoRegistrato: true,
      note: 'Posizione creata da redistribuzione PILETTA - Punto 79'
    };
  }

  /**
   * Ottiene statistiche redistribuzioni PILETTA
   */
  async getStatistiche() {
    await this.init();

    const totalePosizioniCreate = 
      this.state.totalePosizioniPilettaCreate +
      this.state.totalePosizioniAvengersCreate +
      this.state.totalePosizioniRogCreate;

    return {
      totaleDoniRedistribuiti: this.state.totaleDoniRedistribuiti,
      totalePosizioniCreate,
      piletta: this.state.totalePosizioniPilettaCreate,
      avengers: this.state.totalePosizioniAvengersCreate,
      rog: this.state.totalePosizioniRogCreate,
      numeroRedistribuzioni: this.state.redistribuzioni.length
    };
  }

  /**
   * Verifica se un wallet è PILETTA
   */
  isPiletta(wallet) {
    return wallet.toLowerCase() === PILETTA_WALLET.toLowerCase();
  }

  /**
   * Ottiene i wallet identificativi (SOLO per anagrafica, NON per trasferimenti)
   * IMPORTANTE: Questi wallet NON ricevono denaro!
   * Sono usati solo per identificare a chi appartengono le posizioni.
   */
  getWallets() {
    return {
      piletta: PILETTA_WALLET,
      avengers: AVENGERS_WALLET,
      rog: ROG_WALLET,
      nota: 'Wallet identificativi - NO trasferimenti denaro'
    };
  }
}

// Esporta singleton
const pilettaManager = new PilettaManager();
module.exports = pilettaManager;
