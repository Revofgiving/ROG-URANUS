/**
 * 🚀 URANUS — Donation Queue (1.000+ donazioni/minuto)
 *
 * Disaccoppia la ricezione delle donazioni dal processamento:
 *   1. POST /api/dona → valida input, accoda, ritorna subito { jobId, status: 'QUEUED' }
 *   2. Worker background processa la coda in ordine FIFO
 *   3. GET /api/dona/status/:jobId → frontend fa polling ogni 2s
 *
 * Le posizioni vengono create in ordine sequenziale dal worker (1 alla volta)
 * per evitare race condition sulla numerazione tavole/caselle.
 */
'use strict';

const crypto = require('crypto');
const pg = require('./pg-connection-manager');

// ── CODA IN MEMORIA (+ persistenza PostgreSQL per resilienza) ──

const queue = [];           // Array FIFO di job
const results = new Map();  // jobId → risultato (in memoria, TTL 10 min)
let processing = false;
let totalProcessed = 0;
let totalErrors = 0;
// ── RETRY automatico su transazioni ancora in pending O turno bloccato ──
// Copre due casi:
//   1. TX non ancora confermata su Polygon (RPC lag)
//   2. Turno ENTRATA bloccato — il watchdog lo ripara entro 60s, la coda riprova
const MAX_TX_ATTEMPTS = Number(process.env.DONA_TX_MAX_ATTEMPTS || 60); // ~3 min a 3s/tentativo
const TX_RETRY_DELAY_MS = Number(process.env.DONA_TX_RETRY_MS || 3000); // 3s = risposta rapida

// ── INIT: crea tabella coda se non esiste ──

async function initQueueTable() {
  try {
    await pg.query(`
      CREATE TABLE IF NOT EXISTS donation_queue (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        num_posizioni INTEGER DEFAULT 1,
        nome TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      )
    `);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_dq_status ON donation_queue(status)`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_dq_wallet ON donation_queue(wallet)`);
    console.log('🚀 [DonationQueue] Tabella donation_queue pronta');
  } catch (e) {
    console.error('⚠️ [DonationQueue] Init tabella fallita:', e.message);
  }
}

// ── ACCODA DONAZIONE ──

/**
 * Accoda una donazione. Ritorna immediatamente con un jobId.
 * Il worker background la processerà in ordine FIFO.
 */
async function enqueue({ wallet, txHash, numeroPosizioni, nome }) {
  const jobId = `dq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const job = {
    id: jobId,
    wallet: wallet.toLowerCase(),
    txHash,
    numeroPosizioni: numeroPosizioni || 1,
    nome: nome || null,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
  };

  // Salva in DB per resilienza
  try {
    await pg.query(
      `INSERT INTO donation_queue (id, wallet, tx_hash, num_posizioni, nome, status)
       VALUES ($1, $2, $3, $4, $5, 'QUEUED')
       ON CONFLICT (id) DO NOTHING`,
      [jobId, job.wallet, txHash, job.numeroPosizioni, job.nome]
    );
  } catch (e) {
    console.error('⚠️ [DonationQueue] DB insert fallito:', e.message);
    // Prosegui comunque con la coda in memoria
  }

  // Accoda in memoria
  queue.push(job);

  console.log(`🚀 [DonationQueue] Accodato: ${jobId} wallet=${job.wallet.substring(0, 10)} (coda: ${queue.length})`);

  // Avvia processing se non attivo
  if (!processing) processNext();

  return { jobId, status: 'QUEUED', position: queue.length };
}

// ── STATO JOB ──

async function getStatus(jobId) {
  // 1. Cerca in memoria (veloce)
  const cached = results.get(jobId);
  if (cached) return cached;

  // 2. Cerca nella coda attiva
  const inQueue = queue.find(j => j.id === jobId);
  if (inQueue) {
    return {
      jobId,
      status: inQueue.status,
      position: queue.indexOf(inQueue) + 1,
      queueLength: queue.length,
    };
  }

  // 3. Cerca in DB (per job già processati)
  try {
    const row = await pg.queryOne(
      `SELECT id, status, result, processed_at FROM donation_queue WHERE id = $1`,
      [jobId]
    );
    if (row) {
      return {
        jobId: row.id,
        status: row.status,
        result: row.result,
        processedAt: row.processed_at,
      };
    }
  } catch (_) {}

  return { jobId, status: 'NOT_FOUND' };
}

// ── WORKER: processa coda FIFO ──

async function processNext() {
  if (queue.length === 0) {
    processing = false;
    return;
  }

  processing = true;
  const job = queue[0]; // Peek (non rimuovere ancora)
  job.status = 'PROCESSING';
  let requeue = false;

  try {
    // Lazy-load per evitare circular dependency
    const flow = require('./donation-flow-manager');

    const result = await flow.processaDonoEntrataWallet({
      wallet: job.wallet,
      txHash: job.txHash,
      numeroPosizioni: job.numeroPosizioni,
      nome: job.nome,
    });

    // Successo
    const completed = {
      jobId: job.id,
      status: 'COMPLETED',
      result,
      processedAt: new Date().toISOString(),
    };

    results.set(job.id, completed);
    totalProcessed++;

    // Aggiorna DB
    try {
      await pg.query(
        `UPDATE donation_queue SET status = 'COMPLETED', result = $1, processed_at = NOW() WHERE id = $2`,
        [JSON.stringify(result), job.id]
      );
    } catch (_) {}

    console.log(`✅ [DonationQueue] Completato: ${job.id} ticket=${result.ticket || '?'} (processati: ${totalProcessed})`);

  } catch (err) {
    const isRetryable = !!(err && (
      err.retryable ||
      err.code === 'TX_PENDING' ||
      err.code === 'RPC_ERROR' ||
      /non trovata su Polygon|in pending|Impossibile contattare Polygon|Nessun turno attivo|Nessuna tavola aperta|watchdog in corso/i.test(err.message || '')
    ));
    job.attempts = (job.attempts || 0) + 1;

    if (isRetryable && job.attempts < MAX_TX_ATTEMPTS) {
      // Non definitivo: la tx e probabilmente ancora in pending → ri-accoda e ritenta.
      requeue = true;
      results.set(job.id, {
        jobId: job.id,
        status: 'PENDING_RETRY',
        attempt: job.attempts,
        maxAttempts: MAX_TX_ATTEMPTS,
        error: err.message,
      });
      try {
        await pg.query(
          `UPDATE donation_queue SET status = 'PENDING_RETRY', result = $1 WHERE id = $2`,
          [JSON.stringify({ attempt: job.attempts, error: err.message }), job.id]
        );
      } catch (_) {}
      console.warn(`⏳ [DonationQueue] ${job.id} tx non ancora confermata — retry ${job.attempts}/${MAX_TX_ATTEMPTS} tra ${TX_RETRY_DELAY_MS}ms`);
    } else {
      // Errore definitivo (o tentativi esauriti).
      const failed = {
        jobId: job.id,
        status: 'FAILED',
        error: err.message,
        attempts: job.attempts,
        processedAt: new Date().toISOString(),
      };

      results.set(job.id, failed);
      totalErrors++;

      try {
        await pg.query(
          `UPDATE donation_queue SET status = 'FAILED', result = $1, processed_at = NOW() WHERE id = $2`,
          [JSON.stringify({ error: err.message, attempts: job.attempts }), job.id]
        );
      } catch (_) {}

      console.error(`❌ [DonationQueue] Errore: ${job.id} — ${err.message}`);
    }
  }

  // Rimuovi dalla coda e processa il prossimo
  queue.shift();

  // Se la tx era ancora in pending, ri-accoda il job in fondo dopo un breve ritardo.
  if (requeue) {
    setTimeout(() => {
      job.status = 'QUEUED';
      queue.push(job);
      if (!processing) processNext();
    }, TX_RETRY_DELAY_MS);
  }

  // Pulizia risultati vecchi (>10 min) per non consumare memoria
  const now = Date.now();
  for (const [key, val] of results.entries()) {
    if (val.processedAt && now - new Date(val.processedAt).getTime() > 10 * 60 * 1000) {
      results.delete(key);
    }
  }

  // Processa prossimo job immediatamente (senza setTimeout per massima velocità)
  setImmediate(processNext);
}

// ── STATISTICHE ──

function getStats() {
  return {
    queueLength: queue.length,
    processing,
    totalProcessed,
    totalErrors,
    resultsInMemory: results.size,
  };
}

// ── RETRY DONAZIONI FALLITE (chiamato dal watchdog dopo fix turno) ──

/**
 * Riaccoda le donazioni FAILED recenti che sono fallite per turno bloccato.
 * Chiamato dal watchdog ogni volta che sblocca un turno.
 */
async function retryFailedTurnoJobs() {
  try {
    // Cerca job FAILED nelle ultime 2 ore con errore turno
    const failedJobs = await pg.queryMany(
      `SELECT * FROM donation_queue
       WHERE status = 'FAILED'
         AND created_at > NOW() - INTERVAL '2 hours'
         AND result::text ILIKE '%turno%'
       ORDER BY created_at ASC
       LIMIT 20`
    );

    if (!failedJobs.length) return;

    console.log(`\ud83d\udd04 [DonationQueue] Riaccodo ${failedJobs.length} donazioni fallite per turno bloccato...`);

    for (const row of failedJobs) {
      // Rimetti a QUEUED nel DB
      await pg.query(
        `UPDATE donation_queue SET status = 'QUEUED', result = NULL WHERE id = $1`,
        [row.id]
      );

      // Riaccoda in memoria
      const job = {
        id: row.id,
        wallet: row.wallet,
        txHash: row.tx_hash,
        numeroPosizioni: row.num_posizioni || 1,
        nome: row.nome,
        status: 'QUEUED',
        createdAt: row.created_at,
        attempts: 0,
      };

      queue.push(job);
      console.log(`   \u21ba Riaccoda: ${row.id} wallet=${row.wallet.substring(0, 10)}`);
    }

    if (!processing) processNext();
  } catch (e) {
    console.error('\u26a0\ufe0f [DonationQueue] retryFailedTurnoJobs errore:', e.message);
  }
}

module.exports = {
  initQueueTable,
  enqueue,
  getStatus,
  getStats,
  retryFailedTurnoJobs,
};
