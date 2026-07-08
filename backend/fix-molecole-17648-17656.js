/**
 * 🛠️ FIX MOLECOLE CORROTTE 17648-17656
 * 
 * PROBLEMA:
 * Dopo posizione 17536 (molecola 3509, pos_in_mol 7, H14 DONANTE_3),
 * le posizioni 17648-17656 hanno subito un RESET ANOMALO:
 * - molecola resettata a 14 (invece di continuare da 3509)
 * - generazione H6 (invece di H14)
 * 
 * QUESTO SCRIPT:
 * 1. Verifica lo stato corrente delle posizioni corrotte
 * 2. Ricalcola i valori corretti partendo da 17536
 * 3. Applica le correzioni (con DRY-RUN di default)
 */

const pg = require('./pg-connection-manager');
const dbUnifiedPg = require('./db-unified-manager-pg');

// Posizioni da correggere (quelle con molecola sbagliata)
const POSITIONS_TO_FIX = [17648, 17650, 17652, 17654, 17656];

// Ultima posizione corretta PRIMA del reset
const ANCHOR_POS = 17536;
const ANCHOR_MOLECOLA = 3509;
const ANCHOR_POS_IN_MOL = 7; // DONANTE_3

/**
 * Calcola la prossima molecola e posizione in molecola
 */
function computeNextPlacement(prevMolecola, prevPosInMol) {
  const ruoliMap = {
    1: 'RICEVENTE',
    2: 'PONTE_SX',
    3: 'PONTE_DX',
    4: 'DONANTE_1',
    5: 'DONANTE_2',
    6: 'DONANTE_3',
    7: 'DONANTE_4'
  };

  let nextPosInMol = prevPosInMol + 1;
  let nextMol = prevMolecola;

  // Se siamo oltre DONANTE_4, passiamo alla molecola successiva
  if (nextPosInMol > 7) {
    nextPosInMol = 4; // Riparti da DONANTE_1
    nextMol = prevMolecola + 1;
  }

  const ruolo = ruoliMap[nextPosInMol] || 'UNKNOWN';
  
  // Generazione: tutte in H14 per questo range (siamo nel SMALL avanzato)
  const generazione = 'H14';

  return {
    molecola: nextMol,
    generazione,
    ruolo,
    posizioneInMolecola: nextPosInMol
  };
}

/**
 * Esegue il fix delle molecole corrotte
 */
async function fixMolecoleCorrette(apply = false) {
  console.log('');
  console.log('═'.repeat(60));
  console.log('🛠️  FIX MOLECOLE CORROTTE 17648-17656');
  console.log('═'.repeat(60));
  console.log(`Modalità: ${apply ? '✅ APPLY (modifica DB)' : '🔍 DRY-RUN (solo preview)'}`);
  console.log('');

  await pg.initDatabase();
  const pool = pg.getPool();

  try {
    // 1. Verifica stato corrente dell'ancora (17536)
    console.log('📌 Verifica stato posizione ancora...');
    const anchorRes = await pool.query(
      'SELECT posizione, molecola, posizione_in_molecola, generazione, ruolo FROM wallet_positions WHERE posizione = $1',
      [ANCHOR_POS]
    );

    if (anchorRes.rows.length === 0) {
      throw new Error(`Posizione ancora ${ANCHOR_POS} non trovata nel database!`);
    }

    const anchor = anchorRes.rows[0];
    console.log(`   Posizione ${ANCHOR_POS}:`);
    console.log(`   - Molecola: ${anchor.molecola} (attesa: ${ANCHOR_MOLECOLA})`);
    console.log(`   - Pos in molecola: ${anchor.posizione_in_molecola} (attesa: ${ANCHOR_POS_IN_MOL})`);
    console.log(`   - Generazione: ${anchor.generazione}`);
    console.log(`   - Ruolo: ${anchor.ruolo}`);

    if (Number(anchor.molecola) !== ANCHOR_MOLECOLA || Number(anchor.posizione_in_molecola) !== ANCHOR_POS_IN_MOL) {
      throw new Error(
        `Stato ancora non corrisponde! Atteso: mol=${ANCHOR_MOLECOLA}, pos_in_mol=${ANCHOR_POS_IN_MOL}. ` +
        `Trovato: mol=${anchor.molecola}, pos_in_mol=${anchor.posizione_in_molecola}`
      );
    }

    console.log('   ✅ Stato ancora verificato\n');

    // 2. Calcola i valori corretti per tutte le posizioni dalla 17537 fino all'ultima da fixare
    console.log('🧮 Calcolo sequenza corretta...');
    
    const lastPosToFix = Math.max(...POSITIONS_TO_FIX);
    const placements = new Map();
    
    let prevMol = ANCHOR_MOLECOLA;
    let prevPosInMol = ANCHOR_POS_IN_MOL;

    for (let pos = ANCHOR_POS + 1; pos <= lastPosToFix; pos++) {
      const placement = computeNextPlacement(prevMol, prevPosInMol);
      placements.set(pos, placement);
      prevMol = placement.molecola;
      prevPosInMol = placement.posizioneInMolecola;
    }

    console.log(`   Calcolati placement per posizioni ${ANCHOR_POS + 1} → ${lastPosToFix}`);
    console.log('');

    // 3. Verifica stato corrente delle posizioni da fixare
    console.log('🔍 Verifica stato corrente posizioni corrotte:');
    console.log('');

    const changes = [];

    for (const pos of POSITIONS_TO_FIX) {
      const currentRes = await pool.query(
        'SELECT posizione, wallet, molecola, posizione_in_molecola, generazione, ruolo FROM wallet_positions WHERE posizione = $1',
        [pos]
      );

      if (currentRes.rows.length === 0) {
        console.log(`   ⚠️  Posizione ${pos}: NON TROVATA nel database`);
        continue;
      }

      const current = currentRes.rows[0];
      const correct = placements.get(pos);

      const before = {
        molecola: Number(current.molecola),
        generazione: current.generazione,
        ruolo: current.ruolo,
        posizione_in_molecola: Number(current.posizione_in_molecola)
      };

      const after = {
        molecola: correct.molecola,
        generazione: correct.generazione,
        ruolo: correct.ruolo,
        posizione_in_molecola: correct.posizioneInMolecola
      };

      const needsFix = (
        before.molecola !== after.molecola ||
        before.generazione !== after.generazione ||
        before.ruolo !== after.ruolo ||
        before.posizione_in_molecola !== after.posizione_in_molecola
      );

      console.log(`   Pos ${pos} (wallet: ${current.wallet}):`);
      console.log(`      PRIMA:  mol=${before.molecola}, gen=${before.generazione}, ruolo=${before.ruolo}, pos_in_mol=${before.posizione_in_molecola}`);
      console.log(`      DOPO:   mol=${after.molecola}, gen=${after.generazione}, ruolo=${after.ruolo}, pos_in_mol=${after.posizione_in_molecola}`);
      console.log(`      Stato:  ${needsFix ? '❌ DA CORREGGERE' : '✅ GIÀ CORRETTA'}`);
      console.log('');

      if (needsFix) {
        changes.push({
          posizione: pos,
          wallet: current.wallet,
          before,
          after
        });
      }
    }

    // 4. Applica le modifiche se richiesto
    if (apply && changes.length > 0) {
      console.log('');
      console.log('✏️  Applicazione modifiche...');
      console.log('');

      for (const change of changes) {
        await pool.query(
          `UPDATE wallet_positions
           SET molecola = $1,
               generazione = $2,
               ruolo = $3,
               posizione_in_molecola = $4
           WHERE posizione = $5`,
          [
            change.after.molecola,
            change.after.generazione,
            change.after.ruolo,
            change.after.posizione_in_molecola,
            change.posizione
          ]
        );

        console.log(`   ✅ Posizione ${change.posizione} aggiornata`);
      }

      console.log('');
      console.log(`✅ ${changes.length} posizioni corrette con successo!`);
    } else if (changes.length > 0) {
      console.log('');
      console.log(`📋 ${changes.length} posizioni necessitano correzione`);
      console.log('');
      console.log('Per applicare le modifiche, esegui:');
      console.log('  node fix-molecole-17648-17656.js --apply');
    } else {
      console.log('');
      console.log('✅ Tutte le posizioni sono già corrette!');
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('');

    return {
      success: true,
      changes,
      applied: apply
    };

  } catch (error) {
    console.error('');
    console.error('❌ ERRORE durante il fix:', error.message);
    console.error('');
    throw error;
  }
}

// Esegui lo script
const apply = process.argv.includes('--apply');
fixMolecoleCorrette(apply)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
