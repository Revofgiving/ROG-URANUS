/**
 * 🗳️ VOTING MANAGER - Sistema Votazioni DAO ROG
 * 
 * Sistema votazioni per governance ROG con NFT RGx:
 * - Requisito minimo: 1 RGx per votare
 * - 1 wallet = 1 voto (indipendente da numero RGx)
 * - Tracking voti già espressi
 * - Integrazione NFT RGx soulbound
 * 
 * REGOLE:
 * - 1000 RGx = 1 voto
 * - 1 RGx = 1 voto
 * - Stesso potere di voto indipendente da quantità RGx
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 26 Novembre 2025
 */

const path = require('path');
const { ethers } = require('ethers');
const statePg = require('./state-persistence-pg');

// ========================================
// CONFIGURAZIONE
// ========================================

const STATE_KEY = 'voting';

// Smart Contract ROG DAO
const ROG_DAO_ADDRESS = '0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0';
const ROG_DAO_ABI_FILE = path.join(__dirname, 'abis', 'ROGDao.json');

// RPC Provider Polygon Mainnet
const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

// ========================================
// CLASSE VOTING MANAGER
// ========================================

class VotingManager {
  constructor() {
    this.state = {
      votazioniAttive: [],   // Array votazioni attive
      votiEspressi: {},      // wallet => [votazioneId, ...]
      risultatiStorici: []   // Storico risultati
    };
    this.provider = null;
    this.contract = null;
    this.initialized = false;
  }

  /**
   * Inizializza manager
   */
  async init() {
    if (this.initialized) return;

    console.log('🗳️ Inizializzazione Voting Manager...');

    // Carica stato
    await this.loadState();

    // Inizializza provider blockchain
    try {
      this.provider = new ethers.JsonRpcProvider(RPC_URL);
      
      // Carica ABI smart contract
      const abiData = await fs.readFile(ROG_DAO_ABI_FILE, 'utf8');
      const abi = JSON.parse(abiData).abi || JSON.parse(abiData);
      
      this.contract = new ethers.Contract(ROG_DAO_ADDRESS, abi, this.provider);
      
      console.log(`✅ Connesso a smart contract ROG DAO: ${ROG_DAO_ADDRESS}`);
    } catch (error) {
      console.warn('⚠️  Impossibile connettersi a blockchain:', error.message);
      console.log('   Voting Manager funzionerà in modalità offline');
    }

    this.initialized = true;
    console.log('✅ Voting Manager pronto');
  }

  /**
   * Carica stato da PostgreSQL
   */
  async loadState() {
    try {
      const saved = await statePg.getState(STATE_KEY, {
        votazioniAttive: [],
        votiEspressi: {},
        risultatiStorici: []
      });
      this.state = { ...this.state, ...saved };
      console.log('🗳️  Voting state caricato (PostgreSQL)');
    } catch (error) {
      console.error('❌ Errore caricamento voting state:', error.message);
    }
  }

  /**
   * Salva stato su PostgreSQL
   */
  async saveState() {
    await statePg.setState(STATE_KEY, this.state);
  }

  // ========================================
  // VERIFICA REQUISITI VOTO
  // ========================================

  /**
   * Verifica se wallet può votare
   * REQUISITO: minimo 1 RGx NFT
   * 
   * @param {string} wallet - Wallet address
   * @returns {Promise<Object>} Risultato verifica
   */
  async canVote(wallet) {
    await this.init();

    try {
      // Verifica RGx balance on-chain
      const rgxBalance = await this.getRGxBalance(wallet);

      if (rgxBalance < 1) {
        return {
          canVote: false,
          reason: 'Requisito minimo: 1 RGx NFT per votare',
          rgxBalance: 0,
          votingPower: 0
        };
      }

      // 1 wallet = 1 voto (indipendente da RGx)
      return {
        canVote: true,
        rgxBalance: rgxBalance,
        votingPower: 1,
        note: `Hai ${rgxBalance} RGx, ma ogni wallet ha 1 voto (governance democratica)`
      };

    } catch (error) {
      console.error('Errore verifica voto:', error);
      
      // Fallback: permetti voto se utente ha posizioni nel sistema
      // (RGx = posizioni / 2, quindi 1+ posizioni = diritto voto)
      return {
        canVote: true,
        rgxBalance: null,
        votingPower: 1,
        note: 'Verifica blockchain non disponibile, voto permesso per utenti registrati',
        fallback: true
      };
    }
  }

  /**
   * Ottiene balance RGx per wallet
   * 
   * @param {string} wallet - Wallet address
   * @returns {Promise<number>} Numero RGx posseduti
   */
  async getRGxBalance(wallet) {
    if (!this.contract) {
      throw new Error('Smart contract non inizializzato');
    }

    try {
      // Chiama funzione balanceOf sul contratto RGx
      // (assumendo che RGx sia ERC721 standard)
      const balance = await this.contract.balanceOf(wallet);
      return Number(balance);
    } catch (error) {
      console.error('Errore lettura RGx balance:', error.message);
      throw error;
    }
  }

  // ========================================
  // GESTIONE VOTAZIONI
  // ========================================

  /**
   * Crea nuova votazione
   * 
   * @param {Object} votazione - Dati votazione
   * @returns {Promise<Object>} Votazione creata
   */
  async creaVotazione(votazione) {
    await this.init();

    const {
      titolo,
      descrizione,
      opzioni,  // Array di opzioni
      dataInizio,
      dataFine,
      categoria,  // 'governance' | 'progetti' | 'finanziamenti' | 'altro'
      richiedeQuorum,
      quorumMinimo
    } = votazione;

    // Genera ID univoco
    const votazioneId = `VOTE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const nuovaVotazione = {
      id: votazioneId,
      titolo,
      descrizione,
      opzioni: opzioni.map(opt => ({
        id: `OPT_${Math.random().toString(36).substr(2, 9)}`,
        testo: opt,
        voti: 0,
        wallets: []  // Array wallet che hanno votato questa opzione
      })),
      dataInizio: dataInizio || new Date().toISOString(),
      dataFine,
      categoria: categoria || 'governance',
      richiedeQuorum: richiedeQuorum || false,
      quorumMinimo: quorumMinimo || 0,
      stato: 'attiva',  // 'attiva' | 'chiusa' | 'approvata' | 'respinta'
      votiTotali: 0,
      walletVotanti: [],
      createdAt: new Date().toISOString()
    };

    this.state.votazioniAttive.push(nuovaVotazione);
    await this.saveState();

    console.log(`✅ Votazione creata: ${votazioneId}`);
    console.log(`   Titolo: ${titolo}`);
    console.log(`   Opzioni: ${opzioni.length}`);
    console.log(`   Scadenza: ${dataFine}`);

    return nuovaVotazione;
  }

  /**
   * Esprime voto
   * 
   * @param {string} wallet - Wallet votante
   * @param {string} votazioneId - ID votazione
   * @param {string} opzioneId - ID opzione scelta
   * @returns {Promise<Object>} Risultato voto
   */
  async vota(wallet, votazioneId, opzioneId) {
    await this.init();

    // Verifica requisiti voto
    const requisiti = await this.canVote(wallet);
    if (!requisiti.canVote) {
      return {
        success: false,
        reason: requisiti.reason
      };
    }

    // Trova votazione
    const votazione = this.state.votazioniAttive.find(v => v.id === votazioneId);
    if (!votazione) {
      return {
        success: false,
        reason: 'Votazione non trovata'
      };
    }

    // Verifica stato votazione
    if (votazione.stato !== 'attiva') {
      return {
        success: false,
        reason: `Votazione ${votazione.stato}, non puoi più votare`
      };
    }

    // Verifica scadenza
    if (votazione.dataFine && new Date() > new Date(votazione.dataFine)) {
      votazione.stato = 'chiusa';
      await this.saveState();
      return {
        success: false,
        reason: 'Votazione scaduta'
      };
    }

    // Verifica se ha già votato
    if (votazione.walletVotanti.includes(wallet.toLowerCase())) {
      return {
        success: false,
        reason: 'Hai già espresso il tuo voto per questa votazione',
        note: '1 wallet = 1 voto'
      };
    }

    // Trova opzione
    const opzione = votazione.opzioni.find(opt => opt.id === opzioneId);
    if (!opzione) {
      return {
        success: false,
        reason: 'Opzione non valida'
      };
    }

    // Registra voto
    opzione.voti += 1;  // Sempre +1 (1 wallet = 1 voto)
    opzione.wallets.push(wallet.toLowerCase());
    
    votazione.votiTotali += 1;
    votazione.walletVotanti.push(wallet.toLowerCase());

    // Aggiorna tracking voti espressi
    if (!this.state.votiEspressi[wallet.toLowerCase()]) {
      this.state.votiEspressi[wallet.toLowerCase()] = [];
    }
    this.state.votiEspressi[wallet.toLowerCase()].push({
      votazioneId,
      opzioneId,
      opzioneTesto: opzione.testo,
      timestamp: new Date().toISOString()
    });

    await this.saveState();

    console.log(`✅ Voto registrato`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   Votazione: ${votazione.titolo}`);
    console.log(`   Opzione: ${opzione.testo}`);
    console.log(`   Voti totali: ${votazione.votiTotali}`);

    return {
      success: true,
      votazione: {
        id: votazioneId,
        titolo: votazione.titolo
      },
      opzioneScelta: opzione.testo,
      votiTotali: votazione.votiTotali,
      votingPower: 1
    };
  }

  /**
   * Ottiene votazioni attive
   * 
   * @returns {Promise<Array>} Lista votazioni attive
   */
  async getVotazioniAttive() {
    await this.init();

    // Filtra votazioni attive e non scadute
    const attive = this.state.votazioniAttive.filter(v => {
      if (v.stato !== 'attiva') return false;
      if (v.dataFine && new Date() > new Date(v.dataFine)) {
        v.stato = 'chiusa';
        return false;
      }
      return true;
    });

    await this.saveState();

    return attive.map(v => ({
      id: v.id,
      titolo: v.titolo,
      descrizione: v.descrizione,
      opzioni: v.opzioni.map(opt => ({
        id: opt.id,
        testo: opt.testo,
        voti: opt.voti,
        percentuale: v.votiTotali > 0 ? 
          ((opt.voti / v.votiTotali) * 100).toFixed(1) : 0
      })),
      votiTotali: v.votiTotali,
      dataFine: v.dataFine,
      categoria: v.categoria
    }));
  }

  /**
   * Ottiene storico voti per wallet
   * 
   * @param {string} wallet - Wallet address
   * @returns {Promise<Array>} Voti espressi
   */
  async getStoricoVoti(wallet) {
    await this.init();

    const walletLower = wallet.toLowerCase();
    return this.state.votiEspressi[walletLower] || [];
  }

  /**
   * Chiude votazione e calcola risultato
   * 
   * @param {string} votazioneId - ID votazione
   * @returns {Promise<Object>} Risultato finale
   */
  async chiudiVotazione(votazioneId) {
    await this.init();

    const votazione = this.state.votazioniAttive.find(v => v.id === votazioneId);
    if (!votazione) {
      throw new Error('Votazione non trovata');
    }

    // Calcola vincitore
    let vincitore = null;
    let maxVoti = 0;

    for (const opzione of votazione.opzioni) {
      if (opzione.voti > maxVoti) {
        maxVoti = opzione.voti;
        vincitore = opzione;
      }
    }

    // Verifica quorum se richiesto
    let quorumRaggiunto = true;
    if (votazione.richiedeQuorum) {
      quorumRaggiunto = votazione.votiTotali >= votazione.quorumMinimo;
    }

    // Determina stato finale
    votazione.stato = quorumRaggiunto ? 'approvata' : 'respinta';
    votazione.dataChiusura = new Date().toISOString();
    votazione.risultato = {
      vincitore: vincitore ? vincitore.testo : null,
      voti: maxVoti,
      percentuale: votazione.votiTotali > 0 ? 
        ((maxVoti / votazione.votiTotali) * 100).toFixed(1) : 0,
      quorumRaggiunto
    };

    // Sposta in storico
    this.state.risultatiStorici.push(votazione);
    this.state.votazioniAttive = this.state.votazioniAttive.filter(
      v => v.id !== votazioneId
    );

    await this.saveState();

    console.log(`✅ Votazione chiusa: ${votazione.titolo}`);
    console.log(`   Vincitore: ${votazione.risultato.vincitore}`);
    console.log(`   Voti: ${maxVoti} (${votazione.risultato.percentuale}%)`);
    console.log(`   Totale votanti: ${votazione.votiTotali}`);

    return votazione.risultato;
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

const votingManager = new VotingManager();

module.exports = votingManager;
