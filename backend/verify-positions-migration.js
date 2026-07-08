/**
 * 🔍 VERIFICA MIGRAZIONE POSIZIONI - PostgreSQL
 * 
 * Controlla che tutte le posizioni dalla 1 alla 17.701 siano presenti in PostgreSQL
 * 
 * Eseguire con: node verify-positions-migration.js
 * 
 * @author Warp AI Agent
 * @date 6 Febbraio 2026
 */

require('dotenv').config();
const pg = require('./pg-connection-manager');

const POSIZIONE_MAX = 17701;

async function verifyPositions() {
  console.log('🔍 ========================================');
  console.log('   VERIFICA MIGRAZIONE POSIZIONI');
  console.log('========================================\n');
  
  try {
    await pg.initDatabase();
    const pool = pg.getPool();
    
    // 1. Conta totale posizioni in wallet_positions
    console.log('📊 1. Conteggio posizioni in wallet_positions...');
    const countResult = await pool.query('SELECT COUNT(*) as total FROM wallet_positions');
    const totalPositions = parseInt(countResult.rows[0].total);
    console.log(`   Posizioni trovate: ${totalPositions}`);
    console.log(`   Posizioni attese: ${POSIZIONE_MAX}`);
    
    if (totalPositions === POSIZIONE_MAX) {
      console.log('   ✅ Tutte le posizioni sono presenti!\n');
    } else {
      console.log(`   ⚠️  MANCANO ${POSIZIONE_MAX - totalPositions} posizioni!\n`);
    }
    
    // 2. Trova posizioni mancanti
    console.log('📊 2. Ricerca posizioni mancanti...');
    const missingQuery = `
      WITH expected AS (
        SELECT generate_series(1, ${POSIZIONE_MAX}) AS posizione
      )
      SELECT e.posizione
      FROM expected e
      LEFT JOIN wallet_positions wp ON wp.posizione = e.posizione
      WHERE wp.posizione IS NULL
      ORDER BY e.posizione
      LIMIT 100
    `;
    
    const missingResult = await pool.query(missingQuery);
    const missingPositions = missingResult.rows.map(r => r.posizione);
    
    if (missingPositions.length === 0) {
      console.log('   ✅ Nessuna posizione mancante!\n');
    } else {
      console.log(`   ❌ Prime ${missingPositions.length} posizioni mancanti:`);
      
      // Raggruppa range consecutivi
      const ranges = [];
      let rangeStart = missingPositions[0];
      let rangeEnd = missingPositions[0];
      
      for (let i = 1; i < missingPositions.length; i++) {
        if (missingPositions[i] === rangeEnd + 1) {
          rangeEnd = missingPositions[i];
        } else {
          ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
          rangeStart = missingPositions[i];
          rangeEnd = missingPositions[i];
        }
      }
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
      
      console.log(`   Range mancanti: ${ranges.join(', ')}`);
      console.log();
    }
    
    // 3. Verifica range posizioni
    console.log('📊 3. Range posizioni presenti...');
    const rangeResult = await pool.query(`
      SELECT 
        MIN(posizione) as min_pos,
        MAX(posizione) as max_pos,
        COUNT(DISTINCT posizione) as unique_count
      FROM wallet_positions
    `);
    
    const { min_pos, max_pos, unique_count } = rangeResult.rows[0];
    console.log(`   Min posizione: ${min_pos}`);
    console.log(`   Max posizione: ${max_pos}`);
    console.log(`   Posizioni uniche: ${unique_count}\n`);
    
    // 4. Verifica posizioni duplicate
    console.log('📊 4. Verifica duplicati...');
    const dupeResult = await pool.query(`
      SELECT posizione, COUNT(*) as count
      FROM wallet_positions
      GROUP BY posizione
      HAVING COUNT(*) > 1
      ORDER BY posizione
      LIMIT 20
    `);
    
    if (dupeResult.rows.length === 0) {
      console.log('   ✅ Nessuna posizione duplicata!\n');
    } else {
      console.log(`   ⚠️  ${dupeResult.rows.length} posizioni duplicate:`);
      for (const row of dupeResult.rows) {
        console.log(`   - Posizione ${row.posizione}: ${row.count} occorrenze`);
      }
      console.log();
    }
    
    // 5. Statistiche per movimento
    console.log('📊 5. Statistiche per movimento...');
    const movStats = await pool.query(`
      SELECT 
        movimento,
        COUNT(*) as total,
        MIN(posizione) as min_pos,
        MAX(posizione) as max_pos
      FROM wallet_positions
      GROUP BY movimento
      ORDER BY movimento
    `);
    
    for (const row of movStats.rows) {
      console.log(`   ${row.movimento || 'NULL'}: ${row.total} posizioni (${row.min_pos} - ${row.max_pos})`);
    }
    console.log();
    
    // 6. Verifica wallet speciali
    console.log('📊 6. Verifica wallet speciali (ROG, PILETTA, AVENGERS)...');
    const specialWallets = {
      ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
      PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe',
      AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972'
    };
    
    for (const [name, wallet] of Object.entries(specialWallets)) {
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM wallet_positions WHERE LOWER(wallet) = $1',
        [wallet.toLowerCase()]
      );
      console.log(`   ${name}: ${result.rows[0].count} posizioni`);
    }
    console.log();
    
    // 7. Conta posizioni mancanti totali
    const totalMissingQuery = `
      WITH expected AS (
        SELECT generate_series(1, ${POSIZIONE_MAX}) AS posizione
      )
      SELECT COUNT(*) as missing
      FROM expected e
      LEFT JOIN wallet_positions wp ON wp.posizione = e.posizione
      WHERE wp.posizione IS NULL
    `;
    
    const totalMissingResult = await pool.query(totalMissingQuery);
    const totalMissing = parseInt(totalMissingResult.rows[0].missing);
    
    console.log('========================================');
    console.log('   RIEPILOGO FINALE');
    console.log('========================================');
    console.log(`   Posizioni attese: ${POSIZIONE_MAX}`);
    console.log(`   Posizioni presenti: ${totalPositions}`);
    console.log(`   Posizioni mancanti: ${totalMissing}`);
    console.log(`   Completezza: ${((totalPositions / POSIZIONE_MAX) * 100).toFixed(2)}%`);
    
    if (totalMissing === 0) {
      console.log('\n   ✅ MIGRAZIONE COMPLETA AL 100%!');
    } else {
      console.log(`\n   ⚠️  MIGRAZIONE INCOMPLETA - Mancano ${totalMissing} posizioni`);
    }
    console.log('========================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Errore verifica:', error);
    process.exit(1);
  }
}

verifyPositions();
