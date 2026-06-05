/**
 * ⚡ SUPERURANO — Async Queue (Coda asincrona in-memory)
 *
 * Problema risolto:
 *   Le operazioni di cascata (rientri Sole, auto-entry Nettuno, processaUsciteCascata)
 *   possono generare catene profonde di DB operations che bloccano la richiesta API
 *   corrente, esauriscono il pool PostgreSQL e causano timeout sul frontend.
 *
 * Soluzione:
 *   Tutte le operazioni NON critiche per la risposta immediata all'utente
 *   vengono inserite in questa coda e processate in background, una alla volta,
 *   senza bloccare il ciclo della richiesta.
 *
 * Cosa rimane SINCRONO (sulla richiesta):
 *   - Registrazione payout (PAYOUT_L3, PAYOUT_L5, PAYOUT_NETTUNO)
 *   - Insert Nettuno posizioni (bridge entry)
 *   - Insert ROG SMALL flussi_esterni (contabilità)
 *   - bridge_log registration
 *
 * Cosa va in CODA (background):
 *   - posizionaRientroSole (PHARAOH, Sole L0 URANUS)
 *   - posizionaRientroSoleUnico (Nettuno PHARAOH, Sole L0)
 *   - processaUsciteCascata (cascata FIFO)
 *   - auto-entry Nettuno da completamento Sole
 *
 * Caratteristiche:
 *   - FIFO: primo entrato, primo eseguito
 *   - Seriale: un task alla volta (zero race condition su DB)
 *   - Fire-and-forget: errori loggati ma non propagati alla richiesta
 *   - In-memory: task persi se il processo si riavvia (accettabile per rientri)
 *   - Zero dipendenze: nessun Redis/Bull/pg-boss necessario
 */
'use strict';

const tasks = [];
let _running = false;
let _totalEnqueued = 0;
let _totalCompleted = 0;
let _totalErrors = 0;

// ── Worker ──────────────────────────────────────────────────────────────────

async function _processNext() {
  if (_running || tasks.length === 0) return;
  _running = true;

  while (tasks.length > 0) {
    const { fn, label } = tasks.shift();
    try {
      await fn();
      _totalCompleted++;
    } catch (e) {
      _totalErrors++;
      console.error(`⚠️  [AsyncQueue] Task "${label}" fallito: ${e.message}`);
    }
  }

  _running = false;
}

// ── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Aggiunge un task alla coda e avvia il worker se non è già in esecuzione.
 *
 * @param {Function} fn   - Funzione async da eseguire in background
 * @param {string} label  - Etichetta per il logging degli errori
 */
function enqueue(fn, label = 'task') {
  tasks.push({ fn, label });
  _totalEnqueued++;
  setImmediate(_processNext);
}

/**
 * Stato corrente della coda (per monitoring).
 */
function getStatus() {
  return {
    inCoda: tasks.length,
    running: _running,
    totalEnqueued: _totalEnqueued,
    totalCompleted: _totalCompleted,
    totalErrors: _totalErrors,
  };
}

module.exports = { enqueue, getStatus };
