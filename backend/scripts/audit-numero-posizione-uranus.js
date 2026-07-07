#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pg = require('../pg-connection-manager');

function pad(n) { return String(n).padStart(2, '0'); }
function timestampLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function originFromTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'DONATORE') return 'donazione';
  if (t === 'SIMBIONTE') return 'Simbionte';
  if (t === 'PERPETUO') return 'Perpetuo';
  if (t === 'GEMELLO') return 'Gemello';
  if (t === 'PROGREDITO') return 'progredito';
  if (t === 'EREDE') return 'erede';
  if (t === 'FARAONE') return 'faraone';
  if (t === 'FONDO') return 'fondo';
  if (t === 'CASSA') return 'cassa';
  if (t === 'RISERVATA') return 'riserva';
  if (t === 'CLONE') return 'clone';
  if (t === 'DUAL') return 'dual';
  if (t === 'BRIDGE') return 'bridge';
  if (t === 'REINSERIMENTO') return 'reinserimento';
  return 'altra';
}

async function getColumns(table) {
  const rows = await pg.queryMany(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1`,
    [table]
  );
  return new Set(rows.map(r => r.column_name));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function computeHoles(sortedUniqueNumbers, maxHoles = 10000) {
  const holes = [];
  if (sortedUniqueNumbers.length === 0) {
    return { holes, truncated: false };
  }
  const min = sortedUniqueNumbers[0];
  const max = sortedUniqueNumbers[sortedUniqueNumbers.length - 1];
  const present = new Set(sortedUniqueNumbers);
  let truncated = false;
  for (let n = min; n <= max; n += 1) {
    if (!present.has(n)) {
      holes.push(n);
      if (holes.length >= maxHoles) {
        truncated = true;
        break;
      }
    }
  }
  return { holes, truncated };
}

async function main() {
  const posColumns = await getColumns('posizioni');
  const tavColumns = await getColumns('tavole');

  const numeroCol = posColumns.has('numero_posizione_uranus')
    ? 'numero_posizione_uranus'
    : (posColumns.has('numero_posizione') ? 'numero_posizione' : null);

  if (!numeroCol) {
    throw new Error('Nessuna colonna numero_posizione_uranus/numero_posizione trovata in posizioni');
  }

  const hasOrigine = posColumns.has('origine');
  const hasDonationId = posColumns.has('donation_id');
  const hasEventKey = posColumns.has('event_key');
  const hasStatus = posColumns.has('status');

  const selectFields = [
    'p.id',
    `p.${numeroCol} AS numero_posizione_uranus`,
    'p.tavola_id',
    tavColumns.has('turno') ? 't.turno' : 'NULL AS turno',
    tavColumns.has('livello') ? 't.livello' : 'NULL AS livello',
    'p.casella',
    'p.wallet',
    'p.tipo',
    hasOrigine ? 'p.origine' : 'NULL AS origine',
    'p.created_at',
    hasDonationId ? 'p.donation_id' : 'NULL AS donation_id',
    hasEventKey ? 'p.event_key' : 'NULL AS event_key',
    hasStatus ? 'p.status' : 'NULL AS status',
  ];

  const sql = `
    SELECT ${selectFields.join(', ')}
    FROM posizioni p
    LEFT JOIN tavole t ON t.id = p.tavola_id
    ORDER BY p.created_at ASC, p.id ASC
  `;

  const rows = await pg.queryMany(sql);

  const total = rows.length;
  const numbers = [];
  const numberCounts = new Map();
  let nullCount = 0;
  let min = null;
  let max = null;

  const byLevel = new Map();
  const byOrigin = new Map();

  const records = rows.map(r => {
    const numero = r.numero_posizione_uranus !== null ? Number(r.numero_posizione_uranus) : null;
    const livello = r.livello !== null ? Number(r.livello) : null;
    const origine = r.origine || originFromTipo(r.tipo);

    if (numero === null || Number.isNaN(numero)) {
      nullCount += 1;
    } else {
      numbers.push(numero);
      numberCounts.set(numero, (numberCounts.get(numero) || 0) + 1);
      if (min === null || numero < min) min = numero;
      if (max === null || numero > max) max = numero;
    }

    const lvlKey = livello === null ? 'UNKNOWN' : `L${livello}`;
    const lvl = byLevel.get(lvlKey) || { totale: 0, con_numero: 0, nulli: 0 };
    lvl.totale += 1;
    if (numero === null || Number.isNaN(numero)) lvl.nulli += 1;
    else lvl.con_numero += 1;
    byLevel.set(lvlKey, lvl);

    const origKey = origine || 'altra';
    byOrigin.set(origKey, (byOrigin.get(origKey) || 0) + 1);

    return {
      id: r.id,
      numero_posizione_uranus: numero,
      tavola_id: r.tavola_id,
      turno: r.turno,
      livello,
      casella: r.casella,
      wallet: r.wallet,
      tipo: r.tipo,
      origine: origine,
      created_at: r.created_at,
      donation_id: r.donation_id,
      event_key: r.event_key,
      status: r.status,
    };
  });

  const totalWithNumber = total - nullCount;
  const duplicates = [];
  let duplicateTotal = 0;

  for (const [numero, count] of numberCounts.entries()) {
    if (count > 1) {
      duplicateTotal += (count - 1);
      duplicates.push({ numero, count });
    }
  }

  const sortedUnique = Array.from(numberCounts.keys()).sort((a, b) => a - b);
  const { holes, truncated: holesTruncated } = computeHoles(sortedUnique);

  const hasZero = numberCounts.has(0);

  const duplicatesDetail = duplicates.map(d => ({
    ...d,
    records: records.filter(r => r.numero_posizione_uranus === d.numero)
      .map(r => ({ id: r.id, tavola_id: r.tavola_id, wallet: r.wallet, created_at: r.created_at }))
  }));

  const recordsNeedingNumber = records.filter(r => r.numero_posizione_uranus === null);
  const duplicateRecordsNeedingFix = duplicatesDetail.flatMap(d => d.records.slice(1));
  const scenarioAChanged = recordsNeedingNumber.length + duplicateRecordsNeedingFix.length;

  const scenarioBExpected = records.map((r, idx) => ({
    id: r.id,
    expected_numero: idx
  }));
  const scenarioBMismatches = scenarioBExpected.filter((exp, i) => {
    const current = records[i].numero_posizione_uranus;
    return current !== exp.expected_numero;
  });

  const casella5Map = new Map();
  for (const r of records) {
    if (Number(r.casella) === 5 && r.wallet) {
      const key = r.wallet.toLowerCase();
      const entry = casella5Map.get(key) || new Set();
      entry.add(r.tavola_id);
      casella5Map.set(key, entry);
    }
  }
  const casella5MultiTavole = Array.from(casella5Map.entries())
    .filter(([, tavole]) => tavole.size > 1)
    .map(([wallet, tavole]) => ({ wallet, tavole: Array.from(tavole), count: tavole.size }));

  const report = {
    generated_at: new Date().toISOString(),
    numero_colonna_utilizzata: numeroCol,
    colonne_posizioni: Array.from(posColumns.values()).sort(),
    note_colonne_mancanti: {
      origine: !hasOrigine,
      donation_id: !hasDonationId,
      event_key: !hasEventKey,
      status: !hasStatus
    },
    summary: {
      totale_posizioni: total,
      totale_con_numero: totalWithNumber,
      totale_null: nullCount,
      totale_duplicati: duplicates.length,
      totale_record_duplicati: duplicateTotal,
      numero_min: min,
      numero_max: max,
      presenza_zero: hasZero,
      buchi_progressione: holes,
      buchi_troncati: holesTruncated
    },
    per_livello: Object.fromEntries(byLevel.entries()),
    per_origine: Object.fromEntries(byOrigin.entries()),
    duplicati: duplicatesDetail,
    casella5_wallet_multi_tavola: casella5MultiTavole,
    scenarioA: {
      descrizione: 'Preserva numeri esistenti non duplicati; assegna nuovi numeri ai NULL e ai duplicati eccedenti.',
      record_da_rinumerare: scenarioAChanged,
      dettagli: {
        nulli: recordsNeedingNumber.length,
        duplicati_eccedenti: duplicateRecordsNeedingFix.length
      }
    },
    scenarioB: {
      descrizione: 'Ricostruisce tutta la numerazione globale in ordine cronologico di creazione, partendo da 0.',
      record_da_rinumerare: scenarioBMismatches.length,
      regole_ordine: 'ORDER BY created_at ASC, id ASC'
    },
    mappa_completa: records
  };

  const reportsDir = path.resolve(__dirname, '..', 'reports');
  ensureDir(reportsDir);
  const outPath = path.resolve(reportsDir, `audit-numero-posizione-uranus-${timestampLocal()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`✅ Report generato: ${outPath}`);
  await pg.close();
}

main().catch(err => {
  console.error('❌ Errore audit:', err.message);
  process.exit(1);
});
