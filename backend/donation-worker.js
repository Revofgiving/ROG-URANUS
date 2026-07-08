/**
 * 🧵 DONATION WORKER
 * 
 * Worker in background che processa la coda donazioni.
 * 
 * CARATTERISTICHE:
 * - Processa donazioni asincrone dalla coda PostgreSQL
 * - Throughput: 600+ donazioni/min (10/sec)
 * - Retry automatico per errori transienti
 * - Graceful shutdown (completa donazioni in corso)
 * - Health monitoring con metriche
 * 
 * CONFIGURAZIONE:
 * - DONATION_WORKER_ENABLED: abilita/disabilita worker (default: true)
 * - DONATION_WORKER_INTERVAL_MS: intervallo polling coda (default: 1000ms = 1 sec)
 * - DONATION_WORKER_CONCURRENCY: donazioni processate in parallelo (default: 10)
 * - DONATION_WORKER_BATCH_SIZE: donazioni estratte per batch (default: 10)
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 24 Gennaio 2026
 */

require('dotenv').config();

const donationQueueManager = require('./donation-queue-manager');
const donationFlowManager = require('./donation-flow-manager');
const { randomUUID } = require('crypto');

// ========================================
// CONFIGURAZIONE
// ========================================

function envBool(name, defaultValue) {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (!v) return defaultValue;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

function envInt(name, defaultValue) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

const CONFIG = {
  enabled: envBool('DONATION_WORKER_ENABLED', true),
  intervalMs: envInt('DONATION_WORKER_INTERVAL_MS', 1000), // 1 secondo = 60 batch/min
  concurrency: envInt('DONATION_WORKER_CONCURRENCY', 10),  // 10 donazioni parallele
  batchSize: envInt('DONATION_WORKER_BATCH_SIZE', 10),     // 10 donazioni per batch
  statsIntervalMs: envInt('DONATION_WORKER_STATS_INTERVAL_MS', 60000) // Stats ogni 60 sec
};

// Worker ID univoco (per tracking multi-instance)
const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;

// ========================================
// STATE
// ========================================

let started = false;
let timer = null;
let statsTimer = null;
let processing = false;
let activeJobs = new Set(); // Tracking donazioni in processamento

// Metriche
const metrics = {
  totalProcessed: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  totalRetried: 0,
  startedAt: null,
  lastProcessedAt: null
};

// ========================================
// WORKER LOGIC
// ========================================

/**
 * Processa singola donazione dalla coda
 * 
 * @param {Object} donation - Donazione da coda
 * @returns {Promise<boolean>} true se successo, false se fallita
 */
async function processDonation(donation) {
  const { queueId, donationId, txHash, donor, amountUSDC, donationType } = donation;
  
  const jobId = `${queueId}-${Date.now()}`;
  activeJobs.add(jobId);

  try {
    console.log(`\n🔄 Processing donation: queueId=${queueId} txHash=${txHash.slice(0, 10)}...`);

    // Chiama donation-flow-manager (stesso flusso di /api/donation/verify)
    const result = await donationFlowManager.processDonation({
      donationId,
      donor,
      amountUSDC,
      txHash,
      timestamp: donation.createdAt,
      donationType: donationType || 'standard',
      // Dati opzionali dal pending store
      beneficiaryWallet: donation.beneficiaryWallet,
      beneficiaryName: donation.beneficiaryName,
      giftMessage: donation.giftMessage
    });

    if (!result.success) {
      // Errore di business logic (es. wallet non registrato)
      console.error(`❌ Donation failed (business logic): ${result.error || result.message}`);
      
      // Marca come fallita (con retry se errore transiente)
      await donationQueueManager.fail(queueId, result.error || result.message);
      
      metrics.totalFailed++;
      if (donation.attempts > 1) metrics.totalRetried++;
      
      return false;
    }

    // Successo! Marca come completata
    await donationQueueManager.complete(queueId, result);
    
    metrics.totalSucceeded++;
    metrics.lastProcessedAt = new Date();
    
    console.log(`✅ Donation completed: queueId=${queueId} positions=${result.positions?.length || 0}`);
    
    return true;

  } catch (error) {
    // Errore tecnico (es. DB timeout, blockchain RPC failure)
    console.error(`❌ Donation processing error: ${error.message}`, error);
    
    // Marca come fallita (con retry)
    await donationQueueManager.fail(queueId, error);
    
    metrics.totalFailed++;
    if (donation.attempts > 1) metrics.totalRetried++;
    
    return false;

  } finally {
    activeJobs.delete(jobId);
    metrics.totalProcessed++;
  }
}

/**
 * Singolo tick del worker: processa batch di donazioni
 */
async function tick() {
  if (processing) {
    // Skip se ancora in processamento (previene overlap)
    return;
  }

  processing = true;

  try {
    // Estrae batch di donazioni dalla coda
    const batch = [];
    for (let i = 0; i < CONFIG.batchSize; i++) {
      const donation = await donationQueueManager.dequeue(WORKER_ID);
      if (!donation) break; // Coda vuota
      batch.push(donation);
    }

    if (batch.length === 0) {
      // Coda vuota, niente da fare
      return;
    }

    console.log(`\n📦 Processing batch: ${batch.length} donations`);

    // Processa donazioni in parallelo (fino a CONFIG.concurrency)
    const promises = [];
    for (const donation of batch) {
      // Limita concorrenza: aspetta se ci sono già N job attivi
      while (activeJobs.size >= CONFIG.concurrency) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      promises.push(processDonation(donation));
    }

    // Aspetta che tutto il batch sia completato
    await Promise.all(promises);

    console.log(`✅ Batch completed: ${batch.length} donations processed`);

  } catch (error) {
    console.error('❌ Worker tick error:', error.message, error);
  } finally {
    processing = false;
  }
}

/**
 * Stampa statistiche worker
 */
async function printStats() {
  try {
    const queueStats = await donationQueueManager.getStats();
    const uptime = metrics.startedAt 
      ? Math.floor((Date.now() - metrics.startedAt.getTime()) / 1000)
      : 0;

    console.log('\n📊 DONATION WORKER STATS');
    console.log('========================');
    console.log(`Worker ID: ${WORKER_ID}`);
    console.log(`Uptime: ${uptime}s`);
    console.log(`\nProcessed: ${metrics.totalProcessed} total`);
    console.log(`  ✅ Succeeded: ${metrics.totalSucceeded}`);
    console.log(`  ❌ Failed: ${metrics.totalFailed}`);
    console.log(`  🔄 Retried: ${metrics.totalRetried}`);
    console.log(`\nQueue:`);
    console.log(`  ⏳ Pending: ${queueStats.pending}`);
    console.log(`  🔄 Processing: ${queueStats.processing}`);
    console.log(`  ⚠️  Failed (retryable): ${queueStats.failedRetryable}`);
    console.log(`  ✅ Completed: ${queueStats.completed}`);
    console.log(`  💀 Dead: ${queueStats.dead}`);
    console.log(`  🔒 Stale locks: ${queueStats.staleLocks}`);
    console.log(`\nAvg processing time: ${queueStats.avgProcessingTimeSeconds}s`);
    console.log(`Active jobs: ${activeJobs.size}`);
    console.log('========================\n');

  } catch (error) {
    console.error('❌ Stats error:', error.message);
  }
}

/**
 * Cleanup periodico coda
 */
async function cleanup() {
  try {
    await donationQueueManager.cleanup();
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
  }
}

// ========================================
// LIFECYCLE
// ========================================

/**
 * Avvia worker
 */
function start() {
  if (started) return;

  if (!CONFIG.enabled) {
    console.log('ℹ️  Donation worker disabilitato (DONATION_WORKER_ENABLED=false)');
    return;
  }

  console.log('\n🧵 DONATION WORKER STARTING');
  console.log(`   Worker ID: ${WORKER_ID}`);
  console.log(`   Interval: ${CONFIG.intervalMs}ms`);
  console.log(`   Concurrency: ${CONFIG.concurrency}`);
  console.log(`   Batch size: ${CONFIG.batchSize}`);
  console.log(`   Expected throughput: ~${(60000 / CONFIG.intervalMs) * CONFIG.batchSize} donations/min\n`);

  metrics.startedAt = new Date();
  started = true;

  // Primo tick subito
  tick();

  // Loop principale
  timer = setInterval(tick, Math.max(100, CONFIG.intervalMs));
  timer.unref?.();

  // Stats periodiche
  statsTimer = setInterval(printStats, CONFIG.statsIntervalMs);
  statsTimer.unref?.();

  // Cleanup ogni ora
  setInterval(cleanup, 3600000);

  console.log('✅ Donation worker started\n');
}

/**
 * Ferma worker (graceful shutdown)
 */
async function stop() {
  if (!started) return;

  console.log('\n🛑 Stopping donation worker...');

  // Ferma timer
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }

  // Aspetta che job attivi completino (max 30 secondi)
  const maxWait = 30000;
  const startWait = Date.now();

  while (activeJobs.size > 0 && (Date.now() - startWait) < maxWait) {
    console.log(`   Waiting for ${activeJobs.size} active jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (activeJobs.size > 0) {
    console.warn(`⚠️  ${activeJobs.size} jobs still active after ${maxWait}ms, forcing shutdown`);
  }

  started = false;
  console.log('✅ Donation worker stopped\n');
}

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

process.on('SIGTERM', async () => {
  console.log('\n⚠️  SIGTERM received');
  await stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT received');
  await stop();
  process.exit(0);
});

// ========================================
// EXPORTS
// ========================================

module.exports = {
  start,
  stop,
  getMetrics: () => ({ ...metrics }),
  isRunning: () => started
};
