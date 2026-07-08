/**
 * 🌊 ROG VASI COMUNICANTI ORCHESTRATOR - PostgreSQL VERSION
 *
 * Implementa il sistema di "vasi comunicanti" per l'avanzamento parallelo
 * delle generazioni H nei movimenti SMALL, MEDIUM e LARGE.
 *
 * PRINCIPIO FONDAMENTALE:
 * Quando una generazione "di testa" (es. H12) completa il suo ciclo,
 * a cascata le generazioni precedenti (H10, H8, H6, H4, H2) avanzano
 * TUTTE di 1 ciclo ciascuna, creando una "onda" sincronizzata.
 *
 * VINCOLO ASSOLUTO: NESSUN CICLO SALTATO
 * - Ogni generazione Hn incrementa ciclo_corrente di +1 alla volta
 * - Mai saltare valori (es. da ciclo 1 a ciclo 3)
 * - I cicli possono avanzare in parallelo per generazioni diverse
 *
 * ESEMPI DI CASCATA:
 *
 * SMALL/MEDIUM:
 * Quando H12 completa ciclo 1 in SMALL →
 *   H10 avanza ciclo 2 (SMALL)
 *   H8  avanza ciclo 3 (SMALL) → passa a MEDIUM
 *   H6  avanza ciclo 1 (MEDIUM)
 *   H4  avanza ciclo 2 (MEDIUM)
 *   H2  avanza ciclo 3 (MEDIUM) → passa a LARGE
 *
 * LARGE:
 * Quando H13 completa ciclo 1 in LARGE →
 *   H11 avanza ciclo 2 (LARGE)
 *   H9  avanza ciclo 3 (LARGE)
 *   H7  avanza ciclo 4 (LARGE)
 *   H5  avanza ciclo 5 (LARGE)
 *   H3  avanza ciclo 6 (LARGE)
 *   H1  avanza ciclo 7 (LARGE)
 *
 * @version 1.0.0
 * @author Warp AI Agent (NASA-level)
 */

const pg = require('./pg-connection-manager');
const avanzamentoManagerPg = require('./avanzamento-manager-pg');
const netEffectsEngine = require('./net-effects-engine-pg');

// ========================================
// HELPER FUNCTIONS
// ========================================

async function queryOne(sql, params = []) {
  return await pg.queryOne(sql, params);
}

async function queryMany(sql, params = []) {
  return await pg.queryMany(sql, params);
}

/**
 * Ottiene lo stato di una generazione (ciclo corrente, movimento)
 */
async function getGenerationState(generazioneNativa) {
  // Prendiamo un campione rappresentativo (il primo ricevente)
  const row = await queryOne(
    `SELECT movimento_corrente AS movimento,
            ciclo_corrente AS ciclo,
            stelle_rosse,
            stelle_verdi,
            stelle_blu
     FROM posizioni_stato
     WHERE generazione_small_nativa = $1
       AND ruolo_corrente = 'RICEVENTE'
     ORDER BY posizione ASC
     LIMIT 1`,
    [generazioneNativa]
  );

  if (!row) {
    return null;
  }

  return {
    generazione: generazioneNativa,
    movimento: row.movimento,
    ciclo: Number(row.ciclo),
    stelle_rosse: Number(row.stelle_rosse || 0),
    stelle_verdi: Number(row.stelle_verdi || 0),
    stelle_blu: Number(row.stelle_blu || 0)
  };
}

/**
 * Verifica se una generazione ha completato tutti i suoi cicli nel movimento corrente
 */
function haCompletedMovement(state) {
  if (!state) return false;

  switch (state.movimento) {
    case 'SMALL':
      return state.stelle_rosse >= 3;
    case 'MEDIUM':
      return state.stelle_verdi >= 3;
    case 'LARGE':
      return state.stelle_blu >= 8;
    default:
      return false;
  }
}

/**
 * Calcola la prossima generazione nella cascata (offset -2)
 */
function getPreviousGeneration(generazioneNativa) {
  const gen = Number(generazioneNativa);
  if (gen <= 2) return null; // H2 è la generazione madre, non ha precedenti
  return gen - 2;
}

// ========================================
// CASCATA SMALL/MEDIUM
// ========================================

/**
 * Esegue la cascata di avanzamenti per SMALL/MEDIUM quando una generazione
 * "di testa" completa un ciclo.
 *
 * Schema: H(n) → H(n-2) → H(n-4) → H(n-6) → ...
 *
 * Ogni generazione avanza di +1 ciclo, applicando:
 * - NET_EFFECTS per il ciclo completato
 * - Avanzamento ruoli (DONANTE → PONTE → RICEVENTE)
 * - Stelline appropriate (rosse/verdi)
 * - Passaggi SMALL→MEDIUM o MEDIUM→LARGE se completano 3 cicli
 *
 * @param {number} generazioneTop - generazione "di testa" che ha appena completato un ciclo
 * @returns {Promise<Object>} risultato cascata
 */
async function triggerCascataSmallMedium(generazioneTop) {
  const genTop = Number(generazioneTop);

  console.log(`\n🌊 ========================================`);
  console.log(`   CASCATA VASI COMUNICANTI SMALL/MEDIUM`);
  console.log(`========================================`);
  console.log(`📍 Generazione trigger: H${genTop}`);
  console.log(``);

  await avanzamentoManagerPg.inizializzaDatabase();

  const cascadeResults = [];
  let currentGen = genTop;

  // Percorriamo la cascata: H(n) → H(n-2) → H(n-4) → ...
  while (currentGen >= 2) {
    const state = await getGenerationState(currentGen);

    if (!state) {
      console.log(`⚠️  H${currentGen}: generazione non trovata, cascata si ferma`);
      break;
    }

    console.log(`\n🔄 H${currentGen} (${state.movimento}, ciclo ${state.ciclo}):`);

    // Se la generazione ha completato il movimento corrente, passa al successivo
    if (haCompletedMovement(state)) {
      const nextMovement = state.movimento === 'SMALL' ? 'MEDIUM' : 'LARGE';
      console.log(`   ✅ 3 stelle ${state.movimento} completate → passaggio a ${nextMovement}`);
      
      // Il passaggio viene gestito da avanzamento-manager-pg.verificaPassaggiMovimentoPg
      // che viene chiamato automaticamente dopo l'onda globale
      cascadeResults.push({
        generazione: currentGen,
        movimento: state.movimento,
        ciclo: state.ciclo,
        action: 'PASSAGGIO_MOVIMENTO',
        nextMovement
      });

      // Dopo il passaggio, questa generazione esce dalla cascata SMALL/MEDIUM
      break;
    }

    // Applica NET_EFFECTS per il ciclo corrente (prima di avanzare)
    console.log(`   💰 Applicazione NET_EFFECTS (${state.movimento}, ciclo ${state.ciclo})...`);
    try {
      const effects = await netEffectsEngine.applyNetEffectsForGenerationPg({
        movimento: state.movimento,
        generazioneNativa: currentGen,
        ciclo: state.ciclo
      });
      
      if (effects.applied) {
        console.log(`   ✅ NET_EFFECTS applicati`);
        if (effects.accumuli?.length > 0) {
          console.log(`      Accumuli: ${effects.accumuli.length}`);
        }
        if (effects.newPositions?.length > 0) {
          console.log(`      Nuove posizioni: ${effects.newPositions.length} riceventi`);
        }
      }
    } catch (e) {
      console.error(`   ❌ Errore NET_EFFECTS H${currentGen}:`, e.message || e);
    }

    // Registra completamento generazione (trigger per onda globale)
    console.log(`   🎯 Registrazione completamento generazione...`);
    await avanzamentoManagerPg.registraCompletamentoGenerazione(state.movimento, currentGen);

    // Avanza onda globale (ruoli + stelline + ciclo_corrente)
    console.log(`   🌊 Avanzamento onda globale...`);
    const advancement = await avanzamentoManagerPg.avanzaInteraGenerazione(state.movimento, currentGen);

    cascadeResults.push({
      generazione: currentGen,
      movimento: state.movimento,
      cicloPrecedente: state.ciclo,
      cicloSuccessivo: state.ciclo + 1,
      action: 'ADVANCED',
      advancement
    });

    console.log(`   ✅ H${currentGen} avanzata a ciclo ${state.ciclo + 1}`);

    // Prossima generazione nella cascata (offset -2)
    const prevGen = getPreviousGeneration(currentGen);
    if (!prevGen) {
      console.log(`   ℹ️  H${currentGen} è H2 (generazione madre), cascata terminata`);
      break;
    }

    currentGen = prevGen;
  }

  console.log(`\n========================================`);
  console.log(`   ✅ CASCATA COMPLETATA`);
  console.log(`========================================`);
  console.log(`📊 Generazioni avanzate: ${cascadeResults.length}`);
  console.log(``);

  return {
    success: true,
    trigger: genTop,
    cascade: cascadeResults
  };
}

// ========================================
// CASCATA LARGE
// ========================================

/**
 * Esegue la cascata di avanzamenti per LARGE quando una generazione
 * "di testa" completa un ciclo.
 *
 * Schema: H(n) → H(n-2) → H(n-4) → H(n-6) → ...
 *
 * Ogni generazione avanza di +1 ciclo, applicando:
 * - Distribuzioni USDC ai riceventi (via large-distribution-engine)
 * - Gestione ponti (0/1/≥2 invitati)
 * - Comportamento speciale PILETTE (doni → posizioni SMALL)
 * - 32 posizioni al ciclo 5
 * - Stelline blu
 * - Rimozione posizioni dopo ciclo 8
 *
 * @param {number} generazioneTop - generazione "di testa" che ha appena completato un ciclo
 * @returns {Promise<Object>} risultato cascata
 */
async function triggerCascataLarge(generazioneTop) {
  const genTop = Number(generazioneTop);

  console.log(`\n🌊 ========================================`);
  console.log(`   CASCATA VASI COMUNICANTI LARGE`);
  console.log(`========================================`);
  console.log(`📍 Generazione trigger: H${genTop}`);
  console.log(``);

  await avanzamentoManagerPg.inizializzaDatabase();

  const cascadeResults = [];
  let currentGen = genTop;

  // Percorriamo la cascata: H(n) → H(n-2) → H(n-4) → ...
  while (currentGen >= 1) {
    const state = await getGenerationState(currentGen);

    if (!state || state.movimento !== 'LARGE') {
      console.log(`⚠️  H${currentGen}: non in LARGE o non trovata, cascata si ferma`);
      break;
    }

    console.log(`\n🔄 H${currentGen} (LARGE, ciclo ${state.ciclo}):`);

    // Verifica completamento movimento (8 stelle blu → rimozione)
    if (state.stelle_blu >= 8) {
      console.log(`   ✅ 8 stelle blu completate → uscita definitiva dal sistema`);
      
      const removed = await avanzamentoManagerPg.rimuoviCompletatiLargePg();
      cascadeResults.push({
        generazione: currentGen,
        movimento: 'LARGE',
        ciclo: state.ciclo,
        action: 'REMOVED',
        positionsRemoved: removed
      });

      // Dopo la rimozione, questa generazione esce dalla cascata
      break;
    }

    // Applica NET_EFFECTS per LARGE (distribuzioni + posizioni)
    console.log(`   💰 Applicazione NET_EFFECTS (LARGE, ciclo ${state.ciclo})...`);
    try {
      const effects = await netEffectsEngine.applyNetEffectsForGenerationPg({
        movimento: 'LARGE',
        generazioneNativa: currentGen,
        ciclo: state.ciclo
      });
      
      if (effects.applied) {
        console.log(`   ✅ NET_EFFECTS applicati`);
        if (effects.distributions?.length > 0) {
          console.log(`      Distribuzioni USDC: ${effects.distributions.length}`);
        }
        if (effects.newPositions?.length > 0) {
          console.log(`      Nuove posizioni: ${effects.newPositions.length} riceventi`);
        }
      }
    } catch (e) {
      console.error(`   ❌ Errore NET_EFFECTS H${currentGen}:`, e.message || e);
    }

    // Registra completamento generazione
    console.log(`   🎯 Registrazione completamento generazione...`);
    await avanzamentoManagerPg.registraCompletamentoGenerazione('LARGE', currentGen);

    // Avanza onda globale (ruoli + stelline + ciclo_corrente)
    console.log(`   🌊 Avanzamento onda globale...`);
    const advancement = await avanzamentoManagerPg.avanzaInteraGenerazione('LARGE', currentGen);

    cascadeResults.push({
      generazione: currentGen,
      movimento: 'LARGE',
      cicloPrecedente: state.ciclo,
      cicloSuccessivo: state.ciclo + 1,
      action: 'ADVANCED',
      advancement
    });

    console.log(`   ✅ H${currentGen} avanzata a ciclo ${state.ciclo + 1}`);

    // Prossima generazione nella cascata (offset -2)
    const prevGen = getPreviousGeneration(currentGen);
    if (!prevGen) {
      console.log(`   ℹ️  H${currentGen} è H1 (generazione origine), cascata terminata`);
      break;
    }

    currentGen = prevGen;
  }

  console.log(`\n========================================`);
  console.log(`   ✅ CASCATA COMPLETATA`);
  console.log(`========================================`);
  console.log(`📊 Generazioni avanzate: ${cascadeResults.length}`);
  console.log(``);

  return {
    success: true,
    trigger: genTop,
    cascade: cascadeResults
  };
}

// ========================================
// ENTRY POINT UNIFICATO
// ========================================

/**
 * Trigger unificato per cascata vasi comunicanti.
 * Determina automaticamente se usare SMALL/MEDIUM o LARGE in base
 * allo stato della generazione trigger.
 *
 * @param {number} generazioneTop - generazione "di testa" che ha completato un ciclo
 * @returns {Promise<Object>} risultato cascata
 */
async function triggerCascata(generazioneTop) {
  const genTop = Number(generazioneTop);

  if (!genTop || Number.isNaN(genTop) || genTop < 1) {
    throw new Error(`generazioneTop non valida: ${generazioneTop}`);
  }

  // Determina il movimento della generazione trigger
  const state = await getGenerationState(genTop);

  if (!state) {
    throw new Error(`Generazione H${genTop} non trovata nel sistema`);
  }

  console.log(`\n🎯 TRIGGER CASCATA VASI COMUNICANTI`);
  console.log(`   Generazione: H${genTop}`);
  console.log(`   Movimento: ${state.movimento}`);
  console.log(`   Ciclo: ${state.ciclo}`);

  // Routing basato sul movimento
  if (state.movimento === 'LARGE') {
    return await triggerCascataLarge(genTop);
  } else {
    // SMALL o MEDIUM → stessa cascata
    return await triggerCascataSmallMedium(genTop);
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Entry point principale
  triggerCascata,
  
  // Cascate specifiche (per testing/debugging)
  triggerCascataSmallMedium,
  triggerCascataLarge,
  
  // Helper functions
  getGenerationState,
  haCompletedMovement,
  getPreviousGeneration
};
