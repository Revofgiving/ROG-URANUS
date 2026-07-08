/**
 * 🐘 ROG POSTGRESQL CONNECTION MANAGER
 * 
 * Gestisce pool di connessioni PostgreSQL su Coolify
 * Supporta sia DATABASE_URL che variabili separate
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 30 Novembre 2025
 */

const { Pool } = require('pg');

// ========================================
// CONFIGURAZIONE
// ========================================

let pool = null;
let isInitialized = false;
let isSchemaEnsured = false;

/**
 * Crea e configura pool PostgreSQL
 * @returns {Pool} Pool di connessioni
 */
function createPool() {
  if (pool) return pool;

  // SSL deve essere esplicitamente abilitato.
  // Rispetta DB_SSL o PGSSLMODE (require/disable). Default: ssl disabilitato.
  function computeSslFromEnv() {
    const raw = (process.env.DB_SSL || process.env.PGSSLMODE || process.env.DATABASE_SSL || '').toLowerCase();
    if (raw === 'require' || raw === 'true') return { rejectUnauthorized: false };
    if (raw === 'disable' || raw === 'false') return false;
    return false;
  }

  // 🔧 DATABASE_URL ha priorità: su Coolify è l'host interno del progetto ed è sempre corretto.
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

  const sslFromEnv = computeSslFromEnv();
  const config = connectionString
    ? {
        connectionString,
        ssl: sslFromEnv
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'rog_db',
        // Se si usano variabili separate, abilita SSL solo se forzato.
        ssl: sslFromEnv
      };

  pool = new Pool({
    ...config,

    // Pool ottimizzato per alta concorrenza (milioni di utenti)
    // Aumentato da 5 a 50 per gestire traffico elevato
    max: parseInt(process.env.PGPOOL_MAX || '50', 10),
    min: parseInt(process.env.PGPOOL_MIN || '5', 10),
    idleTimeoutMillis: parseInt(process.env.PGPOOL_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || '10000', 10),

    // Migliora stabilità su connessioni lunghe/NAT
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.PGPOOL_KEEPALIVE_DELAY_MS || '10000', 10),
    
    // Ottimizzazioni per performance
    allowExitOnIdle: false,
    statement_timeout: parseInt(process.env.PGPOOL_STATEMENT_TIMEOUT || '30000', 10)
  });

  // Event handlers per debugging
  pool.on('connect', () => {
    console.log('🐘 PostgreSQL: nuova connessione al pool');
  });

  pool.on('error', (err) => {
    // Errori tipici: connessione idle terminata dal server.
    // pg-pool gestisce AUTOMATICAMENTE la riconnessione — NON chiamare closePool() qui,
    // altrimenti tutte le query in corso ricevono "Cannot use a pool after calling end".
    console.error('❌ PostgreSQL pool error (idle client, auto-recover):', err.message);
  });

  console.log('✅ PostgreSQL pool creato');
  return pool;
}

/**
 * Inizializza connessione e verifica database
 */
async function ensureCoreSchema() {
  if (isSchemaEnsured) return;

  // NOTA: operazioni idempotenti (CREATE IF NOT EXISTS)
  const coreSql = `
    CREATE TABLE IF NOT EXISTS donations (
      id BIGSERIAL PRIMARY KEY,
      donation_id TEXT,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL DEFAULT 0,
      donor_wallet TEXT NOT NULL,
      beneficiary_wallet TEXT,
      donation_type TEXT NOT NULL DEFAULT 'standard',
      amount_usdc NUMERIC(18, 6) NOT NULL,
      ts TIMESTAMPTZ,
      positions_created INTEGER,
      first_position INTEGER,
      last_position INTEGER,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_donations_tx_log
      ON donations (tx_hash, log_index);

    CREATE INDEX IF NOT EXISTS idx_donations_donor
      ON donations (donor_wallet);

    CREATE INDEX IF NOT EXISTS idx_donations_beneficiary
      ON donations (beneficiary_wallet);

    -- Tabella coda FIFO per Dono al Volo
    -- Wallet segnalati dagli admin che non possono permettersi l'ingresso
    CREATE TABLE IF NOT EXISTS dono_al_volo_queue (
      id BIGSERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      nome TEXT,
      segnalato_da TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      used_at TIMESTAMPTZ,
      used_by_donation_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_dono_al_volo_queue_status
      ON dono_al_volo_queue (status);

    CREATE INDEX IF NOT EXISTS idx_dono_al_volo_queue_wallet
      ON dono_al_volo_queue (LOWER(wallet_address));


    -- Bridge URANUS → ROG (idempotenza event_key)
    CREATE TABLE IF NOT EXISTS uranus_bridge_events (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'URANUS_L3',
      tx_hash TEXT,
      wallet_origine TEXT,
      wallet_beneficiario TEXT NOT NULL,
      wallet_cassa TEXT NOT NULL,
      importo_ricevuto NUMERIC(18, 6),
      importo_utilizzato NUMERIC(18, 6),
      posizioni_attese INTEGER,
      donation_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      posizioni JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_uranus_bridge_status
      ON uranus_bridge_events (status);

    CREATE INDEX IF NOT EXISTS idx_uranus_bridge_wallet
      ON uranus_bridge_events (LOWER(wallet_beneficiario));

    -- VIEW POSIZIONI (wallet_positions è una VIEW, non una tabella)
    CREATE OR REPLACE VIEW wallet_positions AS
    SELECT
      wallet,
      numero_posizione AS posizione,
      id AS posizione_id,
      tipo,
      tavola_id,
      casella,
      nome,
      status,
      dono_importo,
      created_at
    FROM posizioni;
    
    -- INDICI PERFORMANCE su posizioni (tabella reale)
    CREATE INDEX IF NOT EXISTS idx_posizioni_wallet
      ON posizioni (wallet);
    
    CREATE INDEX IF NOT EXISTS idx_posizioni_numero_posizione
      ON posizioni (numero_posizione);
    
    CREATE INDEX IF NOT EXISTS idx_anagrafica_invitati_invitante
      ON anagrafica_invitati (invitante_wallet);
    
    CREATE INDEX IF NOT EXISTS idx_anagrafica_invitati_pos
      ON anagrafica_invitati (invitato_pos);
  `;

  await query(coreSql);
  isSchemaEnsured = true;
}

async function initDatabase() {
  if (isInitialized) return;

  try {
    const pg = createPool();

    // Test connessione
    const client = await pg.connect();
    const result = await client.query('SELECT NOW()');
    client.release();

    console.log('✅ PostgreSQL connesso:', result.rows[0].now);

    // Ensure schema (idempotente)
    await ensureCoreSchema();

    isInitialized = true;

  } catch (error) {
    console.error('❌ Errore connessione PostgreSQL:', error.message);
    throw error;
  }
}

/**
 * Ottiene pool PostgreSQL (crea se non esiste)
 * @returns {Pool}
 */
function getPool() {
  if (!pool) {
    createPool();
  }
  return pool;
}

/**
 * Esegue query con gestione errori
 * @param {string} text - Query SQL
 * @param {Array} params - Parametri query
 * @returns {Promise<Object>} Risultato query
 */
async function query(text, params = []) {
  const start = Date.now();

  // Retry semplice per errori transienti del pool
  const maxAttempts = parseInt(process.env.PG_QUERY_RETRIES || '2', 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pg = getPool();

    try {
      const result = await pg.query(text, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        console.warn(`⚠️  Query lenta (${duration}ms):`, text.substring(0, 100));
      }

      return result;
    } catch (error) {
      const msg = (error && error.message) || '';
      const transient = msg.includes('Connection terminated unexpectedly') || msg.includes('ECONNRESET') || msg.includes('terminating connection') || msg.includes('server closed the connection');

      console.error(`❌ Query error (attempt ${attempt}/${maxAttempts}):`, msg);

      if (transient && attempt < maxAttempts) {
        // Reset pool e riprova
        try {
          await closePool();
        } catch (_) {
          // ignore
        }
        await new Promise(r => setTimeout(r, 300 * attempt));
        continue;
      }

      console.error('   Query:', text);
      console.error('   Params:', params);
      throw error;
    }
  }
}

/**
 * Ottiene client dal pool (per transazioni)
 * @returns {Promise<PoolClient>}
 */
async function getClient() {
  const pg = getPool();
  return await pg.connect();
}

/**
 * Chiude pool (graceful shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    isInitialized = false;
    console.log('✅ PostgreSQL pool chiuso');
  }
}

/**
 * Helper per transazioni
 * @param {Function} callback - Funzione da eseguire in transazione
 * @returns {Promise<any>}
 */
async function transaction(callback) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Helper per query singola riga
 * @param {string} text - Query SQL
 * @param {Array} params - Parametri
 * @returns {Promise<Object|null>}
 */
async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Helper per query multiple righe
 * @param {string} text - Query SQL
 * @param {Array} params - Parametri
 * @returns {Promise<Array>}
 */
async function queryMany(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Verifica se tabella esiste
 * @param {string} tableName
 * @returns {Promise<boolean>}
 */
async function tableExists(tableName) {
  const result = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name = $1
    )
  `, [tableName]);
  
  return result.exists;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  initDatabase,
  ensureCoreSchema,
  getPool,
  query,
  queryOne,
  queryMany,
  getClient,
  closePool,
  transaction,
  tableExists
};
