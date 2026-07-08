/**
 * 🔗 ROG REFERRAL MANAGER - Sistema Inviti e Referral Links
 * 
 * Gestisce:
 * - Caricamento invitati da PostgreSQL (tabella anagrafica_invitati)
 * - Conteggio invitati per wallet
 * - Generazione referral links
 * - Tracking relazioni invitante → invitato
 * 
 * FONTE: PostgreSQL (tabella anagrafica_invitati) - UNICA fonte di verità
 * 
 * @author Warp AI Agent
 * @version 2.0.0 - PostgreSQL Migration
 */

const fs = require('fs').promises;
const path = require('path');

// PostgreSQL è l'unica fonte di verità per gli invitati (tabella anagrafica_invitati)
const dbPg = require('./db-unified-manager-pg');
const pg = require('./pg-connection-manager');

// ========================================
// CONFIGURAZIONE
// ========================================

const REFERRAL_DATA_FILE = path.join(__dirname, 'data', 'referral-state.json');
const INVITI_ENABLED = false; // URANUS non usa inviti

// ========================================
// CLASSE PRINCIPALE
// ========================================

class ReferralManager {
  constructor() {
    this.anagraficaInvitati = [];
    this.referralState = {
      links: {},          // wallet → referralCode
      invitatiPerWallet: {}, // wallet → count
      relazioniInviti: []    // Array di { invitato, invitante, dataInvito }
    };
    this.initialized = false;
  }

  /**
   * Inizializza il manager
   */
  async init() {
    if (this.initialized) return;

    console.log('🔗 Inizializzazione Referral Manager...');
    if (!INVITI_ENABLED) {
      this.anagraficaInvitati = [];
      this.referralState.invitatiPerWallet = {};
      this.referralState.invitatiSelfPerWallet = {};
      this.initialized = true;
      console.log('ℹ️  Referral Manager disabilitato (URANUS non usa inviti)');
      return;
    }

    // Carica invitati da PostgreSQL (unica fonte di verità)
    await this.loadInvitatiFromPostgres();

    // Carica o crea referral state (per links e relazioni runtime)
    await this.loadReferralState();

    this.initialized = true;
    console.log('✅ Referral Manager pronto');
  }

  /**
   * OTTIMIZZAZIONE: NON carichiamo più tutta la tabella in memoria!
   * Facciamo query dirette per wallet quando serve.
   * Questo metodo ora carica solo i CONTEGGI aggregati (leggeri).
   */
  async loadInvitatiFromPostgres() {
    if (!INVITI_ENABLED) {
      this.anagraficaInvitati = [];
      this.referralState.invitatiPerWallet = {};
      this.referralState.invitatiSelfPerWallet = {};
      return;
    }
    try {
      const pool = pg.getPool();
      
      // OTTIMIZZAZIONE: Carica SOLO i conteggi aggregati, NON tutte le righe!
      // Query aggregata molto più veloce di SELECT *
      const countResult = await pool.query(`
        SELECT 
          invitante_wallet,
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE invitante_wallet = invitato_wallet) as self_count
        FROM anagrafica_invitati
        WHERE invitante_wallet IS NOT NULL
        GROUP BY invitante_wallet
      `);
      
      const invitatiMap = {};
      const invitatiSelfMap = {};
      
      for (const row of countResult.rows) {
        const wallet = (row.invitante_wallet || '').toLowerCase();
        if (!wallet) continue;
        invitatiMap[wallet] = parseInt(row.total_count) || 0;
        invitatiSelfMap[wallet] = parseInt(row.self_count) || 0;
      }
      
      this.referralState.invitatiPerWallet = invitatiMap;
      this.referralState.invitatiSelfPerWallet = invitatiSelfMap;
      
      // NON carichiamo più this.anagraficaInvitati - useremo query dirette
      this.anagraficaInvitati = []; // Manteniamo vuoto, query dirette per wallet
      
      const totalInvitanti = Object.keys(invitatiMap).length;
      const totalSelf = Object.values(invitatiSelfMap).reduce((a,b) => a+b, 0);
      console.log(`✅ CONTEGGI invitati caricati: ${totalInvitanti} invitanti unici, ${totalSelf} auto-inviti`);
      
    } catch (error) {
      console.error('❌ Errore caricamento conteggi invitati:', error.message);
      this.anagraficaInvitati = [];
      this.referralState.invitatiPerWallet = {};
      this.referralState.invitatiSelfPerWallet = {};
    }
  }

  /**
   * Carica referral state da file
   * 
   * IMPORTANTE: I conteggi invitati vengono SEMPRE da PostgreSQL.
   * Il file JSON viene usato SOLO per links e relazioni runtime.
   */
  async loadReferralState() {
    try {
      const data = await fs.readFile(REFERRAL_DATA_FILE, 'utf8');
      const loaded = JSON.parse(data);
      
      // SOLO links e relazioniInviti vengono ripristinati dal JSON
      // invitatiPerWallet viene SEMPRE da PostgreSQL (caricato in loadInvitatiFromPostgres)
      this.referralState.links = loaded.links || {};
      this.referralState.relazioniInviti = loaded.relazioniInviti || [];

      // NON sovrascrivere invitatiPerWallet dal file JSON!
      // PostgreSQL è l'UNICA fonte di verità per i conteggi
      // I dati sono già stati caricati da loadInvitatiFromPostgres()

      console.log(`✅ Referral state caricato (links e relazioni da file, conteggi da PostgreSQL)`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📝 Creazione nuovo referral state');
        await this.saveReferralState();
      } else {
        throw error;
      }
    }
  }

  /**
   * Salva referral state su file
   */
  async saveReferralState() {
    await fs.mkdir(path.dirname(REFERRAL_DATA_FILE), { recursive: true });
    await fs.writeFile(
      REFERRAL_DATA_FILE,
      JSON.stringify(this.referralState, null, 2),
      'utf8'
    );
  }

  /**
   * Conta invitati per un wallet
   * 
   * FONTE UNICA: PostgreSQL (tabella anagrafica_invitati)
   * 
   * Gli invitati includono:
   * - Persone invitate direttamente dall'utente
   * - Auto-inviti (rientri) già registrati dalla funzione scriviInvitiPerPosizioni
   * 
   * NON calcolare auto-inviti separatamente perché sono già in PostgreSQL!
   * 
   * @param {string} wallet - Wallet da verificare
   * @returns {number} Numero di invitati (SOLO da PostgreSQL)
   */
  async contaInvitati(wallet) {
    await this.init();
    if (!INVITI_ENABLED) return 0;

    const walletNormalized = wallet.toLowerCase();
    
    // FONTE UNICA: PostgreSQL anagrafica_invitati
    // Gli auto-inviti (rientri) sono GIÀ scritti in questa tabella
    // dalla funzione scriviInvitiPerPosizioni() in position-creator.js
    const invitatiDaPostgres = this.referralState.invitatiPerWallet[walletNormalized] || 0;
    
    return invitatiDaPostgres;
  }

  /**
   * Restituisce la lista degli invitati collegati a un wallet.
   * OTTIMIZZAZIONE: Query SQL diretta con PAGINAZIONE per scalabilità 10M+
   *
   * @param {string} wallet - Wallet dell'invitante
   * @param {Object} options - Opzioni di filtraggio e paginazione
   * @param {boolean} options.onlySelf - Se true, restituisce solo auto-inviti (SELF)
   * @param {number} options.limit - Max risultati (default 100, max 1000)
   * @param {number} options.offset - Offset per paginazione (default 0)
   * @returns {Array<{posizione:number,nome:string,wallet:string,movimento:string,dataInvito:string|null}>}
   */
  async getInvitati(wallet, options = {}) {
    await this.init();
    if (!INVITI_ENABLED) return [];

    const walletNorm = wallet.toLowerCase();
    const { onlySelf = false } = options;
    
    // PAGINAZIONE: limita risultati per performance con milioni di utenti
    const limit = Math.min(Math.max(1, options.limit || 100), 1000);
    const offset = Math.max(0, options.offset || 0);

    try {
      const pool = pg.getPool();
      
      // QUERY SQL DIRETTA con LIMIT/OFFSET per scalabilità
      let query;
      let params;
      
      if (onlySelf) {
        // Solo auto-inviti (SELF): invitante == invitato
        query = `
          SELECT 
            ai.invitato_pos as posizione,
            wp.movimento,
            wm.nome,
            wp.wallet
          FROM anagrafica_invitati ai
          LEFT JOIN wallet_positions wp ON wp.posizione = ai.invitato_pos
          LEFT JOIN wallet_master wm ON wm.wallet = wp.wallet
          WHERE ai.invitante_wallet = $1 
            AND ai.invitante_wallet = ai.invitato_wallet
          ORDER BY ai.invitato_pos ASC
          LIMIT $2 OFFSET $3
        `;
        params = [walletNorm, limit, offset];
      } else {
        // Tutti gli invitati
        query = `
          SELECT 
            ai.invitato_pos as posizione,
            wp.movimento,
            wm.nome,
            wp.wallet
          FROM anagrafica_invitati ai
          LEFT JOIN wallet_positions wp ON wp.posizione = ai.invitato_pos
          LEFT JOIN wallet_master wm ON wm.wallet = wp.wallet
          WHERE ai.invitante_wallet = $1
          ORDER BY ai.invitato_pos ASC
          LIMIT $2 OFFSET $3
        `;
        params = [walletNorm, limit, offset];
      }
      
      const result = await pool.query(query, params);
      
      // Mappa direttamente i risultati
      return result.rows.map(row => ({
        posizione: row.posizione,
        nome: row.nome || null,
        wallet: row.wallet || null,
        movimento: row.movimento || 'SMALL',
        dataInvito: null,
      }));
      
    } catch (err) {
      console.error('❌ Errore getInvitati SQL:', err.message);
      return [];
    }
  }

  /**
   * Ottiene invitante diretto per un wallet
   * OTTIMIZZAZIONE: Query SQL diretta!
   * 
   * @param {string} walletInvitato - Wallet invitato
   * @returns {Object|null} { wallet, nome } dell'invitante o null
   */
  async getInvitanteDiretto(walletInvitato) {
    await this.init();
    if (!INVITI_ENABLED) return null;

    const walletInvitatoNorm = walletInvitato.toLowerCase();

    // 1) Se abbiamo una relazione esplicita salvata, è la più affidabile.
    const relazione = (this.referralState.relazioniInviti || []).find(
      (r) => (r.walletInvitato || '').toLowerCase() === walletInvitatoNorm
    );

    if (relazione) {
      return {
        wallet: relazione.walletInvitante,
        nome: relazione.nomeInvitante || 'Sconosciuto',
      };
    }

    // 2) QUERY SQL DIRETTA: cerca l'invitante dalla prima posizione dell'utente
    try {
      const pool = pg.getPool();
      
      // Trova l'invitante per la prima posizione di questo wallet
      const result = await pool.query(`
        SELECT 
          ai.invitante_wallet,
          wm.nome as nome_invitante
        FROM wallet_positions wp
        JOIN anagrafica_invitati ai ON ai.invitato_pos = wp.posizione
        LEFT JOIN wallet_master wm ON wm.wallet = ai.invitante_wallet
        WHERE wp.wallet = $1
        ORDER BY wp.posizione ASC
        LIMIT 1
      `, [walletInvitatoNorm]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return {
        wallet: result.rows[0].invitante_wallet,
        nome: result.rows[0].nome_invitante || 'Sconosciuto',
      };
      
    } catch (err) {
      console.error('⚠️ Errore getInvitanteDiretto SQL:', err.message);
      return null;
    }
  }

  /**
   * Genera referral link per un wallet
   * 
   * @param {string} wallet - Wallet utente
   * @returns {string} Referral link
   */
  async generaReferralLink(wallet) {
    await this.init();
    if (!INVITI_ENABLED) {
      const walletNormalized = wallet.toLowerCase();
      const BASE_URL = process.env.BASE_URL || 'https://revolutionofgiving.com';
      return `${BASE_URL}/referral.html?refWallet=${walletNormalized}`;
    }

    const walletNormalized = wallet.toLowerCase();

    // Link referral DETERMINISTICO nel formato accettato dal tracker
    // (?refWallet=<wallet completo> verso referral.html). Dominio configurabile via BASE_URL.
    const BASE_URL = process.env.BASE_URL || 'https://revolutionofgiving.com';
    const referralLink = `${BASE_URL}/referral.html?refWallet=${walletNormalized}`;

    // Aggiorna sempre la cache (sovrascrive eventuali link in formato vecchio)
    if (this.referralState.links[walletNormalized] !== referralLink) {
      this.referralState.links[walletNormalized] = referralLink;
      await this.saveReferralState();
    }

    return referralLink;
  }

  /**
   * Registra nuovo invito
   * 
   * NOTA: Questa funzione salva solo la relazione nel file JSON per tracciamento.
   * Il conteggio effettivo viene SEMPRE da PostgreSQL (tabella anagrafica_invitati).
   * L'invito vero e proprio deve essere scritto con scriviInvitiPerPosizioni().
   * 
   * @param {Object} params - Parametri invito
   * @param {string} params.walletInvitato - Wallet nuovo utente
   * @param {string} params.walletInvitante - Wallet invitante
   * @param {string} params.nomeInvitante - Nome invitante
   */
  async registraInvito(params, options = {}) {
    await this.init();
    if (!INVITI_ENABLED) {
      return;
    }

    const { skipReload = false } = options;
    const { walletInvitato, walletInvitante, nomeInvitante } = params;

    const walletInvitatoNorm = walletInvitato.toLowerCase();
    const walletInvitanteNorm = walletInvitante.toLowerCase();

    // Aggiungi a relazioni (solo per tracciamento runtime, NON per conteggi)
    this.referralState.relazioniInviti.push({
      walletInvitato: walletInvitatoNorm,
      walletInvitante: walletInvitanteNorm,
      nomeInvitante,
      dataInvito: new Date().toISOString()
    });

    // In modalità batch (skipReload) il chiamante esegue UN solo reload()+save
    // alla fine, evitando ricariche PostgreSQL ripetute dentro un loop.
    if (skipReload) {
      return;
    }

    // NON aggiornare conteggio locale!
    // I conteggi vengono SEMPRE da PostgreSQL (anagrafica_invitati)
    // Ricarica da PostgreSQL per avere dati aggiornati
    await this.loadInvitatiFromPostgres();

    await this.saveReferralState();

    const conteggio = this.referralState.invitatiPerWallet[walletInvitanteNorm] || 0;
    console.log(`✅ Invito registrato: ${walletInvitante} → ${walletInvitato}`);
    console.log(`   Totale invitati di ${walletInvitante} (da PostgreSQL): ${conteggio}`);
  }

  /**
   * Ottiene statistiche inviti per un wallet
   * 
   * FONTE UNICA: PostgreSQL (tabella anagrafica_invitati)
   * Il totale e il breakdown devono essere SEMPRE coerenti.
   * 
   * @param {string} wallet - Wallet da analizzare
   * @param {Object} options - Opzioni di filtraggio
   * @param {boolean} options.onlySelf - Se true, restituisce solo auto-inviti (SELF) per area personale
   * @returns {Object} Statistiche complete
   */
  async getStatisticheInviti(wallet, options = {}) {
    await this.init();
    if (!INVITI_ENABLED) {
      return {
        wallet: wallet.toLowerCase(),
        numeroInvitati: 0,
        classificazione: 'NON_INVITANTE',
        invitati: [],
        invitanteDiretto: null,
        referralLink: await this.generaReferralLink(wallet),
        invitatiLARGE: 0,
        invitatiSMALL: 0
      };
    }

    const walletNorm = wallet.toLowerCase();
    const { onlySelf = false } = options;

    // Lista invitati da PostgreSQL (UNICA fonte di verità)
    // Se onlySelf=true, filtra solo auto-inviti per area personale
    const invitati = await this.getInvitati(wallet, { onlySelf, limit: 1000 });

    // CONTEGGIO ACCURATO: usa query SQL COUNT (non la lista paginata!)
    // Questo evita che il totale sia troncato dal LIMIT della lista.
    let numeroInvitati = 0;
    let breakdown = { invitatiLARGE: 0, invitatiSMALL: 0 };

    try {
      const pool = pg.getPool();
      const selfFilter = onlySelf ? 'AND ai.invitante_wallet = ai.invitato_wallet' : '';
      const countResult = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE COALESCE(UPPER(wp.movimento), 'SMALL') = 'LARGE') AS large_count
        FROM anagrafica_invitati ai
        LEFT JOIN wallet_positions wp ON wp.posizione = ai.invitato_pos
        WHERE ai.invitante_wallet = $1 ${selfFilter}
      `, [walletNorm]);

      const row = countResult.rows[0] || {};
      const total = parseInt(row.total) || 0;
      const largeCount = parseInt(row.large_count) || 0;

      numeroInvitati = total;
      breakdown = {
        invitatiLARGE: largeCount,
        invitatiSMALL: total - largeCount
      };
    } catch (err) {
      console.error('❌ Errore COUNT invitati SQL:', err.message);
      // Fallback: conteggio dalla lista paginata (potrebbe essere troncato)
      breakdown = invitati.reduce(
        (acc, inv) => {
          const movimento = (inv.movimento || 'SMALL').toUpperCase();
          if (movimento === 'LARGE') acc.invitatiLARGE++;
          else acc.invitatiSMALL++;
          return acc;
        },
        { invitatiLARGE: 0, invitatiSMALL: 0 }
      );
      numeroInvitati = breakdown.invitatiLARGE + breakdown.invitatiSMALL;
    }

    // Invitante diretto (se disponibile)
    const invitanteDiretto = await this.getInvitanteDiretto(wallet);

    // Referral link (deterministico per wallet)
    const referralLink = await this.generaReferralLink(wallet);

    return {
      wallet: walletNorm,
      numeroInvitati,
      classificazione:
        numeroInvitati >= 2
          ? 'INVITANTE'
          : numeroInvitati === 1
          ? 'SEMI_INVITANTE'
          : 'NON_INVITANTE',
      invitati,
      invitanteDiretto,
      referralLink,
      ...breakdown,
    };
  }

  /**
   * Ricarica invitati da PostgreSQL (per aggiornamenti esterni)
   * FORCE RELOAD: resetta cache per garantire sincronizzazione immediata
   */
  async reload() {
    if (!INVITI_ENABLED) {
      this.initialized = true;
      this.anagraficaInvitati = [];
      this.referralState.invitatiPerWallet = {};
      this.referralState.invitatiSelfPerWallet = {};
      return;
    }
    console.log('🔄 Ricaricamento INVITATI da PostgreSQL (FORCE)...');
    
    // Reset inizializzazione per forzare ricarica completa
    this.initialized = false;
    
    // Ricarica da PostgreSQL
    await this.loadInvitatiFromPostgres();
    
    // Salva stato aggiornato (per links e relazioni runtime)
    await this.saveReferralState();
    
    // Segna come inizializzato di nuovo
    this.initialized = true;
    
    console.log('✅ Reload completato - cache aggiornata da PostgreSQL');
    console.log(`   Invitanti unici in cache: ${Object.keys(this.referralState.invitatiPerWallet || {}).length}`);
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

const referralManager = new ReferralManager();

module.exports = referralManager;
