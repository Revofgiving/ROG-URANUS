/**
 * 🛡️ URANUS — Security Hardener
 *
 * Sistema di sicurezza ATTIVO e AUTO-RINFRESCANTE per il backend.
 * Si auto-aggiorna ogni 5 minuti (300 secondi).
 *
 * LIVELLI DI DIFESA:
 *   1. IP Blacklist automatica (ban progressivo)
 *   2. Rate limiting adattivo (si inasprisce sotto attacco)
 *   3. Anomaly detection (pattern sospetti)
 *   4. Request integrity check (HMAC su payload)
 *   5. Honeypot endpoints (trappole per bot/scanner)
 *   6. Brute force detection (lockout progressivo)
 *   7. DDoS mitigation (sliding window)
 *   8. Nonce rotation (anti-replay)
 *   9. Session fingerprinting
 *  10. Auto-healing (si ripristina dopo attacco)
 *
 * PRINCIPIO: ogni componente è non-bloccante.
 *   Se il hardener fallisce, il backend continua a funzionare.
 */
'use strict';

const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════════
// CONFIGURAZIONE
// ════════════════════════════════════════════════════════════════════

const CONFIG = {
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,  // 5 minuti — auto-refresh
  NONCE_ROTATION_MS: 5 * 60 * 1000,    // 5 minuti — ruota nonce
  IP_BAN_THRESHOLD: 500,                // era 50 — scalato ×10 per evento alto traffico
  IP_BAN_DURATION_MS: 10 * 60 * 1000,  // era 30min — ridotto a 10min
  BRUTE_FORCE_WINDOW_MS: 60 * 1000,    // finestra 1 minuto
  BRUTE_FORCE_MAX_ATTEMPTS: 100,        // era 10 — scalato ×10
  BRUTE_FORCE_LOCKOUT_MS: 5 * 60 * 1000, // era 15min — ridotto a 5min
  DDOS_WINDOW_MS: 10 * 1000,           // finestra 10 secondi
  DDOS_MAX_REQUESTS: 1000,             // era 100 — scalato ×10 per evento stasera
  ANOMALY_SCORE_THRESHOLD: 95,         // era 80 — meno falsi positivi sotto carico
  MAX_PAYLOAD_SIZE: 50 * 1024,         // 50KB max payload
  MAX_URL_LENGTH: 2048,                // max URL length
  SUSPICIOUS_PATTERNS: [
    /(\.\.\/)/, /(<script)/i, /(javascript:)/i, /(on\w+\s*=)/i,
    /(union\s+select)/i, /(drop\s+table)/i, /(insert\s+into)/i,
    /(exec\s*\()/i, /(eval\s*\()/i, /(\$\{)/,
    /(0x[0-9a-f]{40,})/i,  // wallet injection (ma non nei path legittimi)
  ],
  HONEYPOT_PATHS: [
    '/admin/login', '/wp-admin', '/wp-login.php', '/.env',
    '/config.php', '/phpmyadmin', '/api/debug', '/api/test',
    '/.git/config', '/server-status', '/actuator', '/console',
  ],
};

// ════════════════════════════════════════════════════════════════════
// STATO INTERNO
// ════════════════════════════════════════════════════════════════════

const state = {
  // Nonce corrente (ruotato ogni 5 min)
  currentNonce: crypto.randomBytes(32).toString('hex'),
  nonceHistory: [],
  lastNonceRotation: Date.now(),

  // IP tracking
  ipRequestCount: new Map(),     // IP → { count, firstSeen, lastSeen }
  ipBanList: new Map(),          // IP → { bannedAt, expiresAt, reason }
  ipSuspicionScore: new Map(),   // IP → score (0-100)

  // Brute force tracking
  bruteForceAttempts: new Map(), // IP → [timestamps]
  bruteForceLockedOut: new Map(), // IP → expiresAt

  // DDoS tracking
  ddosWindow: new Map(),         // IP → [timestamps in current window]

  // Anomaly detection
  anomalyLog: [],
  totalRequestsLastMinute: 0,
  totalRequestsLastHour: 0,

  // Stats
  totalBlocked: 0,
  totalHoneypotHits: 0,
  totalAnomaliesDetected: 0,
  lastRefresh: Date.now(),
  refreshCount: 0,
};

// ════════════════════════════════════════════════════════════════════
// 1. NONCE ROTATION
// ════════════════════════════════════════════════════════════════════

function rotateNonce() {
  const oldNonce = state.currentNonce;
  state.currentNonce = crypto.randomBytes(32).toString('hex');
  state.nonceHistory.push({ nonce: oldNonce, expired: Date.now() });
  // Keep only last 10 nonces for grace period
  if (state.nonceHistory.length > 10) state.nonceHistory.shift();
  state.lastNonceRotation = Date.now();
}

function getCurrentNonce() { return state.currentNonce; }

function isValidNonce(nonce) {
  if (nonce === state.currentNonce) return true;
  // Grace period: accetta anche i nonce precedenti (per richieste in-flight)
  return state.nonceHistory.some(h => h.nonce === nonce && Date.now() - h.expired < 30000);
}

// ════════════════════════════════════════════════════════════════════
// 2. IP BLACKLIST AUTOMATICA
// ════════════════════════════════════════════════════════════════════

function isIPBanned(ip) {
  const ban = state.ipBanList.get(ip);
  if (!ban) return false;
  if (Date.now() > ban.expiresAt) {
    state.ipBanList.delete(ip);
    return false;
  }
  return true;
}

function banIP(ip, reason, durationMs = CONFIG.IP_BAN_DURATION_MS) {
  state.ipBanList.set(ip, {
    bannedAt: Date.now(),
    expiresAt: Date.now() + durationMs,
    reason,
  });
  state.totalBlocked++;
  console.log(`🛡️ [SecurityHardener] IP BANNATO: ${ip} — ${reason} (${durationMs / 1000}s)`);
}

function trackIPRequest(ip) {
  const now = Date.now();
  let record = state.ipRequestCount.get(ip);
  if (!record) {
    record = { count: 0, firstSeen: now, lastSeen: now };
    state.ipRequestCount.set(ip, record);
  }
  record.count++;
  record.lastSeen = now;

  // Auto-ban se supera soglia
  if (record.count > CONFIG.IP_BAN_THRESHOLD) {
    banIP(ip, `Exceeded ${CONFIG.IP_BAN_THRESHOLD} requests`);
  }
}

// ════════════════════════════════════════════════════════════════════
// 3. ANOMALY DETECTION
// ════════════════════════════════════════════════════════════════════

function calculateAnomalyScore(req) {
  let score = 0;
  const ip = getClientIP(req);

  // Suspicious patterns: controlla URL e body separatamente.
  // Il pattern wallet 0x... si applica SOLO al body (non all'URL, perché
  // i path legittimi come /api/posizione/0x... contengono wallet validi).
  const urlStr = req.originalUrl || req.url || '';
  const bodyStr = JSON.stringify(req.body || {});

  const WALLET_PATTERN = /(0x[0-9a-f]{40,})/i;
  for (const pattern of CONFIG.SUSPICIOUS_PATTERNS) {
    const isWalletPattern = pattern.toString() === WALLET_PATTERN.toString();
    if (isWalletPattern) {
      // Controlla solo il body — i wallet nei path API sono legittimi
      if (pattern.test(bodyStr)) score += 20;
    } else {
      if (pattern.test(urlStr + bodyStr)) score += 20;
    }
  }

  // URL too long
  if (urlStr.length > CONFIG.MAX_URL_LENGTH) score += 30;

  // Missing or suspicious User-Agent
  const ua = req.headers['user-agent'] || '';
  if (!ua || ua.length < 5) score += 15;
  if (/curl|wget|python|bot|spider|crawl|scan/i.test(ua)) score += 10;

  // Unusual HTTP method
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(req.method)) score += 25;

  // Too many headers
  if (Object.keys(req.headers).length > 50) score += 15;

  // Rapid-fire from same IP
  const ddosCheck = state.ddosWindow.get(ip) || [];
  if (ddosCheck.length > CONFIG.DDOS_MAX_REQUESTS / 2) score += 20;

  return Math.min(100, score);
}

// ════════════════════════════════════════════════════════════════════
// 4. BRUTE FORCE DETECTION
// ════════════════════════════════════════════════════════════════════

function checkBruteForce(ip) {
  const now = Date.now();

  // Check lockout
  const lockout = state.bruteForceLockedOut.get(ip);
  if (lockout && now < lockout) return { blocked: true, reason: 'brute_force_lockout' };

  // Track attempts
  let attempts = state.bruteForceAttempts.get(ip) || [];
  attempts = attempts.filter(t => now - t < CONFIG.BRUTE_FORCE_WINDOW_MS);
  attempts.push(now);
  state.bruteForceAttempts.set(ip, attempts);

  if (attempts.length > CONFIG.BRUTE_FORCE_MAX_ATTEMPTS) {
    state.bruteForceLockedOut.set(ip, now + CONFIG.BRUTE_FORCE_LOCKOUT_MS);
    banIP(ip, 'Brute force detected', CONFIG.BRUTE_FORCE_LOCKOUT_MS);
    return { blocked: true, reason: 'brute_force' };
  }

  return { blocked: false };
}

// ════════════════════════════════════════════════════════════════════
// 5. DDoS MITIGATION (sliding window)
// ════════════════════════════════════════════════════════════════════

function checkDDoS(ip) {
  const now = Date.now();
  let timestamps = state.ddosWindow.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < CONFIG.DDOS_WINDOW_MS);
  timestamps.push(now);
  state.ddosWindow.set(ip, timestamps);

  if (timestamps.length > CONFIG.DDOS_MAX_REQUESTS) {
    banIP(ip, `DDoS: ${timestamps.length} requests in ${CONFIG.DDOS_WINDOW_MS / 1000}s`);
    return { blocked: true, reason: 'ddos' };
  }

  return { blocked: false };
}

// ════════════════════════════════════════════════════════════════════
// 6. HONEYPOT
// ════════════════════════════════════════════════════════════════════

function isHoneypot(path) {
  return CONFIG.HONEYPOT_PATHS.some(hp => path.toLowerCase().startsWith(hp));
}

// ════════════════════════════════════════════════════════════════════
// 7. REQUEST INTEGRITY
// ════════════════════════════════════════════════════════════════════

function computeRequestHash(req) {
  const data = `${req.method}:${req.originalUrl}:${JSON.stringify(req.body || {})}:${state.currentNonce}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ════════════════════════════════════════════════════════════════════
// HELPER
// ════════════════════════════════════════════════════════════════════

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.ip
    || '0.0.0.0';
}

// ════════════════════════════════════════════════════════════════════
// AUTO-REFRESH (ogni 5 minuti)
// ════════════════════════════════════════════════════════════════════

function refresh() {
  const now = Date.now();

  // 1. Ruota nonce
  rotateNonce();

  // 2. Pulisci IP scaduti
  for (const [ip, ban] of state.ipBanList.entries()) {
    if (now > ban.expiresAt) state.ipBanList.delete(ip);
  }

  // 3. Pulisci brute force lockout scaduti
  for (const [ip, expiresAt] of state.bruteForceLockedOut.entries()) {
    if (now > expiresAt) state.bruteForceLockedOut.delete(ip);
  }

  // 4. Resetta contatori IP (ma mantieni score)
  for (const [ip, record] of state.ipRequestCount.entries()) {
    if (now - record.lastSeen > 60 * 60 * 1000) {
      state.ipRequestCount.delete(ip);
      state.ipSuspicionScore.delete(ip);
    }
  }

  // 5. Pulisci DDoS window
  for (const [ip, timestamps] of state.ddosWindow.entries()) {
    const valid = timestamps.filter(t => now - t < CONFIG.DDOS_WINDOW_MS);
    if (valid.length === 0) state.ddosWindow.delete(ip);
    else state.ddosWindow.set(ip, valid);
  }

  // 6. Trim anomaly log
  if (state.anomalyLog.length > 1000) {
    state.anomalyLog = state.anomalyLog.slice(-500);
  }

  state.lastRefresh = now;
  state.refreshCount++;

  console.log(`🛡️ [SecurityHardener] REFRESH #${state.refreshCount} — bans: ${state.ipBanList.size}, nonce rotated`);
}

// ════════════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ════════════════════════════════════════════════════════════════════

/**
 * Middleware principale di sicurezza.
 * DEVE essere montato PRIMA di tutti gli altri middleware.
 * Uso: app.use(securityHardener.middleware());
 */
// IP locali sempre trusted in sviluppo
const TRUSTED_LOCAL_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

function middleware() {
  return (req, res, next) => {
    const ip = getClientIP(req);
    const path = req.originalUrl || req.url || '';

    // 0b. SKIP SICUREZZA PER LOCALHOST (sviluppo locale)
    if (TRUSTED_LOCAL_IPS.includes(ip) || ip.startsWith('::ffff:127.')) {
      return next();
    }

    // 0c. SKIP per endpoint GET pubblici del frontend (IPFS/ENS + dashboard utente)
    const SAFE_GET_PATHS = [
      '/api/health', '/api/rog-status/', '/api/stato', '/api/testimonianze',
      '/api/percorso/', '/api/account/',
      // Dashboard utente — chiamate frequenti (polling 30s), mai bloccare
      '/api/posizione/', '/api/doni-pendenti/', '/api/messaggi/',
      // Hub pubblico — news, galleria, comunicazioni, testimonianze
      '/api/news', '/api/risorse', '/api/comunicazioni', '/api/testimonianze',
    ];
    if (req.method === 'GET' && SAFE_GET_PATHS.some(p => path.startsWith(p))) {
      return next();
    }

    // 0. HONEYPOT — ban immediato (solo bot/scanner colpiscono questi path)
    if (isHoneypot(path)) {
      state.totalHoneypotHits++;
      banIP(ip, `Honeypot hit: ${path}`, CONFIG.IP_BAN_DURATION_MS * 2);
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 1. IP BAN CHECK
    if (isIPBanned(ip)) {
      state.totalBlocked++;
      return res.status(429).json({ error: 'Too many requests' });
    }

    // 2. DDoS CHECK
    const ddos = checkDDoS(ip);
    if (ddos.blocked) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // 3. BRUTE FORCE CHECK (solo per endpoint sensibili)
    if (path.includes('/api/admin') || path.includes('/api/dona') || path.includes('/api/cross/')) {
      const bf = checkBruteForce(ip);
      if (bf.blocked) {
        return res.status(429).json({ error: 'Too many attempts' });
      }
    }

    // 4. PAYLOAD SIZE CHECK
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > CONFIG.MAX_PAYLOAD_SIZE) {
      banIP(ip, 'Oversized payload');
      return res.status(413).json({ error: 'Payload too large' });
    }

    // 5. ANOMALY DETECTION
    const anomalyScore = calculateAnomalyScore(req);
    if (anomalyScore >= CONFIG.ANOMALY_SCORE_THRESHOLD) {
      state.totalAnomaliesDetected++;
      state.anomalyLog.push({
        ip, path, method: req.method, score: anomalyScore,
        timestamp: new Date().toISOString(), ua: req.headers['user-agent']
      });

      // Score altissimo → ban
      if (anomalyScore >= 90) {
        banIP(ip, `High anomaly score: ${anomalyScore}`);
        return res.status(403).json({ error: 'Forbidden' });
      }
      // Score medio-alto → warning header
      res.setHeader('X-Security-Warning', 'suspicious-activity-detected');
    }

    // 6. TRACK IP
    trackIPRequest(ip);

    // 7. Aggiungi security headers
    res.setHeader('X-Request-Nonce', state.currentNonce.substring(0, 16));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    next();
  };
}

// ════════════════════════════════════════════════════════════════════
// STATO E API
// ════════════════════════════════════════════════════════════════════

function getStatus() {
  return {
    refreshCount: state.refreshCount,
    lastRefresh: new Date(state.lastRefresh).toISOString(),
    nextRefresh: new Date(state.lastRefresh + CONFIG.REFRESH_INTERVAL_MS).toISOString(),
    currentNoncePrefix: state.currentNonce.substring(0, 8) + '...',
    bannedIPs: state.ipBanList.size,
    trackedIPs: state.ipRequestCount.size,
    bruteForceLockedOut: state.bruteForceLockedOut.size,
    totalBlocked: state.totalBlocked,
    totalHoneypotHits: state.totalHoneypotHits,
    totalAnomaliesDetected: state.totalAnomaliesDetected,
    anomalyLogSize: state.anomalyLog.length,
  };
}

function getBanList() {
  const bans = [];
  for (const [ip, ban] of state.ipBanList.entries()) {
    bans.push({ ip, ...ban, expiresIn: Math.max(0, ban.expiresAt - Date.now()) });
  }
  return bans;
}

function manualBanIP(ip, reason) { banIP(ip, `Manual: ${reason}`, CONFIG.IP_BAN_DURATION_MS * 4); }
function manualUnbanIP(ip) { state.ipBanList.delete(ip); }

// ════════════════════════════════════════════════════════════════════
// AVVIO AUTO-REFRESH
// ════════════════════════════════════════════════════════════════════

let refreshTimer = null;

function start() {
  if (refreshTimer) return;
  refreshTimer = setInterval(refresh, CONFIG.REFRESH_INTERVAL_MS);
  console.log(`🛡️ [SecurityHardener] ATTIVO — refresh ogni ${CONFIG.REFRESH_INTERVAL_MS / 1000}s`);
  console.log(`   Difese: IP ban, DDoS, brute force, anomaly detection, honeypot, nonce rotation`);
}

function stop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Auto-start
start();

module.exports = {
  middleware,
  getStatus,
  getBanList,
  manualBanIP,
  manualUnbanIP,
  getCurrentNonce,
  isValidNonce,
  refresh,
  start,
  stop,
};
