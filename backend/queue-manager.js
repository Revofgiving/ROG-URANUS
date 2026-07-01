/**
 * 🎯 SUPERURANO — Queue Manager (Nettuno — coda FIFO)
 *
 * Secondo stadio del sistema SUPERURANO.
 * Le persone entrano QUI automaticamente quando escono da URANO 2 (tavole).
 *
 * Modello:
 *   Ogni posizione esce quando ha 108 posizioni dedicate dopo di sé.
 *   Uscita HUMAN:     1.080 − 60 (6 rientri INDIVIDUAL) − 100 (PHARAOH) − 40 (Sole L0) = 880 netto
 *                     → − 80 ROG SMALL (20 base + 60 nuovi) = 800 USDC wallet (ACCETTA DONO)
 *   Uscita CASSA:     1.080 − 180 (18 rientri INDIVIDUAL) − 60 (ROG SMALL) − 100 (PHARAON) − 40 (Sole L0) = 700 accantonamento
 */
'use strict';

const pg           = require('./pg-connection-manager');
const db           = require('./db-manager');
const tableManager = require('./table-manager');
const asyncQ       = require('./async-queue');
const cassaTransfer = require('./cassa-transfer-manager');
const crossPlatform = require('./cross-platform-bridge');

// USDC.e (token ROG distribuito) — usato per leggere il saldo reale della cassa
// nell'invariante di solvibilità. Override via env USDC_CONTRACT_ADDRESS.
const USDC_CONTRACT_CASSA = (process.env.USDC_CONTRACT_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');

// ── COSTANTI FIFO ─────────────────────────────────────────────

const FIFO = {
  DONO_PER_POSIZIONE:    10,
  POSIZIONI_PER_USCITA: 108,
  LORDO_PER_USCITA:    1080,

  // HUMAN — deduzioni pre-distribuzione
  RIENTRI_HUMAN:          6,
  COSTO_RIENTRI_HUMAN:   60,
  ROG_SMALL_HUMAN:       20,     // 10 ingressi dual × 2 USDC (pre-distribuzione)
  NETTO_HUMAN:          800,     // 800 USDC in tasca (aggiornato sessione 4: era 1.000)

  // HUMAN — distribuzione netto 1.000 (sessione 4)
  PHARAOH_HUMAN:        100,     // PHARAOH SINGOLO — accantonato in cassa URANUS (PHARAOH_PENDING) fino all'avvio di PHARAOH
  ROG_SMALL_HUMAN_NUOVI: 60,     // 30 ingressi dual ROG SMALL × 2 USDC
  SOLE_L0_URANUS_HUMAN:  40,     // 2 ingressi dual Sole L0 URANUS × 20 USDC

  // CASSA
  RIENTRI_CASSA:         18,
  COSTO_RIENTRI_CASSA:  180,
  ROG_SMALL_CASSA:       60,     // 30 ingressi dual × 2 USDC (allineato schema)
  CONTRIBUTO_PHARAON:   100,     // contributo PHARAON
  SOLE_L0_URANUS_CASSA:  40,     // 2 ingressi dual × 20 USDC → 4 pos a nome CASSA-URANUS
  ACCANTONAMENTO_CASSA: 700,

  COSTO_RIENTRO:         10,
};

// ── RIENTRO SINGOLO A SOLE ──────────────────────────────────────────────
// Posiziona 1 singola posizione a L0 Sole (stessa logica di bridge-manager).
async function posizionaRientroSoleUnico(wallet, nome) {
  const turno = await db.getTurnoCorrente('ENTRATA', 0);
  if (!turno) { console.log(`   ⚠️  Nettuno: nessun turno Sole attivo`); return null; }
  const tavola = await tableManager.getTavolaPercorsoAttiva(0, turno.numero_turno);
  if (!tavola) { console.log(`   ⚠️  Nettuno: nessuna tavola Sole aperta`); return null; }
  await tableManager.posizionaDonatore({
    tavolaId: tavola.id, tavolaNumero: tavola.numero, livello: 0,
    wallet, nome, tipo: 'DONATORE', donoImporto: 10,
    turno: turno.numero_turno, sdoppiabile: true
  });
  await db.incrementSacerdotiEntrati(turno.id);
}

// ── INVARIANTE DI SOLVIBILITÀ ───────────────────────────────────────────
// Legge il saldo USDC.e reale del wallet cassa-Uranus. Ritorna un numero
// (USDC) oppure null se non leggibile (RPC/wallet non configurati o errore).
async function getSaldoCassaUsdc() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const cassa  = process.env.URANO_FUND_WALLET || process.env.CASSA_WALLET;
  if (!rpcUrl || !cassa) return null;
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const usdc = new ethers.Contract(
      USDC_CONTRACT_CASSA,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const bal = await usdc.balanceOf(cassa);
    return Number(ethers.utils.formatUnits(bal, 6));
  } catch (e) {
    console.warn(`\u26a0\ufe0f  [Solvibilit\u00e0] Lettura saldo cassa fallita: ${e.message}`);
    return null;
  }
}

// ── STATO ──────────────────────────────────────────────────────────────

async function getStatoFifo() {
  const row = await pg.queryOne(`SELECT value FROM state_persistence WHERE key = 'fifo_sistema'`);
  return row?.value || null;
}

async function setStatoFifo(value) {
  await pg.query(
    `INSERT INTO state_persistence (key, value, updated_at) VALUES ('fifo_sistema', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(value)]
  );
}

// ── INIZIALIZZAZIONE FIFO ─────────────────────────────────────

async function inizializzaFifo() {
  const stato = await getStatoFifo();
  if (stato?.inizializzato) return stato;

  console.log('\n🎯 Inizializzazione Nettuno (coda FIFO)');

  const nuovoStato = {
    inizializzato: true,
    prossima_posizione: 0,
    prossima_uscita: 1,
    rientri_pool: 0,
    totale_uscite: 0,
  };
  await setStatoFifo(nuovoStato);
  console.log('\u2705 Nettuno (FIFO) inizializzato');
  return nuovoStato;
}

// ── AGGIUNGI POSIZIONE ────────────────────────────────────────

async function aggiungiPosizione({ wallet, nome, tipo, isRientro = false, generazione = 0 }) {
  let stato = await getStatoFifo();
  if (!stato?.inizializzato) stato = await inizializzaFifo();

  const pos = stato.prossima_posizione;

  const row = await pg.queryOne(
    `INSERT INTO coda_fifo (posizione, wallet, nome, tipo, is_rientro, generazione, importo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [pos, wallet.toLowerCase(), nome, tipo, isRientro, generazione, FIFO.DONO_PER_POSIZIONE]
  );

  stato.prossima_posizione = pos + 1;
  await setStatoFifo(stato);

  return row;
}

// ── CONTROLLA USCITA ──────────────────────────────────────────

async function controllaUscita() {
  const stato = await getStatoFifo();
  if (!stato?.inizializzato) return { canExit: false };

  const testa = await pg.queryOne(
    `SELECT * FROM coda_fifo WHERE status = 'IN_CODA' ORDER BY posizione ASC LIMIT 1`
  );
  if (!testa) return { canExit: false };

  const rientriPool = stato.rientri_pool || 0;

  const { cnt } = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM coda_fifo
     WHERE posizione > $1 AND status = 'IN_CODA' AND is_rientro = FALSE AND uscita_numero IS NULL`,
    [testa.posizione]
  );
  const posizioniDonatori = Number(cnt) || 0;
  const disponibili = rientriPool + posizioniDonatori;
  const mancanti = Math.max(0, FIFO.POSIZIONI_PER_USCITA - disponibili);

  return {
    canExit: disponibili >= FIFO.POSIZIONI_PER_USCITA,
    testa, rientriPool, posizioniDonatori, disponibili, mancanti,
  };
}

// ── CALCOLA USCITA ────────────────────────────────────────────

function calcolaUscitaFifo(tipo) {
  if (tipo === 'HUMAN') {
    return {
      tipo, lordo: FIFO.LORDO_PER_USCITA,
      rientri: FIFO.RIENTRI_HUMAN, costoRientri: FIFO.COSTO_RIENTRI_HUMAN,
      tipoRientro: 'HUMAN',
      rogSmall: FIFO.ROG_SMALL_HUMAN, contributoPharaon: 0,
      accantonamentoCassa: 0, nettoPersona: FIFO.NETTO_HUMAN,
      // Distribuzione netto 1.000 (sessione 4)
      pharaohHuman: FIFO.PHARAOH_HUMAN,
      rogSmallNuovi: FIFO.ROG_SMALL_HUMAN_NUOVI,
      soleL0Uranus: FIFO.SOLE_L0_URANUS_HUMAN,
    };
  }
  // CASSA / CASSA_ROG
  return {
    tipo, lordo: FIFO.LORDO_PER_USCITA,
    rientri: FIFO.RIENTRI_CASSA, costoRientri: FIFO.COSTO_RIENTRI_CASSA,
    tipoRientro: 'CASSA',
    rogSmall: FIFO.ROG_SMALL_CASSA, contributoPharaon: FIFO.CONTRIBUTO_PHARAON,
    soleL0Uranus: FIFO.SOLE_L0_URANUS_CASSA,
    accantonamentoCassa: FIFO.ACCANTONAMENTO_CASSA, nettoPersona: 0,
  };
}

// ── PROCESSA USCITA ───────────────────────────────────────────

async function processaUscita() {
  const stato = await getStatoFifo();
  const check = await controllaUscita();
  if (!check.canExit) return null;

  const testa = check.testa;
  const tipoAccount = testa.tipo === 'HUMAN' ? 'HUMAN' : 'CASSA';
  const uscita = calcolaUscitaFifo(tipoAccount);
  const numeroUscita = stato.prossima_uscita;

  // \ud83d\udd12 INVARIANTE DI SOLVIBILIT\u00c0 (solo HUMAN: comporta un payout reale in uscita).
  // La CASSA \u00e8 solo accantonamento (nessun trasferimento) \u2192 nessun controllo.
  // Best-effort: se il saldo \u00e8 leggibile e < payout dovuto, l'uscita viene DIFFERITA
  // (la testa resta in coda, si ritenta al prossimo trigger). Disattivabile con
  // SOLVENCY_GUARD=false. Il gate finale resta comunque payout-manager (balanceOf pre-transfer).
  if (tipoAccount === 'HUMAN' && process.env.SOLVENCY_GUARD !== 'false') {
    const saldo = await getSaldoCassaUsdc();
    if (saldo !== null && saldo < uscita.nettoPersona) {
      console.warn(`\ud83d\udd12 [Solvibilit\u00e0] Uscita HUMAN #${numeroUscita} DIFFERITA: saldo cassa ${saldo} USDC < payout ${uscita.nettoPersona} USDC`);
      try { const a = require('./alert-manager'); a.sendAlert('WARN', 'SOLVIBILITA', `Uscita #${numeroUscita} differita: saldo ${saldo} < payout ${uscita.nettoPersona} USDC`); } catch (_) {}
      return null; // lascia la testa in coda; ritenta al prossimo trigger
    }
  }

  // 1. Consuma rientri dal pool
  const rientriUsati = Math.min(check.rientriPool, FIFO.POSIZIONI_PER_USCITA);
  const daDonatori = FIFO.POSIZIONI_PER_USCITA - rientriUsati;
  stato.rientri_pool = (stato.rientri_pool || 0) - rientriUsati;

  // 2. Marca posizioni donatori consumate
  if (daDonatori > 0) {
    await pg.query(
      `UPDATE coda_fifo SET uscita_numero = $1
       WHERE id IN (
         SELECT id FROM coda_fifo
         WHERE posizione > $2 AND status = 'IN_CODA' AND is_rientro = FALSE AND uscita_numero IS NULL
         ORDER BY posizione ASC LIMIT $3
       )`, [numeroUscita, testa.posizione, daDonatori]
    );
  }

  // 3. Marca testa come uscita
  await pg.query(`UPDATE coda_fifo SET status = 'USCITO', uscita_numero = $1 WHERE id = $2`, [numeroUscita, testa.id]);

  // 4. Genera rientri
  for (let i = 0; i < uscita.rientri; i++) {
    await aggiungiPosizione({
      wallet: testa.wallet,
      nome: `Rientro #${numeroUscita}-${i + 1} (${uscita.tipoRientro})`,
      tipo: uscita.tipoRientro,
      isRientro: true,
      generazione: (testa.generazione || 0) + 1,
    });
  }
  stato.rientri_pool = (stato.rientri_pool || 0) + uscita.rientri;

  // 5. Registra uscita
  await pg.queryOne(
    `INSERT INTO storico_uscite_fifo
       (numero_uscita, posizione_coda, wallet, tipo_uscita, is_rientro, generazione,
        lordo, costo_rientri, num_rientri, rog_small, contributo_pharaon,
        accantonamento_cassa, netto, rientri_usati, posizioni_da_donatori)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      numeroUscita, testa.posizione, testa.wallet, tipoAccount,
      testa.is_rientro, testa.generazione || 0,
      uscita.lordo, uscita.costoRientri, uscita.rientri,
      uscita.rogSmall, uscita.contributoPharaon,
      uscita.accantonamentoCassa, uscita.nettoPersona,
      rientriUsati, daDonatori,
    ]
  );

  // 6. Flussi esterni
  if (uscita.rogSmall > 0) {
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('ROG_SMALL', $1, $2, $3, $4, $5) RETURNING *`,
      [testa.wallet, uscita.rogSmall, uscita.rogSmall, numeroUscita, tipoAccount]
    );
    // Notifica ROG: crea posizioni in coppia (utente + piletta) a nome dell'utente
    crossPlatform.registraRogSmall(testa.wallet, uscita.rogSmall / 2, uscita.rogSmall, `NETTUNO_${tipoAccount}_BASE`);
  }
  if (uscita.contributoPharaon > 0) {
    // PHARAOH: 1 posizione per CASSA (accantonata in cassa Uranus fino all'avvio PHARAOH)
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('PHARAOH_PENDING_NETTUNO', $1, $2, 1, $3, $4) RETURNING *`,
      [testa.wallet, uscita.contributoPharaon, numeroUscita, tipoAccount]
    );
    crossPlatform.registraPharaohSuRog(testa.wallet, uscita.contributoPharaon, `PHARAOH_NETTUNO_${tipoAccount}`);
  }

  // 7. Aggiorna stato
  stato.prossima_uscita = numeroUscita + 1;
  stato.totale_uscite = (stato.totale_uscite || 0) + 1;
  await setStatoFifo(stato);

  console.log(`🎯 NETTUNO USCITA #${numeroUscita} — ${tipoAccount} — ${testa.wallet.substring(0, 12)}... — netto: ${uscita.nettoPersona} USDC`);

  // 8. [HUMAN] Distribuzione netto 1.000 (sessione 4): 800 tasca + 100 PHARAOH + 60 ROG + 40 Sole
  if (tipoAccount === 'HUMAN' && uscita.pharaohHuman) {
    const cassaW = process.env.CASSA_WALLET || '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce';

    // PHARAOH SINGOLO (100 USDC) — ACCANTONATO in cassa URANUS (PHARAOH_PENDING),
    // esattamente come l'uscita L3: i 100 USDC NON vengono ricircolati a Sole; restano
    // in cassa, riservati al PHARAOH, finché PHARAOH non parte. 1 posizione PHARAOH.
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('PHARAOH_PENDING_NETTUNO', $1, $2, 1, $3, 'HUMAN') RETURNING *`,
      [testa.wallet, uscita.pharaohHuman, numeroUscita]
    );
    console.log(`   🔮 PHARAOH: ${uscita.pharaohHuman} USDC accantonati in cassa URANUS (PHARAOH_PENDING) — 1 pos. HUMAN`);
    crossPlatform.registraPharaohSuRog(testa.wallet, uscita.pharaohHuman, 'PHARAOH_NETTUNO_HUMAN');

    // ROG SMALL nuovi (30 ingressi dual × 2 USDC = 60 USDC) — coppia utente + piletta
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('ROG_SMALL_NETTUNO_HUMAN', $1, $2, $3, $4, 'HUMAN') RETURNING *`,
      [testa.wallet, uscita.rogSmallNuovi, uscita.rogSmallNuovi, numeroUscita]
    );
    console.log(`   📊 ROG SMALL nuovi: ${uscita.rogSmallNuovi} USDC → ${uscita.rogSmallNuovi / 2} ingressi dual`);
    crossPlatform.registraRogSmall(testa.wallet, uscita.rogSmallNuovi / 2, uscita.rogSmallNuovi, 'NETTUNO_HUMAN_NUOVI');

    // Sole L0 URANUS (2 ingressi dual × 20 USDC = 40 USDC) → coda background
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('SOLE_L0_URANUS_NETTUNO', $1, $2, $3, $4, 'HUMAN') RETURNING *`,
      [testa.wallet, uscita.soleL0Uranus, uscita.soleL0Uranus / FIFO.COSTO_RIENTRO, numeroUscita]
    );
    { const nSole = uscita.soleL0Uranus / (2 * FIFO.COSTO_RIENTRO);
      const _tw2 = testa.wallet, _cw2 = cassaW, _nu2 = numeroUscita;
      for (let i = 0; i < nSole; i++) {
        const idx = i;
        asyncQ.enqueue(() => posizionaRientroSoleUnico(_cw2, `CASSA Sole L0 Uranus #${idx+1} (Nettuno #${_nu2})`), `net-sole-c${idx}`);
        asyncQ.enqueue(() => posizionaRientroSoleUnico(_tw2, `Sole L0 Uranus #${idx+1} (Nettuno #${_nu2})`), `net-sole-h${idx}`);
      }
      console.log(`   ☀️  Sole L0 URANUS: ${uscita.soleL0Uranus} USDC → ${nSole} dual (in coda)`);
    }
  }

  // 8b. [CASSA] L0 URANUS: 40 USDC → 4 posizioni Sole a nome CASSA-URANUS (allineato schema)
  if (tipoAccount === 'CASSA' && uscita.soleL0Uranus) {
    const cassaW0 = process.env.CASSA_WALLET || '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce';
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, uscita_numero, tipo_uscita)
       VALUES ('SOLE_L0_URANUS_NETTUNO_CASSA', $1, $2, $3, $4, 'CASSA') RETURNING *`,
      [testa.wallet, uscita.soleL0Uranus, uscita.soleL0Uranus / FIFO.COSTO_RIENTRO, numeroUscita]
    );
    const nPosC = uscita.soleL0Uranus / FIFO.COSTO_RIENTRO;  // 4 posizioni
    const _nuC = numeroUscita;
    for (let i = 0; i < nPosC; i++) {
      const idx = i;
      asyncQ.enqueue(() => posizionaRientroSoleUnico(cassaW0, `CASSA Sole L0 Uranus #${idx + 1} (Nettuno CASSA #${_nuC})`), `net-sole-cassa-${_nuC}-${idx}`);
    }
    console.log(`   ☀️  Sole L0 URANUS (CASSA): ${uscita.soleL0Uranus} USDC → ${nPosC} pos a nome CASSA-URANUS`);
  }

  // 9. 💸 ROG SMALL → CASSA ROG (reale, persistito + retry). PHARAOH resta accantonato in cassa Uranus.
  const rogVersoCassaRog = (uscita.rogSmall || 0) + (uscita.rogSmallNuovi || 0);
  if (rogVersoCassaRog > 0) {
    try {
      await cassaTransfer.registraTrasferimento({
        destinazione: 'ROG', importo: rogVersoCassaRog,
        origineWallet: testa.wallet, motivo: `ROG_SMALL_NETTUNO_${tipoAccount} #${numeroUscita}`,
        eventKey: `nettuno-rog-${numeroUscita}`,
      });
    } catch (e) { console.error(`   ⚠️  [CassaTransfer] Nettuno ROG: ${e.message}`); }
  }

  try { const a = require('./alert-manager'); a.sendAlert('INFO', 'USCITA_FIFO', `FIFO #${numeroUscita}: ${tipoAccount} — ${uscita.nettoPersona} USDC`); } catch (_) {}

  // 🎁 Dono pendente Nettuno (solo HUMAN: comporta un payout reale di nettoPersona).
  // L'utente lo ritira via ACCETTA DONO (gate fondi in cassa). CASSA = accantonamento, niente dono.
  if (tipoAccount === 'HUMAN' && uscita.nettoPersona > 0) {
    try {
      const giftManager = require('./gift-manager');
      await giftManager.creaDonoPendente(testa.wallet, uscita.nettoPersona, 6, 'PAYOUT_NETTUNO', { numeroUscita });
    } catch (e) { console.error(`⚠️  [Nettuno] creaDonoPendente: ${e.message}`); }
  }

  return { numeroUscita, posizione: testa.posizione, wallet: testa.wallet, tipoAccount, uscita, rientriUsati, daDonatori };
}

// ── CASCATA ───────────────────────────────────────────────────

async function processaUsciteCascata() {
  const uscite = [];
  let continua = true;
  while (continua) {
    const check = await controllaUscita();
    if (check.canExit) {
      const r = await processaUscita();
      if (r) uscite.push(r); else continua = false;
    } else { continua = false; }
  }
  return uscite;
}

// ── STATISTICHE ───────────────────────────────────────────────

async function getStatisticheFifo() {
  return pg.queryOne(`
    SELECT
      (SELECT COUNT(*) FROM coda_fifo) AS totale_posizioni,
      (SELECT COUNT(*) FROM coda_fifo WHERE status = 'IN_CODA') AS posizioni_in_coda,
      (SELECT COUNT(*) FROM coda_fifo WHERE status = 'USCITO') AS posizioni_uscite,
      (SELECT COUNT(*) FROM coda_fifo WHERE is_rientro = TRUE) AS totale_rientri,
      (SELECT COUNT(*) FROM storico_uscite_fifo) AS totale_uscite,
      (SELECT COUNT(*) FROM storico_uscite_fifo WHERE tipo_uscita = 'HUMAN') AS uscite_human,
      (SELECT COUNT(*) FROM storico_uscite_fifo WHERE tipo_uscita = 'CASSA') AS uscite_cassa,
      (SELECT COALESCE(SUM(netto),0) FROM storico_uscite_fifo WHERE tipo_uscita = 'HUMAN') AS totale_distribuito,
      (SELECT COALESCE(SUM(accantonamento_cassa),0) FROM storico_uscite_fifo) AS totale_accantonato,
      (SELECT COALESCE(SUM(importo),0) FROM flussi_esterni WHERE tipo = 'ROG_SMALL') AS totale_rog_small,
      (SELECT COALESCE(SUM(importo),0) FROM flussi_esterni WHERE tipo = 'PHARAON') AS totale_pharaon
  `);
}

module.exports = {
  FIFO,
  inizializzaFifo,
  aggiungiPosizione,
  controllaUscita,
  calcolaUscitaFifo,
  processaUscita,
  processaUsciteCascata,
  getStatoFifo,
  getStatisticheFifo,
  getSaldoCassaUsdc,
};
