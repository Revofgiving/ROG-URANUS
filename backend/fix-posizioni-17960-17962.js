/**
 * fix-posizioni-17960-17962.js
 * 
 * Corregge le posizioni 17960 e 17962 che sono state assegnate erroneamente
 * a Loretta Pivanti invece che al Nipote Pivanti (beneficiario).
 * 
 * Eseguire con: node fix-posizioni-17960-17962.js [--apply]
 */

require('dotenv').config();
const pg = require('./pg-connection-manager');

// Configurazione
const POSITIONS_TO_FIX = [17960, 17962];
const WRONG_WALLET = '0x0d224cf39761fc2d216f57f4d398b4eee07624bf'; // Loretta Pivanti (donor)
const CORRECT_WALLET = '0x49a52bdf0b85b39d1779637141271519d4fcfaca'; // Nipote Pivanti (beneficiario)
const CORRECT_NAME = 'Nipote Pivanti';

async function fixPositions() {
  const APPLY = process.argv.includes('--apply');
  
  console.log('\n🔧 FIX POSIZIONI BENEFICIARIO 17960-17962');
  console.log('==========================================');
  console.log(`Modalità: ${APPLY ? '🟢 APPLY (modifica DB)' : '🟡 DRY-RUN (preview)'}`);
  console.log(`\nWallet errato (donor): ${WRONG_WALLET}`);
  console.log(`Wallet corretto (beneficiario): ${CORRECT_WALLET}`);
  console.log(`Posizioni da correggere: ${POSITIONS_TO_FIX.join(', ')}\n`);

  try {
    const pool = pg.getPool();
    
    // 1. Verifica stato attuale
    console.log('📋 STATO ATTUALE:');
    for (const pos of POSITIONS_TO_FIX) {
      const result = await pool.query(
        'SELECT posizione, wallet, nome, movimento, molecola, ruolo FROM wallet_positions WHERE posizione = $1',
        [pos]
      );
      
      if (result.rows.length === 0) {
        console.log(`   ❌ Posizione ${pos}: NON TROVATA`);
        continue;
      }
      
      const row = result.rows[0];
      const isWrong = row.wallet.toLowerCase() === WRONG_WALLET.toLowerCase();
      console.log(`   ${isWrong ? '⚠️' : '✅'} Posizione ${pos}: wallet=${row.wallet.slice(0,10)}..., nome=${row.nome || 'N/A'}, molecola=${row.molecola}, ruolo=${row.ruolo}`);
    }
    
    if (!APPLY) {
      console.log('\n⚠️  DRY-RUN: Nessuna modifica applicata.');
      console.log('   Per applicare le modifiche, esegui: node fix-posizioni-17960-17962.js --apply\n');
      process.exit(0);
    }
    
    // 2. Applica correzioni
    console.log('\n🔄 APPLICAZIONE CORREZIONI:');
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const pos of POSITIONS_TO_FIX) {
        // Aggiorna wallet_positions
        const updateResult = await client.query(
          `UPDATE wallet_positions 
           SET wallet = $1, nome = $2, updated_at = NOW() 
           WHERE posizione = $3 AND wallet = $4
           RETURNING posizione, wallet, nome`,
          [CORRECT_WALLET, CORRECT_NAME, pos, WRONG_WALLET]
        );
        
        if (updateResult.rowCount > 0) {
          console.log(`   ✅ Posizione ${pos}: wallet aggiornato a ${CORRECT_WALLET.slice(0,10)}...`);
        } else {
          console.log(`   ⚠️  Posizione ${pos}: nessuna modifica (già corretto o non trovato)`);
        }
      }
      
      // 3. Aggiorna anche anagrafica_invitati se necessario
      // Il referrer (invitante) per queste posizioni dovrebbe essere Loretta
      try {
        const invitatiResult = await client.query(
          `UPDATE anagrafica_invitati 
           SET invitato_wallet = $1, invitato_nome = $2, updated_at = NOW()
           WHERE invitato_wallet = $3 AND posizione IN (${POSITIONS_TO_FIX.join(',')})
           RETURNING posizione`,
          [CORRECT_WALLET, CORRECT_NAME, WRONG_WALLET]
        );
        
        if (invitatiResult.rowCount > 0) {
          console.log(`   ✅ anagrafica_invitati: ${invitatiResult.rowCount} record aggiornati`);
        }
      } catch (err) {
        console.log(`   ⚠️  anagrafica_invitati: ${err.message}`);
      }
      
      await client.query('COMMIT');
      console.log('\n✅ CORREZIONI APPLICATE CON SUCCESSO!\n');
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\n❌ ERRORE - ROLLBACK ESEGUITO:', err.message);
      throw err;
    } finally {
      client.release();
    }
    
    // 4. Verifica finale
    console.log('📋 STATO FINALE:');
    for (const pos of POSITIONS_TO_FIX) {
      const result = await pool.query(
        'SELECT posizione, wallet, nome, movimento, molecola, ruolo FROM wallet_positions WHERE posizione = $1',
        [pos]
      );
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const isCorrect = row.wallet.toLowerCase() === CORRECT_WALLET.toLowerCase();
        console.log(`   ${isCorrect ? '✅' : '❌'} Posizione ${pos}: wallet=${row.wallet.slice(0,10)}..., nome=${row.nome || 'N/A'}`);
      }
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Errore:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

fixPositions();
