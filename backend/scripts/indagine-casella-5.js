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

  const tables = await q(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const tableNames = new Set(tables.map(t => t.table_name));

  const columns = await q(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`
  );

  const columnsByTable = new Map();
  for (const row of columns) {
    const list = columnsByTable.get(row.table_name) || [];
    list.push(row.column_name);
    columnsByTable.set(row.table_name, list);
  }

  const logDiagnostics = (label, table, sql, params, rawCount) => {
    console.log(`\n[DIAGNOSTICA] ${label}`);
    console.log(`- tabella: ${table}`);
    console.log(`- colonne: ${(columnsByTable.get(table) || []).join(', ') || 'N/A'}`);
    console.log(`- query: ${sql}`);
    console.log(`- params: ${JSON.stringify(params)}`);
    console.log(`- conteggio_grezzo: ${rawCount}`);
  };

  const exists = (table, col) => tableNames.has(table) && (columnsByTable.get(table) || []).includes(col);
  const hasTable = (table) => tableNames.has(table);

  const occurrences = {
    posizioni: [],
    posizioni_tavola: [],
    storico_funzioni: [],
    non_classificabili: [],
  };

  let totalCount = 0;
  const queriesUsed = [];

  if (hasTable('posizioni')) {
    const cols = columnsByTable.get('posizioni') || [];
    const hasWallet = cols.includes('wallet');
    const hasCasella = cols.includes('casella');
    const hasTavolaId = cols.includes('tavola_id');
    if (hasWallet && hasCasella) {
      const hasTipo = cols.includes('tipo');
      const hasStatus = cols.includes('status');
      const hasCreatedAt = cols.includes('created_at');
      const hasDonationId = cols.includes('donation_id');
      const hasEventKey = cols.includes('event_key');
      const hasOrigine = cols.includes('origine');

      const joinTavole = hasTable('tavole') && columnsByTable.get('tavole')?.includes('id');
      const tavoleCols = columnsByTable.get('tavole') || [];

      const sql = `
        SELECT p.id, p.tavola_id, p.casella, p.wallet,
               ${hasTipo ? 'p.tipo' : 'NULL AS tipo'},
               ${hasStatus ? 'p.status' : 'NULL AS status'},
               ${hasCreatedAt ? 'p.created_at' : 'NULL AS created_at'},
               ${hasOrigine ? 'p.origine' : 'NULL AS origine'},
               ${hasDonationId ? 'p.donation_id' : 'NULL AS donation_id'},
               ${hasEventKey ? 'p.event_key' : 'NULL AS event_key'},
               ${joinTavole && tavoleCols.includes('numero') ? 't.numero AS tavola_numero' : 'NULL AS tavola_numero'},
               ${joinTavole && tavoleCols.includes('turno') ? 't.turno AS turno' : 'NULL AS turno'},
               ${joinTavole && tavoleCols.includes('livello') ? 't.livello AS livello' : 'NULL AS livello'}
        FROM posizioni p
        ${joinTavole ? 'LEFT JOIN tavole t ON t.id = p.tavola_id' : ''}
        WHERE p.casella = $1 AND lower(p.wallet) = lower($2)
        ORDER BY ${hasCreatedAt ? 'p.created_at' : 'p.id'} ASC, p.id ASC
      `;
      const params = [TARGET_CASELLA, TARGET_WALLET];
      const rows = await q(sql, params);
      totalCount += rows.length;
      logDiagnostics('POSIZIONI (dirette)', 'posizioni', sql.trim(), params, rows.length);
      queriesUsed.push({ label: 'posizioni', sql: sql.trim(), params });
      occurrences.posizioni = rows;
    }
  }

  const candidateCasellaTables = [];
  for (const [table, cols] of columnsByTable.entries()) {
    if (cols.includes('casella') && cols.includes('wallet')) {
      candidateCasellaTables.push(table);
    }
  }

  for (const table of candidateCasellaTables) {
    if (table === 'posizioni') continue;
    const cols = columnsByTable.get(table) || [];
    const sql = `
      SELECT *
      FROM ${table}
      WHERE casella = $1 AND lower(wallet) = lower($2)
    `;
    const params = [TARGET_CASELLA, TARGET_WALLET];
    const rows = await q(sql, params);
    if (rows.length > 0) {
      totalCount += rows.length;
      logDiagnostics('POSIZIONI_TAVOLA (equivalente)', table, sql.trim(), params, rows.length);
      queriesUsed.push({ label: `posizioni_tavola:${table}`, sql: sql.trim(), params });
      occurrences.posizioni_tavola.push({ table, rows });
    }
  }

  if (hasTable('storico_avanzamenti') && exists('storico_avanzamenti', 'wallet')) {
    const cols = columnsByTable.get('storico_avanzamenti') || [];
    const sql = `
      SELECT *
      FROM storico_avanzamenti
      WHERE lower(wallet) = lower($1)
      ORDER BY ${cols.includes('created_at') ? 'created_at' : 'id'} ASC
    `;
    const params = [TARGET_WALLET];
    const rows = await q(sql, params);
    totalCount += rows.length;
    logDiagnostics('STORICO_AVANZAMENTI', 'storico_avanzamenti', sql.trim(), params, rows.length);
    queriesUsed.push({ label: 'storico_avanzamenti', sql: sql.trim(), params });
    if (rows.length) occurrences.storico_funzioni.push({ table: 'storico_avanzamenti', rows });
  }

  if (hasTable('funzioni')) {
    const cols = columnsByTable.get('funzioni') || [];
    const hasOrigine = cols.includes('account_origine_wallet');
    const hasGenerato = cols.includes('account_generato_wallet');
    if (hasOrigine || hasGenerato) {
      const sql = `
        SELECT *
        FROM funzioni
        WHERE ${hasOrigine ? 'lower(account_origine_wallet) = lower($1)' : 'FALSE'}
           OR ${hasGenerato ? 'lower(account_generato_wallet) = lower($1)' : 'FALSE'}
      `;
      const params = [TARGET_WALLET];
      const rows = await q(sql, params);
      totalCount += rows.length;
      logDiagnostics('FUNZIONI', 'funzioni', sql.trim(), params, rows.length);
      queriesUsed.push({ label: 'funzioni', sql: sql.trim(), params });
      if (rows.length) occurrences.storico_funzioni.push({ table: 'funzioni', rows });
    }
  }

  if (hasTable('donazioni')) {
    const cols = columnsByTable.get('donazioni') || [];
    const hasDonor = cols.includes('donor_wallet');
    const hasDest = cols.includes('destinatario_wallet');
    if (hasDonor || hasDest) {
      const sql = `
        SELECT *
        FROM donazioni
        WHERE ${hasDonor ? 'lower(donor_wallet) = lower($1)' : 'FALSE'}
           OR ${hasDest ? 'lower(destinatario_wallet) = lower($1)' : 'FALSE'}
      `;
      const params = [TARGET_WALLET];
      const rows = await q(sql, params);
      totalCount += rows.length;
      logDiagnostics('DONAZIONI', 'donazioni', sql.trim(), params, rows.length);
      queriesUsed.push({ label: 'donazioni', sql: sql.trim(), params });
      if (rows.length) occurrences.storico_funzioni.push({ table: 'donazioni', rows });
    }
  }

  if (hasTable('uscite_l3') && exists('uscite_l3', 'wallet')) {
    const cols = columnsByTable.get('uscite_l3') || [];
    const sql = `
      SELECT *
      FROM uscite_l3
      WHERE lower(wallet) = lower($1)
      ORDER BY ${cols.includes('created_at') ? 'created_at' : 'id'} ASC
    `;
    const params = [TARGET_WALLET];
    const rows = await q(sql, params);
    totalCount += rows.length;
    logDiagnostics('USCITE_L3', 'uscite_l3', sql.trim(), params, rows.length);
    queriesUsed.push({ label: 'uscite_l3', sql: sql.trim(), params });
    if (rows.length) occurrences.storico_funzioni.push({ table: 'uscite_l3', rows });
  }

  if (hasTable('bridge_log') && exists('bridge_log', 'wallet')) {
    const cols = columnsByTable.get('bridge_log') || [];
    const sql = `
      SELECT *
      FROM bridge_log
      WHERE lower(wallet) = lower($1)
      ORDER BY ${cols.includes('created_at') ? 'created_at' : 'id'} ASC
    `;
    const params = [TARGET_WALLET];
    const rows = await q(sql, params);
    totalCount += rows.length;
    logDiagnostics('BRIDGE_LOG', 'bridge_log', sql.trim(), params, rows.length);
    queriesUsed.push({ label: 'bridge_log', sql: sql.trim(), params });
    if (rows.length) occurrences.non_classificabili.push({ table: 'bridge_log', rows });
  }

  if (hasTable('flussi_esterni') && exists('flussi_esterni', 'origine_wallet')) {
    const cols = columnsByTable.get('flussi_esterni') || [];
    const sql = `
      SELECT *
      FROM flussi_esterni
      WHERE lower(origine_wallet) = lower($1)
      ORDER BY ${cols.includes('created_at') ? 'created_at' : 'id'} ASC
    `;
    const params = [TARGET_WALLET];
    const rows = await q(sql, params);
    totalCount += rows.length;
    logDiagnostics('FLUSSI_ESTERNI', 'flussi_esterni', sql.trim(), params, rows.length);
    queriesUsed.push({ label: 'flussi_esterni', sql: sql.trim(), params });
    if (rows.length) occurrences.non_classificabili.push({ table: 'flussi_esterni', rows });
  }

  const conclusione = totalCount === 0
    ? 'DATI_INSUFFICIENTI_O_QUERY_NON_ALLINEATA'
    : 'DATI_RILEVATI_DA_FONTI_MULTIPLE';

  const report = {
    wallet: TARGET_WALLET,
    totale_occorrenze: totalCount,
    occorrenze_dirette_posizioni: occurrences.posizioni,
    occorrenze_assegnazioni_tavola: occurrences.posizioni_tavola,
    occorrenze_storico_funzioni: occurrences.storico_funzioni,
    occorrenze_non_classificabili: occurrences.non_classificabili,
    conclusione,
    tabelle_individuate: Array.from(tableNames.values()).sort(),
    query_usate: queriesUsed,
    motivo_zero_precedente: totalCount === 0
      ? 'Il precedente script interrogava solo posizioni con confronto case-sensitive e senza discovery delle fonti.'
      : null
  };

  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `indagine-casella-5-wallet-0x3a0fde8d-${nowStamp()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\nReport creato: ${reportPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Indagine fallita:', err.message);
  process.exit(1);
});
