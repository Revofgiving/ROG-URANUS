/**
 * 👤 ROG AREA PERSONALE MANAGER - Sistema Completo Area Utente
 * 
 * PUNTI 69-75: Area personale completa
 * - Posizioni attive con tracking stelline (PUNTO 70)
 * - Sezione invitati con totale (PUNTO 71)
 * - Referral link con copia/condivisione (PUNTO 72)
 * - Statistiche link attivi (PUNTO 73)
 * - Messaggistica supporto (PUNTO 74)
 * - Elenco doni ricevuti (PUNTO 75)
 * 
 * MIGRATO A POSTGRESQL con fallback JSON
 * 
 * @author Warp AI Agent
 * @version 2.0.0 (PostgreSQL)
 * @date 30 Novembre 2025
 */

const fs = require('fs').promises;
const fsSync = require('fs'); // Per readFileSync in fallback
const path = require('path');
const crypto = require('crypto');
const pg = require('./pg-connection-manager');
const contractCache = require('./smart-contract-cache');

// Manager dependencies
const avanzamentoManager = require('./avanzamento-manager-pg');
const referralManager = require('./referral-manager');
const userAuthManager = require('./user-auth-manager');

// Fonte di verità runtime locale: SQLite canonico (ROG_MASTER.db)
// Solo se PostgreSQL NON è configurato (ambiente legacy senza DATABASE_URL).
// In presenza di DATABASE_URL usiamo SOLO PostgreSQL e non carichiamo SQLite.
let dbManager = null;
const HAS_POSTGRES = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);
if (!HAS_POSTGRES) {
  try {
    dbManager = require('./db-unified-manager');
  } catch (err) {
    console.warn('⚠️ db-unified-manager (SQLite) non disponibile:', err.message);
  }
}

const cycleStellineManager = require('./cycle-stelline-manager');
const dbUnifiedPg = require('./db-unified-manager-pg'); // PostgreSQL

// ========================================
// CONFIGURAZIONE
// ========================================

const AREA_PERSONALE_STATE_FILE = path.join(__dirname, 'data', 'area-personale-state.json');
const DONI_RICEVUTI_FILE = path.join(__dirname, '../DONI RICEVUTI ROG.txt');
const BASE_URL = process.env.BASE_URL || 'https://revolutionofgiving.com';

// ========================================
// CLASSE MANAGER
// ========================================

class AreaPersonaleManager {
  constructor() {
    this.state = {
      referralLinks: {}, // wallet => { code, created, clicks, conversions } - FALLBACK
      messages: {}, // wallet => [messages] - FALLBACK
      linkStatistics: {} // wallet => { sent, active, converted } - FALLBACK
    };
    this.initialized = false;
    this.usePostgres = false; // Flag per PostgreSQL
  }

  /**
   * Inizializza manager
   */
  async init() {
    if (this.initialized) return;

    console.log('👤 Inizializzazione Area Personale Manager...');

    // Tenta connessione PostgreSQL
    try {
      await pg.initDatabase();
      this.usePostgres = true;
      console.log('✅ Area Personale Manager: usando PostgreSQL');
    } catch (error) {
      console.warn('⚠️  PostgreSQL non disponibile, uso fallback JSON');
      this.usePostgres = false;
    }

    if (!this.usePostgres) {
      await this.loadState(); // Solo se non usa PostgreSQL
    }

    this.initialized = true;
    console.log(`✅ Area Personale Manager pronto (DB: ${this.usePostgres ? 'PostgreSQL' : 'JSON'})`);
  }

  /**
   * Carica stato da file
   */
  async loadState() {
    try {
      const data = await fs.readFile(AREA_PERSONALE_STATE_FILE, 'utf8');
      this.state = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📝 Nuovo area personale state');
        await this.saveState();
      } else {
        throw error;
      }
    }
  }

  /**
   * Salva stato su file
   */
  async saveState() {
    await fs.mkdir(path.dirname(AREA_PERSONALE_STATE_FILE), { recursive: true });
    await fs.writeFile(
      AREA_PERSONALE_STATE_FILE,
      JSON.stringify(this.state, null, 2),
      'utf8'
    );
  }

  /**
   * Helper: legge posizioni dall'anagrafica file txt
   * @private
   */
  _readFromAnagraficaFile(wallet) {
    const posizioni = [];
    try {
      const ANAGRAFICA_FILE = path.join(__dirname, 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');
      const walletLower = wallet.toLowerCase();
      const content = fsSync.readFileSync(ANAGRAFICA_FILE, 'utf8');
      const lines = content.split(/\r?\n/);
      
      // Formato: linea pari = "pos\tNome"; linea successiva = wallet
      for (let i = 0; i < lines.length - 1; i++) {
        const maybeWallet = (lines[i + 1] || '').trim().toLowerCase();
        if (maybeWallet === walletLower) {
          const header = (lines[i] || '').trim();
          const posStr = header.split('\t')[0];
          const posizione = Number(posStr);
          const nome = header.includes('\t') ? header.split('\t').slice(1).join('\t').trim() : null;
          
          if (Number.isFinite(posizione)) {
            posizioni.push({
              posizione,
              wallet: wallet,
              nome,
              movimento: 'SMALL',
              molecola: Math.ceil(posizione / 3),
              generazione: Math.ceil(posizione / 15),
              ruolo: 'RICEVENTE',
              stato: 'ATTIVO'
            });
          }
        }
      }
    } catch (fileErr) {
      console.error('❌ Errore lettura anagrafica file:', fileErr.message);
    }
    return posizioni;
  }

  // ========================================
  // PUNTO 69-70: POSIZIONI ATTIVE E TRACKING STELLINE
  // ========================================

  /**
   * Ottiene tutte le posizioni attive con tracking stelline
   * PUNTO 70
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object} Posizioni con stelline
   */
  async getPosizioniAttive(wallet) {
    await this.init();

    // Usa SQLite solo in ambiente legacy senza PostgreSQL; in presenza di
    // DATABASE_URL usiamo esclusivamente PostgreSQL + file anagrafica.
    let posizioni = [];
    let walletInfo = null;
    
    // 🚫 WALLET PILETTA: Mai mostrare posizioni PILETTA nell'area personale
    const PILETTA_WALLET = '0x96e6a17f968b73d10263072899c95b83305281fe';
    
    if (!HAS_POSTGRES && dbManager) {
      // SQLite disponibile (locale legacy)
      try {
        posizioni = await dbManager.getWalletPositions(wallet);
        walletInfo = await dbManager.getWallet(wallet);
      } catch (err) {
        console.error('❌ AreaPersonaleManager SQLite error:', err.message);
        throw err;
      }
    } else {
      // PostgreSQL (Coolify o locale con DATABASE_URL) è la SOLA fonte di verità runtime
      try {
        // Cache per 60 secondi per ridurre query DB ripetute
        const result = await contractCache.get(
          'userPositions',
          [wallet],
          async () => await dbUnifiedPg.getWalletPositions(wallet)
        );
        posizioni = result || [];
      } catch (err) {
        console.error('❌ AreaPersonaleManager PostgreSQL error (posizioni):', err.message);
        posizioni = [];
      }

      // 🔧 FIX: getWalletStats in try-catch separato per NON azzerare le posizioni
      // se solo la query stats fallisce (timeout, connessione, ecc.)
      try {
        const stats = await dbUnifiedPg.getWalletStats(wallet);
        walletInfo = {
          totale_posizioni: stats?.totale_posizioni || posizioni.length,
          movimento_max: stats?.movimento_max || 'SMALL'
        };
      } catch (err) {
        console.error('⚠️  AreaPersonaleManager: getWalletStats fallito (non bloccante):', err.message);
        walletInfo = { totale_posizioni: posizioni.length, movimento_max: 'SMALL' };
      }
      // NESSUN fallback su file anagrafica: se PostgreSQL è vuoto, significa zero posizioni reali.
    }
    
    // Deduplica eventuali posizioni duplicate per lo stesso wallet
    if (Array.isArray(posizioni) && posizioni.length > 0) {
      const byPosizione = {};
      for (const p of posizioni) {
        const key = String(p.posizione);
        if (!byPosizione[key]) {
          byPosizione[key] = p;
        }
      }
      const unique = Object.values(byPosizione);
      if (unique.length !== posizioni.length) {
        console.warn(
          `⚠️  getPosizioniAttive: trovate ${posizioni.length - unique.length} posizioni duplicate per wallet ${wallet}`
        );
      }
      // Ordina le posizioni per posizione crescente per una visualizzazione coerente
      posizioni = unique.sort((a, b) => Number(a.posizione) - Number(b.posizione));
    }
    
    // 🚫 FILTRO PILETTE: Le posizioni PILETTA sono PRIVATE del sistema ROG
    // e NON devono MAI essere mostrate nell'area personale degli utenti.
    // Solo il pannello admin può visualizzarle.
    if (Array.isArray(posizioni) && posizioni.length > 0) {
      posizioni = posizioni.filter(p => {
        // Escludi posizioni con wallet PILETTA
        if (p.wallet && p.wallet.toLowerCase() === PILETTA_WALLET.toLowerCase()) {
          return false;
        }
        
        // Escludi tipo PILETTA (se presente nel DB)
        if (p.tipo && p.tipo.toUpperCase() === 'PILETTA') {
          return false;
        }
        
        // IMPORTANTE: L'alternanza PARI=HUMAN / DISPARI=PILETTA vale SOLO
        // per posizioni SMALL (non LARGE/MEDIUM).
        // Il movimento è letto dal DB, quindi supporta transizioni dinamiche.
        const mov = (p.movimento || '').toUpperCase();
        if (mov === 'SMALL' && p.posizione % 2 !== 0) {
          // In SMALL le dispari sono sempre PILETTA
          return false;
        }
        
        return true;
      });
    }
    
    const posizioniConStelle = [];
    
    for (const pos of posizioni) {
      // Ottieni stato completo ciclo con stelline emoji da cycle-stelline-manager
      const statoCiclo = await cycleStellineManager.getStatoCiclo(pos.posizione, pos.movimento);
      
      // Ottieni emoji stelline colorate 🔴🟢🔵
      const stellineEmoji = await cycleStellineManager.getStellineEmoji(pos.posizione, pos.movimento);
      
      // Stelle dettagliate
      const stelle = {
        rosse: statoCiclo?.stelline_rosse || 0,
        verdi: statoCiclo?.stelline_verdi || 0,
        blu: statoCiclo?.stelline_blu || 0,
        emoji: stellineEmoji || '',
        totali: (statoCiclo?.stelline_rosse || 0) + 
                (statoCiclo?.stelline_verdi || 0) + 
                (statoCiclo?.stelline_blu || 0)
      };

      posizioniConStelle.push({
        posizione: pos.posizione,
        // Per privacy non esponiamo il nome, solo wallet e posizione
        nome: null,
        wallet: wallet,
        createdAt: pos.created_at || pos.createdAt || null,
        created_at: pos.created_at || pos.createdAt || null,
        movimento: pos.movimento,
        molecola: pos.molecola,
        generazione: pos.generazione,
        ruolo: pos.ruolo,
        ciclo_corrente: statoCiclo?.ciclo_corrente || 1,
        cicli_completati: statoCiclo?.cicli_completati || 0,
        cicli_totali: statoCiclo?.cicli_totali || 3,
        stelle,
        accumulo_medium: statoCiclo?.accumulo_medium || 0,
        accumulo_large: statoCiclo?.accumulo_large || 0,
        pronto_transizione: statoCiclo?.pronto_transizione || false,
        stato: pos.stato
      });
    }

    return {
      totalePosizioniAttive: posizioniConStelle.length,
      posizioni: posizioniConStelle,
      walletInfo: {
        // Nome non esposto all'utente finale
        nome: null,
        totale_posizioni: walletInfo?.totale_posizioni || 0,
        movimento_max: walletInfo?.movimento_max || 'SMALL'
      }
    };
  }

  // ========================================
  // PUNTO 71: SEZIONE INVITATI
  // ========================================

  /**
   * Ottiene elenco invitati dell'utente
   * PUNTO 71
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object} Lista invitati con totale
   */
  async getInvitati(wallet) {
    await this.init();

    // Usa le statistiche complete del ReferralManager, che includono:
    // - numeroInvitati aggregato (ANAGRAFICA + JSON runtime)
    // - lista invitati arricchita con eventuali relazioni presenti solo in referral-state.json
    const stats = await referralManager.getStatisticheInviti(wallet);

    return {
      totaleInvitati: stats.numeroInvitati,
      invitati: (stats.invitati || []).map(inv => ({
        nome: inv.nome,
        wallet: inv.wallet,
        dataInvito: inv.dataInvito,
        posizione: inv.posizione,
        movimento: inv.movimento || 'SMALL'
      }))
    };
  }

  // ========================================
  // PUNTO 72: REFERRAL LINK
  // ========================================

  /**
   * Genera referral link per utente
   * PUNTO 72
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object} Referral link e opzioni
   */
  async generaReferralLink(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    // Verifica se già esiste
    let refData;
    
    if (this.usePostgres) {
      refData = await this.getReferralLinkPG(walletNorm);
      
      if (!refData) {
        const code = this.generaCodiceReferral(wallet);
        await this.createReferralLinkPG(walletNorm, code);
        refData = await this.getReferralLinkPG(walletNorm);
      }
    } else {
      if (!this.state.referralLinks[walletNorm]) {
        const code = this.generaCodiceReferral(wallet);

        this.state.referralLinks[walletNorm] = {
          wallet: walletNorm,
          code,
          created: new Date().toISOString(),
          clicks: 0,
          conversions: 0,
          lastUsed: null
        };

        await this.saveState();
      }
      refData = this.state.referralLinks[walletNorm];
    }

    const referralUrl = `${BASE_URL}/referral.html?refWallet=${walletNorm}`;

    return {
      referralCode: refData.code,
      referralUrl,
      qrCode: `${BASE_URL}/api/qr?url=${encodeURIComponent(referralUrl)}`,
      statistiche: {
        clicks: refData.clicks,
        conversioni: refData.conversions,
        dataCreazione: refData.created
      },
      // Bottoni per frontend (PUNTO 72)
      azioni: {
        copia: {
          disponibile: true,
          testo: 'Copia Link'
        },
        email: {
          disponibile: true,
          testo: 'Condividi via Email',
          mailto: `mailto:?subject=Unisciti a ROG - Revolution of Giving&body=Ciao! Ti invito a unirti a ROG. Usa il mio link referral: ${referralUrl}`
        },
        whatsapp: {
          disponibile: true,
          testo: 'Condividi su WhatsApp',
          url: `https://wa.me/?text=${encodeURIComponent('Unisciti a ROG! ' + referralUrl)}`
        },
        telegram: {
          disponibile: true,
          testo: 'Condividi su Telegram',
          url: `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent('Unisciti a ROG!')}`
        }
      }
    };
  }

  /**
   * Genera codice referral unico
   */
  generaCodiceReferral(wallet) {
    // Usa hash del wallet per codice deterministico ma unico
    const hash = crypto.createHash('sha256').update(wallet.toLowerCase()).digest('hex');
    return 'ROG' + hash.substring(0, 8).toUpperCase();
  }

  /**
   * Registra click su referral link
   */
  async registraClickReferral(code) {
    await this.init();

    if (this.usePostgres) {
      return await this.registraClickReferralPG(code);
    }

    // Trova wallet per codice
    for (const [wallet, data] of Object.entries(this.state.referralLinks)) {
      if (data.code === code) {
        data.clicks++;
        data.lastUsed = new Date().toISOString();

        // Aggiorna statistiche
        if (!this.state.linkStatistics[wallet]) {
          this.state.linkStatistics[wallet] = { sent: 0, active: 0, converted: 0 };
        }
        this.state.linkStatistics[wallet].active++;

        await this.saveState();

        return { success: true, wallet };
      }
    }

    return { success: false, reason: 'Codice non trovato' };
  }

  /**
   * Registra conversione (registrazione completata)
   */
  async registraConversioneReferral(code) {
    await this.init();

    for (const [wallet, data] of Object.entries(this.state.referralLinks)) {
      if (data.code === code) {
        data.conversions++;

        // Aggiorna statistiche
        if (!this.state.linkStatistics[wallet]) {
          this.state.linkStatistics[wallet] = { sent: 0, active: 0, converted: 0 };
        }
        this.state.linkStatistics[wallet].converted++;

        await this.saveState();

        return { success: true, wallet };
      }
    }

    return { success: false };
  }

  // ========================================
  // PUNTO 73: STATISTICHE LINK
  // ========================================

  /**
   * Ottiene statistiche link referral
   * PUNTO 73
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object} Statistiche complete
   */
  async getStatisticheLink(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();
    const refData = this.state.referralLinks[walletNorm];

    if (!refData) {
      return {
        linkGenerato: false,
        statistiche: null
      };
    }

    // Calcola statistiche
    const stats = this.state.linkStatistics[walletNorm] || {
      sent: 0,
      active: 0,
      converted: 0
    };

    // Link attivi = clicks - conversioni
    const linkAttivi = refData.clicks - refData.conversions;

    return {
      linkGenerato: true,
      statistiche: {
        totaleClickLink: refData.clicks,
        linkAttivi: linkAttivi,
        conversioniCompletate: refData.conversions,
        tassoConversione: refData.clicks > 0 
          ? ((refData.conversions / refData.clicks) * 100).toFixed(2) + '%'
          : '0%',
        dataCreazione: refData.created,
        ultimoUtilizzo: refData.lastUsed
      }
    };
  }

  // ========================================
  // PUNTO 74: MESSAGGISTICA E SUPPORTO
  // ========================================

  /**
   * Invia messaggio a supporto
   * PUNTO 74
   * 
   * @param {string} wallet - Wallet utente
   * @param {string} messaggio - Testo messaggio
   * @returns {Object} Risultato invio
   */
  async inviaMessaggioSupporto(wallet, messaggio) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    if (!this.state.messages[walletNorm]) {
      this.state.messages[walletNorm] = [];
    }

    const msg = {
      id: 'msg_' + Date.now(),
      from: 'user',
      wallet: walletNorm,
      testo: messaggio,
      timestamp: new Date().toISOString(),
      letto: false,
      risposta: null
    };

    if (this.usePostgres) {
      await this.saveMessagePG(msg);
    } else {
      this.state.messages[walletNorm].push(msg);
      await this.saveState();
    }

    // Bot auto-risposta per FAQ comuni
    const rispostaBot = await this.botRispostaAutomatica(messaggio);
    if (rispostaBot) {
      await this.inviaRispostaSupporto(wallet, msg.id, rispostaBot, 'bot');
    }

    return {
      success: true,
      messageId: msg.id,
      rispostaAutomatica: rispostaBot !== null
    };
  }

  /**
   * Bot per risposte automatiche FAQ
   * PUNTO 74
   */
  async botRispostaAutomatica(messaggio) {
    const messaggioLower = messaggio.toLowerCase();

    // FAQ comuni
    if (messaggioLower.includes('stellina') || messaggioLower.includes('stelle')) {
      return `Le stelline rappresentano i cicli completati:
🔴 Rosse = Cicli SMALL completati (max 3)
🟢 Verdi = Cicli MEDIUM completati (max 3)
🔵 Blu = Cicli LARGE completati (max 8)

Ogni stellina si ottiene completando un ciclo nel rispettivo movimento.`;
    }

    if (messaggioLower.includes('invitare') || messaggioLower.includes('referral')) {
      return `Per invitare nuovi utenti:
1. Vai alla sezione "Il Tuo Referral Link"
2. Clicca su "Genera Link" se non l'hai già fatto
3. Copia il link e condividilo via email, WhatsApp o Telegram

Per ogni invitato che si registra, riceverai 6.250€ quando completerà il suo percorso in LARGE!`;
    }

    if (messaggioLower.includes('dono') || messaggioLower.includes('quando ricevo')) {
      return `I doni vengono distribuiti automaticamente:
- SMALL: Quando completi ogni ciclo (C1, C2, C3)
- MEDIUM: Man mano che completi i cicli
- LARGE: Secondo la cascata generazionale (H10→H8→H6→H4→H2)

Puoi vedere i doni ricevuti nella sezione "I Tuoi Doni Ricevuti".`;
    }

    if (messaggioLower.includes('zkkyc') || messaggioLower.includes('verifica')) {
      return `La verifica ZK-KYC è richiesta quando il tuo accumulo MEDIUM→LARGE raggiunge 100€.
Riceverai una notifica automatica con il link per completare la verifica tramite Polygon ID.
La verifica è necessaria per ricevere il primo dono in LARGE.`;
    }

    if (messaggioLower.includes('movimento') || messaggioLower.includes('small') || messaggioLower.includes('medium') || messaggioLower.includes('large')) {
      return `I movimenti ROG sono tre:
🔴 SMALL - 3 cicli (doni 2€/4€/10€)
🟢 MEDIUM - 3 cicli (doni 10€/20€/40€)
🔵 LARGE - 8 cicli (doni fino a 10.000€)

Passi a MEDIUM dopo 3 stelle rosse, e a LARGE dopo 3 stelle verdi.`;
    }

    // Nessuna risposta automatica trovata
    return null;
  }

  /**
   * Invia risposta da supporto
   */
  async inviaRispostaSupporto(wallet, messageId, risposta, tipo = 'human') {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    if (!this.state.messages[walletNorm]) {
      return { success: false, reason: 'Conversazione non trovata' };
    }

    // Trova messaggio
    const msg = this.state.messages[walletNorm].find(m => m.id === messageId);
    if (!msg) {
      return { success: false, reason: 'Messaggio non trovato' };
    }

    // Aggiungi risposta
    const rispMsg = {
      id: 'resp_' + Date.now(),
      from: tipo === 'bot' ? 'bot' : 'support',
      wallet: 'support',
      testo: risposta,
      timestamp: new Date().toISOString(),
      inRispostaA: messageId
    };

    msg.risposta = rispMsg;
    this.state.messages[walletNorm].push(rispMsg);
    await this.saveState();

    return {
      success: true,
      responseId: rispMsg.id
    };
  }

  /**
   * Ottiene conversazione con supporto
   */
  async getConversazioneSupporto(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();
    let messages = [];

    if (this.usePostgres) {
      messages = await this.getMessagesPG(walletNorm);
    } else {
      messages = this.state.messages[walletNorm] || [];
    }

    return {
      totaleMessaggi: messages.length,
      messaggi: messages.map(m => ({
        id: m.id,
        tipo: m.from === 'user' || m.from_type === 'user' ? 'utente' : (m.from === 'bot' || m.from_type === 'bot' ? 'bot' : 'supporto'),
        testo: m.testo,
        timestamp: m.timestamp,
        letto: m.letto || false,
        risposta: m.risposta
      }))
    };
  }

  // ========================================
  // PUNTO 75: DONI RICEVUTI
  // ========================================

  /**
   * Ottiene elenco doni ricevuti
   * PUNTO 75
   * 
   * @param {string} wallet - Wallet utente
   * @returns {Object} Lista doni ricevuti
   */
  async getDoniRicevuti(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    // In futuro questa sezione verrà migrata completamente su PostgreSQL
    // (tabella doni_ricevuti). Per ora:
    // - in ambiente legacy (senza DATABASE_URL) usiamo SQLite se disponibile,
    // - in ambiente PostgreSQL-only evitiamo qualsiasi chiamata a SQLite
    //   e facciamo direttamente fallback al file di testo.

    if (!HAS_POSTGRES && dbManager && typeof dbManager.getDoniRicevutiByWallet === 'function') {
      try {
        const fromDb = await dbManager.getDoniRicevutiByWallet(walletNorm);
        return {
          wallet: fromDb.wallet,
          totaleDoniRicevuti: fromDb.totaleDoniRicevuti,
          importoTotale: fromDb.importoTotale,
          doni: fromDb.doni
        };
      } catch (dbErr) {
        console.warn('⚠️  getDoniRicevuti (SQLite) fallito, fallback su file:', dbErr.message || dbErr);
      }
    }

    // Fallback legacy: file DONI RICEVUTI ROG.txt
    try {
      const content = await fs.readFile(DONI_RICEVUTI_FILE, 'utf8');
      const doni = this.parseDoniRicevuti(content, walletNorm);

      return {
        wallet: walletNorm,
        totaleDoniRicevuti: doni.length,
        importoTotale: doni.reduce((sum, d) => sum + d.importo, 0),
        doni: doni
      };
    } catch (error) {
      console.error('❌ Errore lettura doni ricevuti (fallback file):', error.message);
      return {
        wallet: walletNorm,
        totaleDoniRicevuti: 0,
        importoTotale: 0,
        doni: []
      };
    }
  }

  /**
   * Parse file DONI RICEVUTI ROG.txt
   */
  parseDoniRicevuti(content, wallet) {
    const lines = content.split('\n');
    const doni = [];
    let currentWallet = null;
    let currentNome = null;
    let inDatiSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Identifica wallet section
      if (line.startsWith('WALLET:')) {
        const walletMatch = line.match(/WALLET:\s*(\S+)/);
        if (walletMatch) {
          currentWallet = walletMatch[1].toLowerCase();
        }
        continue;
      }

      // Identifica nome
      if (line.startsWith('NOME:')) {
        const nomeMatch = line.match(/NOME:\s*(.+)/);
        if (nomeMatch) {
          currentNome = nomeMatch[1].trim();
        }
        continue;
      }

      // Inizio dati
      if (line.includes('DATA') && line.includes('IMPORTO')) {
        inDatiSection = true;
        continue;
      }

      // Fine sezione
      if (line.startsWith('====') || line.startsWith('TOTALE RICEVUTO:')) {
        inDatiSection = false;
        currentWallet = null;
        continue;
      }

      // Parse dono se nella sezione corretta e wallet match
      if (inDatiSection && currentWallet === wallet && line && !line.startsWith('-')) {
        const parts = line.split('|').map(p => p.trim());

        if (parts.length >= 4) {
          const data = parts[0];
          const importoStr = parts[1];
          const tipo = parts[2];
          const stato = parts[3];

          // Parse importo
          const importoMatch = importoStr.match(/([\d.]+)\s*USDC/);
          const importo = importoMatch ? parseFloat(importoMatch[1]) : 0;

          doni.push({
            data,
            importo,
            valuta: 'USDC',
            tipoDono: tipo,
            stato: stato.includes('✅') ? 'Accreditato' : 'Pendente',
            nome: currentNome
          });
        }
      }
    }

    return doni;
  }

  // ========================================
  // API COMPLETA AREA PERSONALE
  // ========================================

  /**
   * Ottiene tutti i dati per area personale
   * 
   * @param {string} sessionId - ID sessione utente
   * @returns {Object} Dati completi area personale
   */
  async getAreaPersonaleCompleta(sessionId) {
    await this.init();

    // Verifica sessione
    const sessionCheck = await userAuthManager.verificaSessione(sessionId);
    if (!sessionCheck.valid) {
      return {
        success: false,
        reason: sessionCheck.reason
      };
    }

    const session = sessionCheck.session;
    const wallet = session.wallet;

    let walletInfo = null;
    let walletStats = null;
    let rgxTokensOwned = 0;

    if (!HAS_POSTGRES && dbManager) {
      // Ambiente legacy SQLite
      await this.anonymizeWallet(wallet);
      walletInfo = await dbManager.getWallet(wallet);
      walletStats = await dbManager.getWalletStats(wallet);
      try {
        rgxTokensOwned = await dbManager.getRGxBalanceByWallet(wallet);
      } catch (_) {
        rgxTokensOwned = 0;
      }
    } else {
      // Ambiente PostgreSQL-only: niente anonimizzazione via SQLite, leggiamo
      // direttamente le info dal master Postgres.
      try {
        walletInfo = await dbUnifiedPg.getWallet(wallet);
        walletStats = await dbUnifiedPg.getWalletStats(wallet);
        rgxTokensOwned = 0; // TODO: migrare RGx su Postgres
      } catch (err) {
        console.error('❌ Errore lettura wallet info (PG):', err.message || err);
        walletInfo = null;
        walletStats = null;
        rgxTokensOwned = 0;
      }
    }

    // Carica tutti i dati
    const [posizioni, invitati, referral, statistiche, conversazione, doni] = await Promise.all([
      this.getPosizioniAttive(wallet),
      this.getInvitati(wallet),
      this.generaReferralLink(wallet),
      this.getStatisticheLink(wallet),
      this.getConversazioneSupporto(wallet),
      this.getDoniRicevuti(wallet)
    ]);

    const numeroInvitati = invitati?.totaleInvitati || 0;

    return {
      success: true,
      utente: {
        wallet: wallet,
        // Nome non restituito all'utente finale per motivi di privacy
        nome: null,
        tipo: walletInfo?.tipo || 'HUMAN',
        primaPosizione: walletInfo?.prima_posizione || session.primaPosizione,
        ultimaPosizione: walletInfo?.ultima_posizione,
        totalePosizioni: walletInfo?.totale_posizioni || session.totalePosizioni,
        movimentoCorrente: walletInfo?.movimento_corrente || 'SMALL',
        accumuli: {
          small: walletInfo?.accumulo_small || 0,
          medium: walletInfo?.accumulo_medium || 0
        },
        stelline: {
          rosse: walletStats?.stelline_rosse ?? (walletInfo?.stelline_rosse || 0),
          verdi: walletStats?.stelline_verdi ?? (walletInfo?.stelline_verdi || 0),
          blu: walletStats?.stelline_blu ?? (walletInfo?.stelline_blu || 0),
          totali: walletStats?.stelline_totali || 0
        },
        zkkyc: {
          verified: walletInfo?.zkkyc_verified === 1,
          did: walletInfo?.zkkyc_did,
          verificationDate: walletInfo?.zkkyc_verification_date
        },
        rgx: {
          tokensOwned: rgxTokensOwned
        },
        // Numero totale di invitati, coerente con pannello admin
        numeroInvitati
      },
      // PUNTO 70
      posizioniAttive: posizioni,
      // PUNTO 71
      invitati: invitati,
      // PUNTO 72
      referralLink: referral,
      // PUNTO 73
      statisticheLink: statistiche,
      // PUNTO 74
      messaggistica: {
        conversazione: conversazione,
        botDisponibile: true
      },
      // PUNTO 75
      doniRicevuti: doni
    };
  }

  // ========================================
  // POSTGRESQL METHODS
  // ========================================

  /**
   * Ottiene referral link da PostgreSQL
   */
  async getReferralLinkPG(wallet) {
    try {
      const row = await pg.queryOne('SELECT * FROM referral_links WHERE wallet = $1', [wallet]);
      if (!row) return null;
      
      return {
        wallet: row.wallet,
        code: row.code,
        created: row.created.toISOString(),
        clicks: row.clicks,
        conversions: row.conversions,
        lastUsed: row.last_used ? row.last_used.toISOString() : null
      };
    } catch (error) {
      console.error('❌ Errore lettura referral link PG:', error.message);
      return null;
    }
  }

  /**
   * Crea referral link in PostgreSQL
   */
  async createReferralLinkPG(wallet, code) {
    try {
      await pg.query(`
        INSERT INTO referral_links (wallet, code)
        VALUES ($1, $2)
        ON CONFLICT (wallet) DO NOTHING
      `, [wallet, code]);
    } catch (error) {
      console.error('❌ Errore creazione referral link PG:', error.message);
    }
  }

  /**
   * Registra click referral in PostgreSQL
   */
  async registraClickReferralPG(code) {
    try {
      const result = await pg.query(`
        UPDATE referral_links 
        SET clicks = clicks + 1, last_used = NOW()
        WHERE code = $1
        RETURNING wallet
      `, [code]);

      if (result.rows && result.rows.length > 0) {
        return { success: true, wallet: result.rows[0].wallet };
      }

      return { success: false, reason: 'Codice non trovato' };
    } catch (error) {
      console.error('❌ Errore registrazione click PG:', error.message);
      return { success: false, reason: error.message };
    }
  }

  /**
   * Salva messaggio in PostgreSQL
   */
  async saveMessagePG(msg) {
    try {
      await pg.query(`
        INSERT INTO messages (id, wallet, from_type, testo, letto)
        VALUES ($1, $2, $3, $4, $5)
      `, [msg.id, msg.wallet, msg.from, msg.testo, msg.letto || false]);
    } catch (error) {
      console.error('❌ Errore salvataggio messaggio PG:', error.message);
    }
  }

  /**
   * Ottiene messaggi da PostgreSQL
   */
  async getMessagesPG(wallet) {
    try {
      const rows = await pg.queryMany(`
        SELECT * FROM messages 
        WHERE wallet = $1 
        ORDER BY timestamp ASC
      `, [wallet]);

      return rows.map(row => ({
        id: row.id,
        from: row.from_type,
        from_type: row.from_type,
        wallet: row.wallet,
        testo: row.testo,
        timestamp: row.timestamp.toISOString(),
        letto: row.letto,
        risposta: null // TODO: gestire risposte se necessario
      }));
    } catch (error) {
      console.error('❌ Errore lettura messaggi PG:', error.message);
      return [];
    }
  }

  /**
   * Anonimizza il nome di un wallet nel database MASTER (manteniamo solo wallet e posizioni).
   */
  async anonymizeWallet(wallet) {
    try {
      const dbs = dbManager.getDb();
      if (!dbs || !dbs.master) {
        dbManager.initDatabases();
      }
      const masterDb = dbManager.getDb().master;
      const walletLower = wallet.toLowerCase();

      await new Promise((resolve, reject) => {
        masterDb.run(
          `UPDATE wallet_master SET nome = NULL WHERE wallet = ? AND tipo = 'HUMAN'`,
          [walletLower],
          err => (err ? reject(err) : resolve())
        );
      });
    } catch (error) {
      console.error('❌ Errore anonimizzazione wallet:', error.message);
    }
  }
}

const areaPersonaleManager = new AreaPersonaleManager();

module.exports = areaPersonaleManager;
