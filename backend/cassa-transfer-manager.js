'use strict';
/**
 * 🏦 URANUS — Cassa Transfer Manager
 *
 * Trasferimenti REALI di USDC dalla cassa Uranus (treasury, firma con
 * TREASURY_PRIVATE_KEY) verso le casse esterne dell'ecosistema:
 *   - CASSA ROG     → ingressi ROG SMALL (coppie utente + piletta)
 *   - CASSA PHARAOH → accantonamento PHARAOH (per quando PHARAOH parte)
 *
 * Sostituisce il vecchio "fire-and-forget senza retry": ogni trasferimento viene
 * PERSISTITO in `trasferimenti_cassa` (idempotente via event_key) e completato
 * on-chain da un job di retry. Se l'RPC o il saldo cassa è momentaneamente non
 * disponibile, il trasferimento resta PENDING e viene ritentato — non si perde.
 *
 * Riusa payout-manager.inviaPagamento (stesso signer/token USDC dei payout).
 *
 * SICUREZZA TRANSAZIONI: registraTrasferimento esegue SOLO la scrittura DB
 * (può quindi partecipare alla transazione del chiamante: se questa fa rollback,
 * il trasferimento NON viene registrato). L'invio on-chain avviene esclusivamente
 * nel job di retry, FUORI da qualsiasi transazione di richiesta, leggendo solo
 * record già committati.
 */

const crypto    = require('crypto');
const pg        = require('./pg-connection-manager');
const payoutMgr = require('./payout-manager');
const alerts    = require('./alert-manager');

// Indirizzi casse esterne. Override via env; fallback: indirizzi del movimento.
const CASSA_ROG_WALLET     = (process.env.CASSA_ROG_WALLET     || '0xD5bCC7acc9d6862c784807134c1F70c3e7f9F790');
const CASSA_PHARAOH_WALLET = (process.env.CASSA_PHARAOH_WALLET || '0xE1f5A90854CFC43B936F7be135a84dFEf1A5ab50');

const RETRY_INTERVAL_MS = 60 * 1000;   // ritenta i PENDING ogni 60s
const MAX_RETRIES       = 20;          // dopo N tentativi falliti → FAILED (allertabile)
const BATCH             = 25;          // PENDING processati per giro
const ALERT_STATE_KEY   = 'cassa_transfer_failed_alerts';

function walletDestinazione(dest) {
  if (dest === 'ROG')     return CASSA_ROG_WALLET;
  if (dest === 'PHARAOH') return CASSA_PHARAOH_WALLET;
  throw new Error(`Destinazione cassa sconosciuta: ${dest}`);
}

function abbreviateWallet(wallet) {
  if (!wallet) return 'n/a';
  const w = String(wallet);
  if (w.length <= 12) return w;
  return `${w.substring(0, 8)}...${w.substring(w.length - 4)}`;
}

function abbreviateError(err) {
  if (!err) return 'errore sconosciuto';
  const s = String(err);
  return s.length > 120 ? `${s.substring(0, 120)}…` : s;
}

async function shouldAlertFailedTransfer(id) {
  const row = await pg.queryOne(`SELECT value FROM state_persistence WHERE key = $1`, [ALERT_STATE_KEY]);
  const state = row?.value || { ids: [] };
  const ids = Array.isArray(state.ids) ? state.ids : [];
  if (ids.includes(id)) return false;
  ids.push(id);
  const trimmed = ids.slice(-2000);
  await pg.query(
    `INSERT INTO state_persistence (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [ALERT_STATE_KEY, JSON.stringify({ ids: trimmed })]
  );
  return true;
}

async function alertFailedTransfer(record, errMsg) {
  try {
    const allowed = await shouldAlertFailedTransfer(record.id);
    if (!allowed) return;
    const text =
      `⚠️ <b>CASSA TRANSFER FAILED</b>\n` +
      `ID: <code>${record.id}</code>\n` +
      `Dest: <b>${record.destinazione}</b>\n` +
      `Importo: <b>${Number(record.importo).toLocaleString()} USDC</b>\n` +
      `Wallet: <code>${abbreviateWallet(record.wallet_destinatario)}</code>\n` +
      `Motivo: ${record.motivo || 'n/a'}\n` +
      `Errore: ${abbreviateError(errMsg)}`;
    await alerts.sendTelegramAlert(text);
  } catch (e) {
    console.warn('[CassaTransfer] Alert Telegram non inviato:', e.message);
  }
}

// ── SCHEMA ──────────────────────────────────────────────────────────
async function initTable() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS trasferimenti_cassa (
      id                  SERIAL PRIMARY KEY,
      destinazione        TEXT NOT NULL,                    -- ROG | PHARAOH
      wallet_destinatario TEXT NOT NULL,
      importo             NUMERIC(12,2) NOT NULL,
      origine_wallet      TEXT,
      motivo              TEXT,
      status              TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED
      tx_hash             TEXT,
      retries             INTEGER NOT NULL DEFAULT 0,
      ultimo_errore       TEXT,
      event_key           TEXT UNIQUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_trasf_cassa_status ON trasferimenti_cassa(status)`);
}

// DDL una sola volta al boot (su connessione pool, fuori da transazioni di richiesta).
const readyPromise = initTable();

// ── REGISTRAZIONE (solo DB, idempotente) ────────────────────────────
/**
 * Registra un trasferimento verso una cassa esterna. NON invia on-chain qui:
 * l'invio è demandato al job di retry. Idempotente su event_key (se fornita).
 *
 * @param {Object} p
 * @param {('ROG'|'PHARAOH')} p.destinazione
 * @param {number} p.importo            - USDC
 * @param {string} [p.origineWallet]    - wallet origine (audit)
 * @param {string} [p.motivo]           - stringa di log
 * @param {string} [p.eventKey]         - chiave idempotenza (default: UUID casuale)
 * @returns {Object|null} record creato, o null se già presente (conflitto event_key)
 */
async function registraTrasferimento({ destinazione, importo, origineWallet = null, motivo = '', eventKey = null }) {
  await readyPromise;
  const wallet = walletDestinazione(destinazione);
  const key = eventKey || crypto.randomUUID();
  const row = await pg.queryOne(
    `INSERT INTO trasferimenti_cassa (destinazione, wallet_destinatario, importo, origine_wallet, motivo, event_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [destinazione, wallet.toLowerCase(), importo, origineWallet ? origineWallet.toLowerCase() : null, motivo, key]
  );
  return row || null;
}

// ── ESECUZIONE ON-CHAIN ─────────────────────────────────────────────
async function processaUno(record) {
  const res = await payoutMgr.inviaPagamento(
    record.wallet_destinatario, Number(record.importo),
    record.motivo || `CASSA_${record.destinazione}`
  );
  if (res && res.success) {
    await pg.query(
      `UPDATE trasferimenti_cassa SET status = 'SENT', tx_hash = $2, updated_at = NOW() WHERE id = $1`,
      [record.id, res.txHash]
    );
    console.log(`🏦 [CassaTransfer] ${record.importo} USDC → CASSA ${record.destinazione} OK (tx ${res.txHash})`);
    return true;
  }
  const willFail = (record.retries + 1) >= MAX_RETRIES;
  await pg.query(
    `UPDATE trasferimenti_cassa
       SET retries = retries + 1,
           ultimo_errore = $2,
           status = CASE WHEN retries + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END,
           updated_at = NOW()
     WHERE id = $1`,
    [record.id, (res && res.error) || 'errore sconosciuto', MAX_RETRIES]
  );
  if (willFail) {
    await alertFailedTransfer(record, (res && res.error) || 'errore sconosciuto');
  }
  console.warn(`🏦 [CassaTransfer] ${record.importo} USDC → CASSA ${record.destinazione} FALLITO: ${(res && res.error) || '??'} (ritento)`);
  return false;
}

/** Processa i trasferimenti PENDING (chiamato dal timer). */
async function processaPending() {
  await readyPromise;
  const pend = await pg.queryMany(
    `SELECT * FROM trasferimenti_cassa WHERE status = 'PENDING' AND retries < $1 ORDER BY id ASC LIMIT $2`,
    [MAX_RETRIES, BATCH]
  );
  let inviati = 0;
  for (const r of pend) {
    const ok = await processaUno(r).catch((e) => { console.error('🏦 [CassaTransfer] processaUno:', e.message); return false; });
    if (ok) inviati++;
  }
  return { processati: pend.length, inviati };
}

// ── RILASCIO PHARAOH (all'avvio di Pharaoh) ─────────────────────────
/**
 * Sposta verso CASSA PHARAOH il totale PHARAOH accantonato in cassa Uranus
 * (`flussi_esterni` tipo `PHARAOH_PENDING_*`, da L3/L5/Nettuno) NON ancora rilasciato.
 * Idempotente: in `state_persistence` (chiave `pharaoh_release`) traccia il totale già
 * rilasciato + un seq; un secondo avvio senza nuovi accantonamenti non ri-trasferisce.
 * Il bonifico reale è eseguito dal job di retry (come gli altri trasferimenti).
 *
 * @returns {Object} { rilasciato, pendingTotal, seq }
 */
async function rilasciaPharaohPending() {
  await readyPromise;
  return await pg.transaction(async () => {
    const sumRow = await pg.queryOne(
      `SELECT COALESCE(SUM(importo), 0) AS tot FROM flussi_esterni WHERE tipo LIKE 'PHARAOH_PENDING%'`
    );
    const pendingTotal = Number(sumRow?.tot) || 0;

    const stRow = await pg.queryOne(`SELECT value FROM state_persistence WHERE key = 'pharaoh_release'`);
    const st = (stRow && stRow.value) || { released_total: 0, seq: 0 };
    const released = Number(st.released_total) || 0;
    const toRelease = Math.round((pendingTotal - released) * 100) / 100;

    if (toRelease <= 0) {
      console.log(`🏦 [CassaTransfer] PHARAOH RELEASE: nulla da rilasciare (pending ${pendingTotal}, già ${released})`);
      return { rilasciato: 0, pendingTotal, giaRilasciato: released };
    }

    const seq = (Number(st.seq) || 0) + 1;
    await registraTrasferimento({
      destinazione: 'PHARAOH', importo: toRelease,
      motivo: `PHARAOH_RELEASE avvio Pharaoh #${seq}`,
      eventKey: `pharaoh-release-${seq}`,
    });
    await pg.query(
      `INSERT INTO state_persistence (key, value, updated_at) VALUES ('pharaoh_release', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify({ released_total: pendingTotal, seq })]
    );
    console.log(`🏦 [CassaTransfer] PHARAOH RELEASE #${seq}: ${toRelease} USDC → CASSA PHARAOH (pending tot ${pendingTotal})`);
    return { rilasciato: toRelease, pendingTotal, seq };
  });
}

// ── JOB DI RETRY ────────────────────────────────────────────────────
let retryTimer = null;
function avviaRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processaPending().catch((e) => console.error('🏦 [CassaTransfer] retry errore:', e.message));
  }, RETRY_INTERVAL_MS);
  console.log(`🏦 [CassaTransfer] Retry casse ogni ${RETRY_INTERVAL_MS / 1000}s — ROG=${CASSA_ROG_WALLET.substring(0, 10)}… PHARAOH=${CASSA_PHARAOH_WALLET.substring(0, 10)}…`);
}

// Auto-start (come gift-manager): init schema → avvia il job di retry.
readyPromise.then(() => avviaRetry()).catch((e) => console.error('🏦 [CassaTransfer] init errore:', e.message));

module.exports = {
  registraTrasferimento,
  processaPending,
  rilasciaPharaohPending,
  initTable,
  CASSA_ROG_WALLET,
  CASSA_PHARAOH_WALLET,
};
