/**
 * 🏗️  URANUS — RICOSTRUZIONE DB CORRETTO (per deploy produzione)
 *
 * Costruisce, su un DB TARGET, lo stato corretto e certificato:
 *   1. Rigioca le 82 donazioni reali (ordine cronologico + alternanza) attraverso il
 *      motore CORRETTO → posizioni Sole L0 con riserve 26+14k, funzioni, Nettuno.
 *   2. Reinietta le tx reali nella tabella `donazioni` (anti-replay + storia preservati).
 *   3. Marca il payout della pos 0 (Fortunato, 500 USDC) come GIÀ EMESSO → il bottone
 *      "ACCETTA DONO" NON potrà ri-pagarlo (sicurezza payout).
 *   4. Verifica che il Sole L0 combaci ESATTAMENTE con la mappa certificata.
 *
 * SICUREZZA:
 *   - Rifiuta di girare se il DB target ha già posizioni (a meno di FORCE=true).
 *   - Pensato per un DB NUOVO/vuoto: NON esegue DROP. Il caller decide backup/swap.
 *   - NON gira in NODE_ENV=production a meno di NODE_ENV forzato dal caller (usa DEV_SKIP).
 *
 * USO (locale):
 *   NODE_ENV=development DATABASE_URL="postgresql://admin@localhost:5432/urano_prod_new" \
 *     node scripts/ricostruisci-db.js
 *   # poi:  pg_dump urano_prod_new > urano_prod_new.sql   (per il deploy)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// I CSV certificati sono inclusi in scripts/data/ (così il rebuild gira anche nel container
// Coolify, dove la cartella MAPPA-DEFINITIVA in root NON viene copiata). Fallback: cartella MAPPA.
const MAP_DIR = process.env.MAP_DIR
  || (fs.existsSync(path.resolve(__dirname, 'data', 'URANUS-mappa-definitiva-20260703.csv'))
        ? path.resolve(__dirname, 'data')
        : path.resolve(__dirname, '../../MAPPA-DEFINITIVA-03LUGLIO'));
const DONAZIONI_CSV = path.join(MAP_DIR, 'URANUS-donazioni-20260703.csv');
const MAPPA_CSV = path.join(MAP_DIR, 'URANUS-mappa-definitiva-20260703.csv');
const ALT_WINDOW = 300;

const FORTUNATO = '0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4';
const CASSA = '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce';
const DONO_POS0_TX = '0x1ae343c5e4d46ab94d7bcd57f476b0fd11cd559ac4e6496eae2496bedaaf6a15';
const DONO_POS0_USDC = 500;

if (!process.env.DATABASE_URL) { console.error('🚨 DATABASE_URL obbligatoria.'); process.exit(1); }

const db = require('../db-manager');
const pg = require('../pg-connection-manager');
const flow = require('../donation-flow-manager');
const giftManager = require('./../gift-manager');

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
function parseTs(dt) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt || '');
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) : 0;
}

// Stream dei dual con alternanza deterministica (round-robin max 2 dual, finestra 5 min).
function buildDualStream(donazioni) {
  const withN = donazioni.map(d => ({ ...d, n: Math.max(1, parseInt(d.n_dual, 10) || 1), ts: parseTs(d.data) }));
  const bursts = []; let cur = [];
  for (const d of withN) { if (cur.length && d.ts - cur[cur.length - 1].ts > ALT_WINDOW) { bursts.push(cur); cur = []; } cur.push(d); }
  if (cur.length) bursts.push(cur);
  const stream = [];
  for (const b of bursts) {
    const remaining = b.map(x => x.n);
    while (remaining.some(r => r > 0)) {
      for (let i = 0; i < b.length; i++) {
        const take = Math.min(2, remaining[i]); // fisso per giro (NON ricalcolare dopo il decremento)
        for (let t = 0; t < take; t++) { remaining[i]--; stream.push(b[i]); }
      }
    }
  }
  return stream;
}

async function main() {
  const donazioni = readCsv(DONAZIONI_CSV);
  const mappa = readCsv(MAPPA_CSV);
  console.log(`📥 Donazioni: ${donazioni.length} · righe mappa: ${mappa.length}`);

  await db.initDatabase();
  await giftManager.initGiftTables();

  // ── RESET (opzionale): cancella TUTTI i dati vecchi via TRUNCATE di ogni tabella public.
  // Si usa TRUNCATE (non DROP SCHEMA) perché droppare lo schema corrompe il search_path
  // delle connessioni del pool ("no schema has been selected") e fa fallire in silenzio i
  // savepoint della cascata. TRUNCATE mantiene schema/search_path intatti e resetta i serial.
  // USARE SOLO DOPO BACKUP (snapshot Coolify). Le tabelle sono già create da initDatabase sopra.
  if (process.env.RESET === 'true') {
    console.log('🗑️  RESET=true → CANCELLO tutti i dati vecchi (TRUNCATE di tutte le tabelle)...');
    await pg.query(`DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;`);
    console.log('✅ Dati vecchi cancellati (tutte le tabelle azzerate)');
  }

  // ── GUARD: DB deve essere vuoto (salvo FORCE) ──
  const nPos = await pg.queryOne(`SELECT COUNT(*)::int n FROM posizioni`);
  if (nPos.n > 0 && process.env.FORCE !== 'true') {
    console.error(`🚨 Il DB target ha già ${nPos.n} posizioni. Usa un DB NUOVO/vuoto, oppure FORCE=true (dopo backup).`);
    process.exit(1);
  }

  await flow.inizializzaSistema();

  // ── 1) REPLAY (posizioni + riserve + funzioni + Nettuno) ──
  const stream = buildDualStream(donazioni);
  console.log(`🔁 Piazzo ${stream.length} dual (alternanza deterministica)...`);
  const stateBySeq = new Map();
  for (const d of stream) {
    const state = stateBySeq.get(d.seq) || { numeroPosizioni: d.n_dual };
    const r = await flow.processaCoppiaEntrata({ wallet: d.donatore, txHash: 'DEV_SKIP', nome: `donatore ${d.seq}`, state });
    stateBySeq.set(d.seq, r.state);
  }
  console.log(`✅ Replay completato`);

  // ── 2) DONAZIONI: reinietta le tx REALI (anti-replay + storia) ──
  // Dalla mappa: raggruppa CASSA/HUMAN per tx → donatore (HUMAN) + n_dual → importo USDC.
  const byTx = new Map();
  for (const r of mappa) {
    const tx = (r.tx_hash || '').trim();
    if (!tx || !['CASSA', 'HUMAN'].includes((r.tipo || '').toUpperCase())) continue;
    if (!byTx.has(tx)) byTx.set(tx, { human: null, pos: 0 });
    const g = byTx.get(tx); g.pos++;
    if ((r.tipo || '').toUpperCase() === 'HUMAN') g.human = (r.wallet || '').toLowerCase();
  }
  let inj=0;
  for (const [tx, g] of byTx) {
    const importo = (g.pos / 2) * 20; // n_dual * 20 USDC-equivalente
    await pg.query(
      `INSERT INTO donazioni (donor_wallet, importo, tx_hash, destinatario_wallet, livello, turno, status)
       VALUES ($1,$2,$3,$4,0,NULL,'COMPLETATA') ON CONFLICT (tx_hash) DO NOTHING`,
      [g.human, importo, tx.toLowerCase(), CASSA]
    );
    inj++;
  }
  console.log(`✅ Donazioni reiniettate: ${inj} tx reali`);

  // ── 3) SICUREZZA PAYOUT: pos 0 (Fortunato) già pagata → marca ACCEPTED (no doppio pagamento) ──
  const marcati = await pg.queryMany(
    `UPDATE doni_pendenti SET status='ACCEPTED', accepted_at=NOW(), tx_hash=$2
     WHERE wallet=$1 AND status='PENDING' RETURNING id, importo`,
    [FORTUNATO, DONO_POS0_TX]
  );
  console.log(`✅ Payout pos 0: ${marcati.length} dono/i pendente/i di Fortunato marcati GIÀ EMESSI (tx ${DONO_POS0_TX.slice(0,12)}…, ${DONO_POS0_USDC} USDC)`);

  // ── 4) VERIFICA == mappa certificata ──
  const rows = await pg.queryMany(`
    SELECT p.casella, p.wallet, p.tipo, t.turno AS tav_turno
    FROM posizioni p JOIN tavole t ON t.id=p.tavola_id WHERE t.livello=0`);
  const engine = new Map();
  for (const r of rows) engine.set((Number(r.tav_turno)-1)*6+Number(r.casella), { tipo: r.tipo, wallet: (r.wallet||'').toLowerCase() });
  const t1 = await pg.queryOne(`SELECT faraone_wallet FROM tavole WHERE livello=0 AND turno=1 ORDER BY numero ASC LIMIT 1`);
  if (t1) engine.set(0, { tipo: 'FONDO', wallet: (t1.faraone_wallet||'').toLowerCase() });
  let diff = 0;
  for (const r of mappa) {
    const p = Number(r.posizione); const e = engine.get(p);
    const mTipo = (r.tipo||'').toUpperCase(); const mWallet = (r.wallet||'').toLowerCase();
    const reserved = mTipo === 'GEMELLO' || mTipo === 'RISERVATA';
    if (!e) { diff++; continue; }
    if (reserved) { if (!(e.tipo === 'GEMELLO' || e.tipo === 'RISERVATA')) diff++; }
    else if (e.wallet !== mWallet) diff++;
  }
  console.log(`\n📊 Sole L0: mappa ${mappa.length} · motore ${engine.size} · divergenze ${diff}`);
  console.log(diff === 0 ? '✅ DB RICOSTRUITO == MAPPA CERTIFICATA' : '⚠️  DIVERGENZE — NON procedere al deploy');

  await pg.close();
  process.exit(diff === 0 ? 0 : 2);
}

main().catch(e => { console.error('💥', e.stack || e.message); process.exit(1); });
