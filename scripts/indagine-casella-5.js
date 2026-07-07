/* eslint-disable no-console */
'use strict';

/**
 * 🔎 Indagine forense casella 5 (read-only)
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/indagine-casella-5.js
 *
 * Non modifica dati, solo SELECT.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TARGET_WALLET = '0x3a0fde8d24c3c2b9448503a60d036e66417b2757';
const TARGET_CASELLA = 5;

function nowStamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL non impostata');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  const q = async (sql, params) => (await pool.query(sql, params)).rows;

  const posizioni = await q(
    `SELECT p.id, p.tavola_id, p.casella, p.wallet, p.tipo, p.status, p.created_at,
            t.numero AS tavola_numero, t.livello, t.turno, t.status AS tavola_status
     FROM posizioni p
     JOIN tavole t ON p.tavola_id = t.id
     WHERE p.casella = $1 AND p.wallet = $2
     ORDER BY p.created_at ASC`,
    [TARGET_CASELLA, TARGET_WALLET]
  );

  const duplicates = await q(
    `SELECT tavola_id, casella, COUNT(*)::int AS cnt
     FROM posizioni
     WHERE casella = $1 AND wallet = $2
     GROUP BY tavola_id, casella
     HAVING COUNT(*) > 1`,
    [TARGET_CASELLA, TARGET_WALLET]
  );

  const dupSet = new Set(duplicates.map(d => `${d.tavola_id}:${d.casella}`));

  const occorrenze = posizioni.map((p) => {
    const key = `${p.tavola_id}:${p.casella}`;
    let categoria = 'DATI_INSUFFICIENTI';
    if (dupSet.has(key)) categoria = 'DUPLICATO_SOSPETTO';
    else categoria = 'POSIZIONE_LEGITTIMA_INDIPENDENTE';

    return {
      id_posizione: p.id,
      tavola_id: p.tavola_id,
      tavola_numero: p.tavola_numero,
      turno: p.turno,
      livello: p.livello,
      casella: p.casella,
      wallet: p.wallet,
      tipo: p.tipo,
      status: p.status,
      created_at: p.created_at,
      origine: null,
      donation_id: null,
      event_key: null,
      funzione_generante: null,
      categoria
    };
  });

  const classificazione = {
    posizioni_legittime_indipendenti: occorrenze.filter(o => o.categoria === 'POSIZIONE_LEGITTIMA_INDIPENDENTE').length,
    posizioni_generate_da_funzione: occorrenze.filter(o => o.categoria === 'POSIZIONE_GENERATA_DA_FUNZIONE').length,
    posizioni_dual_legittime: occorrenze.filter(o => o.categoria === 'POSIZIONE_DUAL_LEGITTIMA').length,
    posizioni_reingresso_legittime: occorrenze.filter(o => o.categoria === 'POSIZIONE_REINGRESSO_LEGITTIMO').length,
    duplicati_sospetti: occorrenze.filter(o => o.categoria === 'DUPLICATO_SOSPETTO').length,
    errori_di_assegnazione: occorrenze.filter(o => o.categoria === 'ERRORE_DI_ASSEGNAZIONE').length,
    dati_insufficienti: occorrenze.filter(o => o.categoria === 'DATI_INSUFFICIENTI').length,
  };

  const report = {
    wallet: TARGET_WALLET,
    totale_occorrenze: occorrenze.length,
    occorrenze,
    classificazione,
    anomalie: duplicates.length ? ['DUPLICATI_STESSA_TAVOLA_CASELLA'] : [],
    conclusione: duplicates.length ? 'Presenza di duplicati sospetti nella stessa tavola/casella.' : 'Nessun duplicato nella stessa tavola/casella rilevato.',
    azioni_consigliate: duplicates.length ? ['Verificare origine delle posizioni duplicate per tavola/casella.'] : ['Verificare origine con dati aggiuntivi (donazioni/event_key) se disponibili.']
  };

  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `indagine-casella-5-wallet-0x3a0fde8d-${nowStamp()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Report creato: ${reportPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Indagine fallita:', err.message);
  process.exit(1);
});
