/**
 * 🌀 URANO v2 — Simulatore Finanziario
 *
 * Modello:
 *   500 persone × 20 USDC = 1.000 posizioni (500 HUMAN + 500 CASSA_ROG)
 *   Ogni 6 posizioni in coda → 1 sacerdote
 *   Ogni 18 sacerdoti → 1 Faraone esce
 *
 * Uscita HUMAN:  1.080 − 60 (6 rientri) − 20 (ROG SMALL) = 1.000 netti
 *   + genera 6 rientri HUMAN + 6 rientri CASSA_ROG (affiancamento)
 *
 * Uscita CASSA_ROG: 1.080 − 180 (18 rientri) − 100 (ROG) − 100 (PHARAON) = 700 accantonamento
 *   + genera 18 rientri CASSA_ROG
 */
'use strict';

const P = {
  DONO_ENTRATA:      10,
  COSTO_PERSONA:     20,
  TAVOLA:             6,
  SACERDOTI_TURNO:   18,
  DONO_PHARAOH:      60,
  PAYOUT_LORDO:    1080,

  // HUMAN exit
  RIENTRI_HUMAN:      6,
  COSTO_ROG_SMALL:   20,
  NETTO_HUMAN:     1000,

  // CASSA exit
  RIENTRI_CASSA:     18,
  COSTO_ROG:        100,
  CONTRIBUTO_PHARAON:100,
  ACCANTONAMENTO:   700,
};

function simula(numPersone, maxUscite = 200) {
  const numPosizioni  = numPersone * 2;  // 1 HUMAN + 1 CASSA_ROG per persona
  const usdcIniziale  = numPersone * P.COSTO_PERSONA;

  // Coda FIFO: alternata HUMAN, CASSA_ROG, HUMAN, CASSA_ROG...
  let coda = [];
  for (let i = 1; i <= numPersone; i++) {
    coda.push({ tipo: 'HUMAN', id: i });
    coda.push({ tipo: 'CASSA_ROG', id: i });
  }

  let sacerdotiPool    = 0;
  let uscite           = 0;
  let usciteHuman      = 0;
  let usciteCassa      = 0;
  let usdcPagatoHuman  = 0;
  let usdcAccantonato  = 0;
  let usdcRogSmall     = 0;
  let usdcRog          = 0;
  let usdcPharaon      = 0;
  let totalRientri     = 0;
  const logUscite      = [];

  let stepMax = 10_000_000;
  while (stepMax-- > 0) {
    // Forma una tavola (6 posizioni → 1 sacerdote)
    if (coda.length >= P.TAVOLA) {
      const batch = coda.splice(0, P.TAVOLA);
      sacerdotiPool++;
    } else {
      if (sacerdotiPool < P.SACERDOTI_TURNO) break;
    }

    // Completa uscite (18 sacerdoti → 1 Faraone)
    while (sacerdotiPool >= P.SACERDOTI_TURNO) {
      sacerdotiPool -= P.SACERDOTI_TURNO;
      uscite++;

      // Determina tipo uscita (alternata: prima HUMAN poi CASSA, in base alla coda)
      // Semplificazione: metà uscite sono HUMAN, metà CASSA_ROG
      const isHuman = uscite % 2 === 1;

      if (isHuman) {
        usciteHuman++;
        usdcPagatoHuman += P.NETTO_HUMAN;
        usdcRogSmall    += P.COSTO_ROG_SMALL;
        totalRientri    += P.RIENTRI_HUMAN * 2;  // 6 HUMAN + 6 CASSA_ROG affiancamento

        // 6 rientri HUMAN + 6 rientri CASSA_ROG
        for (let r = 0; r < P.RIENTRI_HUMAN; r++) {
          coda.push({ tipo: 'HUMAN', rientro: true, uscita: uscite });
          coda.push({ tipo: 'CASSA_ROG', rientro: true, uscita: uscite });
        }
      } else {
        usciteCassa++;
        usdcAccantonato += P.ACCANTONAMENTO;
        usdcRog         += P.COSTO_ROG;
        usdcPharaon     += P.CONTRIBUTO_PHARAON;
        totalRientri    += P.RIENTRI_CASSA;

        // 18 rientri CASSA_ROG
        for (let r = 0; r < P.RIENTRI_CASSA; r++) {
          coda.push({ tipo: 'CASSA_ROG', rientro: true, uscita: uscite });
        }
      }

      const umani   = coda.filter(a => a.tipo === 'HUMAN').length;
      const casse   = coda.filter(a => a.tipo === 'CASSA_ROG').length;
      const rientri = coda.filter(a => a.rientro).length;
      const percR   = coda.length > 0 ? (rientri / coda.length * 100).toFixed(1) : '100.0';

      logUscite.push({
        n: uscite, tipoUscita: isHuman ? 'HUMAN' : 'CASSA',
        codaTotale: coda.length, umani, casse,
        percRientri: parseFloat(percR),
        usdcPagatoHuman, usdcAccantonato,
        usdcRogSmall, usdcRog, usdcPharaon,
        saldo: usdcIniziale - usdcPagatoHuman
      });

      if (uscite >= maxUscite) break;
    }
    if (uscite >= maxUscite) break;
  }

  return {
    numPersone, numPosizioni, usdcIniziale,
    uscite, usciteHuman, usciteCassa,
    usdcPagatoHuman, usdcAccantonato,
    usdcRogSmall, usdcRog, usdcPharaon,
    saldoFinale: usdcIniziale - usdcPagatoHuman,
    totalRientri,
    logUscite
  };
}

function stampaReport(r) {
  const sep = '═'.repeat(70);
  const lin = '─'.repeat(70);

  console.log('\n' + sep);
  console.log(`  🌀 URANO v2 — SIMULAZIONE ${r.numPersone} PERSONE`);
  console.log(`  ${r.numPosizioni} posizioni (${r.numPersone} HUMAN + ${r.numPersone} CASSA_ROG)`);
  console.log(`  ${r.usdcIniziale.toLocaleString('it-IT')} USDC depositati (${r.numPersone} × ${P.COSTO_PERSONA})`);
  console.log(sep);

  console.log('\n📊 RISULTATI GLOBALI');
  console.log(lin);
  console.log(`  Uscite totali:             ${r.uscite} (${r.usciteHuman} HUMAN + ${r.usciteCassa} CASSA)`);
  console.log(`  USDC pagati (HUMAN):       ${r.usdcPagatoHuman.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC accantonati (CASSA):  ${r.usdcAccantonato.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC → ROG SMALL:          ${r.usdcRogSmall.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC → ROG:                ${r.usdcRog.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC → PHARAON:            ${r.usdcPharaon.toLocaleString('it-IT')} USDC`);
  console.log(`  Rientri generati:          ${r.totalRientri}`);
  console.log(`  USDC depositati:           ${r.usdcIniziale.toLocaleString('it-IT')} USDC`);
  console.log(`  SALDO SISTEMA:             ${r.saldoFinale.toLocaleString('it-IT')} USDC`);
  console.log();

  if (r.saldoFinale >= 0) {
    console.log(`  ✅ SISTEMA SOLVENTE`);
  } else {
    console.log(`  ❌ INSOLVENTE di ${Math.abs(r.saldoFinale).toLocaleString('it-IT')} USDC`);
  }

  console.log('\n📈 DETTAGLIO USCITE');
  console.log(lin);
  const header = ['N°', 'Tipo', 'Coda', 'HUMAN', 'CASSA', '%Rient', 'Pagato', 'Acc.', 'Saldo'].map((h, i) =>
    h.padEnd([4, 6, 6, 6, 6, 7, 10, 10, 10][i])).join('  ');
  console.log('  ' + header);
  console.log('  ' + '-'.repeat(68));

  for (const e of r.logUscite) {
    const row = [
      String(e.n).padEnd(4),
      e.tipoUscita.padEnd(6),
      String(e.codaTotale).padEnd(6),
      String(e.umani).padEnd(6),
      String(e.casse).padEnd(6),
      (e.percRientri.toFixed(1) + '%').padEnd(7),
      e.usdcPagatoHuman.toLocaleString('it-IT').padEnd(10),
      e.usdcAccantonato.toLocaleString('it-IT').padEnd(10),
      e.saldo.toLocaleString('it-IT').padEnd(10),
    ].join('  ');
    console.log(`  ${row}`);
  }

  console.log('\n💰 PER PERSONA');
  console.log(lin);
  console.log(`  Investimento:         ${P.COSTO_PERSONA} USDC`);
  console.log(`  Netto HUMAN:          ${P.NETTO_HUMAN.toLocaleString('it-IT')} USDC (×${P.NETTO_HUMAN / P.COSTO_PERSONA})`);
  console.log(`  Uscite HUMAN:         ${r.usciteHuman} su ${r.numPersone} persone (${(r.usciteHuman / r.numPersone * 100).toFixed(1)}%)`);

  console.log('\n📐 ANALISI CIRCOLARITÀ');
  console.log(lin);
  const contiPerUscita = P.SACERDOTI_TURNO * P.TAVOLA;
  console.log(`  Posizioni per 1 uscita:    ${contiPerUscita} (18 sacerdoti × 6 donatori)`);
  console.log(`  Rientri HUMAN per uscita:  ${P.RIENTRI_HUMAN} + ${P.RIENTRI_HUMAN} CASSA = ${P.RIENTRI_HUMAN * 2}`);
  console.log(`  Rientri CASSA per uscita:  ${P.RIENTRI_CASSA}`);
  console.log(`  Copertura media:           ${((P.RIENTRI_HUMAN * 2 + P.RIENTRI_CASSA) / 2 / contiPerUscita * 100).toFixed(1)}% per coppia di uscite`);

  console.log('\n' + sep + '\n');
}

// ── Esegui ────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  🌀 URANO v2 — SIMULATORE FORENSE');
console.log('  Verifica solvenza e perpetuità con 500 persone');
console.log('═'.repeat(70));

const risultato = simula(500, 100);
stampaReport(risultato);
