/**
 * 🚀 COMMUNITY REGISTRATION MANAGER - PostgreSQL Unificato
 * 
 * Gestisce registrazioni community ROG con PostgreSQL
 * scalabile a milioni di utenti
 * 
 * Features:
 * - PostgreSQL come fonte primaria
 * - Sincronizzazione automatica da anagrafica_positions, wallet_master, donations
 * - Alta concorrenza (50+ connessioni)
 * - Deduplica automatica
 * - Performance ottimali
 * 
 * @author Warp AI Agent
 * @date 17 Gennaio 2026
 */

const pgConnectionManager = require('./pg-connection-manager');

// ========================================
// UTILITIES
// ========================================

function normalizeWallet(wallet) {
  return String(wallet || '').trim().toLowerCase();
}

function isValidWallet(wallet) {
  const normalized = normalizeWallet(wallet);
  return /^0x[a-f0-9]{40}$/.test(normalized);
}

// ========================================
// REGISTRAZIONE COMMUNITY
// ========================================

/**
 * Registra un wallet nella community
 * @param {string} walletAddress - Indirizzo wallet da registrare
 * @param {string} [referrerWallet] - Wallet referrer (opzionale)
 * @param {Object} [metadata] - Dati aggiuntivi (opzionale)
 * @returns {Promise<Object>} Risultato registrazione
 */
async function registerWallet(walletAddress, referrerWallet = null, metadata = {}) {
  const wallet = normalizeWallet(walletAddress);
  
  // Validazione
  if (!isValidWallet(wallet)) {
    return {
      success: false,
      error: 'Wallet address non valido',
      wallet: walletAddress
    };
  }

  // Referrer validation (se presente)
  if (referrerWallet && !isValidWallet(referrerWallet)) {
    return {
      success: false,
      error: 'Wallet referrer non valido',
      wallet: walletAddress,
      referrer: referrerWallet
    };
  }

  try {
    // Insert con ON CONFLICT per gestire duplicati
    const result = await pgConnectionManager.query(`
      INSERT INTO community_registrations (
        wallet_address, 
        referrer_wallet, 
        metadata
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (LOWER(wallet_address)) DO NOTHING
      RETURNING id, wallet_address, registered_at
    `, [
      wallet,
      referrerWallet ? normalizeWallet(referrerWallet) : null,
      JSON.stringify(metadata)
    ]);

    // Se non ci sono righe restituite, il wallet era già registrato
    if (result.rows.length === 0) {
      return {
        success: true,
        alreadyRegistered: true,
        wallet: wallet
      };
    }

    // Registrazione nuova
    return {
      success: true,
      alreadyRegistered: false,
      wallet: wallet,
      id: result.rows[0].id,
      registered_at: result.rows[0].registered_at
    };

  } catch (error) {
    console.error('[CommunityPG] Errore registrazione:', error);
    return {
      success: false,
      error: 'Errore durante registrazione',
      errorMessage: error.message
    };
  }
}

// ========================================
// VERIFICA REGISTRAZIONE
// ========================================

/**
 * Verifica se un wallet è registrato
 * @param {string} walletAddress - Wallet da verificare
 * @returns {Promise<Object>} Stato registrazione
 */
async function isWalletRegistered(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  
  if (!isValidWallet(wallet)) {
    return {
      registered: false,
      error: 'Wallet non valido'
    };
  }

  try {
    const result = await pgConnectionManager.queryOne(`
      SELECT id, wallet_address, registered_at, referrer_wallet
      FROM community_registrations
      WHERE LOWER(wallet_address) = LOWER($1)
    `, [wallet]);

    if (!result) {
      return {
        registered: false,
        wallet: wallet
      };
    }

    return {
      registered: true,
      wallet: wallet,
      id: result.id,
      registered_at: result.registered_at,
      referrer_wallet: result.referrer_wallet
    };

  } catch (error) {
    console.error('[CommunityPG] Errore verifica:', error);
    return {
      registered: false,
      error: 'Errore durante verifica'
    };
  }
}

// ========================================
// STATISTICHE COMMUNITY
// ========================================

/**
 * Ottiene conteggio registrazioni community
 * @returns {Promise<number>} Numero registrazioni
 */
async function getRegistrationsCount() {
  try {
    const result = await pgConnectionManager.queryOne(`
      SELECT COUNT(*) as count 
      FROM community_registrations
    `);
    
    return parseInt(result.count) || 0;
  } catch (error) {
    console.error('[CommunityPG] Errore conteggio:', error);
    return 0;
  }
}

/**
 * Ottiene elenco registrazioni con paginazione
 * @param {number} [limit=100] - Numero massimo risultati
 * @param {number} [offset=0] - Offset per paginazione
 * @param {string} [orderBy='registered_at'] - Campo ordinamento
 * @param {string} [orderDir='DESC'] - Direzione ordinamento
 * @returns {Promise<Array>} Lista registrazioni
 */
async function getRegistrations(limit = 100, offset = 0, orderBy = 'registered_at', orderDir = 'DESC') {
  try {
    // Validazione parametri
    const validOrderBy = ['registered_at', 'wallet_address', 'id'].includes(orderBy) ? orderBy : 'registered_at';
    const validOrderDir = ['ASC', 'DESC'].includes(orderDir.toUpperCase()) ? orderDir.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000); // Max 1000
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const result = await pgConnectionManager.queryMany(`
      SELECT 
        id,
        wallet_address,
        registered_at,
        referrer_wallet,
        metadata
      FROM community_registrations
      ORDER BY ${validOrderBy} ${validOrderDir}
      LIMIT $1 OFFSET $2
    `, [safeLimit, safeOffset]);

    return result;
  } catch (error) {
    console.error('[CommunityPG] Errore list:', error);
    return [];
  }
}

/**
 * Ottiene statistiche avanzate community
 * @returns {Promise<Object>} Statistiche
 */
async function getStatistics() {
  try {
    // Conteggio totale
    const total = await getRegistrationsCount();

    // Registrazioni per giorno (ultimi 7 giorni)
    const dailyStats = await pgConnectionManager.queryMany(`
      SELECT 
        DATE(registered_at) as date,
        COUNT(*) as count
      FROM community_registrations
      WHERE registered_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(registered_at)
      ORDER BY date DESC
    `);

    // Registrazioni con referrer
    const withReferrer = await pgConnectionManager.queryOne(`
      SELECT COUNT(*) as count
      FROM community_registrations
      WHERE referrer_wallet IS NOT NULL
    `);

    // Top referrer
    const topReferrers = await pgConnectionManager.queryMany(`
      SELECT 
        referrer_wallet,
        COUNT(*) as referrals_count
      FROM community_registrations
      WHERE referrer_wallet IS NOT NULL
      GROUP BY referrer_wallet
      ORDER BY referrals_count DESC
      LIMIT 10
    `);

    return {
      total_registrations: total,
      with_referrer: parseInt(withReferrer.count) || 0,
      daily_stats: dailyStats,
      top_referrers: topReferrers
    };

  } catch (error) {
    console.error('[CommunityPG] Errore statistics:', error);
    return {
      total_registrations: 0,
      with_referrer: 0,
      daily_stats: [],
      top_referrers: []
    };
  }
}

// ========================================
// BULK OPERATIONS (per migrazioni)
// ========================================

/**
 * Registra multipli wallet in batch (ottimizzato)
 * @param {Array<Object>} wallets - Array di {wallet, referrer, metadata}
 * @returns {Promise<Object>} Risultato batch
 */
async function registerBatch(wallets) {
  if (!Array.isArray(wallets) || wallets.length === 0) {
    return { success: true, inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // Batch insert ottimizzato (gruppi di 100)
  const batchSize = 100;
  
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    
    try {
      // Costruisci values dinamicamente
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const w of batch) {
        const wallet = normalizeWallet(w.wallet || w.walletAddress);
        if (!isValidWallet(wallet)) {
          skipped++;
          continue;
        }

        const referrer = w.referrer || w.referrerWallet || null;
        const metadata = w.metadata || {};

        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
        params.push(wallet);
        params.push(referrer ? normalizeWallet(referrer) : null);
        params.push(JSON.stringify(metadata));
        paramIndex += 3;
      }

      if (values.length === 0) continue;

      const query = `
        INSERT INTO community_registrations (wallet_address, referrer_wallet, metadata)
        VALUES ${values.join(', ')}
        ON CONFLICT (LOWER(wallet_address)) DO NOTHING
      `;

      await pgConnectionManager.query(query, params);
      inserted += values.length;

    } catch (error) {
      console.error('[CommunityPG] Errore batch insert:', error);
      skipped += batch.length;
    }
  }

  return {
    success: true,
    inserted,
    skipped,
    total: wallets.length
  };
}

// ========================================
// SINCRONIZZAZIONE DA POSTGRESQL
// ========================================

/**
 * Sincronizza community_registrations da tutte le fonti PostgreSQL
 * @returns {Promise<Object>} Risultato sincronizzazione
 */
async function sincronizzaConAnagrafica() {
  console.log('\n🔄 SINCRONIZZAZIONE COMMUNITY da POSTGRESQL');
  
  try {
    const walletsSet = new Set();
    const sources = { anagrafica: 0, wallet_master: 0, donations: 0 };
    
    // 1. Estrai da anagrafica_positions
    try {
      const exists = await pgConnectionManager.tableExists('anagrafica_positions');
      if (exists) {
        const result = await pgConnectionManager.queryMany(`
          SELECT DISTINCT LOWER(wallet_address) as wallet
          FROM anagrafica_positions
          WHERE LOWER(tipo) = 'human'
            AND wallet_address IS NOT NULL
            AND wallet_address != ''
        `);
        result.forEach(r => walletsSet.add(normalizeWallet(r.wallet)));
        sources.anagrafica = result.length;
      }
    } catch (err) {
      console.warn('  ⚠️  Errore anagrafica_positions:', err.message);
    }
    
    // 2. Estrai da wallet_master
    try {
      const exists = await pgConnectionManager.tableExists('wallet_master');
      if (exists) {
        const result = await pgConnectionManager.queryMany(`
          SELECT DISTINCT LOWER(wallet) as wallet
          FROM wallet_master
          WHERE LOWER(tipo) = 'human'
            AND wallet IS NOT NULL
            AND wallet != ''
        `);
        result.forEach(r => walletsSet.add(normalizeWallet(r.wallet)));
        sources.wallet_master = result.length;
      }
    } catch (err) {
      console.warn('  ⚠️  Errore wallet_master:', err.message);
    }
    
    // 3. Estrai da donations
    try {
      const exists = await pgConnectionManager.tableExists('donations');
      if (exists) {
        const result = await pgConnectionManager.queryMany(`
          SELECT DISTINCT LOWER(donor_wallet) as wallet
          FROM donations
          WHERE donor_wallet IS NOT NULL
            AND donor_wallet != ''
        `);
        result.forEach(r => walletsSet.add(normalizeWallet(r.wallet)));
        sources.donations = result.length;
      }
    } catch (err) {
      console.warn('  ⚠️  Errore donations:', err.message);
    }
    
    const uniqueWallets = Array.from(walletsSet).filter(w => isValidWallet(w));
    
    console.log(`  📊 Wallet unici trovati: ${uniqueWallets.length}`);
    console.log(`  📊 Fonti: anagrafica=${sources.anagrafica}, wallet_master=${sources.wallet_master}, donations=${sources.donations}`);
    
    // 4. Batch insert
    const result = await registerBatch(
      uniqueWallets.map(w => ({ wallet: w }))
    );
    
    console.log(`  ✅ Sincronizzazione completata`);
    console.log(`     Inseriti: ${result.inserted}`);
    console.log(`     Skipped: ${result.skipped}`);
    
    return {
      success: true,
      walletsPostgres: uniqueWallets.length,
      walletsAggiunti: result.inserted,
      walletsSkipped: result.skipped,
      sources
    };
    
  } catch (error) {
    console.error('  ❌ Errore sincronizzazione:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  registerWallet,
  isWalletRegistered,
  getRegistrationsCount,
  getRegistrations,
  getStatistics,
  registerBatch,
  sincronizzaConAnagrafica,
  
  // Utilities
  normalizeWallet,
  isValidWallet
};
