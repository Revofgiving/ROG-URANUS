/**
 * 🔮 SUPERURANO — Predisposizione Manager
 *
 * Pre-mappa DETERMINISTICAMENTE le posizioni future di ogni account
 * al momento dell'ingresso nel sistema, come nelle Tavole Egizie.
 *
 * Quando un sacerdote entra nel Blocco 1, il sistema calcola GIÀ:
 *   - In quale turno diventerà Faraone
 *   - Quali numeri di tavola avrà a L1 (Luna), L2 (Mercurio), L3 (Venere)
 *   - Dove saranno posizionate le sue Funzioni:
 *       → 3 Simbionti: Mercurio tav.1 pos 1,2 + Mercurio tav.2 pos 1
 *       → 1 Perpetuo:  Mercurio tav.2 pos 2 (con sdoppiamento)
 *       → 1 Gemello:   Venere 7ª tavola pos 2 (lazy, con sdoppiamento)
 *   - Quanti sacerdoti umani servono (18 al 1° turno, 13 dal 2° in poi)
 *
 * Questo rende il sistema COMPLETAMENTE DETERMINISTICO:
 *   → L'utente sa in anticipo quando uscirà
 *   → Le Funzioni sono già "prenotate" prima di essere create
 *   → Il numero di persone nuove necessarie è calcolabile a priori
 */
'use strict';

const db = require('./db-manager');
const pg = require('./pg-connection-manager');
const rules = require('./rules-engine');

// ========================================
// CALCOLO PREDISPOSIZIONE
// ========================================

/**
 * Calcola la predisposizione completa per un account che entra nel Blocco 1.
 *
 * Chiamato quando un sacerdote viene posizionato nel Blocco 1
 * (da posizionaSacerdoteInUrano in donation-flow-manager.js).
 *
 * @param {string} wallet - Wallet del sacerdote
 * @param {number} turnoCorrente - Turno Urano corrente
 * @param {number} sacerdotiEntrati - Numero di sacerdoti già entrati nel turno
 * @param {string} faraoneWallet - Wallet del Faraone corrente del turno
 * @returns {Object} Predisposizione calcolata
 */
async function calcolaPredisposizione(wallet, turnoCorrente, sacerdotiEntrati, faraoneWallet, chiaveSdoppiamentoOverride = null) {
  const w = wallet.toLowerCase();

  // Il sacerdote che entra ora occupa la posizione sacerdotiEntrati
  // nel turno corrente. Non è un Faraone ORA — lo sarà in un turno futuro.

  // Calcola in quale TURNO FUTURO questo sacerdote diventerà Faraone.
  // La sua tavola di sdoppiamento nel Blocco 1 determina la sua posizione
  // nella coda dei futuri Faraoni.

  // Trova il numero della sua tavola di sdoppiamento (appena creata)
  const sdoppiamento = await pg.queryOne(
    `SELECT t.numero FROM tavole t
     JOIN posizioni p ON p.sdoppiamento_tavola_id = t.id
     WHERE p.wallet = $1 AND t.tipo = 'SDOPPIAMENTO' AND t.livello IN (1,2,3)
     ORDER BY t.numero DESC LIMIT 1`,
    [w]
  );

  const l1SdoppiamentoNum = sdoppiamento?.numero || null;
  // Chiave della scheda. Se fornita (graduazione da Sole), usa la tavola di
  // sdoppiamento Sole L0 — chiave STABILE dall'ingresso fino alla graduazione —
  // così AGGIORNA la scheda preliminare creata all'ingresso (una sola scheda per
  // posizione, nessun doppione). Altrimenti usa la tavola di sdoppiamento del Blocco 1.
  const tavolaSdoppiamentoNum = chiaveSdoppiamentoOverride || l1SdoppiamentoNum;

  // Conta quante tavole di sdoppiamento (futuri Faraoni) ci sono prima di questa
  const { cnt: posizioneCoda } = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM tavole
     WHERE tipo = 'SDOPPIAMENTO' AND status = 'APERTA' AND livello IN (1,2,3)
       AND numero <= $1`,
    [l1SdoppiamentoNum || 999999]
  );

  // Turno previsto = turno corrente + posizione nella coda dei Faraoni
  const turnoPrevisto = turnoCorrente + Number(posizioneCoda);

  // Sacerdoti necessari per il turno previsto
  const sacerdotiNecessari = turnoPrevisto === 1
    ? rules.IMPORTI.SACERDOTI_PRIMO_TURNO
    : rules.IMPORTI.SACERDOTI_DAL_SECONDO;

  // Calcolo deterministico delle tavole per il turno previsto.
  // Nel turno N, la numerazione delle tavole parte dall'ultima tavola del turno N-1.
  // Per il turno previsto, possiamo stimare l'offset basandoci sul pattern:
  //   Turno 1: tavole 1-29 (A: 29 tavole totali)
  //   Turno 2+: 25 tavole per turno (13 sacerdoti × ~2 tavole sdoppiate ciascuno, meno funzioni)

  // Pre-mappa le posizioni delle Funzioni
  const funzioniPreviste = {
    simbionti: [
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 1, posizione: 1, tipo: 'SIMBIONTE', sdoppiabile: false },
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 1, posizione: 2, tipo: 'SIMBIONTE', sdoppiabile: false },
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 2, posizione: 1, tipo: 'SIMBIONTE', sdoppiabile: false },
    ],
    perpetuo: {
      livello: 2, nome: 'Mercurio', tavolaRelativa: 2, posizione: 2,
      tipo: 'PERPETUO', sdoppiabile: true,
      siglaFormula: '<sigla_faraone>.N'
    },
    gemello: {
      livello: 3, nome: 'Venere', tavolaRelativa: 7, posizione: 2,
      tipo: 'GEMELLO', sdoppiabile: true,
      ticketFormula: '26 + (ordine_globale - 1) × 14',
      siglaFormula: 'N-<sigla_faraone>'
    },
    crediti: {
      numero: 5, importoUnitario: 10, totale: 50,
      destinazione: 'contenitore 5.3'
    }
  };

  // Struttura tavole previste per il turno del Faraone
  const strutturaTurno = {
    luna: {
      livello: 1, capacita: 2,
      tavole: 1,
      sacerdoti: 'posizioni 1-2 (entrano qui, poi progrediscono)'
    },
    mercurio: {
      livello: 2, capacita: 3,
      tavole: sacerdotiNecessari === 18 ? 3 : 5, // 3 pure + 2 funzioni
      dettaglio: sacerdotiNecessari === 13
        ? 'Tav.1: SIM1+SIM2 | Tav.2: SIM3+PERPETUO | Tav.3-5: sacerdoti 3-6 + progrediti'
        : 'Tav.1-3: sacerdoti 1-6 (tutti umani, nessuna funzione)'
    },
    venere: {
      livello: 3, capacita: 3,
      tavole: 6,
      dettaglio: sacerdotiNecessari === 13
        ? 'Tav.1-6: sacerdoti 7-18 progrediti + nuovi | Tav.7 pos.2: GEMELLO (lazy)'
        : 'Tav.1-6: sacerdoti 7-18 (tutti umani)'
    }
  };

  // Persone nuove necessarie per questo turno
  const personeNuove = sacerdotiNecessari === 18
    ? 57  // 1° turno: 18×3 + 3 per tavola A
    : 39; // 2° turno+: 13×3

  const predisposizione = {
    wallet: w,
    turnoCorrente,
    sacerdotiEntrati,
    tavolaSdoppiamentoNum,
    posizioneCodaFaraoni: Number(posizioneCoda),
    turnoPrevisto,
    sacerdotiNecessari,
    personeNuoveNecessarie: personeNuove,
    haFunzioni: turnoPrevisto > 1,
    funzioniPreviste: turnoPrevisto > 1 ? funzioniPreviste : null,
    strutturaTurno,
    riepilogoEconomico: {
      lordoL3: rules.IMPORTI.DONO_TOTALE_L3,
      accantonamentoRestituito: rules.IMPORTI.ACCANTONAMENTO_RESTITUITO,
      lordoEffettivo: rules.IMPORTI.DONO_TOTALE_L3_EFFETTIVO,
      cassaL3: rules.IMPORTI.TRATTENUTA_CASSA_L3,
      nettoPrimario: rules.IMPORTI.USCITA_L3_PRIMARIO,
      nettoSecondario: rules.IMPORTI.USCITA_L3_SECONDARIO,
    }
  };

  // Salva in DB
  await salvaPredisposizione(predisposizione);

  console.log(`   🔮 Predisposizione calcolata per ${w.substring(0, 12)}...`);
  console.log(`      Turno previsto: ${turnoPrevisto} | Sacerdoti: ${sacerdotiNecessari} | Persone nuove: ${personeNuove}`);
  if (turnoPrevisto > 1) {
    console.log(`      Funzioni: 3 SIM (Mercurio tav.1-2) + 1 PERP (Mercurio tav.2) + 1 GEM (Venere tav.7)`);
  }

  return predisposizione;
}

// ========================================
// PRENOTAZIONE ALL'INGRESSO (Sole L0)
// ========================================

/**
 * 🔮 Prenotazione funzioni AL MOMENTO DELL'INGRESSO (dono a Sole L0).
 *
 * Come da specifica ("dal momento in cui entra il numero zero avrà le sue funzioni
 * prenotate ..."): ad ogni ingresso a Sole, ogni posizione ("numero") ottiene SUBITO
 * la propria scheda di predisposizione, agganciata alla sua tavola di sdoppiamento
 * Sole L0 (chiave STABILE). Le posizioni delle Funzioni (SIM/PERP/GEM) sono
 * DETERMINISTICHE; il turno è STIMATO e verrà raffinato da calcolaPredisposizione
 * quando la posizione si diploma nel Blocco 1 (stessa chiave → una sola scheda).
 *
 * @param {string} wallet
 * @param {number} tavolaSdoppiamentoSoleNum - numero della tavola di sdoppiamento Sole L0
 * @param {number} turnoEntrataCorrente - turno ENTRATA corrente
 */
async function prenotaIngressoSole(wallet, tavolaSdoppiamentoSoleNum, turnoEntrataCorrente) {
  if (!tavolaSdoppiamentoSoleNum) return null;
  const w = wallet.toLowerCase();

  // Stima del turno di graduazione: quante tavole Sole L0 ancora aperte hanno
  // numero <= la nostra (proxy della posizione nella coda di promozione Sole).
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM tavole
     WHERE livello = 0 AND status = 'APERTA' AND tipo IN ('SDOPPIAMENTO','PERCORSO')
       AND numero <= $1`,
    [tavolaSdoppiamentoSoleNum]
  );
  const codaSole = Number(row?.cnt) || 1;
  const turnoPrevistoStimato = Number(turnoEntrataCorrente || 1) + codaSole;

  const sacerdotiNecessari = turnoPrevistoStimato === 1
    ? rules.IMPORTI.SACERDOTI_PRIMO_TURNO
    : rules.IMPORTI.SACERDOTI_DAL_SECONDO;

  // Posizioni Funzioni: DETERMINISTICHE (indipendenti dal turno) — già "prenotate".
  const funzioniPreviste = {
    simbionti: [
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 1, posizione: 1, tipo: 'SIMBIONTE', sdoppiabile: false },
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 1, posizione: 2, tipo: 'SIMBIONTE', sdoppiabile: false },
      { livello: 2, nome: 'Mercurio', tavolaRelativa: 2, posizione: 1, tipo: 'SIMBIONTE', sdoppiabile: false },
    ],
    perpetuo: {
      livello: 2, nome: 'Mercurio', tavolaRelativa: 2, posizione: 2,
      tipo: 'PERPETUO', sdoppiabile: true, siglaFormula: '<sigla_faraone>.N'
    },
    gemello: {
      livello: 3, nome: 'Venere', tavolaRelativa: 7, posizione: 2,
      tipo: 'GEMELLO', sdoppiabile: true,
      ticketFormula: '26 + (ordine_globale - 1) × 14', siglaFormula: 'N-<sigla_faraone>'
    },
    crediti: { numero: 5, importoUnitario: 10, totale: 50, destinazione: 'contenitore 5.3' }
  };

  const pred = {
    wallet: w,
    turnoCorrente: Number(turnoEntrataCorrente || 1),
    tavolaSdoppiamentoNum: tavolaSdoppiamentoSoleNum,
    posizioneCodaFaraoni: codaSole,
    turnoPrevisto: turnoPrevistoStimato,
    sacerdotiNecessari,
    personeNuoveNecessarie: sacerdotiNecessari === 18 ? 57 : 39,
    haFunzioni: turnoPrevistoStimato > 1,
    funzioniPreviste: turnoPrevistoStimato > 1 ? funzioniPreviste : null,
    strutturaTurno: {
      preliminare: true,
      origine: 'INGRESSO_SOLE_L0',
      nota: 'Prenotazione creata al momento dell\'ingresso a Sole. Turno STIMATO: verrà raffinato quando la posizione entra nel Blocco 1.'
    },
    riepilogoEconomico: {
      lordoL3: rules.IMPORTI.DONO_TOTALE_L3,
      accantonamentoRestituito: rules.IMPORTI.ACCANTONAMENTO_RESTITUITO,
      lordoEffettivo: rules.IMPORTI.DONO_TOTALE_L3_EFFETTIVO,
      cassaL3: rules.IMPORTI.TRATTENUTA_CASSA_L3,
      nettoPrimario: rules.IMPORTI.USCITA_L3_PRIMARIO,
      nettoSecondario: rules.IMPORTI.USCITA_L3_SECONDARIO,
    }
  };

  await salvaPredisposizione(pred);
  console.log(`   🔮 Prenotazione INGRESSO Sole: ${w.substring(0, 12)}... (tavola sdopp. #${tavolaSdoppiamentoSoleNum}, turno stimato ${turnoPrevistoStimato})`);
  return pred;
}

// ========================================
// PERSISTENZA
// ========================================

async function salvaPredisposizione(pred) {
  await db.initDatabase();
  return await pg.queryOne(
    `INSERT INTO predisposizioni
       (wallet, turno_corrente, turno_previsto, tavola_sdoppiamento_num,
        posizione_coda, sacerdoti_necessari, persone_nuove,
        ha_funzioni, funzioni_previste, struttura_turno, riepilogo_economico)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (wallet, tavola_sdoppiamento_num) DO UPDATE SET
       turno_corrente = EXCLUDED.turno_corrente,
       turno_previsto = EXCLUDED.turno_previsto,
       tavola_sdoppiamento_num = EXCLUDED.tavola_sdoppiamento_num,
       posizione_coda = EXCLUDED.posizione_coda,
       sacerdoti_necessari = EXCLUDED.sacerdoti_necessari,
       persone_nuove = EXCLUDED.persone_nuove,
       ha_funzioni = EXCLUDED.ha_funzioni,
       funzioni_previste = EXCLUDED.funzioni_previste,
       struttura_turno = EXCLUDED.struttura_turno,
       riepilogo_economico = EXCLUDED.riepilogo_economico,
       updated_at = NOW()
     RETURNING *`,
    [
      pred.wallet, pred.turnoCorrente, pred.turnoPrevisto,
      pred.tavolaSdoppiamentoNum, pred.posizioneCodaFaraoni,
      pred.sacerdotiNecessari, pred.personeNuoveNecessarie,
      pred.haFunzioni,
      JSON.stringify(pred.funzioniPreviste),
      JSON.stringify(pred.strutturaTurno),
      JSON.stringify(pred.riepilogoEconomico)
    ]
  );
}

// ========================================
// QUERY
// ========================================

async function getPredisposizione(wallet) {
  await db.initDatabase();
  // Legacy/single: ritorna la predisposizione più recente del wallet.
  return await pg.queryOne(
    'SELECT * FROM predisposizioni WHERE wallet = $1 ORDER BY id DESC LIMIT 1',
    [wallet.toLowerCase()]
  );
}

// Per-ingresso: TUTTE le predisposizioni del wallet (una per posizione/tavola di sdoppiamento).
async function getPredisposizioniByWallet(wallet) {
  await db.initDatabase();
  return await pg.queryMany(
    'SELECT * FROM predisposizioni WHERE wallet = $1 ORDER BY turno_previsto ASC, id ASC',
    [wallet.toLowerCase()]
  );
}

async function getPredisposizioniPerTurno(turno) {
  await db.initDatabase();
  return await pg.queryMany(
    'SELECT * FROM predisposizioni WHERE turno_previsto = $1 ORDER BY posizione_coda ASC',
    [turno]
  );
}

async function getStatoPredisposizioni() {
  await db.initDatabase();
  return await pg.queryOne(`
    SELECT
      (SELECT COUNT(*) FROM predisposizioni) AS totale,
      (SELECT COUNT(*) FROM predisposizioni WHERE ha_funzioni = TRUE) AS con_funzioni,
      (SELECT COUNT(*) FROM predisposizioni WHERE ha_funzioni = FALSE) AS senza_funzioni,
      (SELECT MIN(turno_previsto) FROM predisposizioni) AS turno_min,
      (SELECT MAX(turno_previsto) FROM predisposizioni) AS turno_max,
      (SELECT COALESCE(SUM(persone_nuove), 0) FROM predisposizioni) AS totale_persone_previste
  `);
}

// ========================================
// PREDISPOSIZIONE SOLE (L0)
// ========================================

/**
 * Ritorna lo stato di ogni tavola Sole dove il wallet è presente.
 * Include: posizioni occupate, mancanti, se è l'erede, e il payout atteso.
 */
async function calcolaPredisposizioneSole(wallet) {
  const w = wallet.toLowerCase();

  // Tavole L0 dove wallet ha una posizione (come donatore/sacerdote)
  const tavoleConPosizione = await pg.queryMany(`
    SELECT
      t.id, t.numero, t.livello, t.status, t.capacita,
      t.faraone_wallet,
      COUNT(p2.id) AS posizioni_occupate,
      p.casella AS mia_casella,
      p.tipo AS mia_tipo
    FROM posizioni p
    JOIN tavole t ON t.id = p.tavola_id
    LEFT JOIN posizioni p2 ON p2.tavola_id = t.id
    WHERE p.wallet = $1 AND t.livello = 0 AND t.status = 'APERTA'
    GROUP BY t.id, t.numero, t.livello, t.status, t.capacita, t.faraone_wallet, p.casella, p.tipo
    ORDER BY t.numero ASC
  `, [w]);

  return tavoleConPosizione.map(t => {
    const occ = Number(t.posizioni_occupate) || 0;
    const cap = Number(t.capacita) || 6;
    const mancanti = Math.max(0, cap - occ);
    const isErede = t.faraone_wallet?.toLowerCase() === w;
    return {
      tavolaNumero: t.numero,
      status: t.status,
      miaCasella: t.mia_casella,
      mioTipo: t.mia_tipo,
      posizioniOccupate: occ,
      capacita: cap,
      posizioniMancanti: mancanti,
      percCompletamento: Math.round(occ / cap * 100),
      isErede,
      alCompletamento: isErede
        ? 'Entri nel Blocco 1 (50 USDC) + 1 posizione HUMAN in Nettuno (auto)'
        : 'Il tuo dono alimenta il sistema',
      messaggio: mancanti === 0
        ? '✅ Tavola completa'
        : `Mancano ${mancanti} persone su ${cap} per completare la tavola`,
    };
  });
}

// ========================================
// PREDISPOSIZIONE NETTUNO (FIFO)
// ========================================

/**
 * Ritorna lo stato di ogni posizione del wallet nella coda Nettuno.
 * Include: posizione, tipo, posizioni mancanti per uscire, % completamento.
 */
async function calcolaPredisposizioneNettuno(wallet) {
  const w = wallet.toLowerCase();

  // Posizioni in coda
  const posizioniInCoda = await pg.queryMany(`
    SELECT posizione, tipo, is_rientro, generazione, status, created_at
    FROM coda_fifo
    WHERE wallet = $1 AND status = 'IN_CODA'
    ORDER BY posizione ASC
  `, [w]);

  if (posizioniInCoda.length === 0) return { inCoda: [], uscite: [], riepilogo: null };

  // Stato FIFO (rientri_pool)
  const statoRow = await pg.queryOne(
    `SELECT value FROM state_persistence WHERE key = 'fifo_sistema'`
  );
  const stato = statoRow?.value || {};
  const rientri_pool = Number(stato.rientri_pool) || 0;
  const totalePosizioni = Number(stato.prossima_posizione) || 0;
  const totaleUscite = Number(stato.totale_uscite) || 0;

  // Per ogni posizione: conta i donatori non-consumati dopo di essa
  const risultati = await Promise.all(posizioniInCoda.map(async (pos) => {
    const { cnt } = await pg.queryOne(`
      SELECT COUNT(*) AS cnt FROM coda_fifo
      WHERE posizione > $1
        AND status = 'IN_CODA'
        AND is_rientro = FALSE
        AND uscita_numero IS NULL
    `, [pos.posizione]) || { cnt: 0 };

    const donatoriDopo = Number(cnt) || 0;
    const disponibili = donatoriDopo + rientri_pool;
    const SLOTS = 108;
    const mancanti = Math.max(0, SLOTS - disponibili);
    const perc = Math.min(100, Math.round(disponibili / SLOTS * 100));

    return {
      posizione: pos.posizione,
      tipo: pos.tipo,
      isRientro: pos.is_rientro,
      generazione: pos.generazione,
      donatoriDopo,
      rientri_pool,
      disponibili,
      posizioniMancanti: mancanti,
      percCompletamento: perc,
      puoUscire: disponibili >= SLOTS,
      messaggio: mancanti === 0
        ? `✅ Puoi uscire! Lordo: 1.080 USDC → 800 USDC in wallet`
        : `Mancano ${mancanti} posizioni su ${SLOTS} per uscire`,
      payoutAtteso: String(pos.tipo).startsWith('HUMAN')
        ? { wallet: 800, pharaoh: 100, rogSmall: 60, soleL0: 40 }
        : { accantonamento: 700 },
      // 🔮 PREDESTINAZIONE VISIVA dei rientri futuri (solo informativa).
      // Ogni posizione, AL momento dell'uscita, rigenera rientri perpetui:
      //   HUMAN → 6 | CASSA → 18. Questi NON esistono ancora e NON contano
      //   per la soglia 108 finché non vengono effettivamente generati.
      rientriFuturiPrevisti: {
        numero: String(pos.tipo).startsWith('HUMAN') ? 6 : 18,
        generazioneProssima: (Number(pos.generazione) || 0) + 1,
        nota: 'Generati automaticamente all\'uscita (perpetui). Predestinazione visiva: non contano per la soglia 108 finché non esistono.',
      },
    };
  }));

  // Uscite già avvenute per questo wallet
  const uscite = await pg.queryMany(
    `SELECT numero_uscita, tipo_uscita, netto, lordo, is_rientro, created_at
     FROM storico_uscite_fifo WHERE wallet = $1 ORDER BY numero_uscita DESC`,
    [w]
  );

  // Riepilogo
  const human = risultati.filter(r => r.tipo === 'HUMAN' || r.tipo === 'HUMAN_RIENTRO');
  const cassa = risultati.filter(r => r.tipo === 'CASSA' || r.tipo === 'CASSA_RIENTRO');
  const primaUscita = risultati.sort((a, b) => a.posizioniMancanti - b.posizioniMancanti)[0];

  return {
    inCoda: risultati,
    uscite,
    riepilogo: {
      totalePosizioni: risultati.length,
      totaleHuman: human.length,
      totaleCassa: cassa.length,
      rientri_pool,
      totalePosizioniFIFO: totalePosizioni,
      totaleUsciteSistema: totaleUscite,
      // 🔮 Totale rientri futuri previsti (predestinazione visiva, non ancora in coda)
      rientriFuturiPrevistiTotali: risultati.reduce((s, r) => s + (r.rientriFuturiPrevisti?.numero || 0), 0),
      primaPosizioneUtile: primaUscita
        ? { posizione: primaUscita.posizione, mancanti: primaUscita.posizioniMancanti, perc: primaUscita.percCompletamento }
        : null,
    }
  };
}

// ========================================
// PREDISPOSIZIONE COMPLETA
// ========================================

/**
 * Aggregazione completa del percorso di un wallet:
 *   - Sole (L0): tavole, caselle, mancanti
 *   - Blocco 1: turno previsto, funzioni (da predisposizione esistente)
 *   - Nettuno: posizioni in coda, mancanti, payout atteso
 */
async function calcolaPredisposizioneCompleta(wallet) {
  const w = wallet.toLowerCase();

  const [sole, nettuno, blocco1List] = await Promise.all([
    calcolaPredisposizioneSole(w),
    calcolaPredisposizioneNettuno(w),
    getPredisposizioniByWallet(w),
  ]);

  // Blocco 1 PER-INGRESSO: ogni posizione (tavola di sdoppiamento) ha il proprio percorso.
  const blocco1 = (blocco1List || []).map(b => ({
    tavolaSdoppiamento: b.tavola_sdoppiamento_num,
    turnoPrevisto: b.turno_previsto,
    posizioneCoda: b.posizione_coda,
    sacerdotiNecessari: b.sacerdoti_necessari,
    personeNuoveNecessarie: b.persone_nuove,
    haFunzioni: b.ha_funzioni,
    funzioniPreviste: b.funzioni_previste,
    riepilogoEconomico: b.riepilogo_economico,
    messaggio: `Posizione (tavola sdoppiamento #${b.tavola_sdoppiamento_num ?? '?'}): diventerai Uranus al turno #${b.turno_previsto} (sei ${b.posizione_coda}° in coda Blocco 1)`,
  }));

  return {
    wallet: w,
    aggiornato: new Date().toISOString(),
    sole: {
      tavole: sole,
      messaggio: sole.length === 0
        ? 'Nessuna tavola Sole aperta con tue posizioni'
        : `Sei presente in ${sole.length} tavola/e Sole`,
    },
    blocco1,
    blocco1Count: blocco1.length,
    nettuno,
    riepilogoPayout: {
      incassatiFinora: null, // calcolato dal frontend con storico_avanzamenti
      prossimoPayout: nettuno.inCoda.find(p => p.tipo === 'HUMAN' && p.posizioniMancanti === 0)
        ? '800 USDC (posizione HUMAN pronta)'
        : nettuno.inCoda.find(p => p.tipo === 'HUMAN')
          ? `800 USDC quando ${nettuno.inCoda.find(p => p.tipo === 'HUMAN').posizioniMancanti} posizioni si aggiungono`
          : 'Nessuna posizione HUMAN in coda',
    }
  };
}

module.exports = {
  calcolaPredisposizione,
  prenotaIngressoSole,
  calcolaPredisposizioneSole,
  calcolaPredisposizioneNettuno,
  calcolaPredisposizioneCompleta,
  getPredisposizione,
  getPredisposizioniByWallet,
  getPredisposizioniPerTurno,
  getStatoPredisposizioni,
};
