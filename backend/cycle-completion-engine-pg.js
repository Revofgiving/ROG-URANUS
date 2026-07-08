/**
 * 🔁 CYCLE COMPLETION ENGINE - PostgreSQL VERSION
 *
 * Collegamento tra donazioni (unità = 2 USDC = 1 coppia HUMAN+PILETTA)
 * e logica di cicli / stelline / avanzamenti per SMALL, MEDIUM, LARGE.
 *
 * Questa versione usa SOLO PostgreSQL e chiama avanzamento-manager-pg per:
 * - assegnare stelline ai riceventi (tramite onde globali di generazione),
 * - avanzare i ruoli nelle molecole,
 * - gestire i passaggi SMALL→MEDIUM, MEDIUM→LARGE e la pulizia LARGE.
 *
 * NOTA: gli effetti economici (accumuli, nuove posizioni SMALL, percentuali ROG)
 * saranno implementati in uno step successivo, usando le tabelle PG dedicate.
 */

const pg = require('./pg-connection-manager');
const avanzamentoManagerPg = require('./avanzamento-manager-pg');
const netEffectsEngine = require('./net-effects-engine-pg');

function normalizeWallet(w) {
  return String(w || '').trim().toLowerCase();
}

function normalizeTxHash(h) {
  return String(h || '').trim().toLowerCase();
}

// Helpers PG
async function queryOne(sql, params = []) {
  const row = await pg.queryOne(sql, params);
  return row || null;
}

async function queryMany(sql, params = []) {
  const rows = await pg.queryMany(sql, params);
  return rows || [];
}

async function queryRun(sql, params = []) {
  const client = await pg.getClient();
  try {
    const res = await client.query(sql, params);
    return { rowCount: res.rowCount || 0 };
  } finally {
    client.release();
  }
}

/**
 * Restituisce le posizioni DONANTE attive per un wallet, ordinate per posizione.
 * Fonte: posizioni_stato (PG), nessuna dipendenza da SQLite.
 */
async function listDonorPositionsForWalletPg(walletLower) {
  await avanzamentoManagerPg.inizializzaDatabase();

  const sql = `
    SELECT
      posizione,
      wallet,
      molecola_creazione AS molecola,
      movimento_corrente AS movimento,
      ciclo_corrente AS ciclo,
      ruolo_corrente
    FROM posizioni_stato
    WHERE wallet = $1
      AND movimento_corrente IN ('SMALL','MEDIUM','LARGE')
      AND ruolo_corrente LIKE 'DONANTE%'
    ORDER BY posizione ASC
  `;

  return await queryMany(sql, [walletLower]);
}

async function hasCycleActionForDonorPosPg(donorPosizione, movimento, ciclo) {
  const row = await queryOne(
    'SELECT 1 AS ok FROM donor_cycle_actions WHERE donor_posizione = $1 AND movimento = $2 AND ciclo = $3 LIMIT 1',
    [donorPosizione, movimento, ciclo]
  );
  return !!row;
}

async function markDonorUnitPg({ donorWallet, donorPosizione, movimento, molecola, ciclo, chainTxHash, unitIndex, timestamp }) {
  await queryRun(
    `INSERT INTO donor_cycle_actions
      (donor_wallet, donor_posizione, movimento, molecola, ciclo, chain_tx_hash, unit_index, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [donorWallet, donorPosizione, movimento, molecola, ciclo, chainTxHash, unitIndex, timestamp || new Date().toISOString()]
  );
}

async function isMolecolaCycleCompletedPg(movimento, molecola, ciclo) {
  const row = await queryOne(
    `SELECT COUNT(DISTINCT donor_posizione) AS cnt
     FROM donor_cycle_actions
     WHERE movimento = $1 AND molecola = $2 AND ciclo = $3`,
    [movimento, molecola, ciclo]
  );

  return (Number(row?.cnt) || 0) >= 4;
}

async function markMolecolaCycleCompletedPg({ movimento, molecola, ciclo, generazioneNativa }) {
  await queryRun(
    `INSERT INTO molecola_cycle_completed
      (movimento, molecola, ciclo, generazione_nativa)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [movimento, molecola, ciclo, generazioneNativa ?? null]
  );
}

async function getReceiverForMolecolaPg(movimento, molecola) {
  return await queryOne(
    `SELECT posizione, wallet, generazione_small_nativa AS generazione_nativa, ciclo_corrente
     FROM posizioni_stato
     WHERE movimento_corrente = $1
       AND molecola_creazione = $2
       AND ruolo_corrente = 'RICEVENTE'
     LIMIT 1`,
    [movimento, molecola]
  );
}

async function countReceiversInGenerationPg(movimento, generazioneNativa) {
  const row = await queryOne(
    `SELECT COUNT(*) AS cnt
     FROM posizioni_stato
     WHERE movimento_corrente = $1
       AND ruolo_corrente = 'RICEVENTE'
       AND generazione_small_nativa = $2`,
    [movimento, generazioneNativa]
  );
  return Number(row?.cnt) || 0;
}

async function countCompletedMolecoleInGenerationPg(movimento, generazioneNativa, ciclo) {
  const row = await queryOne(
    `SELECT COUNT(*) AS cnt
     FROM molecola_cycle_completed
     WHERE movimento = $1
       AND generazione_nativa = $2
       AND ciclo = $3`,
    [movimento, generazioneNativa, ciclo]
  );
  return Number(row?.cnt) || 0;
}

/**
 * Applica effetti economici netti per una generazione/movimento/ciclo.
 * 
 * Delega a net-effects-engine-pg per:
 * - SMALL: accumuli + 4 posizioni (ciclo 3)
 * - MEDIUM: accumuli + 20 posizioni (ciclo 1)
 * - LARGE: distribuzioni USDC + 32 posizioni (ciclo 5) + PILETTE speciali
 */
async function applyNetEffectsForGenerationPg({ movimento, generazioneNativa, ciclo }) {
  return await netEffectsEngine.applyNetEffectsForGenerationPg({
    movimento,
    generazioneNativa,
    ciclo
  });
}

/**
 * Se tutte le molecole della generazione (per il ciclo corrente) sono complete,
 * applica gli effetti netti e innesca l'onda di avanzamento PG.
 */
async function maybeAdvanceGenerationWavePg({ movimento, generazioneNativa }) {
  const m = String(movimento || '').toUpperCase();
  const gen = Number(generazioneNativa);
  if (!gen || Number.isNaN(gen)) {
    throw new Error(`generazioneNativa non valida: ${generazioneNativa}`);
  }

  await avanzamentoManagerPg.inizializzaDatabase();

  // Determina il ciclo corrente dai riceventi (assumiamo omogeneo a livello generazione)
  const sample = await queryOne(
    `SELECT ciclo_corrente AS ciclo
     FROM posizioni_stato
     WHERE movimento_corrente = $1
       AND ruolo_corrente = 'RICEVENTE'
       AND generazione_small_nativa = $2
     ORDER BY posizione ASC
     LIMIT 1`,
    [m, gen]
  );

  const ciclo = Number(sample?.ciclo) || 1;

  const totalReceivers = await countReceiversInGenerationPg(m, gen);
  const completedMolecole = await countCompletedMolecoleInGenerationPg(m, gen, ciclo);

  if (totalReceivers === 0) {
    return { advanced: false, reason: 'Nessun ricevente per generazione', ciclo };
  }

  if (completedMolecole < totalReceivers) {
    return {
      advanced: false,
      reason: 'Generazione non ancora completa',
      ciclo,
      totalReceivers,
      completedMolecole
    };
  }

  // 1) Applica effetti netti per quel ciclo (stub per ora)
  const effects = await applyNetEffectsForGenerationPg({ movimento: m, generazioneNativa: gen, ciclo });

  // 2) Registra completamento generazione + avanza onda globale (PG)
  await avanzamentoManagerPg.registraCompletamentoGenerazione(m, gen);
  const avanzamento = await avanzamentoManagerPg.avanzaInteraGenerazione(m, gen);

  return {
    advanced: true,
    movimento: m,
    generazione_nativa: gen,
    ciclo,
    totalReceivers,
    completedMolecole,
    effects,
    avanzamento
  };
}

/**
 * Entry point PG: da usare quando una donazione è stata completata
 * (in termini di creazione posizioni) e vogliamo assegnare le unità
 * di donazione alle posizioni DONANTE del wallet.
 */
async function processDonationCompletedPg({ donorWallet, donationUnits, chainTxHash, timestamp }) {
  const donor = normalizeWallet(donorWallet);
  const tx = normalizeTxHash(chainTxHash);

  if (!donor || !tx || !Number.isFinite(Number(donationUnits)) || donationUnits <= 0) {
    return { success: false, reason: 'Invalid input (PG)' };
  }

  await avanzamentoManagerPg.inizializzaDatabase();

  const donorPositions = await listDonorPositionsForWalletPg(donor);

  let assigned = 0;
  let unassigned = 0;
  const completedMolecules = [];
  const advancedGenerations = [];
  const readyLargeGenerations = [];

  for (let unitIndex = 0; unitIndex < donationUnits; unitIndex++) {
    // Idempotenza per tx/unit
    const existsTxUnit = await queryOne(
      'SELECT 1 AS ok FROM donor_cycle_actions WHERE chain_tx_hash = $1 AND unit_index = $2 LIMIT 1',
      [tx, unitIndex]
    );
    if (existsTxUnit?.ok) continue;

    // Trova una posizione donante che non abbia già donato nel suo ciclo corrente
    let chosen = null;
    for (const p of donorPositions) {
      const movimento = String(p.movimento || '').toUpperCase();
      const ciclo = Number(p.ciclo) || 1;

      if (!['SMALL', 'MEDIUM', 'LARGE'].includes(movimento)) continue;

      const alreadyDone = await hasCycleActionForDonorPosPg(p.posizione, movimento, ciclo);
      if (!alreadyDone) {
        chosen = { ...p, movimento, ciclo };
        break;
      }
    }

    if (!chosen) {
      unassigned++;
      continue;
    }

    await markDonorUnitPg({
      donorWallet: donor,
      donorPosizione: chosen.posizione,
      movimento: chosen.movimento,
      molecola: Number(chosen.molecola),
      ciclo: Number(chosen.ciclo),
      chainTxHash: tx,
      unitIndex,
      timestamp
    });

    assigned++;

    // Se molecola completata per quel ciclo, registrala.
    const molecola = Number(chosen.molecola);
    const ciclo = Number(chosen.ciclo);

    const isCompleted = await isMolecolaCycleCompletedPg(chosen.movimento, molecola, ciclo);
    if (!isCompleted) continue;

    const receiver = await getReceiverForMolecolaPg(chosen.movimento, molecola);
    if (!receiver) continue;

    await markMolecolaCycleCompletedPg({
      movimento: chosen.movimento,
      molecola,
      ciclo,
      generazioneNativa: receiver.generazione_nativa
    });

    completedMolecules.push({
      movimento: chosen.movimento,
      molecola,
      ciclo,
      generazione_nativa: receiver.generazione_nativa
    });

    // Se con questo completamento la generazione è completa, avanza.
    if (['SMALL', 'MEDIUM'].includes(chosen.movimento)) {
      const adv = await maybeAdvanceGenerationWavePg({
        movimento: chosen.movimento,
        generazioneNativa: receiver.generazione_nativa
      });
      if (adv.advanced) {
        advancedGenerations.push({
          movimento: chosen.movimento,
          generazione_nativa: receiver.generazione_nativa,
          ...adv
        });
      }
    }

    // LARGE: non avanziamo qui (serve prima completare distribuzioni on-chain),
    // ma possiamo marcare "pronto" quando tutti i riceventi della generazione
    // hanno completato il ciclo (registrazione in generation_cycle_ready).
    if (chosen.movimento === 'LARGE') {
      const totalReceivers = await countReceiversInGenerationPg('LARGE', receiver.generazione_nativa);
      const completedMolecole = await countCompletedMolecoleInGenerationPg('LARGE', receiver.generazione_nativa, ciclo);

      if (totalReceivers > 0 && completedMolecole >= totalReceivers) {
        await queryRun(
          `INSERT INTO generation_cycle_ready (movimento, generazione_nativa, ciclo, created_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT DO NOTHING`,
          ['LARGE', receiver.generazione_nativa, ciclo]
        );

        readyLargeGenerations.push({
          movimento: 'LARGE',
          generazione_nativa: receiver.generazione_nativa,
          ciclo,
          totalReceivers,
          completedMolecole
        });
      }
    }
  }

  return {
    success: true,
    donor,
    txHash: tx,
    donationUnits,
    assigned,
    unassigned,
    completedMolecules,
    advancedGenerations,
    readyLargeGenerations
  };
}

module.exports = {
  processDonationCompletedPg,
  // Esportiamo anche helper per eventuali test/diagnostica
  listDonorPositionsForWalletPg,
  maybeAdvanceGenerationWavePg
};
