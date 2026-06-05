/**
 * 📦 URANO — Container Manager
 *
 * Gestisce i 4 contenitori (code FIFO):
 * - 5:   chi ha il dono da 10 (pronti per livello entrata)
 * - 5.1: chi NON ha il dono (attende crediti)
 * - 5.2: chi ha il dono da 50 (pronti per Sistema Urano)
 * - 5.3: doni a credito in standby
 *
 * Adattato da PHARAON con importi ÷ 10.
 */
'use strict';

const db = require('./db-manager');

// Soglie per rilascio crediti (PHARAON: 108/78, invariate)
const SOGLIA_PRIMO_TURNO = 108;
const SOGLIA_TURNI_SUCCESSIVI = 78;

// ========================================
// OPERAZIONI BASE
// ========================================

async function inserisciInContenitore({ tipo, wallet, ticketNumber, nome, importo, provenienza }) {
  return await db.addToContenitore({ tipo, wallet, ticketNumber, nome, importo, provenienza });
}

async function prelevaProssimo(tipo) {
  const item = await db.getNextFromContenitore(tipo);
  if (!item) return null;
  await db.markContenitoreUsato(item.id);
  console.log(`   📤 Prelevato da contenitore ${tipo}: ticket ${item.ticket_number} (${item.wallet.substring(0, 10)}...)`);
  return item;
}

async function conta(tipo) {
  return await db.countInContenitore(tipo);
}

// ========================================
// TRASFERIMENTO A 5.2
// ========================================

async function trasferisciAContenitore52(wallet, ticketNumber, nome) {
  console.log(`   📦 Trasferimento a contenitore 5.2: ${nome} (ticket ${ticketNumber})`);
  return await inserisciInContenitore({
    tipo: '5.2', wallet, ticketNumber, nome,
    importo: 50,   // PHARAON: 500 → URANO: 50
    provenienza: 'USCITA_ENTRATA'
  });
}

// ========================================
// DONI A CREDITO
// ========================================

async function accantonaDoniCredito(numCrediti, rilasciatoDaWallet, livello, turno) {
  console.log(`   💳 Accantonamento ${numCrediti} doni a credito (da L${livello}, turno ${turno})`);
  const risultati = [];
  for (let i = 0; i < numCrediti; i++) {
    const credito = await db.createDonoCredito({
      rilasciatoDaWallet, rilasciatoAlLivello: livello,
      importo: 10,    // PHARAON: 100 → URANO: 10
      turnoRilascio: turno
    });
    risultati.push(credito);
  }
  return risultati;
}

/**
 * Distribuisce i crediti disponibili:
 *   1° PRIORITÀ: a chi è nel contenitore 5.1 (chi non ha il dono) — FIFO
 *   2° FALLBACK: se 5.1 è vuoto, i crediti vanno come rientri ROG-CASSA a Sole (L0)
 *               per non tenere fondi fermi e mantenere la cascata in movimento
 */
async function distribuisciCrediti(numDoni) {
  const pg = require('./pg-connection-manager');
  const inAttesa51 = await conta('5.1');
  const creditiDisponibili = await contaCreditiDisponibili();

  if (creditiDisponibili <= 0) {
    console.log(`   ℹ️  Nessun credito disponibile`);
    return [];
  }

  // 1° PRIORITÀ: distribuisci a chi è in 5.1
  const daDareA51 = Math.min(numDoni, inAttesa51, creditiDisponibili);
  const risultati = [];

  if (daDareA51 > 0) {
    console.log(`   💳 Distribuzione ${daDareA51} crediti a 5.1 (5.3 → 5.1 → 5)`);
    const assegnati = await db.assegnaDoniCredito(daDareA51);
    risultati.push(...assegnati);
  }

  // 2° FALLBACK: crediti residui → ingresso DUAL ROG-URANUS a Sole (L0)
  //   1 posizione ROG-URANUS (sistema) + 1 posizione CASSA ROG (sistema) = dual entry
  const residui = Math.min(numDoni, creditiDisponibili) - daDareA51;
  if (residui > 0) {
    console.log(`   ♻️  5.1 vuoto: ${residui} crediti residui → ingresso DUAL ROG-URANUS a Sole (L0)`);
    const cassaWallet   = process.env.CASSA_WALLET      || '0x0000000000000000000000000000000000000002';
    const rogUranusWallet = process.env.ROG_URANUS_WALLET || '0x0000000000000000000000000000000000000003';

    const creditiResidui = await pg.queryMany(
      `SELECT id FROM doni_credito WHERE status = 'STANDBY' ORDER BY id ASC LIMIT $1`,
      [residui]
    );

    for (const credito of creditiResidui) {
      // Marca il credito come usato per ROG-URANUS
      await pg.query(
        `UPDATE doni_credito SET status = 'ROG_URANUS', assegnato_a_wallet = $1 WHERE id = $2`,
        [rogUranusWallet, credito.id]
      );

      // Ingresso DUAL a Sole: 1 ROG-URANUS + 1 CASSA ROG (10 USDC ciascuno)
      try {
        const tableManager = require('./table-manager');
        const dbm = require('./db-manager');

        // ROG-URANUS prima (come CASSA nel dual standard)
        const turnoR = await dbm.getTurnoCorrente('ENTRATA', 0);
        if (turnoR) {
          const tavolaR = await tableManager.getTavolaPercorsoAttiva(0, turnoR.numero_turno);
          if (tavolaR) {
            await tableManager.posizionaDonatore({
              tavolaId: tavolaR.id, tavolaNumero: tavolaR.numero, livello: 0,
              wallet: rogUranusWallet, nome: `ROG-URANUS credito #${credito.id}`,
              tipo: 'DONATORE', donoImporto: 10,
              turno: turnoR.numero_turno, sdoppiabile: true
            });
            await dbm.incrementSacerdotiEntrati(turnoR.id);
          }
        }

        // CASSA ROG dopo (seconda posizione del dual)
        const turnoC = await dbm.getTurnoCorrente('ENTRATA', 0);
        if (turnoC) {
          const tavolaC = await tableManager.getTavolaPercorsoAttiva(0, turnoC.numero_turno);
          if (tavolaC) {
            await tableManager.posizionaDonatore({
              tavolaId: tavolaC.id, tavolaNumero: tavolaC.numero, livello: 0,
              wallet: cassaWallet, nome: `CASSA ROG credito #${credito.id}`,
              tipo: 'DONATORE', donoImporto: 10,
              turno: turnoC.numero_turno, sdoppiabile: true
            });
            await dbm.incrementSacerdotiEntrati(turnoC.id);
            console.log(`     → Credito #${credito.id} → DUAL Sole: ROG-URANUS + CASSA ROG`);
          }
        }
      } catch (e) {
        console.log(`     ⚠️  Ingresso DUAL ROG-URANUS fallito per credito #${credito.id}: ${e.message}`);
      }

      // Registra flusso esterno (dual: 2 posizioni)
      await pg.queryOne(
        `INSERT INTO flussi_esterni (tipo, origine_wallet, importo, num_posizioni, tipo_uscita)
         VALUES ('ROG_URANUS_CREDITO', $1, 20, 2, 'CREDITO_FALLBACK') RETURNING *`,
        [rogUranusWallet]
      );

      risultati.push({ tipo: 'ROG_URANUS_DUAL', creditoId: credito.id });
    }
  }

  return risultati;
}

async function contaCreditiDisponibili() {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(`SELECT COUNT(*) AS cnt FROM doni_credito WHERE status = 'STANDBY'`);
  return Number(row?.cnt) || 0;
}

// ========================================
// VERIFICA SOGLIE
// ========================================

async function verificaSogliaRilascioCrediti(turno) {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM accounts WHERE ticket_number IS NOT NULL AND tipo = 'PRIMARIO'`
  );
  const totaleConTicket = Number(row?.cnt) || 0;
  const soglia = turno === 1
    ? SOGLIA_PRIMO_TURNO
    : SOGLIA_PRIMO_TURNO + SOGLIA_TURNI_SUCCESSIVI * (turno - 1);
  console.log(`   📊 Soglia crediti turno ${turno}: ${totaleConTicket}/${soglia} account con ticket`);
  return totaleConTicket >= soglia;
}

// ========================================
// STATO CONTENITORI
// ========================================

async function getStatoContenitori() {
  const c5 = await conta('5');
  const c51 = await conta('5.1');
  const c52 = await conta('5.2');
  const crediti = await contaCreditiDisponibili();
  return {
    contenitore_5:  { tipo: '5',   descrizione: 'Pronti dono 10',  inAttesa: c5 },
    contenitore_51: { tipo: '5.1', descrizione: 'Senza dono (attende crediti)', inAttesa: c51 },
    contenitore_52: { tipo: '5.2', descrizione: 'Pronti dono 50 (Sistema Urano)', inAttesa: c52 },
    contenitore_53: { tipo: '5.3', descrizione: 'Crediti in standby (se 5.1 vuoto → ROG-CASSA a Sole)', disponibili: crediti }
  };
}

module.exports = {
  inserisciInContenitore, prelevaProssimo, conta,
  trasferisciAContenitore52,
  accantonaDoniCredito, distribuisciCrediti, contaCreditiDisponibili,
  verificaSogliaRilascioCrediti, getStatoContenitori,
  SOGLIA_PRIMO_TURNO, SOGLIA_TURNI_SUCCESSIVI
};
