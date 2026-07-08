/**
 * 🔧 FIX REFERRAL INVITATI - Corregge distribuzione invitati per donazioni referral
 * 
 * Corregge tutti gli invitati nel database secondo la nuova logica:
 * - H=1  → invitante
 * - H=2  → invitante, self
 * - H=3  → invitante, self, AVENGERS
 * - H=4  → invitante, self, AVENGERS, ROG
 * - H>=5 → invitante, (H-3) self, AVENGERS, ROG
 * 
 * IMPORTANTE: 
 * - Questo script analizza tutte le donazioni nel sistema
 * - Identifica quali erano referral (con invitante diverso da ROG/AVENGERS/PILETTA)
 * - Ricalcola la distribuzione corretta
 * - Aggiorna anagrafica_invitati
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 */

// Carica variabili d'ambiente
require('dotenv').config();

const pg = require('./pg-connection-manager');
const dbPg = require('./db-unified-manager-pg');

const SPECIAL_WALLETS = {
  ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
  AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972',
  PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe'
};

const SPARTIACQUE_SMALL = 3496;

/**
 * Determina se una posizione appartiene al movimento SMALL (>= 3496)
 */
function isSmallMovement(posizione) {
  return Number(posizione) >= SPARTIACQUE_SMALL;
}

/**
 * Calcola la distribuzione corretta degli invitati per una donazione referral
 * 
 * @param {Array} humanPositions - Posizioni HUMAN create dalla donazione (ordinate)
 * @param {string} walletInvitante - Wallet dell'invitante
 * @param {string} walletInvitato - Wallet dell'invitato (beneficiario)
 * @returns {Array} Mapping { posizione, walletInvitante, walletInvitato }
 */
function calcolaDistribuzioneCorretta(humanPositions, walletInvitante, walletInvitato) {
  const H = humanPositions.length;
  if (H === 0) return [];

  const primaPosizione = humanPositions[0].posizione;
  
  // Se è LARGE legacy (< 3496), TUTTO all'invitante
  if (!isSmallMovement(primaPosizione)) {
    return humanPositions.map(p => ({
      posizione: p.posizione,
      walletInvitante,
      walletInvitato
    }));
  }

  // SMALL (>= 3496): applica nuova logica
  const rogWallet = SPECIAL_WALLETS.ROG;
  const avengersWallet = SPECIAL_WALLETS.AVENGERS;

  let rogCount = 0;
  let avengersCount = 0;
  let invitanteCount = 1; // Prima posizione SEMPRE all'invitante
  let selfCount = 0;

  if (H === 1) {
    invitanteCount = 1;
  } else if (H === 2) {
    invitanteCount = 1;
    selfCount = 1;
  } else if (H === 3) {
    invitanteCount = 1;
    selfCount = 1;
    avengersCount = 1;
  } else if (H === 4) {
    invitanteCount = 1;
    selfCount = 1;
    avengersCount = 1;
    rogCount = 1;
  } else {
    // H >= 5
    invitanteCount = 1;
    selfCount = H - 3;
    avengersCount = 1;
    rogCount = 1;
  }

  const mapping = [];
  let idx = 0;

  // 1) INVITANTE (prima posizione)
  for (let i = 0; i < invitanteCount && idx < humanPositions.length; i++, idx++) {
    mapping.push({
      posizione: humanPositions[idx].posizione,
      walletInvitante,
      walletInvitato
    });
  }

  // 2) SELF (posizioni centrali)
  for (let i = 0; i < selfCount && idx < humanPositions.length; i++, idx++) {
    mapping.push({
      posizione: humanPositions[idx].posizione,
      walletInvitante: walletInvitato, // SELF: invitante = invitato
      walletInvitato
    });
  }

  // 3) AVENGERS (penultima)
  for (let i = 0; i < avengersCount && idx < humanPositions.length; i++, idx++) {
    mapping.push({
      posizione: humanPositions[idx].posizione,
      walletInvitante: avengersWallet,
      walletInvitato
    });
  }

  // 4) ROG (ultima)
  for (let i = 0; i < rogCount && idx < humanPositions.length; i++, idx++) {
    mapping.push({
      posizione: humanPositions[idx].posizione,
      walletInvitante: rogWallet,
      walletInvitato
    });
  }

  return mapping;
}

/**
 * Ottiene tutte le donazioni dal database con le relative posizioni
 */
async function getAllDonationsWithPositions() {
  const pool = pg.getPool();
  
  // Ottieni tutte le donazioni
  const donations = await pool.query(`
    SELECT 
      d.donation_id,
      d.donor_wallet,
      d.amount_usdc,
      d.ts,
      d.first_position,
      d.last_position
    FROM donations d
    WHERE d.first_position IS NOT NULL
      AND d.last_position IS NOT NULL
    ORDER BY d.first_position ASC
  `);

  const results = [];

  for (const donation of donations.rows) {
    // Ottieni le posizioni create da questa donazione
    const positions = await pool.query(`
      SELECT 
        posizione,
        wallet,
        movimento
      FROM wallet_positions
      WHERE posizione >= $1 AND posizione <= $2
      ORDER BY posizione ASC
    `, [donation.first_position, donation.last_position]);

    results.push({
      donationId: donation.donation_id,
      donor: donation.donor_wallet.toLowerCase(),
      amountUSDC: donation.amount_usdc,
      timestamp: donation.ts,
      firstPosition: donation.first_position,
      lastPosition: donation.last_position,
      positions: positions.rows
    });
  }

  return results;
}

/**
 * Trova l'invitante originale per una donazione
 * Cerca prima in community_registrations, poi fallback su anagrafica_invitati
 */
async function findInvitanteOriginale(donor, firstPosition) {
  const pool = pg.getPool();
  
  // 1) Cerca nella tabella community_registrations (referral link)
  const communityResult = await pool.query(`
    SELECT 
      referrer_wallet,
      wallet_address
    FROM community_registrations
    WHERE LOWER(wallet_address) = $1
      AND referrer_wallet IS NOT NULL
      AND TRIM(referrer_wallet) != ''
    LIMIT 1
  `, [donor]);

  if (communityResult.rows.length > 0) {
    const invitanteWallet = communityResult.rows[0].referrer_wallet.toLowerCase();
    const invitatoWallet = communityResult.rows[0].wallet_address.toLowerCase();
    
    // Verifica se è un vero referral (invitante non è ROG/AVENGERS/PILETTA e non è SELF)
    const isSpecialWallet = Object.values(SPECIAL_WALLETS).map(w => w.toLowerCase()).includes(invitanteWallet);
    const isSelf = invitanteWallet === invitatoWallet;
    
    if (!isSpecialWallet && !isSelf) {
      return {
        walletInvitante: invitanteWallet,
        walletInvitato: invitatoWallet
      };
    }
  }

  // 2) Fallback: cerca nella tabella anagrafica_invitati
  const anagraficaResult = await pool.query(`
    SELECT 
      invitante_wallet,
      invitato_wallet
    FROM anagrafica_invitati
    WHERE invitato_pos = $1
    LIMIT 1
  `, [firstPosition]);

  if (anagraficaResult.rows.length > 0) {
    const invitanteWallet = anagraficaResult.rows[0].invitante_wallet.toLowerCase();
    const invitatoWallet = anagraficaResult.rows[0].invitato_wallet.toLowerCase();
    
    const isSpecialWallet = Object.values(SPECIAL_WALLETS).map(w => w.toLowerCase()).includes(invitanteWallet);
    const isSelf = invitanteWallet === invitatoWallet;
    
    if (!isSpecialWallet && !isSelf) {
      return {
        walletInvitante: invitanteWallet,
        walletInvitato: invitatoWallet
      };
    }
  }

  return null;
}

/**
 * Corregge gli invitati per una singola donazione
 */
async function correggiInvitatiPerDonazione(donation) {
  const pool = pg.getPool();
  
  // Filtra solo posizioni HUMAN (escludendo PILETTA)
  const pilettaWallet = SPECIAL_WALLETS.PILETTA.toLowerCase();
  const humanPositions = donation.positions.filter(p => {
    const wallet = (p.wallet || '').toLowerCase();
    return wallet !== pilettaWallet;
  });
  if (humanPositions.length === 0) {
    return { success: false, reason: 'Nessuna posizione HUMAN' };
  }

  // Trova l'invitante originale
  const referralInfo = await findInvitanteOriginale(donation.donor, humanPositions[0].posizione);
  
  if (!referralInfo) {
    return { success: false, reason: 'Non è un referral (invitante ROG/AVENGERS o SELF)' };
  }

  console.log(`\n📝 Donazione ${donation.donationId}`);
  console.log(`   Donor: ${donation.donor}`);
  console.log(`   Posizioni: ${donation.firstPosition}-${donation.lastPosition} (${humanPositions.length} HUMAN)`);
  console.log(`   Invitante originale: ${referralInfo.walletInvitante}`);

  // Calcola la distribuzione corretta
  const distribuzioneCorretta = calcolaDistribuzioneCorretta(
    humanPositions,
    referralInfo.walletInvitante,
    referralInfo.walletInvitato
  );

  // Stampa la distribuzione calcolata
  console.log('   Distribuzione corretta:');
  for (const entry of distribuzioneCorretta) {
    console.log(`     Pos ${entry.posizione}: invitante=${entry.walletInvitante.substring(0,10)}...`);
  }

  // Elimina i vecchi record per queste posizioni
  await pool.query(`
    DELETE FROM anagrafica_invitati
    WHERE invitato_pos >= $1 AND invitato_pos <= $2
  `, [donation.firstPosition, donation.lastPosition]);

  console.log(`   ✅ Eliminati vecchi record`);

  // Inserisci i nuovi record corretti
  let insertedCount = 0;
  for (const entry of distribuzioneCorretta) {
    // Trova la posizione dell'invitante
    const invitanteResult = await pool.query(`
      SELECT posizione
      FROM wallet_positions
      WHERE LOWER(wallet) = $1
      ORDER BY posizione ASC
      LIMIT 1
    `, [entry.walletInvitante.toLowerCase()]);

    const invitante_pos = invitanteResult.rows[0]?.posizione || 0;

    await pool.query(`
      INSERT INTO anagrafica_invitati (
        invitante_pos,
        invitante_wallet,
        invitato_pos,
        invitato_wallet,
        livello,
        created_at
      )
      VALUES ($1, $2, $3, $4, 1, NOW())
      ON CONFLICT DO NOTHING
    `, [
      invitante_pos,
      entry.walletInvitante.toLowerCase(),
      entry.posizione,
      entry.walletInvitato.toLowerCase()
    ]);

    insertedCount++;
  }

  console.log(`   ✅ Inseriti ${insertedCount} nuovi record corretti`);

  return { success: true, corrected: insertedCount };
}

/**
 * Main: corregge tutti gli invitati referral nel database
 */
async function main() {
  console.log('🔧 CORREZIONE INVITATI REFERRAL');
  console.log('================================\n');

  try {
    // Inizializza connessione PostgreSQL
    await pg.initDatabase();
    console.log('✅ Connessione PostgreSQL attiva\n');

    // Ottieni tutte le donazioni con posizioni
    console.log('📊 Caricamento donazioni...');
    const donations = await getAllDonationsWithPositions();
    console.log(`✅ Trovate ${donations.length} donazioni\n`);

    // Processa ogni donazione
    let totalCorrected = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const donation of donations) {
      try {
        const result = await correggiInvitatiPerDonazione(donation);
        
        if (result.success) {
          totalCorrected++;
        } else {
          totalSkipped++;
          console.log(`   ⏭️  Skipped: ${result.reason}`);
        }
      } catch (error) {
        totalErrors++;
        console.error(`   ❌ Errore: ${error.message}`);
      }
    }

    console.log('\n================================');
    console.log('📊 RISULTATO FINALE:');
    console.log(`   ✅ Donazioni corrette: ${totalCorrected}`);
    console.log(`   ⏭️  Donazioni skipped: ${totalSkipped}`);
    console.log(`   ❌ Errori: ${totalErrors}`);
    console.log('================================\n');

  } catch (error) {
    console.error('❌ Errore fatale:', error);
    process.exit(1);
  }

  console.log('✅ Script completato');
  process.exit(0);
}

// Esegui lo script
if (require.main === module) {
  main();
}

module.exports = {
  calcolaDistribuzioneCorretta,
  correggiInvitatiPerDonazione
};
