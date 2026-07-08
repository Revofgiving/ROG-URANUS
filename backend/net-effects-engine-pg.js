/**
 * 💰 ROG NET EFFECTS ENGINE - PostgreSQL VERSION
 *
 * Implementa gli effetti economici netti per ogni ciclo completato
 * in SMALL, MEDIUM e LARGE, secondo le specifiche del documento:
 *
 * SMALL (3 cicli):
 * - 1° ciclo: tutto a ROG (accantonamenti)
 * - 2° ciclo: ricevente accumula 2 USDC per ingresso MEDIUM
 * - 3° ciclo: ricevente accumula 8 USDC (4+4 da D1+D2), totale 10 USDC;
 *              D3 genera 4 nuove posizioni SMALL (2 HUMAN + 2 PILETTE)
 *
 * MEDIUM (3 cicli):
 * - 1° ciclo: D1+D2 generano 20 posizioni SMALL (10 HUMAN + 10 PILETTE)
 * - 2° ciclo: ricevente accumula 20 USDC per ingresso LARGE
 * - 3° ciclo: ricevente accumula 80 USDC, totale 100 USDC
 *
 * LARGE (8 cicli):
 * - 1°-4° ciclo: distribuzione USDC diretta ai riceventi (200/400/800/1600)
 * - 5° ciclo: 1968 USDC + 32 posizioni SMALL (16 HUMAN + 16 PILETTE)
 * - 6°-8° ciclo: distribuzione USDC (3000/7000/10000)
 * - PILETTE: ogni dono LARGE → 100% convertito in posizioni SMALL
 *            (50% PILETTA, 10% AVENGERS, 40% ROG)
 * - PONTI: gestione 0/1/≥2 invitati (50%/75%/100% del dono)
 *
 * @version 1.0.0
 * @author Warp AI Agent (NASA-level)
 */

const pg = require('./pg-connection-manager');
const dbPg = require('./db-unified-manager-pg');
const positionCreator = require('./position-creator');
const largeDistribution = require('./large-distribution-engine-pg');

// ========================================
// COSTANTI DISTRIBUZIONE
// ========================================

const SPECIAL_WALLETS = {
  ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
  PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe',
  AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972'
};

// SMALL: effetti per ciclo (importi per donante)
const SMALL_EFFECTS = {
  1: {
    // Ciclo 1: tutto a ROG/accantonamenti, nessun accumulo ricevente
    D1: { to: 'ROG', amount: 1 },
    D2: { to: 'ROG', amount: 1 },
    D3: { to: 'ACCANTONAMENTO', amount: 1 },
    D4: { to: 'ACCANTONAMENTO', amount: 1 },
    receiverAccumulo: 0
  },
  2: {
    // Ciclo 2: ricevente accumula 2 USDC (da D1)
    D1: { to: 'ACCUMULO_RICEVENTE', amount: 2 },
    D2: { to: 'ROG', amount: 2 },
    D3: { to: 'ACCANTONAMENTO', amount: 2 },
    D4: { to: 'ACCANTONAMENTO', amount: 2 },
    receiverAccumulo: 2
  },
  3: {
    // Ciclo 3: ricevente accumula 8 USDC (4+4 da D1+D2), D3 genera 4 pos
    D1: { to: 'ACCUMULO_RICEVENTE', amount: 4 },
    D2: { to: 'ACCUMULO_RICEVENTE', amount: 4 },
    D3: { to: 'NUOVE_POSIZIONI', amount: 4, positions: 4 }, // 2 HUMAN + 2 PILETTA
    D4: { to: 'ROG', amount: 4 },
    receiverAccumulo: 8
  }
};

// MEDIUM: effetti per ciclo
const MEDIUM_EFFECTS = {
  1: {
    // Ciclo 1: D1+D2 generano 20 posizioni SMALL (10 coppie)
    D1: { to: 'NUOVE_POSIZIONI', amount: 10, positions: 10 }, // 5 HUMAN + 5 PILETTA
    D2: { to: 'NUOVE_POSIZIONI', amount: 10, positions: 10 }, // 5 HUMAN + 5 PILETTA
    D3: { to: 'ACCANTONAMENTO', amount: 10 },
    D4: { to: 'ACCANTONAMENTO', amount: 10 },
    receiverAccumulo: 0
  },
  2: {
    // Ciclo 2: ricevente accumula 20 USDC (da D2)
    D1: { to: 'ROG', amount: 20 },
    D2: { to: 'ACCUMULO_RICEVENTE', amount: 20 },
    D3: { to: 'ACCANTONAMENTO', amount: 20 },
    D4: { to: 'ACCANTONAMENTO', amount: 20 },
    receiverAccumulo: 20
  },
  3: {
    // Ciclo 3: ricevente accumula 80 USDC (40+40 da D1+D2), totale 100
    D1: { to: 'ACCUMULO_RICEVENTE', amount: 40 },
    D2: { to: 'ACCUMULO_RICEVENTE', amount: 40 },
    D3: { to: 'ROG', amount: 40 },
    D4: { to: 'ROG', amount: 40 },
    receiverAccumulo: 80
  }
};

// LARGE: effetti per ciclo (valori base per ricevente con ≥2 invitati)
const LARGE_EFFECTS = {
  1: { receiver: 200, accantonamento: 200 },
  2: { receiver: 400, accantonamento: 400 },
  3: { receiver: 800, accantonamento: 800 },
  4: { receiver: 1600, accantonamento: 1600 },
  5: { receiver: 1968, accantonamento: 1600, positions: 32, rog: 1200 }, // 16 HUMAN + 16 PILETTA
  6: { receiver: 3000, accantonamento: 3200, rog: 3400 },
  7: { receiver: 7000, accantonamento: 6400, rog: 5800 },
  8: { receiver: 10000, accantonamento: 0, rog: 41200 } // Ultimo ciclo
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function normalizeWallet(w) {
  return String(w || '').trim().toLowerCase();
}

async function queryOne(sql, params = []) {
  return await pg.queryOne(sql, params);
}

async function queryMany(sql, params = []) {
  return await pg.queryMany(sql, params);
}

/**
 * Ottiene tutti i riceventi di una generazione in un movimento
 */
async function getReceiversInGeneration(movimento, generazioneNativa) {
  return await queryMany(
    `SELECT posizione, wallet, ciclo_corrente, ruolo_corrente,
            molecola_creazione, generazione_small_nativa
     FROM posizioni_stato
     WHERE movimento_corrente = $1
       AND ruolo_corrente = 'RICEVENTE'
       AND generazione_small_nativa = $2
     ORDER BY posizione ASC`,
    [movimento, generazioneNativa]
  );
}

/**
 * Ottiene il tipo di posizione (HUMAN/PILETTA/ROG/AVENGERS)
 */
async function getPositionType(posizione) {
  const pos = await dbPg.getPosition(posizione);
  if (!pos) return 'HUMAN'; // default
  
  const wallet = normalizeWallet(pos.wallet);
  if (wallet === normalizeWallet(SPECIAL_WALLETS.PILETTA)) return 'PILETTA';
  if (wallet === normalizeWallet(SPECIAL_WALLETS.ROG)) return 'ROG';
  if (wallet === normalizeWallet(SPECIAL_WALLETS.AVENGERS)) return 'AVENGERS';
  return 'HUMAN';
}

/**
 * Aggiorna accumulo_small nel wallet_master (PostgreSQL)
 */
async function updateAccumuloSmall(wallet, amount) {
  await pg.query(
    `UPDATE wallet_master
     SET accumulo_small = COALESCE(accumulo_small, 0) + $1,
         updated_at = NOW()
     WHERE wallet = $2`,
    [amount, normalizeWallet(wallet)]
  );
}

/**
 * Aggiorna accumulo_medium nel wallet_master (PostgreSQL)
 */
async function updateAccumuloMedium(wallet, amount) {
  await pg.query(
    `UPDATE wallet_master
     SET accumulo_medium = COALESCE(accumulo_medium, 0) + $1,
         updated_at = NOW()
     WHERE wallet = $2`,
    [amount, normalizeWallet(wallet)]
  );
}

// ========================================
// EFFETTI NETTI SMALL
// ========================================

/**
 * Applica effetti netti per SMALL (ciclo 1-3)
 */
async function applyNetEffectsSmall({ generazioneNativa, ciclo }) {
  const receivers = await getReceiversInGeneration('SMALL', generazioneNativa);
  const effects = SMALL_EFFECTS[ciclo];
  
  if (!effects) {
    return {
      applied: false,
      reason: `Ciclo ${ciclo} non valido per SMALL (1-3)`,
      movimento: 'SMALL',
      generazioneNativa,
      ciclo
    };
  }

  const results = {
    movimento: 'SMALL',
    generazioneNativa,
    ciclo,
    receivers: receivers.length,
    accumuli: [],
    newPositions: []
  };

  for (const receiver of receivers) {
    const wallet = normalizeWallet(receiver.wallet);
    const posType = await getPositionType(receiver.posizione);

    // Accumulo per ricevente (se previsto dal ciclo)
    if (effects.receiverAccumulo > 0) {
      await updateAccumuloSmall(wallet, effects.receiverAccumulo);
      results.accumuli.push({
        wallet,
        posizione: receiver.posizione,
        tipo: posType,
        amount: effects.receiverAccumulo
      });
    }

    // Generazione nuove posizioni (ciclo 3, D3)
    if (ciclo === 3 && effects.D3.to === 'NUOVE_POSIZIONI') {
      // 4 USDC → 2 coppie HUMAN+PILETTA (4 posizioni totali)
      const newPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: wallet,
        nomeDonatore: receiver.nome || `Pos ${receiver.posizione}`,
        importoEUR: effects.D3.amount,
        timestamp: new Date().toISOString(),
        walletInvitante: wallet, // auto-generazione
        nomeInvitante: receiver.nome || `Pos ${receiver.posizione}`
      });

      if (newPosResult.success) {
        results.newPositions.push({
          wallet,
          posizione: receiver.posizione,
          created: newPosResult.posizioniCreate,
          firstPos: newPosResult.primaPositzione,
          lastPos: newPosResult.ultimaPositzione
        });
      }
    }
  }

  return {
    applied: true,
    ...results
  };
}

// ========================================
// EFFETTI NETTI MEDIUM
// ========================================

/**
 * Applica effetti netti per MEDIUM (ciclo 1-3)
 */
async function applyNetEffectsMedium({ generazioneNativa, ciclo }) {
  const receivers = await getReceiversInGeneration('MEDIUM', generazioneNativa);
  const effects = MEDIUM_EFFECTS[ciclo];
  
  if (!effects) {
    return {
      applied: false,
      reason: `Ciclo ${ciclo} non valido per MEDIUM (1-3)`,
      movimento: 'MEDIUM',
      generazioneNativa,
      ciclo
    };
  }

  const results = {
    movimento: 'MEDIUM',
    generazioneNativa,
    ciclo,
    receivers: receivers.length,
    accumuli: [],
    newPositions: []
  };

  for (const receiver of receivers) {
    const wallet = normalizeWallet(receiver.wallet);
    const posType = await getPositionType(receiver.posizione);

    // Accumulo per ricevente (ciclo 2-3)
    if (effects.receiverAccumulo > 0) {
      await updateAccumuloMedium(wallet, effects.receiverAccumulo);
      results.accumuli.push({
        wallet,
        posizione: receiver.posizione,
        tipo: posType,
        amount: effects.receiverAccumulo
      });
    }

    // Generazione nuove posizioni (ciclo 1, D1+D2 → 20 pos)
    if (ciclo === 1) {
      // 10 USDC (D1) + 10 USDC (D2) → 20 posizioni (10 coppie)
      const totalAmount = effects.D1.amount + effects.D2.amount;
      const newPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: wallet,
        nomeDonatore: receiver.nome || `Pos ${receiver.posizione}`,
        importoEUR: totalAmount,
        timestamp: new Date().toISOString(),
        walletInvitante: wallet,
        nomeInvitante: receiver.nome || `Pos ${receiver.posizione}`
      });

      if (newPosResult.success) {
        results.newPositions.push({
          wallet,
          posizione: receiver.posizione,
          created: newPosResult.posizioniCreate,
          firstPos: newPosResult.primaPositzione,
          lastPos: newPosResult.ultimaPositzione
        });
      }
    }
  }

  return {
    applied: true,
    ...results
  };
}

// ========================================
// EFFETTI NETTI LARGE
// ========================================

/**
 * Applica effetti netti per LARGE (ciclo 1-8)
 * 
 * INTEGRATO con large-distribution-engine-pg.js per:
 * - Transazioni USDC on-chain con ponti (0/1/≥2 invitati)
 * - PILETTE: 100% nuove posizioni (50% PILETTA, 10% AVENGERS, 40% ROG)
 * - Ciclo 5: +32 posizioni SMALL
 */
async function applyNetEffectsLarge({ generazioneNativa, ciclo }) {
  const receivers = await getReceiversInGeneration('LARGE', generazioneNativa);
  const effects = LARGE_EFFECTS[ciclo];
  
  if (!effects) {
    return {
      applied: false,
      reason: `Ciclo ${ciclo} non valido per LARGE (1-8)`,
      movimento: 'LARGE',
      generazioneNativa,
      ciclo
    };
  }

  const results = {
    movimento: 'LARGE',
    generazioneNativa,
    ciclo,
    receivers: receivers.length,
    distributions: [],
    newPositions: []
  };

  // Array per batch distribution
  const receiversForDistribution = [];

  for (const receiver of receivers) {
    const wallet = normalizeWallet(receiver.wallet);
    const posType = await getPositionType(receiver.posizione);

    // PILETTA: dono → 100% nuove posizioni SMALL (50% PILETTA, 10% AVENGERS, 40% ROG)
    if (posType === 'PILETTA') {
      const totalDono = effects.receiver;
      
      // 50% PILETTA
      const pilettaAmount = Math.floor(totalDono * 0.50);
      const pilettaPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: SPECIAL_WALLETS.PILETTA,
        nomeDonatore: 'PILETTA',
        importoEUR: pilettaAmount,
        timestamp: new Date().toISOString(),
        walletInvitante: SPECIAL_WALLETS.PILETTA,
        nomeInvitante: 'PILETTA'
      });

      // 10% AVENGERS
      const avengersAmount = Math.floor(totalDono * 0.10);
      const avengersPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: SPECIAL_WALLETS.AVENGERS,
        nomeDonatore: 'AVENGERS',
        importoEUR: avengersAmount,
        timestamp: new Date().toISOString(),
        walletInvitante: SPECIAL_WALLETS.AVENGERS,
        nomeInvitante: 'AVENGERS'
      });

      // 40% ROG
      const rogAmount = Math.floor(totalDono * 0.40);
      const rogPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: SPECIAL_WALLETS.ROG,
        nomeDonatore: 'ROG',
        importoEUR: rogAmount,
        timestamp: new Date().toISOString(),
        walletInvitante: SPECIAL_WALLETS.ROG,
        nomeInvitante: 'ROG'
      });

      results.newPositions.push({
        wallet,
        posizione: receiver.posizione,
        tipo: 'PILETTA',
        piletta: pilettaPosResult.success ? pilettaPosResult.posizioniCreate : 0,
        avengers: avengersPosResult.success ? avengersPosResult.posizioniCreate : 0,
        rog: rogPosResult.success ? rogPosResult.posizioniCreate : 0
      });

      continue; // PILETTA non riceve USDC, solo nuove posizioni
    }

    // HUMAN/ROG/AVENGERS: distribuzione USDC con large-distribution-engine
    receiversForDistribution.push({
      wallet,
      posizione: receiver.posizione,
      molecola: receiver.molecola_creazione,
      amount: effects.receiver
    });

    // Ciclo 5: +32 posizioni SMALL (solo per HUMAN)
    if (ciclo === 5 && effects.positions === 32 && posType === 'HUMAN') {
      const newPosResult = await positionCreator.creaPosizioniDaDonazione({
        walletDonatore: wallet,
        nomeDonatore: receiver.nome || `Pos ${receiver.posizione}`,
        importoEUR: 32, // 32 USDC → 16 coppie HUMAN+PILETTA
        timestamp: new Date().toISOString(),
        walletInvitante: wallet,
        nomeInvitante: receiver.nome || `Pos ${receiver.posizione}`
      });

      if (newPosResult.success) {
        results.newPositions.push({
          wallet,
          posizione: receiver.posizione,
          tipo: posType,
          created: newPosResult.posizioniCreate,
          firstPos: newPosResult.primaPositzione,
          lastPos: newPosResult.ultimaPositzione
        });
      }
    }
  }

  // Processa distribuzioni LARGE in batch con large-distribution-engine
  if (receiversForDistribution.length > 0) {
    console.log(`💸 Processando ${receiversForDistribution.length} distribuzioni LARGE on-chain...`);
    const distributionResult = await largeDistribution.processBatchDistributions({
      generazioneNativa,
      ciclo,
      receivers: receiversForDistribution
    });

    results.distributions = distributionResult.results || [];
    results.distributionSummary = {
      total: distributionResult.total,
      success: distributionResult.successCount,
      failed: distributionResult.failedCount
    };
  }

  return {
    applied: true,
    ...results
  };
}

// ========================================
// ENTRY POINT PRINCIPALE
// ========================================

/**
 * Applica gli effetti netti per una generazione/movimento/ciclo
 * @param {Object} params
 * @param {string} params.movimento - 'SMALL' | 'MEDIUM' | 'LARGE'
 * @param {number} params.generazioneNativa - H nativo (2..12+)
 * @param {number} params.ciclo - ciclo corrente (1-3 o 1-8)
 * @returns {Promise<Object>} risultato applicazione effetti
 */
async function applyNetEffectsForGenerationPg({ movimento, generazioneNativa, ciclo }) {
  const m = String(movimento || '').toUpperCase();
  const gen = Number(generazioneNativa);
  const c = Number(ciclo);

  if (!['SMALL', 'MEDIUM', 'LARGE'].includes(m)) {
    throw new Error(`Movimento non valido: ${movimento}`);
  }

  if (!gen || Number.isNaN(gen) || gen < 1) {
    throw new Error(`generazioneNativa non valida: ${generazioneNativa}`);
  }

  if (!c || Number.isNaN(c) || c < 1) {
    throw new Error(`ciclo non valido: ${ciclo}`);
  }

  console.log(`\n💰 ========================================`);
  console.log(`   APPLICAZIONE NET EFFECTS`);
  console.log(`========================================`);
  console.log(`📍 Movimento: ${m}`);
  console.log(`📊 Generazione: H${gen}`);
  console.log(`🔄 Ciclo: ${c}`);
  console.log(``);

  let result;

  switch (m) {
    case 'SMALL':
      result = await applyNetEffectsSmall({ generazioneNativa: gen, ciclo: c });
      break;
    case 'MEDIUM':
      result = await applyNetEffectsMedium({ generazioneNativa: gen, ciclo: c });
      break;
    case 'LARGE':
      result = await applyNetEffectsLarge({ generazioneNativa: gen, ciclo: c });
      break;
    default:
      throw new Error(`Movimento non implementato: ${m}`);
  }

  if (result.applied) {
    console.log(`✅ Effetti applicati con successo:`);
    console.log(`   Riceventi: ${result.receivers}`);
    if (result.accumuli?.length > 0) {
      console.log(`   Accumuli aggiornati: ${result.accumuli.length}`);
    }
    if (result.newPositions?.length > 0) {
      console.log(`   Nuove posizioni create: ${result.newPositions.length} riceventi`);
    }
    if (result.distributions?.length > 0) {
      console.log(`   Distribuzioni LARGE: ${result.distributions.length}`);
    }
  } else {
    console.log(`⚠️  Effetti non applicati: ${result.reason}`);
  }

  console.log(`========================================\n`);

  return result;
}

module.exports = {
  applyNetEffectsForGenerationPg,
  // Export singoli per testing
  applyNetEffectsSmall,
  applyNetEffectsMedium,
  applyNetEffectsLarge,
  // Costanti
  SMALL_EFFECTS,
  MEDIUM_EFFECTS,
  LARGE_EFFECTS,
  SPECIAL_WALLETS
};
