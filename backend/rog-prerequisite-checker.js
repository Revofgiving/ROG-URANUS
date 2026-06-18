/**
 * 🔐 URANUS — ROG Prerequisite Checker
 *
 * Verifica che un wallet soddisfi i prerequisiti ROG prima di entrare in URANUS:
 *   1. Iscritto alla community ROG
 *   2. Almeno una donazione ROG completata (almeno 1 posizione)
 *
 * Chiama il backend ROG via HTTP. Se ROG non è raggiungibile, BLOCCA per sicurezza
 * (fail-closed: nessun bypass possibile senza verifica positiva).
 *
 * Dipende da: ROG_BACKEND_URL in .env
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const ROG_BACKEND_URL = (process.env.ROG_BACKEND_URL || '').replace(/\/+$/, '');

// Posizione minima ROG per accedere a URANUS (corrispondente all'8 giugno 2026)
const POSIZIONE_MINIMA_ROG = 20488;

// ════════════════════════════════════════════════════════════════════
// HTTP HELPER
// ════════════════════════════════════════════════════════════════════

function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!url) return resolve({ success: false, reason: 'URL vuoto' });

    const client = url.startsWith('https') ? require('https') : require('http');

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ success: false, status: res.statusCode, reason: 'JSON non valido' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, reason: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, reason: 'timeout' }); });
  });
}

// ════════════════════════════════════════════════════════════════════
// CHECK COMMUNITY REGISTRATION
// ════════════════════════════════════════════════════════════════════

async function checkCommunityRegistration(wallet) {
  if (!ROG_BACKEND_URL) {
    console.error('🔐 [ROG-Check] ROG_BACKEND_URL non configurato — blocco accesso');
    return { registered: false, error: 'ROG_BACKEND_URL non configurato' };
  }

  const url = `${ROG_BACKEND_URL}/api/community/status/${wallet}`;
  const result = await httpGet(url);

  if (!result.success) {
    console.warn(`🔐 [ROG-Check] Community status non raggiungibile per ${wallet}: ${result.reason || result.status}`);
    return { registered: false, error: 'Backend ROG non raggiungibile' };
  }

  return {
    registered: !!(result.data && result.data.registered),
    sources: result.data?.sources || null,
  };
}

// ════════════════════════════════════════════════════════════════════
// CHECK ROG DONATION (almeno 1 posizione >= POSIZIONE_MINIMA_ROG)
// ════════════════════════════════════════════════════════════════════

async function checkRogDonation(wallet) {
  if (!ROG_BACKEND_URL) {
    console.error('🔐 [ROG-Check] ROG_BACKEND_URL non configurato — blocco accesso');
    return { hasDonation: false, error: 'ROG_BACKEND_URL non configurato' };
  }

  const url = `${ROG_BACKEND_URL}/api/user-positions/${wallet}`;
  const result = await httpGet(url);

  if (!result.success) {
    console.warn(`🔐 [ROG-Check] User-positions non raggiungibile per ${wallet}: ${result.reason || result.status}`);
    return { hasDonation: false, error: 'Backend ROG non raggiungibile' };
  }

  const data = result.data || {};
  const positions = data.posizioni || data.positions || [];
  const totalPositions = data.totalePosizioniAttive || data.totalPositions || positions.length;

 // CHECK PRINCIPALE: almeno 1 posizione con numero >= POSIZIONE_MINIMA_ROG (8/6/2026)
const hasQualifyingPosition =
  positions.some(p => Number(p.posizione || 0) >= POSIZIONE_MINIMA_ROG);
   

  console.log(`🔐 [ROG-Check] ${wallet}: ${totalPositions} posizioni totali, qualificante (>=${POSIZIONE_MINIMA_ROG}): ${hasQualifyingPosition ? '✅' : '❌'}`);

  return {
    hasDonation: hasQualifyingPosition,
    totalPositions,
    hasQualifyingPosition,
    posizioneMinima: POSIZIONE_MINIMA_ROG,
  };
}

// ════════════════════════════════════════════════════════════════════
// CHECK DONAZIONE RECENTE ON-CHAIN (>= 2 USDC verso ROG cassa dopo 8/6/2026)
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica su Polygon se il wallet ha inviato almeno 2 USDC
 * al wallet cassa ROG (0xD5bCC7...) dopo l'8 giugno 2026.
 * Usa alchemy_getAssetTransfers tramite POLYGON_RPC_URL.
 */
async function checkRecentRogDonationOnChain(wallet) {
  const alchemyUrl = process.env.POLYGON_RPC_URL;
  if (!alchemyUrl) {
    console.warn('🔐 [ROG-OnChain] POLYGON_RPC_URL non configurato — skip check blockchain');
    return { hasRecentDonation: false, error: 'POLYGON_RPC_URL non configurato' };
  }

  try {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      id: 1,
      params: [{
        fromBlock: BLOCK_8_GIUGNO,
        toBlock: 'latest',
        fromAddress: wallet.toLowerCase(),
        toAddress: ROG_CASSA_WALLET,
        contractAddresses: [USDC_CONTRACT],
        category: ['erc20'],
        maxCount: '0x14',
      }],
    });

    const result = await new Promise((resolve) => {
      const url = alchemyUrl;
      const client = url.startsWith('https') ? require('https') : require('http');
      const req = client.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 8000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: false, reason: 'JSON non valido' }); }
        });
      });
      req.on('error', (e) => resolve({ ok: false, reason: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
      req.write(payload);
      req.end();
    });

    if (!result.ok) {
      console.warn(`🔐 [ROG-OnChain] Alchemy non raggiungibile per ${wallet}: ${result.reason}`);
      return { hasRecentDonation: false, error: 'Alchemy non raggiungibile' };
    }

    const transfers = result.data?.result?.transfers || [];
    // Cerca almeno 1 trasferimento >= 2 USDC
    const validDonation = transfers.some(t => (Number(t.value) || 0) >= 2.0);

    console.log(`🔐 [ROG-OnChain] ${wallet}: ${transfers.length} tx dopo 8/6/2026 → donazione valida: ${validDonation ? '✅' : '❌'}`);

    return {
      hasRecentDonation: validDonation,
      txCount: transfers.length,
      latestTx: transfers[0]?.hash || null,
    };
  } catch (e) {
    console.warn(`🔐 [ROG-OnChain] Errore per ${wallet}: ${e.message}`);
    return { hasRecentDonation: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════
// CHECK COMPLETO (entrambi i prerequisiti)
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica tutti i prerequisiti ROG per entrare in URANUS.
 *
 * @param {string} wallet - Wallet da verificare
 * @returns {{ canProceed: boolean, communityRegistered: boolean, rogDonationDone: boolean, errors: string[] }}
 */
async function checkAllPrerequisites(wallet) {
  const w = (wallet || '').toLowerCase().trim();
  if (!w || !/^0x[a-f0-9]{40}$/.test(w)) {
    return { canProceed: false, communityRegistered: false, rogDonationDone: false, errors: ['Wallet non valido'] };
  }

  console.log(`🔐 [ROG-Check] Verifica prerequisiti ROG per ${w}...`);

  // Verifiche in parallelo:
  // 1. Iscrizione community ROG
  // 2. Almeno 1 posizione ROG con numero >= 20488 (dall'8 giugno 2026)
  const [communityResult, donationResult] = await Promise.all([
    checkCommunityRegistration(w),
    checkRogDonation(w),
  ]);

  const errors = [];
  if (!communityResult.registered) {
    errors.push(communityResult.error || 'Non iscritto alla community ROG');
  }
  if (!donationResult.hasDonation) {
    errors.push(donationResult.error || `Nessuna posizione ROG >= ${POSIZIONE_MINIMA_ROG} (donazione dell'8 giugno 2026 o successiva)`);
  }

  const canProceed = communityResult.registered && donationResult.hasDonation;

  console.log(`🔐 [ROG-Check] Community: ${communityResult.registered ? '✅' : '❌'} | Posizione >= ${POSIZIONE_MINIMA_ROG}: ${donationResult.hasDonation ? '✅' : '❌'} | Accesso: ${canProceed ? '✅ OK' : '❌ BLOCCATO'}`);

  return {
    canProceed,
    communityRegistered: communityResult.registered,
    rogDonationDone: donationResult.hasDonation,
    rogPositions: donationResult.totalPositions || 0,
    hasQualifyingPosition: donationResult.hasQualifyingPosition || false,
    posizioneMinima: POSIZIONE_MINIMA_ROG,
    errors,
  };
}

// ════════════════════════════════════════════════════════════════
// PROXY: Registrazione Community su ROG
// ════════════════════════════════════════════════════════════════

function httpPost(url, body, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!url) return resolve({ success: false, reason: 'URL vuoto' });
    const client = url.startsWith('https') ? require('https') : require('http');
    const payload = JSON.stringify(body);
    const parsedUrl = new URL(url);

    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ success: false, status: res.statusCode, reason: 'JSON non valido' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, reason: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, reason: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

/**
 * Registra un wallet nella community ROG (proxy verso ROG backend).
 */
async function registerCommunityOnRog(wallet) {
  if (!ROG_BACKEND_URL) return { success: false, error: 'ROG_BACKEND_URL non configurato' };
  const result = await httpPost(`${ROG_BACKEND_URL}/api/register-community`, {
    walletAddress: wallet.toLowerCase(),
    timestamp: new Date().toISOString(),
  });
  console.log(`🔐 [ROG-Proxy] register-community ${wallet} → ${result.success ? '✅' : '❌'}`);
  return result.success ? (result.data || { success: true }) : { success: false, error: result.reason || 'Errore ROG' };
}

/**
 * Registra una donazione ROG (proxy verso ROG backend).
 */
async function registerDonationOnRog({ donationId, donor, amount, txHash }) {
  if (!ROG_BACKEND_URL) return { success: false, error: 'ROG_BACKEND_URL non configurato' };
  const result = await httpPost(`${ROG_BACKEND_URL}/api/donation/register`, {
    donationId, donor: donor.toLowerCase(), amount: String(amount), txHash,
    donationType: 'standard',
  });
  console.log(`🔐 [ROG-Proxy] donation/register ${donor} ${amount} USDC → ${result.success ? '✅' : '❌'}`);
  return result.success ? (result.data || { success: true }) : { success: false, error: result.reason || 'Errore ROG' };
}

// ════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════

module.exports = {
  checkCommunityRegistration,
  checkRogDonation,
  checkAllPrerequisites,
  registerCommunityOnRog,
  registerDonationOnRog,
  isConfigured: () => !!ROG_BACKEND_URL,
};
