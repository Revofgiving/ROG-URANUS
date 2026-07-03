/**
 * 🌀 URANO — Donation Flow Manager
 *
 * FLUSSO PHARAON ÷ 10 con doppia posizione (HUMAN + CASSA):
 *
 * ENTRATA: 20 USDC → 2 posizioni (10 HUMAN + 10 CASSA)
 *   Tavola L0: 6 donatori × 10 = 60 → erede esce con 50 (10 trattenuti, restituiti a L3)
 *
 * BLOCCO 1: Luna (L1,2) → Mercurio (L2,2) → Venere (L3,3)
 *   18 sacerdoti × 50 = 900 + 10 restituiti = 910 lordo
 *   Cassa: 300 (Funzioni) → Netto Primario: 610 | Secondario: 110 (+500 per L4)
 *
 * BLOCCO 2: Giove (L4,3) → Saturno (L5,3)
 *   L4: 3×500 = 1500 → netto 400 | L5: 3×1000 = 3000 → netto 2900 (scelta URANUS: 10 crediti, non 110)
 *
 * Ogni posizione (HUMAN e CASSA) percorre lo STESSO identico percorso.
 */
'use strict';

const db              = require('./db-manager');
const tableManager    = require('./table-manager');
const containerManager = require('./container-manager');
const functionManager = require('./function-manager');
const rules           = require('./rules-engine');
const verifier        = require('./blockchain-verifier');
const bridge          = require('./bridge-manager');
const predisposizione = require('./predisposizione-manager');
const chainRegistrar  = require('./chain-registrar');
const goldConverter   = require('./gold-converter');
const rogChecker      = require('./rog-prerequisite-checker');
const payoutMgr       = require('./payout-manager');
const { URANUS_CASSA_WALLET } = require('./wallet-cassa'); // 🏛️ UNICO riferimento cassa Uranus

// Tesoreria on-chain: dove ARRIVANO e si registrano le donazioni. Coincide con la CASSA Uranus.
const TREASURY_WALLET = URANUS_CASSA_WALLET;
// 🏛️ LEGGE COMMITTENTE: la posizione 0 (Fondo "A", erede della tavola #1, apre i turni) È SEMPRE
// il wallet Fortunato, a prescindere da qualsiasi env su Coolify. Fortunato detiene la posizione 0;
// eventuali sue ulteriori posizioni verranno create esplicitamente in futuro. NON sovrascrivere via env.
// NB: la tesoreria on-chain (TREASURY_WALLET) resta separata e invariata.
const FORTUNATO_WALLET = '0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4';
const FONDO_WALLET = FORTUNATO_WALLET;
// 🏛️ LEGGE COMMITTENTE: la posizione "gemella" CASSA che ogni utente forma all'iscrizione è
// assegnata alla CASSA URANUS on-chain (0x4f53…). Unico riferimento: URANUS_CASSA_WALLET.
const CASSA_WALLET = URANUS_CASSA_WALLET;
const FONDO_SIGLA = 'A';
const SYSTEM_WALLETS = new Set([
  '0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4',
  '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce',
]);

function isSystemWallet(wallet) {
  return SYSTEM_WALLETS.has(String(wallet || '').toLowerCase());
}

// ========================================
// INIZIALIZZAZIONE
// ========================================

async function inizializzaSistema() {
  await db.initDatabase();
  const state = await db.getState('sistema', null);
  if (state && state.inizializzato) {
    console.log('✅ Sistema URANO già inizializzato');
    return state;
  }

  console.log('\n🌀 ========================================');
  console.log('   INIZIALIZZAZIONE SISTEMA URANO');
  console.log('========================================\n');

  // Account Fondo (A)
  await db.createAccount({ wallet: FONDO_WALLET, nome: 'Fondo URANO (A)', tipo: 'FONDO', sigla: FONDO_SIGLA });

  // Account CASSA (sistema)
  await db.createAccount({ wallet: CASSA_WALLET, nome: 'CASSA (Sistema)', tipo: 'CASSA' });

  // Prima tavola entrata
  const primaTavola = await tableManager.creaTavolaPercorso(0, FONDO_WALLET, 1);

  // Turno entrata
  await db.createTurno({
    sezione: 'ENTRATA', livello: 0, blocco: null, numeroTurno: 1,
    faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO', sacerdotiNecessari: 6
  });

  // Turno Blocco 1
  await db.createTurno({
    sezione: 'URANO', livello: 1, blocco: 1, numeroTurno: 1,
    faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO',
    sacerdotiNecessari: rules.IMPORTI.SACERDOTI_PRIMO_TURNO
  });

  // Turni Blocco 2
  await db.createTurno({
    sezione: 'URANO', livello: 4, blocco: 2, numeroTurno: 1,
    faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO', sacerdotiNecessari: 3
  });
  await db.createTurno({
    sezione: 'URANO', livello: 5, blocco: 2, numeroTurno: 1,
    faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO', sacerdotiNecessari: 3
  });

  // ── NETTUNO: parte VUOTO ────────────────────────────────────────
  // Nettuno si riempie naturalmente tramite:
  //   1. Bridge L3/L5: posizioni inserite ad ogni uscita da Venere/Saturno
  //   2. Auto-fill da Sole: 1 HUMAN per ogni tavola L0 completata
  //   3. Rientri perpetui: 6/18 rientri per ogni uscita Nettuno
  // Nessun seed artificiale — nessun USDC non coperto.
  console.log(`\n🌊 Nettuno: parte vuoto, si riempirà naturalmente da Bridge + Sole + Rientri`);

  const nuovoState = {
    inizializzato: true, turnoEntrata: 1, turnoSistemaUrano: 1,
    primaTavolaEntrata: primaTavola.numero,
    fondoWallet: FONDO_WALLET, cassaWallet: CASSA_WALLET,
    nettunoSeed: 0
  };
  await db.setState('sistema', nuovoState);

  console.log('✅ Sistema URANO inizializzato');
  console.log(`   Fondo (A): ${FONDO_WALLET}`);
  console.log(`   CASSA: ${CASSA_WALLET}`);
  console.log(`   Nettuno: vuoto (riempimento naturale)`);
  return nuovoState;
}

// ========================================
// INGRESSO SACERDOTE NEL BLOCCO 1
// ========================================

async function posizionaSacerdoteInUrano(wallet, nome, chiaveSdoppiamentoSole = null) {
  const pg = require('./pg-connection-manager');
  const turno = await db.getTurnoCorrente('URANO', 1);
  if (!turno) {
    console.log(`   ⚠️  Nessun turno Urano attivo — sacerdote in coda`);
    await containerManager.trasferisciAContenitore52(wallet, null, `Sacerdote: ${nome}`);
    return null;
  }

  // Fondo = Faraone ricevente, non sacerdote
  const accountInIngresso = await db.getAccount(wallet);
  if (accountInIngresso?.tipo === 'FONDO') {
    const tavolaLuna = await tableManager.getTavolaPercorsoAttiva(1, turno.numero_turno);
    if (!tavolaLuna) {
      await tableManager.creaTavolaPercorso(1, turno.faraone_wallet, turno.numero_turno);
      console.log(`   👑 Faraone ${nome} entra nel Blocco 1 — tavola Luna creata`);
    }
    return { isFaraone: true, wallet, turno: turno.numero_turno };
  }

  // Trova tavola aperta L1→L2→L3
  let tavolaAttiva = null, livelloCorrente = null;
  for (const liv of [1, 2, 3]) {
    tavolaAttiva = await tableManager.getTavolaPercorsoAttiva(liv, turno.numero_turno);
    if (tavolaAttiva) { livelloCorrente = liv; break; }
  }

  if (!tavolaAttiva) {
    const entrati = turno.sacerdoti_entrati;
    livelloCorrente = entrati < 2 ? 1 : entrati < 6 ? 2 : 3;
    tavolaAttiva = await tableManager.creaTavolaPercorso(livelloCorrente, turno.faraone_wallet, turno.numero_turno);
    if (livelloCorrente === 3) await inserisciGemelloPendente(turno.numero_turno);
  }

  const livNome = { 1: 'LUNA', 2: 'MERCURIO', 3: 'VENERE' };
  console.log(`   ⛩️  Sacerdote → ${livNome[livelloCorrente]} (tavola #${tavolaAttiva.numero})`);

  await tableManager.posizionaDonatore({
    tavolaId: tavolaAttiva.id, tavolaNumero: tavolaAttiva.numero,
    livello: livelloCorrente, wallet, nome, tipo: 'DONATORE',
    donoImporto: rules.IMPORTI.DONO_URANO, turno: turno.numero_turno, sdoppiabile: true
  });

  await db.incrementSacerdotiEntrati(turno.id);

  const { sacerdoti_entrati } = await pg.queryOne('SELECT sacerdoti_entrati FROM turni WHERE id = $1', [turno.id]);
  const entrati = Number(sacerdoti_entrati) || 0;
  console.log(`   Sacerdoti nel Blocco 1: ${entrati}/${turno.sacerdoti_necessari}`);

  // 🔮 PREDISPOSIZIONE: calcola le posizioni future di questo sacerdote.
  // In transazione la avvolgiamo in un SAVEPOINT: se fallisce (best-effort),
  // annulla solo questo passo senza compromettere l'intera transazione.
  try {
    const pgConn = require('./pg-connection-manager');
    await pgConn.savepoint(() => predisposizione.calcolaPredisposizione(wallet, turno.numero_turno, entrati, turno.faraone_wallet, chiaveSdoppiamentoSole));
  } catch (e) { console.log(`   ⚠️  Predisposizione non calcolata: ${e.message}`); }

  // Progressioni
  if (livelloCorrente === 1 && entrati === 2) {
    console.log('\n   🏛️ LUNA COMPLETATO → progressione a Mercurio');
    await tableManager.avanzaSacerdotiAlLivello(1, 2, turno.numero_turno, turno.faraone_wallet);
  }
  if (livelloCorrente === 2 && entrati === 6) {
    console.log('\n   🏛️ MERCURIO COMPLETATO → progressione a Venere');
    await tableManager.avanzaSacerdotiAlLivello(2, 3, turno.numero_turno, turno.faraone_wallet);
    await inserisciGemelloPendente(turno.numero_turno);
  }

  if (entrati >= turno.sacerdoti_necessari) {
    console.log(`\n   🏆 VENERE COMPLETATO (${entrati}/${turno.sacerdoti_necessari}) → FARAONE ESCE`);
    await gestisciUscitaFaraone(turno);
  }

  return { livelloCorrente, tavolaNumero: tavolaAttiva.numero, entrati };
}

// ========================================
// DONO DA WALLET (20 USDC → 2 posizioni)
// ========================================

async function processaDonoEntrataWallet({ wallet, txHash, numeroPosizioni, nome }) {
  await db.initDatabase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Wallet non valido');
  if (!txHash) throw new Error('txHash obbligatorio');

  const w = wallet.toLowerCase();
  const nomeEff = (nome || '').trim() || `${w.substring(0, 8)}...`;
  const pg = require('./pg-connection-manager');

  // ═══════════════════════════════════════════════════════════════
  // GATE OBBLIGATORIO: Prerequisiti ROG
  // L'utente DEVE essere iscritto alla community ROG E avere
  // almeno una donazione ROG completata prima di entrare in URANUS.
  // ═══════════════════════════════════════════════════════════════
  if (!verifier.isDevSkip(txHash)) {
    if (isSystemWallet(w)) {
      console.log(`   [SYSTEM-WALLET] ROG gate bypassato per ${w}`);
    } else {
      const rogStatus = await rogChecker.checkAllPrerequisites(w);
      if (!rogStatus.canProceed) {
        const motivi = [];
        if (!rogStatus.communityRegistered) motivi.push('non iscritto alla community ROG');
        if (!rogStatus.rogDonationDone) motivi.push('nessuna donazione ROG completata');
        throw new Error(`Prerequisiti ROG non soddisfatti: ${motivi.join(', ')}. Completa prima il percorso ROG.`);
      }
      console.log(`   ✅ Prerequisiti ROG verificati (community + ${rogStatus.rogPositions} posizioni ROG)`);
    }
  }


  let n, importoTotale;
  if (verifier.isDevSkip(txHash)) {
    n = Math.max(1, Math.floor(Number(numeroPosizioni) || 1));
    importoTotale = rules.IMPORTI.COSTO_PER_PERSONA * n;
  } else {
    const verifica = await verifier.verificaDonazione({ txHash, walletMittente: w, importoMinimo: rules.IMPORTI.COSTO_PER_PERSONA });
    // Usa le coppie calcolate dal verificatore: USDC = importo/20, XAUT0 = (importo × prezzo oro USD)/20.
    // NON ricalcolare n da importoEffettivo (che per XAUT0 è in once d'oro, non in USD).
    n = Math.max(1, Number(verifica.numeroPosizioni) || 1);
    // importoTotale salvato in DB = USDC-equivalente (n × 20).
    // Per XAUt0 l'importoEffettivo è in once d'oro → userebbe valori come 0.017 invece di 80 USDC.
    importoTotale = verifica.tokenKey === 'XAUT0'
      ? n * rules.IMPORTI.COSTO_PER_PERSONA
      : verifica.importoEffettivo;
  }

  console.log(`\n🌀 DONO ${n} COPPIA${n > 1 ? 'E' : ''} — wallet: ${w} — ${importoTotale} USDC`);

  // ✍️ Scritture atomiche in transazione: account + ticket + posizioni + donazione.
  // Se una qualsiasi operazione fallisce (es. tavola piena), si annulla TUTTO:
  // niente account orfani, niente posizioni/tavole a metà.
  const { account, posizioni } = await pg.transaction(async () => {
    let account = await db.getAccount(w);
    if (!account) account = await db.createAccount({ wallet: w, nome: nomeEff, tipo: 'PRIMARIO' });
    if (!account.ticket_number) account = await db.assignTicket(w);
    console.log(`   🎟️  Ticket: ${account.ticket_number}`);

    const posizioni = [];
    for (let i = 0; i < n; i++) {
      // 1. Posizione CASSA (sistema) — PRIMA
      const rCassa = await posizionaDonatoreEntrata(CASSA_WALLET, 'CASSA');
      posizioni.push({ tipo: 'CASSA', ...rCassa });
      console.log(`   ✅ [${i + 1}/${n}] CASSA → Tavola #${rCassa.tavolaNumero} casella ${rCassa.casella}/6`);

      // 2. Posizione HUMAN (utente) — DOPO
      const rHuman = await posizionaDonatoreEntrata(w, nomeEff);
      posizioni.push({ tipo: 'HUMAN', ...rHuman });
      console.log(`   ✅ [${i + 1}/${n}] HUMAN → Tavola #${rHuman.tavolaNumero} casella ${rHuman.casella}/6`);
    }

    if (!verifier.isDevSkip(txHash)) {
      await db.createDonazione({
        donorWallet: w, importo: importoTotale, txHash,
        destinatarioWallet: TREASURY_WALLET,
        tavolaId: posizioni[0]?.tavolaId, livello: 0, turno: posizioni[0]?.turno
      });
    }

    return { account, posizioni };
  });

  // ⛓️ Registro on-chain URANUS (fire-and-forget, FUORI dalla transazione DB)
  if (!verifier.isDevSkip(txHash)) {
    chainRegistrar.registerDonation(w, importoTotale, txHash);
  }

  // Aggiungi equivalente USDC per donazioni in XAUt0
  const tokenUsato = verifier.isDevSkip(txHash) ? 'USDC' : (posizioni[0]?.token || 'USDC');
  const importoDisplay = goldConverter.toDisplayObject(importoTotale, tokenUsato);

  return {
    success: true, wallet: w, ticket: account.ticket_number, numeroCoppie: n,
    importoTotale, token: tokenUsato, importoDisplay,
    posizioni
  };
}

/**
 * Piazza UNA singola coppia (CASSA + HUMAN) di una donazione, per l'ALTERNANZA SOLIDALE.
 * Alla PRIMA coppia esegue il setup completo: gate ROG, verifica tx on-chain,
 * account/ticket, createDonazione (anti-replay). Le coppie successive: solo piazzamento.
 *
 * Lo `state` è mantenuto dal chiamante (donation-queue) tra una coppia e l'altra:
 *   { setupDone, n, importoTotale, token, ticket, placed, numeroPosizioni }
 *
 * DURABILITÀ: il progresso (setup_done, total_coppie, placed_coppie) è persistito in
 * donation_queue DENTRO la stessa transazione del piazzamento (atomico). In caso di
 * crash/riavvio, recoverIncompleteJobs() riprende esattamente dalle coppie mancanti
 * senza ri-verificare la tx (no doppio anti-replay, nessuna coppia persa/duplicata).
 *
 * @returns {{ state, done, placed, total, ticket }}
 */
async function processaCoppiaEntrata({ wallet, txHash, nome, state, jobId = null }) {
  await db.initDatabase();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Wallet non valido');
  if (!txHash) throw new Error('txHash obbligatorio');

  const w = wallet.toLowerCase();
  const nomeEff = (nome || '').trim() || `${w.substring(0, 8)}...`;
  const pg = require('./pg-connection-manager');
  state = state || {};

  if (!state.setupDone) {
    // GATE ROG (identico a processaDonoEntrataWallet)
    if (!verifier.isDevSkip(txHash)) {
      if (isSystemWallet(w)) {
        console.log(`   [SYSTEM-WALLET] ROG gate bypassato per ${w}`);
      } else {
        const rogStatus = await rogChecker.checkAllPrerequisites(w);
        if (!rogStatus.canProceed) {
          const motivi = [];
          if (!rogStatus.communityRegistered) motivi.push('non iscritto alla community ROG');
          if (!rogStatus.rogDonationDone) motivi.push('nessuna donazione ROG completata');
          throw new Error(`Prerequisiti ROG non soddisfatti: ${motivi.join(', ')}. Completa prima il percorso ROG.`);
        }
      }
    }

    // Verifica importo / numero coppie (una sola volta)
    if (verifier.isDevSkip(txHash)) {
      state.n = Math.max(1, Math.floor(Number(state.numeroPosizioni) || 1));
      state.importoTotale = rules.IMPORTI.COSTO_PER_PERSONA * state.n;
      state.token = 'USDC';
    } else {
      const verifica = await verifier.verificaDonazione({ txHash, walletMittente: w, importoMinimo: rules.IMPORTI.COSTO_PER_PERSONA });
      state.n = Math.max(1, Number(verifica.numeroPosizioni) || 1);
      // USDC-equivalente per DB: per XAUt0 importoEffettivo è in once d'oro, non in USDC.
      state.importoTotale = verifica.tokenKey === 'XAUT0'
        ? state.n * rules.IMPORTI.COSTO_PER_PERSONA
        : verifica.importoEffettivo;
      state.token = verifica.token || 'USDC';
    }

    // Setup + PRIMA coppia (atomico)
    const out = await pg.transaction(async () => {
      let account = await db.getAccount(w);
      if (!account) account = await db.createAccount({ wallet: w, nome: nomeEff, tipo: 'PRIMARIO' });
      if (!account.ticket_number) account = await db.assignTicket(w);

      const rCassa = await posizionaDonatoreEntrata(CASSA_WALLET, 'CASSA');
      await posizionaDonatoreEntrata(w, nomeEff);

      if (!verifier.isDevSkip(txHash)) {
        await db.createDonazione({
          donorWallet: w, importo: state.importoTotale, txHash,
          destinatarioWallet: TREASURY_WALLET,
          tavolaId: rCassa.tavolaId, livello: 0, turno: rCassa.turno,
        });
      }
      // Progresso persistito ATOMICAMENTE con setup + coppia 1 (durabilità anti-crash).
      if (jobId) {
        await pg.query(
          `UPDATE donation_queue SET setup_done = TRUE, total_coppie = $1, placed_coppie = 1, status = 'PROCESSING' WHERE id = $2`,
          [state.n, jobId]
        );
      }
      return { account };
    });

    if (!verifier.isDevSkip(txHash)) chainRegistrar.registerDonation(w, state.importoTotale, txHash);

    state.ticket = out.account.ticket_number;
    state.setupDone = true;
    state.placed = 1;
    console.log(`\ud83c\udf00 [Alternanza] Setup + coppia 1/${state.n} — ${w.substring(0, 10)} ticket=${state.ticket}`);
  } else {
    // Coppia successiva: solo piazzamento (CASSA + HUMAN), progresso persistito ATOMICAMENTE.
    const newPlaced = (state.placed || 0) + 1;
    await pg.transaction(async () => {
      await posizionaDonatoreEntrata(CASSA_WALLET, 'CASSA');
      await posizionaDonatoreEntrata(w, nomeEff);
      if (jobId) {
        await pg.query(`UPDATE donation_queue SET placed_coppie = $1 WHERE id = $2`, [newPlaced, jobId]);
      }
    });
    state.placed = newPlaced;
    console.log(`\ud83c\udf00 [Alternanza] Coppia ${state.placed}/${state.n} — ${w.substring(0, 10)}`);
  }

  return { state, done: state.placed >= state.n, placed: state.placed, total: state.n, ticket: state.ticket };
}

// ========================================
// POSIZIONAMENTO L0
// ========================================

// ========================================
// AUTO-RECOVERY TURNO ENTRATA
// ========================================

async function autoRecoverTurnoEntrata() {
  const pg = require('./pg-connection-manager');

  // Caso A: turno IN_CORSO con sacerdoti >= necessari (stuck 6/6)
  const turnoStuck = await pg.queryOne(
    `SELECT * FROM turni WHERE sezione='ENTRATA' AND livello=0 AND status='IN_CORSO'
     AND sacerdoti_entrati >= sacerdoti_necessari ORDER BY numero_turno DESC LIMIT 1`
  );
  if (turnoStuck) {
    console.warn(`\u26a0\ufe0f  [AUTO-RECOVERY] Turno #${turnoStuck.numero_turno} stuck ${turnoStuck.sacerdoti_entrati}/${turnoStuck.sacerdoti_necessari} \u2192 sblocco automatico`);
    await avviaNuovoTurnoEntrata(turnoStuck);
    return await db.getTurnoCorrente('ENTRATA', 0);
  }

  // Caso B: nessun turno IN_CORSO — trova l'ultimo e riparte
  const pg2 = require('./pg-connection-manager');
  const ultimo = await pg2.queryOne(
    `SELECT * FROM turni WHERE sezione='ENTRATA' AND livello=0 ORDER BY numero_turno DESC LIMIT 1`
  );
  if (!ultimo) return null;

  const nuovoN = ultimo.numero_turno + 1;

  // Se esiste già un turno con questo numero in stato anomalo, lo riattiva
  const esistente = await pg2.queryOne(
    `SELECT * FROM turni WHERE sezione='ENTRATA' AND livello=0 AND numero_turno=$1`, [nuovoN]
  );
  if (esistente) {
    if (esistente.status !== 'IN_CORSO') {
      await pg2.query(`UPDATE turni SET status='IN_CORSO' WHERE id=$1`, [esistente.id]);
      console.warn(`\u26a0\ufe0f  [AUTO-RECOVERY] Turno #${nuovoN} riattivato (era ${esistente.status})`);
    }
    return await db.getTurnoCorrente('ENTRATA', 0);
  }

  // Crea nuovo turno di emergenza con FONDO
  console.warn(`\ud83d\udd27 [AUTO-RECOVERY] Creo turno ENTRATA #${nuovoN} di emergenza`);
  const nuovaTavola = await tableManager.creaTavolaPercorso(0, FONDO_WALLET, nuovoN);
  await db.createTurno({
    sezione: 'ENTRATA', livello: 0, blocco: null, numeroTurno: nuovoN,
    faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO',
    tavolaFaraoneNum: nuovaTavola.numero, sacerdotiNecessari: 6
  });
  console.log(`\ud83d\udd04 [AUTO-RECOVERY] Turno #${nuovoN} creato \u2192 sistema riattivato (tavola #${nuovaTavola.numero})`);
  return await db.getTurnoCorrente('ENTRATA', 0);
}

// Watchdog esportato: chiamato ogni 60s da api-server.js
async function watchdogTurnoEntrata() {
  try {
    const turno = await db.getTurnoCorrente('ENTRATA', 0);
    let fixed = false;

    if (!turno) {
      console.warn('\ud83d\udd27 [WATCHDOG] Nessun turno ENTRATA attivo \u2192 auto-recovery');
      await autoRecoverTurnoEntrata();
      fixed = true;
    } else if (Number(turno.sacerdoti_entrati) >= Number(turno.sacerdoti_necessari)) {
      console.warn(`\ud83d\udd27 [WATCHDOG] Turno #${turno.numero_turno} bloccato (${turno.sacerdoti_entrati}/${turno.sacerdoti_necessari}) \u2192 sblocco`);
      await avviaNuovoTurnoEntrata(turno);
      fixed = true;
    }

    // Se abbiamo sbloccato un turno, riaccoda subito le donazioni FAILED per turno
    if (fixed) {
      try {
        const donationQueue = require('./donation-queue');
        await donationQueue.retryFailedTurnoJobs();
      } catch (e2) {
        console.error('\u26a0\ufe0f [WATCHDOG] retryFailedTurnoJobs errore:', e2.message);
      }
    }
  } catch (e) {
    console.error(`\u26a0\ufe0f [WATCHDOG] Errore: ${e.message}`);
  }
}

// 🔮 Riserve Gemelli nella numerazione Sole L0: 26, 40, 54 … = 26 + 14k
// (spec v12 reg.10 / rules.regolaTicketGemello). Questi slot sono SALTATI dai donatori
// e occupati in anticipo (occupazione anticipata delle caselle).
function isPosizioneRiservataSole(p) { return p >= 26 && (p - 26) % 14 === 0; }

async function posizionaDonatoreEntrata(wallet, nome, tipoPos = 'DONATORE') {
  // 🔮 PREDESTINAZIONE Sole L0: prima di piazzare un DONATORE (CASSA/HUMAN),
  // materializza le eventuali RISERVE (Gemelli 26+14k) che cadono sulla PROSSIMA casella,
  // così i donatori "saltano" quegli slot esattamente come nella mappa cronologica certificata.
  // La riserva occupa la casella ma è NON-sdoppiabile e NON gradua a Blocco 1
  // (slot tenuto dal sistema finché il faraone gemello-releasing non lo reclama).
  if (tipoPos === 'DONATORE') {
    let guard = 0;
    while (guard++ < 100) {
      const tCur = await db.getTurnoCorrente('ENTRATA', 0);
      if (!tCur) break;
      const tavCur = await tableManager.getTavolaPercorsoAttiva(0, tCur.numero_turno);
      if (!tavCur) break;
      const occ = await db.countPosizioniInTavola(tavCur.id);
      const pNext = (tCur.numero_turno - 1) * 6 + (occ + 1);
      if (!isPosizioneRiservataSole(pNext)) break;
      // Materializza lo slot come RISERVATA; verrà "reclamato" (→ GEMELLO) e accoppiato
      // al Gemello giusto quando il faraone proprietario esce da Venere (gestisciUscitaFaraone).
      console.log(`   🔒 Riserva RISERVATA → posizione Sole ${pNext} (ticket Gemello 26+14k)`);
      await posizionaDonatoreEntrata(CASSA_WALLET, `RISERVA Gemello ticket ${pNext}`, 'RISERVATA');
    }
  }

  const isRiserva = (tipoPos !== 'DONATORE');
  let turno = await db.getTurnoCorrente('ENTRATA', 0);
  if (!turno) {
    // Tentativo automatico di recupero prima di fallire
    console.warn(`\u26a0\ufe0f  [AUTO-RECOVERY] Nessun turno attivo per ${wallet.substring(0,10)} \u2192 recupero...`);
    turno = await autoRecoverTurnoEntrata();
    if (!turno) {
      // Errore RETRYABLE: il watchdog lo sistema entro 60s, la coda riprova automaticamente
      const err = new Error('Nessun turno attivo — watchdog in corso, retry automatico');
      err.retryable = true;
      throw err;
    }
  }
  const tavola = await tableManager.getTavolaPercorsoAttiva(0, turno.numero_turno);
  if (!tavola) {
    const err = new Error('Nessuna tavola aperta al livello di entrata — retry automatico');
    err.retryable = true;
    throw err;
  }

  const r = await tableManager.posizionaDonatore({
    tavolaId: tavola.id, tavolaNumero: tavola.numero, livello: 0,
    wallet, nome, tipo: tipoPos, donoImporto: isRiserva ? 0 : rules.IMPORTI.DONO_ENTRATA,
    turno: turno.numero_turno, sdoppiabile: !isRiserva,
    numeroPosizioneBase: (turno.numero_turno - 1) * 6
  });
  await db.incrementSacerdotiEntrati(turno.id);

  // 🔮 PRENOTAZIONE FUNZIONI AL MOMENTO DELL'INGRESSO (Sole L0):
  // ogni "numero" che entra ottiene SUBITO la sua scheda di predisposizione,
  // agganciata alla PROPRIA tavola di sdoppiamento Sole (chiave stabile fino alla
  // graduazione). Best-effort in savepoint: un errore qui non compromette il dono.
  if (!isRiserva && r.tavolaSdoppiamento?.numero) {
    try {
      const pgConn = require('./pg-connection-manager');
      await pgConn.savepoint(() => predisposizione.prenotaIngressoSole(wallet, r.tavolaSdoppiamento.numero, turno.numero_turno));
    } catch (e) { console.log(`   ⚠\ufe0f  Prenotazione ingresso Sole non calcolata: ${e.message}`); }
  }

  if (r.tavolaCompleta) {
    const eredeWallet  = tavola.faraone_wallet;
    const eredeAccount = await db.getAccount(eredeWallet);
    const nomeErede    = eredeAccount?.nome || eredeWallet.substring(0, 10);
    const isFondo      = eredeAccount?.tipo === 'FONDO';
    const doniRicevuti = rules.IMPORTI.DONO_ENTRATA * 6;

    if (isFondo) {
      console.log(`\n🏦 TAVOLA #${tavola.numero} COMPLETA — FONDO (A) → 60 USDC in cassa`);
      await db.registraAvanzamento({
        wallet: eredeWallet, tipoAccount: 'FONDO',
        daLivello: 0, aLivello: 1, turno: turno.numero_turno,
        doniRicevuti, doniTrattenuti: doniRicevuti, netto: 0, evento: 'USCITA_ENTRATA'
      });
    } else {
      const trattenuta = rules.IMPORTI.TRATTENUTA_FONDO_ENTRATA;
      const netto = doniRicevuti - trattenuta;
      console.log(`\n🏆 TAVOLA #${tavola.numero} COMPLETA — SACERDOTE ${nomeErede} → ingresso Blocco 1`);
      console.log(`   ${nomeErede}: 60 USDC ricevuti → 10 USDC accantonati (restituiti a Venere), 50 USDC nel Blocco 1`);
      await db.registraAvanzamento({
        wallet: eredeWallet, tipoAccount: 'SACERDOTE',
        daLivello: 0, aLivello: 1, turno: turno.numero_turno,
        doniRicevuti, doniTrattenuti: trattenuta, netto, evento: 'USCITA_ENTRATA'
      });
    }

    // ✔️ FIX DEFINITIVO: posizionaSacerdoteInUrano in SAVEPOINT.
    // Il semplice try-catch non basta: se la funzione lancia un errore SQL
    // la transazione PG rimane in stato "aborted" e avviaNuovoTurnoEntrata fallisce.
    // Con savepoint(), in caso di errore si fa rollback SOLO di questo step
    // lasciando la transazione principale attiva e funzionante.
    try {
      const pgConn = require('./pg-connection-manager');
      await pgConn.savepoint(() => posizionaSacerdoteInUrano(eredeWallet, nomeErede, tavola.numero));
    } catch (sacerdoteErr) {
      console.error(`⚠️ [ENTRATA] Sacerdote non posizionato in URANO (savepoint rollback): ${sacerdoteErr.message}`);
      console.error(`   avviaNuovoTurnoEntrata procede comunque.`);
    }

    // ── NETTUNO: NESSUN auto-entry alla graduazione Sole (LEGGE COMMITTENTE) ────
    // REGOLA CORRETTA: le posizioni Nettuno (dual = 1 CASSA + 1 uscente) si formano
    // ESCLUSIVAMENTE alle USCITE da Venere (L3) e Saturno (L5), gestite dai bridge
    // hookUscitaL3 / hookUscitaL5. L'auto-entry "da Sole" è stato RIMOSSO perché
    // sovra-popolava Nettuno al momento della donazione/graduazione invece che alle uscite.

    // SEMPRE chiamato: garantisce che il nuovo turno ENTRATA venga creato.
    // NOTA: viene chiamato DENTRO la transazione padre (è corretto: le SDOPPIAMENTO
    // create in questa stessa transazione sono già visibili nella stessa connessione PG).
    // Il fallback in avviaNuovoTurnoEntrata copre il caso raro in cui non fossero disponibili.
    await avviaNuovoTurnoEntrata(turno);
  }

  return {
    tavolaNumero: tavola.numero, tavolaId: tavola.id,
    casella: r.casellaOccupata, turno: turno.numero_turno,
    numeroPosizione: (turno.numero_turno - 1) * 6 + r.casellaOccupata,
    tavolaCompleta: r.tavolaCompleta, sdoppiamento: r.tavolaSdoppiamento?.numero ?? null
  };
}

// ========================================
// NUOVO TURNO ENTRATA
// ========================================

async function avviaNuovoTurnoEntrata(turnoChiuso) {
  await db.completaTurno(turnoChiuso.id, rules.IMPORTI.DONO_ENTRATA * 6);
  const pg = require('./pg-connection-manager');
  const nuovoN = turnoChiuso.numero_turno + 1;

  const prossima = await pg.queryOne(
    `SELECT * FROM tavole WHERE tipo='SDOPPIAMENTO' AND status='APERTA' AND livello=0 ORDER BY numero ASC LIMIT 1`
  );

  if (!prossima) {
    // FALLBACK: nessuna tavola SDOPPIAMENTO disponibile
    // Creiamo una tavola di emergenza con FONDO come erede
    // cos\u00ec il sistema non rimane mai senza turno attivo.
    console.warn(`\u26a0\ufe0f  [AUTO-RECOVERY] Nessuna tavola SDOPPIAMENTO per turno #${nuovoN} \u2192 tavola emergenza con FONDO`);
    const nuovaTavola = await tableManager.creaTavolaPercorso(0, FONDO_WALLET, nuovoN);
    await db.createTurno({
      sezione: 'ENTRATA', livello: 0, blocco: null, numeroTurno: nuovoN,
      faraoneWallet: FONDO_WALLET, faraoneTipo: 'FONDO',
      tavolaFaraoneNum: nuovaTavola.numero, sacerdotiNecessari: 6
    });
    console.log(`\ud83d\udd04 [AUTO-RECOVERY] Turno entrata #${nuovoN} avviato (tavola emergenza #${nuovaTavola.numero})`);
    return;
  }

  await pg.query(`UPDATE tavole SET tipo='PERCORSO', turno=$1 WHERE id=$2`, [nuovoN, prossima.id]);
  await db.createTurno({
    sezione: 'ENTRATA', livello: 0, blocco: null, numeroTurno: nuovoN,
    faraoneWallet: prossima.faraone_wallet, faraoneTipo: 'EREDE',
    tavolaFaraoneNum: prossima.numero, sacerdotiNecessari: 6
  });
  console.log(`\n\ud83d\udd04 Turno entrata #${nuovoN} \u2014 erede: ${prossima.faraone_wallet.substring(0, 12)}...`);
}

// ========================================
// USCITA FARAONE (L3 Venere)
// ========================================

async function gestisciUscitaFaraone(turno) {
  const faraoneWallet = turno.faraone_wallet;
  const account = await db.getAccount(faraoneWallet);
  const tipoAccount = account?.tipo || 'PRIMARIO';
  const sigla = account?.sigla || FONDO_SIGLA;
  const doniRicevuti = rules.IMPORTI.DONO_TOTALE_L3;

  console.log(`\n🏆 ========================================`);
  console.log(`   USCITA FARAONE DAL LIVELLO 3 (VENERE)`);
  console.log(`========================================`);
  console.log(`   Faraone: ${sigla} (${tipoAccount})`);

  const uscita = rules.calcolaUscitaLivello(3, tipoAccount, doniRicevuti);

  console.log(`   Doni ricevuti: ${doniRicevuti} + ${uscita.accantonamentoRestituito} restituiti = ${uscita.lordoEffettivo}`);
  console.log(`   Riserva cassa: ${uscita.trattenutaCassa} → Funzioni + struttura`);
  console.log(`   Netto Faraone: ${uscita.netto}`);

  // Rilascio Funzioni
  const funzioni = await functionManager.rilasciaFunzioniL3({
    faraoneWallet, faraoneSigla: sigla, tipoAccount, turnoCorrente: turno.numero_turno
  });

  // 🔗 ACCOPPIAMENTO Gemello ↔ slot Sole riservato (ticket 26+14k): il Gemello appena
  // rilasciato "reclama" la sua posizione riservata, che diventa GEMELLO col wallet/sigla giusti.
  // È l'accoppiamento forense: slot 26 → Gemello 1-A di Fortunato, 40 → 2° faraone, ecc.
  if (funzioni?.gemello?.account?.ticketPrenotato) {
    const g = funzioni.gemello.account;
    try {
      const pgConn = require('./pg-connection-manager');
      await pgConn.query(
        `UPDATE posizioni SET tipo = 'GEMELLO', wallet = $1, nome = $2
         WHERE numero_posizione = $3 AND tipo IN ('RISERVATA','GEMELLO')`,
        [String(g.wallet).toLowerCase(), g.sigla, g.ticketPrenotato]
      );
      console.log(`   🔗 Gemello ${g.sigla} accoppiato allo slot Sole riservato ${g.ticketPrenotato}`);
    } catch (e) { console.error(`⚠️ accoppiamento Gemello slot ${g.ticketPrenotato}: ${e.message}`); }
  }

  // Alert
  try { const alerts = require('./alert-manager'); alerts.alertPayout(faraoneWallet, uscita.netto, turno.numero_turno); } catch (_) {}

  await db.registraAvanzamento({
    wallet: faraoneWallet, tipoAccount,
    daLivello: 3, aLivello: uscita.passaAlL4 ? 4 : null,
    daBlocco: 1, aBlocco: uscita.passaAlL4 ? 2 : null,
    turno: turno.numero_turno, doniRicevuti: uscita.lordoEffettivo,
    doniTrattenuti: (uscita.trattenutaCassa || 0) + (uscita.trattenutaIngressoL4 || 0),
    netto: uscita.netto, evento: 'USCITA_L3',
    dettagli: { uscita, funzioni: { simbionti: funzioni.simbionti.length, perpetuo: !!funzioni.perpetuo, gemello: !!funzioni.gemello } }
  });

  // 🌉 BRIDGE: auto-entry in URANO 1 (FIFO) + deduzioni ROG/PHARAON
  const nomeAccount = account?.nome || faraoneWallet.substring(0, 10);
  const bridgeResult = await bridge.hookUscitaL3(faraoneWallet, nomeAccount, tipoAccount, uscita.netto, turno.numero_turno);

  // Secondario → L4
  if (uscita.passaAlL4) {
    console.log(`   ➡️  Secondario: passa a L4 Giove con ${uscita.trattenutaIngressoL4} USDC`);
    await posizionaFaraoneInL4(faraoneWallet, nomeAccount);
  } else {
    console.log(`   🏁 Primario esce con ${bridgeResult.nettoFinale} USDC netti (dopo bridge)`);
  }

  // 🎁 CANALE UNICO (decisione business): anche il FONDO usa ESCLUSIVAMENTE il dono pendente
  // creato in bridge.hookUscitaL3() → ACCETTA DONO → accettaDono() → inviaPagamento().
  // L'auto-payout del FONDO è stato RIMOSSO per eliminare il doppio canale (auto-payout +
  // ACCETTA DONO) che poteva produrre una doppia distribuzione (es. 500 + 500 = 1000 USDC).
  // PRIMARIO/SECONDARIO invariati: non hanno mai avuto auto-payout (il guard era === 'FONDO').

  await db.completaTurno(turno.id, doniRicevuti);
  // I 5 crediti L3 (50 USDC) restano STANDBY in pool 5.3 → non creano posizioni singole.
  // I 50 USDC corrispondenti rimangono in cassa URANUS.
  // Le posizioni AL VOLO vengono create SOLO come dual (5 CASSA+5 HUMAN) a L4 e L5.
  await avviaNuovoTurnoUrano(turno);
  console.log(`========================================\n`);
  return { uscita, funzioni };
}

// ========================================
// BLOCCO 2 — L4 GIOVE
// ========================================

async function posizionaFaraoneInL4(wallet, nome) {
  const pg = require('./pg-connection-manager');
  const turno = await db.getTurnoCorrente('URANO', 4);
  if (!turno) { console.log(`   ⚠️  Nessun turno L4 attivo`); return null; }

  let tavola = await tableManager.getTavolaPercorsoAttiva(4, turno.numero_turno);
  if (!tavola) tavola = await tableManager.creaTavolaPercorso(4, turno.faraone_wallet, turno.numero_turno);

  console.log(`   ⛩️  Faraone Secondario → L4 GIOVE tavola #${tavola.numero}`);
  await tableManager.posizionaDonatore({
    tavolaId: tavola.id, tavolaNumero: tavola.numero, livello: 4,
    wallet, nome, tipo: 'DONATORE', donoImporto: rules.IMPORTI.TRATTENUTA_L4_INGRESSO,
    turno: turno.numero_turno, sdoppiabile: true
  });
  await db.incrementSacerdotiEntrati(turno.id);

  const { sacerdoti_entrati } = await pg.queryOne('SELECT sacerdoti_entrati FROM turni WHERE id = $1', [turno.id]);
  const entrati = Number(sacerdoti_entrati) || 0;
  console.log(`   Faraoni a Giove: ${entrati}/${turno.sacerdoti_necessari}`);

  if (entrati >= turno.sacerdoti_necessari) {
    console.log(`\n   🏆 GIOVE COMPLETATO → FARAONE ESCE DA L4`);
    await gestisciUscitaL4(turno);
  }
  return { tavola, entrati };
}

// ========================================
// POSIZIONI AL VOLO — L4 (5 CASSA + 5 HUMAN a Sole L0)
// ========================================
/**
 * All'uscita da L4 Giove, il sistema crea 5 dual (5 CASSA + 5 HUMAN) a Sole L0
 * per chi ha fatto richiesta di una posizione al volo (coda FIFO attiva).
 *   Priorità: primo in coda richieste_posizioni_volo (IN_ATTESA, FIFO).
 *   Fallback: Fortunato (posizione 0) se la coda è vuota.
 */
async function creaPosizioniAlVoloL4(originWallet) {
  const pg = require('./pg-connection-manager');
  const NUM_DUAL = 5;
  const inAttesa = await containerManager.contaRichiesteInAttesa();
  console.log(`\n\ud83c\udf1f [L4 AL VOLO] ${NUM_DUAL} DUAL Sole L0 — richieste in coda: ${inAttesa} | fallback: Fortunato (pos.0)`);

  for (let i = 0; i < NUM_DUAL; i++) {
    // Preleva prossima richiesta dalla coda FIFO; se vuota usa Fortunato (posizione 0)
    const richiesta = await containerManager.prelevaProssimaRichiestaVolo();
    const humanWallet = richiesta ? richiesta.wallet : FORTUNATO_WALLET;
    const humanNome   = richiesta ? (richiesta.nome || `${richiesta.wallet.substring(0, 10)}`) : 'Fortunato (pos.0)';

    if (richiesta) {
      console.log(`   \u21b3 [${i + 1}/${NUM_DUAL}] HUMAN da coda: ${humanNome} (richiesta #${richiesta.id})`);
    } else {
      console.log(`   \u21b3 [${i + 1}/${NUM_DUAL}] coda vuota \u2192 HUMAN assegnato a Fortunato (pos.0)`);
    }

    // Posizione CASSA prima, HUMAN dopo (ordine standard dual)
    await posizionaDonatoreEntrata(CASSA_WALLET, 'CASSA');
    await posizionaDonatoreEntrata(humanWallet, humanNome);
  }

  // Registra flusso al volo (100 USDC = 10 pos. da pool 5.3)
  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('POSIZIONI_AL_VOLO_L4', $1, 100, 10, 'L4_VOLO') RETURNING *`,
    [originWallet]
  );
  console.log(`   \u2705 [L4 AL VOLO] ${NUM_DUAL} CASSA + ${NUM_DUAL} HUMAN creati a Sole L0 (100 USDC pool 5.3)`);
}

async function gestisciUscitaL4(turno) {
  const faraoneWallet = turno.faraone_wallet;
  const account = await db.getAccount(faraoneWallet);
  const tipoAccount = account?.tipo || 'PERPETUO';
  const doniRicevuti = rules.IMPORTI.DONO_TOTALE_L4;
  const uscita = rules.calcolaUscitaLivello(4, tipoAccount, doniRicevuti);

  console.log(`\n🏆 USCITA L4 GIOVE — netto: ${uscita.netto}`);

  await functionManager.rilasciaFunzioniL4({ faraoneWallet, turnoCorrente: turno.numero_turno });
  await db.registraAvanzamento({
    wallet: faraoneWallet, tipoAccount,
    daLivello: 4, aLivello: 5, daBlocco: 2, aBlocco: 2,
    turno: turno.numero_turno, doniRicevuti,
    doniTrattenuti: uscita.trattenutaIngressoL5 + uscita.trattenutaCrediti,
    netto: uscita.netto, evento: 'USCITA_L4'
  });
  await db.completaTurno(turno.id, doniRicevuti);
  await avviaNextTurnoL4(turno);

  // 🎁 Dono pendente Giove (L4): l'utente lo ritira via ACCETTA DONO (gate fondi in cassa).
  // L4 è sempre Secondario (PERPETUO/GEMELLO): nessun auto-pay FONDO.
  try {
    const giftManager = require('./gift-manager');
    await giftManager.creaDonoPendente(faraoneWallet, uscita.netto, 4, 'PAYOUT_L4', { tipoAccount });
  } catch (e) { console.error(`⚠️  [L4] creaDonoPendente: ${e.message}`); }

  // 🌟 Posizioni al volo: 5 CASSA + 5 HUMAN a Sole L0 (pool 5.3, coda FIFO; fallback Fortunato pos.0).
  try {
    await creaPosizioniAlVoloL4(faraoneWallet);
  } catch (e) { console.error(`⚠️  [L4] creaPosizioniAlVoloL4: ${e.message}`); }

  await posizionaFaraoneInL5(faraoneWallet, account?.nome || faraoneWallet.substring(0, 10));
  return { uscita };
}

async function avviaNextTurnoL4(turnoChiuso) {
  const pg = require('./pg-connection-manager');
  const nuovoN = turnoChiuso.numero_turno + 1;
  const prossima = await pg.queryOne(
    `SELECT * FROM tavole WHERE tipo='SDOPPIAMENTO' AND status='APERTA' AND livello=4 ORDER BY numero ASC LIMIT 1`
  );
  if (!prossima) { console.log('⚠️  Nessuna tavola L4 sdoppiata'); return; }
  await pg.query(`UPDATE tavole SET tipo='PERCORSO', turno=$1 WHERE id=$2`, [nuovoN, prossima.id]);
  await db.createTurno({ sezione: 'URANO', livello: 4, blocco: 2, numeroTurno: nuovoN, faraoneWallet: prossima.faraone_wallet, faraoneTipo: 'SECONDARIO', sacerdotiNecessari: 3 });
  console.log(`\n🔄 Nuovo turno L4 #${nuovoN}`);
}

// ========================================
// POSIZIONI AL VOLO — L5 (5 CASSA + 5 HUMAN a Sole L0)
// ========================================
/**
 * All'uscita da L5 Saturno, il sistema crea 5 dual (5 CASSA + 5 HUMAN) a Sole L0
 * per chi ha fatto richiesta di una posizione al volo (coda FIFO attiva).
 *   Priorità: primo in coda richieste_posizioni_volo (IN_ATTESA, FIFO).
 *   Fallback: Fortunato (posizione 0) se la coda è vuota.
 */
async function creaPosizioniAlVoloL5(originWallet) {
  const pg = require('./pg-connection-manager');
  const NUM_DUAL = 5;
  const inAttesa = await containerManager.contaRichiesteInAttesa();
  console.log(`\n\ud83c\udf1f [L5 AL VOLO] ${NUM_DUAL} DUAL Sole L0 — richieste in coda: ${inAttesa} | fallback: Fortunato (pos.0)`);

  for (let i = 0; i < NUM_DUAL; i++) {
    const richiesta = await containerManager.prelevaProssimaRichiestaVolo();
    const humanWallet = richiesta ? richiesta.wallet : FORTUNATO_WALLET;
    const humanNome   = richiesta ? (richiesta.nome || `${richiesta.wallet.substring(0, 10)}`) : 'Fortunato (pos.0)';

    if (richiesta) {
      console.log(`   \u21b3 [${i + 1}/${NUM_DUAL}] HUMAN da coda: ${humanNome} (richiesta #${richiesta.id})`);
    } else {
      console.log(`   \u21b3 [${i + 1}/${NUM_DUAL}] coda vuota \u2192 HUMAN assegnato a Fortunato (pos.0)`);
    }

    await posizionaDonatoreEntrata(CASSA_WALLET, 'CASSA');
    await posizionaDonatoreEntrata(humanWallet, humanNome);
  }

  await pg.queryOne(
    `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
     VALUES ('POSIZIONI_AL_VOLO_L5', $1, 100, 10, 'L5_VOLO') RETURNING *`,
    [originWallet]
  );
  console.log(`   \u2705 [L5 AL VOLO] ${NUM_DUAL} CASSA + ${NUM_DUAL} HUMAN creati a Sole L0 (100 USDC pool 5.3)`);
}

// ========================================
// BLOCCO 2 — L5 SATURNO
// ========================================

async function posizionaFaraoneInL5(wallet, nome) {
  const pg = require('./pg-connection-manager');
  const turno = await db.getTurnoCorrente('URANO', 5);
  if (!turno) { console.log(`   ⚠️  Nessun turno L5 attivo`); return null; }

  let tavola = await tableManager.getTavolaPercorsoAttiva(5, turno.numero_turno);
  if (!tavola) tavola = await tableManager.creaTavolaPercorso(5, turno.faraone_wallet, turno.numero_turno);

  console.log(`   🔱 Faraone → L5 SATURNO tavola #${tavola.numero}`);
  await tableManager.posizionaDonatore({
    tavolaId: tavola.id, tavolaNumero: tavola.numero, livello: 5,
    wallet, nome, tipo: 'DONATORE', donoImporto: rules.IMPORTI.TRATTENUTA_L5_INGRESSO,
    turno: turno.numero_turno, sdoppiabile: true
  });
  await db.incrementSacerdotiEntrati(turno.id);

  const { sacerdoti_entrati } = await pg.queryOne('SELECT sacerdoti_entrati FROM turni WHERE id = $1', [turno.id]);
  const entrati = Number(sacerdoti_entrati) || 0;
  console.log(`   Faraoni a Saturno: ${entrati}/${turno.sacerdoti_necessari}`);

  if (entrati >= turno.sacerdoti_necessari) {
    console.log(`\n   🏆 SATURNO COMPLETATO → USCITA DEFINITIVA`);
    await gestisciUscitaL5(turno);
  }
  return { tavola, entrati };
}

async function gestisciUscitaL5(turno) {
  const faraoneWallet = turno.faraone_wallet;
  const account = await db.getAccount(faraoneWallet);
  const tipoAccount = account?.tipo || 'PERPETUO';
  const doniRicevuti = rules.IMPORTI.DONO_TOTALE_L5;
  const uscita = rules.calcolaUscitaLivello(5, tipoAccount, doniRicevuti);

  console.log(`\n🏆 USCITA DEFINITIVA L5 SATURNO — netto: ${uscita.netto}`);

  await functionManager.rilasciaFunzioniL5({ faraoneWallet, turnoCorrente: turno.numero_turno });
  await db.registraAvanzamento({
    wallet: faraoneWallet, tipoAccount,
    daLivello: 5, aLivello: null, daBlocco: 2, aBlocco: null,
    turno: turno.numero_turno, doniRicevuti,
    doniTrattenuti: uscita.trattenutaCrediti, netto: uscita.netto, evento: 'USCITA_L5'
  });
  await db.completaTurno(turno.id, doniRicevuti);
  await avviaNextTurnoL5(turno);

  // 🌉 BRIDGE: deduzioni L5 + auto-entry FIFO
  const nomeAccount = account?.nome || faraoneWallet.substring(0, 10);
  const bridgeResult = await bridge.hookUscitaL5(faraoneWallet, nomeAccount, uscita.netto, turno.numero_turno);

  // 🌟 Posizioni al volo: 5 CASSA + 5 HUMAN a Sole L0 (pool 5.3, coda FIFO; fallback Fortunato pos.0).
  try {
    await creaPosizioniAlVoloL5(faraoneWallet);
  } catch (e) { console.error(`⚠️  [L5] creaPosizioniAlVoloL5: ${e.message}`); }

  console.log(`🏁 Faraone esce DEFINITIVAMENTE (Uranus) — netto L5 dopo bridge: ${bridgeResult.nettoFinale} USDC`);
  console.log(`   Totale SUPERURANO: Venere Primario(480) + Venere Secondario(90) + Giove(400) + Saturno(${bridgeResult.nettoFinale}) + Nettuno(800) = ${480 + 90 + 400 + bridgeResult.nettoFinale + 800} USDC`);
  return { uscita, bridgeResult };
}

async function avviaNextTurnoL5(turnoChiuso) {
  const pg = require('./pg-connection-manager');
  const nuovoN = turnoChiuso.numero_turno + 1;
  const prossima = await pg.queryOne(
    `SELECT * FROM tavole WHERE tipo='SDOPPIAMENTO' AND status='APERTA' AND livello=5 ORDER BY numero ASC LIMIT 1`
  );
  if (!prossima) { console.log('⚠️  Nessuna tavola L5 sdoppiata'); return; }
  await pg.query(`UPDATE tavole SET tipo='PERCORSO', turno=$1 WHERE id=$2`, [nuovoN, prossima.id]);
  await db.createTurno({ sezione: 'URANO', livello: 5, blocco: 2, numeroTurno: nuovoN, faraoneWallet: prossima.faraone_wallet, faraoneTipo: 'SECONDARIO', sacerdotiNecessari: 3 });
  console.log(`\n🔄 Nuovo turno L5 #${nuovoN}`);
}

// ========================================
// GEMELLO LAZY INSERTION
// ========================================

async function inserisciGemelloPendente(turnoNum) {
  const pg = require('./pg-connection-manager');
  const gemelloPendente = await db.getState(`gemello_pendente_turno_${turnoNum}`, null);
  if (!gemelloPendente || !gemelloPendente.wallet) return;

  const countRow = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM tavole WHERE livello = 3 AND tipo = 'PERCORSO' AND turno = $1`, [turnoNum]
  );
  if (Number(countRow?.cnt) < 7) return;

  const settimaTavola = await pg.queryOne(
    `SELECT * FROM tavole WHERE livello = 3 AND tipo = 'PERCORSO' AND turno = $1 ORDER BY numero ASC LIMIT 1 OFFSET 6`, [turnoNum]
  );
  if (!settimaTavola) return;

  const gemelloGia = await pg.queryOne(`SELECT id FROM posizioni WHERE tavola_id = $1 AND tipo = 'GEMELLO'`, [settimaTavola.id]);
  if (gemelloGia) return;

  const casella2 = await pg.queryOne(`SELECT id FROM posizioni WHERE tavola_id = $1 AND casella = 2`, [settimaTavola.id]);
  if (casella2) return;

  console.log(`\n⚙️ INSERIMENTO GEMELLO ${gemelloPendente.nome} → Venere tavola #${settimaTavola.numero} casella 2`);

  const risultatoGem = await tableManager.posizionaDonatore({
    tavolaId: settimaTavola.id, tavolaNumero: settimaTavola.numero,
    livello: 3, wallet: gemelloPendente.wallet, nome: gemelloPendente.nome,
    tipo: 'GEMELLO', donoImporto: 50, turno: turnoNum, sdoppiabile: true
  });

  await pg.query(
    `UPDATE funzioni SET status = 'POSIZIONATO', tavola_posizionamento = $1, posizione_in_tavola = 'VENERE_TAV7_POS2' WHERE id = $2`,
    [settimaTavola.numero, gemelloPendente.funzioneId]
  );
  await db.setState(`gemello_pendente_turno_${turnoNum}`, {});
  console.log(`   ✅ Gemello posizionato (sdoppiamento #${risultatoGem.tavolaSdoppiamento?.numero})`);
}

// ========================================
// NUOVO TURNO URANO (reg.4)
// ========================================

async function avviaNuovoTurnoUrano(turnoChiuso) {
  const pg = require('./pg-connection-manager');
  const nuovoTurnoNum = turnoChiuso.numero_turno + 1;

  const prossima = await pg.queryOne(
    `SELECT * FROM tavole WHERE tipo = 'SDOPPIAMENTO' AND status = 'APERTA' AND livello IN (1, 2, 3) ORDER BY numero ASC LIMIT 1`
  );
  if (!prossima) { console.log('⚠️  Nessuna tavola Urano sdoppiata'); return; }

  await pg.query(
    `UPDATE tavole SET tipo = 'PERCORSO', turno = $1, livello = 1, capacita = 2, blocco = 1, sezione = 'URANO' WHERE id = $2`,
    [nuovoTurnoNum, prossima.id]
  );

  const nextAccount = await db.getAccount(prossima.faraone_wallet);
  const faraoneTipo = nextAccount?.tipo || 'PRIMARIO';

  await db.createTurno({
    sezione: 'URANO', livello: 1, blocco: 1,
    numeroTurno: nuovoTurnoNum, faraoneWallet: prossima.faraone_wallet,
    faraoneTipo, sacerdotiNecessari: rules.IMPORTI.SACERDOTI_DAL_SECONDO
  });

  console.log(`\n🔄 Nuovo turno Urano #${nuovoTurnoNum} — Faraone: ${prossima.faraone_wallet.substring(0, 12)}... (${faraoneTipo})`);

  // Inserisci Funzioni nel nuovo turno
  await inserisciFunzioniNelNuovoTurno({ numero_turno: nuovoTurnoNum }, prossima.faraone_wallet);
}

// ========================================
// POSIZIONAMENTO FUNZIONI (reg.6)
// ========================================

async function inserisciFunzioniNelNuovoTurno(nuovoTurno, faraoneWallet) {
  const pg = require('./pg-connection-manager');
  const funzioniPendenti = await db.getFunzioniPendentiPerTurno(nuovoTurno.numero_turno);
  if (funzioniPendenti.length === 0) {
    console.log(`   ℹ️  Nessuna Funzione pendente per turno ${nuovoTurno.numero_turno}`);
    return;
  }

  const simbionti = funzioniPendenti.filter(f => f.tipo === 'SIMBIONTE');
  const perpetuo = funzioniPendenti.find(f => f.tipo === 'PERPETUO');
  const gemello = funzioniPendenti.find(f => f.tipo === 'GEMELLO');

  console.log(`\n⚙️ POSIZIONAMENTO FUNZIONI turno ${nuovoTurno.numero_turno}`);

  const destConfig = tableManager.getLivelloConfig(2); // Mercurio

  // Mercurio tavola 1: Simbionti 1,2
  if (simbionti.length >= 2) {
    const gioveTav1 = await tableManager.creaTavolaPercorso(2, faraoneWallet, nuovoTurno.numero_turno);
    for (let i = 0; i < 2; i++) {
      const sim = simbionti[i];
      const simW = `0x${nuovoTurno.numero_turno.toString().padStart(8,'0')}SIM${(i+1).toString().padStart(10,'0')}`.substring(0,42).padEnd(42,'0');
      await db.createPosizione({ tavolaId: gioveTav1.id, casella: i + 1, wallet: simW, nome: sim.sigla, tipo: 'SIMBIONTE', donoImporto: 50 });
      await db.updateTavolaDoni(gioveTav1.numero, 50);
      await pg.query(`UPDATE funzioni SET status='POSIZIONATO', tavola_posizionamento=$1, posizione_in_tavola=$2 WHERE id=$3`,
        [gioveTav1.numero, `MERCURIO_TAV1_POS${i+1}`, sim.id]);
    }
    // Con cap=3, la tavola resta APERTA (2/3) — il 3° slot verrà riempito dalla progressione Luna→Mercurio
    console.log(`   ✅ Simbionti 1,2 → Mercurio tavola #${gioveTav1.numero} (2/${destConfig?.capacita || 3})`);
  }

  // Mercurio tavola 2: Simbionte 3 + Perpetuo
  if (simbionti.length >= 3 || perpetuo) {
    const gioveTav2 = await tableManager.creaTavolaPercorso(2, faraoneWallet, nuovoTurno.numero_turno);
    if (simbionti.length >= 3) {
      const sim3 = simbionti[2];
      const simW = `0x${nuovoTurno.numero_turno.toString().padStart(8,'0')}SIM${(3).toString().padStart(10,'0')}`.substring(0,42).padEnd(42,'0');
      await db.createPosizione({ tavolaId: gioveTav2.id, casella: 1, wallet: simW, nome: sim3.sigla, tipo: 'SIMBIONTE', donoImporto: 50 });
      await db.updateTavolaDoni(gioveTav2.numero, 50);
      await pg.query(`UPDATE funzioni SET status='POSIZIONATO', tavola_posizionamento=$1, posizione_in_tavola=$2 WHERE id=$3`,
        [gioveTav2.numero, 'MERCURIO_TAV2_POS1', sim3.id]);
    }
    if (perpetuo && perpetuo.account_generato_wallet) {
      const risultatoPerp = await tableManager.posizionaDonatore({
        tavolaId: gioveTav2.id, tavolaNumero: gioveTav2.numero, livello: 2,
        wallet: perpetuo.account_generato_wallet, nome: perpetuo.sigla,
        tipo: 'PERPETUO', donoImporto: 50, turno: nuovoTurno.numero_turno, sdoppiabile: true
      });
      await pg.query(`UPDATE funzioni SET status='POSIZIONATO', tavola_posizionamento=$1, posizione_in_tavola=$2 WHERE id=$3`,
        [gioveTav2.numero, 'MERCURIO_TAV2_POS2', perpetuo.id]);
      console.log(`   ✅ Perpetuo ${perpetuo.sigla} → Mercurio tavola #${gioveTav2.numero}`);
    }
  }

  // Gemello: lazy (7ª tavola Venere)
  if (gemello && gemello.account_generato_wallet) {
    await db.setState(`gemello_pendente_turno_${nuovoTurno.numero_turno}`, {
      funzioneId: gemello.id, wallet: gemello.account_generato_wallet,
      nome: gemello.sigla, turno: nuovoTurno.numero_turno,
      ticketPrenotato: gemello.ticket_prenotato
    });
    console.log(`   ⏳ Gemello ${gemello.sigla} → pendente (7ª tavola Venere)`);
  }
}

// ========================================
// STATO SISTEMA
// ========================================

async function getStatoSistema() {
  await db.initDatabase();
  const sistema = await db.getState('sistema', {});
  const contenitori = await containerManager.getStatoContenitori();
  const pg = require('./pg-connection-manager');

  const stats = await pg.queryOne(`
    SELECT
      (SELECT COUNT(*) FROM accounts) AS totale_account,
      (SELECT COUNT(*) FROM accounts WHERE ticket_number IS NOT NULL) AS account_con_ticket,
      (SELECT COUNT(*) FROM tavole) AS totale_tavole,
      (SELECT COUNT(*) FROM tavole WHERE status = 'APERTA') AS tavole_aperte,
      (SELECT COUNT(*) FROM tavole WHERE status = 'COMPLETATA') AS tavole_completate,
      (SELECT COUNT(*) FROM turni WHERE status = 'IN_CORSO') AS turni_attivi,
      (SELECT COUNT(*) FROM funzioni) AS totale_funzioni,
      (SELECT COALESCE(SUM(importo), 0) FROM donazioni WHERE status = 'COMPLETATA') AS totale_donazioni,
      (SELECT COUNT(*) FROM storico_avanzamenti) AS totale_avanzamenti,
      (SELECT COUNT(*) FROM coda_fifo WHERE status = 'IN_CODA') AS rientri_in_attesa,
      (SELECT COUNT(*) FROM coda_fifo WHERE status = 'IN_CODA' AND tipo = 'HUMAN') AS rientri_human,
      (SELECT COUNT(*) FROM coda_fifo WHERE status = 'IN_CODA' AND tipo = 'CASSA') AS rientri_cassa,
      (SELECT COUNT(*) FROM storico_uscite_fifo) AS totale_uscite,
      (SELECT COUNT(*) FROM storico_uscite_fifo WHERE tipo_uscita = 'HUMAN') AS uscite_human,
      (SELECT COUNT(*) FROM storico_uscite_fifo WHERE tipo_uscita != 'HUMAN') AS uscite_cassa,
      (SELECT COALESCE(SUM(netto), 0) FROM storico_uscite_fifo) AS totale_distribuito,
      (SELECT COALESCE(SUM(accantonamento_cassa), 0) FROM storico_uscite_fifo) AS totale_accantonato,
      (SELECT COALESCE(SUM(CASE WHEN tipo LIKE 'ROG_SMALL%' THEN importo ELSE 0 END), 0) FROM flussi_esterni) AS flussi_rog_small,
      (SELECT COALESCE(SUM(CASE WHEN tipo = 'ROG' THEN importo ELSE 0 END), 0) FROM flussi_esterni) AS flussi_rog,
      (SELECT COALESCE(SUM(CASE WHEN tipo = 'RIENTRI_SOLE' THEN importo ELSE 0 END), 0) FROM flussi_esterni) AS flussi_rientri_sole
  `);

  // Blocco
  let blocco = { bloccato: false };
  try { blocco = await db.getStatoBlocco() || { bloccato: false }; } catch (_) {}

  // Fondo cassa
  let fondoCassa = 0;
  try {
    const fc = await pg.queryOne(`SELECT COALESCE(SUM(importo_disponibile), 0) AS totale FROM contenitori WHERE tipo = '5' AND status = 'IN_ATTESA'`);
    fondoCassa = Number(fc?.totale) || 0;
  } catch (_) {}

  return {
    sistema, contenitori, blocco, fondoCassa,
    statistiche: {
      totaleAccount: Number(stats?.totale_account) || 0,
      accountConTicket: Number(stats?.account_con_ticket) || 0,
      totaleTavole: Number(stats?.totale_tavole) || 0,
      tavoleAperte: Number(stats?.tavole_aperte) || 0,
      tavoleCompletate: Number(stats?.tavole_completate) || 0,
      turniAttivi: Number(stats?.turni_attivi) || 0,
      totaleFunzioni: Number(stats?.totale_funzioni) || 0,
      totaleDonazioni: Number(stats?.totale_donazioni) || 0,
      totaleAvanzamenti: Number(stats?.totale_avanzamenti) || 0,
      rientriInAttesa: Number(stats?.rientri_in_attesa) || 0,
      rientriHuman: Number(stats?.rientri_human) || 0,
      rientriCassa: Number(stats?.rientri_cassa) || 0,
      totaleUscite: Number(stats?.totale_uscite) || 0,
      usciteHuman: Number(stats?.uscite_human) || 0,
      usciteCassa: Number(stats?.uscite_cassa) || 0,
      totaleDistribuito: Number(stats?.totale_distribuito) || 0,
      totaleAccantonato: Number(stats?.totale_accantonato) || 0,
      fondoCassa,
      flussiEsterni: {
        rogSmall: Number(stats?.flussi_rog_small) || 0,
        rog: Number(stats?.flussi_rog) || 0,
        rientriSole: Number(stats?.flussi_rientri_sole) || 0
      }
    }
  };
}

// ========================================
// POSIZIONAMENTO CROSS-PIATTAFORMA (L0)
// ========================================

/**
 * Posiziona un donatore al livello Sole (L0) proveniente da un'altra piattaforma.
 * Versione semplificata di posizionaDonatoreEntrata:
 *   - Non richiede verifica txHash (già verificata dalla piattaforma di origine)
 *   - Crea l'account se non esiste
 *   - Stessa logica di posizionamento: tavola attiva, sdoppiamento, cascata
 *
 * @param {string} wallet - Wallet del donatore (o CASSA)
 * @param {string} nome - Nome/etichetta per la posizione
 * @returns Risultato posizionamento
 */
async function posizionaDonatoreEntrataCross(wallet, nome) {
  await db.initDatabase();
  const w = wallet.toLowerCase();
  if (isSystemWallet(w)) {
    console.log(`   [SYSTEM-WALLET] ROG gate bypassato per ${w}`);
  } else {
    const rogStatus = await rogChecker.checkAllPrerequisites(w);
    if (!rogStatus.canProceed) {
      throw new Error('Prerequisiti ROG non soddisfatti');
    }
  }
  // Crea account se non esiste
  let account = await db.getAccount(w);
  if (!account) {
    account = await db.createAccount({ wallet: w, nome: nome || `cross-${w.substring(0, 8)}`, tipo: 'CROSS' });
  }

  // Usa la stessa logica di posizionaDonatoreEntrata
  return posizionaDonatoreEntrata(w, nome || account.nome);
}

module.exports = {
  inizializzaSistema,
  processaDonoEntrataWallet,
  processaCoppiaEntrata,
  posizionaDonatoreEntrata,
  posizionaDonatoreEntrataCross,
  gestisciUscitaFaraone,
  posizionaFaraoneInL4, gestisciUscitaL4,
  posizionaFaraoneInL5, gestisciUscitaL5,
  getStatoSistema,
  watchdogTurnoEntrata,
  FONDO_WALLET, CASSA_WALLET, FONDO_SIGLA
};
