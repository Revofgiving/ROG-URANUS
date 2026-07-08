/**
 * 💾 STATE PERSISTENCE - PostgreSQL
 * 
 * Sostituisce i file JSON locali con storage in PostgreSQL.
 * Questo garantisce persistenza su Coolify (che resetta filesystem ad ogni deploy).
 * 
 * TABELLA: system_state (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP)
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 7 Febbraio 2026
 */

const pg = require('./pg-connection-manager');

let initialized = false;

/**
 * Inizializza tabella system_state se non esiste
 */
async function init() {
  if (initialized) return;

  try {
    await pg.initDatabase();

    // Crea tabella system_state per persistenza stati
    await pg.query(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    initialized = true;
    console.log('💾 State Persistence (PostgreSQL) inizializzato');
  } catch (err) {
    console.error('❌ Errore init state-persistence-pg:', err.message || err);
    throw err;
  }
}

/**
 * Legge uno stato dal database
 * @param {string} key - Chiave stato (es. 'blacklist', 'zkkyc', 'voting')
 * @param {Object} defaultValue - Valore di default se non esiste
 * @returns {Promise<Object>} Stato salvato o default
 */
async function getState(key, defaultValue = {}) {
  await init();

  try {
    const row = await pg.queryOne(
      'SELECT value FROM system_state WHERE key = $1',
      [key]
    );

    if (row && row.value) {
      return row.value;
    }

    // Se non esiste, salva il default e ritornalo
    await setState(key, defaultValue);
    return defaultValue;
  } catch (err) {
    console.error(`❌ Errore lettura stato '${key}':`, err.message || err);
    return defaultValue;
  }
}

/**
 * Salva uno stato nel database
 * @param {string} key - Chiave stato
 * @param {Object} value - Valore da salvare (serializzabile in JSON)
 * @returns {Promise<boolean>} true se salvato con successo
 */
async function setState(key, value) {
  await init();

  try {
    await pg.query(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `, [key, JSON.stringify(value)]);

    return true;
  } catch (err) {
    console.error(`❌ Errore salvataggio stato '${key}':`, err.message || err);
    return false;
  }
}

/**
 * Aggiorna parzialmente uno stato (merge)
 * @param {string} key - Chiave stato
 * @param {Object} partialValue - Campi da aggiornare
 * @returns {Promise<Object>} Stato aggiornato
 */
async function updateState(key, partialValue) {
  const current = await getState(key, {});
  const updated = { ...current, ...partialValue };
  await setState(key, updated);
  return updated;
}

/**
 * Elimina uno stato
 * @param {string} key - Chiave stato
 */
async function deleteState(key) {
  await init();

  try {
    await pg.query('DELETE FROM system_state WHERE key = $1', [key]);
    return true;
  } catch (err) {
    console.error(`❌ Errore eliminazione stato '${key}':`, err.message || err);
    return false;
  }
}

/**
 * Lista tutte le chiavi di stato salvate
 * @returns {Promise<string[]>} Array di chiavi
 */
async function listStateKeys() {
  await init();

  try {
    const rows = await pg.queryMany('SELECT key FROM system_state ORDER BY key');
    return rows.map(r => r.key);
  } catch (err) {
    console.error('❌ Errore lista stati:', err.message || err);
    return [];
  }
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  init,
  getState,
  setState,
  updateState,
  deleteState,
  listStateKeys
};
