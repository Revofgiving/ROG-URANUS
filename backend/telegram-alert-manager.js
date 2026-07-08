/**
 * 🚨 TELEGRAM ALERT MANAGER - Sistema Allerta Sicurezza ROG
 * 
 * PUNTO 94: Sistema di allerta su 2 cellulari via Telegram
 * 
 * Destinatari:
 * - @ISACRISFOMA75
 * - @Lilly_Castagneto
 * 
 * Eventi monitorati:
 * - Tentativo login fallito
 * - Transazione sospetta
 * - Errori critici sistema
 * - Problemi sicurezza rilevati
 * - Revisione sicurezza giornaliera
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 7 Febbraio 2026
 */

const https = require('https');
const statePg = require('./state-persistence-pg');

// ========================================
// CONFIGURAZIONE
// ========================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);

const STATE_KEY = 'telegram_alerts';

// Livelli di allerta
const ALERT_LEVELS = {
  INFO: { emoji: 'ℹ️', priority: 0 },
  WARNING: { emoji: '⚠️', priority: 1 },
  CRITICAL: { emoji: '🚨', priority: 2 },
  SECURITY: { emoji: '🔐', priority: 3 }
};

// ========================================
// CLASSE TELEGRAM ALERT MANAGER
// ========================================

class TelegramAlertManager {
  constructor() {
    this.state = {
      alertsSent: 0,
      lastAlert: null,
      dailyAlerts: [],
      securityReviewLastRun: null
    };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const saved = await statePg.getState(STATE_KEY, {
        alertsSent: 0,
        lastAlert: null,
        dailyAlerts: [],
        securityReviewLastRun: null
      });
      this.state = { ...this.state, ...saved };
    } catch (err) {
      console.error('❌ Errore caricamento telegram state:', err.message);
    }

    // Avvia revisione sicurezza giornaliera (ogni 24 ore)
    this.startDailySecurityReview();

    this.initialized = true;
    console.log('🚨 Telegram Alert Manager inizializzato (PostgreSQL)');
    console.log(`   Bot Token: ${TELEGRAM_BOT_TOKEN ? '✅ Configurato' : '❌ MANCANTE'}`);
    console.log(`   Chat IDs: ${TELEGRAM_CHAT_IDS.length > 0 ? TELEGRAM_CHAT_IDS.join(', ') : '❌ MANCANTI'}`);
  }

  async saveState() {
    await statePg.setState(STATE_KEY, this.state);
  }

  // ========================================
  // INVIO MESSAGGI TELEGRAM
  // ========================================

  /**
   * Invia messaggio Telegram a tutti i destinatari
   * 
   * @param {string} message - Messaggio da inviare
   * @param {string} level - Livello allerta (INFO, WARNING, CRITICAL, SECURITY)
   * @returns {Promise<Object>} Risultato invio
   */
  async sendAlert(message, level = 'INFO') {
    await this.init();

    if (!TELEGRAM_BOT_TOKEN) {
      console.error('❌ TELEGRAM_BOT_TOKEN non configurato');
      return { success: false, error: 'Token mancante' };
    }

    if (TELEGRAM_CHAT_IDS.length === 0) {
      console.error('❌ TELEGRAM_CHAT_IDS non configurato');
      return { success: false, error: 'Chat IDs mancanti' };
    }

    const alertLevel = ALERT_LEVELS[level] || ALERT_LEVELS.INFO;
    const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

    const fullMessage = [
      `${alertLevel.emoji} *ROG ALERT - ${level}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      message,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🕐 ${timestamp}`
    ].join('\n');

    const results = [];

    for (const chatId of TELEGRAM_CHAT_IDS) {
      try {
        const result = await this.sendTelegramMessage(chatId.trim(), fullMessage);
        results.push({ chatId, success: true, result });
        console.log(`✅ Alert inviato a ${chatId}`);
      } catch (error) {
        results.push({ chatId, success: false, error: error.message });
        console.error(`❌ Errore invio a ${chatId}:`, error.message);
      }
    }

    // Aggiorna stato
    this.state.alertsSent++;
    this.state.lastAlert = {
      timestamp: new Date().toISOString(),
      level,
      message: message.substring(0, 100)
    };
    this.state.dailyAlerts.push(this.state.lastAlert);
    await this.saveState();

    return {
      success: results.some(r => r.success),
      results
    };
  }

  /**
   * Invia messaggio Telegram singolo
   */
  sendTelegramMessage(chatId, text) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.ok) {
              resolve(response);
            } else {
              reject(new Error(response.description || 'Errore Telegram API'));
            }
          } catch (e) {
            reject(new Error('Risposta non valida'));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // ========================================
  // ALERT SPECIFICI
  // ========================================

  /**
   * Alert: Login fallito
   */
  async alertLoginFailed(username, ipAddress, reason) {
    const message = [
      `🔐 *TENTATIVO LOGIN FALLITO*`,
      ``,
      `👤 Username: \`${username}\``,
      `🌐 IP: \`${ipAddress}\``,
      `❌ Motivo: ${reason}`,
      ``,
      `⚠️ Verificare se si tratta di un attacco brute-force.`
    ].join('\n');

    return await this.sendAlert(message, 'SECURITY');
  }

  /**
   * Alert: Transazione sospetta
   */
  async alertSuspiciousTransaction(details) {
    const message = [
      `💰 *TRANSAZIONE SOSPETTA*`,
      ``,
      `📍 Wallet: \`${details.wallet || 'N/A'}\``,
      `💵 Importo: ${details.amount || 'N/A'} USDC`,
      `🔗 TX Hash: \`${details.txHash || 'N/A'}\``,
      `⚠️ Motivo: ${details.reason || 'Anomalia rilevata'}`,
      ``,
      `🔍 Richiede verifica manuale immediata.`
    ].join('\n');

    return await this.sendAlert(message, 'CRITICAL');
  }

  /**
   * Alert: Errore critico sistema
   */
  async alertCriticalError(component, error) {
    const message = [
      `💥 *ERRORE CRITICO SISTEMA*`,
      ``,
      `🔧 Componente: ${component}`,
      `❌ Errore: ${error.message || error}`,
      `📍 Stack: ${(error.stack || '').substring(0, 200)}...`,
      ``,
      `🚨 Il sistema potrebbe essere compromesso.`
    ].join('\n');

    return await this.sendAlert(message, 'CRITICAL');
  }

  /**
   * Alert: Problema sicurezza
   */
  async alertSecurityIssue(issue, severity) {
    const message = [
      `🛡️ *PROBLEMA SICUREZZA RILEVATO*`,
      ``,
      `⚠️ Tipo: ${issue.type || 'Sconosciuto'}`,
      `📝 Descrizione: ${issue.description || 'N/A'}`,
      `🎯 Severità: ${severity || 'MEDIA'}`,
      `💡 Azione: ${issue.action || 'Verifica manuale richiesta'}`,
      ``,
      `🔒 Sistema in modalità monitoraggio intensivo.`
    ].join('\n');

    return await this.sendAlert(message, 'SECURITY');
  }

  // ========================================
  // REVISIONE SICUREZZA GIORNALIERA
  // ========================================

  /**
   * Avvia revisione sicurezza giornaliera (ogni 24 ore)
   */
  startDailySecurityReview() {
    // Prima esecuzione dopo 1 minuto dall'avvio
    setTimeout(() => this.runSecurityReview(), 60 * 1000);

    // Poi ogni 24 ore
    setInterval(() => this.runSecurityReview(), 24 * 60 * 60 * 1000);

    console.log('🔄 Revisione sicurezza giornaliera programmata');
  }

  /**
   * Esegue revisione sicurezza completa
   */
  async runSecurityReview() {
    console.log('\n🔐 AVVIO REVISIONE SICUREZZA GIORNALIERA...');

    const report = {
      timestamp: new Date().toISOString(),
      checks: [],
      issues: [],
      status: 'OK'
    };

    try {
      // 1. Verifica integrità file critici
      const fileCheck = await this.checkCriticalFiles();
      report.checks.push(fileCheck);
      if (!fileCheck.ok) report.issues.push(fileCheck);

      // 2. Verifica sessioni attive
      const sessionCheck = await this.checkActiveSessions();
      report.checks.push(sessionCheck);
      if (!sessionCheck.ok) report.issues.push(sessionCheck);

      // 3. Verifica tentativi login falliti (ultime 24h)
      const loginCheck = await this.checkFailedLogins();
      report.checks.push(loginCheck);
      if (!loginCheck.ok) report.issues.push(loginCheck);

      // 4. Verifica connessione database
      const dbCheck = await this.checkDatabaseConnection();
      report.checks.push(dbCheck);
      if (!dbCheck.ok) report.issues.push(dbCheck);

      // 5. Verifica connessione blockchain
      const blockchainCheck = await this.checkBlockchainConnection();
      report.checks.push(blockchainCheck);
      if (!blockchainCheck.ok) report.issues.push(blockchainCheck);

      // Determina status generale
      if (report.issues.length > 0) {
        report.status = report.issues.some(i => i.severity === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
      }

      // Invia report
      await this.sendSecurityReport(report);

      // Aggiorna stato
      this.state.securityReviewLastRun = report.timestamp;
      this.state.dailyAlerts = []; // Reset alert giornalieri
      await this.saveState();

      console.log(`✅ Revisione sicurezza completata: ${report.status}`);

    } catch (error) {
      console.error('❌ Errore revisione sicurezza:', error);
      await this.alertCriticalError('SecurityReview', error);
    }

    return report;
  }

  /**
   * Invia report sicurezza giornaliero
   */
  async sendSecurityReport(report) {
    const checksOk = report.checks.filter(c => c.ok).length;
    const checksFailed = report.checks.filter(c => !c.ok).length;

    const statusEmoji = report.status === 'OK' ? '✅' : (report.status === 'CRITICAL' ? '🚨' : '⚠️');

    const message = [
      `📊 *REPORT SICUREZZA GIORNALIERO*`,
      ``,
      `${statusEmoji} Status: *${report.status}*`,
      `✅ Check OK: ${checksOk}`,
      `❌ Check Falliti: ${checksFailed}`,
      ``,
      `*Dettaglio verifiche:*`,
      ...report.checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}`),
      ``,
      report.issues.length > 0 
        ? `*⚠️ Problemi rilevati:*\n${report.issues.map(i => `• ${i.description}`).join('\n')}`
        : `*Nessun problema rilevato.*`,
      ``,
      `🔒 Sistema ROG protetto e monitorato.`
    ].join('\n');

    return await this.sendAlert(message, report.status === 'OK' ? 'INFO' : report.status);
  }

  // ========================================
  // CHECK SICUREZZA
  // ========================================

  async checkCriticalFiles() {
    const criticalFiles = [
      'auth-manager.js',
      'api-server.js',
      'pg-connection-manager.js',
      '.env'
    ];

    try {
      for (const file of criticalFiles) {
        await fs.access(path.join(__dirname, file));
      }
      return { name: 'File critici', ok: true };
    } catch (err) {
      return { 
        name: 'File critici', 
        ok: false, 
        severity: 'CRITICAL',
        description: `File mancante: ${err.message}` 
      };
    }
  }

  async checkActiveSessions() {
    try {
      const sessionsFile = path.join(__dirname, 'data', 'auth-sessions.json');
      const data = await fs.readFile(sessionsFile, 'utf8');
      const sessions = JSON.parse(data);
      const count = Object.keys(sessions).length;
      
      // Warning se troppe sessioni attive (possibile compromissione)
      if (count > 50) {
        return {
          name: 'Sessioni attive',
          ok: false,
          severity: 'WARNING',
          description: `${count} sessioni attive (anomalo)`
        };
      }
      
      return { name: 'Sessioni attive', ok: true, count };
    } catch (err) {
      return { name: 'Sessioni attive', ok: true, count: 0 };
    }
  }

  async checkFailedLogins() {
    try {
      const logsFile = path.join(__dirname, 'data', 'auth-logs.json');
      const data = await fs.readFile(logsFile, 'utf8');
      const logs = JSON.parse(data);
      
      // Conta login falliti nelle ultime 24h
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentFailed = logs.filter(l => 
        !l.success && new Date(l.timestamp).getTime() > oneDayAgo
      );
      
      if (recentFailed.length > 20) {
        return {
          name: 'Login falliti (24h)',
          ok: false,
          severity: 'WARNING',
          description: `${recentFailed.length} tentativi falliti - possibile brute-force`
        };
      }
      
      return { name: 'Login falliti (24h)', ok: true, count: recentFailed.length };
    } catch (err) {
      return { name: 'Login falliti (24h)', ok: true, count: 0 };
    }
  }

  async checkDatabaseConnection() {
    try {
      const pg = require('./pg-connection-manager');
      await pg.query('SELECT 1');
      return { name: 'Connessione Database', ok: true };
    } catch (err) {
      return {
        name: 'Connessione Database',
        ok: false,
        severity: 'CRITICAL',
        description: `Database non raggiungibile: ${err.message}`
      };
    }
  }

  async checkBlockchainConnection() {
    try {
      const { ethers } = require('ethers');
      const rpcUrl = process.env.POLYGON_RPC_URL || 
                     (process.env.POLYGON_RPC_URLS || '').split(',')[0] ||
                     'https://polygon-rpc.com';
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      await provider.getBlockNumber();
      return { name: 'Connessione Blockchain', ok: true };
    } catch (err) {
      return {
        name: 'Connessione Blockchain',
        ok: false,
        severity: 'WARNING',
        description: `RPC non raggiungibile: ${err.message}`
      };
    }
  }

  // ========================================
  // TEST
  // ========================================

  /**
   * Invia messaggio di test
   */
  async sendTestMessage() {
    const message = [
      `🧪 TEST SISTEMA ALLERTA ROG`,
      ``,
      `Questo è un messaggio di prova.`,
      ``,
      `✅ Sistema di allerta configurato correttamente!`,
      ``,
      `Destinatari:`,
      `- ISABEL CRISTINA`,
      `- Lilly Castagneto`,
      ``,
      `Eventi monitorati:`,
      `- 🔐 Login falliti`,
      `- 💰 Transazioni sospette`,
      `- 💥 Errori critici`,
      `- 🛡️ Problemi sicurezza`,
      `- 📊 Report giornaliero (24h)`
    ].join('\n');

    return await this.sendAlert(message, 'INFO');
  }
}

// Export singleton
const telegramAlertManager = new TelegramAlertManager();
module.exports = telegramAlertManager;
