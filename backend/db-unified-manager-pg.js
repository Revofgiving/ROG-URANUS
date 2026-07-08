/**
 * 🔗 ROG UNIFIED DATABASE MANAGER - PostgreSQL Version
 * 
 * Modulo centrale di integrazione con PostgreSQL su Coolify
 * Sostituisce SQLite per produzione
 * 
 * @version 2.0.0 - PostgreSQL Migration
 * @author Warp AI Agent
 */

const pg = require('./pg-connection-manager');

// Flag globale: se le tabelle posizioni_small/medium/large non sono
// allineate allo schema atteso (es. manca la colonna "posizione"),
// disabilitiamo le scritture verso di esse ma continuiamo ad usare
// wallet_positions + wallet_master come fonte di verità.
let movementTablesWriteEnabled = true;

// ========================================
// WALLET QUERIES
// ========================================

/**
 * Ottiene info complete wallet dal MASTER
 * @param {string} walletAddress - Indirizzo wallet (0x...)
 * @returns {Object|null} Wallet info o null se non trovato
 */
async function getWallet(walletAddress) {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT * FROM wallet_master
    WHERE wallet = $1
  `, [walletAddress.toLowerCase()]);
  
  return result.rows[0] || null;
}

/**
 * Ottiene tutte le posizioni di un wallet
 * @param {string} walletAddress
 * @returns {Array} Array di posizioni
 */
async function getWalletPositions(walletAddress) {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT * FROM wallet_positions
    WHERE wallet = $1
    ORDER BY posizione DESC
  `, [walletAddress.toLowerCase()]);
  
  return result.rows;
}

/**
 * Ottiene statistiche wallet (con stelline e accumuli)
 * @param {string} walletAddress
 * @returns {Object|null}
 */
async function getWalletStats(walletAddress) {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT * FROM v_wallet_stats
    WHERE wallet = $1
  `, [walletAddress.toLowerCase()]);
  
  return result.rows[0] || null;
}

/**
 * Verifica se un wallet esiste nel sistema
 * @param {string} walletAddress
 * @returns {boolean}
 */
async function walletExists(walletAddress) {
  const wallet = await getWallet(walletAddress);
  return wallet !== null;
}

// ========================================
// POSITION QUERIES
// ========================================

/**
 * Ottiene dettagli di una posizione specifica
 * @param {number} posizioneNumero
 * @returns {Object|null}
 */
async function getPosition(posizioneNumero) {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT 
      wp.*,
      wm.nome,
      wm.tipo
    FROM wallet_positions wp
    JOIN wallet_master wm ON wp.wallet = wm.wallet
    WHERE wp.posizione = $1
  `, [posizioneNumero]);
  
  return result.rows[0] || null;
}

/**
 * Ottiene dettagli di MULTIPLE posizioni in una singola query (batch).
 * Questo evita il problema N+1 quando si devono recuperare molte posizioni.
 * 
 * @param {Array<number>} posizioniNumeri - Array di numeri posizione
 * @returns {Map<number, Object>} Map con chiave=posizione, valore=oggetto posizione
 */
async function getPositionsBatch(posizioniNumeri) {
  if (!Array.isArray(posizioniNumeri) || posizioniNumeri.length === 0) {
    return new Map();
  }
  
  const pool = pg.getPool();
  
  // Crea array di placeholder $1, $2, $3, ecc.
  const placeholders = posizioniNumeri.map((_, i) => `$${i + 1}`).join(', ');
  
  const result = await pool.query(`
    SELECT 
      wp.*,
      wm.nome,
      wm.tipo
    FROM wallet_positions wp
    JOIN wallet_master wm ON wp.wallet = wm.wallet
    WHERE wp.posizione IN (${placeholders})
  `, posizioniNumeri);
  
  // Costruisci Map per lookup O(1)
  const map = new Map();
  for (const row of result.rows) {
    map.set(Number(row.posizione), row);
  }
  
  return map;
}

/**
 * Ottiene tutte le posizioni di una molecola
 * @param {number} molecolaNumero
 * @param {string} movimento - 'SMALL', 'MEDIUM', o 'LARGE'
 * @returns {Array}
 */
async function getMolecola(molecolaNumero, movimento) {
  const pool = pg.getPool();

  // Primo tentativo: stessi criteri di movimento della posizione di partenza
  let result = await pool.query(`
    SELECT 
      wp.*,
      wm.nome,
      wm.tipo
    FROM wallet_positions wp
    JOIN wallet_master wm ON wp.wallet = wm.wallet
    WHERE wp.molecola = $1
      AND wp.movimento = $2
    ORDER BY wp.posizione_in_molecola
  `, [molecolaNumero, String(movimento || '').toUpperCase()]);

  // Se non troviamo alcuna posizione O troviamo meno di 7 posizioni,
  // facciamo un secondo tentativo senza filtrare per movimento.
  // In questo modo, se alcuni slot della molecola hanno un movimento
  // diverso o un valore legacy, li vediamo comunque tutti.
  if (!result.rows || result.rows.length < 7) {
    result = await pool.query(`
      SELECT 
        wp.*,
        wm.nome,
        wm.tipo
      FROM wallet_positions wp
      JOIN wallet_master wm ON wp.wallet = wm.wallet
      WHERE wp.molecola = $1
      ORDER BY wp.posizione_in_molecola
    `, [molecolaNumero]);
  }

  return result.rows;
}

/**
 * Ottiene ultima posizione nel sistema
 * @returns {number}
 */
async function getUltimaPosizione() {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT MAX(posizione) as ultima FROM wallet_positions
  `);
  
  return result.rows[0] ? result.rows[0].ultima : 0;
}

// ========================================
// MOVEMENT QUERIES
// ========================================

/**
 * Ottiene statistiche per movimento (SMALL/MEDIUM/LARGE)
 * @param {string} movimento
 * @returns {Object}
 */
async function getMovimentoStats(movimento) {
  const pool = pg.getPool();
  const tableName = `posizioni_${movimento.toLowerCase()}`;
  
  const totalPositions = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
  const uniqueWallets = await pool.query(`SELECT COUNT(DISTINCT wallet) as count FROM ${tableName}`);
  const byType = await pool.query(`
    SELECT tipo, COUNT(*) as count FROM ${tableName} GROUP BY tipo ORDER BY count DESC
  `);
  
  return {
    movimento: movimento.toUpperCase(),
    total_positions: parseInt(totalPositions.rows[0].count),
    unique_wallets: parseInt(uniqueWallets.rows[0].count),
    by_type: byType.rows
  };
}

/**
 * Ottiene statistiche generali sistema
 * @returns {Object}
 */
async function getSystemStats() {
  const pool = pg.getPool();
  
  const totalWallets = await pool.query(`SELECT COUNT(*) as count FROM wallet_master`);
  // Usiamo COUNT(DISTINCT posizione) per avere il numero di posizioni numeriche effettive (1..N)
  const totalPositions = await pool.query(`SELECT COUNT(DISTINCT posizione) as count FROM wallet_positions`);
  const byMovement = await pool.query(`SELECT * FROM v_posizioni_attive_per_movimento`);
  const byType = await pool.query(`
    SELECT tipo, COUNT(*) as num_wallet, SUM(totale_posizioni) as tot_posizioni
    FROM wallet_master GROUP BY tipo ORDER BY tot_posizioni DESC
  `);
  
  return {
    total_wallets: parseInt(totalWallets.rows[0].count),
    total_positions: parseInt(totalPositions.rows[0].count),
    by_movement: byMovement.rows,
    by_type: byType.rows
  };
}

// ========================================
// SEARCH
// ========================================

/**
 * Ricerca wallet per nome o indirizzo
 * @param {string} query - Stringa di ricerca (min 3 caratteri)
 * @returns {Array}
 */
async function searchWallets(query) {
  if (!query || query.length < 3) {
    return [];
  }
  
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT wallet, nome, tipo, movimento_corrente, totale_posizioni
    FROM wallet_master
    WHERE LOWER(nome) LIKE $1 OR LOWER(wallet) LIKE $2
    ORDER BY totale_posizioni DESC
    LIMIT 20
  `, [`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`]);
  
  return result.rows;
}

// ========================================
// SPECIAL ENTITIES
// ========================================

/**
 * Ottiene info entità speciali (ROG, PILETTA, AVENGERS)
 * @returns {Array}
 */
async function getSpecialEntities() {
  const pool = pg.getPool();
  
  const result = await pool.query(`
    SELECT * FROM wallet_master
    WHERE tipo IN ('ROG', 'PILETTA', 'AVENGERS')
  `);
  
  return result.rows;
}

/**
 * Wallet address delle entità speciali
 */
const SPECIAL_WALLETS = {
  ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
  PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe',
  AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972'
};

// ========================================
// WRITE OPERATIONS
// ========================================

/**
 * Inserisce una riga nella tabella di movimento (posizioni_small/medium/large)
 * ma non blocca la transazione principale delle donazioni.
 *
 * IMPORTANTE: usa una connessione autonoma (pg.query) e NON il client
 * passato alla transazione di creazione posizioni, così eventuali errori
 * di schema su posizioni_small/medium/large non mandano in ABORT la
 * transazione che gestisce wallet_master + wallet_positions.
 */
async function safeInsertMovementPosition(movimentoUpper, data) {
  if (!movementTablesWriteEnabled) {
    return;
  }

  const tableName = `posizioni_${movimentoUpper.toLowerCase()}`;

  try {
    await pg.query(`
      INSERT INTO ${tableName}
      (posizione, nome, wallet, tipo, molecola, generazione, ruolo, posizione_in_molecola)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      data.posizione,
      data.nome,
      data.walletLower,
      data.tipo,
      data.molecola,
      data.generazione,
      data.ruolo,
      data.posizione_in_molecola
    ]);
  } catch (error) {
    const msg = (error && error.message) || '';

    // Se la tabella o la colonna "posizione" non esistono, logghiamo
    // un warning e continuiamo usando solo wallet_positions/wallet_master.
    if (
      msg.includes('does not exist') ||
      msg.includes('undefined column') ||
      (msg.includes('column') && msg.includes('posizione'))
    ) {
      console.warn(
        `⚠️  Scrittura su ${tableName} disabilitata (schema non allineato, manca probabilmente la colonna "posizione"). ` +
        'La fonte di verità rimane wallet_positions + wallet_master. Dettagli errore:',
        msg
      );
      movementTablesWriteEnabled = false;
      return;
    }

    // Per altri errori propaghiamo l'eccezione.
    throw error;
  }
}

/**
 * Crea nuova posizione nel database appropriato
 * @param {Object} positionData
 * @returns {Object} Created position
 */
async function createPositionTx(client, positionData) {
  const {
    posizione,
    wallet,
    nome,
    tipo,
    movimento, // 'SMALL', 'MEDIUM', 'LARGE'
    molecola,
    generazione,
    ruolo,
    posizione_in_molecola
  } = positionData;

  const walletLower = wallet.toLowerCase();
  const movimentoUpper = movimento.toUpperCase();

  // 1) Inserisci in database movimento specifico (best effort, fuori
  // dalla transazione principale delle donazioni)
  await safeInsertMovementPosition(movimentoUpper, {
    posizione,
    walletLower,
    nome,
    tipo,
    molecola,
    generazione,
    ruolo,
    posizione_in_molecola
  });

  // 2) wallet_master
  const existingWallet = await client.query(
    'SELECT 1 FROM wallet_master WHERE wallet = $1',
    [walletLower]
  );

  if (existingWallet.rows.length === 0) {
    await client.query(`
      INSERT INTO wallet_master
      (wallet, nome, tipo, movimento_corrente, totale_posizioni,
       posizioni_small, posizioni_medium, posizioni_large,
       prima_posizione, ultima_posizione)
      VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9)
    `, [
      walletLower,
      nome,
      tipo,
      movimentoUpper,
      movimentoUpper === 'SMALL' ? 1 : 0,
      movimentoUpper === 'MEDIUM' ? 1 : 0,
      movimentoUpper === 'LARGE' ? 1 : 0,
      posizione,
      posizione
    ]);
  } else {
    await client.query(`
      UPDATE wallet_master
      SET totale_posizioni = totale_posizioni + 1,
          posizioni_small = posizioni_small + $1,
          posizioni_medium = posizioni_medium + $2,
          posizioni_large = posizioni_large + $3,
          ultima_posizione = GREATEST(ultima_posizione, $4)
      WHERE wallet = $5
    `, [
      movimentoUpper === 'SMALL' ? 1 : 0,
      movimentoUpper === 'MEDIUM' ? 1 : 0,
      movimentoUpper === 'LARGE' ? 1 : 0,
      posizione,
      walletLower
    ]);
  }

  // 3) wallet_positions (MASTER)
  await client.query(`
    INSERT INTO wallet_positions
    (wallet, posizione, movimento, molecola, generazione, ruolo, posizione_in_molecola)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [walletLower, posizione, movimentoUpper, molecola, generazione, ruolo, posizione_in_molecola]);

  return { success: true, posizione, wallet: walletLower, movimento: movimentoUpper };
}

async function createPosition(positionData) {
  const pool = pg.getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const out = await createPositionTx(client, positionData);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Errore createPosition:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Aggiorna accumuli wallet
 * @param {string} walletAddress
 * @param {string} tipo - 'SMALL' o 'MEDIUM'
 * @param {number} importo
 */
// ========================================
// DONATIONS (SOURCE OF TRUTH / IDEMPOTENZA)
// ========================================

function normalizeTxHash(txHash) {
  return String(txHash || '').trim().toLowerCase();
}

async function getDonationByTxLog(txHash, logIndex = 0) {
  const pool = pg.getPool();
  const tx = normalizeTxHash(txHash);
  const li = Number.isFinite(Number(logIndex)) ? Number(logIndex) : 0;

  const res = await pool.query(
    'SELECT * FROM donations WHERE tx_hash = $1 AND log_index = $2 LIMIT 1',
    [tx, li]
  );

  return res.rows[0] || null;
}

/**
 * Ritorna QUALSIASI donazione associata a una certa tx_hash,
 * indipendentemente dal log_index. Serve per idempotenza forte
 * quando flussi diversi usano log_index diversi per la stessa tx.
 */
async function getAnyDonationByTx(txHash) {
  const pool = pg.getPool();
  const tx = normalizeTxHash(txHash);

  const res = await pool.query(
    'SELECT * FROM donations WHERE tx_hash = $1 ORDER BY log_index ASC LIMIT 1',
    [tx]
  );

  return res.rows[0] || null;
}

/**
 * Verifica se un wallet ha una donazione "qualificante" (>= minUsdc USDC)
 * con data (ts, fallback updated_at) a partire da sinceISO.
 * Usato dal gate URANUS: vale SOLO una donazione ROG dall'8 giugno 2026 in poi.
 */
async function hasDonationSince(walletAddress, sinceISO, minUsdc = 2) {
  const pool = pg.getPool();

  const res = await pool.query(`
    SELECT MAX(COALESCE(ts, updated_at)) AS last_donation, COUNT(*)::int AS cnt
    FROM donations
    WHERE donor_wallet = $1
      AND amount_usdc >= $2
      AND COALESCE(ts, updated_at) >= $3
  `, [String(walletAddress || '').toLowerCase(), Number(minUsdc), sinceISO]);

  const row = res.rows[0] || {};
  const count = Number(row.cnt) || 0;
  return {
    qualifies: count > 0,
    count,
    lastDonationDate: row.last_donation ? new Date(row.last_donation).toISOString() : null,
  };
}

async function upsertDonationRecord(record) {
  const pool = pg.getPool();

  const tx = normalizeTxHash(record.txHash);
  const logIndex = Number.isFinite(Number(record.logIndex)) ? Number(record.logIndex) : 0;

  const donor = String(record.donor || '').toLowerCase();
  const beneficiary = record.beneficiaryWallet ? String(record.beneficiaryWallet).toLowerCase() : null;

  const donationType = String(record.donationType || 'standard').toLowerCase();

  const payload = record.payload ?? null;

  const q = `
    INSERT INTO donations
      (donation_id, tx_hash, log_index, donor_wallet, beneficiary_wallet, donation_type,
       amount_usdc, ts, positions_created, first_position, last_position, payload, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
    ON CONFLICT (tx_hash, log_index) DO UPDATE
      SET payload = COALESCE(donations.payload, EXCLUDED.payload),
          positions_created = COALESCE(donations.positions_created, EXCLUDED.positions_created),
          first_position = COALESCE(donations.first_position, EXCLUDED.first_position),
          last_position = COALESCE(donations.last_position, EXCLUDED.last_position),
          beneficiary_wallet = COALESCE(donations.beneficiary_wallet, EXCLUDED.beneficiary_wallet),
          donation_type = COALESCE(donations.donation_type, EXCLUDED.donation_type),
          amount_usdc = COALESCE(donations.amount_usdc, EXCLUDED.amount_usdc),
          ts = COALESCE(donations.ts, EXCLUDED.ts),
          updated_at = NOW()
    RETURNING *;
  `;

  const res = await pool.query(q, [
    record.donationId ? String(record.donationId) : null,
    tx,
    logIndex,
    donor,
    beneficiary,
    donationType,
    Number(record.amountUSDC),
    record.timestamp ? new Date(record.timestamp).toISOString() : null,
    record.positionsCreated ?? null,
    record.firstPosition ?? null,
    record.lastPosition ?? null,
    payload
  ]);

  return res.rows[0] || null;
}

async function updateAccumulo(walletAddress, tipo, importo) {
  const pool = pg.getPool();
  const field = tipo === 'SMALL' ? 'accumulo_small' : 'accumulo_medium';
  
  await pool.query(`
    UPDATE wallet_master
    SET ${field} = ${field} + $1
    WHERE wallet = $2
  `, [importo, walletAddress.toLowerCase()]);
}

/**
 * Aggiorna stelline wallet
 * @param {string} walletAddress
 * @param {string} colore - 'rosse', 'verdi', 'blu'
 * @param {number} numero
 */
async function updateStelline(walletAddress, colore, numero) {
  const pool = pg.getPool();
  const field = `stelline_${colore}`;
  
  await pool.query(`
    UPDATE wallet_master
    SET ${field} = $1
    WHERE wallet = $2
  `, [numero, walletAddress.toLowerCase()]);
}

// ========================================
// COMPATIBILITY STUBS
// ========================================

/**
 * Init/Close functions for compatibility with SQLite version
 */
function initDatabases() {
  // PostgreSQL pool is initialized in pg-connection-manager
  console.log('✅ Database manager (PostgreSQL) pronto');
}

function closeDatabases() {
  // PostgreSQL pool is closed in pg-connection-manager
  console.log('✅ Database manager (PostgreSQL) chiuso');
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Init/Close
  initDatabases,
  closeDatabases,
  
  // Wallet queries
  getWallet,
  getWalletPositions,
  getWalletStats,
  walletExists,
  
  // Position queries
  getPosition,
  getPositionsBatch,
  getMolecola,
  getUltimaPosizione,
  
  // Movement queries
  getMovimentoStats,
  getSystemStats,
  
  // Search
  searchWallets,
  
  // Special entities
  getSpecialEntities,
  SPECIAL_WALLETS,
  
  // Write operations
  createPosition,
  createPositionTx,
  updateAccumulo,
  updateStelline,

  // Donations
  getDonationByTxLog,
  getAnyDonationByTx,
  upsertDonationRecord,
  hasDonationSince
};
