'use strict';
/**
 * 🔧 URANUS — Script di riconciliazione DB
 *
 * Allinea il DB di produzione alla mappa definitiva (MAPPA-DEFINITIVA-03LUGLIO/).
 * DA ESEGUIRE SOLO SU DB DEDICATO DI TEST prima di applicare in produzione.
 *
 * Uso:
 *   DRY_RUN (default — mostra cosa farebbe, non tocca nulla):
 *     DATABASE_URL=postgresql://... node scripts/riconcilia-db.js
 *
 *   APPLY (esegue le correzioni, in transazione, con rollback automatico se fallisce):
 *     DATABASE_URL=postgresql://... APPLY=true node scripts/riconcilia-db.js
 *
 * Richiede:
 *   DATABASE_URL  — stringa di connessione PostgreSQL
 *
 * Output: conteggi PRIMA e DOPO per ogni correzione.
 * Idempotente: sicuro da eseguire più volte.
 */

const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.APPLY !== 'true';
const CASSA_REALE = (process.env.URANUS_CASSA_WALLET || '0x4f53c4277e2e738cdb71375253b3fe30bbca95ce').toLowerCase();
const PLACEHOLDER_CASSA = '0x0000000000000000000000000000000000000002';

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL non impostata');
  process.exit(1);
}

// ─── REPORT ─────────────────────────────────────────────────────────────────

function hdr(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function row(label, before, after) {
  const changed = after !== undefined && before !== after;
  const afterStr = after !== undefined ? ` → DOPO: ${after}` : '';
  const flag = changed ? ' ✅' : (after !== undefined ? ' (nessuna modifica)' : '');
  console.log(`  ${label.padEnd(40)} PRIMA: ${before}${afterStr}${flag}`);
}

// ─── QUERY HELPER ────────────────────────────────────────────────────────────

async function count(client, sql, params = []) {
  const r = await client.query(sql, params);
  return Number(r.rows[0]?.count ?? r.rows[0]?.cnt ?? 0);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`\n🔧 URANUS — Riconciliazione DB`);
  console.log(`   Modalità: ${DRY_RUN ? '🔍 DRY_RUN (nessuna modifica)' : '⚡ APPLY (modifica il DB)'}`);
  console.log(`   Cassa reale: ${CASSA_REALE}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);

  try {
    await client.query('BEGIN');

    // ════════════════════════════════════════════════════════════════
    // § 1. DIAGNOSTICA INIZIALE
    // ════════════════════════════════════════════════════════════════
    hdr('§ 1. DIAGNOSTICA INIZIALE');

    const diagSql = `
      SELECT
        (SELECT COUNT(*) FROM accounts)                                    AS tot_accounts,
        (SELECT COUNT(*) FROM posizioni)                                   AS tot_posizioni,
        (SELECT COUNT(*) FROM coda_fifo)                                   AS tot_coda_fifo,
        (SELECT COUNT(*) FROM coda_fifo WHERE status='IN_CODA')            AS fifo_in_coda,
        (SELECT COUNT(*) FROM donazioni)                                   AS tot_donazioni,
        (SELECT COUNT(*) FROM funzioni)                                    AS tot_funzioni,
        (SELECT COUNT(*) FROM turni)                                       AS tot_turni,
        (SELECT COALESCE(SUM(importo),0) FROM donazioni WHERE status='COMPLETATA') AS tot_usdc_donazioni
    `;
    const diag = (await client.query(diagSql)).rows[0];
    console.log(`  Accounts:        ${diag.tot_accounts}`);
    console.log(`  Posizioni:       ${diag.tot_posizioni}`);
    console.log(`  Coda FIFO tot:   ${diag.tot_coda_fifo}  (IN_CODA: ${diag.fifo_in_coda})`);
    console.log(`  Donazioni:       ${diag.tot_donazioni}  (totale USDC: ${diag.tot_usdc_donazioni})`);
    console.log(`  Funzioni:        ${diag.tot_funzioni}`);
    console.log(`  Turni:           ${diag.tot_turni}`);

    // ════════════════════════════════════════════════════════════════
    // § 2. FIX PLACEHOLDER 0x...0002
    // ════════════════════════════════════════════════════════════════
    hdr('§ 2. FIX PLACEHOLDER 0x...0002 → Cassa reale');

    const tabellePlaceholder = [
      { label: 'turni.faraone_wallet',               sql: `UPDATE turni SET faraone_wallet=$1 WHERE lower(faraone_wallet)=$2` },
      { label: 'tavole.faraone_wallet',               sql: `UPDATE tavole SET faraone_wallet=$1 WHERE lower(faraone_wallet)=$2` },
      { label: 'posizioni.wallet',                    sql: `UPDATE posizioni SET wallet=$1 WHERE lower(wallet)=$2` },
      { label: 'coda_fifo.wallet + tipo→CASSA',       sql: `UPDATE coda_fifo SET wallet=$1, tipo='CASSA' WHERE lower(wallet)=$2` },
      { label: 'flussi_esterni.origine_wallet',       sql: `UPDATE flussi_esterni SET origine_wallet=$1 WHERE lower(origine_wallet)=$2` },
      { label: 'storico_avanzamenti.wallet',          sql: `UPDATE storico_avanzamenti SET wallet=$1 WHERE lower(wallet)=$2` },
      { label: 'bridge_log.wallet',                   sql: `UPDATE bridge_log SET wallet=$1 WHERE lower(wallet)=$2` },
    ];

    let placeholder_total_prima = 0;
    let placeholder_total_dopo = 0;

    for (const t of tabellePlaceholder) {
      const tableName = t.label.split('.')[0];
      const colName   = t.label.split('.')[1].split('+')[0].trim();
      const prima = await count(client,
        `SELECT COUNT(*) FROM ${tableName} WHERE lower(${colName})=$1`, [PLACEHOLDER_CASSA]);
      placeholder_total_prima += prima;

      let dopo = prima;
      if (!DRY_RUN && prima > 0) {
        const r = await client.query(t.sql, [CASSA_REALE, PLACEHOLDER_CASSA]);
        dopo = 0; // dopo la fix non ce ne sono più
      }
      row(t.label, prima, DRY_RUN ? undefined : dopo);
    }

    // accounts: speciale (UNIQUE constraint su wallet)
    const accExists = await count(client,
      `SELECT COUNT(*) FROM accounts WHERE lower(wallet)=$1`, [CASSA_REALE]);
    const accPlaceholder = await count(client,
      `SELECT COUNT(*) FROM accounts WHERE lower(wallet)=$1`, [PLACEHOLDER_CASSA]);
    if (accPlaceholder > 0) {
      if (accExists > 0) {
        console.log(`  accounts (CASSA):  placeholder presente ma cassa reale già esiste → rimozione manuale consigliata`);
      } else if (!DRY_RUN) {
        await client.query(
          `UPDATE accounts SET wallet=$1, tipo='CASSA', nome=COALESCE(nome,'CASSA (Sistema)') WHERE lower(wallet)=$2`,
          [CASSA_REALE, PLACEHOLDER_CASSA]);
        row('accounts.wallet', accPlaceholder, 0);
      } else {
        row('accounts.wallet', accPlaceholder);
      }
    } else {
      row('accounts (CASSA): placeholder 0x0002', accPlaceholder, DRY_RUN ? undefined : accPlaceholder);
    }

    console.log(`\n  → Totale righe con placeholder da correggere: ${placeholder_total_prima}`);

    // ════════════════════════════════════════════════════════════════
    // § 3. NETTUNO — RIMOZIONE POSIZIONI ECCEDENTI
    // ════════════════════════════════════════════════════════════════
    hdr('§ 3. NETTUNO — Posizioni eccedenti (create a donazioni, non a uscite L3/L5)');

    // Le posizioni Nettuno legittime vengono create SOLO da hookUscitaL3 / hookUscitaL5.
    // Il bug precedente creava 1 HUMAN per ogni tavola Sole completata (auto-entry).
    // Criterio di identificazione:
    //   - è_rientro = FALSE  (non è un rientro perpetuo)
    //   - uscita_numero IS NULL  (non ha ancora partecipato a nessuna uscita)
    //   - tipo = 'HUMAN'  (le CASSA fasulle avevano tipo='HUMAN' invece di 'CASSA')
    //   - Ragionevolmente: le prime N posizioni prima che il bridge partisse
    //
    // ATTENZIONE: senza l'export on-chain non possiamo sapere con certezza quante
    // tavole Sole si erano completate prima del fix. Usiamo un approccio conservativo:
    // mostro solo il conteggio; la RIMOZIONE richiede conferma esplicita REMOVE_NETTUNO=true.

    const REMOVE_NETTUNO = process.env.REMOVE_NETTUNO === 'true';

    const fifo_tot = await count(client, `SELECT COUNT(*) FROM coda_fifo`);
    const fifo_in_coda = await count(client, `SELECT COUNT(*) FROM coda_fifo WHERE status='IN_CODA'`);
    // Bug entries = create dall'auto-entry Sole (nome contiene 'Nettuno auto-Sole')
    const fifo_bug = await count(client,
      `SELECT COUNT(*) FROM coda_fifo WHERE nome LIKE '%Nettuno auto-Sole%'`);
    // Legittime = create dalle uscite L3/L5 (nome contiene 'da URANO 2')
    const fifo_legittime = await count(client,
      `SELECT COUNT(*) FROM coda_fifo WHERE nome LIKE '%(da URANO 2%'`);
    const fifo_cassa_ok = await count(client,
      `SELECT COUNT(*) FROM coda_fifo WHERE lower(wallet)=$1`, [CASSA_REALE]);

    console.log(`  coda_fifo totale:                      ${fifo_tot}`);
    console.log(`  coda_fifo IN_CODA:                     ${fifo_in_coda}`);
    console.log(`  coda_fifo bug (auto-Sole da rimuovere): ${fifo_bug}`);
    console.log(`  coda_fifo legittime (da L3/L5):        ${fifo_legittime}`);
    console.log(`  coda_fifo con wallet CASSA reale:      ${fifo_cassa_ok}`);

    // Dettaglio per tipo
    const fifo_per_tipo = await client.query(
      `SELECT tipo, COUNT(*) AS n FROM coda_fifo GROUP BY tipo ORDER BY tipo`);
    for (const r of fifo_per_tipo.rows) {
      console.log(`    tipo ${r.tipo.padEnd(8)} → ${r.n} posizioni`);
    }

    // Lista entries legittime (da conservare sempre)
    const legittime_rows = await client.query(
      `SELECT posizione, tipo, wallet, nome FROM coda_fifo WHERE nome LIKE '%(da URANO 2%' ORDER BY posizione`);
    if (legittime_rows.rows.length > 0) {
      console.log(`\n  Entries legittime (conservate):`); 
      for (const r of legittime_rows.rows) {
        console.log(`    pos ${r.posizione} ${r.tipo} ${r.wallet.substring(0,14)}… ${r.nome}`);
      }
    }

    if (fifo_bug > 0) {
      if (REMOVE_NETTUNO && !DRY_RUN) {
        // Rimuove SOLO le posizioni create dall'auto-entry Sole (bug).
        // CONSERVA le entries legittime create da hookUscitaL3/hookUscitaL5
        // (nome LIKE '%(da URANO 2%') — queste sono le posizioni Nettuno reali.
        const del = await client.query(
          `DELETE FROM coda_fifo WHERE nome LIKE '%Nettuno auto-Sole%'`);
        console.log(`\n  ✅ RIMOSSI ${del.rowCount} record Nettuno bug (auto-Sole)`);
        // Reset solo rientri_pool (prossima_posizione resta per le entries legittime ancora presenti)
        await client.query(`
          UPDATE state_persistence SET value=jsonb_set(value, '{rientri_pool}', '0')
          WHERE key='fifo_sistema'`);
        console.log(`  ✅ rientri_pool azzerato`);
        // Mostra cosa rimane
        const rimasti = await client.query(
          `SELECT posizione, tipo, nome FROM coda_fifo ORDER BY posizione`);
        console.log(`  Rimaste ${rimasti.rows.length} entries:`);
        for (const r of rimasti.rows) {
          console.log(`    pos ${r.posizione} ${r.tipo} ${r.nome}`);
        }
      } else if (REMOVE_NETTUNO) {
        console.log(`\n  ℹ️  DRY_RUN: verrebbero rimossi ${fifo_bug} record bug (auto-Sole), conservate ${fifo_legittime} legittime`);
      } else {
        console.log(`\n  ⚠️  Nettuno ha ${fifo_bug} bug entries (auto-Sole) da rimuovere.`);
        console.log(`     Per rimuoverle: aggiungere REMOVE_NETTUNO=true`);
        console.log(`     Le ${fifo_legittime} entries legittime (da L3/L5) verranno conservate.`);
      }
    } else if (fifo_in_coda > 0) {
      console.log(`\n  ✅ Nettuno OK — ${fifo_in_coda} entries, tutte legittime (nessuna auto-Sole)`);
    } else {
      console.log(`\n  ✅ Nettuno vuoto — nessuna azione necessaria`);
    }

    // ════════════════════════════════════════════════════════════════
    // § 4. ORO — POSIZIONI MANCANTI (dual sotto-assegnati)
    // ════════════════════════════════════════════════════════════════
    hdr('§ 4. ORO — Diagnosi dual sotto-assegnati (Math.floor → Math.round)');

    // Identifica donazioni in oro (token XAUt0) dove il numero di dual
    // potrebbe essere stato calcolato male con Math.floor.
    // I dati gold nei donazioni pre-fix hanno importo ≈ 0.02 (once) invece di n*20 (USDC).
    // Criterio: donazioni con importo < 1 USDC sono probabilmente oro con valore sbagliato.

    const don_oro_sospette = await client.query(`
      SELECT id, donor_wallet, importo, tx_hash, created_at
      FROM donazioni
      WHERE importo < 1
      ORDER BY created_at ASC`);

    if (don_oro_sospette.rows.length === 0) {
      console.log(`  ✅ Nessuna donazione oro con importo anomalo (< 1 USDC) trovata`);
    } else {
      console.log(`  ⚠️  ${don_oro_sospette.rows.length} donazioni con importo < 1 USDC (probabile oro mal salvato):`);
      for (const d of don_oro_sospette.rows) {
        console.log(`    id=${d.id} wallet=${d.donor_wallet.substring(0,14)}… importo=${d.importo} tx=${d.tx_hash}`);
      }
      console.log(`  ‼️  Per queste donazioni: verificare on-chain quanti dual spettano`);
      console.log(`     e creare manualmente le posizioni mancanti (via /api/admin/registra`);
      console.log(`     o script dedicato con elenco tx → dual attesi dalla mappa definitiva)`);
    }

    // ════════════════════════════════════════════════════════════════
    // § 5. DONAZIONI — SANITY CHECK vs MAPPA
    // ════════════════════════════════════════════════════════════════
    hdr('§ 5. DONAZIONI — Sanity check');

    const don_stats = await client.query(`
      SELECT
        COUNT(*)                             AS tot,
        COUNT(DISTINCT donor_wallet)         AS donatori_unici,
        COALESCE(SUM(importo),0)             AS tot_importo,
        COUNT(*) FILTER (WHERE importo >= 20) AS con_importo_ok,
        COUNT(*) FILTER (WHERE importo < 1)   AS sospette_oro,
        COUNT(*) FILTER (WHERE importo BETWEEN 1 AND 19) AS sospette_parziali
      FROM donazioni WHERE status='COMPLETATA'`);

    const ds = don_stats.rows[0];
    console.log(`  Donazioni COMPLETATE:    ${ds.tot}`);
    console.log(`  Donatori unici:          ${ds.donatori_unici}`);
    console.log(`  Totale importo DB:       ${ds.tot_importo} USDC`);
    console.log(`  Con importo ≥ 20 USDC:   ${ds.con_importo_ok}  (atteso: ~72, le 10 oro avranno importo n×20)`);
    console.log(`  Importo < 1 (oro bug):   ${ds.sospette_oro}`);
    console.log(`  Importo 1–19 (parziali): ${ds.sospette_parziali}`);
    console.log(`\n  Riferimento mappa: 82 donazioni · 75 donatori unici · 2.120 USDC + 193.80 USD oro`);

    // ════════════════════════════════════════════════════════════════
    // § 6. POSIZIONI — Conta per tipo
    // ════════════════════════════════════════════════════════════════
    hdr('§ 6. POSIZIONI — Stato attuale');

    const pos_per_tipo = await client.query(`
      SELECT tipo, COUNT(*) AS n FROM posizioni GROUP BY tipo ORDER BY tipo`);
    for (const r of pos_per_tipo.rows) {
      console.log(`  tipo ${r.tipo.padEnd(12)} → ${r.n}`);
    }

    const pos_cassa = await count(client,
      `SELECT COUNT(*) FROM posizioni WHERE lower(wallet)=$1`, [CASSA_REALE]);
    const pos_fondo = await count(client,
      `SELECT COUNT(*) FROM posizioni WHERE lower(wallet)='0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4'`);
    console.log(`\n  Posizioni wallet CASSA reale: ${pos_cassa}  (atteso: ~116, una per ogni dual)`);
    console.log(`  Posizioni wallet FONDO:       ${pos_fondo}   (atteso: 1, la pos 0)`);

    // ════════════════════════════════════════════════════════════════
    // § 7. COMMIT / ROLLBACK
    // ════════════════════════════════════════════════════════════════

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      hdr('RISULTATO: DRY_RUN — nessuna modifica applicata');
      console.log(`  Per applicare: DATABASE_URL=... APPLY=true node scripts/riconcilia-db.js`);
      console.log(`  Per rimuovere Nettuno: aggiungere anche REMOVE_NETTUNO=true`);
    } else {
      await client.query('COMMIT');
      hdr('RISULTATO: APPLY completato ✅');
      console.log(`  Tutte le correzioni applicate in transazione.`);
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\n❌ ERRORE — rollback eseguito: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
