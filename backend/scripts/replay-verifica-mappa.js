/**
 * 🔁 URANUS — Harness di REPLAY + VERIFICA vs mappa certificata (SOLO TEST)
 *
 * Rigioca le 82 donazioni reali (ordine cronologico) attraverso il motore backend
 * su un DB usa-e-getta, poi confronta il risultato Sole L0 con la mappa definitiva.
 *
 * NON tocca produzione. Richiede: NODE_ENV=development e DATABASE_URL su un DB di test.
 *
 * Uso:
 *   NODE_ENV=development DATABASE_URL="postgresql://admin@localhost:5432/urano_test" \
 *     node scripts/replay-verifica-mappa.js
 *
 * Opzioni env:
 *   ALTERNANZA=1   → applica alternanza deterministica (round-robin max 2 dual, finestra 5 min)
 *   MAP_DIR=...     → cartella dei CSV mappa (default: ../MAPPA-DEFINITIVA-03LUGLIO)
 *   MAX_DIFF=40     → quante divergenze stampare
 */
'use strict';

const fs = require('fs');
const path = require('path');

if (process.env.NODE_ENV === 'production') {
  console.error('🚨 Questo harness NON deve girare in produzione.'); process.exit(1);
}
if (!process.env.DATABASE_URL || !/urano_test|_test|_sim/.test(process.env.DATABASE_URL)) {
  console.error('🚨 DATABASE_URL deve puntare a un DB di test (…_test). Trovato:', process.env.DATABASE_URL);
  process.exit(1);
}

const MAP_DIR = process.env.MAP_DIR || path.resolve(__dirname, '../../MAPPA-DEFINITIVA-03LUGLIO');
const DONAZIONI_CSV = path.join(MAP_DIR, 'URANUS-donazioni-20260703.csv');
const MAPPA_CSV = path.join(MAP_DIR, 'URANUS-mappa-definitiva-20260703.csv');
const ALT_WINDOW = 300; // 5 minuti
const MAX_DIFF = Number(process.env.MAX_DIFF || 40);

const db = require('../db-manager');
const pg = require('../pg-connection-manager');
const flow = require('../donation-flow-manager');

// --- parsing CSV minimale (gestisce campi tra virgolette) ---
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}
function readCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n').filter(l => l.length);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map(l => { const c = parseCsvLine(l); const o = {}; header.forEach((h, i) => o[h] = c[i]); return o; });
}

function parseTs(dt) { // "2026-06-01 17:33:13" → epoch sec
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt || '');
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000);
}

// Ordine di piazzamento dei dual: opzionale alternanza deterministica (come il generatore mappa)
function buildDualStream(donazioni) {
  const withN = donazioni.map(d => ({ ...d, n: Math.max(1, parseInt(d.n_dual, 10) || 1), ts: parseTs(d.data) }));
  if (!process.env.ALTERNANZA) {
    // Baseline: ogni donazione piazza i suoi dual consecutivi.
    const stream = [];
    for (const d of withN) for (let k = 1; k <= d.n; k++) stream.push({ d, dord: k });
    return stream;
  }
  // Alternanza: burst entro 5 min, round-robin a blocchi di max 2 dual per donatore.
  const bursts = []; let cur = [];
  for (const d of withN) { if (cur.length && d.ts - cur[cur.length - 1].ts > ALT_WINDOW) { bursts.push(cur); cur = []; } cur.push(d); }
  if (cur.length) bursts.push(cur);
  const stream = [];
  for (const b of bursts) {
    const remaining = b.map(x => x.n); const placed = b.map(() => 0);
    while (remaining.some(r => r > 0)) {
      for (let i = 0; i < b.length; i++) {
        if (remaining[i] > 0) {
          const take = Math.min(2, remaining[i]);
          for (let t = 0; t < take; t++) { placed[i]++; remaining[i]--; stream.push({ d: b[i], dord: placed[i] }); }
        }
      }
    }
  }
  return stream;
}

async function replay() {
  const donazioni = readCsv(DONAZIONI_CSV);
  console.log(`📥 Donazioni lette: ${donazioni.length}`);
  await flow.inizializzaSistema();

  const stream = buildDualStream(donazioni);
  console.log(`🔁 Dual da piazzare: ${stream.length} (ALTERNANZA=${process.env.ALTERNANZA ? 'on' : 'off'})`);

  // Piazza un dual alla volta usando il percorso a coppia singola del motore,
  // così l'ordine (incl. alternanza) è esattamente quello dello stream.
  const stateByTx = new Map();
  let placed = 0;
  for (const { d } of stream) {
    const wallet = d.donatore;
    const txHash = 'DEV_SKIP';
    let state = stateByTx.get(d.seq) || { numeroPosizioni: d.n_dual };
    const res = await flow.processaCoppiaEntrata({ wallet, txHash, nome: `donor_${d.seq}`, state });
    stateByTx.set(d.seq, res.state);
    placed++;
    if (placed % 40 === 0) console.log(`   …piazzati ${placed}/${stream.length} dual`);
  }
  console.log(`✅ Replay completato: ${placed} dual piazzati`);
}

async function estraiSoleEngine() {
  // Posizioni Sole L0 dal motore. numero_posizione = (turno_tavola - 1)*6 + casella.
  const rows = await pg.queryMany(`
    SELECT p.casella, p.wallet, p.tipo, t.numero AS tav_numero, t.turno AS tav_turno
    FROM posizioni p JOIN tavole t ON t.id = p.tavola_id
    WHERE t.livello = 0
    ORDER BY t.turno ASC, p.casella ASC
  `);
  const map = new Map();
  for (const r of rows) {
    const pos = (Number(r.tav_turno) - 1) * 6 + Number(r.casella);
    map.set(pos, { pos, tipo: r.tipo, wallet: (r.wallet || '').toLowerCase() });
  }
  // pos 0 = erede/centro della tavola turno 1 (Fortunato/FONDO)
  const t1 = await pg.queryOne(`SELECT faraone_wallet FROM tavole WHERE livello=0 AND turno=1 ORDER BY numero ASC LIMIT 1`);
  if (t1) map.set(0, { pos: 0, tipo: 'FONDO', wallet: (t1.faraone_wallet || '').toLowerCase() });
  return map;
}

function normTipo(t) { return (t || '').toUpperCase(); }

async function confronta() {
  const mappa = readCsv(MAPPA_CSV);
  const engine = await estraiSoleEngine();
  const maxMap = Math.max(...mappa.map(r => Number(r.posizione)));
  const maxEng = Math.max(...engine.keys());
  console.log(`\n📊 CONFRONTO Sole L0`);
  console.log(`   Posizioni mappa: ${mappa.length} (max ${maxMap})`);
  console.log(`   Posizioni motore: ${engine.size} (max ${maxEng})`);

  let diff = 0, shown = 0;
  for (const r of mappa) {
    const p = Number(r.posizione);
    const e = engine.get(p);
    const mTipo = normTipo(r.tipo), mWallet = (r.wallet || '').toLowerCase();
    const isReserved = mTipo === 'GEMELLO' || mTipo === 'RISERVATA';
    if (!e) {
      diff++; if (shown < MAX_DIFF) { console.log(`   ✗ pos ${p}: mappa=${mTipo}/${mWallet.slice(0,12)} | motore=<assente>`); shown++; }
      continue;
    }
    // Confronto per WALLET (il motore etichetta le posizioni Sole donatore come DONATORE;
    // CASSA vs HUMAN si distingue dal wallet: CASSA = 0x4f53…, HUMAN = wallet donatore).
    let ok;
    if (isReserved) ok = (e.tipo === 'GEMELLO' || e.tipo === 'RISERVATA');
    else ok = (e.wallet === mWallet); // vale per CASSA (0x4f53), HUMAN (donatore) e FONDO (Fortunato)
    if (!ok) {
      diff++; if (shown < MAX_DIFF) { console.log(`   ✗ pos ${p}: mappa=${mTipo}/${mWallet.slice(0,12)} | motore=${normTipo(e.tipo)}/${e.wallet.slice(0,12)}`); shown++; }
    }
  }
  console.log(`\n${diff === 0 ? '✅ NESSUNA DIVERGENZA — motore == mappa' : `⚠️  DIVERGENZE: ${diff} (mostrate ${shown})`}`);
  return diff;
}

// Verifica FORENSE: funzioni rilasciate + accoppiamento Gemello ↔ slot Sole + doni a credito.
async function verificaForense() {
  console.log(`\n🔬 VERIFICA FORENSE (funzioni + accoppiamento)`);
  const problemi = [];
  const check = (cond, msg) => { console.log(`   ${cond ? '✅' : '✗'} ${msg}`); if (!cond) problemi.push(msg); };

  const slot26 = await pg.queryOne(`SELECT tipo, wallet, nome FROM posizioni WHERE numero_posizione = 26`);
  check(!!slot26 && slot26.tipo === 'GEMELLO', `slot Sole 26 è GEMELLO (trovato: ${slot26?.tipo || 'assente'})`);
  check(!!slot26 && slot26.nome === '1-A', `slot 26 accoppiato al Gemello 1-A (trovato: ${slot26?.nome})`);

  const fx = await pg.queryMany(`SELECT tipo, COUNT(*)::int n FROM funzioni GROUP BY tipo`);
  const byT = Object.fromEntries(fx.map(r => [r.tipo, r.n]));
  check(byT.SIMBIONTE === 3, `3 Simbionti rilasciati (trovati: ${byT.SIMBIONTE || 0})`);
  check(byT.PERPETUO === 1, `1 Perpetuo rilasciato (trovati: ${byT.PERPETUO || 0})`);
  check(byT.GEMELLO === 1, `1 Gemello rilasciato (trovati: ${byT.GEMELLO || 0})`);

  const merc = await pg.queryOne(`SELECT COUNT(*)::int n FROM posizioni p JOIN tavole t ON t.id=p.tavola_id WHERE t.livello=2 AND p.tipo IN ('SIMBIONTE','PERPETUO')`);
  check(merc.n === 4, `Simbionti+Perpetuo posizionati a Mercurio L2 (trovati: ${merc.n}/4)`);

  const crediti = await pg.queryOne(`SELECT COUNT(*)::int n FROM doni_credito`);
  check(crediti.n === 5, `5 doni a credito → pool 5.3 (trovati: ${crediti.n})`);

  const riserve = await pg.queryOne(`SELECT COUNT(*)::int n FROM posizioni WHERE tipo IN ('GEMELLO','RISERVATA')`);
  check(riserve.n === 16, `16 slot Gemelli riservati 26+14k (trovati: ${riserve.n})`);

  console.log(`\n${problemi.length === 0 ? '✅ VERIFICA FORENSE OK' : `⚠️  FORENSE: ${problemi.length} problemi`}`);
  return problemi.length;
}

(async () => {
  try {
    await replay();
    const diff = await confronta();
    const forense = await verificaForense();
    await pg.close();
    process.exit(diff === 0 && forense === 0 ? 0 : 2);
  } catch (e) {
    console.error('💥 Errore harness:', e.stack || e.message);
    try { await pg.close(); } catch (_) {}
    process.exit(1);
  }
})();
