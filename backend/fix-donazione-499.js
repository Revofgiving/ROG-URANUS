/**
 * 🔧 FIX DONAZIONE #499 - 20 USDC del 17 maggio 2026
 * 
 * Problema: la donazione è fallita per gas price troppo basso
 *           durante completeDonation() on-chain.
 *           Posizioni MAI create (positions_created = 0).
 * 
 * Soluzione: 
 *   1. Resetta il record fallito nel DB
 *   2. Ri-processa la donazione con minting simulato
 *   3. Crea le 10 coppie HUMAN+PILETTA (20 posizioni)
 * 
 * Uso: DATABASE_PUBLIC_URL="postgresql://..." node fix-donazione-499.js
 */

require('dotenv').config();

const DONATION_ID = '499';
const TX_HASH = '0xbaddb3749f0b3f6b921e1b0f76fbbde3ac47f56098f99af993cf41d0a05278bf';
const DONOR_WALLET = '0x802a905a48bf06843cc344faadf38e332d02c335';
const AMOUNT_USDC = 20;
const TIMESTAMP = '2026-05-17T15:35:14.062Z';

async function main() {
  const { Pool } = require('pg');

  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL o DATABASE_PUBLIC_URL non configurato.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  console.log('\n🔧 FIX DONAZIONE #499 (20 USDC - 17 maggio 2026)');
  console.log('='.repeat(60));

  try {
    // STEP 1: Verifica stato attuale
    console.log('\n📋 STEP 1: Verifica stato attuale...');
    const current = await pool.query(
      'SELECT donation_id, positions_created, payload FROM donations WHERE donation_id = $1 AND tx_hash = $2',
      [DONATION_ID, TX_HASH.toLowerCase()]
    );

    if (current.rows.length === 0) {
      console.error('❌ Donazione non trovata nel DB!');
      await pool.end();
      process.exit(1);
    }

    const row = current.rows[0];
    if (row.positions_created > 0 || (row.payload && row.payload.success)) {
      console.log('⚠️  Donazione già processata con successo! Nessun fix necessario.');
      console.log(`   Posizioni create: ${row.positions_created}`);
      await pool.end();
      return;
    }

    console.log(`   Stato attuale: FALLITA (positions_created: ${row.positions_created})`);
    console.log(`   Errore: ${row.payload?.error || 'N/A'}`);

    // STEP 2: Elimina record fallito per permettere ri-elaborazione
    console.log('\n📋 STEP 2: Reset record fallito...');
    await pool.query(
      'DELETE FROM donations WHERE donation_id = $1 AND tx_hash = $2',
      [DONATION_ID, TX_HASH.toLowerCase()]
    );
    console.log('   ✅ Record fallito eliminato');

    // STEP 3: Ri-processa con donation-flow-manager (minting simulato)
    console.log('\n📋 STEP 3: Ri-elaborazione donazione...');

    // Override BACKEND_PRIVATE_KEY per forzare minting simulato
    const savedKey = process.env.BACKEND_PRIVATE_KEY;
    process.env.BACKEND_PRIVATE_KEY = '';

    const donationFlowManager = require('./donation-flow-manager');

    const result = await donationFlowManager.processDonation({
      donationId: DONATION_ID,
      donor: DONOR_WALLET,
      amountUSDC: AMOUNT_USDC,
      txHash: TX_HASH,
      timestamp: TIMESTAMP,
      donationType: 'standard'
    });

    // Ripristina
    process.env.BACKEND_PRIVATE_KEY = savedKey;

    console.log('\n📊 RISULTATO:');
    console.log(`   Success: ${result.success}`);

    if (result.success) {
      console.log(`   Posizioni create: ${result.donation?.positionsCreated || result.positions?.posizioniCreate || 0}`);
      console.log(`   Range: ${result.donation?.firstPosition} → ${result.donation?.lastPosition}`);
      console.log(`   Tipo: ${result.donation?.donationType}`);
      console.log(`   Deduped: ${result.deduped || false}`);
      console.log('\n✅ DONAZIONE #499 PROCESSATA CON SUCCESSO!');
    } else {
      console.error(`   ❌ Errore: ${result.error}`);
      console.error(`   Messaggio: ${result.message || 'N/A'}`);
    }

  } catch (error) {
    console.error('\n❌ Errore fatale:', error.message || error);
    console.error(error.stack);
  } finally {
    await pool.end();
  }

  console.log('\n' + '='.repeat(60));
  console.log('Fine fix\n');
}

main();
