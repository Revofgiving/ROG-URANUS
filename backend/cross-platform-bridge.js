/**
 * 🌐 URANUS — Cross-Platform Bridge
 *
 * Modulo per le comunicazioni HTTP tra le piattaforme dell'ecosistema:
 *   URANUS → ROG    (registra posizioni ROG_SMALL)
 *   URANUS → PHARAOH (registra ingressi PHARAOH)
 *   ROG/PHARAOH → URANUS (riceve notifiche)
 *
 * SICUREZZA: Autenticazione HMAC-SHA256 con shared secret.
 * Ogni richiesta cross-piattaforma include un header X-Platform-Signature
 * calcolato come HMAC(body, CROSS_PLATFORM_SECRET).
 *
 * PRINCIPIO: Fire-and-forget con retry asincrono.
 *   - Se la chiamata HTTP fallisce, la posizione è già registrata localmente
 *     in flussi_esterni — si riproverà in background.
 */
'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// ── CONFIGURAZIONE ──────────────────────────────────────────────────

const ROG_BACKEND_URL = process.env.ROG_BACKEND_URL || '';         // es. https://rog-backend.example.com
const PHARAOH_BACKEND_URL = process.env.PHARAOH_BACKEND_URL || ''; // es. https://pharaoh-backend.example.com
const CROSS_PLATFORM_SECRET = process.env.CROSS_PLATFORM_SECRET || '';
const PLATFORM_NAME = 'URANUS'; // Identità di questa piattaforma

// ── HMAC SIGNATURE ──────────────────────────────────────────────────

function computeSignature(body) {
  if (!CROSS_PLATFORM_SECRET) return '';
  return crypto
    .createHmac('sha256', CROSS_PLATFORM_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

function verifySignature(body, signature) {
  if (!CROSS_PLATFORM_SECRET) return true; // In dev senza secret, accetta tutto
  const expected = computeSignature(body);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── HTTP CLIENT ─────────────────────────────────────────────────────

async function postToPlatform(baseUrl, endpoint, body) {
  if (!baseUrl) {
    console.log(`   🌐 [CrossPlatform] URL non configurato per ${endpoint} — skip`);
    return { success: false, reason: 'URL non configurato' };
  }

  const url = `${baseUrl}${endpoint}`;
  const payload = JSON.stringify(body);
  const signature = computeSignature(body);

  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Platform-Origin': PLATFORM_NAME,
        'X-Platform-Signature': signature,
        'X-Platform-Timestamp': Date.now().toString(),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`   🌐 [CrossPlatform] ${endpoint} → ${res.statusCode}`);
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
        } catch {
          resolve({ success: false, status: res.statusCode, data });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`   🌐 [CrossPlatform] ${endpoint} ERRORE: ${err.message}`);
      resolve({ success: false, reason: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, reason: 'timeout' });
    });

    req.write(payload);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════════
// URANUS → ROG
// ════════════════════════════════════════════════════════════════════

/**
 * Registra ingressi ROG_SMALL su ROG
 * Chiamato da bridge-manager.js quando avviene una deduzione ROG_SMALL
 *
 * @param {string} wallet - Wallet dell'utente a cui sono dedicati gli ingressi
 * @param {number} numIngressi - Numero di ingressi dual (ogni ingresso = 2 posizioni)
 * @param {number} importoTotale - Importo totale USDC
 * @param {string} origine - Origine del flusso (es. BRIDGE_L3, BRIDGE_L5)
 */
async function registraRogSmall(wallet, numIngressi, importoTotale, origine) {
  return postToPlatform(ROG_BACKEND_URL, '/api/cross/rog-small', {
    platform: PLATFORM_NAME,
    wallet,
    numIngressi,
    importoTotale,
    origine,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Registra un ingresso PHARAOH singolo su ROG (interim: rientri Sole)
 *
 * @param {string} wallet - Wallet dell'utente
 * @param {number} importo - Importo USDC (es. 100)
 * @param {string} origine - Origine (es. PHARAOH_BRIDGE_L3, PHARAOH_BRIDGE_L5)
 */
async function registraPharaohSuRog(wallet, importo, origine) {
  return postToPlatform(ROG_BACKEND_URL, '/api/cross/pharaoh-entry', {
    platform: PLATFORM_NAME,
    wallet,
    importo,
    origine,
    timestamp: new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════════
// URANUS → PHARAOH
// ════════════════════════════════════════════════════════════════════

/**
 * Registra un ingresso nella piattaforma PHARAOH
 * Chiamato quando un bridge event genera posizioni destinate a PHARAOH
 *
 * @param {string} wallet - Wallet dell'utente
 * @param {number} importo - Importo USDC
 * @param {string} origine - Origine del flusso
 */
async function registraIngressoPharaoh(wallet, importo, origine) {
  return postToPlatform(PHARAOH_BACKEND_URL, '/api/cross/ingresso', {
    platform: PLATFORM_NAME,
    wallet,
    importo,
    origine,
    timestamp: new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════════
// MIDDLEWARE EXPRESS per ricevere richieste cross-piattaforma
// ════════════════════════════════════════════════════════════════════

/**
 * Middleware di autenticazione HMAC per endpoint cross-piattaforma.
 * Usa: app.post('/api/cross/...', crossPlatformAuth, handler)
 */
function crossPlatformAuth(req, res, next) {
  const signature = req.headers['x-platform-signature'];
  const origin = req.headers['x-platform-origin'];

  if (!origin) {
    return res.status(400).json({ error: 'X-Platform-Origin mancante' });
  }

  if (CROSS_PLATFORM_SECRET && !verifySignature(req.body, signature)) {
    console.error(`   🌐 [CrossPlatform] Firma HMAC non valida da ${origin}`);
    return res.status(401).json({ error: 'Firma non valida' });
  }

  req.crossPlatformOrigin = origin;
  next();
}

// ════════════════════════════════════════════════════════════════════
// URANUS → QUALSIASI PIATTAFORMA (generico)
// ════════════════════════════════════════════════════════════════════

/**
 * Invia una donazione cross-piattaforma generica.
 * Ogni piattaforma espone POST /api/cross/dona per ricevere ingressi.
 *
 * @param {string} targetPlatform - 'ROG' o 'PHARAOH'
 * @param {string} wallet - Wallet del donatore
 * @param {number} importo - Importo USDC
 * @param {number} numPosizioni - Numero posizioni da creare
 * @param {string} tipo - Tipo ingresso (es. ROG_SMALL, PHARAOH_ENTRY, DONATION)
 * @param {string} origine - Da dove viene (es. BRIDGE_L3, BRIDGE_L5, NETTUNO)
 */
async function inviaDonazioneCross(targetPlatform, wallet, importo, numPosizioni, tipo, origine) {
  const baseUrl = targetPlatform === 'ROG' ? ROG_BACKEND_URL
               : targetPlatform === 'PHARAOH' ? PHARAOH_BACKEND_URL
               : null;

  return postToPlatform(baseUrl, '/api/cross/dona', {
    platform: PLATFORM_NAME,
    targetPlatform,
    wallet,
    importo,
    numPosizioni,
    tipo,
    origine,
    timestamp: new Date().toISOString(),
  });
}

// (RIMOSSO 02/07/2026) richiediKycStatus — lo zk-KYC è gestito solo in ROG: URANUS non lo richiede.

/**
 * Notifica un'altra piattaforma di un evento generico.
 *
 * @param {string} targetPlatform - 'ROG' o 'PHARAOH'
 * @param {string} eventType - Tipo evento
 * @param {Object} data - Dati dell'evento
 */
async function notificaPiattaforma(targetPlatform, eventType, data) {
  const baseUrl = targetPlatform === 'ROG' ? ROG_BACKEND_URL
               : targetPlatform === 'PHARAOH' ? PHARAOH_BACKEND_URL
               : null;

  return postToPlatform(baseUrl, '/api/cross/notifica', {
    platform: PLATFORM_NAME,
    eventType,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════════
// STATO
// ════════════════════════════════════════════════════════════════════

function getStatus() {
  return {
    rogBackendUrl: ROG_BACKEND_URL || '(non configurato)',
    pharaohBackendUrl: PHARAOH_BACKEND_URL || '(non configurato)',
    secretConfigured: !!CROSS_PLATFORM_SECRET,
    platformName: PLATFORM_NAME,
    protocolVersion: '1.0',
    supportedEndpoints: {
      outgoing: ['POST /api/cross/dona', 'POST /api/cross/rog-small', 'POST /api/cross/notifica'],
      incoming: ['POST /api/cross/dona', 'POST /api/cross/rog-small', 'POST /api/cross/ingresso', 'POST /api/cross/notifica'],
    },
  };
}

module.exports = {
  // Outgoing calls (specifici)
  registraRogSmall,
  registraPharaohSuRog,
  registraIngressoPharaoh,
  // Outgoing calls (generici — bidirezionali)
  inviaDonazioneCross,
  notificaPiattaforma,
  // Middleware
  crossPlatformAuth,
  verifySignature,
  // Status
  getStatus,
};
