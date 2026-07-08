/**
 * 🧵 LARGE DISTRIBUTION WORKER
 *
 * Esegue periodicamente:
 * - creazione task (da completamenti molecole LARGE)
 * - esecuzione task interni (posizioni SMALL ciclo 5, pilette)
 * - esecuzione task on-chain (registerDistribution)
 * - avanzamento generazioni LARGE quando ready + distribuito
 */

require('dotenv').config();

const largeDistributionEngine = require('./large-distribution-engine');

function envBool(name, defaultValue) {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (!v) return defaultValue;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

function envInt(name, defaultValue) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : defaultValue;
}

let started = false;
let timer = null;

async function tickOnce() {
  try {
    const res = await largeDistributionEngine.tick({
      maxCompletions: envInt('LARGE_DISTRIBUTION_WORKER_MAX_COMPLETIONS', 500),
      maxTasks: envInt('LARGE_DISTRIBUTION_WORKER_MAX_TASKS', 5),
      executeOnChain: true,
      executeInternal: true,
      advanceIfReady: true
    });

    if (!res?.success) {
      console.warn('⚠️  large-distribution-worker tick failed:', res);
    }
  } catch (e) {
    console.error('❌ large-distribution-worker tick error:', e.message || e);
  }
}

function start() {
  if (started) return;
  started = true;

  const enabled = envBool('LARGE_DISTRIBUTION_WORKER_ENABLED', true);
  if (!enabled) {
    console.log('ℹ️ LARGE distribution worker disabled via env LARGE_DISTRIBUTION_WORKER_ENABLED=false');
    return;
  }

  const intervalMs = envInt('LARGE_DISTRIBUTION_WORKER_INTERVAL_MS', 15000);

  console.log(`🧵 LARGE distribution worker started (intervalMs=${intervalMs})`);

  // Primo tick subito
  tickOnce();

  timer = setInterval(tickOnce, Math.max(2000, intervalMs));
  timer.unref?.();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

module.exports = {
  start,
  stop
};
