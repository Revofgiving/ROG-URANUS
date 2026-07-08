/**
 * 👤 ROG USER AUTH MANAGER - Autenticazione Utenti con MetaMask
 * 
 * PUNTI 63-68: Sistema autenticazione per utenti ROG
 * - Connessione wallet MetaMask dalla homepage
 * - Verifica wallet in ANAGRAFICA ROG 1 NOVEMBRE.txt
 * - Email supporto automatica se wallet non trovato
 * - Schermata benvenuto con prima posizione e bottoni
 * 
 * MIGRATO A POSTGRESQL con fallback JSON
 * 
 * @author Warp AI Agent
 * @version 2.0.0 (PostgreSQL)
 * @date 30 Novembre 2025
 */

const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const pg = require('./pg-connection-manager');
const dbManager = require('./db-unified-manager-pg');
const statePg = require('./state-persistence-pg');

// ========================================
// CONFIGURAZIONE
// ========================================

// File legacy posizioni (fallback)
const ANAGRAFICA_FILE = path.join(__dirname, 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');
const STATE_KEY = 'user_auth';
const SUPPORT_EMAIL = 'revolutionofgivingrog@protonmail.com';

// ========================================
// CLASSE MANAGER
// ========================================

class UserAuthManager {
  constructor() {
    this.anagrafica = new Map(); // wallet => [posizioni]
    this.sessions = new Map(); // sessionId => { wallet, nome, timestamp } - FALLBACK
    this.walletNotFoundLog = []; // Log wallet non trovati - FALLBACK
    this.initialized = false;
    this.usePostgres = false; // Flag per PostgreSQL
  }

  /**
   * Inizializza manager
   */
  async init() {
    if (this.initialized) return;

    console.log('👤 Inizializzazione User Auth Manager...');

    // Tenta connessione PostgreSQL
    try {
      await pg.initDatabase();
      this.usePostgres = true;
      console.log('✅ User Auth Manager: usando PostgreSQL');
    } catch (error) {
      console.warn('⚠️  PostgreSQL non disponibile, uso fallback JSON');
      this.usePostgres = false;
    }

    await this.caricaAnagrafica();
    
    if (!this.usePostgres) {
      await this.loadState(); // Solo se non usa PostgreSQL
    }

    this.initialized = true;
    console.log(`✅ User Auth Manager pronto`);
    console.log(`   DB: ${this.usePostgres ? 'PostgreSQL' : 'JSON (fallback)'}`);
    console.log(`   Wallet in anagrafica: ${this.anagrafica.size}`);
    console.log(`   Posizioni totali: ${this.getTotalePosizioni()}`);
  }

  /**
   * Carica anagrafica da file
   * PUNTO 66
   */
  async caricaAnagrafica() {
    // Se abbiamo PostgreSQL, non dipendiamo dal file locale.
    if (this.usePostgres) {
      this.anagrafica = new Map();
      return;
    }

    try {
      const content = await fs.readFile(ANAGRAFICA_FILE, 'utf8');
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      this.anagrafica = new Map();
      let loaded = 0;

      for (let i = 0; i < lines.length - 1; i++) {
        const header = lines[i];
        // Formato: posizione\tNOME
        if (!/^\d+\t/.test(header)) continue;

        const parts = header.split('\t');
        const posizione = parseInt(parts[0], 10);
        const nome = parts.slice(1).join('\t').trim();

        const walletLine = (lines[i + 1] || '').trim();
        const wallet = walletLine.toLowerCase();

        if (!Number.isFinite(posizione) || !/^0x[a-f0-9]{40}$/.test(wallet)) {
          continue;
        }

        if (!this.anagrafica.has(wallet)) {
          this.anagrafica.set(wallet, []);
        }

        this.anagrafica.get(wallet).push({
          posizione,
          nome,
          walletOriginal: walletLine,
        });

        loaded++;
        i++; // consumiamo anche la riga wallet
      }

      console.log(`✅ Anagrafica (fallback file) caricata:`);
      console.log(`   ${loaded} posizioni`);
      console.log(`   ${this.anagrafica.size} wallet unici`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('⚠️  File anagrafica fallback non trovato, procedo con anagrafica vuota:', ANAGRAFICA_FILE);
        this.anagrafica = new Map();
        return;
      }
      console.error('❌ Errore caricamento anagrafica:', error.message);
      throw error;
    }
  }

  /**
   * Carica stato da PostgreSQL
   */
  async loadState() {
    try {
      const saved = await statePg.getState(STATE_KEY, {
        sessions: {},
        walletNotFoundLog: []
      });

      // Carica sessioni
      for (const [sessionId, session] of Object.entries(saved.sessions || {})) {
        this.sessions.set(sessionId, session);
      }

      // Carica log wallet non trovati
      this.walletNotFoundLog = saved.walletNotFoundLog || [];

      console.log(`✅ State caricato (PostgreSQL):`);
      console.log(`   ${this.sessions.size} sessioni attive`);
      console.log(`   ${this.walletNotFoundLog.length} wallet non trovati (log)`);

    } catch (error) {
      console.error('❌ Errore loadState user-auth:', error.message);
    }
  }

  /**
   * Salva stato su PostgreSQL
   */
  async saveState() {
    const data = {
      sessions: Object.fromEntries(this.sessions),
      walletNotFoundLog: this.walletNotFoundLog,
      lastUpdate: new Date().toISOString()
    };

    await statePg.setState(STATE_KEY, data);
  }

  // ========================================
  // AUTENTICAZIONE METAMASK (PUNTI 63-68)
  // ========================================

  /**
   * Autentica utente con wallet MetaMask
   * 
   * FLUSSO:
   * 1. Utente clicca "GIÀ ISCRITTO" su homepage (Punto 63-64)
   * 2. Si apre MetaMask per connessione wallet (Punto 65)
   * 3. Sistema verifica wallet in anagrafica (Punto 66)
   * 4. Se non trovato → email supporto (Punto 67)
   * 5. Se trovato → schermata benvenuto (Punto 68)
   * 
   * @param {string} wallet - Wallet MetaMask dell'utente
   * @returns {Object} Risultato autenticazione
   */
  async autenticaConMetaMask(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    console.log(`\n🔍 AUTENTICAZIONE METAMASK`);
    console.log(`   Wallet: ${wallet}`);

    // PUNTO 66: Verifica se wallet esiste in anagrafica
    let posizioni;

    if (this.usePostgres) {
      // Sorgente di verità: PostgreSQL
      const rows = await dbManager.getWalletPositions(walletNorm);
      if (Array.isArray(rows) && rows.length > 0) {
        // Determiniamo nome (se presente in wallet_master)
        const walletInfo = await dbManager.getWallet(walletNorm);
        const nome = walletInfo?.nome || null;

        // Prima posizione = posizione numerica minima
        const minPos = rows.reduce((min, r) => {
          const n = Number(r.posizione);
          if (!Number.isFinite(n)) return min;
          return min === null ? n : Math.min(min, n);
        }, null);

        let nomeFinale = nome;
        if (!nomeFinale && Number.isFinite(minPos)) {
          try {
            const posInfo = await dbManager.getPosition(minPos);
            nomeFinale = posInfo?.nome || null;
          } catch (_) {
            // ignore
          }
        }

        const finalName = nomeFinale || `Wallet ${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;

        posizioni = rows
          .map((r) => ({ posizione: Number(r.posizione), nome: finalName, walletOriginal: wallet }))
          .filter((p) => Number.isFinite(p.posizione))
          .sort((a, b) => a.posizione - b.posizione);
      } else {
        posizioni = [];
      }
    } else {
      // Fallback file
      posizioni = this.anagrafica.get(walletNorm) || [];
    }

    if (!posizioni || posizioni.length === 0) {
      console.log(`   ❌ Wallet NON trovato in anagrafica`);

      // PUNTO 67: Invia email supporto
      await this.inviaEmailSupporto(wallet);

      // Registra in log
      if (this.usePostgres) {
        await this.logWalletNotFoundPG(wallet);
      } else {
        this.walletNotFoundLog.push({
          wallet,
          timestamp: new Date().toISOString(),
          emailInviata: true
        });
        await this.saveState();
      }

      return {
        success: false,
        walletTrovato: false,
        messaggio: 'Wallet non trovato nell\'anagrafica ROG. Il supporto è stato notificato e ti contatterà a breve per verificare i tuoi dati.',
        emailInviata: true
      };
    }

    // PUNTO 68: Wallet trovato - Prepara schermata benvenuto
    console.log(`   ✅ Wallet TROVATO: ${posizioni.length} posizioni`);

    // Prima posizione (come specificato in punto 68)
    const primaPosizione = posizioni[0];

    // Crea sessione
    const sessionId = this.generaSessionId();
    const session = {
      sessionId,
      wallet: walletNorm,
      walletOriginal: wallet,
      nome: primaPosizione.nome,
      primaPosizione: {
        numero: primaPosizione.posizione,
        nome: primaPosizione.nome
      },
      totalePosizioni: posizioni.length,
      todasPosizioni: posizioni.map(p => ({
        posizione: p.posizione,
        nome: p.nome
      })),
      timestamp: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    // Salva sessione in PostgreSQL o fallback
    if (this.usePostgres) {
      await this.saveSessionPG(session);
    } else {
      this.sessions.set(sessionId, session);
      await this.saveState();
    }

    console.log(`   ✅ Sessione creata: ${sessionId}`);
    console.log(`   Nome: ${primaPosizione.nome}`);
    console.log(`   Prima posizione: #${primaPosizione.posizione}`);

    // PUNTO 68: Return per schermata benvenuto con bottoni
    return {
      success: true,
      walletTrovato: true,
      sessionId,
      wallet: walletNorm,
      nome: primaPosizione.nome,
      primaPosizione: {
        numero: primaPosizione.posizione,
        nome: primaPosizione.nome
      },
      totalePosizioni: posizioni.length,
      messaggio: `Benvenuto ${primaPosizione.nome}!`,
      // Bottoni per schermata (Punto 68)
      bottoni: {
        homepage: true,
        areaPersonale: true
      }
    };
  }

  /**
   * Invia email a supporto per wallet non trovato
   * PUNTO 67
   * 
   * @param {string} wallet - Wallet non trovato in anagrafica
   */
  async inviaEmailSupporto(wallet) {
    try {
      console.log(`\n📧 INVIO EMAIL SUPPORTO`);
      console.log(`   Wallet non trovato: ${wallet}`);
      console.log(`   To: ${SUPPORT_EMAIL}`);

      // Configurazione transporter (richiede credenziali reali in .env)
      const transporter = nodemailer.createTransport({
        host: 'mail.protonmail.com',
        port: 587,
        secure: false,
        auth: {
          user: SUPPORT_EMAIL,
          pass: process.env.EMAIL_PASSWORD || ''
        }
      });

      const mailOptions = {
        from: SUPPORT_EMAIL,
        to: SUPPORT_EMAIL,
        subject: `🔍 ROG - Wallet non trovato in anagrafica`,
        text: `
VERIFICA DATI UTENTE RICHIESTA
===============================

Un utente ha tentato di accedere con un wallet non presente nell'anagrafica ROG.

Wallet: ${wallet}
Data richiesta: ${new Date().toLocaleString('it-IT')}
Ora: ${new Date().toLocaleTimeString('it-IT')}

AZIONI RICHIESTE:
1. Verificare se l'utente è registrato con un wallet diverso
2. Verificare se l'utente deve essere aggiunto all'anagrafica
3. Contattare l'utente via email per confermare i dati di registrazione
4. Aggiornare anagrafica se necessario

Il sistema ha informato l'utente che il supporto lo contatterà a breve.

---
Sistema ROG - Revolution of Giving
Email: ${SUPPORT_EMAIL}
        `,
        html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #e74c3c; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f8f9fa; padding: 20px; }
    .wallet { background-color: #fff; padding: 15px; border-left: 4px solid #e74c3c; margin: 15px 0; font-family: monospace; }
    .actions { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0; }
    .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #6c757d; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🔍 VERIFICA DATI UTENTE RICHIESTA</h2>
    </div>
    
    <div class="content">
      <p><strong>Un utente ha tentato di accedere con un wallet non presente nell'anagrafica ROG.</strong></p>
      
      <div class="wallet">
        <strong>Wallet:</strong> ${wallet}<br>
        <strong>Data:</strong> ${new Date().toLocaleString('it-IT')}<br>
        <strong>Ora:</strong> ${new Date().toLocaleTimeString('it-IT')}
      </div>
      
      <div class="actions">
        <h3 style="margin-top: 0;">⚠️ AZIONI RICHIESTE:</h3>
        <ol>
          <li>Verificare se l'utente è registrato con un wallet diverso</li>
          <li>Verificare se l'utente deve essere aggiunto all'anagrafica</li>
          <li>Contattare l'utente via email per confermare i dati di registrazione</li>
          <li>Aggiornare anagrafica se necessario</li>
        </ol>
      </div>
      
      <p><em>Il sistema ha informato l'utente che il supporto lo contatterà a breve.</em></p>
    </div>
    
    <div class="footer">
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p>
        <strong>Sistema ROG - Revolution of Giving</strong><br>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </p>
    </div>
  </div>
</body>
</html>
        `
      };

      // Invia email in produzione
      await transporter.sendMail(mailOptions);
      
      console.log(`   ✅ Email supporto inviata a ${SUPPORT_EMAIL}`);

    } catch (error) {
      console.error(`   ❌ Errore invio email supporto:`, error.message);
      // Non bloccare il flusso se email fallisce
    }
  }

  /**
   * Genera session ID univoco
   */
  generaSessionId() {
    return 'rog_sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
  }

  /**
   * Ottiene sessione attiva
   * 
   * @param {string} sessionId - ID sessione
   * @returns {Object|null} Sessione o null
   */
  async getSession(sessionId) {
    await this.init();
    
    if (this.usePostgres) {
      return await this.getSessionPG(sessionId);
    }
    
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Verifica se sessione è valida
   */
  async verificaSessione(sessionId) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return { valid: false, reason: 'Sessione non trovata' };
    }

    // Verifica scadenza (24 ore)
    const now = Date.now();
    const sessionTime = new Date(session.timestamp).getTime();
    const duration = now - sessionTime;
    const maxDuration = 24 * 60 * 60 * 1000; // 24 ore

    if (duration > maxDuration) {
      if (this.usePostgres) {
        await this.deleteSessionPG(sessionId);
      } else {
        this.sessions.delete(sessionId);
        await this.saveState();
      }
      return { valid: false, reason: 'Sessione scaduta' };
    }

    // Aggiorna lastActivity
    session.lastActivity = new Date().toISOString();
    if (this.usePostgres) {
      await this.updateSessionActivityPG(sessionId);
    } else {
      await this.saveState();
    }

    return { valid: true, session };
  }

  /**
   * Ottiene tutte le posizioni per wallet
   */
  async getPosizioniUtente(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    if (this.usePostgres) {
      const rows = await dbManager.getWalletPositions(walletNorm);
      const walletInfo = await dbManager.getWallet(walletNorm);
      const nome = walletInfo?.nome || null;
      return (rows || [])
        .map((r) => ({ posizione: Number(r.posizione), nome, walletOriginal: wallet }))
        .filter((p) => Number.isFinite(p.posizione));
    }

    return this.anagrafica.get(walletNorm) || [];
  }

  /**
   * Verifica se wallet esiste in anagrafica
   */
  async esisteWallet(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();

    if (this.usePostgres) {
      return await dbManager.walletExists(walletNorm);
    }

    return this.anagrafica.has(walletNorm);
  }

  /**
   * Logout utente
   */
  async logout(sessionId) {
    if (this.usePostgres) {
      await this.deleteSessionPG(sessionId);
    } else {
      this.sessions.delete(sessionId);
      await this.saveState();
    }

    console.log(`🚪 Logout sessione: ${sessionId}`);

    return { success: true, message: 'Logout effettuato' };
  }

  // ========================================
  // UTILITY
  // ========================================

  /**
   * Ottiene totale posizioni in anagrafica
   */
  getTotalePosizioni() {
    let total = 0;
    for (const posizioni of this.anagrafica.values()) {
      total += posizioni.length;
    }
    return total;
  }

  /**
   * Ottiene statistiche
   */
  async getStatistiche() {
    await this.init();

    let sessioniAttive = 0;
    let walletNonTrovati = 0;

    if (this.usePostgres) {
      const sessionsCount = await pg.queryOne('SELECT COUNT(*) as count FROM user_sessions WHERE expires_at > NOW()');
      sessioniAttive = sessionsCount ? parseInt(sessionsCount.count) : 0;
      
      const notFoundCount = await pg.queryOne('SELECT COUNT(*) as count FROM wallet_not_found_log');
      walletNonTrovati = notFoundCount ? parseInt(notFoundCount.count) : 0;
    } else {
      sessioniAttive = this.sessions.size;
      walletNonTrovati = this.walletNotFoundLog.length;
    }

    return {
      totaleWalletAnagrafica: this.anagrafica.size,
      totalePosizioni: this.getTotalePosizioni(),
      sessioniAttive,
      walletNonTrovati,
      database: this.usePostgres ? 'PostgreSQL' : 'JSON'
    };
  }

  // ========================================
  // POSTGRESQL METHODS
  // ========================================

  /**
   * Salva sessione in PostgreSQL
   */
  async saveSessionPG(session) {
    try {
      await pg.query(`
        INSERT INTO user_sessions 
        (session_id, wallet, nome, prima_posizione_numero, prima_posizione_nome, totale_posizioni, timestamp, last_activity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (session_id) DO UPDATE SET
          last_activity = $8
      `, [
        session.sessionId,
        session.wallet,
        session.nome,
        session.primaPosizione.numero,
        session.primaPosizione.nome,
        session.totalePosizioni,
        session.timestamp,
        session.lastActivity
      ]);
    } catch (error) {
      console.error('❌ Errore salvataggio sessione PG:', error.message);
      throw error;
    }
  }

  /**
   * Ottiene sessione da PostgreSQL
   */
  async getSessionPG(sessionId) {
    try {
      const row = await pg.queryOne(`
        SELECT * FROM user_sessions 
        WHERE session_id = $1 
        AND expires_at > NOW()
      `, [sessionId]);

      if (!row) return null;

      return {
        sessionId: row.session_id,
        wallet: row.wallet,
        nome: row.nome,
        primaPosizione: {
          numero: row.prima_posizione_numero,
          nome: row.prima_posizione_nome
        },
        totalePosizioni: row.totale_posizioni,
        timestamp: row.timestamp.toISOString(),
        lastActivity: row.last_activity.toISOString()
      };
    } catch (error) {
      console.error('❌ Errore lettura sessione PG:', error.message);
      return null;
    }
  }

  /**
   * Elimina sessione da PostgreSQL
   */
  async deleteSessionPG(sessionId) {
    try {
      await pg.query('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
    } catch (error) {
      console.error('❌ Errore eliminazione sessione PG:', error.message);
    }
  }

  /**
   * Aggiorna activity sessione in PostgreSQL
   */
  async updateSessionActivityPG(sessionId) {
    try {
      await pg.query(`
        UPDATE user_sessions 
        SET last_activity = NOW() 
        WHERE session_id = $1
      `, [sessionId]);
    } catch (error) {
      console.error('❌ Errore update activity PG:', error.message);
    }
  }

  /**
   * Log wallet non trovato in PostgreSQL
   */
  async logWalletNotFoundPG(wallet) {
    try {
      await pg.query(`
        INSERT INTO wallet_not_found_log (wallet, email_inviata)
        VALUES ($1, true)
      `, [wallet]);
    } catch (error) {
      console.error('❌ Errore log wallet not found PG:', error.message);
    }
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

const userAuthManager = new UserAuthManager();

module.exports = userAuthManager;
