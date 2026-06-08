/**
 * 🔒 URANO v2 — Security Manager
 *
 * Sicurezza del sistema URANO.
 * Implementa tutte le protezioni disponibili per un sistema
 * che gestisce transazioni finanziarie reali su blockchain.
 *
 * LIVELLI DI PROTEZIONE:
 *  1. HTTP Security Headers (Helmet)
 *  2. Rate Limiting (anti-DoS, anti-brute-force)
 *  3. Body Size Limit (anti-payload-flood)
 *  4. Input Validation (wallet, txHash, tipi)
 *  5. Admin API Key (endpoint privilegiati)
 *  6. Request Timeout (anti-slowloris)
 *  7. CORS hardening in produzione
 *  8. Environment Variables validation
 *  9. Error sanitization (nessun leak interno)
 * 10. Security Event Logging
 */

const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

// ============================================================
// 1. HELMET — HTTP Security Headers
// ============================================================

const helmetMiddleware = helmet({
  // Impedisce il MIME-type sniffing
  contentTypeOptions: true,
  // Impedisce il clickjacking (X-Frame-Options: DENY)
  frameguard: { action: 'deny' },
  // XSS Protection header legacy
  xssFilter: true,
  // HSTS: forza HTTPS per 1 anno (solo in produzione)
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // Nessun referrer verso siti esterni
  referrerPolicy: { policy: 'no-referrer' },
  // Nasconde tecnologia usata
  hidePoweredBy: true,
  // Content Security Policy — blocca risorse non autorizzate
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'none'"],
      scriptSrc:   ["'none'"],
      styleSrc:    ["'none'"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    }
  }
});

// ============================================================
// 2. RATE LIMITING
// ============================================================

// Limite generale: 2000 richieste ogni 15 minuti per IP (alto traffico evento)
const generalLimiter = rateLimit({
  windowMs:          15 * 60 * 1000,  // 15 minuti
  max:               2000,             // era 100 — scalato ×20 per evento stasera
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { success: false, error: 'Troppe richieste. Riprova tra qualche minuto.' },
  handler: (req, res, _next, options) => {
    securityLog('RATE_LIMIT', `IP ${req.ip} superato limite generale (${options.max} req/15min)`);
    res.status(429).json(options.message);
  }
});

// Limite donazioni: 100 richieste ogni 5 minuti per IP (alto traffico evento)
const donationLimiter = rateLimit({
  windowMs:          5 * 60 * 1000,  // 5 minuti
  max:               100,             // era 10 — scalato ×10 per evento stasera
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { success: false, error: 'Limite donazioni raggiunto. Riprova tra 5 minuti.' },
  handler: (req, res, _next, options) => {
    securityLog('RATE_LIMIT_DONATION', `IP ${req.ip} superato limite donazioni`);
    res.status(429).json(options.message);
  }
});

// Limite molto stretto per init sistema: 3 richieste ogni 10 minuti
const initLimiter = rateLimit({
  windowMs:          10 * 60 * 1000, // 10 minuti
  max:               3,
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { success: false, error: 'Limite inizializzazione raggiunto.' },
  handler: (req, res, _next, options) => {
    securityLog('RATE_LIMIT_INIT', `IP ${req.ip} tentativo ripetuto init sistema`);
    res.status(429).json(options.message);
  }
});

// ============================================================
// 3. REQUEST TIMEOUT — anti-Slowloris
// ============================================================

const requestTimeout = (timeoutMs = 30000) => (req, res, next) => {
  res.setTimeout(timeoutMs, () => {
    securityLog('TIMEOUT', `Richiesta ${req.method} ${req.path} timeout dopo ${timeoutMs}ms`);
    if (!res.headersSent) {
      res.status(408).json({ success: false, error: 'Request Timeout' });
    }
  });
  next();
};

// ============================================================
// 4. INPUT VALIDATION
// ============================================================

const WALLET_REGEX  = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_REGEX  = /^0x[a-fA-F0-9]{64}$/;
const MAX_NOME_LEN  = 100;
const MAX_STRING_LEN = 200;

/**
 * Valida un indirizzo wallet Ethereum.
 * @throws {Error} se il wallet non è valido
 */
function validateWallet(wallet, fieldName = 'wallet') {
  if (!wallet || typeof wallet !== 'string') {
    throw new Error(`${fieldName} obbligatorio`);
  }
  if (!WALLET_REGEX.test(wallet.trim())) {
    throw new Error(`${fieldName} non è un indirizzo Ethereum valido (0x + 40 hex chars)`);
  }
  return wallet.trim().toLowerCase();
}

/**
 * Valida un hash di transazione.
 * @throws {Error} se il txHash non è valido
 */
function validateTxHash(txHash) {
  if (!txHash || typeof txHash !== 'string') {
    throw new Error('txHash obbligatorio');
  }
  // In sviluppo, permette DEV_SKIP
  if (process.env.NODE_ENV !== 'production' && txHash === 'DEV_SKIP') {
    return txHash;
  }
  if (!TXHASH_REGEX.test(txHash.trim())) {
    throw new Error('txHash non è un hash di transazione valido (0x + 64 hex chars)');
  }
  return txHash.trim().toLowerCase();
}

/**
 * Sanitizza una stringa: rimuove caratteri pericolosi, tronca la lunghezza.
 */
function sanitizeString(value, maxLen = MAX_STRING_LEN) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value
    .slice(0, maxLen)
    .replace(/[<>'"`;]/g, '')  // rimuove caratteri XSS/injection
    .trim();
}

/**
 * Sanitizza un nome utente.
 */
function sanitizeNome(nome) {
  if (!nome) return null;
  return sanitizeString(nome, MAX_NOME_LEN);
}

/**
 * Valida che un parametro numerico sia un intero positivo.
 */
function validatePositiveInt(value, fieldName = 'parametro') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} deve essere un intero non negativo`);
  }
  return n;
}

// ============================================================
// 5. ADMIN API KEY — protezione endpoint privilegiati
// ============================================================

/**
 * Middleware che richiede la chiave API di amministrazione.
 * La chiave deve essere passata nell'header: X-Admin-Key: <valore>
 * oppure come query param: ?admin_key=<valore> (solo in sviluppo)
 */
function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    // Se non configurata in produzione, blocca tout court
    if (process.env.NODE_ENV === 'production') {
      securityLog('ADMIN_NO_KEY_CONFIGURED', `IP ${req.ip} tentativo accesso admin senza ADMIN_API_KEY configurata`);
      return res.status(503).json({ success: false, error: 'Servizio non disponibile' });
    }
    // In sviluppo, avverte ma permette
    console.warn('⚠️  ADMIN_API_KEY non configurata — endpoint admin accessibile (solo sviluppo)');
    return next();
  }

  const providedKey = req.headers['x-admin-key'] ||
    (process.env.NODE_ENV !== 'production' ? req.query.admin_key : null);

  if (!providedKey || providedKey !== adminKey) {
    securityLog('ADMIN_UNAUTHORIZED', `IP ${req.ip} tentativo accesso admin con chiave errata`);
    return res.status(401).json({ success: false, error: 'Non autorizzato' });
  }

  next();
}

// ============================================================
// 6. ENVIRONMENT VARIABLES VALIDATION
// ============================================================

const REQUIRED_PROD_VARS = [
  'DATABASE_URL',
  'URANO_FUND_WALLET',
  'POLYGON_RPC_URL',
  'USDC_CONTRACT_ADDRESS',
  'CORS_ORIGIN',
  'ADMIN_API_KEY',
  'ACCOUNT_0_WALLET',
  'CASSA_ROG_WALLET'
];

const REQUIRED_DEV_VARS = [
  'DATABASE_URL'
];

/**
 * Verifica che tutte le variabili d'ambiente richieste siano presenti.
 * In produzione è più severo.
 * @returns {{ ok: boolean, missing: string[], warnings: string[] }}
 */
function validateEnvironment() {
  const isProd   = process.env.NODE_ENV === 'production';
  const required = isProd ? REQUIRED_PROD_VARS : REQUIRED_DEV_VARS;
  const missing  = required.filter(v => !process.env[v]);
  const warnings = [];

  // Warning per variabili mancanti in sviluppo
  if (!isProd) {
    const devWarn = REQUIRED_PROD_VARS.filter(v => !process.env[v] && !missing.includes(v));
    if (devWarn.length > 0) {
      warnings.push(`Variabili mancanti (richieste in produzione): ${devWarn.join(', ')}`);
    }
  }

  // CORS wildcard in produzione è pericoloso
  if (isProd && process.env.CORS_ORIGIN === '*') {
    warnings.push('CORS_ORIGIN=* in produzione — impostare origini specifiche!');
  }

  // Wallet fondo URANO deve essere un indirizzo valido
  if (process.env.URANO_FUND_WALLET && !WALLET_REGEX.test(process.env.URANO_FUND_WALLET)) {
    warnings.push('URANO_FUND_WALLET non è un indirizzo Ethereum valido');
  }

  return { ok: missing.length === 0, missing, warnings };
}

// ============================================================
// 7. ERROR SANITIZATION — nessun leak interno
// ============================================================

/**
 * Sanitizza un errore per la risposta API.
 * In produzione non espone stack trace né path interni.
 */
function sanitizeError(err, isProd = process.env.NODE_ENV === 'production') {
  const message = err?.message || 'Errore interno';

  if (isProd) {
    // In produzione: espone solo messaggi "user-friendly" predefiniti
    // Non espone path, stack, dettagli DB o codice sorgente
    const safeMessages = [
      'wallet', 'txHash', 'obbligatorio', 'non trovato', 'già registrat',
      'già partecipante', 'limite', 'Non autorizzato', 'timeout',
      'validido', 'valido', 'Importo', 'Transazione', 'Mittente'
    ];
    const isSafe = safeMessages.some(s => message.toLowerCase().includes(s.toLowerCase()));
    return isSafe ? message : 'Si è verificato un errore. Riprovare più tardi.';
  }

  return message;
}

// ============================================================
// 8. SECURITY EVENT LOGGING
// ============================================================

/**
 * Log di eventi di sicurezza con timestamp e IP.
 * Per eventi CRITICAL e rate limit invia anche alert Telegram.
 */
function securityLog(event, detail, ip = null) {
  const ts = new Date().toISOString();
  console.log(`🔐 [SECURITY] ${ts} | ${event}${ip ? ` | IP: ${ip}` : ''} | ${detail}`);

  // Invia alert Telegram per eventi critici (silenzioso se non configurato)
  try {
    const alerts = require('./alert-manager');
    if (event === 'ADMIN_UNAUTHORIZED') {
      alerts.alertAdminUnauthorized(ip || 'sconosciuto');
    } else if (event.includes('RATE_LIMIT')) {
      alerts.alertRateLimit(ip || 'sconosciuto', event);
    } else if (event === 'UNHANDLED_ERROR' || event === 'KILL_SWITCH') {
      alerts.sendAlert('CRITICAL', event, detail);
    }
  } catch (_) { /* alert opzionale, non blocca */ }
}

// ============================================================
// 9. CORS HARDENING MIDDLEWARE
// ============================================================

/**
 * Middleware che avverte se CORS è wildcard in produzione.
 */
function corsHardeningCheck() {
  if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN === '*') {
    console.error('🚨 [SECURITY] ATTENZIONE: CORS_ORIGIN=* in PRODUZIONE è pericoloso!');
    console.error('   Impostare CORS_ORIGIN con le origini specifiche del frontend.');
  }
}

// ============================================================
// 10. INIT SECURITY — Applica tutti i middleware all'app
// ============================================================

/**
 * Inizializza tutti i livelli di sicurezza sull'app Express.
 * Chiamata una sola volta all'avvio del server.
 */
function initSecurity(app) {
  const cors = require('cors');

  // 1. Helmet (HTTP headers)
  app.use(helmetMiddleware);

  // 2. CORS
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

  // 3. Request timeout (anti-Slowloris)
  app.use(requestTimeout());

  // 4. Rate limiting generale
  app.use(generalLimiter);

  // 5. Rate limiting specifico per endpoint sensibili
  app.use('/api/dona', donationLimiter);
  app.use('/api/inizializza', initLimiter);

  // 6. CORS hardening check
  corsHardeningCheck();

  // 7. Validazione variabili d'ambiente
  const env = validateEnvironment();
  if (!env.ok) {
    console.error('❌ [SECURITY] Variabili mancanti:', env.missing.join(', '));
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Variabili d\'ambiente obbligatorie mancanti: ' + env.missing.join(', '));
    }
  }
  env.warnings.forEach(w => console.warn('⚠️  [SECURITY]', w));

  console.log('🔒 Sicurezza URANO inizializzata');
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Init
  initSecurity,

  // Middleware
  helmetMiddleware,
  generalLimiter,
  donationLimiter,
  initLimiter,
  requestTimeout,
  requireAdminKey,

  // Validators
  validateWallet,
  validateTxHash,
  sanitizeString,
  sanitizeNome,
  validatePositiveInt,

  // Utils
  validateEnvironment,
  sanitizeError,
  securityLog,
  corsHardeningCheck,

  // Regexes (esportate per uso esterno)
  WALLET_REGEX,
  TXHASH_REGEX
};
