/**
 * 🌉 SUPERURANO — Bridge Manager
 *
 * Collegamento automatico tra URANO 2 (PHARAON ÷10) e URANO 1 (FIFO).
 *
 * FLUSSO:
 *   URANO 2 uscita L3/Venere (Primario/Secondario) → auto-entry in Nettuno (20 USDC)
 *   URANO 2 uscita L3/Venere (Primario)             → deduzione 110 USDC → 10 ROG SMALL (5+5) + 100 ROG SMALL (50+50)
 *   URANO 2 uscita L5/Saturno (Secondario)          → deduzione 500 USDC → 100 ROG SMALL (50+50) + 100 Nettuno (5 dual) + 300 (PHARAOH acc.+ROG+Sole)
 *
 * NOTA: i 100/300 USDC vengono reinseriti a livello Sole (L0) come rientri
 *   a nome dell'utente, generando effetto cascata esponenziale sul sistema.
 *
 * DEDUZIONI (aggiornate sessione 4):
 *   L3 Primario:   610 − 20 (Nettuno DUAL) − 10 (ROG SMALL 5 ing. dual) − 100 (PHARAOH SINGOLO) = 480
 *   L3 Secondario: 110 − 10 (Nettuno 1 HUMAN) − 10 (Sole L0 URANUS 1 rientro) = 90 donati
 *   L5 Secondario: 2.900 − 100 (ROG SMALL 50 ing.) − 100 (Nettuno 5 dual) − 300 (PHARAOH acc.+ROG+Sole) = 2.400
 *
 * Il netto finale viene DONATO al wallet dell'utente.
 */
'use strict';

const queue      = require('./queue-manager');
const pg         = require('./pg-connection-manager');
const tableManager = require('./table-manager');
const db         = require('./db-manager');
const asyncQ     = require('./async-queue');
const chainRegistrar   = require('./chain-registrar');
const crossPlatform    = require('./cross-platform-bridge');
const kycBridge        = require('./kyc-bridge');
const goldConverter    = require('./gold-converter');
const giftManager      = require('./gift-manager');
const cassaTransfer    = require('./cassa-transfer-manager');

// ── RIENTRO A SOLE (L0) ─────────────────────────────────────────
// Posiziona una singola posizione nella tavola attiva del livello Sole.
// Funziona come posizionaDonatoreEntrata ma senza trigger di completamento
// tavola (i rientri riempiono caselle, il completamento avviene normalmente).
async function posizionaRientroSole(wallet, nome) {
  const turno = await db.getTurnoCorrente('ENTRATA', 0);
  if (!turno) { console.log(`   ⚠️  Nessun turno Sole attivo per rientro`); return null; }
  const tavola = await tableManager.getTavolaPercorsoAttiva(0, turno.numero_turno);
  if (!tavola) { console.log(`   ⚠️  Nessuna tavola Sole aperta per rientro`); return null; }

  const r = await tableManager.posizionaDonatore({
    tavolaId: tavola.id, tavolaNumero: tavola.numero, livello: 0,
    wallet, nome, tipo: 'DONATORE', donoImporto: 10,
    turno: turno.numero_turno, sdoppiabile: true
  });
  await db.incrementSacerdotiEntrati(turno.id);

  // Registra flusso
  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('RIENTRI_SOLE', $1, 10, 1, 'RIENTRO') RETURNING *`,
    [wallet]
  );

  return r;
}

// ── COSTANTI BRIDGE ──────────────────────────────────────────

const BRIDGE = {
  // Entry Nettuno (FIFO)
  COSTO_ENTRY_FIFO: 20,              // DUAL: 1 CASSA + 1 HUMAN = 2 posizioni × 10 USDC (PRIMARIO/FONDO)
  COSTO_ENTRY_FIFO_SECONDARIO: 10,   // SINGOLO: solo 1 HUMAN × 10 USDC (SECONDARIO)

  // Sole L0 URANUS — per SECONDARIO (1 rientro singolo = −10 USDC)
  L3_SOLE_L0_SECONDARIO: 10,

  // Deduzioni L3 Primario
  L3_ROG_SMALL_NUM: 10,              // 5 ingressi dual = 10 posizioni (5 utente + 5 sistema)
  L3_ROG_SMALL_COSTO: 10,            // 5 ing. × 2 USDC = 10 USDC
  L3_PHARAOH_NUM: 10,                // (storico) L3 PHARAOH ora ACCANTONATO in cassa (PHARAOH_PENDING_L3): costante non più usata
  L3_PHARAOH_COSTO: 100,             // 100 USDC (5 × 20 USDC dual Sole)
  L3_DEDUZIONE_TOTALE: 110,          // 10 + 100

  // Deduzioni L5 Secondario
  L5_ROG_SMALL_NUM: 100,             // 50 ingressi dual = 100 posizioni (50 utente + 50 sistema)
  L5_ROG_SMALL_COSTO: 100,           // 50 ing. × 2 USDC = 100 USDC
  L5_DEDUZIONE_TOTALE: 400,          // 100 (ROG SMALL) + 300 (a nome utente)

  // Distribuzione 300 USDC L5 (definita sessione 4) — a nome dell'utente:
  L5_PHARAOH_NUM: 10,                // (storico) L5 PHARAOH ora ACCANTONATO in cassa (PHARAOH_PENDING_L5): costante non più usata
  L5_PHARAOH_COSTO: 100,             // 100 USDC (5 × 20 USDC dual Sole)
  L5_ROG_SMALL_EXTRA_NUM: 100,       // 50 ingressi dual = 100 posizioni (50 utente + 50 sistema)
  L5_ROG_SMALL_EXTRA_COSTO: 100,     // 50 ing. × 2 USDC = 100 USDC
  L5_SOLE_L0_NUM: 10,                // 5 ingressi dual = 10 posizioni (5 HUMAN + 5 CASSA)
  L5_SOLE_L0_COSTO: 100,             // 5 × 20 USDC = 100 USDC
  L5_NETTUNO_NUM: 10,                // 5 ingressi dual Nettuno = 10 posizioni (5 CASSA + 5 HUMAN)
  L5_NETTUNO_COSTO: 100,             // 5 dual × 20 USDC = 100 USDC
};

// ══════════════════════════════════════════
// HOOK: Uscita da URANO 2 L3 (Venere)
// ══════════════════════════════════════════

/**
 * Chiamato AUTOMATICAMENTE dopo gestisciUscitaFaraone() in URANO 2.
 *
 * @param {string} wallet - Wallet del Faraone uscente
 * @param {string} nome - Nome
 * @param {string} tipoAccount - PRIMARIO | PERPETUO | GEMELLO | FONDO
 * @param {number} nettoOriginale - Netto calcolato da URANO 2 (610 Primario, 110 Secondario)
 * @param {number} numeroTurno - Numero turno uscita
 * @returns {Object} Dettaglio deduzioni e netto finale
 */
async function hookUscitaL3(wallet, nome, tipoAccount, nettoOriginale, numeroTurno) {
  console.log(`\n🌉 BRIDGE — Uscita URANO 2 L3 (Venere) → Nettuno`);
  console.log(`   Wallet: ${wallet.substring(0, 12)}...`);
  console.log(`   Tipo: ${tipoAccount}`);
  console.log(`   Netto originale URANO 2: ${nettoOriginale} USDC`);

  let nettoFinale = nettoOriginale;
  const deduzioni = [];
  const cassaWallet = process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';
  const isSecondario = tipoAccount === 'PERPETUO' || tipoAccount === 'GEMELLO';

  // 1. AUTO-ENTRY Nettuno + eventuale Sole L0 URANUS
  //    PRIMARIO/FONDO : DUAL Nettuno (1 CASSA + 1 HUMAN) = −20 USDC
  //    SECONDARIO     : 1 HUMAN Nettuno (−10 USDC) + 1 rientro Sole L0 URANUS (−10 USDC)
  if (tipoAccount !== 'FONDO') {
    if (!isSecondario) {
      // PRIMARIO: DUAL entry Nettuno
      const pCassa = await queue.aggiungiPosizione({
        wallet: cassaWallet, nome: 'CASSA (da URANO 2 L3)', tipo: 'CASSA',
      });
      const pHuman = await queue.aggiungiPosizione({
        wallet, nome: `${nome} (da URANO 2 L3)`, tipo: 'HUMAN',
      });
      nettoFinale -= BRIDGE.COSTO_ENTRY_FIFO;
      deduzioni.push({
        tipo: 'ENTRY_FIFO_DUAL', importo: BRIDGE.COSTO_ENTRY_FIFO,
        dettaglio: `DUAL Nettuno: CASSA pos ${pCassa.posizione}, HUMAN pos ${pHuman.posizione}`
      });
      console.log(`   ✅ Nettuno DUAL: CASSA pos ${pCassa.posizione}, HUMAN pos ${pHuman.posizione} (−${BRIDGE.COSTO_ENTRY_FIFO} USDC)`);
    } else {
      // SECONDARIO: 1 HUMAN in Nettuno (−10) + 1 rientro Sole L0 URANUS (−10)
      const pHuman = await queue.aggiungiPosizione({
        wallet, nome: `${nome} (da URANO 2 L3 Sec.)`, tipo: 'HUMAN',
      });
      nettoFinale -= BRIDGE.COSTO_ENTRY_FIFO_SECONDARIO;
      deduzioni.push({
        tipo: 'ENTRY_FIFO_HUMAN', importo: BRIDGE.COSTO_ENTRY_FIFO_SECONDARIO,
        dettaglio: `Nettuno 1 HUMAN: pos ${pHuman.posizione}`
      });
      // 1 rientro singolo Sole L0 URANUS = −10 USDC → coda background
      asyncQ.enqueue(() => posizionaRientroSole(wallet, `${nome} Sole L0 Uranus (da L3 Sec.)`), 'sole-l0-sec-l3');
      nettoFinale -= BRIDGE.L3_SOLE_L0_SECONDARIO;
      await pg.queryOne(
        `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
         VALUES ('SOLE_L0_URANUS_L3_SEC', $1, $2, 1, $3) RETURNING *`,
        [wallet, BRIDGE.L3_SOLE_L0_SECONDARIO, tipoAccount]
      );
      deduzioni.push({
        tipo: 'SOLE_L0_URANUS', importo: BRIDGE.L3_SOLE_L0_SECONDARIO,
        dettaglio: `1 rientro Sole L0 URANUS a nome ${wallet.substring(0, 10)}`
      });
      console.log(`   ✅ Secondario: Nettuno HUMAN pos ${pHuman.posizione} (−${BRIDGE.COSTO_ENTRY_FIFO_SECONDARIO}) + Sole L0 URANUS (−${BRIDGE.L3_SOLE_L0_SECONDARIO}) USDC`);
    }
  }

  // 2. ROG SMALL (5 ingressi dual) + PHARAOH (100 USDC singolo, ACCANTONATO in cassa: PHARAOH_PENDING)
  //    Solo per Account Primario
  if (tipoAccount === 'PRIMARIO' || tipoAccount === 'FONDO') {
    nettoFinale -= BRIDGE.L3_DEDUZIONE_TOTALE;

    // 5 ingressi dual ROG SMALL (10 posizioni: 5 utente + 5 sistema) = −10 USDC
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ('ROG_SMALL_BRIDGE_L3', $1, $2, $3, $4) RETURNING *`,
      [wallet, BRIDGE.L3_ROG_SMALL_COSTO, BRIDGE.L3_ROG_SMALL_NUM, tipoAccount]
    );
    // PHARAOH SINGOLO (100 USDC) — ACCANTONATO in cassa URANUS (PHARAOH_PENDING):
    // i 100 USDC NON vengono ricircolati a Sole; restano fermi in cassa, riservati
    // al PHARAOH, finché PHARAOH non parte (poi rilasciati come ingresso PHARAOH).
    await pg.queryOne(
      `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
       VALUES ('PHARAOH_PENDING_L3', $1, $2, 0, $3) RETURNING *`,
      [wallet, BRIDGE.L3_PHARAOH_COSTO, tipoAccount]
    );
    deduzioni.push({
      tipo: 'ROG_SMALL', importo: BRIDGE.L3_ROG_SMALL_COSTO,
      dettaglio: `5 ingressi dual ROG SMALL (10 posizioni: 5 utente + 5 sistema)`
    });
    deduzioni.push({
      tipo: 'PHARAOH', importo: BRIDGE.L3_PHARAOH_COSTO,
      dettaglio: `PHARAOH SINGOLO: ${BRIDGE.L3_PHARAOH_COSTO} USDC accantonati in cassa URANUS (PHARAOH_PENDING), in attesa avvio PHARAOH`
    });
    console.log(`   ✅ ROG SMALL 5 dual (−${BRIDGE.L3_ROG_SMALL_COSTO}) + PHARAOH accantonato in cassa (−${BRIDGE.L3_PHARAOH_COSTO})`);

    // 💸 ROG SMALL → CASSA ROG (reale, persistito + retry).
    // PHARAOH (100) NON esce: resta accantonato in cassa Uranus (PHARAOH_PENDING_L3)
    // come dono attivo, fino all'avvio di Pharaoh.
    await cassaTransfer.registraTrasferimento({
      destinazione: 'ROG', importo: BRIDGE.L3_ROG_SMALL_COSTO,
      origineWallet: wallet, motivo: `ROG_SMALL_BRIDGE_L3 ${wallet}`,
      eventKey: `rog-l3-turno-${numeroTurno}`,
    });
  }

  // 3. Cascata FIFO → coda background (non blocca la risposta)
  asyncQ.enqueue(() => queue.processaUsciteCascata(), 'cascata-fifo-l3');
  
// 5. DONO PENDENTE: l'utente deve cliccare ACCETTA DONO (90 giorni)
console.log(`   🎁 DONO PENDENTE: ${nettoFinale} USDC → ${wallet} (ACCETTA DONO entro 90 giorni)`);
await giftManager.creaDonoPendente(wallet, nettoFinale, 3, 'PAYOUT_L3', { tipoAccount, deduzioni });

// 4. KYC CHECK — verifica prima del payout
const kycCheck = await kycBridge.requireKycForPayout(wallet, nettoFinale);
if (!kycCheck.canProceed) {
  console.log(`   🪪 PAYOUT L3 SOSPESO — KYC non verificato per ${wallet}`);
    // Registra payout sospeso nel bridge log, ma non blocca il flusso
    await pg.queryOne(
      `INSERT INTO bridge_log (wallet, evento, netto_originale, deduzioni_totali, netto_finale, dettagli)
       VALUES ($1, 'PAYOUT_L3_KYC_PENDING', $2, $3, $4, $5) RETURNING *`,
      [wallet, nettoOriginale, nettoOriginale - nettoFinale, nettoFinale, JSON.stringify({ kycCheck, tipoAccount, deduzioni })]
    );
    return { nettoOriginale, deduzioni, nettoFinale, kycPending: true, kycCheck };
  }

  // 5. DONO PENDENTE: l'utente deve cliccare ACCETTA DONO (90 giorni)


  // Registra nel bridge log
  await pg.queryOne(
    `INSERT INTO bridge_log (wallet, evento, netto_originale, deduzioni_totali, netto_finale, dettagli)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [wallet, 'USCITA_L3', nettoOriginale, nettoOriginale - nettoFinale, nettoFinale, JSON.stringify({ tipoAccount, deduzioni, cascataInCoda: true })]
  );

  // ⛓️ Registra on-chain (fire-and-forget)
  chainRegistrar.registerPayout(wallet, nettoFinale, 3, `PAYOUT_L3_${wallet}_${Date.now()}`);
  if (tipoAccount === 'PRIMARIO' || tipoAccount === 'FONDO') {
    chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_ROG_SMALL', BRIDGE.L3_ROG_SMALL_COSTO, 'ROG');
    chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_PHARAOH', BRIDGE.L3_PHARAOH_COSTO, 'PHARAOH');
    // 🌐 Cross-platform: notifica ROG e PHARAOH
    crossPlatform.registraRogSmall(wallet, 5, BRIDGE.L3_ROG_SMALL_COSTO, 'BRIDGE_L3');
    crossPlatform.registraPharaohSuRog(wallet, BRIDGE.L3_PHARAOH_COSTO, 'PHARAOH_BRIDGE_L3');
  }

  // Aggiungi equivalente USDC al risultato (per il frontend)
  const payoutDisplay = goldConverter.toDisplayObject(nettoFinale, 'USDC');
  return { nettoOriginale, deduzioni, nettoFinale, payoutDisplay, cascataInCoda: true };
}

// ══════════════════════════════════════════
// HOOK: Uscita da URANO 2 L5 (Saturno)
// ══════════════════════════════════════════

/**
 * Chiamato AUTOMATICAMENTE dopo gestisciUscitaL5() in URANO 2.
 *
 * @param {string} wallet - Wallet del Faraone uscente
 * @param {string} nome - Nome
 * @param {number} nettoOriginale - Netto L5 (1.900 USDC)
 * @param {number} numeroTurno - Numero turno uscita
 * @returns {Object} Dettaglio deduzioni e netto finale
 */
async function hookUscitaL5(wallet, nome, nettoOriginale, numeroTurno) {
  console.log(`\n🌉 BRIDGE — Uscita URANO 2 L5 (Saturno)`);
  console.log(`   Wallet: ${wallet.substring(0, 12)}...`);
  console.log(`   Netto originale L5: ${nettoOriginale} USDC`);

  let nettoFinale = nettoOriginale;
  const deduzioni = [];
  const cassaWallet = process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';

  // ── ROG SMALL (50 ingressi dual = 100 posizioni) — 100 USDC ──────────
  nettoFinale -= BRIDGE.L5_DEDUZIONE_TOTALE;  // 400 = 100 (ROG SMALL) + 300 (a nome utente)

  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('ROG_SMALL_BRIDGE_L5', $1, $2, $3, 'SECONDARIO') RETURNING *`,
    [wallet, BRIDGE.L5_ROG_SMALL_COSTO, BRIDGE.L5_ROG_SMALL_NUM]
  );
  deduzioni.push({
    tipo: 'ROG_SMALL', importo: BRIDGE.L5_ROG_SMALL_COSTO,
    dettaglio: `50 ingressi dual ROG SMALL (100 posizioni: 50 utente + 50 sistema)`
  });
  console.log(`   ✅ ROG SMALL L5: 50 dual (−${BRIDGE.L5_ROG_SMALL_COSTO} USDC)`);

  // ── DISTRIBUZIONE 300 USDC a nome dell'utente (definita sessione 4) ──
  // 1. PHARAOH SINGOLO (100 USDC) — ACCANTONATO in cassa URANUS (PHARAOH_PENDING_L5),
  //    come L3/Nettuno: i 100 USDC restano in cassa, riservati al PHARAOH, finché non parte.
  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('PHARAOH_PENDING_L5', $1, $2, 0, 'SECONDARIO') RETURNING *`,
    [wallet, BRIDGE.L5_PHARAOH_COSTO]
  );
  deduzioni.push({
    tipo: 'PHARAOH', importo: BRIDGE.L5_PHARAOH_COSTO,
    dettaglio: `PHARAOH SINGOLO: ${BRIDGE.L5_PHARAOH_COSTO} USDC accantonati in cassa URANUS (PHARAOH_PENDING), in attesa avvio PHARAOH`
  });

  // 2. ROG SMALL EXTRA (50 ingressi dual = 100 posizioni = 100 USDC) a nome utente
  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('ROG_SMALL_EXTRA_L5', $1, $2, $3, 'SECONDARIO') RETURNING *`,
    [wallet, BRIDGE.L5_ROG_SMALL_EXTRA_COSTO, BRIDGE.L5_ROG_SMALL_EXTRA_NUM]
  );
  deduzioni.push({
    tipo: 'ROG_SMALL_EXTRA', importo: BRIDGE.L5_ROG_SMALL_EXTRA_COSTO,
    dettaglio: `50 ingressi dual ROG SMALL (100 pos: 50 utente + 50 sistema) a nome ${wallet.substring(0,10)}`
  });

  // 3. SOLE L0 URANUS (5 ingressi dual = 10 posizioni = 100 USDC) → coda background
  { const _w5s = wallet, _n5s = nome, _c5s = cassaWallet;
    for (let i = 0; i < BRIDGE.L5_SOLE_L0_NUM / 2; i++) {
      const idx = i;
      asyncQ.enqueue(() => posizionaRientroSole(_c5s, `CASSA Sole L0 Uranus L5 #${idx+1} (${_w5s.substring(0,8)})`), `sole-l0-l5-c${idx}`);
      asyncQ.enqueue(() => posizionaRientroSole(_w5s, `${_n5s} Sole L0 Uranus L5 #${idx+1}`), `sole-l0-l5-h${idx}`);
    }
  }
  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('SOLE_L0_URANUS_L5', $1, $2, $3, 'SECONDARIO') RETURNING *`,
    [wallet, BRIDGE.L5_SOLE_L0_COSTO, BRIDGE.L5_SOLE_L0_NUM]
  );
  deduzioni.push({
    tipo: 'SOLE_L0_URANUS', importo: BRIDGE.L5_SOLE_L0_COSTO,
    dettaglio: `5 ingressi dual Sole L0 URANUS (10 pos: 5 HUMAN + 5 CASSA) a nome ${wallet.substring(0,10)}`
  });
  console.log(`   ✅ 300 USDC a nome ${nome}: PHARAOH(100) + ROG SMALL(100) + Sole L0(100)`);

  // 💸 ROG SMALL → CASSA ROG (reale, persistito + retry): 100 base + 100 extra = 200.
  // PHARAOH (100) resta accantonato in cassa Uranus (PHARAOH_PENDING_L5) fino all'avvio di Pharaoh.
  await cassaTransfer.registraTrasferimento({
    destinazione: 'ROG', importo: BRIDGE.L5_ROG_SMALL_COSTO,
    origineWallet: wallet, motivo: `ROG_SMALL_BRIDGE_L5 ${wallet}`,
    eventKey: `rog-l5-small-turno-${numeroTurno}`,
  });
  await cassaTransfer.registraTrasferimento({
    destinazione: 'ROG', importo: BRIDGE.L5_ROG_SMALL_EXTRA_COSTO,
    origineWallet: wallet, motivo: `ROG_SMALL_EXTRA_BRIDGE_L5 ${wallet}`,
    eventKey: `rog-l5-extra-turno-${numeroTurno}`,
  });

  // Auto-entry Nettuno per il secondario uscente da L5: 5 ingressi DUAL
  // (5 CASSA + 5 HUMAN = 10 posizioni in coda = 100 USDC), come le altre gestioni.
  const cassaFifoL5 = process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';
  for (let i = 0; i < BRIDGE.L5_NETTUNO_NUM / 2; i++) {
    await queue.aggiungiPosizione({ wallet: cassaFifoL5, nome: `CASSA (da L5) #${i+1}`, tipo: 'CASSA' });
    await queue.aggiungiPosizione({ wallet, nome: `${nome} (da L5) #${i+1}`, tipo: 'HUMAN' });
  }
  nettoFinale -= BRIDGE.L5_NETTUNO_COSTO;
  deduzioni.push({
    tipo: 'ENTRY_FIFO', importo: BRIDGE.L5_NETTUNO_COSTO,
    dettaglio: `${BRIDGE.L5_NETTUNO_NUM} posizioni Nettuno da L5 (5 CASSA + 5 HUMAN)`
  });
  console.log(`   ✅ Auto-entry Nettuno da L5: 5 dual (−${BRIDGE.L5_NETTUNO_COSTO} USDC)`);

  // Cascata FIFO L5 → coda background
  asyncQ.enqueue(() => queue.processaUsciteCascata(), 'cascata-fifo-l5');

  // KYC CHECK L5 — verifica prima del payout
 console.log(`   🎁 DONO PENDENTE L5: ${nettoFinale} USDC → ${wallet} (ACCETTA DONO entro 90 giorni)`);
  await giftManager.creaDonoPendente(wallet, nettoFinale, 5, 'PAYOUT_L5', { deduzioni });  
  const kycCheckL5 = await kycBridge.requireKycForPayout(wallet, nettoFinale);
  if (!kycCheckL5.canProceed) {
    console.log(`   🪪 PAYOUT L5 SOSPESO — KYC non verificato per ${wallet}`);
    await pg.queryOne(
      `INSERT INTO bridge_log (wallet, evento, netto_originale, deduzioni_totali, netto_finale, dettagli)
       VALUES ($1, 'PAYOUT_L5_KYC_PENDING', $2, $3, $4, $5) RETURNING *`,
      [wallet, nettoOriginale, nettoOriginale - nettoFinale, nettoFinale, JSON.stringify({ kycCheck: kycCheckL5, deduzioni })]
    );
    return { nettoOriginale, deduzioni, nettoFinale, kycPending: true, kycCheck: kycCheckL5 };
  }

  // DONO PENDENTE L5: l'utente deve cliccare ACCETTA DONO (90 giorni)
 
  await pg.queryOne(
    `INSERT INTO bridge_log (wallet, evento, netto_originale, deduzioni_totali, netto_finale, dettagli)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [wallet, 'USCITA_L5', nettoOriginale, nettoOriginale - nettoFinale, nettoFinale, JSON.stringify({ deduzioni, cascataInCoda: true })]
  );

  // ⛓️ Registra on-chain (fire-and-forget)
  chainRegistrar.registerPayout(wallet, nettoFinale, 5, `PAYOUT_L5_${wallet}_${Date.now()}`);
  chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_ROG_SMALL', BRIDGE.L5_ROG_SMALL_COSTO, 'ROG');
  chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_PHARAOH', BRIDGE.L5_PHARAOH_COSTO, 'PHARAOH');
  chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_ROG_SMALL_EXTRA', BRIDGE.L5_ROG_SMALL_EXTRA_COSTO, 'ROG');
  chainRegistrar.registerBridgeEvent(wallet, 'BRIDGE_SOLE_L0', BRIDGE.L5_SOLE_L0_COSTO, 'URANUS');
  // 🌐 Cross-platform: notifica ROG e PHARAOH
  crossPlatform.registraRogSmall(wallet, 50, BRIDGE.L5_ROG_SMALL_COSTO, 'BRIDGE_L5');
  crossPlatform.registraRogSmall(wallet, 50, BRIDGE.L5_ROG_SMALL_EXTRA_COSTO, 'BRIDGE_L5_EXTRA');
  crossPlatform.registraPharaohSuRog(wallet, BRIDGE.L5_PHARAOH_COSTO, 'PHARAOH_BRIDGE_L5');

  return { nettoOriginale, deduzioni, nettoFinale, cascataInCoda: true };
}

// ══════════════════════════════════════════
// STATO BRIDGE
// ══════════════════════════════════════════

async function getStatoBridge() {
  const fifoStato = await queue.getStatoFifo();
  const fifoStats = await queue.getStatisticheFifo();

  const bridgeStats = await pg.queryOne(`
    SELECT
      (SELECT COUNT(*) FROM bridge_log) AS totale_bridge_events,
      (SELECT COUNT(*) FROM bridge_log WHERE evento = 'USCITA_L3') AS bridge_l3,
      (SELECT COUNT(*) FROM bridge_log WHERE evento = 'USCITA_L5') AS bridge_l5,
      (SELECT COALESCE(SUM(deduzioni_totali), 0) FROM bridge_log) AS totale_deduzioni,
      (SELECT COALESCE(SUM(netto_finale), 0) FROM bridge_log) AS totale_netti_finali,
      (SELECT COALESCE(SUM(importo), 0) FROM flussi_esterni WHERE tipo LIKE 'ROG_SMALL%') AS totale_rog_small,
      (SELECT COALESCE(SUM(importo), 0) FROM flussi_esterni WHERE tipo LIKE 'RIENTRI_SOLE%') AS totale_rientri_sole
  `);

  return {
    fifo: {
      stato: fifoStato,
      statistiche: {
        totalePosizioniCoda: Number(fifoStats?.totale_posizioni) || 0,
        posizioniInCoda: Number(fifoStats?.posizioni_in_coda) || 0,
        posizioniUscite: Number(fifoStats?.posizioni_uscite) || 0,
        totaleRientri: Number(fifoStats?.totale_rientri) || 0,
        totaleUscite: Number(fifoStats?.totale_uscite) || 0,
        usciteHuman: Number(fifoStats?.uscite_human) || 0,
        usciteCassa: Number(fifoStats?.uscite_cassa) || 0,
        totaleDistribuito: Number(fifoStats?.totale_distribuito) || 0,
        totaleAccantonato: Number(fifoStats?.totale_accantonato) || 0,
      }
    },
    bridge: {
      totaleEvents: Number(bridgeStats?.totale_bridge_events) || 0,
      bridgeL3: Number(bridgeStats?.bridge_l3) || 0,
      bridgeL5: Number(bridgeStats?.bridge_l5) || 0,
      totaleDeduzioni: Number(bridgeStats?.totale_deduzioni) || 0,
      totaleNettiFinali: Number(bridgeStats?.totale_netti_finali) || 0,
    },
    flussiEsterni: {
      rogSmall: Number(bridgeStats?.totale_rog_small) || 0,
      rientriSole: Number(bridgeStats?.totale_rientri_sole) || 0,
    }
  };
}

module.exports = {
  BRIDGE,
  hookUscitaL3,
  hookUscitaL5,
  getStatoBridge,
};
