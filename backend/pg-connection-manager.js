/**
 * 🐘 URANO v2 — PostgreSQL Connection Manager
 *
 * Pool di connessioni PostgreSQL condiviso da tutti i moduli.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

let pool = null;
// Contesto transazione: se attivo, contiene il client dedicato alla transazione corrente.
const txStorage = new AsyncLocalStorage();

function currentTxClient() {
  const store = txStorage.getStore();
  return (store && store.client) || null;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX) || 80,  // connessioni pool — tunabile via env senza toccare il codice
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // 10s timeout connessione
      statement_timeout: 30000,      // 30s timeout query
      keepAlive: true,               // mantiene vive le connessioni (evita drop dietro proxy/NAT)
    });

    pool.on('error', (err) => {
      console.error('❌ Errore imprevisto pool PostgreSQL:', err.message);
    });
  }
  return pool;
}

async function query(sql, params = []) {
  // Dentro una transazione (vedi `transaction`) usa il client dedicato, altrimenti il pool.
  const runner = currentTxClient() || getPool();
  const res = await runner.query(sql, params);
  return res;
}

async function queryOne(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function queryMany(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

async function getClient() {
  return await getPool().connect();
}

async function testConnection() {
  try {
    const res = await queryOne('SELECT NOW() AS now');
    console.log('✅ PostgreSQL connesso:', res.now);
    return true;
  } catch (e) {
    console.error('❌ PostgreSQL non raggiungibile:', e.message);
    return false;
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Esegue `fn` dentro una transazione DB: tutte le query eseguite tramite questo
// modulo durante `fn` usano lo stesso client (BEGIN -> COMMIT, oppure ROLLBACK su errore).
// Le transazioni annidate riusano il client corrente senza aprire un nuovo BEGIN.
async function transaction(fn) {
  if (currentTxClient()) {
    return await fn();
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run({ client }, () => fn());
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Esegue `fn` dentro un SAVEPOINT (solo se siamo in una transazione): se `fn`
// fallisce, annulla solo questo passo senza compromettere l'intera transazione.
// Utile per operazioni best-effort (es. calcoli non critici).
async function savepoint(fn) {
  const client = currentTxClient();
  if (!client) return await fn();
  const name = 'sp_' + Math.random().toString(36).slice(2, 10);
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (e) {
    try { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); } catch (_) {}
    throw e;
  }
}

module.exports = {
  getPool,
  getClient,
  query,
  queryOne,
  queryMany,
  transaction,
  savepoint,
  testConnection,
  close
};
