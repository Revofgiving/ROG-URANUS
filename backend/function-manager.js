/**
 * ⚙️ URANO — Function Manager
 *
 * Gestisce il rilascio e posizionamento delle 4 Funzioni:
 * - 3 SIMBIONTI (150): non duplicabili (reg.7)
 * - 1 PERPETUO (50): continuazione dell'account (reg.8)
 * - 1 GEMELLO (50): nuovo account, ticket prenotato (reg.9, reg.10)
 * - 5 DONI A CREDITO (50): 5 × 10 (per chi non ha il dono)
 *
 * Funzioni rilasciate all'uscita da Venere L3 (reg.3),
 * inserite nel turno successivo (reg.6).
 *
 * Adattato da PHARAON con importi ÷ 10.
 */
'use strict';

const db = require('./db-manager');
const rules = require('./rules-engine');
const accountManager = require('./account-manager');
const containerManager = require('./container-manager');

// ========================================
// RILASCIO FUNZIONI L3 (Venere)
// ========================================

async function rilasciaFunzioniL3({ faraoneWallet, faraoneSigla, tipoAccount, turnoCorrente }) {
  const rilasci = rules.regolaRilasciFunzioni(tipoAccount);
  const turnoEntrata = turnoCorrente + 1;

  console.log(`\n⚙️ RILASCIO FUNZIONI L3 per ${faraoneSigla} (${tipoAccount})`);
  console.log(`   Turno rilascio: ${turnoCorrente}`);
  console.log(`   Turno entrata: ${turnoEntrata}`);

  const risultato = {
    faraoneWallet, faraoneSigla, tipoAccount,
    turnoRilascio: turnoCorrente, turnoEntrata,
    simbionti: [], perpetuo: null, gemello: null, crediti: []
  };

  // 1. SIMBIONTI (3 × 50 = 150)
  if (rilasci.rilasciaSimbionti) {
    for (let i = 1; i <= 3; i++) {
      const simbionte = await db.createFunzione({
        tipo: 'SIMBIONTE',
        accountOrigineWallet: faraoneWallet,
        accountGeneratoWallet: null,
        sigla: `SIM${i}_${faraoneSigla}`,
        ticketPrenotato: null,
        importo: 50,
        turnoRilascio: turnoCorrente,
        turnoEntrata,
        tavolaPosizionamento: null,
        posizioneInTavola: null
      });
      risultato.simbionti.push(simbionte);
    }
    console.log(`   ✅ 3 Simbionti rilasciati (150 USDC)`);
  }

  // 2. PERPETUO (50)
  if (rilasci.rilasciaPerpetuo) {
    const numPerpetui = await accountManager.countPerpetui(faraoneWallet);
    const nuovoNumero = numPerpetui + 1;
    const perpetuoData = await accountManager.creaPerpetuo(faraoneWallet, faraoneSigla, nuovoNumero);

    const funzione = await db.createFunzione({
      tipo: 'PERPETUO',
      accountOrigineWallet: faraoneWallet,
      accountGeneratoWallet: perpetuoData.wallet,
      sigla: perpetuoData.sigla,
      ticketPrenotato: null,
      importo: 50,
      turnoRilascio: turnoCorrente,
      turnoEntrata,
      tavolaPosizionamento: null,
      posizioneInTavola: null
    });

    risultato.perpetuo = { funzione, account: perpetuoData };
    console.log(`   ✅ Perpetuo rilasciato: ${perpetuoData.sigla} (50 USDC)`);
  }

  // 3. GEMELLO (50)
  if (rilasci.rilasciaGemello) {
    const numGemelli = await accountManager.countGemelli(faraoneWallet);
    const nuovoNumero = numGemelli + 1;
    const gemelloData = await accountManager.creaGemello(faraoneWallet, faraoneSigla, nuovoNumero);

    const funzione = await db.createFunzione({
      tipo: 'GEMELLO',
      accountOrigineWallet: faraoneWallet,
      accountGeneratoWallet: gemelloData.wallet,
      sigla: gemelloData.sigla,
      ticketPrenotato: gemelloData.ticketPrenotato,
      importo: 50,
      turnoRilascio: turnoCorrente,
      turnoEntrata,
      tavolaPosizionamento: null,
      posizioneInTavola: null
    });

    risultato.gemello = { funzione, account: gemelloData };
    console.log(`   ✅ Gemello rilasciato: ${gemelloData.sigla} (ticket prenotato: ${gemelloData.ticketPrenotato}) (50 USDC)`);
  } else {
    console.log(`   ⛔ Gemello NON rilasciato (reg.11: Perpetuo non rilascia Gemello)`);
  }

  // 4. DONI A CREDITO (5 × 10 = 50)
  if (rilasci.rilasciaCrediti) {
    const crediti = await containerManager.accantonaDoniCredito(5, faraoneWallet, 3, turnoCorrente);
    risultato.crediti = crediti;
    console.log(`   ✅ 5 doni a credito rilasciati (50 USDC) → contenitore 5.3`);
  }

  console.log(`   🏦 Totale riserva cassa: ${rules.IMPORTI.TRATTENUTA_CASSA_L3} USDC`);
  return risultato;
}

// ========================================
// RILASCIO FUNZIONI L4 (Giove) — reg.13
// ========================================

async function rilasciaFunzioniL4({ faraoneWallet, turnoCorrente }) {
  console.log(`\n⚙️ RILASCIO FUNZIONI L4 per ${faraoneWallet.substring(0, 10)}...`);
  const crediti = await containerManager.accantonaDoniCredito(10, faraoneWallet, 4, turnoCorrente);
  console.log(`   ✅ 10 doni a credito rilasciati (100 USDC) → contenitore 5.3`);
  return { crediti, numCrediti: 10, importoTotale: 100 };
}

// ========================================
// RILASCIO FUNZIONI L5 (Saturno) — reg.14
// ========================================

async function rilasciaFunzioniL5({ faraoneWallet, turnoCorrente }) {
  console.log(`\n⚙️ RILASCIO FUNZIONI L5 per ${faraoneWallet.substring(0, 10)}...`);
  const crediti = await containerManager.accantonaDoniCredito(10, faraoneWallet, 5, turnoCorrente);
  console.log(`   ✅ 10 doni a credito rilasciati (100 USDC) → contenitore 5.3`);
  return { crediti, numCrediti: 10, importoTotale: 100 };
}

// ========================================
// DISTRIBUZIONE CREDITI POST-TURNO
// ========================================

async function distribuisciCreditiPostTurno(turno) {
  console.log(`\n💳 Distribuzione crediti post-turno ${turno}`);

  const sogliaOk = await containerManager.verificaSogliaRilascioCrediti(turno);
  if (!sogliaOk) {
    console.log(`   ⏸️ Soglia non raggiunta, distribuzione rimandata`);
    return { distribuiti: 0 };
  }

  const creditiDisponibili = await containerManager.contaCreditiDisponibili();
  if (creditiDisponibili <= 0) {
    console.log(`   ℹ️ Nessun credito disponibile`);
    return { distribuiti: 0 };
  }

  const assegnati = await containerManager.distribuisciCrediti(creditiDisponibili);
  console.log(`   ✅ ${assegnati.length} crediti distribuiti`);
  return { distribuiti: assegnati.length, dettaglio: assegnati };
}

module.exports = {
  rilasciaFunzioniL3,
  rilasciaFunzioniL4,
  rilasciaFunzioniL5,
  distribuisciCreditiPostTurno
};
