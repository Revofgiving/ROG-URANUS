/**
 * 🔐 URANUS — ROG Prerequisite Checker
 *
 * Verifica che un wallet soddisfi i prerequisiti ROG prima di entrare in URANUS:
 *   1. Iscritto alla community ROG
 *   2. Posizione ROG massima >= POSIZIONE_MINIMA_ROG
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
// Fallback legacy: endpoint donation-since (utile durante rollout progressivo su ROG)
const ROG_DONATION_SINCE = process.env.ROG_DONATION_SINCE || '2026-06-08';

// Chiave interna condivisa con ROG per gli endpoint server-to-server protetti
// (/api/community/status, /api/position-threshold). Inviata come header X-Internal-Key.
// DEVE coincidere con ROG_INTERNAL_API_KEY configurata sul backend ROG (Coolify).
const ROG_INTERNAL_API_KEY = process.env.ROG_INTERNAL_API_KEY || '';

function internalHeaders() {
  return ROG_INTERNAL_API_KEY ? { 'X-Internal-Key': ROG_INTERNAL_API_KEY } : {};
}

// ── Parametri verifica ON-CHAIN (legacy/debug; non usati dal gate principale) ──
// Wallet cassa ROG: destinatario delle donazioni ROG Small.
const ROG_CASSA_WALLET = (process.env.CASSA_ROG_WALLET || process.env.ROG_WALLET_CASSA || process.env.ROG_WALLET_ADDRESS || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790').toLowerCase();
// Token USDC delle donazioni ROG recenti alla cassa ROG (usato solo dal check on-chain legacy).
// VERIFICATO on-chain 02/07/2026: la cassa ROG 0xD5bCC7… detiene USDC NATIVO 0x3c49… (0 bridged).
// Il vecchio ROGTreasuryController usava il bridged 0x2791…, ma le operazioni sono migrate al nativo
// (script ROG USDC_OLD→USDC_NEW). Variabile DEDICATA, disaccoppiata da quella di URANUS.
const USDC_CONTRACT = (process.env.ROG_USDC_CONTRACT_ADDRESS || '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359').toLowerCase();
// Blocco Polygon di riferimento (8 giugno 2026). Impostare ROG_BLOCK_8_GIUGNO (hex) per efficienza/precisione;
// default '0x0' = scansione completa (fallback robusto). Richiede un endpoint Alchemy in POLYGON_RPC_URL
// (il metodo alchemy_getAssetTransfers è specifico di Alchemy).
const BLOCK_8_GIUGNO = process.env.ROG_BLOCK_8_GIUGNO || '0x0';

// ════════════════════════════════════════════════════════════════════
// HTTP HELPER
// ════════════════════════════════════════════════════════════════════

function httpGet(url, timeoutMs = 8000, headers = {}) {
  return new Promise((resolve) => {
    if (!url) return resolve({ success: false, reason: 'URL vuoto' });

    const client = url.startsWith('https') ? require('https') : require('http');

    const req = client.get(url, { timeout: timeoutMs, headers }, (res) => {
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
  const result = await httpGet(url, 8000, internalHeaders());

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
// CHECK ROG POSITION THRESHOLD (posizione massima >= POSIZIONE_MINIMA_ROG)
// ════════════════════════════════════════════════════════════════════

async function checkRogDonation(wallet) {
  if (!ROG_BACKEND_URL) {
    console.error('🔐 [ROG-Check] ROG_BACKEND_URL non configurato — blocco accesso');
    return { hasDonation: false, error: 'ROG_BACKEND_URL non configurato' };
  }

  // Endpoint canonico del gate URANUS: verifica posizione massima ROG del wallet.
  // Requisito richiesto: max posizione >= POSIZIONE_MINIMA_ROG.
  const url = `${ROG_BACKEND_URL}/api/position-threshold/${wallet}?minPosition=${encodeURIComponent(String(POSIZIONE_MINIMA_ROG))}`;
  const result = await httpGet(url, 8000, internalHeaders());
  if (result.success) {
    const data = result.data || {};
    const qualifies = !!data.qualifies;
    const totalPositions = Number(data.totalPositions) || 0;
    const qualifyingPositions = Number(data.qualifyingPositions) || 0;
    const maxPosition = Number(data.maxPosition) || 0;

    console.log(`🔐 [ROG-Check] ${wallet}: max posizione ${maxPosition} | soglia ${POSIZIONE_MINIMA_ROG} → ${qualifies ? '✅' : '❌'} (qualificanti=${qualifyingPositions}, totali=${totalPositions})`);

    return {
      hasDonation: qualifies,
      totalPositions: qualifyingPositions,
      maxPosition,
      allPositionsCount: totalPositions,
      hasQualifyingPosition: qualifies,
      posizioneMinima: POSIZIONE_MINIMA_ROG,
    };
  }

  // Compatibilità: se /api/position-threshold non è ancora deployato su ROG,
  // usiamo temporaneamente donation-since per evitare blocchi durante il rollout.
  if (result.status === 404) {
    console.warn(`🔐 [ROG-Check] position-threshold 404 per ${wallet} — fallback donation-since`);
    const legacyUrl = `${ROG_BACKEND_URL}/api/donation-since/${wallet}?since=${encodeURIComponent(ROG_DONATION_SINCE)}&minUsdc=2`;
    const legacy = await httpGet(legacyUrl, 8000, internalHeaders());
    if (legacy.success) {
      const data = legacy.data || {};
      const qualifies = !!data.qualifies;
      const count = Number(data.count) || 0;
      console.log(`🔐 [ROG-Check] fallback donation-since ${wallet}: ${qualifies ? '✅' : '❌'} (count=${count})`);
      return {
        hasDonation: qualifies,
        totalPositions: count,
        hasQualifyingPosition: qualifies,
        posizioneMinima: POSIZIONE_MINIMA_ROG,
      };
    }
  }

  // Fallback robusto finale: conferma on-chain diretta verso cassa ROG.
  const onChain = await checkRecentRogDonationOnChain(wallet);
  if (onChain.hasRecentDonation) {
    return {
      hasDonation: true,
      totalPositions: 1,
      hasQualifyingPosition: true,
      posizioneMinima: POSIZIONE_MINIMA_ROG,
    };
  }

  console.warn(`🔐 [ROG-Check] position-threshold non raggiungibile per ${wallet}: ${result.reason || result.status}`);
  return { hasDonation: false, error: 'Backend ROG non raggiungibile' };
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
// CHECK DONAZIONE PREGRESSA IN URANUS (step 3-4 del FLUSSO URANUS)
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica se il wallet ha GIÀ effettuato almeno una donazione in URANUS.
 * In tal caso è un donatore di ritorno: può accedere direttamente alla
 * donazione senza ripassare i gate ROG (community / posizione / on-chain).
 *
 * Fonte: tabella `donazioni` (donor_wallet) — riga creata ad ogni dono reale.
 */
async function checkUranusDonation(wallet) {
  try {
    const pg = require('./pg-connection-manager');
    const row = await pg.queryOne(
      `SELECT 1 FROM donazioni WHERE LOWER(donor_wallet) = $1 AND status = 'COMPLETATA' LIMIT 1`,
      [wallet]
    );
    return { hasUranusDonation: !!row };
  } catch (e) {
    // Fail-closed: in caso di errore DB NON trattiamo l'utente come donatore di
    // ritorno (proseguirà coi normali gate ROG).
    console.warn(`🔐 [Uranus-Check] Errore verifica donazione pregressa per ${wallet}: ${e.message}`);
    return { hasUranusDonation: false, error: e.message };
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
  // 1. Iscrizione community ROG          (/api/community/status)
  // 2. Posizione massima ROG >= soglia    (/api/position-threshold)
  const [communityResult, donationResult, uranusResult] = await Promise.all([
    checkCommunityRegistration(w),
    checkRogDonation(w),
    checkUranusDonation(w),
  ]);

  // STEP 3-4 del FLUSSO URANUS: se il wallet ha GIÀ donato in URANUS è un donatore
  // di ritorno → accesso diretto alla donazione, SENZA ripassare i gate ROG.
  const hasUranusDonation = uranusResult.hasUranusDonation;

  // Requisito ROG per URANUS: posizione massima >= soglia minima configurata.
  const donationVerified = donationResult.hasDonation;

  const errors = [];
  if (!hasUranusDonation) {
    if (!communityResult.registered) {
      errors.push(communityResult.error || 'Non iscritto alla community ROG');
    }
    if (!donationVerified) {
      errors.push(donationResult.error || `Nessuna posizione ROG >= ${POSIZIONE_MINIMA_ROG} verificata`);
    }
  }

  // canProceed = donatore di ritorno URANUS OPPURE (community ROG + donazione ROG verificata).
  const canProceed = hasUranusDonation || (communityResult.registered && donationVerified);

  console.log(`🔐 [ROG-Check] Uranus pregresso: ${hasUranusDonation ? '✅ bypass' : '—'} | Community: ${communityResult.registered ? '✅' : '❌'} | Posizione >= ${POSIZIONE_MINIMA_ROG}: ${donationResult.hasDonation ? '✅' : '❌'} | Accesso: ${canProceed ? '✅ OK' : '❌ BLOCCATO'}`);

  return {
    canProceed,
    communityRegistered: communityResult.registered,
    rogDonationDone: donationVerified,
    hasUranusDonation,
    rogDonationViaPosition: donationResult.hasDonation,
    rogDonationViaOnChain: false,
    onChainTx: null,
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
  checkRecentRogDonationOnChain,
  checkUranusDonation,
  checkAllPrerequisites,
  registerCommunityOnRog,
  registerDonationOnRog,
  isConfigured: () => !!ROG_BACKEND_URL,
};
