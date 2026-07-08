/**
 * 🔍 DEBUG: Verifica donazione e posizioni per un txHash specifico
 * 
 * Uso: node debug-check-tx.js
 * 
 * Richiede DATABASE_URL (o DATABASE_PUBLIC_URL) configurato come variabile d'ambiente.
 */

require('dotenv').config();

const TX_HASHES = [
  '0xbaddb3749f0b3f6b921e1b0f76fbbde3ac47f56098f99af993cf41d0a05278bf' // 20 USDC del 17 maggio 2026
];
const DONOR_WALLET = '0x802a905a48bf06843cc344faadf38e332d02c335'; // lowercase

async function main() {
  const { Pool } = require('pg');

  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL non configurato. Imposta la variabile d\'ambiente.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  console.log('\n🔍 DIAGNOSI DONAZIONE');
  console.log('='.repeat(60));
  console.log(`TxHash 1: ${TX_HASHES[0]}`);
  console.log(`TxHash 2: ${TX_HASHES[1]}`);
  console.log(`Donor:    ${DONOR_WALLET}`);
  console.log('='.repeat(60));

  try {
    // 1) Cerca nella tabella donations per txHash
    console.log('\n📋 1. TABELLA DONATIONS (per txHash):');
    const donRes = await pool.query(
      'SELECT * FROM donations WHERE tx_hash = ANY($1)',
      [TX_HASHES.map(t => t.toLowerCase())]
    );
    if (donRes.rows.length === 0) {
      console.log('   ❌ NESSUNA donazione trovata per questo txHash!');
      console.log('   → Il backend NON ha processato questa transazione.');
    } else {
      for (const row of donRes.rows) {
        console.log(`   ✅ Trovata donazione:`);
        console.log(`      donation_id:      ${row.donation_id}`);
        console.log(`      donation_type:     ${row.donation_type}`);
        console.log(`      amount_usdc:       ${row.amount_usdc}`);
        console.log(`      donor_wallet:      ${row.donor_wallet}`);
        console.log(`      beneficiary:       ${row.beneficiary_wallet || 'N/A'}`);
        console.log(`      positions_created: ${row.positions_created}`);
        console.log(`      first_position:    ${row.first_position}`);
        console.log(`      last_position:     ${row.last_position}`);
        console.log(`      timestamp:         ${row.ts}`);
        
        // Controlla payload
        if (row.payload) {
          const p = row.payload;
          console.log(`      payload.success:   ${p.success}`);
          if (p.error) console.log(`      payload.error:     ${p.error}`);
          if (p.message) console.log(`      payload.message:   ${p.message}`);
          if (p.deduped) console.log(`      payload.deduped:   ${p.deduped}`);
          if (p.donation) {
            console.log(`      payload.donation.positionsCreated: ${p.donation.positionsCreated}`);
            console.log(`      payload.donation.status:           ${p.donation.status}`);
          }
        }
      }
    }

    // 2) Cerca posizioni del wallet donor
    console.log('\n📋 2. POSIZIONI DEL WALLET DONOR:');
    const posRes = await pool.query(
      'SELECT posizione, wallet, nome, tipo, movimento, molecola, generazione, ruolo FROM wallet_positions WHERE wallet = $1 ORDER BY posizione DESC LIMIT 20',
      [DONOR_WALLET]
    );
    if (posRes.rows.length === 0) {
      console.log('   ❌ NESSUNA posizione trovata per questo wallet!');
      console.log('   → Il wallet non ha MAI avuto posizioni create.');
    } else {
      console.log(`   ✅ Trovate ${posRes.rows.length} posizioni (ultime 20):`);
      for (const row of posRes.rows) {
        console.log(`      Pos ${String(row.posizione).padStart(6)} | ${(row.tipo || '?').padEnd(7)} | ${row.movimento || '?'} | Mol ${row.molecola} | ${row.generazione} | ${row.ruolo}`);
      }
    }

    // 3) Verifica iscrizione community
    console.log('\n📋 3. ISCRIZIONE COMMUNITY:');
    try {
      const comRes = await pool.query(
        'SELECT * FROM community_registrations WHERE LOWER(wallet_address) = $1',
        [DONOR_WALLET]
      );
      if (comRes.rows.length === 0) {
        console.log('   ❌ Wallet NON iscritto alla community!');
        console.log('   → Questo BLOCCA la creazione posizioni in processDonation().');
      } else {
        const reg = comRes.rows[0];
        console.log(`   ✅ Iscritto alla community:`);
        console.log(`      ID:              ${reg.id}`);
        console.log(`      Registrato il:   ${reg.created_at || reg.registered_at}`);
        console.log(`      Referrer wallet: ${reg.referrer_wallet || 'N/A'}`);
      }
    } catch (e) {
      console.log(`   ⚠️  Errore query community_registrations: ${e.message}`);
    }

    // 4) Cerca invitati (anagrafica_invitati) per il wallet
    console.log('\n📋 4. INVITATI (come invitante):');
    const invRes = await pool.query(
      'SELECT invitato_pos, invitato_wallet, invitante_pos FROM anagrafica_invitati WHERE LOWER(invitante_wallet) = $1 ORDER BY invitato_pos DESC LIMIT 10',
      [DONOR_WALLET]
    );
    if (invRes.rows.length === 0) {
      console.log('   Nessun invitato trovato.');
    } else {
      console.log(`   Trovati ${invRes.rows.length} invitati (ultimi 10):`);
      for (const row of invRes.rows) {
        console.log(`      Invitato pos ${row.invitato_pos} | wallet: ${row.invitato_wallet} | da pos ${row.invitante_pos}`);
      }
    }

    // 5) Ultima posizione globale (per capire se le posizioni sono state create dopo)
    console.log('\n📋 5. ULTIMA POSIZIONE GLOBALE:');
    const lastRes = await pool.query('SELECT MAX(posizione) AS ultima FROM wallet_positions');
    console.log(`   Ultima posizione nel sistema: ${lastRes.rows[0]?.ultima}`);

    // 6) Tutte le donazioni del wallet (per capire la storia)
    console.log('\n📋 6. STORICO DONAZIONI DEL WALLET:');
    const histRes = await pool.query(
      'SELECT donation_id, tx_hash, donation_type, amount_usdc, positions_created, first_position, last_position, ts FROM donations WHERE donor_wallet = $1 ORDER BY ts DESC LIMIT 10',
      [DONOR_WALLET]
    );
    if (histRes.rows.length === 0) {
      console.log('   Nessuna donazione precedente trovata.');
    } else {
      console.log(`   Trovate ${histRes.rows.length} donazioni (ultime 10):`);
      for (const row of histRes.rows) {
        console.log(`      ${row.ts} | ${row.donation_type} | ${row.amount_usdc} USDC | pos ${row.first_position}-${row.last_position} | ${row.positions_created} create | tx: ${(row.tx_hash || '').slice(0, 14)}...`);
      }
    }

  } catch (error) {
    console.error('\n❌ Errore:', error.message);
  } finally {
    await pool.end();
  }

  console.log('\n' + '='.repeat(60));
  console.log('Fine diagnosi\n');
}

main();
