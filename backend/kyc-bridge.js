/**
 * 🪪 URANUS — KYC Bridge
 *
 * Verifica lo stato ZK-KYC degli utenti PRIMA dei payout sopra soglia.
 *
 * ARCHITETTURA:
 *   ROGDao è la SINGOLA FONTE DI VERITÀ per il KYC.
 *   URANUS non ha un proprio validatore — interroga ROG.
 *   L'utente fa la verifica ZK-KYC UNA SOLA VOLTA su ROG
 *   e vale per tutto l'ecosistema (URANUS, PHARAOH, ecc.).
 *
 * SOGLIE PAYOUT URANUS:
 *   - Ingresso: 20 USDC → NESSUN KYC richiesto (sotto soglia 100€)
 *   - L3 Venere: 480 USDC → KYC RICHIESTO
 *   - L5 Saturno: 1.470 USDC → KYC RICHIESTO
 *   - Nettuno: 800 USDC → KYC RICHIESTO
 *
 * FONTI DI VERIFICA (in ordine di priorità):
 *   1. Cache locale in-memory (TTL 5 min, evita chiamate ripetute)
 *   2. ROG backend via HTTP (singola fonte di verità)
 *   3. ROGDao smart contract on-chain (lettura diretta zkKYCVerifiedUsers)
 *   4. Cache DB locale (fallback se ROG non raggiungibile)
 *
 * NESSUN DATO PERSONALE viene salvato — solo wallet + status + timestamp.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const pg = require('./pg-connection-manager');

// ── CONFIGURAZIONE ──────────────────────────────────────────────────

const KYC_THRESHOLD_USDC = 100;  // Soglia KYC: 100 USDC (≈100€)
const CACHE_TTL_MS = 5 * 60 * 1000; // Cache in-memory: 5 minuti
const ROG_BACKEND_URL = process.env.ROG_BACKEND_URL || '';

// ABI minima per leggere zkKYCVerifiedUsers da ROGDao
const ROG_DAO_ABI = [
  'function zkKYCVerifiedUsers(address) external view returns (bool)',
  'function users(address) external view returns (uint256 totalDonated, uint256 totalReceived, uint256 rgxTokensOwned, bool hasZKKYC, uint256 zkKYCTimestamp, uint256 registrationTime, bool isActive, uint256 donationCount)',
];

// ── CACHE IN-MEMORY ─────────────────────────────────────────────────

const kycCache = new Map(); // wallet → { verified: bool, checkedAt: timestamp, source: string }

// Pulizia periodica cache
setInterval(() => {
  const now = Date.now();
  for (const [wallet, entry] of kycCache.entries()) {
    if (now - entry.checkedAt > CACHE_TTL_MS * 6) { // Rimuovi dopo 30 min
      kycCache.delete(wallet);
    }
  }
}, 60 * 1000);

// ════════════════════════════════════════════════════════════════════
// VERIFICA KYC — LOGICA PRINCIPALE
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica se un wallet ha superato il KYC per un payout di importo dato.
 *
 * @param {string} wallet - Wallet del destinatario
 * @param {number} amountUsdc - Importo payout in USDC
 * @returns {{ required: bool, verified: bool, source: string, canProceed: bool }}
 */
async function checkKycForPayout(wallet, amountUsdc) {
  const w = wallet.toLowerCase();

  // Sotto soglia → nessun KYC richiesto
  if (amountUsdc < KYC_THRESHOLD_USDC) {
    return { required: false, verified: false, source: 'threshold', canProceed: true };
  }

  // Wallet di sistema → sempre autorizzati
  const systemWallets = [
    (process.env.URANO_FUND_WALLET || '').toLowerCase(),
    (process.env.CASSA_WALLET || '').toLowerCase(),
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
  ];
  if (systemWallets.includes(w)) {
    return { required: false, verified: true, source: 'system_wallet', canProceed: true };
  }

  // 1. Cache in-memory
  const cached = kycCache.get(w);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return {
      required: true,
      verified: cached.verified,
      source: `cache (${cached.source})`,
      canProceed: cached.verified,
    };
  }

  // 2. ROG backend via HTTP
  const rogResult = await checkKycViaRogBackend(w);
  if (rogResult.success) {
    cacheResult(w, rogResult.verified, 'rog_backend');
    return {
      required: true,
      verified: rogResult.verified,
      source: 'rog_backend',
      canProceed: rogResult.verified,
    };
  }

  // 3. ROGDao on-chain (fallback)
  const onChainResult = await checkKycViaRogOnChain(w);
  if (onChainResult.success) {
    cacheResult(w, onChainResult.verified, 'rog_onchain');
    return {
      required: true,
      verified: onChainResult.verified,
      source: 'rog_onchain',
      canProceed: onChainResult.verified,
    };
  }

  // 4. Cache DB locale (ultimo fallback)
  const dbResult = await checkKycViaLocalDb(w);
  if (dbResult.success) {
    cacheResult(w, dbResult.verified, 'local_db');
    return {
      required: true,
      verified: dbResult.verified,
      source: 'local_db (cache)',
      canProceed: dbResult.verified,
    };
  }

  // Nessuna fonte disponibile — BLOCCA per sicurezza
  console.warn(`🪪 [KYC] Impossibile verificare KYC per ${w} — BLOCCATO per sicurezza`);
  return {
    required: true,
    verified: false,
    source: 'unavailable',
    canProceed: false,
  };
}

// ════════════════════════════════════════════════════════════════════
// FONTE 1: ROG BACKEND via HTTP
// ════════════════════════════════════════════════════════════════════

async function checkKycViaRogBackend(wallet) {
  if (!ROG_BACKEND_URL) return { success: false };

  try {
    const http = require(ROG_BACKEND_URL.startsWith('https') ? 'https' : 'http');

    return new Promise((resolve) => {
      const url = `${ROG_BACKEND_URL}/api/kyc/status/${wallet}`;
      const req = http.get(url, {
        headers: {
          'X-Platform-Origin': 'URANUS',
          'X-Platform-Signature': computeHmac(wallet),
        },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const verified = parsed.status === 'VERIFIED' || parsed.verified === true;

            // Salva in DB locale come cache
            saveKycToLocalDb(wallet, verified, 'rog_backend');

            resolve({ success: true, verified });
          } catch {
            resolve({ success: false });
          }
        });
      });

      req.on('error', () => resolve({ success: false }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    });
  } catch {
    return { success: false };
  }
}

// ════════════════════════════════════════════════════════════════════
// FONTE 2: ROGDao ON-CHAIN (lettura diretta)
// ════════════════════════════════════════════════════════════════════

async function checkKycViaRogOnChain(wallet) {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const rogDaoAddress = process.env.ROG_DAO_ADDRESS;

  if (!rpcUrl || !rogDaoAddress) return { success: false };

  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const rogDao = new ethers.Contract(rogDaoAddress, ROG_DAO_ABI, provider);

    const verified = await rogDao.zkKYCVerifiedUsers(wallet);

    // Salva in DB locale come cache
    saveKycToLocalDb(wallet, verified, 'rog_onchain');

    console.log(`🪪 [KYC] On-chain check ${wallet.substring(0, 10)}: ${verified ? '✅' : '❌'}`);
    return { success: true, verified };
  } catch (err) {
    console.error(`🪪 [KYC] On-chain check ERRORE: ${err.message}`);
    return { success: false };
  }
}

// ════════════════════════════════════════════════════════════════════
// FONTE 3: DB LOCALE (cache di fallback)
// ════════════════════════════════════════════════════════════════════

async function checkKycViaLocalDb(wallet) {
  try {
    const row = await pg.queryOne(
      `SELECT status, verified_at FROM kyc_verifications
       WHERE wallet = $1 AND status = 'VERIFIED'
       ORDER BY verified_at DESC LIMIT 1`,
      [wallet]
    );
    return { success: !!row, verified: !!row };
  } catch {
    return { success: false };
  }
}

async function saveKycToLocalDb(wallet, verified, source) {
  try {
    await pg.query(
      `INSERT INTO kyc_verifications (wallet, status, source, created_at, verified_at)
       VALUES ($1, $2, $3, NOW(), ${verified ? 'NOW()' : 'NULL'})
       ON CONFLICT (wallet) DO UPDATE
         SET status = $2, source = $3, verified_at = ${verified ? 'NOW()' : 'kyc_verifications.verified_at'}`,
      [wallet, verified ? 'VERIFIED' : 'NOT_VERIFIED', source]
    );
  } catch (err) {
    console.error(`🪪 [KYC] saveKycToLocalDb ERRORE: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// CACHE HELPER
// ════════════════════════════════════════════════════════════════════

function cacheResult(wallet, verified, source) {
  kycCache.set(wallet, { verified, checkedAt: Date.now(), source });
}

function computeHmac(data) {
  const secret = process.env.CROSS_PLATFORM_SECRET || '';
  if (!secret) return '';
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ════════════════════════════════════════════════════════════════════
// API PUBLICHE
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica KYC per un payout. Se non verificato, ritorna istruzioni.
 */
async function requireKycForPayout(wallet, amountUsdc) {
  const result = await checkKycForPayout(wallet, amountUsdc);

  if (!result.canProceed) {
    console.warn(`🪪 [KYC] PAYOUT BLOCCATO per ${wallet.substring(0, 10)} (${amountUsdc} USDC) — KYC non verificato (source: ${result.source})`);
  }

  return result;
}

/**
 * Stato KYC per il dashboard
 */
async function getKycStatusForWallet(wallet) {
  const w = wallet.toLowerCase();

  // Check cache
  const cached = kycCache.get(w);

  // Check DB
  let dbStatus = null;
  try {
    dbStatus = await pg.queryOne(
      `SELECT wallet, status, source, verified_at, created_at
       FROM kyc_verifications WHERE wallet = $1
       ORDER BY created_at DESC LIMIT 1`,
      [w]
    );
  } catch {}

  return {
    wallet: w,
    cached: cached ? { verified: cached.verified, source: cached.source, age: Date.now() - cached.checkedAt } : null,
    db: dbStatus || { status: 'NOT_STARTED' },
    threshold: KYC_THRESHOLD_USDC,
    instructions: {
      step1: 'Scarica Polygon ID Wallet (iOS/Android, gratuita)',
      step2: 'Registrati presso un issuer KYC a tua scelta (Synaps, Fractal ID, ecc.)',
      step3: 'Ottieni la KYCAgeCredential (solo documento, nessuna foto)',
      step4: 'Vai su revolutionofgiving.eth e completa la verifica ZK-KYC',
      step5: 'Una volta verificato su ROG, il KYC vale automaticamente su URANUS',
      url: 'https://revolutionofgiving.eth',
    },
  };
}

function getCacheStats() {
  return {
    cacheSize: kycCache.size,
    cacheTtlMs: CACHE_TTL_MS,
    thresholdUsdc: KYC_THRESHOLD_USDC,
    rogBackendConfigured: !!ROG_BACKEND_URL,
    rogDaoConfigured: !!(process.env.ROG_DAO_ADDRESS && process.env.POLYGON_RPC_URL),
  };
}

module.exports = {
  checkKycForPayout,
  requireKycForPayout,
  getKycStatusForWallet,
  getCacheStats,
  KYC_THRESHOLD_USDC,
};
