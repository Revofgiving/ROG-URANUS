'use strict';
/**
 * 🛡️ URANUS — Security Auditor (audit di sicurezza automatico ogni 24h)
 *
 * Job SOLO-LETTURA che periodicamente:
 *   - verifica la configurazione di sicurezza (env, CORS, chiavi, indirizzo tesoreria)
 *   - controlla i saldi della tesoreria (POL per il gas, USDC)
 *   - controlla lo stato on-chain del registry (paused / circuit breaker / emergency / BACKEND_ROLE)
 *   - esegue `npm audit` (solo REPORT: NESSUN aggiornamento automatico delle dipendenze)
 *   - rinfresca le difese runtime (security-hardener.refresh)
 * e invia un DIGEST su Telegram (a Isa) + log locale.
 *
 * NON modifica codice, dipendenze, DB o contratto. Best-effort: non blocca né crasha mai il server.
 */

const alerts = require('./alert-manager');

const AUDIT_INTERVAL_MS  = Number(process.env.SECURITY_AUDIT_INTERVAL_MS) || 24 * 60 * 60 * 1000; // 24h
const FIRST_RUN_DELAY_MS = Number(process.env.SECURITY_AUDIT_FIRST_DELAY_MS) || 30 * 1000;        // 30s dopo il boot
const MIN_POL            = Number(process.env.SECURITY_MIN_POL || 1);                             // soglia gas (POL)
const TREASURY_EXPECTED  = (process.env.URANUS_CASSA_WALLET || '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce').toLowerCase();

const ERC20_MIN_ABI = ['function balanceOf(address) view returns (uint256)'];
const REGISTRY_ABI  = [
  'function paused() view returns (bool)',
  'function circuitBreakerTriggered() view returns (bool)',
  'function emergencyMode() view returns (bool)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function BACKEND_ROLE() view returns (bytes32)',
];

let timer = null;

// 1) Configurazione / segreti
function _checkConfig() {
  const out = [];
  if (process.env.NODE_ENV !== 'production') out.push('NODE_ENV != production');
  const cors = process.env.CORS_ORIGIN || '';
  if (!cors || cors.includes('*')) out.push('CORS_ORIGIN assente o con "*"');
  if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 16) out.push('ADMIN_API_KEY assente o troppo corta (<16)');
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) out.push('ADMIN_PASSWORD assente o debole (<10)');
  if (!process.env.POLYGON_RPC_URL) out.push('POLYGON_RPC_URL assente');
  if (!process.env.TREASURY_PRIVATE_KEY) out.push('TREASURY_PRIVATE_KEY assente (payout disabilitati)');
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) out.push('Telegram non configurato (alert disattivati)');
  return out;
}

// 2) Saldi tesoreria (POL per gas + USDC)
async function _checkTreasury() {
  const res = { warnings: [], info: [] };
  const privKey = process.env.TREASURY_PRIVATE_KEY;
  const rpcUrl  = process.env.POLYGON_RPC_URL;
  if (!privKey || !rpcUrl) { res.warnings.push('non verificabile (chiave/RPC mancanti)'); return res; }
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer   = new ethers.Wallet(privKey, provider);
    const addr     = signer.address.toLowerCase();
    if (addr !== TREASURY_EXPECTED) res.warnings.push(`indirizzo inatteso ${addr} (atteso ${TREASURY_EXPECTED})`);
    const polWei = await provider.getBalance(signer.address);
    const pol    = Number(ethers.utils.formatEther(polWei));
    res.info.push(`POL (gas): ${pol.toFixed(3)}`);
    if (pol < MIN_POL) res.warnings.push(`POL basso ${pol.toFixed(3)} < ${MIN_POL} (ricaricare per il gas)`);
    try {
      const usdcAddr = process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
      const usdc     = new ethers.Contract(usdcAddr, ERC20_MIN_ABI, provider);
      const bal      = await usdc.balanceOf(signer.address);
      res.info.push(`USDC cassa: ${Number(ethers.utils.formatUnits(bal, 6)).toLocaleString()}`);
    } catch (_) {}
  } catch (e) {
    res.warnings.push(`verifica fallita: ${e.message}`);
  }
  return res;
}

// 3) Stato on-chain del registry (audit) — opzionale
async function _checkRegistry() {
  const res = { warnings: [], info: [] };
  const addr   = process.env.URANUS_REGISTRY_ADDRESS;
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!addr || !rpcUrl) return res; // registry non configurato → skip
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const reg = new ethers.Contract(addr, REGISTRY_ABI, provider);
    const [paused, cb, emerg] = await Promise.all([
      reg.paused().catch(() => null),
      reg.circuitBreakerTriggered().catch(() => null),
      reg.emergencyMode().catch(() => null),
    ]);
    if (paused === true) res.warnings.push('registry IN PAUSA');
    if (cb === true)     res.warnings.push('circuit breaker ATTIVO');
    if (emerg === true)  res.warnings.push('emergency mode ATTIVO');
    try {
      const backendKey = process.env.URANUS_BACKEND_PRIVATE_KEY;
      if (backendKey) {
        const backendAddr = new ethers.Wallet(backendKey).address;
        const role = await reg.BACKEND_ROLE();
        const has  = await reg.hasRole(role, backendAddr);
        if (!has) res.warnings.push(`backend ${backendAddr.slice(0, 8)}... NON ha BACKEND_ROLE`);
        else res.info.push('BACKEND_ROLE: ok');
      }
    } catch (_) {}
    if (!res.warnings.length) res.info.push('registry: nessuna anomalia');
  } catch (e) {
    res.warnings.push(`verifica fallita: ${e.message}`);
  }
  return res;
}

// 4) Vulnerabilità dipendenze (solo REPORT, nessun aggiornamento)
function _checkDependencies() {
  return new Promise((resolve) => {
    const res = { warnings: [], info: [] };
    try {
      const { execFile } = require('child_process');
      execFile('npm', ['audit', '--omit=dev', '--json'], { cwd: __dirname, timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (_err, stdout) => {
        try {
          const data = JSON.parse(stdout || '{}');
          const v = (data.metadata && data.metadata.vulnerabilities) || {};
          const crit = v.critical || 0, high = v.high || 0, mod = v.moderate || 0, low = v.low || 0;
          if (crit || high) res.warnings.push(`${crit} critiche, ${high} alte (valutare aggiornamento manuale)`);
          res.info.push(`vulnerabilità dip.: crit ${crit}, high ${high}, mod ${mod}, low ${low}`);
        } catch (_) {
          res.info.push('npm audit non interpretabile (saltato)');
        }
        resolve(res);
      });
    } catch (_) {
      res.info.push('npm audit non disponibile (saltato)');
      resolve(res);
    }
  });
}

// Esegue l'audit completo e invia il digest.
async function runAudit() {
  const warnings = [];
  const info = [];
  try {
    _checkConfig().forEach(x => warnings.push(`CONFIG: ${x}`));

    const tre = await _checkTreasury();
    tre.warnings.forEach(x => warnings.push(`TESORERIA: ${x}`));
    info.push(...tre.info);

    const reg = await _checkRegistry();
    reg.warnings.forEach(x => warnings.push(`REGISTRY: ${x}`));
    info.push(...reg.info);

    const dep = await _checkDependencies();
    dep.warnings.forEach(x => warnings.push(`DIPENDENZE: ${x}`));
    info.push(...dep.info);

    try { require('./security-hardener').refresh(); } catch (_) {}
    try {
      const st = require('./security-hardener').getStatus();
      info.push(`difese: ban ${st.bannedIPs}, bloccati ${st.totalBlocked}, honeypot ${st.totalHoneypotHits}`);
    } catch (_) {}
  } catch (e) {
    warnings.push(`AUDIT: errore interno ${e.message}`);
  }

  const ts = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const header = warnings.length
    ? `🛡️ <b>AUDIT SICUREZZA — ${warnings.length} avvisi</b>`
    : `🛡️ <b>AUDIT SICUREZZA — tutto ok</b>`;
  const parts = [header];
  if (warnings.length) parts.push('\n⚠️ <b>Da controllare:</b>\n• ' + warnings.join('\n• '));
  if (info.length)     parts.push('\nℹ️ <b>Stato:</b>\n• ' + info.join('\n• '));
  parts.push(`\n🕐 ${ts}`);
  const body = parts.join('\n');

  console.log(`🛡️ [SecurityAuditor] Audit completato — ${warnings.length} avvisi, ${info.length} info`);
  try { await alerts.sendTelegramAlert(body); } catch (_) {}
  return { warnings, info };
}

function start() {
  if (timer) return;
  setTimeout(() => { runAudit().catch(() => {}); }, FIRST_RUN_DELAY_MS);
  timer = setInterval(() => { runAudit().catch(() => {}); }, AUDIT_INTERVAL_MS);
  console.log(`🛡️ [SecurityAuditor] Attivo — audit ogni ${Math.round(AUDIT_INTERVAL_MS / 3600000)}h (primo tra ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s)`);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, runAudit };
