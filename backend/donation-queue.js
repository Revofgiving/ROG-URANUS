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

// ── ALTERNANZA SOLIDALE (interlacciamento coppie tra donatori) ──
// Le coppie di una donazione multipla NON vengono piazzate tutte di fila: si
// alternano con gli altri donatori (max 1 coppia consecutiva per utente). Se un
// donatore è solo, dopo ALTERNANZA_GRACE_MS senza altri doni gli vengono assegnate
// tutte le coppie restanti in sequenza. Disattivabile con ALTERNANZA_SOLIDALE=false.
const ALTERNANZA_ON = process.env.ALTERNANZA_SOLIDALE !== 'false';
const ALTERNANZA_GRACE_MS = Number(process.env.ALTERNANZA_GRACE_MS || 5 * 60 * 1000); // 5 minuti
const waiting = []; // job di donatori soli in finestra di grazia

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
    // Colonne per la durabilità dell'alternanza (progresso coppie persistito atomicamente).
    await pg.query(`ALTER TABLE donation_queue ADD COLUMN IF NOT EXISTS placed_coppie INTEGER DEFAULT 0`);
    await pg.query(`ALTER TABLE donation_queue ADD COLUMN IF NOT EXISTS total_coppie INTEGER`);
    await pg.query(`ALTER TABLE donation_queue ADD COLUMN IF NOT EXISTS setup_done BOOLEAN DEFAULT FALSE`);
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

  // Un nuovo dono “sblocca” eventuali donatori soli in finestra di grazia:
  // tornano in coda per interlacciarsi col nuovo donatore.
  riattivaInAttesa();

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

// ── WORKER: alternanza solidale (1 coppia per turno, round-robin tra donatori) ──

// Riattiva i donatori soli in attesa quando arriva un nuovo dono: tornano in coda
// per interlacciarsi col nuovo donatore (si annulla la finestra di grazia).
function riattivaInAttesa() {
  while (waiting.length) {
    const j = waiting.shift();
    if (j._graceTimer) { clearTimeout(j._graceTimer); j._graceTimer = null; }
    j.status = 'QUEUED';
    queue.push(j);
  }
}

function isRetryableErr(err) {
  return !!(err && (
    err.retryable || err.code === 'TX_PENDING' || err.code === 'RPC_ERROR' ||
    /non trovata su Polygon|in pending|Impossibile contattare Polygon|Nessun turno attivo|Nessuna tavola aperta|watchdog in corso|current transaction is aborted/i.test(err.message || '')
  ));
}

async function markCompleted(job, result) {
  const completed = { jobId: job.id, status: 'COMPLETED', result, processedAt: new Date().toISOString() };
  results.set(job.id, completed);
  totalProcessed++;
  try {
    await pg.query(`UPDATE donation_queue SET status = 'COMPLETED', result = $1, processed_at = NOW() WHERE id = $2`, [JSON.stringify(result), job.id]);
  } catch (_) {}
  console.log(`✅ [DonationQueue] Completato: ${job.id} ticket=${result.ticket || '?'} (processati: ${totalProcessed})`);
}

async function markFailed(job, err) {
  const failed = { jobId: job.id, status: 'FAILED', error: err.message, attempts: job.attempts, processedAt: new Date().toISOString() };
  results.set(job.id, failed);
  totalErrors++;
  try {
    await pg.query(`UPDATE donation_queue SET status = 'FAILED', result = $1, processed_at = NOW() WHERE id = $2`, [JSON.stringify({ error: err.message, attempts: job.attempts }), job.id]);
  } catch (_) {}
  console.error(`❌ [DonationQueue] Errore: ${job.id} — ${err.message}`);
}

// Finestra di grazia scaduta (donatore solo): piazza in sequenza le coppie restanti.
async function flushRimanenti(job) {
  if (job.status !== 'WAITING_GRACE') return; // riattivato nel frattempo
  const idx = waiting.indexOf(job);
  if (idx >= 0) waiting.splice(idx, 1);
  if (job._graceTimer) { clearTimeout(job._graceTimer); job._graceTimer = null; }
  job.status = 'PROCESSING';
  try {
    const flow = require('./donation-flow-manager');
    let r;
    do {
      r = await flow.processaCoppiaEntrata({ wallet: job.wallet, txHash: job.txHash, nome: job.nome, state: job.state, jobId: job.id });
      job.state = r.state;
    } while (!r.done);
    await markCompleted(job, { success: true, wallet: job.wallet, ticket: r.ticket, numeroCoppie: r.total });
    console.log(`✅ [Alternanza] Flush donatore solo: ${job.id} (${r.total} coppie sequenziali)`);
  } catch (err) {
    if (isRetryableErr(err)) { job.status = 'QUEUED'; queue.push(job); }
    else { await markFailed(job, err); }
  }
  if (!processing) processNext();
}

async function processNext() {
  if (queue.length === 0) {
    processing = false;
    return;
  }

  processing = true;
  const job = queue[0]; // Peek (non rimuovere ancora)
  job.status = 'PROCESSING';
  let requeue = false;
  let partial = false;

  try {
    // Lazy-load per evitare circular dependency
    const flow = require('./donation-flow-manager');

    if (!ALTERNANZA_ON) {
      // Comportamento storico: tutte le coppie in un'unica chiamata atomica.
      const result = await flow.processaDonoEntrataWallet({
        wallet: job.wallet, txHash: job.txHash, numeroPosizioni: job.numeroPosizioni, nome: job.nome,
      });
      await markCompleted(job, result);
    } else {
      // Alternanza solidale: UNA coppia per turno (setup alla prima).
      if (!job.state) job.state = { numeroPosizioni: job.numeroPosizioni };
      const r = await flow.processaCoppiaEntrata({
        wallet: job.wallet, txHash: job.txHash, nome: job.nome, state: job.state, jobId: job.id,
      });
      job.state = r.state;
      if (r.done) {
        await markCompleted(job, { success: true, wallet: job.wallet, ticket: r.ticket, numeroCoppie: r.total });
      } else {
        partial = true;
        results.set(job.id, { jobId: job.id, status: 'PROCESSING', placed: r.placed, total: r.total });
      }
    }
  } catch (err) {
    job.attempts = (job.attempts || 0) + 1;
    if (isRetryableErr(err) && job.attempts < MAX_TX_ATTEMPTS) {
      // Non definitivo (tx pending o turno bloccato) → ri-accoda e ritenta.
      requeue = true;
      results.set(job.id, { jobId: job.id, status: 'PENDING_RETRY', attempt: job.attempts, maxAttempts: MAX_TX_ATTEMPTS, error: err.message });
      try {
        await pg.query(`UPDATE donation_queue SET status = 'PENDING_RETRY', result = $1 WHERE id = $2`, [JSON.stringify({ attempt: job.attempts, error: err.message }), job.id]);
      } catch (_) {}
      console.warn(`⏳ [DonationQueue] ${job.id} non confermata/turno — retry ${job.attempts}/${MAX_TX_ATTEMPTS} tra ${TX_RETRY_DELAY_MS}ms`);
    } else {
      await markFailed(job, err);
    }
  }

  // Rimuovi dalla testa
  queue.shift();

  if (partial) {
    // Restano coppie da piazzare per questo donatore.
    const altriDonatori = queue.some(j => j.wallet !== job.wallet);
    if (altriDonatori) {
      // Interlaccia: il job va in fondo (max 1 coppia consecutiva per utente).
      job.status = 'QUEUED';
      queue.push(job);
    } else {
      // Donatore solo: finestra di grazia prima di assegnargli il resto in sequenza.
      job.status = 'WAITING_GRACE';
      waiting.push(job);
      job._graceTimer = setTimeout(() => flushRimanenti(job), ALTERNANZA_GRACE_MS);
      console.log(`⏳ [Alternanza] ${job.wallet.substring(0, 10)} solo: attendo ${Math.round(ALTERNANZA_GRACE_MS / 60000)} min per altri doni prima del flush`);
    }
  } else if (requeue) {
    // tx ancora in pending: ri-accoda il job in fondo dopo un breve ritardo.
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

  // Processa prossimo job immediatamente
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

// ── RECOVERY: riprende donazioni multi-coppia interrotte ──

// Costruisce un job in memoria da una riga DB, ricostruendo lo stato di avanzamento:
// se il setup era già completato, riprende dalle coppie mancanti (no ri-verifica tx).
function jobFromRow(row) {
  const job = {
    id: row.id, wallet: row.wallet, txHash: row.tx_hash,
    numeroPosizioni: row.num_posizioni || 1, nome: row.nome,
    status: 'QUEUED', createdAt: row.created_at, attempts: 0,
  };
  if (row.setup_done) {
    job.state = {
      setupDone: true,
      n: Number(row.total_coppie) || job.numeroPosizioni,
      placed: Number(row.placed_coppie) || 0,
      numeroPosizioni: job.numeroPosizioni,
    };
  }
  return job;
}

// Accoda un job recuperato; se tutte le coppie risultano già piazzate, lo completa subito.
async function enqueueRecovered(job) {
  if (queue.find(j => j.id === job.id)) return; // già in coda
  if (job.state && job.state.setupDone && job.state.placed >= job.state.n) {
    await markCompleted(job, { success: true, wallet: job.wallet, numeroCoppie: job.state.n, recovered: true });
    return;
  }
  queue.push(job);
}

// Allo startup: riprende i job non terminati (PROCESSING / PENDING_RETRY / QUEUED).
async function recoverIncompleteJobs() {
  let rows = [];
  try {
    rows = await pg.queryMany(
      `SELECT * FROM donation_queue
       WHERE status IN ('PROCESSING','PENDING_RETRY','QUEUED')
       ORDER BY created_at ASC LIMIT 500`
    );
  } catch (e) {
    console.error('\u26a0\ufe0f [Recovery] lettura fallita:', e.message);
    return;
  }
  if (!rows.length) return;
  let ripresi = 0;
  for (const row of rows) {
    const job = jobFromRow(row);
    if (job.state) console.log(`\u267b\ufe0f [Recovery] ${row.id}: ${job.state.placed}/${job.state.n} coppie gi\u00e0 piazzate`);
    else console.log(`\u267b\ufe0f [Recovery] ${row.id}: ripresa da zero (setup non completato)`);
    await enqueueRecovered(job);
    ripresi++;
  }
  console.log(`\u267b\ufe0f [Recovery] ${ripresi} donazioni riprese`);
  if (queue.length && !processing) processNext();
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

      // Riaccoda in memoria (ricostruendo lo stato di avanzamento se setup già fatto)
      await enqueueRecovered(jobFromRow(row));
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
  recoverIncompleteJobs,
};
