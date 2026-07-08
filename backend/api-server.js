/**
 * 🚀 ROG API SERVER - Express.js Backend
 * 
 * Server API REST per il sistema ROG con:
 * - Autenticazione staff NASA-LEVEL
 * - Gestione anagrafica
 * - Distribuzione doni
 * - CORS configurato
 * - Rate limiting
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 17 Novembre 2025
 */

const express = require('express');
const cors = require('cors');
const promClient = require('prom-client');
const authManager = require('./auth-manager');
const dbUnifiedPg = require('./db-unified-manager-pg'); // PostgreSQL unified stats manager
const pgConn = require('./pg-connection-manager');
const areaPersonaleManager = require('./area-personale-manager');
const { registerMediaUploadEndpoints } = require('./media-upload-manager');
const donationFlowManager = require('./donation-flow-manager');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Inizializza Express (prima di qualsiasi uso di app)
const app = express();
const PORT = process.env.PORT || 3000;

const ANAGRAFICA_POSIZIONI_FILE = path.join(__dirname, 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');
// ANAGRAFICA INVITATI rimossa - PostgreSQL (tabella anagrafica_invitati) è l'unica fonte di verità
const ISCRIZIONI_COMMUNITY_FILE = path.join(__dirname, 'database', 'ISCRIZIONI_COMMUNITY.txt');

const SUGGESTED_WALLETS_FILE = path.join(__dirname, 'suggested-wallets.json');

function loadSuggestedWallets() {
  try {
    const raw = fs.readFileSync(SUGGESTED_WALLETS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return { suggestions: [] };
  }
}

function saveSuggestedWallets(data) {
  try {
    fs.writeFileSync(SUGGESTED_WALLETS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Errore salvataggio suggested-wallets:', error);
  }
}
const zkKYCManager = require('./zkkyc-manager');
const referralManager = require('./referral-manager');
const communityRegistrationManager = require('./community-registration-manager');
const { notifyWalletNotFound } = require('./support-mailer');
const galleryManager = require('./gallery-manager-local');
const galleryAPI = require('./gallery-api-local');
const maintenanceManager = require('./maintenance-manager');
const reportGenerator = require('./src/26-pannello-controllo/report-generator');
const pendingDonationStore = require('./pending-donation-store');
const giftIntentStore = require('./gift-intent-store');

// In modalità PostgreSQL-only non usiamo più SQLite a runtime.
// Se manca DATABASE_URL, consideriamo la configurazione non valida.
if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
  throw new Error('DATABASE_URL non configurato: il backend ROG richiede PostgreSQL (niente SQLite).');
}

const HAS_POSTGRES = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);
let dbUnifiedSqlite = null;

// SQLite è caricato solo in ambienti legacy senza PostgreSQL.
if (!HAS_POSTGRES) {
  try {
    // eslint-disable-next-line global-require
    dbUnifiedSqlite = require('./db-unified-manager');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ api-server: db-unified-manager (SQLite) non disponibile:', err.message);
  }
}

const anagraficaManager = (() => {
  // NOTA: il vecchio anagrafica-manager file JS è stato archiviato.
  // Qui creiamo un piccolo stub con solo i metodi minimi che servono
  // agli endpoint di questo server. In produzione usiamo il sistema
  // centralizzato su PostgreSQL (db-unified-manager-pg) per ottenere
  // i dati reali dell'anagrafica.
  let manager;
  try {
    manager = require('./anagrafica-manager');
  } catch (err) {
    console.warn('⚠️  anagrafica-manager legacy non presente, uso stub minimale su PostgreSQL');
    manager = {
      async contaPosizioni() {
        const stats = await dbUnifiedPg.getSystemStats();
        return stats?.total_positions || 0;
      }
    };
  }
  return manager;
})();

const cassaROGManager = require('./cassa-rog-manager');
const movementStats = require('./movement-stats');
const positionLookup = require('./position-lookup');

// Calcola la generazione HN a partire dal numero di molecola (1,2,4,8,16...)
function getGenerazioneDaMolecola(numeroMolecola) {
  const n = Number(numeroMolecola);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(Math.log2(n)) + 1;
}

// ============================================
// CROSS-PLATFORM AUTH (URANUS → ROG)
// ============================================

const CROSS_PLATFORM_SECRET = process.env.CROSS_PLATFORM_SECRET || '';

function computeSignature(body) {
  if (!CROSS_PLATFORM_SECRET) return '';
  return crypto
    .createHmac('sha256', CROSS_PLATFORM_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

function verifySignature(body, signature) {
  if (!CROSS_PLATFORM_SECRET) return true;
  const expected = computeSignature(body);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch (_) {
    return false;
  }
}

function crossPlatformAuth(req, res, next) {
  const signature = req.headers['x-platform-signature'];
  const origin = req.headers['x-platform-origin'];
  if (!origin) {
    return res.status(400).json({ success: false, error: 'X-Platform-Origin mancante' });
  }
  if (origin !== 'URANUS') {
    return res.status(403).json({ success: false, error: 'Origine non autorizzata' });
  }
  if (CROSS_PLATFORM_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ success: false, error: 'Firma non valida' });
  }
  req.crossPlatformOrigin = origin;
  next();
}

// ============================================
// PROMETHEUS METRICS SETUP
// ============================================

// Abilita raccolta metriche default (CPU, RAM, etc)
promClient.collectDefaultMetrics({ timeout: 5000 });

// CONTATORI ROG
const httpRequestsTotal = new promClient.Counter({
  name: 'rog_http_requests_total',
  help: 'Numero totale richieste HTTP ROG',
  labelNames: ['method', 'endpoint', 'status']
});

/**
 * GET /api/admin/rog/missing-positions
 * Elenco transazioni valide senza posizioni generate (caso eccezionale).
 * Filtri: txHash, wallet, limit
 */
app.get('/api/admin/rog/missing-positions', adminAuthMiddleware, async (req, res) => {
  try {
    const accessLevel = String(req.authSession?.accessLevel || '').toUpperCase();
    if (!['SUPER_ADMIN', 'ADMIN'].includes(accessLevel)) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const { txHash, wallet, limit } = req.query;
    const maxRows = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 100;

    const params = [];
    const where = [
      "(tx_hash IS NOT NULL AND tx_hash <> '')",
      "(positions_created IS NULL OR positions_created <= 0)"
    ];
    let idx = 1;

    if (txHash) {
      where.push(`LOWER(tx_hash) = LOWER($${idx})`);
      params.push(String(txHash).trim());
      idx++;
    }

    if (wallet) {
      where.push(`LOWER(donor_wallet) = LOWER($${idx})`);
      params.push(String(wallet).trim());
      idx++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pool = pgConn.getPool();
    const result = await pool.query(
      `SELECT
         donation_id,
         tx_hash,
         log_index,
         donation_type,
         amount_usdc,
         ts,
         donor_wallet,
         beneficiary_wallet,
         positions_created,
         first_position,
         last_position
       FROM donations
       ${whereSql}
       ORDER BY ts DESC NULLS LAST, id DESC
       LIMIT ${maxRows}`,
      params
    );

    return res.json({ success: true, count: result.rows.length, items: result.rows });
  } catch (error) {
    console.error('Errore /api/admin/rog/missing-positions:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

const httpRequestDuration = new promClient.Histogram({
  name: 'rog_http_request_duration_seconds',
  help: 'Durata richieste HTTP in secondi',
  labelNames: ['method', 'endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const authLoginAttempts = new promClient.Counter({
  name: 'rog_auth_login_attempts_total',
  help: 'Tentativi login totali',
  labelNames: ['status'] // success, failed
});

const authActiveSessions = new promClient.Gauge({
  name: 'rog_auth_active_sessions',
  help: 'Sessioni attive correnti'
});

const anagraficaTotal = new promClient.Gauge({
  name: 'rog_anagrafica_total_positions',
  help: 'Numero totale posizioni anagrafica'
});

const cassaROGBalance = new promClient.Gauge({
  name: 'rog_cassa_balance_usdc',
  help: 'Bilancio CASSA ROG in USDC',
  labelNames: ['sezione'] // ACCUMULI, DONI, PONTI, etc
});

// WEB3 METRICS
const web3TransactionsTotal = new promClient.Counter({
  name: 'rog_web3_transactions_total',
  help: 'Transazioni blockchain totali',
  labelNames: ['status', 'type'] // success/failed, donation/withdrawal/etc
});

const web3GasPriceGwei = new promClient.Gauge({
  name: 'rog_web3_gas_price_gwei',
  help: 'Gas price corrente in Gwei'
});

const web3WalletBalance = new promClient.Gauge({
  name: 'rog_web3_wallet_balance_eth',
  help: 'Balance wallet ROG in ETH'
});

const web3BlockNumber = new promClient.Gauge({
  name: 'rog_web3_block_number',
  help: 'Ultimo block number processato'
});

// Funzione helper per aggiornare metriche Web3 (chiamata periodicamente)
async function updateWeb3Metrics() {
  try {
    // Qui integrerai con ethers.js per leggere dati blockchain
    // Per ora mettiamo placeholder che puoi aggiornare dopo
    
    // Esempio: web3GasPriceGwei.set(gasPrice);
    // Esempio: web3WalletBalance.set(balance);
    // Esempio: web3BlockNumber.set(blockNumber);
  } catch (error) {
    console.error('Errore aggiornamento metriche Web3:', error);
  }
}

// Aggiorna metriche Web3 ogni 30 secondi
setInterval(updateWeb3Metrics, 30000);

// Middleware per tracciare tutte le richieste
function prometheusMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const endpoint = req.route?.path || req.path;
    
    httpRequestsTotal.inc({
      method: req.method,
      endpoint,
      status: res.statusCode
    });
    
    httpRequestDuration.observe({
      method: req.method,
      endpoint
    }, duration);
  });
  
  next();
}


// Middleware CORS - usa whitelist di cors-config.js
const { corsOptions } = require('./cors-config');
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prometheus middleware (prima di tutti gli altri)
app.use(prometheusMiddleware);

// Logger middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// MIDDLEWARE AUTENTICAZIONE STAFF
// ============================================

/**
 * Middleware generico per endpoint admin protetti (staff dashboard, media, ecc.).
 * Verifica il token e, opzionalmente, un insieme minimo di permessi.
 */
async function adminAuthMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    // Allego info utente alla richiesta per eventuali controlli più fini
    req.authSession = verification.session;
    req.authUser = verification.user;

    next();
  } catch (error) {
    console.error('Errore adminAuthMiddleware:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
}

// ============================================
// MIDDLEWARE AUTENTICAZIONE INTERNA (server-to-server)
// ============================================

/**
 * Protegge gli endpoint chiamati SOLO da backend fidati (es. URANUS),
 * NON dal browser. Richiede header `X-Internal-Key` (oppure
 * `Authorization: Bearer <key>`) uguale a process.env.ROG_INTERNAL_API_KEY.
 * Confronto timing-safe. Fail-closed: se la chiave non e' configurata,
 * l'endpoint interno resta bloccato (503).
 */
function requireInternalApiKey(req, res, next) {
  const crypto = require('crypto');
  const expected = process.env.ROG_INTERNAL_API_KEY;

  if (!expected) {
    console.error('\ud83d\udd12 [InternalAuth] ROG_INTERNAL_API_KEY non configurato \u2014 endpoint interno bloccato');
    return res.status(503).json({ success: false, error: 'Servizio non configurato' });
  }

  const provided =
    req.headers['x-internal-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ success: false, error: 'Chiave interna non valida' });
  }

  next();
}

function normalizeWallet(w) {
  return String(w || '').trim().toLowerCase();
}

function isValidWalletFormat(w) {
  return /^0x[a-f0-9]{40}$/.test(normalizeWallet(w));
}
// ============================================
// BRIDGE URANUS → ROG (ROG SMALL L3)
// ============================================

app.post('/api/cross/uranus/rog-small', crossPlatformAuth, async (req, res) => {
  const {
    event_key,
    wallet_origine,
    wallet_beneficiario,
    wallet_cassa,
    num_ingressi,
    importo_totale,
    origine
  } = req.body || {};

  const eventKey = String(event_key || '').trim();
  const walletOrigine = normalizeWallet(wallet_origine);
  const walletBeneficiario = normalizeWallet(wallet_beneficiario);
  const walletCassa = normalizeWallet(wallet_cassa);
  const numIngressi = Number(num_ingressi);
  const importoTotale = Number(importo_totale);
  const source = String(origine || 'URANUS_L3').toUpperCase();

  if (!eventKey) {
    return res.status(400).json({ success: false, error: 'event_key obbligatoria' });
  }
  if (!isValidWalletFormat(walletBeneficiario) || !isValidWalletFormat(walletCassa)) {
    return res.status(400).json({ success: false, error: 'Wallet beneficiario o cassa non valido' });
  }
  if (walletOrigine && !isValidWalletFormat(walletOrigine)) {
    return res.status(400).json({ success: false, error: 'Wallet origine non valido' });
  }
  if (!Number.isFinite(numIngressi) || numIngressi <= 0) {
    return res.status(400).json({ success: false, error: 'num_ingressi non valido' });
  }

  try {
    await pgConn.initDatabase();

    // Idempotenza: crea record se non esiste
    await pgConn.query(
      `INSERT INTO uranus_bridge_events (event_key, source, wallet_origine, wallet_beneficiario, wallet_cassa, importo_ricevuto, posizioni_attese, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
       ON CONFLICT (event_key) DO NOTHING`,
      [
        eventKey,
        source,
        walletOrigine || null,
        walletBeneficiario,
        walletCassa,
        Number.isFinite(importoTotale) ? importoTotale : null,
        Number.isFinite(numIngressi) ? numIngressi : null
      ]
    );

    const pre = await pgConn.queryOne(
      'SELECT * FROM uranus_bridge_events WHERE event_key = $1',
      [eventKey]
    );
    if (pre && pre.status === 'COMPLETED') {
      return res.json({
        success: true,
        event_key: pre.event_key,
        status: 'COMPLETED',
        source: pre.source,
        wallet_origine: pre.wallet_origine,
        wallet_beneficiario: pre.wallet_beneficiario,
        wallet_cassa: pre.wallet_cassa,
        importo_ricevuto: pre.importo_ricevuto,
        importo_utilizzato: pre.importo_utilizzato,
        posizioni: pre.posizioni,
        tx_hash: pre.tx_hash,
        updated_at: pre.updated_at
      });
    }
    if (pre && pre.status === 'FAILED') {
      return res.json({ success: false, status: 'FAILED', error: pre.error || 'Bridge failed' });
    }

    return res.json({
      success: true,
      event_key: eventKey,
      status: 'PENDING',
      source,
      wallet_origine: walletOrigine || null,
      wallet_beneficiario: walletBeneficiario,
      wallet_cassa: walletCassa,
      importo_ricevuto: Number.isFinite(importoTotale) ? importoTotale : null,
      posizioni_attese: Number.isFinite(numIngressi) ? numIngressi : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Errore /api/cross/uranus/rog-small:', error);
    return res.status(500).json({ success: false, error: error.message || 'Errore interno' });
  }
});

function sqliteAllAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows || []);
    });
  });
}

// ============================================
// COMMUNITY REGISTRATION (ISCRIZIONI_COMMUNITY.txt)
// ============================================

let communitySeedPromise = null;
let communityWalletSet = null; // Set<string> lowercase

function parseCommunityFileToMap(raw) {
  const map = new Map(); // walletLower -> timestamp
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+/);
    const walletLower = normalizeWallet(parts[0]);
    if (!isValidWalletFormat(walletLower)) continue;
    if (!map.has(walletLower)) {
      map.set(walletLower, parts[1] ? String(parts[1]).trim() : '');
    }
  }
  return map;
}

async function ensureCommunityFileSeeded() {
  if (communitySeedPromise) return communitySeedPromise;

  communitySeedPromise = (async () => {
    // 1) Assicura che il file esista
    try {
      if (!fs.existsSync(ISCRIZIONI_COMMUNITY_FILE)) {
        fs.writeFileSync(ISCRIZIONI_COMMUNITY_FILE, '', 'utf8');
      }
    } catch (e) {
      console.warn('⚠️  Impossibile creare ISCRIZIONI_COMMUNITY.txt:', e.message || e);
    }

    // 2) Carica e deduplica quanto già presente nel file
    let existing = new Map();
    try {
      const raw = fs.readFileSync(ISCRIZIONI_COMMUNITY_FILE, 'utf8');
      existing = parseCommunityFileToMap(raw);
    } catch (_) {
      // ignore
    }

    // 3a) Carica wallet registrati da PostgreSQL community_registrations (fonte di verità)
    // Questo garantisce che dopo ogni riavvio del server la cache sia popolata dal DB,
    // evitando che gli utenti già registrati debbano registrarsi di nuovo.
    if (HAS_POSTGRES) {
      try {
        const pool = pgConn.getPool();
        const pgResult = await pool.query(
          `SELECT LOWER(wallet_address) AS wallet FROM community_registrations WHERE wallet_address IS NOT NULL`
        );
        for (const row of pgResult.rows) {
          const w = normalizeWallet(row.wallet);
          if (isValidWalletFormat(w) && !existing.has(w)) {
            existing.set(w, '');
          }
        }
        console.log(`✅ Community cache caricata da PostgreSQL: ${pgResult.rowCount} wallet`);
      } catch (pgErr) {
        console.warn('⚠️  Impossibile caricare community_registrations da PostgreSQL:', pgErr.message);
      }
    }

    // 3b) Seed da DB canonico (wallet_master) per includere tutti gli HUMAN una sola volta
    // In ambiente PostgreSQL-only NON tocchiamo SQLite; il seed verrà gestito
    // con strumenti dedicati lato Postgres. Manteniamo solo la lettura da file.
    let dbWallets = [];
    if (!HAS_POSTGRES && dbUnifiedSqlite) {
      try {
        dbUnifiedSqlite.initDatabases();
        const { master } = dbUnifiedSqlite.getDb();
        if (!master) throw new Error('DB master non inizializzato');

        const rows = await sqliteAllAsync(
          master,
          `SELECT DISTINCT wallet FROM wallet_master
           WHERE wallet IS NOT NULL AND wallet != ''
             AND LOWER(tipo) = 'human'
           ORDER BY wallet ASC`
        );

        dbWallets = rows
          .map(r => normalizeWallet(r.wallet))
          .filter(w => isValidWalletFormat(w));
      } catch (e) {
        console.warn('⚠️  Seed community da DB (SQLite) fallito, procedo solo con file:', e.message || e);
      }
    }

    const seededAt = new Date().toISOString();
    for (const w of dbWallets) {
      if (!existing.has(w)) {
        existing.set(w, seededAt);
      }
    }

    // 4) Riscrive il file deduplicato (formato: wallet\ttimestamp)
    try {
      const out = Array.from(existing.entries())
        .map(([wallet, ts]) => `${wallet}\t${ts || seededAt}`)
        .join('\n');
      fs.writeFileSync(ISCRIZIONI_COMMUNITY_FILE, out ? `${out}\n` : '', 'utf8');
    } catch (e) {
      console.warn('⚠️  Impossibile riscrivere ISCRIZIONI_COMMUNITY.txt:', e.message || e);
    }

    communityWalletSet = new Set(existing.keys());
  })();

  return communitySeedPromise;
}

async function registerCommunityWallet(walletAddress, timestamp) {
  const walletLower = normalizeWallet(walletAddress);
  if (!isValidWalletFormat(walletLower)) {
    return { ok: false, status: 400, error: 'Wallet non valido' };
  }

  await ensureCommunityFileSeeded();
  if (!communityWalletSet) communityWalletSet = new Set();

  if (communityWalletSet.has(walletLower)) {
    return { ok: true, alreadyRegistered: true, wallet: walletLower };
  }

  const ts = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

  // Aggiorna cache PRIMA del write (per evitare duplicati in race interne al processo)
  communityWalletSet.add(walletLower);

  try {
    // Assicura che la directory esista (es. in Docker la cartella 'database/' potrebbe non esserci)
    const dir = path.dirname(ISCRIZIONI_COMMUNITY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(ISCRIZIONI_COMMUNITY_FILE, `${walletLower}\t${ts}\n`, 'utf8');
  } catch (e) {
    // Il write su file è legacy: se fallisce (es. Docker read-only), logghiamo ma NON blocchiamo.
    // La registrazione andrà avanti su PostgreSQL che è la fonte di verità.
    console.warn(`⚠️  registerCommunityWallet: write file fallito (non bloccante): ${e.message}`);
  }

  return { ok: true, alreadyRegistered: false, wallet: walletLower };
}

async function getCommunityRegistrationStatus(wallet) {
  const walletLower = normalizeWallet(wallet);
  if (!isValidWalletFormat(walletLower)) {
    return { ok: false, status: 400, payload: { success: false, registered: false, message: 'Formato wallet non valido' } };
  }

  await ensureCommunityFileSeeded();
  if (!communityWalletSet) communityWalletSet = new Set();

  const inFile = communityWalletSet.has(walletLower);

  let pgStatus = { registered: false };
  try {
    pgStatus = await communityRegistrationManager.isWalletRegistered(walletLower);
  } catch (e) {
    console.warn('Errore isWalletRegistered (PostgreSQL) in community status:', e.message || e);
    pgStatus = { registered: false, error: 'PG_ERROR' };
  }

  const registered = !!(inFile || pgStatus.registered);

  return {
    ok: true,
    status: 200,
    payload: {
      success: true,
      registered,
      isRegistered: registered,
      wallet: walletLower,
      sources: {
        file: inFile,
        postgres: !!pgStatus.registered
      }
    }
  };
}

function findWalletInAnagraficaFile(walletLower, maxResults = 50) {
  const results = [];
  try {
    const content = fs.readFileSync(ANAGRAFICA_POSIZIONI_FILE, 'utf8');
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
          results.push({ posizione, nome });
          if (results.length >= maxResults) break;
        }
      }
    }
  } catch (_) {
    // ignore
  }

  return results;
}

/**
 * Ottiene invitanti per posizioni da PostgreSQL (unica fonte di verità)
 */
async function getInvitanteForPositions(posizioni) {
  const out = {};
  if (!Array.isArray(posizioni) || posizioni.length === 0) return out;

  const validPositions = posizioni.map(n => Number(n)).filter(Number.isFinite);
  if (validPositions.length === 0) return out;

  try {
    const pool = pgConn.getPool();
    const result = await pool.query(`
      SELECT 
        invitato_pos as posizione,
        invitante_wallet as "walletInvitante"
      FROM anagrafica_invitati
      WHERE invitato_pos = ANY($1)
    `, [validPositions]);
    
    for (const row of result.rows) {
      out[row.posizione] = {
        nomeInvitante: 'Sconosciuto', // Nome non più memorizzato
        walletInvitante: row.walletInvitante,
      };
    }
  } catch (err) {
    console.error('Errore getInvitanteForPositions:', err.message);
  }

  return out;
}

// ============================================
// ENDPOINT COMMUNITY
// ============================================

/**
 * POST /api/register-community
 * Body: { walletAddress, timestamp }
 * Registra un wallet nella community (ISCRIZIONI_COMMUNITY.txt) con dedupe.
 */
app.post('/api/register-community', async (req, res) => {
  try {
    const walletAddress = req.body?.walletAddress || req.body?.wallet || req.body?.address;
    const referrerWallet = req.body?.referrerWallet || req.body?.referrer || req.body?.ref || null;
    const timestamp = req.body?.timestamp;

    console.log(`\ud83d\udcdd Registrazione community: wallet=${walletAddress}, referrer=${referrerWallet || 'none'}`);

    // 1) Registra nel file ISCRIZIONI_COMMUNITY.txt (legacy, per compatibilità)
    const result = await registerCommunityWallet(walletAddress, timestamp);
    if (!result.ok) {
      return res.status(result.status || 500).json({
        success: false,
        error: result.error || 'Errore interno'
      });
    }

    // 2) Registra in PostgreSQL (fonte primaria) usando CommunityRegistrationManager
    //    IMPORTANTE: Passa il referrerWallet se presente
    let pgPayload = { success: true };
    try {
      pgPayload = await communityRegistrationManager.registerWallet(
        walletAddress,
        referrerWallet,
        { source: 'frontend-register-community' }
      );
      
      if (pgPayload.success && referrerWallet) {
        console.log(`\u2705 Registrato con referrer: ${referrerWallet}`);
      }
    } catch (e) {
      console.error('Errore registerWallet (PostgreSQL) durante /api/register-community:', e.message || e);
      pgPayload = { success: false, error: e.message };
    }

    return res.json({
      success: true,
      wallet: result.wallet,
      referrer: referrerWallet,
      alreadyRegistered: result.alreadyRegistered || pgPayload.alreadyRegistered === true,
      pgSync: pgPayload.success !== false
    });
  } catch (error) {
    console.error('Errore /api/register-community:', error);
    return res.status(500).json({ success: false, error: 'Errore interno del server' });
  }
});

/**
 * GET /api/community/status/:wallet
 * Ritorna se un wallet è iscritto alla community (file legacy + PostgreSQL).
 * Endpoint pubblico usato dal frontend donation.html: restituisce solo stato booleano.
 */
app.get('/api/community/status/:wallet', async (req, res) => {
  try {
    const rawWallet = req.params.wallet;
    if (!rawWallet) {
      return res.status(400).json({ success: false, registered: false, message: 'Wallet richiesto' });
    }

    const result = await getCommunityRegistrationStatus(rawWallet);
    return res.status(result.status).json(result.payload);
  } catch (error) {
    console.error('Errore /api/community/status:', error);
    return res.status(500).json({ success: false, registered: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/community/is-registered/:wallet
 * Alias legacy per build frontend vecchie che chiamano ancora is-registered.
 */
app.get('/api/community/is-registered/:wallet', async (req, res) => {
  try {
    const rawWallet = req.params.wallet;
    if (!rawWallet) {
      return res.status(400).json({ success: false, registered: false, isRegistered: false, message: 'Wallet richiesto' });
    }

    const result = await getCommunityRegistrationStatus(rawWallet);
    return res.status(result.status).json(result.payload);
  } catch (error) {
    console.error('Errore /api/community/is-registered:', error);
    return res.status(500).json({ success: false, registered: false, isRegistered: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/donation-since/:wallet?since=YYYY-MM-DD&minUsdc=2
 * Ritorna se il wallet ha una donazione ROG qualificante (>= minUsdc USDC)
 * a partire dalla data `since` (default 2026-06-08).
 * Usato dal gate URANUS: vale SOLO una donazione ROG dall'8 giugno 2026 in poi.
 */
app.get('/api/donation-since/:wallet', requireInternalApiKey, async (req, res) => {
  try {
    const wallet = normalizeWallet(req.params.wallet);
    if (!isValidWalletFormat(wallet)) {
      return res.status(400).json({ success: false, qualifies: false, message: 'Formato wallet non valido' });
    }

    const sinceRaw = String(req.query.since || '').trim();
    const since = /^\d{4}-\d{2}-\d{2}/.test(sinceRaw)
      ? new Date(sinceRaw).toISOString()
      : '2026-06-08T00:00:00.000Z';

    const minUsdc = Number.isFinite(Number(req.query.minUsdc)) ? Number(req.query.minUsdc) : 2;

    const result = await dbUnifiedPg.hasDonationSince(wallet, since, minUsdc);
    return res.json({ success: true, since, minUsdc, ...result });
  } catch (error) {
    console.error('Errore /api/donation-since:', error);
    return res.status(500).json({ success: false, qualifies: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT AUTENTICAZIONE WALLET ("GIÀ ISCRITTO")
// ============================================

/**
 * POST /api/wallet-auth
 * PUNTO 64-68: Verifica wallet utente dalla homepage "Già Iscritto"
 * 
 * Body: { wallet: string }
 * 
 * Flusso:
 * - Utente clicca "GIÀ ISCRITTO" (punto 64-65)
 * - MetaMask si connette e passa il wallet (punto 66)
 * - Sistema verifica in PostgreSQL (punto 67)
 * - Se NON trovato → email a supporto (punto 68)
 * - Se trovato → ritorna dati per area personale
 */
app.post('/api/wallet-auth', async (req, res) => {
  try {
    const wallet = req.body?.wallet || req.body?.walletAddress;

    if (!wallet) {
      return res.status(400).json({
        success: false,
        walletTrovato: false,
        message: 'Wallet richiesto'
      });
    }

    const walletNorm = normalizeWallet(wallet);
    if (!isValidWalletFormat(walletNorm)) {
      return res.status(400).json({
        success: false,
        walletTrovato: false,
        message: 'Formato wallet non valido'
      });
    }

    console.log(`\n🔍 WALLET-AUTH: Verifica wallet ${walletNorm}`);

    // PUNTO 67: Verifica se wallet esiste in PostgreSQL
    let posizioni = [];
    let walletInfo = null;

    try {
      posizioni = await dbUnifiedPg.getWalletPositions(walletNorm) || [];
      walletInfo = await dbUnifiedPg.getWalletStats(walletNorm);
    } catch (dbErr) {
      console.error('❌ Errore DB in wallet-auth:', dbErr.message);
      // Continuiamo con array vuoto
    }

    // PUNTO 68: Se wallet NON trovato → email al supporto
    if (!posizioni || posizioni.length === 0) {
      console.log(`   ❌ Wallet NON trovato in database`);

      // Invia email a revolutionofgivingrog@protonmail.com
      try {
        await notifyWalletNotFound(wallet);
        console.log(`   📧 Email inviata al supporto ROG`);
      } catch (mailErr) {
        console.error('   ⚠️  Errore invio email (SMTP non configurato?):', mailErr.message);
      }

      return res.json({
        success: false,
        walletTrovato: false,
        message: 'Wallet non trovato nell\'anagrafica ROG. Il supporto è stato notificato e ti contatterà a breve per verificare i tuoi dati.',
        emailInviata: true
      });
    }

    // Wallet trovato - prepara risposta per area personale
    console.log(`   ✅ Wallet TROVATO: ${posizioni.length} posizioni`);

    // Prima posizione (minima)
    const posizioniOrdinate = posizioni
      .map(p => ({ ...p, posizione: Number(p.posizione) }))
      .filter(p => Number.isFinite(p.posizione))
      .sort((a, b) => a.posizione - b.posizione);

    const primaPosizione = posizioniOrdinate[0] || null;

    return res.json({
      success: true,
      walletTrovato: true,
      wallet: walletNorm,
      totalePosizioni: posizioni.length,
      primaPosizione: primaPosizione ? {
        numero: primaPosizione.posizione,
        movimento: primaPosizione.movimento || 'SMALL'
      } : null,
      walletInfo: {
        totale_posizioni: walletInfo?.totale_posizioni || posizioni.length,
        movimento_max: walletInfo?.movimento_max || 'SMALL'
      },
      // Bottoni per schermata benvenuto (Punto 68)
      bottoni: {
        homepage: true,
        areaPersonale: true
      }
    });

  } catch (error) {
    console.error('Errore /api/wallet-auth:', error);
    return res.status(500).json({
      success: false,
      walletTrovato: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT AUTENTICAZIONE STAFF
// ============================================

/**
 * POST /api/auth/login
 * Login staff
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, ipAddress } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username e password richiesti'
      });
    }

    // Ottieni IP reale
    const clientIP = ipAddress || req.ip || req.connection.remoteAddress;

    // Login
    const result = await authManager.login(username, password, clientIP);

    // Traccia metriche login
    authLoginAttempts.inc({ status: result.success ? 'success' : 'failed' });
    
    if (result.success) {
      // Aggiorna sessioni attive
      const stats = await authManager.getStatistics();
      authActiveSessions.set(stats.activeSessions);
      
      return res.json(result);
    } else {
      return res.status(401).json(result);
    }

  } catch (error) {
    console.error('Errore login:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout staff
 */
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token non fornito'
      });
    }

    const result = await authManager.logout(token);
    return res.json(result);

  } catch (error) {
    console.error('Errore logout:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/auth/verify
 * Verifica validità token
 */
app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(400).json({
        valid: false,
        message: 'Token non fornito'
      });
    }

    const result = await authManager.verifyToken(token);
    return res.json(result);

  } catch (error) {
    console.error('Errore verifica token:', error);
    return res.status(500).json({
      valid: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/auth/stats
 * Statistiche autenticazione (solo SUPER_ADMIN)
 */
app.get('/api/auth/stats', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    // Verifica permesso
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const stats = await authManager.getStatistics();
    return res.json({ success: true, stats });

  } catch (error) {
    console.error('Errore statistiche:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT SUGGESTED WALLETS (LISTA D'ATTESA)
// ============================================

/**
 * POST /api/suggest-wallet
 * Body: { suggestedWallet, suggesterWallet }
 * Salva un wallet in lista d'attesa e registra relazione di invito
 * (suggester → suggested) tramite ReferralManager.
 */
app.post('/api/suggest-wallet', async (req, res) => {
  try {
    const { suggestedWallet, suggesterWallet } = req.body || {};

    if (!suggestedWallet || !suggesterWallet) {
      return res.status(400).json({ success: false, message: 'suggestedWallet e suggesterWallet sono obbligatori' });
    }

    const walletRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!walletRegex.test(suggestedWallet) || !walletRegex.test(suggesterWallet)) {
      return res.status(400).json({ success: false, message: 'Wallet non valido. Deve iniziare con 0x e contenere 40 caratteri esadecimali.' });
    }

    const suggestedNorm = suggestedWallet.toLowerCase();
    const suggesterNorm = suggesterWallet.toLowerCase();

    // Aggiorna file suggested-wallets.json
    const current = loadSuggestedWallets();
    current.suggestions = current.suggestions || [];

    const already = current.suggestions.find(
      s => s.suggestedWallet?.toLowerCase() === suggestedNorm && s.suggesterWallet?.toLowerCase() === suggesterNorm
    );

    if (!already) {
      current.suggestions.push({
        suggestedWallet: suggestedNorm,
        suggesterWallet: suggesterNorm,
        source: 'dono-al-volo',
        status: 'PENDING',
        createdAt: new Date().toISOString()
      });
      saveSuggestedWallets(current);
    }

    // Registra anche la relazione di invito (suggester = invitante, suggested = invitato)
    try {
      const donorName = await donationFlowManager.getDonorName(suggesterNorm);
      await referralManager.registraInvito({
        walletInvitato: suggestedNorm,
        walletInvitante: suggesterNorm,
        nomeInvitante: donorName
      });
    } catch (invErr) {
      console.error('Errore registrazione invito (suggest-wallet):', invErr.message || invErr);
    }

    return res.json({ success: true, alreadyExists: !!already });
  } catch (error) {
    console.error('Errore /api/suggest-wallet:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT ADMIN DEBUG (STAFF)
// ============================================

/**
 * GET /api/admin/debug/wallet/:wallet
 * Debug: verifica presenza wallet in Postgres e nei file legacy anagrafica.
 * Richiede token staff con permesso VIEW_LOGS.
 */
app.get('/api/admin/debug/wallet/:wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const wallet = normalizeWallet(req.params.wallet);
    if (!isValidWalletFormat(wallet)) {
      return res.status(400).json({ success: false, message: 'Wallet non valido' });
    }

    // 1) Postgres
    let pgWallet = null;
    let pgPositions = [];
    let pgError = null;
    try {
      pgWallet = await dbUnifiedPg.getWallet(wallet);
      pgPositions = await dbUnifiedPg.getWalletPositions(wallet);
    } catch (e) {
      pgError = String(e?.message || e);
    }

    // 2) File legacy (solo anagrafica posizioni, invitati sono in PostgreSQL)
    const filePositions = findWalletInAnagraficaFile(wallet, 200);
    const invitantiByPos = await getInvitanteForPositions(filePositions.map(p => p.posizione));

    return res.json({
      success: true,
      wallet,
      postgres: {
        ok: !pgError,
        error: pgError,
        walletRow: pgWallet,
        positionsCount: Array.isArray(pgPositions) ? pgPositions.length : 0,
        positionsSample: Array.isArray(pgPositions) ? pgPositions.slice(0, 20) : []
      },
      legacyFiles: {
        anagraficaPath: ANAGRAFICA_POSIZIONI_FILE,
        invitatiSource: 'PostgreSQL (anagrafica_invitati)',
        positionsCount: filePositions.length,
        positions: filePositions,
        invitantiByPos
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/debug/wallet:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/admin/doni
 * Elenco donazioni (standard / carta-regalo / dono-al-volo / rientro) filtrabili.
 * Query params:
 *   - wallet: filtra per donor o beneficiary
 *   - position: filtra per posizione compresa tra first_position e last_position
 *   - type: standard|carta-regalo|dono-al-volo|rientro
 *   - limit: massimo risultati (default 100)
 */
app.get('/api/admin/doni', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const { wallet, position, type, limit, role } = req.query;
    const walletNorm = wallet ? normalizeWallet(wallet) : null;
    const posNum = position ? Number(position) : null;
    const maxRows = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 100;
    const roleFilter = (role || '').toLowerCase(); // '', 'donor', 'beneficiary'

    const params = [];
    const where = [];
    let idx = 1;

    // Filtro per wallet + ruolo (donor/beneficiary)
    if (walletNorm && isValidWalletFormat(walletNorm)) {
      if (roleFilter === 'donor') {
        where.push(`donor_wallet = $${idx}`);
        params.push(walletNorm);
        idx++;
      } else if (roleFilter === 'beneficiary') {
        where.push(`beneficiary_wallet = $${idx}`);
        params.push(walletNorm);
        idx++;
      } else {
        // default: qualsiasi ruolo (donor o beneficiario)
        where.push(`(donor_wallet = $${idx} OR beneficiary_wallet = $${idx + 1})`);
        params.push(walletNorm, walletNorm);
        idx += 2;
      }
    }

    // Filtro per posizione singola: posizione compresa nel range first_position..last_position
    if (Number.isFinite(posNum) && posNum > 0) {
      where.push(`first_position <= $${idx} AND last_position >= $${idx}`);
      params.push(posNum);
      idx++;
    }

    // Filtro per tipo donazione
    if (type) {
      const t = String(type).toLowerCase();

      if (t === 'carta-regalo') {
        // Carta Regalo = donation_type='standard' + payload.donation.isGift === true
        where.push("donation_type = 'standard' AND payload->'donation'->>'isGift' = 'true'");
      } else if (t === 'standard' || t === 'dono-al-volo' || t === 'rientro') {
        where.push(`donation_type = $${idx}`);
        params.push(t);
        idx++;
      }
      // altri valori di type vengono ignorati
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const q = `
      SELECT
        donation_id,
        tx_hash,
        log_index,
        donation_type,
        amount_usdc,
        ts,
        positions_created,
        first_position,
        last_position,
        donor_wallet,
        beneficiary_wallet,
        payload
      FROM donations
      ${whereSql}
      ORDER BY ts DESC, id DESC
      LIMIT ${maxRows}
    `;

    const pool = require('./pg-connection-manager').getPool();
    const result = await pool.query(q, params);

    const rows = result.rows || [];

    const donations = rows.map(row => {
      const payload = row.payload || {};
      const don = payload.donation || {};
      const positions = payload.positions || {};

      // Calcola riassunto molecole dalle posizioni create (se presenti nel payload)
      let molecoleSummary = null;
      const posArray = Array.isArray(positions.posizioni) ? positions.posizioni : [];
      if (posArray.length > 0) {
        const molSet = new Set();
        for (const p of posArray) {
          if (!p) continue;
          if (p.molecola == null) continue;
          const n = Number(p.molecola);
          if (!Number.isFinite(n)) continue;
          molSet.add(n);
        }
        if (molSet.size > 0) {
          const sorted = Array.from(molSet).sort((a, b) => a - b);
          molecoleSummary = sorted.join(',');
        }
      }

      return {
        donationId: row.donation_id || null,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        tipo: row.donation_type,
        amountUSDC: row.amount_usdc,
        timestamp: row.ts,
        positionsCreated: row.positions_created ?? don.positionsCreated ?? null,
        firstPosition: row.first_position ?? don.firstPosition ?? null,
        lastPosition: row.last_position ?? don.lastPosition ?? null,
        donorWallet: row.donor_wallet,
        beneficiaryWallet: row.beneficiary_wallet ?? don.beneficiaryWallet ?? null,
        isGift: don.isGift === true,
        movement: positions.movimento || null,
        molecole: molecoleSummary
      };
    });

    return res.json({
      success: true,
      count: donations.length,
      donations
    });
  } catch (error) {
    console.error('Errore /api/admin/doni:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * PUT /api/admin/wallet/update
 * Permette agli admin di modificare il wallet address di un utente.
 * Utile quando un utente ha fornito un wallet non-MetaMask (es. Phantom)
 * che deve essere sostituito con un wallet MetaMask valido.
 * 
 * Body: {
 *   oldWallet: string,  // wallet corrente da sostituire
 *   newWallet: string   // nuovo wallet MetaMask
 * }
 * 
 * Richiede token staff con permesso VIEW_LOGS.
 */
app.put('/api/admin/wallet/update', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const { oldWallet, newWallet } = req.body || {};

    if (!oldWallet || !newWallet) {
      return res.status(400).json({
        success: false,
        message: 'oldWallet e newWallet sono obbligatori'
      });
    }

    const oldWalletNorm = normalizeWallet(oldWallet);
    const newWalletNorm = normalizeWallet(newWallet);

    if (!isValidWalletFormat(oldWalletNorm) || !isValidWalletFormat(newWalletNorm)) {
      return res.status(400).json({
        success: false,
        message: 'Formato wallet non valido. Deve iniziare con 0x e contenere 40 caratteri esadecimali.'
      });
    }

    if (oldWalletNorm === newWalletNorm) {
      return res.status(400).json({
        success: false,
        message: 'Il nuovo wallet è uguale al wallet corrente'
      });
    }

    // Verifica che il wallet vecchio esista nel sistema
    const oldWalletData = await dbUnifiedPg.getWallet(oldWalletNorm);
    if (!oldWalletData) {
      return res.status(404).json({
        success: false,
        message: `Wallet corrente ${oldWalletNorm} non trovato nel sistema`
      });
    }

    // Verifica che il nuovo wallet non sia già registrato
    const newWalletData = await dbUnifiedPg.getWallet(newWalletNorm);
    if (newWalletData) {
      return res.status(409).json({
        success: false,
        message: `Il nuovo wallet ${newWalletNorm} è già registrato nel sistema`
      });
    }

    const pool = require('./pg-connection-manager').getPool();

    // Esegui l'aggiornamento in una transazione
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Aggiorna wallet_positions
      const positionsResult = await client.query(
        'UPDATE wallet_positions SET wallet = $1 WHERE wallet = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 2. Aggiorna wallet_master
      await client.query(
        'UPDATE wallet_master SET wallet = $1 WHERE wallet = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 3. Aggiorna donations (donor_wallet)
      await client.query(
        'UPDATE donations SET donor_wallet = $1 WHERE donor_wallet = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 4. Aggiorna donations (beneficiary_wallet)
      await client.query(
        'UPDATE donations SET beneficiary_wallet = $1 WHERE beneficiary_wallet = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 5. Aggiorna referrals (wallet_invitato)
      await client.query(
        'UPDATE referrals SET wallet_invitato = $1 WHERE wallet_invitato = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 6. Aggiorna referrals (wallet_invitante)
      await client.query(
        'UPDATE referrals SET wallet_invitante = $1 WHERE wallet_invitante = $2',
        [newWalletNorm, oldWalletNorm]
      );

      // 7. Aggiorna community_registrations (se esiste)
      try {
        await client.query(
          'UPDATE community_registrations SET wallet_address = $1 WHERE LOWER(wallet_address) = $2',
          [newWalletNorm, oldWalletNorm]
        );
      } catch (e) {
        // Tabella potrebbe non esistere in alcuni setup
        console.warn('⚠️ community_registrations non aggiornata:', e.message);
      }

      // 8. Aggiorna zkkyc_verifications (se esiste)
      try {
        await client.query(
          'UPDATE zkkyc_verifications SET wallet = $1 WHERE LOWER(wallet) = $2',
          [newWalletNorm, oldWalletNorm]
        );
      } catch (e) {
        console.warn('⚠️ zkkyc_verifications non aggiornata:', e.message);
      }

      await client.query('COMMIT');

      // Log dell'operazione
      const adminUser = req.authUser || {};
      console.log(`✅ Wallet aggiornato da admin ${adminUser.username || 'unknown'}: ${oldWalletNorm} → ${newWalletNorm}`);
      console.log(`   Posizioni aggiornate: ${positionsResult.rowCount}`);

      return res.json({
        success: true,
        message: 'Wallet aggiornato con successo',
        oldWallet: oldWalletNorm,
        newWallet: newWalletNorm,
        positionsUpdated: positionsResult.rowCount
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Errore /api/admin/wallet/update:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/report-inviti/:wallet
 * Report completo per admin: carte regalo, doni al volo e invitati per un wallet.
 * Richiede token staff con permesso VIEW_LOGS.
 */
app.get('/api/admin/report-inviti/:wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const walletRaw = req.params.wallet;
    const wallet = normalizeWallet(walletRaw);
    if (!isValidWalletFormat(wallet)) {
      return res.status(400).json({ success: false, message: 'Wallet non valido' });
    }

    // 1) Donazioni dove questo wallet è il DONOR (pagante)
    const q = `
      SELECT
        donation_id,
        tx_hash,
        log_index,
        donation_type,
        amount_usdc,
        ts,
        positions_created,
        first_position,
        last_position,
        donor_wallet,
        beneficiary_wallet,
        payload
      FROM donations
      WHERE donor_wallet = $1
      ORDER BY ts ASC, id ASC
    `;

    const donationsRes = await pgConn.query(q, [wallet]);
    const rows = donationsRes.rows || [];

    const carteRegaloPagate = [];
    const doniAlVoloPagati = [];
    const donazioniAltre = [];

    for (const row of rows) {
      const payload = row.payload || {};
      const don = payload.donation || {};
      const positions = payload.positions || {};

      const tipoDb = String(row.donation_type || '').toLowerCase();
      const tipoPayload = String(don.donationType || '').toLowerCase();
      const effectiveType = tipoPayload || tipoDb;

      const mapped = {
        donationId: row.donation_id || null,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        tipoDb: row.donation_type,
        tipoPayload: don.donationType || null,
        effectiveType,
        amountUSDC: row.amount_usdc,
        timestamp: row.ts,
        positionsCreatedDB: row.positions_created,
        firstPositionDB: row.first_position,
        lastPositionDB: row.last_position,
        donorWallet: row.donor_wallet,
        beneficiaryWalletDB: row.beneficiary_wallet,
        beneficiaryWalletPayload: don.beneficiaryWallet || null,
        isGiftPayload: don.isGift === true,
        positionsPayloadCount: Array.isArray(positions.posizioni) ? positions.posizioni.length : null
      };

      if (effectiveType === 'carta-regalo') {
        carteRegaloPagate.push(mapped);
      } else if (effectiveType === 'dono-al-volo') {
        doniAlVoloPagati.push(mapped);
      } else {
        donazioniAltre.push(mapped);
      }
    }

    // 2) Invitati dove questo wallet è INVITANTE
    const stats = await referralManager.getStatisticheInviti(wallet);
    const invitati = (stats.invitati || []).map(inv => ({
      posizione: inv.posizione ?? null,
      movimento: inv.movimento || null,
      walletInvitato: inv.wallet || null,
      nomeInvitato: inv.nome || null,
      dataInvito: inv.dataInvito || null
    }));

    return res.json({
      success: true,
      wallet,
      totals: {
        numeroInvitati: stats.numeroInvitati,
        invitatiSMALL: stats.invitatiSMALL,
        invitatiLARGE: stats.invitatiLARGE,
        carteRegaloPagate: carteRegaloPagate.length,
        doniAlVoloPagati: doniAlVoloPagati.length,
        donazioniTotaliPagate: rows.length
      },
      carteRegaloPagate,
      doniAlVoloPagati,
      donazioniAltre,
      invitati
    });
  } catch (error) {
    console.error('Errore /api/admin/report-inviti:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});
/**
 * GET /api/debug/donations-laura
 * Endpoint di debug NON autenticato per il wallet 0x8ae0e34e151598d496070d45024515e2ab213587.
 * Da usare solo temporaneamente per verifiche manuali.
 */
app.get('/api/debug/donations-laura', async (req, res) => {
  try {
    const wallet = '0x8ae0e34e151598d496070d45024515e2ab213587';

    const q = `
      SELECT
        donation_id,
        tx_hash,
        log_index,
        donation_type,
        amount_usdc,
        ts,
        positions_created,
        first_position,
        last_position,
        donor_wallet,
        beneficiary_wallet,
        payload
      FROM donations
      WHERE donor_wallet = $1
      ORDER BY ts ASC, id ASC
    `;

    const result = await pgConn.query(q, [wallet]);

    const donations = (result.rows || []).map(row => {
      const payload = row.payload || {};
      const don = payload.donation || {};
      const positions = payload.positions || {};

      return {
        donationId: row.donation_id || null,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        tipo: row.donation_type,
        amountUSDC: row.amount_usdc,
        timestamp: row.ts,
        positionsCreatedDB: row.positions_created,
        firstPositionDB: row.first_position,
        lastPositionDB: row.last_position,
        donorWallet: row.donor_wallet,
        beneficiaryWalletDB: row.beneficiary_wallet,
        beneficiaryWalletPayload: don.beneficiaryWallet || null,
        donationTypePayload: don.donationType || null,
        isGiftPayload: don.isGift,
        positionsPayloadCount: Array.isArray(positions.posizioni) ? positions.posizioni.length : null
      };
    });

    return res.json({
      success: true,
      wallet,
      count: donations.length,
      donations
    });
  } catch (error) {
    console.error('Errore /api/debug/donations-laura:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});
/**
 * GET /api/debug/donations-regalante-3a0f
 * Endpoint di debug NON autenticato per il wallet regalante 0x3a0Fde8d24C3C2b9448503a60d036E66417B2757.
 * Da usare solo temporaneamente per verifiche manuali.
 */
app.get('/api/debug/donations-regalante-3a0f', async (req, res) => {
  try {
    const wallet = '0x3a0Fde8d24C3C2b9448503a60d036E66417B2757'.toLowerCase();

    const q = `
      SELECT
        donation_id,
        tx_hash,
        log_index,
        donation_type,
        amount_usdc,
        ts,
        positions_created,
        first_position,
        last_position,
        donor_wallet,
        beneficiary_wallet,
        payload
      FROM donations
      WHERE donor_wallet = $1
      ORDER BY ts ASC, id ASC
    `;

    const result = await pgConn.query(q, [wallet]);

    const donations = (result.rows || []).map(row => {
      const payload = row.payload || {};
      const don = payload.donation || {};
      const positions = payload.positions || {};

      return {
        donationId: row.donation_id || null,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        tipo: row.donation_type,
        amountUSDC: row.amount_usdc,
        timestamp: row.ts,
        positionsCreatedDB: row.positions_created,
        firstPositionDB: row.first_position,
        lastPositionDB: row.last_position,
        donorWallet: row.donor_wallet,
        beneficiaryWalletDB: row.beneficiary_wallet,
        beneficiaryWalletPayload: don.beneficiaryWallet || null,
        donationTypePayload: don.donationType || null,
        isGiftPayload: don.isGift,
        positionsPayloadCount: Array.isArray(positions.posizioni) ? positions.posizioni.length : null
      };
    });

    return res.json({
      success: true,
      wallet,
      count: donations.length,
      donations
    });
  } catch (error) {
    console.error('Errore /api/debug/donations-regalante-3a0f:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});
/**
 * GET /api/admin/position/:numero
 * Debug rapido di una singola posizione.
 * Prima prova su PostgreSQL, poi (se mancante) fa fallback su anagrafica file.
 * Richiede token staff con permesso VIEW_LOGS.
 */
app.get('/api/admin/position/:numero', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const numero = Number(req.params.numero);
    if (!Number.isFinite(numero) || numero <= 0) {
      return res.status(400).json({ success: false, message: 'Numero posizione non valido' });
    }

    // 1) Fonte principale: PostgreSQL (wallet_positions + wallet_master)
    let pos = null;
    try {
      pos = await dbUnifiedPg.getPosition(numero);
    } catch (e) {
      console.error('Errore lettura posizione da PostgreSQL:', e.message || e);
    }

    if (pos) {
      let molecolaCompleta = [];
      try {
        // Recupera le posizioni della molecola direttamente da PostgreSQL
        const raw = await dbUnifiedPg.getMolecola(pos.molecola, pos.movimento || 'SMALL');

        // Generazione base della molecola (HN) dalla regola 1,2,4,8,16...
        const generazioneBase = getGenerazioneDaMolecola(pos.molecola) || pos.generazione || null;

        molecolaCompleta = Array.isArray(raw)
          ? raw.map(m => {
              let gen = generazioneBase;
              const pim = Number(m.posizione_in_molecola);

              if (Number.isFinite(pim)) {
                if (pim === 2 || pim === 3) {
                  // Ponti → Hn+1
                  gen = generazioneBase != null ? generazioneBase + 1 : generazioneBase;
                } else if (pim >= 4) {
                  // Donatori → Hn+2
                  gen = generazioneBase != null ? generazioneBase + 2 : generazioneBase;
                }
              }

              return {
                posizione: m.posizione,
                wallet: m.wallet,
                nome: m.nome || null,
                tipo: m.tipo || null,
                movimento: m.movimento,
                molecola: m.molecola,
                generazione: gen,
                ruolo: m.ruolo,
                posizione_in_molecola: m.posizione_in_molecola,
                stato: m.stato
              };
            })
          : [];
      } catch (e) {
        console.warn('Errore caricamento molecola completa per posizione', numero, e.message || e);
        molecolaCompleta = [];
      }

      return res.json({
        success: true,
        posizione: {
          posizione: pos.posizione,
          wallet: pos.wallet,
          nome: pos.nome || null,
          tipo: pos.tipo || null,
          movimento: pos.movimento,
          molecola: pos.molecola,
          generazione: pos.generazione,
          ruolo: pos.ruolo,
          posizione_in_molecola: pos.posizione_in_molecola,
          stato: pos.stato
        },
        molecolaCompleta
      });
    }

    // 2) Fallback legacy: anagrafica file (ROG_ANAGRAFICA_DEFINITIVA.txt)
    // Usa position-lookup per recuperare almeno wallet/nome/movimento
    try {
      const lookupResult = positionLookup.lookupPosition(String(numero));
      if (lookupResult && lookupResult.success && lookupResult.position) {
        const p = lookupResult.position;
        return res.json({
          success: true,
          posizione: {
            posizione: p.posizione,
            wallet: p.wallet || null,
            nome: p.nome || null,
            tipo: null,
            movimento: p.movimento || null,
            molecola: p.molecola || null,
            generazione: p.h_generazione || null,
            ruolo: p.ruolo || null,
            posizione_in_molecola: p.ciclo || null,
            stato: 'LEGACY_ONLY'
          }
        });
      }
    } catch (e) {
      console.error('Errore fallback position-lookup:', e.message || e);
    }

    return res.status(404).json({ success: false, message: 'Posizione non trovata' });
  } catch (error) {
    console.error('Errore /api/admin/position:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT ADMIN: LARGE DISTRIBUTION ENGINE
// ============================================

function parseBool(v, defaultValue = false) {
  if (v === undefined || v === null || v === '') return defaultValue;
  const s = String(v).trim().toLowerCase();
  return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
}

function parseIntSafe(v, defaultValue) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : defaultValue;
}

/**
 * GET /api/admin/large-distribution/tasks
 * Query:
 *  - statuses=PENDING,BLOCKED_KYC,FAILED (default: PENDING,BLOCKED_KYC)
 *  - limit=200
 */
app.get('/api/admin/large-distribution/tasks', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    if (HAS_POSTGRES) {
      return res.status(503).json({
        success: false,
        message: 'Large distribution engine non disponibile in modalità PostgreSQL-only (SQLite disabilitato).'
      });
    }

    const statusesRaw = String(req.query.statuses || 'PENDING,BLOCKED_KYC').trim();
    const statuses = statusesRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const limit = parseIntSafe(req.query.limit, 200);

    const tasks = await dbUnifiedSqlite.listDistributionTasks({
      movimento: 'LARGE',
      statuses,
      limit
    });

    return res.json({ success: true, count: tasks.length, tasks });
  } catch (error) {
    console.error('Errore /api/admin/large-distribution/tasks:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/admin/large-distribution/ready
 * Query:
 *  - includeAdvanced=true|false (default false)
 *  - limit=200
 */
app.get('/api/admin/large-distribution/ready', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    if (HAS_POSTGRES) {
      return res.status(503).json({
        success: false,
        message: 'Large distribution engine non disponibile in modalità PostgreSQL-only (SQLite disabilitato).'
      });
    }

    const includeAdvanced = parseBool(req.query.includeAdvanced, false);
    const limit = parseIntSafe(req.query.limit, 200);

    const ready = await dbUnifiedSqlite.listGenerationCyclesReady({
      movimento: 'LARGE',
      includeAdvanced,
      limit
    });

    return res.json({ success: true, count: ready.length, ready });
  } catch (error) {
    console.error('Errore /api/admin/large-distribution/ready:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/admin/large-distribution/tick
 * Body (tutti opzionali):
 *  - maxCompletions (default 500)
 *  - maxTasks (default 5)
 *  - executeOnChain (default false)
 *  - executeInternal (default false)
 *  - advanceIfReady (default false)
 */
app.post('/api/admin/large-distribution/tick', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    if (HAS_POSTGRES) {
      return res.status(503).json({
        success: false,
        message: 'Large distribution engine non disponibile in modalità PostgreSQL-only (SQLite disabilitato).'
      });
    }

    const body = req.body || {};

    const result = await largeDistributionEngine.tick({
      maxCompletions: parseIntSafe(body.maxCompletions, 500),
      maxTasks: parseIntSafe(body.maxTasks, 5),
      // SAFE DEFAULT: non esegue on-chain e non avanza; per eseguire davvero passare true esplicito.
      executeOnChain: parseBool(body.executeOnChain, false),
      executeInternal: parseBool(body.executeInternal, false),
      advanceIfReady: parseBool(body.advanceIfReady, false)
    });

    return res.json({ success: true, result });
  } catch (error) {
    console.error('Errore /api/admin/large-distribution/tick:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT ANAGRAFICA
// ============================================

/**
 * Restituisce la posizione massima rilevata dalle donazioni.
 * Usata come fallback per allineare i totali quando il conteggio anagrafica è in ritardo.
 */
async function getLatestDonationPositionFromPostgres() {
  if (!HAS_POSTGRES) return null;
  try {
    const pool = pgConn.getPool();
    const result = await pool.query(`
      WITH donations_normalized AS (
        SELECT COALESCE(
          last_position,
          CASE WHEN (payload->'donation'->>'lastPosition') ~ '^[0-9]+$'
            THEN (payload->'donation'->>'lastPosition')::INTEGER END,
          CASE WHEN (payload->'positions'->>'lastPosition') ~ '^[0-9]+$'
            THEN (payload->'positions'->>'lastPosition')::INTEGER END,
          CASE WHEN (payload->'positions'->>'ultimaPosizione') ~ '^[0-9]+$'
            THEN (payload->'positions'->>'ultimaPosizione')::INTEGER END,
          CASE WHEN (payload->'positions'->>'ultimaPositzione') ~ '^[0-9]+$'
            THEN (payload->'positions'->>'ultimaPositzione')::INTEGER END
        ) AS normalized_last_position
        FROM donations
      )
      SELECT MAX(normalized_last_position) AS latest_position
      FROM donations_normalized
      WHERE normalized_last_position IS NOT NULL
        AND normalized_last_position > 0
    `);

    const latest = Number(result.rows?.[0]?.latest_position);
    return Number.isFinite(latest) && latest > 0 ? latest : null;
  } catch (error) {
    console.warn('⚠️  Impossibile ottenere latest donation position:', error.message || error);
    return null;
  }
}

/**
 * GET /api/anagrafica/count
 * Conta totale posizioni
 */
app.get('/api/anagrafica/count', async (req, res) => {
  try {
    // Verifica autenticazione
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    // Conta posizioni effettive (1..N) tramite anagrafica-manager / db-unified-manager
    const count = await anagraficaManager.contaPosizioni();
    const latestDonationPosition = await getLatestDonationPositionFromPostgres();
    const countAligned = Number.isFinite(latestDonationPosition) && latestDonationPosition > 0
      ? Math.max(Number(count) || 0, latestDonationPosition)
      : (Number(count) || 0);
    
    // Aggiorna metrica anagrafica
    anagraficaTotal.set(countAligned);

    return res.json({
      success: true,
      count: countAligned,
      raw_count: Number(count) || 0,
      latest_donation_position: latestDonationPosition
    });

  } catch (error) {
    console.error('Errore count:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT DONATION (COMPLETION VIA BACKEND)
// ============================================

// Store condiviso per donazioni pendenti (usato anche da usdc-incoming-listener)
// Vedi pending-donation-store.js

/**
 * POST /api/donation/register
 * Body: { donationId, donor, amount, txHash }
 * Registra una donazione dopo registerDonation() on-chain.
 * 
 * FLUSSO AGGIORNATO (FIX RACE CONDITION):
 * 1. Frontend pre-registra con ID temporaneo (pending_xxx) e txHash='pending'
 * 2. Frontend trasferisce USDC
 * 3. USDC Listener rileva transfer, marca come USDC_RECEIVED (NON processa se ID temporaneo)
 * 4. Frontend chiama registerDonation() sullo smart contract → ottiene ID numerico
 * 5. Frontend chiama questa API con ID numerico e txHash reale
 * 6. Questa API trova la donazione USDC_RECEIVED e la aggiorna con ID numerico
 * 7. /api/donation/verify processa con ID numerico → completeDonation() on-chain
 */
app.post('/api/donation/register', async (req, res) => {
  try {
const { donationId, donor, amount, txHash, beneficiaryWallet, beneficiaryName, giftMessage, donationType } = req.body || {};

    if (!donationId || !donor || !amount || !txHash) {
      return res.status(400).json({
        success: false,
        message: 'Parametri mancanti: donationId, donor, amount, txHash'
      });
    }

    const amountNumber = parseFloat(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Importo non valido'
      });
    }

    const id = String(donationId);
    const isNumericId = /^\d+$/.test(id);

    // 🎁 PERSISTENZA DUREVOLE CARTA REGALO (anti-perdita):
    // Salviamo SUBITO l'intento del regalo su PostgreSQL (gift_intents), così il
    // legame donatore→beneficiario sopravvive a riavvii del backend e alla
    // chiusura del browser. Il gift-reconciler completerà il regalo anche se
    // /api/donation/verify non venisse mai chiamato. Vale sia per la
    // pre-registrazione (txHash 'pending') sia post-transfer (txHash reale).
    // Best-effort: NON blocca la registrazione se fallisce.
    if (String(donationType || '').toLowerCase() === 'carta-regalo' && beneficiaryWallet) {
      try {
        await giftIntentStore.upsertIntent({
          giftId: id,
          donor,
          beneficiaryWallet,
          amountUSDC: amountNumber,
          giftMessage,
          txHash
        });
      } catch (giftErr) {
        console.warn('⚠️  Persistenza gift_intents fallita (non bloccante):', giftErr.message || giftErr);
      }
    }
    
    // 🔄 FIX RACE CONDITION: Se riceviamo un ID numerico (da registerDonation()),
    // cerchiamo se esiste già una donazione pendente per questo donor/txHash
    // che era stata registrata con ID temporaneo e ha ricevuto USDC
    if (isNumericId && txHash && txHash !== 'pending') {
      // Cerca donazione esistente per txHash
      const existingByTx = pendingDonationStore.findByTxHash(txHash);
      
      // Oppure cerca per donor (con stato USDC_RECEIVED)
      const existingByDonor = pendingDonationStore.findByDonor(donor);
      
      const existing = existingByTx || existingByDonor;
      
      // 🎁 FIX CARTA REGALO: Gestisce sia ID temporanei (pending_) che USDC ricevuti dal listener (usdc_)
      const isUpgradableId = existing && (
        String(existing.donationId).startsWith('pending_') ||
        String(existing.donationId).startsWith('usdc_') ||
        existing.status === 'USDC_RECEIVED_AWAITING_FRONTEND'
      );
      
      if (isUpgradableId) {
        console.log('\n🔄 UPGRADE DONAZIONE: ID temporaneo/USDC → ID numerico');
        console.log(`   ID precedente: ${existing.donationId}`);
        console.log(`   ID numerico: ${id}`);
        console.log(`   Stato attuale: ${existing.status}`);
        if (beneficiaryWallet) {
          console.log(`   🎁 CARTA REGALO - Beneficiario: ${beneficiaryWallet}`);
        }
        
        // Rimuovi vecchia entry con ID temporaneo/usdc
        pendingDonationStore.remove(existing.donationId);
        
        // Determina nuovo status
        const usdcAlreadyReceived = existing.status === 'USDC_RECEIVED' || 
                                    existing.status === 'USDC_RECEIVED_AWAITING_FRONTEND';
        const newStatus = usdcAlreadyReceived ? 'READY_TO_PROCESS' : 'VERIFYING';
        
        // Registra con nuovo ID numerico, preservando tutti i dati
        // IMPORTANTE: beneficiaryWallet dal frontend ha priorità!
        pendingDonationStore.register(id, {
          ...existing,
          donationId: id,
          numericDonationId: id,
          txHash: txHash,
          status: newStatus,
          donationType: (donationType || existing.donationType || 'standard').toLowerCase(),
          beneficiaryWallet: beneficiaryWallet || existing.beneficiaryWallet || null,
          beneficiaryName: beneficiaryName || existing.beneficiaryName || null,
          giftMessage: giftMessage || existing.giftMessage || null,
          upgradedAt: new Date().toISOString()
        });
        
        console.log(`✅ Donazione aggiornata: status=${newStatus}, beneficiary=${beneficiaryWallet || 'N/A'}`);
        
        return res.json({
          success: true,
          status: newStatus,
          donationId: id,
          upgraded: true,
          previousId: existing.donationId
        });
      }
    }
    
    // Registrazione normale (pre-registrazione o prima volta)
    pendingDonationStore.register(id, {
      donationId: id,
      donor,
      amountUSDC: amountNumber,
      txHash,
      status: 'VERIFYING',
      // Tipo di donazione: standard | carta-regalo | dono-al-volo
      donationType: (donationType || 'standard').toLowerCase(),
      // Campi opzionali per Carta Regalo
      beneficiaryWallet: beneficiaryWallet || null,
      beneficiaryName: beneficiaryName || null,
      giftMessage: giftMessage || null
    });

    console.log('\n📥 DONAZIONE REGISTRATA (API)');
    console.log(`   ID: ${id}`);
    console.log(`   Donor: ${donor}`);
    console.log(`   Importo: ${amountNumber} USDC`);
    console.log(`   TxHash: ${txHash}`);
    console.log(`   ID numerico: ${isNumericId ? 'SÌ' : 'NO (temporaneo)'}`);

    return res.json({
      success: true,
      status: 'VERIFYING',
      donationId: id
    });
  } catch (error) {
    console.error('Errore /api/donation/register:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/donation/verify
 * Body: { donationId }
 * Usa donation-flow-manager per creare posizioni reali dopo che:
 * - la donazione on-chain è stata registrata
 * - eventuale verifica ZK-KYC è stata completata (per importi >= soglia).
 */
app.post('/api/donation/verify', async (req, res) => {
  try {
    const { donationId } = req.body || {};
    if (!donationId) {
      return res.status(400).json({ success: false, message: 'donationId richiesto' });
    }

    const id = String(donationId);
    const pending = pendingDonationStore.get(id);

    if (!pending) {
      return res.json({
        success: false,
        status: 'NOT_FOUND',
        message: 'Donazione non trovata o già processata'
      });
    }

    // Se abbiamo già processato la donazione (es. dal listener USDC), ritorna subito lo stato finale
    if (pending.status === 'COMPLETED') {
      // Applica filtro PILETTA anche per donazioni già completate
      const PILETTA_WALLET = '0x96e6a17f968b73d10263072899c95b83305281fe';
      const posizioniFiltered = (pending.positions?.posizioni || []).filter(p => {
        const pos = Number(p.posizione);
        if (p.wallet && p.wallet.toLowerCase() === PILETTA_WALLET.toLowerCase()) return false;
        if (p.tipo && p.tipo.toUpperCase() === 'PILETTA') return false;
        if (p.movimento === 'SMALL' && pos % 2 !== 0) return false;
        return true;
      });
      
      const positionsForUser = {
        ...pending.positions,
        posizioni: posizioniFiltered,
        posizioniCreate: posizioniFiltered.length
      };
      
      return res.json({
        success: true,
        status: pending.status,
        positions: positionsForUser,
        processedByListener: pending.processedByListener || false
      });
    }

    console.log('\n🔍 VERIFICA DONAZIONE (API)');
    console.log(`   ID: ${id}`);
    console.log(`   Donor: ${pending.donor}`);
    console.log(`   Importo: ${pending.amountUSDC} USDC`);
    console.log(`   TxHash: ${pending.txHash}`);

    // NOTA SPEC (allineamento): la ZK-KYC NON deve bloccare la creazione posizioni (donazione).
    // La ZK-KYC va applicata prima di ricevere il primo dono "LARGE" (distribuzioni > soglia),
    // quindi verrà verificata nella pipeline di distribuzione, non qui.

    // Usa donation-flow-manager per creare posizioni (donazione diretta, Carta Regalo o Dono al volo).
    const donationResult = await donationFlowManager.processDonation({
      donationId: id,
      donor: pending.donor,
      amountUSDC: pending.amountUSDC,
      txHash: pending.txHash,
      timestamp: pending.registeredAt,
      donationType: pending.donationType || 'standard',
      // Dati opzionali per Carta Regalo, se presenti
      beneficiaryWallet: pending.beneficiaryWallet,
      beneficiaryName: pending.beneficiaryName,
      giftMessage: pending.giftMessage
    });

    if (!donationResult.success) {
      console.error('❌ Errore processamento donazione:', donationResult.error);
      pending.status = 'ERROR';
      return res.json({
        success: false,
        status: 'ERROR',
        message: donationResult.error || 'Errore processamento donazione'
      });
    }

    // Salva risultato e marca come COMPLETATA
    pendingDonationStore.update(id, {
      status: 'COMPLETED',
      positions: donationResult.positions
    });

    console.log('✅ Donazione completata (backend)');
    
    // 🚫 FILTRO PILETTE: Le posizioni PILETTA NON devono essere esposte al frontend.
    // Restituiamo solo le posizioni HUMAN create dalla donazione.
    const PILETTA_WALLET = '0x96e6a17f968b73d10263072899c95b83305281fe';
    const posizioniFiltered = (donationResult.positions?.posizioni || []).filter(p => {
      const pos = Number(p.posizione);
      
      // Escludi wallet PILETTA
      if (p.wallet && p.wallet.toLowerCase() === PILETTA_WALLET.toLowerCase()) {
        return false;
      }
      
      // Escludi tipo PILETTA
      if (p.tipo && p.tipo.toUpperCase() === 'PILETTA') {
        return false;
      }
      
      // Nelle posizioni SMALL, le dispari sono sempre PILETTA
      // Usa il tipo/movimento dal DB se disponibile, altrimenti fallback su pari/dispari
      if (p.movimento === 'SMALL' && pos % 2 !== 0) {
        return false;
      }
      // Fallback per posizioni senza movimento: se dispari e non LARGE, probabilmente PILETTA
      if (!p.movimento && pos % 2 !== 0 && !['LARGE'].includes(String(p.movimento).toUpperCase())) {
        return false;
      }
      
      return true;
    });
    
    // Prepara risposta con solo posizioni HUMAN
    const positionsForUser = {
      ...donationResult.positions,
      posizioni: posizioniFiltered,
      posizioniCreate: posizioniFiltered.length
    };

    return res.json({
      success: true,
      status: 'COMPLETED',
      positions: positionsForUser
    });
  } catch (error) {
    console.error('Errore /api/donation/verify:', error);
    return res.status(500).json({ success: false, status: 'ERROR', message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT AREA PERSONALE (USER DASHBOARD)
// ============================================

/**
 * GET /api/user-positions-simple/:wallet
 * Versione veloce: legge solo dall'anagrafica file SENZA stelline
 */
app.get('/api/user-positions-simple/:wallet', (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }
    
    const walletLower = normalizeWallet(wallet);
    const positions = findWalletInAnagraficaFile(walletLower, 500);
    
    // 🚫 FILTRO PILETTE: Le posizioni PILETTA NON devono essere visibili agli utenti.
    const PILETTA_WALLET = '0x96e6a17f968b73d10263072899c95b83305281fe';
    
    // Se l'utente stesso è PILETTA, non mostrare nulla
    if (walletLower === PILETTA_WALLET.toLowerCase()) {
      return res.json({
        success: true,
        totalePosizioniAttive: 0,
        posizioni: [],
        walletInfo: {
          nome: null,
          totale_posizioni: 0,
          movimento_max: 'SMALL'
        },
        simplified: true
      });
    }
    
    const posizioniFiltered = positions.filter(p => {
      const pos = Number(p.posizione);
      
      // Escludi wallet PILETTA se presente nel campo (file anagrafica potrebbe averlo)
      if (p.wallet && p.wallet.toLowerCase() === PILETTA_WALLET.toLowerCase()) {
        return false;
      }
      
      // Escludi tipo PILETTA se presente
      if (p.tipo && p.tipo.toUpperCase() === 'PILETTA') {
        return false;
      }
      
      // Nelle posizioni SMALL, le dispari sono sempre PILETTA
      // Usa il tipo/movimento se disponibile
      if (p.movimento === 'SMALL' && pos % 2 !== 0) {
        return false;
      }
      
      return true; // Mostra posizioni HUMAN
    });
    
    const posizioni = posizioniFiltered.map(p => ({
      posizione: p.posizione,
      nome: null, // Privacy
      wallet: wallet,
      movimento: 'SMALL',
      molecola: Math.ceil(p.posizione / 3),
      generazione: Math.ceil(p.posizione / 15),
      ruolo: 'RICEVENTE',
      stato: 'ATTIVO',
      stelle: {
        rosse: 0,
        verdi: 0,
        blu: 0,
        emoji: '',
        totali: 0
      }
    }));
    
    return res.json({
      success: true,
      totalePosizioniAttive: posizioni.length,
      posizioni,
      walletInfo: {
        nome: null,
        totale_posizioni: posizioni.length,
        movimento_max: 'SMALL'
      },
      simplified: true
    });
  } catch (error) {
    console.error('Errore user-positions-simple:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/user-positions/:wallet
 * Restituisce le posizioni attive di un wallet con tracking stelline.
 */
function isTransientDbError(err) {
  const msg = String(err?.message || err || '');
  return (
    err?.code === 'TEMPORARY_DB_ISSUE' ||
    msg.includes('TEMPORARY_DB_ISSUE') ||
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('ECONNRESET') ||
    msg.includes('terminating connection') ||
    msg.includes('server closed the connection') ||
    msg.includes('error establishing an SSL connection')
  );
}

app.get('/api/user-positions/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    const data = await areaPersonaleManager.getPosizioniAttive(wallet);
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('Errore user-positions:', error);

    // Risposta "gentile" per utenti: evita pagina rotta quando Postgres fa un hiccup.
    // Restituiamo success=true ma "degraded" per non far esplodere UI che si aspetta success.
    if (isTransientDbError(error)) {
      return res.status(200).json({
        success: true,
        degraded: true,
        status: 'TEMPORARY_DB_ISSUE',
        retryAfterMs: 1500,
        message: 'Servizio momentaneamente occupato, ricarica tra pochi secondi.',
        totalePosizioniAttive: 0,
        posizioni: [],
        walletInfo: { nome: null, totale_posizioni: 0, movimento_max: 'SMALL' }
      });
    }

    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/user-invitati/:wallet
 * Statistiche invitati per wallet (totale + breakdown SMALL/LARGE).
 *
 * AREA PERSONALE: Mostra TUTTI gli invitati dell'utente, inclusi:
 * - Persone che ha invitato col suo link referral
 * - Rientri (SELF) che contano come invitati a tutti gli effetti
 * 
 * Esempio: Susanna vede tutti i suoi invitati (persone + suoi rientri)
 * perché ogni invitato le porta regali nel movimento LARGE.
 */
app.get('/api/user-invitati/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    // AREA PERSONALE: mostra TUTTI gli invitati (persone + rientri SELF)
    // Nessun filtro - i SELF sono invitati a tutti gli effetti
    const stats = await referralManager.getStatisticheInviti(wallet);

    // Normalizza struttura per il frontend area personale
    const invitati = (stats.invitati || []).map(inv => ({
      nome: inv.nome,
      wallet: inv.wallet,
      dataInvito: inv.dataInvito || null,
      posizione: inv.posizione ?? null,
      movimento: inv.movimento || 'SMALL'
    }));

    return res.json({
      success: true,
      // Alias compatibili: sia totaleInvitati che numeroInvitati
      totaleInvitati: stats.numeroInvitati || 0,
      numeroInvitati: stats.numeroInvitati || 0,
      invitati,
      invitatiLARGE: stats.invitatiLARGE ?? 0,
      invitatiSMALL: stats.invitatiSMALL ?? 0
    });
  } catch (error) {
    console.error('Errore user-invitati:', error);

    if (isTransientDbError(error)) {
      return res.status(200).json({
        success: true,
        degraded: true,
        status: 'TEMPORARY_DB_ISSUE',
        retryAfterMs: 1500,
        message: 'Servizio momentaneamente occupato, ricarica tra pochi secondi.',
        totaleInvitati: 0,
        numeroInvitati: 0,
        invitati: [],
        invitatiLARGE: 0,
        invitatiSMALL: 0
      });
    }

    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT ZK-KYC
// ============================================

/**
 * GET /api/zkkyc/status/:wallet
 * Restituisce lo stato ZK-KYC per un wallet (verificato + scadenza annuale).
 */
app.get('/api/zkkyc/status/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    const status = await zkKYCManager.getWalletZKKYCStatus(wallet);
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error('Errore zkkyc status:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/kyc/check/:wallet/:amount
 * PUNTO 120: Verifica se serve KYC per wallet/importo
 */
app.get('/api/kyc/check/:wallet/:amount', async (req, res) => {
  try {
    const { wallet, amount } = req.params;
    if (!wallet || !amount) {
      return res.status(400).json({ success: false, message: 'Wallet e amount richiesti' });
    }

    const amountNum = parseFloat(amount);
    const result = await zkKYCManager.canReceiveDistribution(wallet, amountNum);
    
    return res.json({
      success: true,
      wallet,
      amount: amountNum,
      kycRequired: !result.allowed && amountNum > zkKYCManager.ZKKYC_THRESHOLD,
      threshold: zkKYCManager.ZKKYC_THRESHOLD,
      ...result
    });
  } catch (error) {
    console.error('Errore kyc check:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/kyc/qr-code
 * PUNTO 121: Genera QR code PolygonID per verifica
 */
app.post('/api/kyc/qr-code', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    // URL verifica PolygonID
    const verificationUrl = zkKYCManager.ZKKYC_VERIFICATION_URL;
    
    // Genera dati per QR code (deep link PolygonID)
    const qrData = {
      type: 'PolygonID_KYC',
      wallet: wallet.toLowerCase(),
      callback: `${process.env.BASE_URL || 'https://api.revolutionofgiving.com'}/api/kyc/verify-proof`,
      schema: 'ROG_KYC_v1',
      requirements: [
        'kycVerified',
        'ageOver18'
      ],
      timestamp: Date.now(),
      expiresIn: 3600 // 1 ora
    };

    // In produzione questo URL viene generato da PolygonID SDK
    const polygonIdDeepLink = `${verificationUrl}?request=${encodeURIComponent(JSON.stringify(qrData))}`;

    return res.json({
      success: true,
      wallet,
      qrCodeData: qrData,
      qrCodeUrl: polygonIdDeepLink,
      verificationUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      instructions: [
        '1. Scansiona il QR code con PolygonID app',
        '2. Autorizza la condivisione delle credenziali',
        '3. Attendi la conferma della verifica',
        '4. Le spese di verifica sono a carico dell\'utente (Punto 102)'
      ]
    });
  } catch (error) {
    console.error('Errore kyc qr-code:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/kyc/verify-proof
 * PUNTO 122: Verifica ZK proof da PolygonID (callback)
 * PUNTO 105: PolygonID manda al backend il benestare
 * INTEGRAZIONE BLACKLIST: blocca utenti nella lista nera
 */
app.post('/api/kyc/verify-proof', async (req, res) => {
  try {
    const { wallet, proof, proofHash, credentialType, nome, fullName } = req.body;
    
    if (!wallet || (!proof && !proofHash)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Wallet e proof/proofHash richiesti' 
      });
    }

    console.log(`\n\ud83d\udd10 VERIFICA ZK-KYC PROOF`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   ProofHash: ${proofHash || 'da calcolare'}`);

    // 🚫 BLACKLIST CHECK - Verifica se utente è nella blacklist
    const blacklistManager = require('./blacklist-manager');
    const userName = nome || fullName || null;
    
    if (userName) {
      const blacklistCheck = await blacklistManager.canReceiveGifts({ wallet, nome: userName });
      
      if (!blacklistCheck.allowed) {
        console.log(`   🚫 UTENTE BLACKLISTATO: ${userName}`);
        console.log(`   Wallet ${wallet} aggiunto automaticamente alla blacklist`);
        
        return res.status(403).json({
          success: false,
          verified: false,
          blacklisted: true,
          wallet,
          message: 'Utente non autorizzato a partecipare al sistema ROG',
          reason: 'BLACKLISTED'
        });
      }
    }

    // Calcola hash se non fornito
    const crypto = require('crypto');
    const finalProofHash = proofHash || 
      crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex');

    // Registra verifica completata
    await zkKYCManager.registerZKKYCVerification(wallet, finalProofHash);

    // Invia notifica area personale
    try {
      const apm = require('./area-personale-manager');
      await apm.inviaMessaggioSistema(wallet, {
        tipo: 'ZKKYC_VERIFIED',
        titolo: '\u2705 Verifica ZK-KYC Completata',
        messaggio: 'La tua identit\u00e0 \u00e8 stata verificata con successo tramite PolygonID. Ora puoi ricevere doni superiori a 100 USDC.',
        timestamp: new Date().toISOString()
      });
    } catch (msgErr) {
      console.warn('\u26a0\ufe0f  Errore invio notifica:', msgErr.message);
    }

    console.log(`   \u2705 ZK-KYC verificata con successo`);

    return res.json({
      success: true,
      verified: true,
      wallet,
      proofHash: finalProofHash,
      credentialType: credentialType || 'ROG_KYC_v1',
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 anno
      message: 'Verifica ZK-KYC completata con successo'
    });
  } catch (error) {
    console.error('Errore kyc verify-proof:', error);
    return res.status(500).json({ success: false, message: 'Errore verifica proof' });
  }
});

/**
 * GET /api/kyc/stats
 * PUNTO 124: Statistiche sistema KYC
 */
app.get('/api/kyc/stats', async (req, res) => {
  try {
    const stats = await zkKYCManager.getZKKYCStats();
    
    return res.json({
      success: true,
      stats: {
        ...stats,
        threshold: zkKYCManager.ZKKYC_THRESHOLD,
        validityDays: zkKYCManager.ZKKYC_VALIDITY_DAYS,
        verificationUrl: zkKYCManager.ZKKYC_VERIFICATION_URL
      }
    });
  } catch (error) {
    console.error('Errore kyc stats:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/kyc/update-threshold
 * PUNTO 125: Aggiorna soglia KYC (solo admin)
 */
app.post('/api/kyc/update-threshold', adminAuthMiddleware, async (req, res) => {
  try {
    const { newThreshold } = req.body;
    
    if (!newThreshold || typeof newThreshold !== 'number' || newThreshold < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'newThreshold deve essere un numero positivo' 
      });
    }

    // NOTA: In produzione questo dovrebbe aggiornare una variabile persistente
    // Per ora loggiamo solo l'intenzione
    console.log(`\n\ud83d\udcca AGGIORNAMENTO SOGLIA KYC`);
    console.log(`   Vecchia soglia: ${zkKYCManager.ZKKYC_THRESHOLD} USDC`);
    console.log(`   Nuova soglia: ${newThreshold} USDC`);

    return res.json({
      success: true,
      previousThreshold: zkKYCManager.ZKKYC_THRESHOLD,
      newThreshold,
      message: `Soglia KYC aggiornata a ${newThreshold} USDC`,
      note: 'Richiede riavvio server per applicare (o variabile dinamica in DB)'
    });
  } catch (error) {
    console.error('Errore kyc update-threshold:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// BLACKLIST MANAGEMENT API
// ============================================

const blacklistManager = require('./blacklist-manager');

/**
 * GET /api/admin/blacklist
 * Ottiene lista completa utenti bloccati
 */
app.get('/api/admin/blacklist', adminAuthMiddleware, async (req, res) => {
  try {
    const blacklist = await blacklistManager.getBlacklist();
    return res.json({
      success: true,
      blacklist
    });
  } catch (error) {
    console.error('Errore get blacklist:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/admin/blacklist/check
 * Verifica se un utente è nella blacklist
 */
app.post('/api/admin/blacklist/check', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet, nome } = req.body;
    
    if (!wallet && !nome) {
      return res.status(400).json({ success: false, message: 'Wallet o nome richiesto' });
    }

    const result = await blacklistManager.canReceiveGifts({ wallet, nome });
    
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Errore blacklist check:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/admin/blacklist/add-wallet
 * Aggiunge un wallet alla blacklist manualmente
 */
app.post('/api/admin/blacklist/add-wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet, reason } = req.body;
    const adminWallet = req.user?.wallet || 'admin';
    
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    const result = await blacklistManager.addWalletToBlacklist(
      wallet,
      reason || 'Aggiunto manualmente da admin',
      adminWallet
    );
    
    return res.json(result);
  } catch (error) {
    console.error('Errore add to blacklist:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * POST /api/admin/blacklist/remove-wallet
 * Rimuove un wallet dalla blacklist (ATTENZIONE!)
 */
app.post('/api/admin/blacklist/remove-wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet, reason } = req.body;
    const adminWallet = req.user?.wallet || 'admin';
    
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'Wallet richiesto' });
    }

    // Solo superadmin può rimuovere dalla blacklist
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Solo superadmin può rimuovere utenti dalla blacklist' 
      });
    }

    const result = await blacklistManager.removeWalletFromBlacklist(
      wallet,
      reason || 'Rimosso da superadmin',
      adminWallet
    );
    
    return res.json(result);
  } catch (error) {
    console.error('Errore remove from blacklist:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * GET /api/admin/blacklist/logs
 * Ottiene log azioni blacklist
 */
app.get('/api/admin/blacklist/logs', adminAuthMiddleware, async (req, res) => {
  try {
    const logs = await blacklistManager.getBlacklistLogs();
    return res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Errore blacklist logs:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT SYSTEM STATS
// ============================================

/**
 * POST /api/admin/position/lookup
 * Lookup position by number or wallet
 */
app.post('/api/admin/position/lookup', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query mancante' });
    }

    // lookupPosition è ora ASYNC e usa PostgreSQL
    const result = await positionLookup.lookupPosition(query);
    return res.json(result);

  } catch (error) {
    console.error('Errore position lookup:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: error.message
    });
  }
});

/**
 * GET /api/movements/stats
 * Statistiche movimento Small/Medium/Large da database
 */
app.get('/api/movements/stats', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    const stats = await movementStats.getAllMovementStats();
    
    return res.json(stats);
  } catch (error) {
    console.error('Errore movements stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: error.message
    });
  }
});

/**
 * GET /api/donations/ultima
 * Ultima donazione registrata nel sistema
 */
app.get('/api/donations/ultima', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    await pgConn.initDatabase();
    const pool = pgConn.getPool();

    const result = await pool.query(`
      WITH donations_normalized AS (
        SELECT
          donation_type,
          donor_wallet,
          COALESCE(
            last_position,
            CASE WHEN (payload->'donation'->>'lastPosition') ~ '^[0-9]+$'
              THEN (payload->'donation'->>'lastPosition')::INTEGER END,
            CASE WHEN (payload->'positions'->>'lastPosition') ~ '^[0-9]+$'
              THEN (payload->'positions'->>'lastPosition')::INTEGER END,
            CASE WHEN (payload->'positions'->>'ultimaPosizione') ~ '^[0-9]+$'
              THEN (payload->'positions'->>'ultimaPosizione')::INTEGER END,
            CASE WHEN (payload->'positions'->>'ultimaPositzione') ~ '^[0-9]+$'
              THEN (payload->'positions'->>'ultimaPositzione')::INTEGER END
          ) AS normalized_last_position,
          COALESCE(ts, created_at) AS timestamp,
          updated_at
        FROM donations
      )
      SELECT
        donation_type,
        donor_wallet,
        normalized_last_position AS last_position,
        timestamp
      FROM donations_normalized
      WHERE normalized_last_position IS NOT NULL
        AND normalized_last_position > 0
      ORDER BY normalized_last_position DESC, updated_at DESC, timestamp DESC
      LIMIT 1
    `);

    if (!result.rows || result.rows.length === 0) {
      return res.json({ success: true, donation: null });
    }

    const row = result.rows[0];
    return res.json({
      success: true,
      donation: {
        donationType: row.donation_type || 'standard',
        donor: row.donor_wallet || null,
        lastPosition: row.last_position ?? null,
        timestamp: row.timestamp || null
      }
    });
  } catch (error) {
    console.error('Errore /api/donations/ultima:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/system/stats
 * Statistiche globali sistema (totale posizioni, breakdown SMALL/MEDIUM/LARGE, wallet per tipo)
 */
app.get('/api/system/stats', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    // Verifica che il token sia valido (qualsiasi livello staff)
    const verification = await authManager.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, message: 'Sessione scaduta' });
    }

    // Fonte di verità runtime:
    // - in ambiente PostgreSQL-only usiamo db-unified-manager-pg
    // - in ambiente legacy usiamo ancora SQLite canonico (ROG_MASTER.db)
    let stats;
    if (HAS_POSTGRES) {
      stats = await dbUnifiedPg.getSystemStats();
    } else if (dbUnifiedSqlite) {
      stats = await dbUnifiedSqlite.getSystemStats();
    } else {
      throw new Error('Nessun backend database disponibile per system stats');
    }
    // Calcola numero wallet per tipo richiesti (HUMAN, ROG, PILETTA, AVENGERS)
    const walletTypes = { HUMAN: 0, ROG: 0, PILETTA: 0, AVENGERS: 0 };
    if (Array.isArray(stats.by_type)) {
      stats.by_type.forEach(row => {
        const tipo = (row.tipo || '').toUpperCase();
        if (walletTypes.hasOwnProperty(tipo)) {
          const num = row.num_wallet || row.num_wallets || row.count || 0;
          walletTypes[tipo] = Number(num) || 0;
        }
      });
    }

    const rawTotalPositions = Number(stats.total_positions) || 0;
    const latestDonationPosition = await getLatestDonationPositionFromPostgres();
    const alignedTotalPositions = Number.isFinite(latestDonationPosition) && latestDonationPosition > 0
      ? Math.max(rawTotalPositions, latestDonationPosition)
      : rawTotalPositions;

    return res.json({
      success: true,
      stats: {
        total_wallets: stats.total_wallets,
        total_positions: alignedTotalPositions,
        total_positions_raw: rawTotalPositions,
        latest_donation_position: latestDonationPosition,
        by_movement: stats.by_movement,
        by_type: stats.by_type,
        wallet_types: walletTypes
      }
    });
  } catch (error) {
    console.error('Errore system stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT CASSA ROG
// ============================================

/**
 * GET /api/cassa/bilancio
 * Bilancio complessivo CASSA ROG
 */
app.get('/api/cassa/bilancio', async (req, res) => {
  try {
    // Verifica autenticazione
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    // Verifica permesso
    const hasPermission = await authManager.hasPermission(token, 'VIEW_ANALYTICS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const bilancio = await cassaROGManager.getBilancioComplessivo();
    
    // Aggiorna metriche CASSA ROG per sezione
    if (bilancio.sezioni) {
      Object.entries(bilancio.sezioni).forEach(([nome, dati]) => {
        if (dati.saldo !== undefined) {
          cassaROGBalance.set({ sezione: nome }, dati.saldo);
        }
      });
    }
    
    return res.json({
      success: true,
      bilancio
    });

  } catch (error) {
    console.error('Errore bilancio:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/cassa/sezione/:nome
 * Statistiche sezione specifica
 */
app.get('/api/cassa/sezione/:nome', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Non autorizzato' });
    }

    const hasPermission = await authManager.hasPermission(token, 'VIEW_ANALYTICS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const { nome } = req.params;
    const stats = await cassaROGManager.getStatisticheSezione(nome);
    
    return res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Errore stats sezione:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT "GIÀ ISCRITTO" - LOOKUP WALLET
// ============================================

/**
 * GET /api/utente/lookup/:wallet
 *
 * Flusso: "Già Iscritto" (punti 61–66 specifica)
 * - Verifica se il wallet ha posizioni/anagrafica in PostgreSQL
 * - Se NON trovato: invia email al supporto ROG e restituisce found=false
 */
app.get('/api/utente/lookup/:wallet', async (req, res) => {
  try {
    const rawWallet = req.params.wallet;
    if (!rawWallet) {
      return res.status(400).json({
        success: false,
        found: false,
        message: 'Wallet richiesto'
      });
    }

    const wallet = String(rawWallet).trim().toLowerCase();

    // Controllo formato base (0x + 40 hex)
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return res.status(400).json({
        success: false,
        found: false,
        message: 'Formato wallet non valido'
      });
    }

    // Usa db-unified-manager-pg come fonte di verità per verificare se il wallet esiste
    let walletStats = null;
    try {
      walletStats = await dbUnifiedPg.getWalletStats(wallet);
    } catch (err) {
      console.error('❌ Errore lettura walletStats (lookup utente):', err.message || err);
    }

    const hasPositions = !!(walletStats && Number(walletStats.totale_posizioni) > 0);

    if (!hasPositions) {
      // Wallet non trovato in anagrafica Postgres → notifica supporto
      await notifyWalletNotFound(wallet);

      return res.json({
        success: false,
        found: false,
        supportTicketOpened: true,
        message: 'Wallet non trovato in anagrafica, è stata inviata una notifica al supporto ROG.'
      });
    }

    // Wallet trovato: restituisci info minime per schermata di benvenuto
    return res.json({
      success: true,
      found: true,
      wallet,
      totalePosizioni: Number(walletStats.totale_posizioni) || 0,
      movimentoMax: walletStats.movimento_max || 'SMALL',
      primaPosizione: walletStats.prima_posizione || null,
      ultimaPosizione: walletStats.ultima_posizione || null
    });
  } catch (error) {
    console.error('❌ Errore lookup utente (Già Iscritto):', error);
    return res.status(500).json({
      success: false,
      found: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// ENDPOINT MESSAGING + BOT (AREA PERSONALE)
// ============================================

/**
 * GET /api/messages/:wallet
 * Restituisce i messaggi associati a un wallet.
 */
app.get('/api/messages/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ success: false, messages: [], unreadCount: 0 });
    }

    const messages = await areaPersonaleManager.getMessagesPG(wallet.toLowerCase());
    const unreadCount = messages.filter(m => !m.letto).length;

    return res.json({
      success: true,
      messages,
      unreadCount,
      total: messages.length
    });
  } catch (error) {
    console.error('Errore get messages:', error);
    return res.status(500).json({ success: false, messages: [], unreadCount: 0 });
  }
});

/**
 * POST /api/messages/:messageId/read
 * Marca un messaggio come letto.
 */
app.post('/api/messages/:messageId/read', async (req, res) => {
  try {
    const { messageId } = req.params;
    if (!messageId) {
      return res.status(400).json({ success: false, message: 'messageId richiesto' });
    }

    // Aggiorna flag letto nel DB
    await pgConnectionMarkMessageAsRead(messageId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Errore mark message read:', error);
    return res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
});

/**
 * Funzione helper per aggiornare il flag "letto" in PostgreSQL.
 */
async function pgConnectionMarkMessageAsRead(messageId) {
  const pgConn = require('./pg-connection-manager');
  await pgConn.query(
    'UPDATE messages SET letto = TRUE WHERE id = $1',
    [messageId]
  );
}

/**
 * POST /api/bot/query
 * Bridge tra frontend e Bot AI Manager (FAQ + escalation).
 */
app.post('/api/bot/query', async (req, res) => {
  try {
    const { wallet, question } = req.body || {};
    if (!wallet || !question) {
      return res.status(400).json({
        success: false,
        answer: 'Wallet e domanda sono richiesti per usare il bot.'
      });
    }

    const botAIManager = require('./bot-ai-manager');
    const response = await botAIManager.processMessage(wallet, question);

    return res.json({
      success: true,
      answer: response.answer,
      type: response.type,
      category: response.category,
      confidence: response.confidence
    });
  } catch (error) {
    console.error('Errore bot query:', error);
    return res.status(500).json({
      success: false,
      answer: 'Errore interno del server bot. Riprova più tardi o contatta il supporto.'
    });
  }
});

// ============================================
// ENDPOINT COMMUNITY REGISTRATION
// ============================================

/**
 * POST /api/community/register
 * Registrazione utente alla community ROG
 * PostgreSQL (primary) + file system (backup)
 */
app.post('/api/community/register', async (req, res) => {
  try {
    const { wallet, nome, referrer } = req.body || {};
    
    if (!wallet) {
      return res.status(400).json({
        success: false,
        message: 'Wallet richiesto per la registrazione'
      });
    }
    
    // Verifica formato wallet
    if (!isValidWalletFormat(wallet)) {
      return res.status(400).json({
        success: false,
        message: 'Formato wallet non valido'
      });
    }
    
    // Registra utente (PostgreSQL)
    const result = await communityRegistrationManager.registerWallet(
      wallet,
      referrer || null,
      { nome: nome || null }
    );
    
    return res.json(result);
    
  } catch (error) {
    console.error('Errore registrazione community:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/community/count
 * Conta iscrizioni community
 */
app.get('/api/community/count', async (req, res) => {
  try {
    const count = await communityRegistrationManager.getRegistrationsCount();
    
    return res.json({
      success: true,
      count
    });
    
  } catch (error) {
    console.error('Errore conta iscrizioni:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * GET /api/community/list
 * Lista iscrizioni community (protetto)
 */
app.get('/api/community/list', adminAuthMiddleware, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const iscrizioni = await communityRegistrationManager.getRegistrations(
      parseInt(limit),
      parseInt(offset)
    );
    
    return res.json({
      success: true,
      iscrizioni,
      total: iscrizioni.length
    });
    
  } catch (error) {
    console.error('Errore lista iscrizioni:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

/**
 * POST /api/community/sync
 * Sincronizza iscrizioni con anagrafica (solo staff)
 */
app.post('/api/community/sync', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await communityRegistrationManager.sincronizzaConAnagrafica();
    
    return res.json(result);
    
  } catch (error) {
    console.error('Errore sincronizzazione:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
});

// ============================================
// PROMETHEUS METRICS ENDPOINT
// ============================================

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.end(metrics);
  } catch (error) {
    console.error('Errore metriche Prometheus:', error);
    res.status(500).end(error.toString());
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'ROG API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: [
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'GET /api/auth/verify',
        'GET /api/auth/stats'
      ],
      anagrafica: [
        'GET /api/anagrafica/count',
        'GET /api/system/stats'
      ],
      cassa: [
        'GET /api/cassa/bilancio',
        'GET /api/cassa/sezione/:nome'
      ],
      area_personale: [
        'GET /api/user-positions/:wallet',
        'GET /api/user-invitati/:wallet',
        'GET /api/messages/:wallet',
        'POST /api/messages/:messageId/read',
        'POST /api/bot/query'
      ],
      donation: [
        'POST /api/donation/register',
        'POST /api/donation/verify'
      ],
      community: [
        'POST /api/community/register',
        'GET /api/community/count',
        'GET /api/community/list',
        'POST /api/community/sync'
      ],
      media: [
        'POST /api/admin/media/upload',
        'GET /api/admin/media/list',
        'DELETE /api/admin/media/:filename',
        'PUT /api/admin/media/:filename/rename',
        'GET /api/admin/media/stats'
      ]
    }
  });
});

// ============================================
// ADMIN: BACKFILL USDC - Recupero transazioni mancate
// ============================================

/**
 * POST /api/admin/backfill-usdc
 * 
 * Scansiona i blocchi passati per trovare transfer USDC alla cassa ROG
 * che non sono stati processati e crea le posizioni mancanti.
 * 
 * Body JSON:
 *   - fromBlock: blocco iniziale (opzionale, default: ultimo processato)
 *   - toBlock: blocco finale (opzionale, default: 'latest')
 *   - dryRun: se true, solo analisi senza processare (default: false)
 *   - forceReprocess: se true, riprocessa anche tx già processate (default: false)
 */
app.post('/api/admin/backfill-usdc', adminAuthMiddleware, async (req, res) => {
  try {
    const { fromBlock, toBlock, dryRun, forceReprocess } = req.body || {};
    
    const usdcBackfill = require('./usdc-backfill');
    const result = await usdcBackfill.backfillUSDCTransfers({
      fromBlock: fromBlock ? Number(fromBlock) : null,
      toBlock: toBlock || 'latest',
      dryRun: !!dryRun,
      forceReprocess: !!forceReprocess
    });
    
    return res.json(result);
  } catch (error) {
    console.error('Errore backfill USDC:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Errore interno'
    });
  }
});

/**
 * GET /api/admin/wallet-usdc-transactions/:wallet
 * 
 * Trova tutte le transazioni USDC di un wallet verso la cassa ROG
 */
app.get('/api/admin/wallet-usdc-transactions/:wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet } = req.params;
    const { fromBlock, limit } = req.query;
    
    const usdcBackfill = require('./usdc-backfill');
    const transactions = await usdcBackfill.findWalletTransactions(wallet, {
      fromBlock: fromBlock ? Number(fromBlock) : null,
      limit: limit ? Number(limit) : 50
    });
    
    return res.json({
      success: true,
      wallet,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Errore ricerca transazioni wallet:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Errore interno'
    });
  }
});

// ============================================
// ADMIN: FIX MOLECOLE 17300-17413 (PostgreSQL)
// ============================================

/**
 * POST /api/admin/fix-molecole-17300-17413
 *
 * Esegue il fix delle molecole/generazioni/ruoli per le posizioni 17300-17413
 * partendo dallo stato noto di 17298-17299:
 *   17298 → molecola 3450, DONANTE_1 (pos 4)
 *   17299 → molecola 3450, DONANTE_2 (pos 5)
 *
 * Usa la stessa logica dello script locale, ma eseguita direttamente
 * nel backend (dentro Coolify) così ha accesso al PostgreSQL reale.
 *
 * Body JSON: { apply: boolean }
 *   - apply = false (default): DRY-RUN, nessun UPDATE, ritorna solo le differenze
 *   - apply = true: esegue gli UPDATE su wallet_positions e riallinea wallet_master
 */
app.post('/api/admin/fix-molecole-17300-17413', adminAuthMiddleware, async (req, res) => {
  const APPLY = !!(req.body && req.body.apply);

  const START_POS = 17300;
  const END_POS = 17413;
  const ANCHOR_POS = 17299; // ultima posizione "buona" prima del blocco
  const ANCHOR_MOLECOLA = 3450;
  const ANCHOR_POS_IN_MOL = 5; // DONANTE_2

  function computeNextMoleculePlacementLocal(prevMolecola, prevPosizioneInMolecola) {
    const ruoliMap = {
      1: 'RICEVENTE',
      2: 'PONTE_SX',
      3: 'PONTE_DX',
      4: 'DONANTE_1',
      5: 'DONANTE_2',
      6: 'DONANTE_3',
      7: 'DONANTE_4'
    };

    let molecola = Number(prevMolecola) || 0;
    let posizioneInMolecola = Number(prevPosizioneInMolecola) || 3; // default: prossimo = 4

    let nextPosInMol = posizioneInMolecola + 1;
    let nextMol = molecola;

    // Se siamo oltre DONANTE_4, passiamo alla molecola successiva ripartendo da DONANTE_1.
    if (nextPosInMol > 7) {
      nextPosInMol = 4;
      nextMol = molecola + 1;
    }

    const ruolo = ruoliMap[nextPosInMol] || 'UNKNOWN';

    // In questa zona vogliamo i DONANTI in generazione H14.
    const generazione = 'H14';

    return {
      molecola: nextMol,
      generazione,
      ruolo,
      posizioneInMolecola: nextPosInMol
    };
  }

  try {
    await pgConn.initDatabase();

    const result = await pgConn.transaction(async (client) => {
      // 1) Verifica stato ancora coerente su 17299
      const anchorRes = await client.query(
        'SELECT molecola, posizione_in_molecola FROM wallet_positions WHERE posizione = $1 LIMIT 1',
        [ANCHOR_POS]
      );

      if (anchorRes.rows.length === 0) {
        throw new Error(
          `Posizione ${ANCHOR_POS} non trovata in wallet_positions. ` +
            'Questo endpoint presume che 17298-17299 siano già presenti e corretti.'
        );
      }

      const anchor = anchorRes.rows[0];
      const dbMol = Number(anchor.molecola);
      const dbPosInMol = Number(anchor.posizione_in_molecola);

      if (dbMol !== ANCHOR_MOLECOLA || dbPosInMol !== ANCHOR_POS_IN_MOL) {
        throw new Error(
          `Stato inatteso per posizione ${ANCHOR_POS}: molecola=${dbMol}, pos_in_molecola=${dbPosInMol}. ` +
            `Atteso: molecola=${ANCHOR_MOLECOLA}, pos_in_molecola=${ANCHOR_POS_IN_MOL}. ` +
            'Prima di eseguire questo fix dobbiamo allineare 17298-17299.'
        );
      }

      // 2) Calcola la sequenza teorica per 17300-17413
      let prevMolecola = ANCHOR_MOLECOLA;
      let prevPosInMol = ANCHOR_POS_IN_MOL;
      const placements = new Map();

      for (let pos = START_POS; pos <= END_POS; pos++) {
        const placement = computeNextMoleculePlacementLocal(prevMolecola, prevPosInMol);
        placements.set(pos, placement);
        prevMolecola = placement.molecola;
        prevPosInMol = placement.posizioneInMolecola;
      }

      const last = placements.get(END_POS);
      if (!last || !['DONANTE_1', 'DONANTE_2', 'DONANTE_3', 'DONANTE_4'].includes(last.ruolo)) {
        throw new Error(
          `Sanity check fallito su ${END_POS}: ruolo ottenuto=${last ? last.ruolo : 'N/A'}, atteso uno tra DONANTE_1..DONANTE_4.`
        );
      }

      // 3) Confronta/aggiorna le posizioni in wallet_positions
      const changes = [];
      const affectedWallets = new Set();

      for (let pos = START_POS; pos <= END_POS; pos++) {
        const dbRes = await client.query(
          'SELECT wallet, movimento, molecola, generazione, ruolo, posizione_in_molecola FROM wallet_positions WHERE posizione = $1',
          [pos]
        );

        if (dbRes.rows.length === 0) {
          changes.push({ posizione: pos, missing: true });
          continue;
        }

        const row = dbRes.rows[0];
        const placement = placements.get(pos);
        if (!placement) {
          throw new Error(`Placement teorico mancante per posizione ${pos}`);
        }

        const before = {
          molecola: Number(row.molecola),
          generazione: row.generazione,
          ruolo: row.ruolo,
          posizione_in_molecola: Number(row.posizione_in_molecola)
        };

        const after = {
          molecola: placement.molecola,
          generazione: placement.generazione,
          ruolo: placement.ruolo,
          posizione_in_molecola: placement.posizioneInMolecola
        };

        affectedWallets.add(String(row.wallet).toLowerCase());

        changes.push({
          posizione: pos,
          wallet: row.wallet,
          before,
          after
        });

        if (APPLY) {
          await client.query(
            `UPDATE wallet_positions
               SET molecola = $1,
                   generazione = $2,
                   ruolo = $3,
                   posizione_in_molecola = $4
             WHERE posizione = $5`,
            [
              after.molecola,
              after.generazione,
              after.ruolo,
              after.posizione_in_molecola,
              pos
            ]
          );
        }
      }

      // 4) Riallinea wallet_master per i wallet toccati (solo in modalità APPLY)
      if (APPLY && affectedWallets.size > 0) {
        const SPECIAL_WALLETS = Object.fromEntries(
          Object.entries(dbUnifiedPg.SPECIAL_WALLETS).map(([k, v]) => [k, v.toLowerCase()])
        );

        for (const w of affectedWallets) {
          const aggRes = await client.query(
            `SELECT movimento, COUNT(*) as count,
                    MIN(posizione) as min_pos, MAX(posizione) as max_pos
               FROM wallet_positions
              WHERE wallet = $1
              GROUP BY movimento`,
            [w]
          );

          let total = 0;
          let small = 0;
          let medium = 0;
          let large = 0;
          let minPos = null;
          let maxPos = null;

          for (const row of aggRes.rows) {
            const movimento = String(row.movimento || '').toUpperCase();
            const count = Number(row.count) || 0;
            const min_p = row.min_pos !== null ? Number(row.min_pos) : null;
            const max_p = row.max_pos !== null ? Number(row.max_pos) : null;

            total += count;
            if (movimento === 'SMALL') small = count;
            if (movimento === 'MEDIUM') medium = count;
            if (movimento === 'LARGE') large = count;

            if (min_p !== null) {
              if (minPos === null || min_p < minPos) minPos = min_p;
            }
            if (max_p !== null) {
              if (maxPos === null || max_p > maxPos) maxPos = max_p;
            }
          }

          const existingMaster = await client.query(
            'SELECT * FROM wallet_master WHERE wallet = $1',
            [w]
          );

          if (total === 0) {
            continue;
          }

          if (existingMaster.rows.length === 0) {
            let tipo = 'HUMAN';
            if (w === SPECIAL_WALLETS.ROG) tipo = 'ROG';
            if (w === SPECIAL_WALLETS.PILETTA) tipo = 'PILETTA';
            if (w === SPECIAL_WALLETS.AVENGERS) tipo = 'AVENGERS';

            await client.query(
              `INSERT INTO wallet_master
                 (wallet, nome, tipo, movimento_corrente, movimento_max,
                  totale_posizioni, posizioni_small, posizioni_medium, posizioni_large,
                  prima_posizione, ultima_posizione)
               VALUES ($1, NULL, $2, 'SMALL', 'SMALL',
                       $3, $4, $5, $6, $7, $8)`,
              [w, tipo, total, small, medium, large, minPos, maxPos]
            );
          } else {
            await client.query(
              `UPDATE wallet_master
                  SET totale_posizioni = $2,
                      posizioni_small = $3,
                      posizioni_medium = $4,
                      posizioni_large = $5,
                      prima_posizione = $6,
                      ultima_posizione = $7
                WHERE wallet = $1`,
              [w, total, small, medium, large, minPos, maxPos]
            );
          }
        }
      }

      return {
        apply: APPLY,
        anchor: {
          posizione: ANCHOR_POS,
          molecola: dbMol,
          posizione_in_molecola: dbPosInMol
        },
        start: START_POS,
        end: END_POS,
        changes,
        affectedWallets: Array.from(affectedWallets)
      };
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Errore /api/admin/fix-molecole-17300-17413:', error);
    return res.status(500).json({ success: false, message: error.message || 'Errore interno del server' });
  }
});

// ============================================
// ADMIN: FIX DEDUP 17300-17413 (wallet_positions)
// ============================================

/**
 * POST /api/admin/fix-dedup-positions-17300-17413
 * Rimuove righe duplicate in wallet_positions (stessa posizione+wallet) nel range 17300-17413
 * e riallinea i contatori in wallet_master per i wallet toccati.
 *
 * Body JSON: { apply: boolean }
 *   - apply = false (default): DRY-RUN, nessuna DELETE, ritorna solo elenco duplicati
 *   - apply = true: elimina le righe duplicate e riallinea wallet_master
 */
app.post('/api/admin/fix-dedup-positions-17300-17413', adminAuthMiddleware, async (req, res) => {
  const APPLY = !!(req.body && req.body.apply);
  const START_POS = 17300;
  const END_POS = 17413;

  try {
    await pgConn.initDatabase();

    const result = await pgConn.transaction(async (client) => {
      console.log('═══════════════════════════════════════');
      console.log('🧹 FIX DUPLICATI wallet_positions 17300-17413 (API)');
      console.log('Modalità:', APPLY ? 'APPLY (scrivo modifiche)' : 'DRY-RUN (solo anteprima)');

      const dupRes = await client.query(
        `SELECT posizione, wallet, array_agg(id ORDER BY id) AS ids, COUNT(*) as count
           FROM wallet_positions
          WHERE posizione BETWEEN $1 AND $2
          GROUP BY posizione, wallet
          HAVING COUNT(*) > 1
          ORDER BY posizione, wallet`,
        [START_POS, END_POS]
      );

      const duplicates = [];
      const affectedWallets = new Set();

      for (const row of dupRes.rows) {
        const pos = Number(row.posizione);
        const wallet = String(row.wallet).toLowerCase();
        const ids = row.ids || [];
        const count = Number(row.count) || ids.length;

        if (ids.length <= 1) continue;

        const keepId = ids[0];
        const toDelete = ids.slice(1);

        duplicates.push({ posizione: pos, wallet, keepId, deleteIds: toDelete, count });

        if (APPLY && toDelete.length > 0) {
          await client.query('DELETE FROM wallet_positions WHERE id = ANY($1::int[])', [toDelete]);
          affectedWallets.add(wallet);
        }
      }

      if (APPLY && affectedWallets.size > 0) {
        console.log('\n📊 Riallineo wallet_master per i wallet interessati...');

        const SPECIAL_WALLETS = Object.fromEntries(
          Object.entries(dbUnifiedPg.SPECIAL_WALLETS).map(([k, v]) => [k, v.toLowerCase()])
        );

        for (const w of affectedWallets) {
          const aggRes = await client.query(
            `SELECT movimento, COUNT(*) as count,
                    MIN(posizione) as min_pos, MAX(posizione) as max_pos
               FROM wallet_positions
              WHERE wallet = $1
              GROUP BY movimento`,
            [w]
          );

          let total = 0;
          let small = 0;
          let medium = 0;
          let large = 0;
          let minPos = null;
          let maxPos = null;

          for (const r of aggRes.rows) {
            const movimento = String(r.movimento || '').toUpperCase();
            const c = Number(r.count) || 0;
            const min_p = r.min_pos !== null ? Number(r.min_pos) : null;
            const max_p = r.max_pos !== null ? Number(r.max_pos) : null;

            total += c;
            if (movimento === 'SMALL') small = c;
            if (movimento === 'MEDIUM') medium = c;
            if (movimento === 'LARGE') large = c;

            if (min_p !== null) {
              if (minPos === null || min_p < minPos) minPos = min_p;
            }
            if (max_p !== null) {
              if (maxPos === null || max_p > maxPos) maxPos = max_p;
            }
          }

          const existingMaster = await client.query(
            'SELECT * FROM wallet_master WHERE wallet = $1',
            [w]
          );

          if (total === 0) {
            if (existingMaster.rows.length === 0) continue;
            await client.query(
              `UPDATE wallet_master
                  SET totale_posizioni = 0,
                      posizioni_small = 0,
                      posizioni_medium = 0,
                      posizioni_large = 0,
                      prima_posizione = NULL,
                      ultima_posizione = NULL
                WHERE wallet = $1`,
              [w]
            );
            continue;
          }

          if (existingMaster.rows.length === 0) {
            let tipo = 'HUMAN';
            if (w === SPECIAL_WALLETS.ROG) tipo = 'ROG';
            if (w === SPECIAL_WALLETS.PILETTA) tipo = 'PILETTA';
            if (w === SPECIAL_WALLETS.AVENGERS) tipo = 'AVENGERS';

            await client.query(
              `INSERT INTO wallet_master
                 (wallet, nome, tipo, movimento_corrente, movimento_max,
                  totale_posizioni, posizioni_small, posizioni_medium, posizioni_large,
                  prima_posizione, ultima_posizione)
               VALUES ($1, NULL, $2, 'SMALL', 'SMALL',
                       $3, $4, $5, $6, $7, $8)`,
              [w, tipo, total, small, medium, large, minPos, maxPos]
            );
          } else {
            await client.query(
              `UPDATE wallet_master
                  SET totale_posizioni = $2,
                      posizioni_small = $3,
                      posizioni_medium = $4,
                      posizioni_large = $5,
                      prima_posizione = $6,
                      ultima_posizione = $7
                WHERE wallet = $1`,
              [w, total, small, medium, large, minPos, maxPos]
            );
          }
        }
      }

      return {
        apply: APPLY,
        range: { from: START_POS, to: END_POS },
        duplicates,
        affectedWallets: Array.from(affectedWallets)
      };
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Errore /api/admin/fix-dedup-positions-17300-17413:', error);
    return res.status(500).json({ success: false, message: error.message || 'Errore interno del server' });
  }
});

// ============================================
// ENDPOINT MIGRAZIONE (ADMIN)
// ============================================

/**
 * POST /api/admin/migrate-wallet
 * Migra un wallet da SQLite locale
 */
app.post('/api/admin/migrate-wallet', async (req, res) => {
  try {
    const w = req.body;
    
    if (!w.wallet) {
      return res.status(400).json({ success: false, error: 'Wallet richiesto' });
    }
    
    await dbUnifiedPg.query(`
      INSERT INTO wallet_master (
        wallet, nome, tipo, prima_posizione, ultima_posizione,
        totale_posizioni, movimento_corrente, accumulo_small, accumulo_medium,
        stelline_rosse, stelline_verdi, stelline_blu
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (wallet) DO UPDATE SET
        nome = EXCLUDED.nome,
        tipo = EXCLUDED.tipo,
        ultima_posizione = EXCLUDED.ultima_posizione,
        totale_posizioni = EXCLUDED.totale_posizioni,
        movimento_corrente = EXCLUDED.movimento_corrente,
        accumulo_small = EXCLUDED.accumulo_small,
        accumulo_medium = EXCLUDED.accumulo_medium,
        stelline_rosse = EXCLUDED.stelline_rosse,
        stelline_verdi = EXCLUDED.stelline_verdi,
        stelline_blu = EXCLUDED.stelline_blu,
        updated_at = NOW()
    `, [
      w.wallet,
      w.nome,
      w.tipo || 'HUMAN',
      w.prima_posizione,
      w.ultima_posizione,
      w.totale_posizioni || 1,
      w.movimento_corrente || 'SMALL',
      w.accumulo_small || 0,
      w.accumulo_medium || 0,
      w.stelline_rosse || 0,
      w.stelline_verdi || 0,
      w.stelline_blu || 0
    ]);
    
    res.json({ success: true, wallet: w.wallet });
  } catch (error) {
    console.error('Errore /api/admin/migrate-wallet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/migrate-position
 * Migra una posizione da SQLite locale
 */
app.post('/api/admin/migrate-position', async (req, res) => {
  try {
    const p = req.body;
    
    if (!p.posizione) {
      return res.status(400).json({ success: false, error: 'Posizione richiesta' });
    }
    
    await dbUnifiedPg.query(`
      INSERT INTO position_master (
        posizione, wallet, nome, movimento, molecola, generazione,
        ruolo, stato, ciclo_corrente, cicli_completati
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (posizione) DO UPDATE SET
        wallet = EXCLUDED.wallet,
        nome = EXCLUDED.nome,
        movimento = EXCLUDED.movimento,
        molecola = EXCLUDED.molecola,
        generazione = EXCLUDED.generazione,
        ruolo = EXCLUDED.ruolo,
        stato = EXCLUDED.stato,
        ciclo_corrente = EXCLUDED.ciclo_corrente,
        cicli_completati = EXCLUDED.cicli_completati,
        updated_at = NOW()
    `, [
      p.posizione,
      p.wallet,
      p.nome,
      p.movimento,
      p.molecola,
      p.generazione,
      p.ruolo || 'RICEVENTE',
      p.stato || 'ATTIVO',
      p.ciclo_corrente || 1,
      p.cicli_completati || 0
    ]);
    
    res.json({ success: true, posizione: p.posizione });
  } catch (error) {
    console.error('Errore /api/admin/migrate-position:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// MONITORING DASHBOARD API - PROGRESSIONE ROG
// ============================================

const netEffects = require('./net-effects-engine-pg');
const vasiComunicanti = require('./vasi-comunicanti-orchestrator-pg');
const largeDistribution = require('./large-distribution-engine-pg');

/**
 * GET /api/admin/progressione/stats
 * Statistiche generali progressione ROG
 */
app.get('/api/admin/progressione/stats', adminAuthMiddleware, async (req, res) => {
  try {
    const stats = await dbUnifiedPg.query(`
      SELECT
        COUNT(*) FILTER (WHERE movimento_corrente = 'SMALL') as small_count,
        COUNT(*) FILTER (WHERE movimento_corrente = 'MEDIUM') as medium_count,
        COUNT(*) FILTER (WHERE movimento_corrente = 'LARGE') as large_count,
        COUNT(*) FILTER (WHERE movimento_corrente = 'EXIT') as exit_count,
        AVG(ciclo_corrente) FILTER (WHERE movimento_corrente = 'SMALL') as small_avg_ciclo,
        AVG(ciclo_corrente) FILTER (WHERE movimento_corrente = 'MEDIUM') as medium_avg_ciclo,
        AVG(ciclo_corrente) FILTER (WHERE movimento_corrente = 'LARGE') as large_avg_ciclo,
        SUM(stelle_red) as total_red_stars,
        SUM(stelle_green) as total_green_stars,
        SUM(stelle_blue) as total_blue_stars
      FROM posizioni_stato
      WHERE ruolo_corrente = 'RICEVENTE'
    `);

    const accumuli = await dbUnifiedPg.query(`
      SELECT
        SUM(accumulo_small) as total_accumulo_small,
        SUM(accumulo_medium) as total_accumulo_medium,
        COUNT(*) FILTER (WHERE accumulo_small > 0) as wallets_accumulo_small,
        COUNT(*) FILTER (WHERE accumulo_medium > 0) as wallets_accumulo_medium
      FROM wallet_master
    `);

    const distributions = await dbUnifiedPg.query(`
      SELECT
        COUNT(*) as total_distributions,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
        SUM(amount_usdc) as total_usdc_distributed,
        SUM(amount_usdc) FILTER (WHERE kind = 'RECEIVER') as receiver_usdc,
        SUM(amount_usdc) FILTER (WHERE kind = 'PONTE') as ponte_usdc
      FROM distribution_tasks
      WHERE movimento = 'LARGE'
    `);

    res.json({
      success: true,
      data: {
        movements: stats.rows[0],
        accumuli: accumuli.rows[0],
        distributions: distributions.rows[0],
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/generazioni/:movimento
 * Lista generazioni attive per movimento
 */
app.get('/api/admin/progressione/generazioni/:movimento', adminAuthMiddleware, async (req, res) => {
  try {
    const { movimento } = req.params;
    
    if (!['SMALL', 'MEDIUM', 'LARGE'].includes(movimento.toUpperCase())) {
      return res.status(400).json({ success: false, error: 'Movimento non valido' });
    }

    const generazioni = await dbUnifiedPg.query(`
      SELECT
        generazione_small_nativa as generazione,
        COUNT(*) as receivers,
        AVG(ciclo_corrente) as avg_ciclo,
        MIN(ciclo_corrente) as min_ciclo,
        MAX(ciclo_corrente) as max_ciclo,
        SUM(stelle_red) as red_stars,
        SUM(stelle_green) as green_stars,
        SUM(stelle_blue) as blue_stars
      FROM posizioni_stato
      WHERE movimento_corrente = $1
        AND ruolo_corrente = 'RICEVENTE'
      GROUP BY generazione_small_nativa
      ORDER BY generazione_small_nativa DESC
    `, [movimento.toUpperCase()]);

    res.json({
      success: true,
      data: {
        movimento,
        generazioni: generazioni.rows,
        total: generazioni.rowCount
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/generazioni:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/generazione/:movimento/:gen
 * Dettagli di una specifica generazione
 */
app.get('/api/admin/progressione/generazione/:movimento/:gen', adminAuthMiddleware, async (req, res) => {
  try {
    const { movimento, gen } = req.params;
    
    if (!['SMALL', 'MEDIUM', 'LARGE'].includes(movimento.toUpperCase())) {
      return res.status(400).json({ success: false, error: 'Movimento non valido' });
    }

    const receivers = await dbUnifiedPg.query(`
      SELECT
        posizione,
        wallet,
        ciclo_corrente,
        stelle_red,
        stelle_green,
        stelle_blue,
        molecola_creazione,
        stato
      FROM posizioni_stato
      WHERE movimento_corrente = $1
        AND generazione_small_nativa = $2
        AND ruolo_corrente = 'RICEVENTE'
      ORDER BY posizione ASC
    `, [movimento.toUpperCase(), parseInt(gen)]);

    res.json({
      success: true,
      data: {
        movimento,
        generazione: parseInt(gen),
        receivers: receivers.rows,
        count: receivers.rowCount
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/generazione:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/cascade/:movimento/:gen
 * Mostra cascade vasi comunicanti per generazione
 */
app.get('/api/admin/progressione/cascade/:movimento/:gen', adminAuthMiddleware, async (req, res) => {
  try {
    const { movimento, gen } = req.params;
    
    if (!['SMALL', 'MEDIUM', 'LARGE'].includes(movimento.toUpperCase())) {
      return res.status(400).json({ success: false, error: 'Movimento non valido' });
    }

    const startGen = parseInt(gen);
    const cascade = [];
    let currentGen = startGen;

    // Calcola cascade: offset -2 fino a H2
    while (currentGen >= 2) {
      const genStats = await dbUnifiedPg.query(`
        SELECT
          generazione_small_nativa as generazione,
          COUNT(*) as receivers,
          AVG(ciclo_corrente) as avg_ciclo,
          SUM(CASE WHEN stelle_red = 3 OR stelle_green = 3 OR stelle_blue = 8 THEN 1 ELSE 0 END) as ready_to_advance
        FROM posizioni_stato
        WHERE movimento_corrente = $1
          AND generazione_small_nativa = $2
          AND ruolo_corrente = 'RICEVENTE'
        GROUP BY generazione_small_nativa
      `, [movimento.toUpperCase(), currentGen]);

      if (genStats.rowCount > 0) {
        cascade.push(genStats.rows[0]);
      }

      currentGen -= 2;
    }

    res.json({
      success: true,
      data: {
        movimento,
        startGen,
        cascade,
        cascadeLength: cascade.length
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/cascade:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/accumuli
 * Lista wallet con accumuli SMALL/MEDIUM
 */
app.get('/api/admin/progressione/accumuli', adminAuthMiddleware, async (req, res) => {
  try {
    const wallets = await dbUnifiedPg.query(`
      SELECT
        wallet,
        nome,
        accumulo_small,
        accumulo_medium,
        movimento_corrente,
        prima_posizione,
        ultima_posizione,
        totale_posizioni,
        updated_at
      FROM wallet_master
      WHERE accumulo_small > 0 OR accumulo_medium > 0
      ORDER BY (accumulo_small + accumulo_medium) DESC
    `);

    res.json({
      success: true,
      data: {
        wallets: wallets.rows,
        count: wallets.rowCount
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/accumuli:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/distributions
 * Lista distribuzioni LARGE
 */
app.get('/api/admin/progressione/distributions', adminAuthMiddleware, async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;

    let query = `
      SELECT
        id,
        movimento,
        kind,
        receiver_wallet,
        receiver_posizione,
        recipient_wallet,
        amount_usdc,
        status,
        external_tx_hash,
        chain_tx_hash,
        error,
        created_at,
        updated_at
      FROM distribution_tasks
      WHERE movimento = 'LARGE'
    `;

    const params = [];

    if (status) {
      query += ` AND status = $1`;
      params.push(status.toUpperCase());
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const distributions = await dbUnifiedPg.query(query, params);

    res.json({
      success: true,
      data: {
        distributions: distributions.rows,
        count: distributions.rowCount
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/distributions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/ponti
 * Lista accoppiamenti ponti invitanti
 */
app.get('/api/admin/progressione/ponti', adminAuthMiddleware, async (req, res) => {
  try {
    const ponti = await dbUnifiedPg.query(`
      SELECT
        receiver_wallet,
        ponte_wallet,
        percentage,
        created_at,
        is_permanent
      FROM ponte_accoppiamenti
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: {
        ponti: ponti.rows,
        count: ponti.rowCount
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/ponti:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/progressione/molecule/:molecola
 * Stato ciclo di una molecola
 */
app.get('/api/admin/progressione/molecule/:molecola', adminAuthMiddleware, async (req, res) => {
  try {
    const { molecola } = req.params;

    const molecolaStatus = await dbUnifiedPg.query(`
      SELECT
        molecola,
        movimento,
        ciclo,
        completed_at,
        net_effects_applied
      FROM molecola_cycle_completed
      WHERE molecola = $1
      ORDER BY ciclo DESC
      LIMIT 10
    `, [parseInt(molecola)]);

    const positions = await dbUnifiedPg.query(`
      SELECT
        posizione,
        wallet,
        movimento_corrente,
        ciclo_corrente,
        ruolo_corrente,
        stelle_red,
        stelle_green,
        stelle_blue
      FROM posizioni_stato
      WHERE molecola_creazione = $1
      ORDER BY posizione ASC
    `, [parseInt(molecola)]);

    res.json({
      success: true,
      data: {
        molecola: parseInt(molecola),
        history: molecolaStatus.rows,
        positions: positions.rows
      }
    });
  } catch (error) {
    console.error('Errore /api/admin/progressione/molecule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT MODIFICA WALLET/DATI UTENTE (ADMIN)
// ============================================

/**
 * PATCH /api/admin/wallet/update
 * Modifica wallet e dati utente dal pannello admin
 * 
 * Body JSON:
 * {
 *   "oldWallet": "0x...",        // wallet attuale (richiesto)
 *   "newWallet": "0x...",        // nuovo wallet (opzionale)
 *   "nome": "Nome",              // nuovo nome (opzionale)
 *   "tipo": "HUMAN",             // nuovo tipo (opzionale)
 *   "accumulo_small": 10,        // nuovo accumulo small (opzionale)
 *   "accumulo_medium": 20        // nuovo accumulo medium (opzionale)
 * }
 */
app.patch('/api/admin/wallet/update', adminAuthMiddleware, async (req, res) => {
  try {
    const { oldWallet, newWallet, nome, tipo, accumulo_small, accumulo_medium } = req.body;
    
    // Validazione
    if (!oldWallet) {
      return res.status(400).json({ success: false, error: 'oldWallet richiesto' });
    }
    
    const oldWalletNorm = oldWallet.toLowerCase();
    
    // Verifica che il wallet esista
    const existing = await pg.queryOne('SELECT * FROM wallet_master WHERE wallet = $1', [oldWalletNorm]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Wallet non trovato' });
    }
    
    // Prepara le modifiche
    const updates = [];
    const params = [oldWalletNorm];
    let paramCount = 1;
    
    if (newWallet && newWallet.toLowerCase() !== oldWalletNorm) {
      // Verifica che il nuovo wallet non esista già
      const newWalletNorm = newWallet.toLowerCase();
      const duplicate = await pg.queryOne('SELECT 1 FROM wallet_master WHERE wallet = $1', [newWalletNorm]);
      if (duplicate) {
        return res.status(400).json({ success: false, error: 'Il nuovo wallet esiste già nel sistema' });
      }
      
      // Modifica wallet richiede aggiornamenti in multiple tabelle
      await pgConn.transaction(async (client) => {
        // 1. Aggiorna wallet_master
        await client.query('UPDATE wallet_master SET wallet = $1, updated_at = NOW() WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        
        // 2. Aggiorna wallet_positions
        await client.query('UPDATE wallet_positions SET wallet = $1 WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        
        // 3. Aggiorna posizioni_small
        await client.query('UPDATE posizioni_small SET wallet = $1 WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        
        // 4. Aggiorna posizioni_medium
        await client.query('UPDATE posizioni_medium SET wallet = $1 WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        
        // 5. Aggiorna posizioni_large
        await client.query('UPDATE posizioni_large SET wallet = $1 WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        
        // 6. Aggiorna anagrafica_invitati (se presente)
        try {
          await client.query('UPDATE anagrafica_invitati SET invitante_wallet = $1 WHERE invitante_wallet = $2', [newWalletNorm, oldWalletNorm]);
          await client.query('UPDATE anagrafica_invitati SET invitato_wallet = $1 WHERE invitato_wallet = $2', [newWalletNorm, oldWalletNorm]);
        } catch (err) {
          // tabella potrebbe non esistere, ignora
        }
        
        // 7. Aggiorna community_registrations (se presente)
        try {
          await client.query('UPDATE community_registrations SET wallet = $1 WHERE wallet = $2', [newWalletNorm, oldWalletNorm]);
        } catch (err) {
          // tabella potrebbe non esistere, ignora
        }
      });
      
      return res.json({
        success: true,
        message: `Wallet modificato da ${oldWallet} a ${newWallet}`,
        oldWallet,
        newWallet: newWalletNorm
      });
    }
    
    // Modifica altri campi (senza cambiare wallet)
    if (nome !== undefined) {
      updates.push(`nome = $${++paramCount}`);
      params.push(nome);
    }
    
    if (tipo !== undefined) {
      // Valida tipo
      if (!['HUMAN', 'ROG', 'PILETTA', 'AVENGERS'].includes(tipo.toUpperCase())) {
        return res.status(400).json({ success: false, error: 'Tipo non valido. Valori accettati: HUMAN, ROG, PILETTA, AVENGERS' });
      }
      updates.push(`tipo = $${++paramCount}`);
      params.push(tipo.toUpperCase());
    }
    
    if (accumulo_small !== undefined) {
      updates.push(`accumulo_small = $${++paramCount}`);
      params.push(Number(accumulo_small) || 0);
    }
    
    if (accumulo_medium !== undefined) {
      updates.push(`accumulo_medium = $${++paramCount}`);
      params.push(Number(accumulo_medium) || 0);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nessuna modifica specificata' });
    }
    
    // Applica modifiche
    updates.push('updated_at = NOW()');
    const query = `UPDATE wallet_master SET ${updates.join(', ')} WHERE wallet = $1 RETURNING *`;
    const result = await pg.query(query, params);
    
    return res.json({
      success: true,
      message: 'Wallet aggiornato con successo',
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Errore /api/admin/wallet/update:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/wallet/:wallet
 * Ottieni dettagli completi di un wallet (per form modifica)
 */
app.get('/api/admin/wallet/:wallet', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet } = req.params;
    const walletNorm = wallet.toLowerCase();
    
    const walletInfo = await pg.queryOne('SELECT * FROM wallet_master WHERE wallet = $1', [walletNorm]);
    if (!walletInfo) {
      return res.status(404).json({ success: false, error: 'Wallet non trovato' });
    }
    
    const positions = await pg.queryMany('SELECT * FROM wallet_positions WHERE wallet = $1 ORDER BY posizione ASC', [walletNorm]);
    
    return res.json({
      success: true,
      data: {
        walletInfo,
        positions,
        totalPositions: positions.length
      }
    });
    
  } catch (error) {
    console.error('Errore /api/admin/wallet/:wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: error.message
    });
  }
});

// ============================================
// ENDPOINT ADMIN: FIX MOLECOLE CORROTTE 17648-17656
// ============================================

/**
 * POST /api/admin/fix-molecole-17648-17656
 * Fix molecole corrotte create da donazione con stato database inconsistente.
 * Body: { apply: boolean }
 */
app.post('/api/admin/fix-molecole-17648-17656', adminAuthMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const hasPermission = await authManager.hasPermission(token, 'VIEW_LOGS');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permesso negato' });
    }

    const APPLY = !!(req.body && req.body.apply);
    const POSITIONS_TO_FIX = [17648, 17650, 17652, 17654, 17656];
    const ANCHOR_POS = 17536;
    const ANCHOR_MOLECOLA = 3509;
    const ANCHOR_POS_IN_MOL = 7; // DONANTE_3

    console.log('\n🛠️  FIX MOLECOLE CORROTTE 17648-17656');
    console.log(`Modalità: ${APPLY ? 'APPLY (modifica DB)' : 'DRY-RUN (preview)'}\n`);

    // Funzione helper per calcolare placement
    function computeNextPlacement(prevMolecola, prevPosInMol) {
      const ruoliMap = {
        1: 'RICEVENTE', 2: 'PONTE_SX', 3: 'PONTE_DX',
        4: 'DONANTE_1', 5: 'DONANTE_2', 6: 'DONANTE_3', 7: 'DONANTE_4'
      };
      let nextPosInMol = prevPosInMol + 1;
      let nextMol = prevMolecola;
      if (nextPosInMol > 7) {
        nextPosInMol = 4;
        nextMol = prevMolecola + 1;
      }
      return {
        molecola: nextMol,
        generazione: 'H14',
        ruolo: ruoliMap[nextPosInMol] || 'UNKNOWN',
        posizioneInMolecola: nextPosInMol
      };
    }

    const result = await pgConn.transaction(async (client) => {
      // 1. Verifica stato ancora
      const anchorRes = await client.query(
        'SELECT molecola, posizione_in_molecola, generazione FROM wallet_positions WHERE posizione = $1',
        [ANCHOR_POS]
      );

      if (anchorRes.rows.length === 0) {
        throw new Error(`Posizione ancora ${ANCHOR_POS} non trovata!`);
      }

      const anchor = anchorRes.rows[0];
      if (Number(anchor.molecola) !== ANCHOR_MOLECOLA || Number(anchor.posizione_in_molecola) !== ANCHOR_POS_IN_MOL) {
        throw new Error(
          `Stato ancora non valido! Atteso: mol=${ANCHOR_MOLECOLA}, pos=${ANCHOR_POS_IN_MOL}. ` +
          `Trovato: mol=${anchor.molecola}, pos=${anchor.posizione_in_molecola}`
        );
      }

      console.log(`✅ Ancora verificata: pos ${ANCHOR_POS}, mol ${ANCHOR_MOLECOLA}`);

      // 2. Calcola placements corretti
      const lastPosToFix = Math.max(...POSITIONS_TO_FIX);
      const placements = new Map();
      let prevMol = ANCHOR_MOLECOLA;
      let prevPosInMol = ANCHOR_POS_IN_MOL;

      for (let pos = ANCHOR_POS + 1; pos <= lastPosToFix; pos++) {
        const placement = computeNextPlacement(prevMol, prevPosInMol);
        placements.set(pos, placement);
        prevMol = placement.molecola;
        prevPosInMol = placement.posizioneInMolecola;
      }

      // 3. Verifica e correggi
      const changes = [];

      for (const pos of POSITIONS_TO_FIX) {
        const currentRes = await client.query(
          'SELECT wallet, molecola, posizione_in_molecola, generazione, ruolo FROM wallet_positions WHERE posizione = $1',
          [pos]
        );

        if (currentRes.rows.length === 0) {
          console.log(`⚠️  Pos ${pos}: non trovata`);
          continue;
        }

        const current = currentRes.rows[0];
        const correct = placements.get(pos);

        const before = {
          molecola: Number(current.molecola),
          generazione: current.generazione,
          ruolo: current.ruolo,
          posizione_in_molecola: Number(current.posizione_in_molecola)
        };

        const after = {
          molecola: correct.molecola,
          generazione: correct.generazione,
          ruolo: correct.ruolo,
          posizione_in_molecola: correct.posizioneInMolecola
        };

        const needsFix = (
          before.molecola !== after.molecola ||
          before.generazione !== after.generazione ||
          before.ruolo !== after.ruolo ||
          before.posizione_in_molecola !== after.posizione_in_molecola
        );

        if (needsFix) {
          changes.push({
            posizione: pos,
            wallet: current.wallet,
            before,
            after
          });

          if (APPLY) {
            await client.query(
              `UPDATE wallet_positions
               SET molecola = $1, generazione = $2, ruolo = $3, posizione_in_molecola = $4
               WHERE posizione = $5`,
              [after.molecola, after.generazione, after.ruolo, after.posizione_in_molecola, pos]
            );
            console.log(`✅ Pos ${pos} aggiornata: mol ${before.molecola}→${after.molecola}`);
          }
        }
      }

      return { changes, applied: APPLY };
    });

    console.log(`\n${result.applied ? '✅ Correzioni applicate' : '🔍 Preview completata'}: ${result.changes.length} posizioni\n`);

    return res.json({
      success: true,
      applied: result.applied,
      changesCount: result.changes.length,
      changes: result.changes,
      message: result.applied
        ? `${result.changes.length} posizioni corrette con successo`
        : `${result.changes.length} posizioni necessitano correzione. Invia {"apply": true} per applicare.`
    });

  } catch (error) {
    console.error('Errore fix molecole:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Errore interno del server'
    });
  }
});

// ============================================
// FIX INVITATI 17680-17698 (TEMPORANEO)
// ============================================
app.post('/api/admin/fix-invitati-17680', adminAuthMiddleware, async (req, res) => {
  try {
    const ANNA = '0xbe17ce579328fcdb3213ba98957c95b4d9fce6a0';
    const PASQUALE = '0x4f1b12c9d4182d55d23b87a2dd451ec0618eb17e';
    const POSITIONS = [17680,17682,17684,17686,17688,17690,17692,17694,17696,17698];
    const APPLY = req.body?.apply === true;

    const pool = pgConn.getPool();
    const current = await pool.query(
      `SELECT invitato_pos, invitante_wallet FROM anagrafica_invitati WHERE invitato_pos = ANY($1) ORDER BY invitato_pos`, [POSITIONS]
    );
    const toFix = current.rows.filter(r => r.invitante_wallet?.toLowerCase() === PASQUALE);

    if (APPLY && toFix.length > 0) {
      const result = await pool.query(
        `UPDATE anagrafica_invitati SET invitante_wallet = $1 WHERE invitato_pos = ANY($2) AND invitante_wallet = $3 RETURNING invitato_pos`,
        [ANNA, POSITIONS, PASQUALE]
      );
      return res.json({ success: true, applied: true, fixed: result.rowCount, message: `${result.rowCount} invitati corretti` });
    }

    return res.json({ success: true, applied: false, toFix: toFix.length, records: current.rows, message: toFix.length > 0 ? 'Invia {"apply":true} per applicare' : 'Nessuna correzione necessaria' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// FIX: Inserisci invitati mancanti 17686-17698 per Anna
app.post('/api/admin/fix-invitati-17686-missing', adminAuthMiddleware, async (req, res) => {
  try {
    const ANNA = '0xbe17ce579328fcdb3213ba98957c95b4d9fce6a0';
    const MISSING = [17686,17688,17690,17692,17694,17696,17698];
    const APPLY = req.body?.apply === true;

    const pool = pgConn.getPool();
    // Trova la prima posizione di Anna per invitante_pos
    const annaPos = await pool.query(`SELECT MIN(posizione) as min_pos FROM wallet_positions WHERE LOWER(wallet) = $1`, [ANNA]);
    const invitante_pos = annaPos.rows[0]?.min_pos || 0;

    // Verifica quali mancano
    const existing = await pool.query(`SELECT invitato_pos FROM anagrafica_invitati WHERE invitato_pos = ANY($1)`, [MISSING]);
    const existingSet = new Set(existing.rows.map(r => r.invitato_pos));
    const toInsert = MISSING.filter(p => !existingSet.has(p));

    if (APPLY && toInsert.length > 0) {
      let inserted = 0;
      for (const pos of toInsert) {
        await pool.query(
          `INSERT INTO anagrafica_invitati (invitante_pos, invitante_wallet, invitato_pos, invitato_wallet, livello, created_at) VALUES ($1, $2, $3, $4, 1, NOW()) ON CONFLICT DO NOTHING`,
          [invitante_pos, ANNA, pos, ANNA]
        );
        inserted++;
      }
      return res.json({ success: true, applied: true, inserted, message: `${inserted} invitati inseriti` });
    }

    return res.json({ success: true, applied: false, missing: toInsert, alreadyExist: [...existingSet], message: toInsert.length > 0 ? `${toInsert.length} da inserire. Invia {"apply":true}` : 'Tutti presenti' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// REGISTRAZIONE ENDPOINTS MEDIA UPLOAD (ADMIN)
// ============================================

// Usa adminAuthMiddleware per proteggere upload/list/elimina media
registerMediaUploadEndpoints(app, adminAuthMiddleware);

// ============================================
// GALLERY API ENDPOINTS
// ============================================

// Serve file statici della galleria (pubblici)
app.use('/uploads/gallery', express.static(galleryManager.UPLOADS_DIR));

// API Gallery: GET pubblico (lettura galleria), POST/PUT/DELETE solo admin
// NOTA: galleryAPI è un Express Router, va montato con app.use() non app.get()
// app.use() taglia il prefisso prima di passarlo al router (router.get('/') funziona)
app.use('/api/gallery', (req, res, next) => {
  if (req.method === 'GET') return next();
  return adminAuthMiddleware(req, res, next);
}, galleryAPI);

// Serve file statici del frontend
const FRONTEND_DIR = path.join(__dirname, '..', 'FRONTEND_1_FEBBRAIO_DINAMICO');
app.use(express.static(FRONTEND_DIR));

// ============================================
// MAINTENANCE MODE API
// ============================================

/**
 * GET /api/site-status
 * Restituisce lo stato del sito (manutenzione attiva/disattiva)
 * PUBBLICO - Usato dal frontend per mostrare overlay manutenzione
 */
app.get('/api/site-status', async (req, res) => {
  try {
    const status = await maintenanceManager.getStatus();
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error('Errore site-status:', error);
    return res.json({ success: true, maintenance: false });
  }
});

/**
 * POST /api/admin/maintenance/enable
 * Attiva la modalità manutenzione
 * PROTETTO - Solo admin autenticati
 */
app.post('/api/admin/maintenance/enable', adminAuthMiddleware, async (req, res) => {
  try {
    const { message, estimatedEndTime } = req.body;
    const status = await maintenanceManager.enableMaintenance({ message, estimatedEndTime });
    
    return res.json({
      success: true,
      message: '🔧 Modalità manutenzione ATTIVATA',
      status
    });
  } catch (error) {
    console.error('Errore enable maintenance:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/maintenance/disable
 * Disattiva la modalità manutenzione
 * PROTETTO - Solo admin autenticati
 */
app.post('/api/admin/maintenance/disable', adminAuthMiddleware, async (req, res) => {
  try {
    const status = await maintenanceManager.disableMaintenance();
    
    return res.json({
      success: true,
      message: '✅ Modalità manutenzione DISATTIVATA - Sito online',
      status
    });
  } catch (error) {
    console.error('Errore disable maintenance:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/admin/maintenance/status
 * Ottiene lo stato manutenzione (per pannello admin)
 * PROTETTO - Solo admin autenticati
 */
app.get('/api/admin/maintenance/status', adminAuthMiddleware, async (req, res) => {
  try {
    const status = await maintenanceManager.getStatus();
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error('Errore maintenance status:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ADMIN: GESTIONE CODA DONO AL VOLO (FIFO)
// ============================================

/**
 * GET /api/admin/dono-al-volo/queue
 * Ottiene la lista dei wallet in coda per Dono al Volo
 * PROTETTO - Solo admin autenticati
 */
app.get('/api/admin/dono-al-volo/queue', adminAuthMiddleware, async (req, res) => {
  try {
    const pool = pgConn.getPool();
    const result = await pool.query(`
      SELECT id, wallet_address, nome, segnalato_da, note, status, used_at, used_by_donation_id, created_at
      FROM dono_al_volo_queue
      ORDER BY status ASC, id ASC
    `);
    
    return res.json({
      success: true,
      queue: result.rows,
      pending: result.rows.filter(r => r.status === 'PENDING').length,
      used: result.rows.filter(r => r.status === 'USED').length,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Errore lettura coda Dono al Volo:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/dono-al-volo/queue/add
 * Aggiunge un wallet alla coda Dono al Volo
 * Body: { wallet_address, nome, segnalato_da?, note? }
 * PROTETTO - Solo admin autenticati
 */
app.post('/api/admin/dono-al-volo/queue/add', adminAuthMiddleware, async (req, res) => {
  try {
    const { wallet_address, nome, segnalato_da, note } = req.body;
    
    if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
      return res.status(400).json({ success: false, message: 'Wallet address non valido' });
    }
    if (!nome || !nome.trim()) {
      return res.status(400).json({ success: false, message: 'Nome richiesto' });
    }
    
    const pool = pgConn.getPool();
    
    // Verifica se il wallet è già in coda (PENDING)
    const existing = await pool.query(
      'SELECT id FROM dono_al_volo_queue WHERE wallet_address = $1 AND status = $2',
      [wallet_address.toLowerCase(), 'PENDING']
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Wallet già presente in coda (PENDING)' });
    }
    
    const result = await pool.query(`
      INSERT INTO dono_al_volo_queue (wallet_address, nome, segnalato_da, note, status)
      VALUES ($1, $2, $3, $4, 'PENDING')
      RETURNING *
    `, [wallet_address.toLowerCase(), nome.trim(), segnalato_da || null, note || null]);
    
    console.log(`✅ Wallet aggiunto alla coda Dono al Volo: ${nome} (${wallet_address})`);
    
    return res.json({
      success: true,
      message: `Wallet ${nome} aggiunto alla coda`,
      entry: result.rows[0]
    });
  } catch (error) {
    console.error('Errore aggiunta coda Dono al Volo:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/admin/dono-al-volo/queue/:id
 * Rimuove un wallet dalla coda Dono al Volo
 * PROTETTO - Solo admin autenticati
 */
app.delete('/api/admin/dono-al-volo/queue/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = pgConn.getPool();
    
    const result = await pool.query(
      'DELETE FROM dono_al_volo_queue WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry non trovata' });
    }
    
    console.log(`🗑️ Wallet rimosso dalla coda Dono al Volo: ${result.rows[0].nome}`);
    
    return res.json({
      success: true,
      message: 'Wallet rimosso dalla coda',
      deleted: result.rows[0]
    });
  } catch (error) {
    console.error('Errore rimozione coda Dono al Volo:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/admin/dono-al-volo/queue/:id/reset
 * Resetta lo status di un wallet a PENDING (per riutilizzarlo)
 * PROTETTO - Solo admin autenticati
 */
app.put('/api/admin/dono-al-volo/queue/:id/reset', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = pgConn.getPool();
    
    const result = await pool.query(`
      UPDATE dono_al_volo_queue
      SET status = 'PENDING', used_at = NULL, used_by_donation_id = NULL
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry non trovata' });
    }
    
    console.log(`🔄 Wallet resettato a PENDING: ${result.rows[0].nome}`);
    
    return res.json({
      success: true,
      message: 'Wallet resettato a PENDING',
      entry: result.rows[0]
    });
  } catch (error) {
    console.error('Errore reset coda Dono al Volo:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ADMIN: REPORT PDF PERIODICO
// ============================================

/**
 * POST /api/admin/report/generate-pdf
 * Genera e scarica report PDF periodico (mensile)
 * Body opzionale: { month, year } oppure { fromDate, toDate }
 * PROTETTO - Solo ADMIN / SUPER_ADMIN
 */
app.post('/api/admin/report/generate-pdf', adminAuthMiddleware, async (req, res) => {
  try {
    const accessLevel = String(req.authSession?.accessLevel || '').toUpperCase();
    if (!['SUPER_ADMIN', 'ADMIN'].includes(accessLevel)) {
      return res.status(403).json({
        success: false,
        message: 'Permesso negato: endpoint riservato ad ADMIN/SUPER_ADMIN'
      });
    }

    const { month, year, fromDate, toDate } = req.body || {};

    const result = await reportGenerator.generateReportPDF({
      month,
      year,
      fromDate,
      toDate
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    return res.status(200).send(result.pdfBuffer);
  } catch (error) {
    console.error('Errore generazione report PDF:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Errore generazione report PDF'
    });
  }
});
// ============================================
// ADMIN: REPROCESSING MANUALE DONAZIONI STUCK
// ============================================

/**
 * POST /api/admin/donation/reprocess
 * Riprocessa manualmente una donazione USDC confermata on-chain
 * ma non processata dal backend (es. dopo riavvio server).
 *
 * Body: { txHash: string }
 * Opzionale: { donor: string, amountUSDC: number } — usa questi se la lettura RPC fallisce
 *
 * Richiede: token staff con permesso ACCESS_DATABASE
 */
app.post('/api/admin/donation/reprocess', adminAuthMiddleware, async (req, res) => {
  try {
    const accessLevel = String(req.authSession?.accessLevel || '').toUpperCase();
    if (!['SUPER_ADMIN', 'ADMIN'].includes(accessLevel)) {
      return res.status(403).json({
        success: false,
        message: 'Permesso negato: endpoint riservato ad ADMIN/SUPER_ADMIN'
      });
    }

    const { txHash, donor: forceDonor, amountUSDC: forceAmount } = req.body || {};

    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
      return res.status(400).json({ success: false, message: 'txHash richiesto (deve iniziare con 0x)' });
    }

    const txHashLower = txHash.toLowerCase();
    console.log(`\n🔧 ADMIN REPROCESS: txHash=${txHashLower} admin=${req.authSession?.username}`);

    // 1. Controlla se già processata correttamente
    const pool = pgConn.getPool();
    const existing = await pool.query(
      `SELECT donation_id, donation_type, positions_created, payload FROM donations WHERE LOWER(tx_hash) = $1 LIMIT 1`,
      [txHashLower]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.payload?.success && Number(row.positions_created) > 0) {
        return res.json({
          success: true,
          alreadyProcessed: true,
          message: 'Donazione già processata correttamente',
          positionsCreated: row.positions_created,
          donationType: row.donation_type
        });
      }
      console.log(`⚠️  Trovata come ${row.donation_type} con ${row.positions_created} posizioni — riprocesso`);
    }

    // 2. Leggi dati on-chain (o usa parametri forzati)
    let donorWallet, amountUSDC, timestampIso, logIndex;

    if (forceDonor && forceAmount) {
      donorWallet  = String(forceDonor).toLowerCase();
      amountUSDC   = Number(forceAmount);
      timestampIso = new Date().toISOString();
      logIndex     = 0;
      console.log(`⚡ Parametri manuali: donor=${donorWallet} amount=${amountUSDC}`);
    } else {
      try {
        const { ethers: eth } = require('ethers');
        const USDC_ADDR  = (process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359').toLowerCase();
        const ROG_ADDR   = (process.env.ROG_WALLET_ADDRESS    || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790').toLowerCase();
        const TF_TOPIC   = eth.utils.id('Transfer(address,address,uint256)');
        const rpcUrl     = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/';
        const provider   = new eth.providers.JsonRpcProvider(rpcUrl);

        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) throw new Error('Receipt non trovato on-chain');
        if (receipt.status !== 1) throw new Error('Transazione fallita on-chain (status != 1)');

        let found = false;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== USDC_ADDR) continue;
          if (log.topics[0] !== TF_TOPIC) continue;
          const to = '0x' + log.topics[2].slice(26);
          if (to.toLowerCase() !== ROG_ADDR) continue;
          donorWallet = '0x' + log.topics[1].slice(26);
          amountUSDC  = parseInt(log.data, 16) / 1e6;
          logIndex    = log.logIndex;
          const block = await provider.getBlock(receipt.blockNumber);
          timestampIso = block?.timestamp ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();
          found = true;
          break;
        }
        if (!found) throw new Error('Nessun Transfer USDC verso ROG_WALLET in questa TX');
      } catch (rpcErr) {
        return res.status(400).json({
          success: false,
          message: `Errore lettura on-chain: ${rpcErr.message}. Prova con i parametri donor e amountUSDC.`
        });
      }
    }

    // 3. Validazioni base
    if (!/^0x[a-f0-9]{40}$/.test(donorWallet)) {
      return res.status(400).json({ success: false, message: `Wallet donor non valido: ${donorWallet}` });
    }
    if (!Number.isFinite(amountUSDC) || amountUSDC <= 0) {
      return res.status(400).json({ success: false, message: `Importo non valido: ${amountUSDC}` });
    }

    // 4. Normalizza importo a multiplo di 2
    const amountNorm = Math.floor(amountUSDC / 2) * 2;
    if (amountNorm <= 0) {
      return res.status(400).json({ success: false, message: `Importo ${amountUSDC} USDC troppo piccolo (minimo 2 USDC)` });
    }

    const donationId = `${txHashLower}:${logIndex || 0}`;

    console.log(`   donor=${donorWallet} amount=${amountNorm} USDC donationId=${donationId}`);

    // 5. Processa
    const result = await donationFlowManager.processDonation({
      donationId,
      donor:        donorWallet,
      amountUSDC:   amountNorm,
      txHash:       txHashLower,
      timestamp:    timestampIso,
      donationType: 'standard'
    });

    if (!result.success) {
      console.error('❌ processDonation fallito:', result.error || result.message);
      return res.status(422).json({
        success: false,
        message: result.error || result.message,
        donorWallet,
        amountUSDC: amountNorm
      });
    }

    console.log(`✅ Reprocess OK: ${result.donation?.positionsCreated} posizioni create`);

    return res.json({
      success: true,
      reprocessed: true,
      deduped: result.deduped || false,
      txHash: txHashLower,
      donorWallet,
      amountUSDC: amountNorm,
      positionsCreated: result.donation?.positionsCreated || 0,
      firstPosition:    result.donation?.firstPosition,
      lastPosition:     result.donation?.lastPosition
    });

  } catch (error) {
    console.error('Errore /api/admin/donation/reprocess:', error);
    return res.status(500).json({ success: false, message: error.message || 'Errore interno' });
  }
});

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint non trovato'
  });
});

// Error handler generale
app.use((err, req, res, next) => {
  console.error('Errore server:', err);
  res.status(500).json({
    success: false,
    message: 'Errore interno del server'
  });
});

// ============================================
// START SERVER
// ============================================

// Inizializza database galleria
(async () => {
  try {
    await galleryManager.initGalleryTable();
    console.log('✅ Gallery database initialized');
  } catch (error) {
    console.error('❌ Failed to initialize gallery database:', error);
  }
})();

app.listen(PORT, () => {
  console.log('');
  console.log('═'.repeat(60));
  console.log('🚀 ROG API SERVER AVVIATO');
  console.log('═'.repeat(60));
  console.log(`📡 Server in ascolto su: http://localhost:${PORT}`);
  console.log(`🔐 Autenticazione: NASA-LEVEL attiva`);
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
  console.log('═'.repeat(60));
  console.log('');
  console.log('📋 Endpoints disponibili:');
  console.log('   POST   /api/auth/login');
  console.log('   POST   /api/auth/logout');
  console.log('   GET    /api/auth/verify');
  console.log('   GET    /api/auth/stats');
  console.log('   GET    /api/anagrafica/count');
  console.log('   GET    /api/cassa/bilancio');
  console.log('   GET    /api/cassa/sezione/:nome');
  console.log('   GET    /health');
  console.log('   🎨 Gallery API:');
  console.log('   GET    /api/gallery');
  console.log('   POST   /api/gallery');
  console.log('   PUT    /api/gallery/:id');
  console.log('   DELETE /api/gallery/:id');
  console.log('');
  console.log('🛡️  Credenziali staff configurate:');
  console.log('   superadmin, admin, manager, editor');
  console.log('');
  console.log('✨ Pronto per ricevere richieste!');
  console.log('═'.repeat(60));
  console.log('');
});

module.exports = app;
