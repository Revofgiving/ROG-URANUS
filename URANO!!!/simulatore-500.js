/**
 * 🌀 URANO — Simulatore Finanziario Forense
 *
 * Domanda: con 500 persone (1.000 account × 10 USDC) il sistema
 * raggiunge la perpetuità? È finanziariamente solvente?
 *
 * MODELLO:
 *   - 1.000 account umani entrano nella coda (FIFO)
 *   - Ogni 6 account in coda → 1 sacerdote (completa la sua tavola)
 *   - Ogni 18 sacerdoti → 1 Faraone esce con 1.020 USDC netti
 *   - Ogni uscita → 6 rientri aggiunti alla coda (10 USDC ciascuno)
 *   - I rientri rimescolano il denaro già nel sistema (non denaro nuovo)
 *
 * PERPETUITÀ:
 *   Il sistema è perpetuo quando la coda è alimentata solo da rientri
 *   (zero nuovi account umani necessari).
 *   Soglia: % rientri nella coda = 100%
 *
 * SOLVENZA:
 *   USDC depositati (iniziali) >= USDC pagati (uscite × 1.020)
 */

'use strict';

// ── Costanti URANO ─────────────────────────────────────────────
const P = {
  DONO_ENTRATA:     10,    // USDC per account
  TAVOLA:            6,    // donatori per tavola
  SACERDOTI_TURNO:  18,    // sacerdoti necessari per Rha
  RIENTRI_USCITA:    6,    // rientri per ogni uscita Rha
  DONO_PHARAOH:     60,    // 6 × 10 = ciò che il sacerdote porta a L1
  PAYOUT_LORDO:   1080,    // 18 × 60
  PAYOUT_RIENTRI:   60,    // 6 × 10
  PAYOUT_NETTO:   1020,    // 1.080 - 60 = netto Faraone
  CONTI_PER_PERSONA: 2,    // account per persona
};

// ── Simulatore ─────────────────────────────────────────────────

function simula(numPersone, maxEscite = 200) {
  const numContiIniziali = numPersone * P.CONTI_PER_PERSONA;
  const usdcIniziale     = numContiIniziali * P.DONO_ENTRATA;

  // Coda FIFO: account in attesa di entrare nelle tavole
  let coda = [];
  for (let i = 1; i <= numContiIniziali; i++) {
    coda.push({ tipo: 'UMANO', id: i });
  }

  let sacerdotiPool  = 0;
  let uscite         = 0;
  let usdcPagato     = 0;
  let totalRientri   = 0;
  const logUscite    = [];
  const logPerpetuita = [];

  // Processa finché ci sono account in coda O sacerdoti sufficienti per un'uscita
  let stepMax = 10_000_000;
  while (stepMax-- > 0) {

    // ─── FORMA UNA TAVOLA (6 account → 1 sacerdote) ───────────
    if (coda.length >= P.TAVOLA) {
      coda.splice(0, P.TAVOLA);   // preleva 6 account dalla coda (FIFO)
      sacerdotiPool++;
    } else {
      // Non abbastanza account per una tavola e nessuna uscita imminente
      if (sacerdotiPool < P.SACERDOTI_TURNO) break;
    }

    // ─── COMPLETA USCITE (18 sacerdoti → 1 Faraone esce) ──────
    while (sacerdotiPool >= P.SACERDOTI_TURNO) {
      sacerdotiPool -= P.SACERDOTI_TURNO;
      uscite++;
      usdcPagato    += P.PAYOUT_NETTO;
      totalRientri  += P.RIENTRI_USCITA;

      // Aggiungi 6 rientri in fondo alla coda (entrano come nuovi donatori)
      for (let r = 0; r < P.RIENTRI_USCITA; r++) {
        coda.push({ tipo: 'RIENTRO', uscitaOrigine: uscite });
      }

      // Statistiche per questa uscita
      const umaniInCoda   = coda.filter(a => a.tipo === 'UMANO').length;
      const rientriInCoda = coda.filter(a => a.tipo === 'RIENTRO').length;
      const percRientri   = coda.length > 0
        ? (rientriInCoda / coda.length * 100).toFixed(1)
        : '100.0';

      const saldo = usdcIniziale - usdcPagato;

      logUscite.push({
        n:            uscite,
        umaniInCoda,
        rientriInCoda,
        codaTotale:   coda.length,
        percRientri:  parseFloat(percRientri),
        sacerdotiPool,
        usdcPagato,
        saldo,
        totalRientri,
        solvente:     saldo >= 0
      });

      if (parseFloat(percRientri) >= 100 && logPerpetuita.length === 0) {
        logPerpetuita.push({
          uscita:    uscite,
          messaggio: `Coda 100% rientri — sistema perpetuo raggiunto all'uscita #${uscite}`
        });
      }

      if (uscite >= maxEscite) break;
    }

    if (uscite >= maxEscite) break;
  }

  // ─── Rimanente in coda e sacerdoti parziali ─────────────────
  const usdcInCoda        = coda.length * P.DONO_ENTRATA;
  const usdcInSacerdoti   = sacerdotiPool * P.DONO_PHARAOH;
  const usdcNonDistribuito = usdcInCoda + usdcInSacerdoti;

  return {
    numPersone,
    numContiIniziali,
    usdcIniziale,
    uscite,
    usdcPagato,
    saldoFinale:       usdcIniziale - usdcPagato,
    totalRientri,
    usdcNonDistribuito,
    personePagate:     uscite / P.CONTI_PER_PERSONA,
    perpet:            logPerpetuita[0] || null,
    logUscite
  };
}

// ── Stampa Report ──────────────────────────────────────────────

function stampaReport(r) {
  const sep = '═'.repeat(65);
  const lin = '─'.repeat(65);

  console.log('\n' + sep);
  console.log(`  🌀 URANO — SIMULAZIONE ${r.numPersone} PERSONE`);
  console.log(`  ${r.numContiIniziali} account × ${P.DONO_ENTRATA} USDC = ${r.usdcIniziale.toLocaleString('it-IT')} USDC depositati`);
  console.log(sep);

  console.log('\n📊 RISULTATI GLOBALI');
  console.log(lin);
  console.log(`  Uscite Rha completate:     ${r.uscite}`);
  console.log(`  Persone che incassano:     ${r.uscite} uscite ÷ 2 account = ${Math.floor(r.uscite/2)} persone complete`);
  console.log(`  USDC distribuiti:          ${r.usdcPagato.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC depositati (entrata): ${r.usdcIniziale.toLocaleString('it-IT')} USDC`);
  console.log(`  SALDO SISTEMA:             ${r.saldoFinale.toLocaleString('it-IT')} USDC`);
  console.log(`  Rientri generati totali:   ${r.totalRientri}`);
  console.log(`  USDC in cicli incompleti:  ~${r.usdcNonDistribuito.toLocaleString('it-IT')} USDC`);
  console.log();

  if (r.saldoFinale >= 0) {
    console.log(`  ✅ SISTEMA SOLVENTE: non ha mai pagato più di quanto ricevuto.`);
  } else {
    console.log(`  ❌ INSOLVENTE: pagato ${Math.abs(r.saldoFinale)} USDC più del depositato.`);
  }

  if (r.perpet) {
    console.log(`  ✅ PERPETUITÀ RAGGIUNTA: ${r.perpet.messaggio}`);
  } else {
    const ultimaUscita = r.logUscite[r.logUscite.length - 1];
    const maxPerc = ultimaUscita ? ultimaUscita.percRientri.toFixed(1) : 0;
    console.log(`  ⚠️  PERPETUITÀ NON RAGGIUNTA: massima copertura rientri = ${maxPerc}%`);
  }

  console.log('\n📈 DETTAGLIO USCITE');
  console.log(lin);
  const header = [
    'N°'.padEnd(4),
    'Coda'.padEnd(6),
    'Umani'.padEnd(7),
    'Rientri'.padEnd(9),
    '%Rient.'.padEnd(9),
    'Pagato'.padEnd(8),
    'Saldo'.padEnd(8),
    'Solvente'
  ].join('  ');
  console.log('  ' + header);
  console.log('  ' + '-'.repeat(63));

  for (const e of r.logUscite) {
    const flag = e.percRientri >= 100 ? ' 🔄 PERPETUO' : '';
    const solv = e.solvente ? '✅' : '❌';
    const row = [
      String(e.n).padEnd(4),
      String(e.codaTotale).padEnd(6),
      String(e.umaniInCoda).padEnd(7),
      String(e.rientriInCoda).padEnd(9),
      String(e.percRientri.toFixed(1) + '%').padEnd(9),
      String(e.usdcPagato.toLocaleString('it-IT')).padEnd(8),
      String(e.saldo.toLocaleString('it-IT')).padEnd(8),
      solv
    ].join('  ');
    console.log(`  ${row}${flag}`);
  }

  console.log('\n💰 PER PERSONA (2 account)');
  console.log(lin);
  console.log(`  Investimento:         20 USDC (2 × 10)`);
  console.log(`  Payout per ciclo:  2.040 USDC (2 × 1.020) — × 102`);
  console.log(`  Persone pagate:       ${Math.floor(r.uscite/2)} su ${r.numPersone} entrate (${(Math.floor(r.uscite/2)/r.numPersone*100).toFixed(1)}%)`);

  console.log('\n📐 ANALISI PERPETUITÀ');
  console.log(lin);
  const CONTI_PER_USCITA = P.SACERDOTI_TURNO * P.TAVOLA; // 108
  const RIENTRI_PER_USCITA = P.RIENTRI_USCITA;            // 6
  const COPERTURA_PER_USCITA = ((RIENTRI_PER_USCITA / CONTI_PER_USCITA) * 100).toFixed(1);

  console.log(`  Conti necessari per 1 uscita Rha:  ${CONTI_PER_USCITA} (18 sacerdoti × 6 donatori)`);
  console.log(`  Rientri generati per 1 uscita:     ${RIENTRI_PER_USCITA}`);
  console.log(`  Copertura rientri per uscita:      ${COPERTURA_PER_USCITA}%`);
  console.log(`  Uscite simultanee per perpetuità:  ${P.SACERDOTI_TURNO} (= 108 ÷ 6)`);
  console.log(`  Persone necessarie per perpetuità: ${Math.ceil(P.SACERDOTI_TURNO * CONTI_PER_USCITA / P.CONTI_PER_PERSONA)}`);
  console.log();

  // Verifica speciale: con le uscite generate, quanti rientri si accumulano?
  const rientriTotali = r.totalRientri;
  const sacerdotiDaRientri = Math.floor(rientriTotali / P.TAVOLA);
  const usciteAggiuntiveDaRientri = Math.floor(sacerdotiDaRientri / P.SACERDOTI_TURNO);

  console.log(`  Rientri totali generati:     ${rientriTotali}`);
  console.log(`  Sacerdoti dai rientri:       ${sacerdotiDaRientri} (${rientriTotali} ÷ 6)`);
  console.log(`  Uscite aggiuntive da rientri: ${usciteAggiuntiveDaRientri}`);
  console.log(`  Totale uscite potenziali:    ${r.uscite + usciteAggiuntiveDaRientri}`);
  console.log(`  Persone totali pagate:       ${Math.floor((r.uscite + usciteAggiuntiveDaRientri) / 2)}`);

  console.log('\n' + sep + '\n');
}

// ── Esegui ────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  🌀 URANO — SIMULATORE FORENSE v1.0');
console.log('  Verifica solvenza e perpetuità con 500 persone');
console.log('═'.repeat(65));

const risultato = simula(500, 200);
stampaReport(risultato);

// Simulazione estesa: cosa succede con solo i rientri?
console.log('═'.repeat(65));
console.log('  FASE 2 — Solo rientri (post-500 persone)');
console.log('  Quante uscite aggiuntive generano i 6 rientri × uscita?');
console.log('═'.repeat(65));

// Simulazione partendo solo dai rientri generati
function simulasoloRientri(numRientriIniziali, maxEscite = 50) {
  let coda = [];
  for (let i = 0; i < numRientriIniziali; i++) {
    coda.push({ tipo: 'RIENTRO', id: i + 1 });
  }
  let sacerdotiPool = 0;
  let uscite = 0;
  const logR = [];

  let step = 0;
  while (step++ < 1_000_000) {
    if (coda.length >= P.TAVOLA) {
      coda.splice(0, P.TAVOLA);
      sacerdotiPool++;
    } else {
      if (sacerdotiPool < P.SACERDOTI_TURNO) break;
    }
    while (sacerdotiPool >= P.SACERDOTI_TURNO) {
      sacerdotiPool -= P.SACERDOTI_TURNO;
      uscite++;
      for (let r = 0; r < P.RIENTRI_USCITA; r++) {
        coda.push({ tipo: 'RIENTRO', gen: uscite });
      }
      logR.push({
        n: uscite,
        codaTotale: coda.length,
        sacerdotiPool,
        rientriTotali: numRientriIniziali + uscite * P.RIENTRI_USCITA
      });
      if (uscite >= maxEscite) break;
    }
    if (uscite >= maxEscite) break;
  }
  return { uscite, codaFinale: coda.length, sacerdotiPool, logR };
}

const rientriIniziali = risultato.totalRientri;
console.log(`\n  Rientri disponibili dopo la simulazione: ${rientriIniziali}`);

if (rientriIniziali >= P.TAVOLA) {
  const fase2 = simulasoloRientri(rientriIniziali, 100);
  console.log(`  Uscite aggiuntive (solo rientri):        ${fase2.uscite}`);
  console.log(`  Persone aggiuntive pagate:               ${Math.floor(fase2.uscite / 2)}`);
  console.log(`  Rientri totali (incluso fase 2):         ${rientriIniziali + fase2.uscite * P.RIENTRI_USCITA}`);

  const totaleEscite = risultato.uscite + fase2.uscite;
  const totalePagato = totaleEscite * P.PAYOUT_NETTO;
  const totaleDepositi = risultato.usdcIniziale;

  console.log('\n  ─── RIEPILOGO COMPLETO (Fase 1 + Fase 2) ───');
  console.log(`  Uscite totali:              ${totaleEscite}`);
  console.log(`  Persone che ricevono:       ${Math.floor(totaleEscite / 2)}`);
  console.log(`  USDC totale pagato:         ${totalePagato.toLocaleString('it-IT')} USDC`);
  console.log(`  USDC depositato:            ${totaleDepositi.toLocaleString('it-IT')} USDC`);
  console.log(`  Saldo finale:               ${(totaleDepositi - totalePagato).toLocaleString('it-IT')} USDC`);
  console.log(`  Solvenza:                   ${totalePagato <= totaleDepositi ? '✅ SOLVENTE' : '❌ INSOLVENTE'}`);
} else {
  console.log(`  ⚠️  Rientri insufficienti per ulteriori uscite (< 6)`);
}

console.log('\n' + '═'.repeat(65) + '\n');
