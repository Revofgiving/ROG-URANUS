/**
 * 🌀 URANO — API Server
 *
 * POST /api/dona                    — dono 20 USDC → 2 posizioni (HUMAN + CASSA)
 * POST /api/inizializza             — bootstrap
 * POST /api/account/registra        — registrazione con contenitore
 * GET  /api/account/:wallet         — info account
 * GET  /api/contenitori             — stato contenitori
 * GET  /api/stato                   — stato sistema
 * GET  /api/tavola/:numero          — dettaglio tavola
 * GET  /api/tavole                  — lista tavole (filtri: livello, turno, status)
 * GET  /api/turni                   — lista turni
 * GET  /api/funzioni/:wallet        — funzioni di un account
 * GET  /api/storico/:wallet         — storico avanzamenti
 * GET  /api/regole                  — costanti e livelli
 * GET  /api/regole/simula-uscita    — simulatore uscita
 * GET  /api/percorso/:wallet        — predisposizione completa: Sole + Blocco1 + Nettuno
 * GET  /api/async-queue/stato       — stato coda operazioni background
 * POST /api/admin/blocca            — kill switch
 * POST /api/admin/sblocca
 * GET  /api/admin/stato
 * GET  /api/health
 */
'use strict';

require('dotenv').config();

const express          = require('express');
const { initSecurity } = require('./security-manager');
const pg               = require('./pg-connection-manager');
const db               = require('./db-manager');
const flow             = require('./donation-flow-manager');
const accountManager   = require('./account-manager');
const containerManager = require('./container-manager');
const rules            = require('./rules-engine');

const bridge           = require('./bridge-manager');
const queue            = require('./queue-manager');
const goldConverter    = require('./gold-converter');

const securityHardener = require('./security-hardener');

const app  = express();
const PORT = process.env.PORT || 4000;

// 🌐 CORS — DEVE essere PRIMA del security hardener
// così anche le risposte di errore (429, 403) includono gli header CORS
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS.includes('*') ? '*' : origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 🛡️ Security Hardener — dopo CORS
app.use(securityHardener.middleware());

initSecurity(app);
app.use(express.json({ limit: '10kb' }));

// HTTPS redirect (skip per health check e richieste interne/localhost)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    const host = req.headers.host || '';
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return next();
    if (req.headers['x-forwarded-proto'] !== 'https') return res.redirect(301, 'https://' + host + req.url);
    next();
  });
}

// Kill switch middleware
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/admin') || req.path === '/api/health') return next();
  try {
    if (await db.isSistemaBlocato()) {
      const stato = await db.getStatoBlocco();
      return res.status(503).json({ error: 'Sistema bloccato', motivo: stato.motivo, timestamp: stato.timestamp });
    }
  } catch (_) {}
  next();
});

// ── HEALTH ──
app.get('/api/health', (_, res) => res.json({ status: 'ok', sistema: 'SUPERURANO', versione: '4.0.0', timestamp: new Date().toISOString() }));

// ── INIZIALIZZAZIONE ──
app.post('/api/inizializza', async (req, res) => {
  if (!safeCompare(req.headers['x-admin-key'], process.env.ADMIN_API_KEY)) return res.status(401).json({ error: 'Chiave admin non valida' });
  try { res.json({ success: true, stato: await flow.inizializzaSistema() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DONO (20 USDC → 2 posizioni) — CODA ASINCRONA (1.000+ donazioni/min) ──
const donationQueue = require('./donation-queue');

app.post('/api/dona', async (req, res) => {
  const { wallet, txHash, numeroPosizioni, nome } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  if (!txHash) return res.status(400).json({ error: 'txHash obbligatorio' });
  try {
    // Accoda e ritorna subito — il worker processa in background
    const queued = await donationQueue.enqueue({ wallet, txHash, numeroPosizioni, nome });
    res.json({ success: true, ...queued });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Polling stato donazione (frontend chiama ogni 2s)
app.get('/api/dona/status/:jobId', async (req, res) => {
  try {
    const status = await donationQueue.getStatus(req.params.jobId);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Statistiche coda (admin)
app.get('/api/dona/queue-stats', (req, res) => {
  res.json({ success: true, stats: donationQueue.getStats() });
});

// ── VERIFICA PREREQUISITI ROG (usato dal frontend prima del pagamento) ──
const rogChecker = require('./rog-prerequisite-checker');
app.get('/api/rog-status/:wallet', async (req, res) => {
  const wallet = (req.params.wallet || '').toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const status = await rogChecker.checkAllPrerequisites(wallet);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROXY: Registra wallet nella community ROG (evita CORS) ──
app.post('/api/rog/register-community', async (req, res) => {
  const wallet = (req.body?.wallet || '').toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const result = await rogChecker.registerCommunityOnRog(wallet);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROXY: Registra donazione ROG (evita CORS) ──
app.post('/api/rog/register-donation', async (req, res) => {
  const { donationId, donor, amount, txHash } = req.body || {};
  if (!donor || !txHash) return res.status(400).json({ error: 'donor e txHash obbligatori' });
  try {
    const result = await rogChecker.registerDonationOnRog({ donationId, donor, amount, txHash });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ACCOUNT ──
app.post('/api/account/registra', async (req, res) => {
  try {
    const { wallet, nome, dichiarazioneDono } = req.body;
    const result = await accountManager.registraAccount({ wallet, nome, dichiarazioneDono });
    res.json(result);
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/account/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const info = await accountManager.getAccountInfo(wallet);
    if (!info) return res.status(404).json({ success: false, error: 'Account non trovato' });
    res.json({ success: true, account: info });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CONTENITORI ──
app.get('/api/contenitori', async (_, res) => {
  try { res.json({ success: true, contenitori: await containerManager.getStatoContenitori() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATO ──
app.get('/api/stato', async (_, res) => {
  try { res.json({ success: true, ...(await flow.getStatoSistema()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TAVOLE ──
app.get('/api/tavola/:numero', async (req, res) => {
  try {
    const numero = Number(req.params.numero);
    const tavola = await db.getTavola(numero);
    if (!tavola) return res.status(404).json({ error: 'Tavola non trovata' });
    const posizioni = await db.getPosizioniTavola(tavola.id);
    res.json({ success: true, tavola, posizioni });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/tavole', async (req, res) => {
  try {
    const { livello, turno, status } = req.query;
    let sql = 'SELECT * FROM tavole WHERE 1=1';
    const params = [];
    if (livello !== undefined) { params.push(Number(livello)); sql += ` AND livello = $${params.length}`; }
    if (turno !== undefined) { params.push(Number(turno)); sql += ` AND turno = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY numero ASC LIMIT 100';
    const tavole = await pg.queryMany(sql, params);
    res.json({ success: true, tavole, count: tavole.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TURNI ──
app.get('/api/turni', async (req, res) => {
  try {
    const { sezione, livello, status } = req.query;
    let sql = 'SELECT * FROM turni WHERE 1=1';
    const params = [];
    if (sezione) { params.push(sezione); sql += ` AND sezione = $${params.length}`; }
    if (livello !== undefined) { params.push(Number(livello)); sql += ` AND livello = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY numero_turno DESC LIMIT 50';
    const turni = await pg.queryMany(sql, params);
    res.json({ success: true, turni, count: turni.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FUNZIONI ──
app.get('/api/funzioni/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const funzioni = await db.getFunzioniByOrigine(wallet);
    res.json({ success: true, funzioni, count: funzioni.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── STORICO ──
app.get('/api/storico/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const storico = await pg.queryMany(
      'SELECT * FROM storico_avanzamenti WHERE wallet = $1 ORDER BY created_at DESC LIMIT 50', [wallet]
    );
    res.json({ success: true, storico, count: storico.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── REGOLE ──
app.get('/api/regole', (_, res) => {
  res.json({
    success: true,
    importi: rules.IMPORTI,
    livelli: require('./table-manager').LIVELLI,
    tokenAccettati: {
      USDC: { simbolo: 'USDC', decimali: 6, minDonazione: '20.00 USDC' },
      XAUt0: {
        simbolo: 'XAUt0', decimali: 6,
        minDonazione: goldConverter.formatWithUsdc(goldConverter.usdcToXaut(20), 'XAUt0'),
        prezzoOro: goldConverter.getGoldPrice(),
        nota: 'Ogni importo in XAUt0 viene mostrato con equivalente USDC'
      },
    },
  });
});

app.get('/api/regole/simula-uscita', (req, res) => {
  try {
    const { livello, tipoAccount, doniRicevuti } = req.query;
    const result = rules.calcolaUscitaLivello(Number(livello), tipoAccount || 'PRIMARIO', Number(doniRicevuti));
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ── ADMIN ──
function safeCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const crypto = require('crypto');
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function checkAdmin(req, res) {
  if (!safeCompare(req.headers['x-admin-key'], process.env.ADMIN_API_KEY)) {
    res.status(401).json({ error: 'Chiave admin non valida' }); return false;
  }
  return true;
}

// ── ADMIN LOGIN (pannello admin) ──
// Spostato dal frontend Next.js: il frontend gira come sito statico (Pinata/IPFS)
// e non può leggere process.env a runtime. Le credenziali stanno qui sul server.
app.post('/api/admin/auth', (req, res) => {
  const username = (req.body?.username || '').trim();
  const password = (req.body?.password || '').trim();
  const expectedUser = (process.env.ADMIN_USERNAME || '').trim();
  const expectedPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ success: false, error: 'Configurazione admin non presente sul server' });
  }
  const valid = safeCompare(username, expectedUser) && safeCompare(password, expectedPass);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Credenziali non valide' });
  }
  res.json({ success: true, session: { username: expectedUser, loggedAt: new Date().toISOString() } });
});

app.post('/api/admin/blocca', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { motivo } = req.body;
  if (!motivo?.trim()) return res.status(400).json({ error: 'Motivo obbligatorio' });
  try {
    await db.bloccaSistema(motivo.trim());
    try { const a = require('./alert-manager'); a.sendAlert('CRITICAL', 'SISTEMA_BLOCCATO', `URANO bloccato: ${motivo}`); } catch (_) {}
    res.json({ success: true, motivo: motivo.trim(), timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/sblocca', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try { await db.sbloccaSistema(); res.json({ success: true, timestamp: new Date().toISOString() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stato', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try { res.json({ ...(await flow.getStatoSistema()), blocco: await db.getStatoBlocco() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// 🛡️ Security Hardener Status (admin only)
app.get('/api/admin/security', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({
    success: true,
    hardener: securityHardener.getStatus(),
    banList: securityHardener.getBanList(),
  });
});

app.post('/api/admin/security/ban', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { ip, reason } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip obbligatorio' });
  securityHardener.manualBanIP(ip, reason || 'Manual admin ban');
  res.json({ success: true, banned: ip });
});

app.post('/api/admin/security/unban', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip obbligatorio' });
  securityHardener.manualUnbanIP(ip);
  res.json({ success: true, unbanned: ip });
});

// ── DONI PENDENTI + MESSAGGI ──
const giftManager = require('./gift-manager');

// Doni pendenti per un wallet (bottone ACCETTA DONO)
app.get('/api/doni-pendenti/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const doni = await giftManager.getDoniPendenti(wallet);
    res.json({ success: true, doni, count: doni.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accetta un dono
app.post('/api/dono/accetta/:id', async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const result = await giftManager.accettaDono(Number(req.params.id), wallet);
    res.json(result);
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Storico doni
app.get('/api/doni-storico/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const storico = await giftManager.getStoricoDoni(wallet);
    res.json({ success: true, storico, count: storico.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messaggi per un wallet (chat sistema)
app.get('/api/messaggi/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const messaggi = await giftManager.getMessaggi(wallet);
    const nonLetti = await giftManager.contaNonLetti(wallet);
    res.json({ success: true, messaggi, nonLetti, count: messaggi.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Segna messaggi come letti
app.post('/api/messaggi/letti', async (req, res) => {
  const { wallet, messageIds } = req.body;
  if (!wallet || !messageIds?.length) return res.status(400).json({ error: 'wallet e messageIds obbligatori' });
  try {
    await giftManager.segnaLetti(wallet, messageIds);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── KYC STATUS ──
const kycBridge = require('./kyc-bridge');

app.get('/api/kyc/status/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const status = await kycBridge.getKycStatusForWallet(wallet);
    res.json({ success: true, kyc: status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kyc/stats', (_, res) => {
  res.json({ success: true, kycStats: kycBridge.getCacheStats() });
});

// ── PREDISPOSIZIONI ──
const predisposizione = require('./predisposizione-manager');

app.get('/api/predisposizione/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const pred = await predisposizione.getPredisposizione(wallet);
    if (!pred) return res.status(404).json({ success: false, error: 'Nessuna predisposizione trovata' });
    res.json({ success: true, predisposizione: pred });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/predisposizioni/turno/:turno', async (req, res) => {
  try {
    const turno = Number(req.params.turno);
    const preds = await predisposizione.getPredisposizioniPerTurno(turno);
    res.json({ success: true, turno, predisposizioni: preds, count: preds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/predisposizioni/stato', async (_, res) => {
  try {
    const stato = await predisposizione.getStatoPredisposizioni();
    res.json({ success: true, stato });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FIFO (URANO 1) ──
app.get('/api/fifo/stato', async (_, res) => {
  try { res.json({ success: true, ...(await bridge.getStatoBridge()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fifo/coda', async (req, res) => {
  try {
    const pg = require('./pg-connection-manager');
    const { status, limit } = req.query;
    let sql = 'SELECT * FROM coda_fifo WHERE 1=1';
    const params = [];
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY posizione ASC';
    if (limit) { params.push(Number(limit)); sql += ` LIMIT $${params.length}`; }
    else { sql += ' LIMIT 100'; }
    const coda = await pg.queryMany(sql, params);
    res.json({ success: true, coda, count: coda.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fifo/uscite', async (req, res) => {
  try {
    const pg = require('./pg-connection-manager');
    const uscite = await pg.queryMany('SELECT * FROM storico_uscite_fifo ORDER BY numero_uscita DESC LIMIT 50');
    res.json({ success: true, uscite, count: uscite.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bridge/log', async (req, res) => {
  try {
    const pg = require('./pg-connection-manager');
    const log = await pg.queryMany('SELECT * FROM bridge_log ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, log, count: log.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POSIZIONE (per dashboard frontend) ──
app.get('/api/posizione/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    // Account
    const account = await pg.queryOne(
      'SELECT wallet, nome, ticket_number, tipo, status FROM accounts WHERE wallet = $1', [wallet]
    );
    if (!account) return res.status(404).json({ success: false, error: 'Account non trovato' });

    // Posizioni attive con info tavola
    const posizioni = await pg.queryMany(
      `SELECT p.id, p.tavola_id, p.casella, p.tipo, p.dono_importo,
              t.numero AS tavola_numero, t.livello, t.status AS tavola_status,
              CASE WHEN t.livello = 0 AND t.tipo = 'PERCORSO'
                   THEN (t.turno - 1) * 6 + p.casella
                   ELSE NULL END AS numero_posizione
       FROM posizioni p
       JOIN tavole t ON t.id = p.tavola_id
       WHERE p.wallet = $1
       ORDER BY t.livello ASC, t.turno ASC, p.casella ASC`,
      [wallet]
    );

    // Uscite FIFO
    const uscite = await pg.queryMany(
      'SELECT * FROM storico_uscite_fifo WHERE wallet = $1 ORDER BY numero_uscita DESC', [wallet]
    );

    // Rientri (posizioni in coda FIFO che sono rientri)
    const rientri = await pg.queryMany(
      'SELECT * FROM coda_fifo WHERE wallet = $1 AND is_rientro = true ORDER BY posizione ASC', [wallet]
    );

    res.json({ success: true, account, posizioni, uscite, rientri });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── UTENTI (lista per pannello admin) ──
// Spostato dal frontend Next.js (route /api/utenti) verso il backend, perché il
// frontend statico su Pinata non può eseguire route handler server-side.
// Aggregazione efficiente: un solo JOIN accounts + posizioni invece di N+1 fetch.
app.post('/api/utenti', async (req, res) => {
  if (!checkAdmin(req, res)) return; // solo admin: richiede header X-Admin-Key === ADMIN_API_KEY
  try {
    const body = req.body || {};
    const page = Math.max(1, Number(body.page || 1));
    const perPage = 20;
    const search = String(body.search || '').trim().toLowerCase();
    const statusFilter = String(body.status || '').trim().toLowerCase();

    const rows = await pg.queryMany(
      `SELECT a.wallet, a.nome, a.status, a.tipo, a.created_at,
              COUNT(p.id) AS positions_count
       FROM accounts a
       JOIN posizioni p ON p.wallet = a.wallet
       WHERE a.tipo NOT IN ('FONDO', 'CASSA')
       GROUP BY a.wallet, a.nome, a.status, a.tipo, a.created_at`
    );

    const normalizeStatus = (s) =>
      ['ATTIVO', 'IN_CODA', 'REGISTRATO'].includes(String(s || '').toUpperCase())
        ? 'active'
        : 'inactive';

    let users = rows.map((r) => {
      const wallet = String(r.wallet || '').toLowerCase();
      const positionsCount = Number(r.positions_count) || 0;
      const name = (r.nome || '').trim() || `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
      return {
        id: 0,
        name,
        email: wallet,
        registeredAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        positionsCount,
        totalDonated: positionsCount * 20,
        status: normalizeStatus(r.status),
      };
    });

    if (search) {
      users = users.filter(
        (u) => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)
      );
    }
    if (statusFilter === 'active' || statusFilter === 'inactive') {
      users = users.filter((u) => u.status === statusFilter);
    }

    users.sort((a, b) => Date.parse(b.registeredAt) - Date.parse(a.registeredAt));

    const total = users.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const paged = users.slice(start, start + perPage).map((u, idx) => ({ ...u, id: start + idx + 1 }));

    res.json({ users: paged, total, totalPages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── FLUSSI ESTERNI (per admin frontend) ──
app.get('/api/flussi-esterni', async (req, res) => {
  try {
    const flussi = await pg.queryMany('SELECT * FROM flussi_esterni ORDER BY created_at DESC LIMIT 200');
    const totali = await pg.queryOne(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo LIKE 'ROG_SMALL%' THEN importo ELSE 0 END), 0) AS rog_small,
        COALESCE(SUM(CASE WHEN tipo = 'ROG' THEN importo ELSE 0 END), 0) AS rog,
        COALESCE(SUM(CASE WHEN tipo = 'RIENTRI_SOLE' THEN importo ELSE 0 END), 0) AS rientri_sole
      FROM flussi_esterni
    `);
    res.json({
      success: true,
      flussi,
      totali: {
        rog_small: Number(totali.rog_small),
        rog: Number(totali.rog),
        rientriSole: Number(totali.rientri_sole)
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PERCORSO COMPLETO (Sole + Blocco1 + Nettuno) ──
app.get('/api/percorso/:wallet', async (req, res) => {
  const wallet = req.params.wallet?.toLowerCase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Wallet non valido' });
  try {
    const percorso = await predisposizione.calcolaPredisposizioneCompleta(wallet);
    res.json({ success: true, percorso });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ASYNC QUEUE STATO (monitoring background tasks) ──
app.get('/api/async-queue/stato', (_, res) => {
  const asyncQ = require('./async-queue');
  res.json({ success: true, asyncQueue: asyncQ.getStatus() });
});

// ── ON-CHAIN STATS (UranusRegistry) ──
app.get('/api/onchain/stato', async (_, res) => {
  try {
    const chainRegistrar = require('./chain-registrar');
    const stats = await chainRegistrar.getOnChainStats();
    const status = chainRegistrar.getStatus();
    res.json({ success: true, onchain: stats, registrar: status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CROSS-PLATFORM STATUS ──
app.get('/api/cross-platform/stato', (_, res) => {
  const crossPlatform = require('./cross-platform-bridge');
  res.json({ success: true, crossPlatform: crossPlatform.getStatus() });
});

// ── CROSS-PLATFORM INCOMING (ricevi richieste da ROG/PHARAOH) ──
const crossPlatform = require('./cross-platform-bridge');

/**
 * POST /api/cross/dona — Ricevi donazione/ingresso da ROG o PHARAOH
 *
 * Protocollo cross-piattaforma standardizzato:
 *   { platform, wallet, importo, numPosizioni, tipo, origine }
 *
 * Crea REALMENTE le posizioni in URANUS (Sole L0).
 * ROG e PHARAOH usano lo stesso endpoint per inviare ingressi a URANUS.
 */
app.post('/api/cross/dona', crossPlatform.crossPlatformAuth, async (req, res) => {
  const { wallet, importo, numPosizioni, tipo, origine } = req.body;
  const from = req.crossPlatformOrigin;
  console.log(`\n🌐 [CrossPlatform] DONAZIONE IN ARRIVO da ${from}: ${wallet} — ${importo} USDC — ${numPosizioni} posizioni — tipo: ${tipo}`);

  if (!wallet || !importo) {
    return res.status(400).json({ error: 'wallet e importo obbligatori' });
  }

  try {
    const w = wallet.toLowerCase();
    const n = Math.max(1, Number(numPosizioni) || Math.floor(importo / 20));
    const posizioni = [];

    // Crea posizioni reali nel sistema URANUS (Sole L0)
    for (let i = 0; i < n; i++) {
      const rCassa = await flow.posizionaDonatoreEntrataCross(
        process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002',
        `CASSA cross da ${from} #${i + 1}`
      );
      const rHuman = await flow.posizionaDonatoreEntrataCross(
        w, `${from} cross #${i + 1} (${tipo})`
      );
      posizioni.push({ cassa: rCassa, human: rHuman });
    }

    // Registra in flussi_esterni
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [`CROSS_IN_${from}_${tipo || 'DONA'}`, w, importo, n * 2, origine || from]
    );

    // Registra on-chain
    const chainRegistrar = require('./chain-registrar');
    chainRegistrar.registerBridgeEvent(w, `CROSS_IN_${tipo || 'DONA'}`, importo, from);

    console.log(`   ✅ Creati ${n * 2} posizioni URANUS per ${from} → ${w}`);
    res.json({ success: true, posizioni: posizioni.length, dettaglio: posizioni });
  } catch (e) {
    console.error(`   ❌ Cross dona ERRORE: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/cross/rog-small — Ricevi ingressi ROG_SMALL da ROG
 * ROG invia qui quando un utente ROG genera ingressi destinati a URANUS.
 */
app.post('/api/cross/rog-small', crossPlatform.crossPlatformAuth, async (req, res) => {
  const { wallet, numIngressi, importoTotale, origine } = req.body;
  const from = req.crossPlatformOrigin;
  console.log(`🌐 [CrossPlatform] ROG_SMALL in arrivo da ${from}: ${wallet} — ${numIngressi} ingressi — ${importoTotale} USDC`);

  try {
    const w = (wallet || '').toLowerCase();
    const n = Number(numIngressi) || 1;

    for (let i = 0; i < n; i++) {
      await flow.posizionaDonatoreEntrataCross(
        process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002',
        `CASSA ROG_SMALL da ${from} #${i + 1}`
      );
      await flow.posizionaDonatoreEntrataCross(w, `ROG_SMALL da ${from} #${i + 1}`);
    }

    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ('CROSS_IN_ROG_SMALL', $1, $2, $3, $4) RETURNING *`,
      [w, importoTotale || n * 2, n * 2, origine || from]
    );

    res.json({ success: true, ingressi: n, posizioni: n * 2 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/cross/ingresso — Ricevi ingresso generico da PHARAOH
 * PHARAOH invia qui quando un utente PHARAOH genera ingressi destinati a URANUS.
 */
app.post('/api/cross/ingresso', crossPlatform.crossPlatformAuth, async (req, res) => {
  const { wallet, importo, origine } = req.body;
  const from = req.crossPlatformOrigin;
  console.log(`🌐 [CrossPlatform] INGRESSO da ${from}: ${wallet} — ${importo} USDC`);

  try {
    const w = (wallet || '').toLowerCase();
    const n = Math.max(1, Math.floor((importo || 20) / 20));

    for (let i = 0; i < n; i++) {
      await flow.posizionaDonatoreEntrataCross(
        process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002',
        `CASSA ingresso da ${from} #${i + 1}`
      );
      await flow.posizionaDonatoreEntrataCross(w, `Ingresso da ${from} #${i + 1}`);
    }

    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [`CROSS_IN_${from}_INGRESSO`, w, importo || 20, n * 2, origine || from]
    );

    res.json({ success: true, ingressi: n, posizioni: n * 2 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/cross/kyc-status — Un'altra piattaforma chiede lo stato KYC di un wallet
 */
app.post('/api/cross/kyc-status', crossPlatform.crossPlatformAuth, async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet obbligatorio' });
  try {
    const status = await kycBridge.getKycStatusForWallet(wallet);
    res.json({ success: true, wallet: wallet.toLowerCase(), verified: status.db?.status === 'VERIFIED', kyc: status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/cross/notifica — Notifica generica da un'altra piattaforma
 */
app.post('/api/cross/notifica', crossPlatform.crossPlatformAuth, async (req, res) => {
  console.log(`🌐 [CrossPlatform] Notifica da ${req.crossPlatformOrigin}:`, req.body);
  try {
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        `CROSS_${req.crossPlatformOrigin}_${req.body.eventType || 'NOTIFICA'}`,
        req.body.wallet || 'SISTEMA',
        req.body.importo || 0,
        req.body.numPosizioni || 0,
        req.body.origine || req.crossPlatformOrigin
      ]
    );
    res.json({ success: true, received: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 404 ──
app.use((_, res) => res.status(404).json({ success: false, error: 'Endpoint non trovato' }));

// ── START ──
app.listen(PORT, async () => {
  console.log(`\n🌀 SUPERURANO v4 Backend — URANO 2 (tavole) + Nettuno (FIFO)`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   20 USDC → Sole → Luna → Mercurio → Venere → Giove → Saturno → Nettuno → Uranus`);
  console.log(`   Percorso: L0(Sole)→L1(Luna)→L2(Mercurio)→L3(Venere)→L4(Giove)→L5(Saturno) → Nettuno(FIFO) → Uranus\n`);
  try { await db.initDatabase(); } catch (err) { console.error('❌ DB:', err.message); }
  // Inizializza coda donazioni asincrona
  try { await donationQueue.initQueueTable(); } catch (err) { console.error('❌ DonationQueue:', err.message); }
});

module.exports = app;
