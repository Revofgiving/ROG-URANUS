'use strict';

/**
 * 🔎 Audit diagnostico uscite L3 (Venere)
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/audit-uscite-l3-complete.js
 *
 * Solo diagnostica: NON modifica dati, NON invia denaro, NON crea posizioni.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pg = require('../pg-connection-manager');
const { Pool } = require('pg');

function fmt(n) {
  if (n === null || n === undefined) return 'n/a';
  return Number(n).toFixed(2);
}

function normalizeWallet(w) {
  return String(w || '').toLowerCase();
}

function expectedNettoFinale({ tipoAccount, numeroUscitaWallet }) {
  const isPrimaUscitaStoricaFortunato =
    tipoAccount === 'FONDO' && numeroUscitaWallet === 1;
  if (isPrimaUscitaStoricaFortunato) return 500;
  if (['PRIMARIO', 'FONDO', 'CASSA'].includes(tipoAccount)) return 480;
  return 90; // secondari storici (PERPETUO/GEMELLO)
}

const CRITICAL_CODES = new Set([
  'BRIDGE_PENDING_SENZA_TXHASH_OLTRE_30_MIN',
  'TXHASH_SENZA_DONAZIONE_ROG',
  'BRIDGE_AMBIGUO_REQUIRES_RECONCILIATION',
  'POSIZIONI_ROG_INFERIORI_AL_PREVISTO',
  'DONATION_FLOW_NON_COMPLETATO',
  'USCITA_L3_COMPLETATA_SENZA_BRIDGE_COMPLETATO',
  'EVENT_KEY_DUPLICATA_IN_ROG',
  'POSIZIONI_CREATE_SENZA_EVENT_KEY',
  'TXHASH_SENZA_BRIDGE_CORRISPONDENTE',
  'NETTO_L3_DIVERSO_DA_480',
  'CASSA_CON_NETTO_610',
  'FUNZIONI_URANUS_MANCANTI',
  'NETTUNO_POSIZIONI_MANCANTI',
  'PHARAOH_NON_CREATO_O_NON_ACCANTONATO'
]);

function classifySeverity(code) {
  if (CRITICAL_CODES.has(code)) return 'CRITICAL';
  if (code.startsWith('INFO_')) return 'INFO';
  return 'MEDIUM';
}

function normalizeAnomaly(code, ctx) {
  if (code.startsWith('NETTO_FINALE_DIVERSO')) {
    if (ctx.tipoAccount === 'CASSA' && Number(ctx.nettoFinale) === 610) return 'CASSA_CON_NETTO_610';
    if (['PRIMARIO', 'FONDO', 'CASSA'].includes(ctx.tipoAccount)) return 'NETTO_L3_DIVERSO_DA_480';
    return 'NETTO_L3_DIVERSO_DA_480';
  }
  if (code === 'FUNZIONI_ASSENTI' || code === 'FUNZIONI_NON_TRACCIATE') return 'FUNZIONI_URANUS_MANCANTI';
  if (code === 'NETTUNO_ASSENTE') return 'NETTUNO_POSIZIONI_MANCANTI';
  if (code === 'PHARAOH_ASSENTE') return 'PHARAOH_NON_CREATO_O_NON_ACCANTONATO';
  return code;
}

async function main() {
  await pg.testConnection();
  const rogUrl =
    process.env.ROG_DATABASE_URL ||
    process.env.ROG_DATABASE_PUBLIC_URL ||
    process.env.ROG_DATABASE_READONLY_URL ||
    '';
  const rogPool = rogUrl ? new Pool({ connectionString: rogUrl, statement_timeout: 15000 }) : null;

  const uscite = await pg.queryMany(
    `SELECT * FROM storico_avanzamenti WHERE evento = 'USCITA_L3' ORDER BY created_at ASC`
  );
  const bridgeLogs = await pg.queryMany(
    `SELECT * FROM bridge_log WHERE evento = 'USCITA_L3' ORDER BY created_at ASC`
  );
  const usciteL3 = await pg.queryMany(
    `SELECT * FROM uscite_l3 ORDER BY created_at ASC`
  );
  const rogBridgeRows = rogPool
    ? (await rogPool.query(`SELECT * FROM uranus_bridge_events ORDER BY created_at ASC`)).rows
    : [];
  const rogDonations = rogPool
    ? (await rogPool.query(`SELECT * FROM donations ORDER BY created_at ASC`)).rows
    : [];

  const bridgeByWallet = new Map();
  for (const row of bridgeLogs) {
    const w = normalizeWallet(row.wallet);
    if (!bridgeByWallet.has(w)) bridgeByWallet.set(w, []);
    bridgeByWallet.get(w).push(row);
  }

  const usciteL3ByEventKey = new Map();
  for (const row of usciteL3) {
    if (row.event_key) usciteL3ByEventKey.set(row.event_key, row);
  }
  const rogBridgeByEventKey = new Map();
  const rogBridgeEventCounts = new Map();
  for (const row of rogBridgeRows) {
    const key = row.event_key;
    if (key) {
      rogBridgeEventCounts.set(key, (rogBridgeEventCounts.get(key) || 0) + 1);
      if (!rogBridgeByEventKey.has(key)) rogBridgeByEventKey.set(key, row);
    }
  }

  const rogDonationsById = new Map();
  const rogDonationsByTx = new Map();
  for (const row of rogDonations) {
    if (row.donation_id) rogDonationsById.set(row.donation_id, row);
    if (row.tx_hash) rogDonationsByTx.set(String(row.tx_hash).toLowerCase(), row);
  }

  const countByWallet = new Map();
  const allRecords = [];
  const anomaliesByType = new Map();
  const criticalRecords = [];
  let totalConformi = 0;
  let totalConAnomalie = 0;
  let totalCritical = 0;
  let totalMedium = 0;
  let totalInfo = 0;
  let totalRogCompleted = 0;
  let totalRogPending = 0;
  let totalRogRecon = 0;
  let totalPosizioniRogAttese = 0;
  let totalPosizioniRogCreate = 0;
  let totalNettunoMancanti = 0;
  let totalFunzioniMancanti = 0;
  let totalPharaohMancanti = 0;
  let totalPayoutDiversi480 = 0;
  let totalEccezioniFortunato = 0;

  console.log('══════════════════════════════════════════════');
  console.log('🔎 AUDIT USCITE L3 — DIAGNOSTICA');
  console.log(`Totale uscite L3: ${uscite.length}`);
  console.log('══════════════════════════════════════════════\n');

  for (const uscita of uscite) {
    const wallet = normalizeWallet(uscita.wallet);
    const tipoAccount = uscita.tipo_account || 'PRIMARIO';
    const turno = uscita.turno;
    const numeroUscitaWallet = (countByWallet.get(wallet) || 0) + 1;
    countByWallet.set(wallet, numeroUscitaWallet);

    const eventKey = `rog-l3-turno-${turno}-${wallet}`;
    const uscitaL3 = usciteL3ByEventKey.get(eventKey);
    const bridge = (bridgeByWallet.get(wallet) || [])[numeroUscitaWallet - 1];
    const rogBridge = rogBridgeByEventKey.get(eventKey);
    const rogBridgeDupCount = rogBridgeEventCounts.get(eventKey) || 0;

    const nettoFinale = uscitaL3?.netto_inviato ?? bridge?.netto_finale ?? null;
    const nettoAtteso = expectedNettoFinale({ tipoAccount, numeroUscitaWallet });

    const anomalies = [];

    if (nettoFinale !== null && Number(nettoFinale) !== Number(nettoAtteso)) {
      anomalies.push(`NETTO_FINALE_DIVERSO (${fmt(nettoFinale)} != ${fmt(nettoAtteso)})`);
    }

    const funzioniOk = uscitaL3?.funzioni ? true : null;
    const rogOk = uscitaL3?.rog?.status === 'COMPLETED';
    const nettunoOk = !!uscitaL3?.nettuno;
    const pharaohOk = !!uscitaL3?.pharaoh;

    if (funzioniOk === false) anomalies.push('FUNZIONI_ASSENTI');
    if (funzioniOk === null) anomalies.push('FUNZIONI_NON_TRACCIATE');
    if (!rogOk && ['PRIMARIO', 'FONDO', 'CASSA'].includes(tipoAccount)) anomalies.push('ROG_NON_CONFERMATO');
    if (!nettunoOk) anomalies.push('NETTUNO_ASSENTE');
    if (!pharaohOk && ['PRIMARIO', 'FONDO', 'CASSA'].includes(tipoAccount)) anomalies.push('PHARAOH_ASSENTE');
    if (rogBridgeDupCount > 1) anomalies.push('EVENT_KEY_DUPLICATA_IN_ROG');

    if (!rogBridge) {
      anomalies.push('ROG_BRIDGE_ASSENTE');
    } else {
      if (rogBridge.status === 'COMPLETED') totalRogCompleted += 1;
      if (rogBridge.status === 'PENDING') totalRogPending += 1;
      if (rogBridge.status === 'REQUIRES_RECONCILIATION') totalRogRecon += 1;
      const createdAt = rogBridge.created_at ? new Date(rogBridge.created_at) : null;
      const ageMin = createdAt ? (Date.now() - createdAt.getTime()) / 60000 : null;
      if (rogBridge.status === 'PENDING' && !rogBridge.tx_hash && ageMin !== null && ageMin > 30) {
        anomalies.push('BRIDGE_PENDING_SENZA_TXHASH_OLTRE_30_MIN');
      }

      const txHash = rogBridge.tx_hash ? String(rogBridge.tx_hash).toLowerCase() : null;
      const donation = rogBridge.donation_id
        ? rogDonationsById.get(rogBridge.donation_id)
        : (txHash ? rogDonationsByTx.get(txHash) : null);

      if (txHash && !donation) {
        anomalies.push('TXHASH_SENZA_DONAZIONE_ROG');
      }
      if (rogBridge.status === 'FUNDS_RECEIVED') {
        anomalies.push('FUNDS_RECEIVED_SENZA_COMPLETION');
      }
      if (rogBridge.status === 'REQUIRES_RECONCILIATION') {
        anomalies.push('BRIDGE_AMBIGUO_REQUIRES_RECONCILIATION');
      }
      if (donation && !donation.payload?.success) {
        anomalies.push('DONATION_FLOW_NON_COMPLETATO');
      }

      const posAttese = Number(rogBridge.posizioni_attese) || 0;
      const posizioni = Array.isArray(rogBridge.posizioni) ? rogBridge.posizioni : null;
      totalPosizioniRogAttese += posAttese * 2;
      totalPosizioniRogCreate += posizioni ? posizioni.length : 0;
      if (posAttese > 0 && (!posizioni || posizioni.length < posAttese * 2)) {
        anomalies.push('POSIZIONI_ROG_INFERIORI_AL_PREVISTO');
      }

      if (uscitaL3?.status === 'COMPLETED' && rogBridge.status !== 'COMPLETED') {
        anomalies.push('USCITA_L3_COMPLETATA_SENZA_BRIDGE_COMPLETATO');
      }
    }

    if (tipoAccount === 'FONDO' && numeroUscitaWallet === 1) {
      // whitelist eccezione storica: non segnaliamo il 500
      if (anomalies[0]?.startsWith('NETTO_FINALE_DIVERSO')) {
        anomalies.shift();
      }
      totalEccezioniFortunato += 1;
    }

    const statoComplessivo = uscitaL3?.status || 'NON_TRACCIATO';
    const azione = anomalies.length ? 'VERIFICA MANUALE / RICONCILIAZIONE' : 'OK';

    console.log(`USCITA #${numeroUscitaWallet} — wallet=${wallet} tipo=${tipoAccount} turno=${turno} data=${uscita.created_at}`);
    console.log(`  lordo=${fmt(uscita.doni_ricevuti)} trattenuta=${fmt(uscita.doni_trattenuti)} netto_registrato=${fmt(uscita.netto)} netto_finale=${fmt(nettoFinale)} atteso=${fmt(nettoAtteso)}`);
    console.log(`  funzioni=${funzioniOk === null ? 'n/a' : funzioniOk ? 'ok' : 'no'} rog=${rogOk ? 'ok' : 'no'} nettuno=${nettunoOk ? 'ok' : 'no'} pharaoh=${pharaohOk ? 'ok' : 'no'} status=${statoComplessivo}`);
    if (rogBridge) {
      console.log(`  ROG bridge: status=${rogBridge.status} event_key=${rogBridge.event_key} tx=${rogBridge.tx_hash || 'n/a'} importo=${fmt(rogBridge.importo_ricevuto)} utilizzato=${fmt(rogBridge.importo_utilizzato)} pos_attese=${rogBridge.posizioni_attese || 0}`);
    }
    console.log(`  anomalie=${anomalies.length ? anomalies.join(', ') : 'nessuna'} | azione=${azione}`);
    console.log('');
    if (!nettunoOk) totalNettunoMancanti += 1;
    if (funzioniOk !== true) totalFunzioniMancanti += 1;
    if (!pharaohOk && ['PRIMARIO', 'FONDO', 'CASSA'].includes(tipoAccount)) totalPharaohMancanti += 1;
    if (['PRIMARIO', 'FONDO', 'CASSA'].includes(tipoAccount) && Number(nettoFinale) !== 480) {
      totalPayoutDiversi480 += 1;
    }

    const normalized = anomalies.map((a) => normalizeAnomaly(a, { tipoAccount, nettoFinale }));
    const record = {
      event_key: eventKey,
      wallet,
      tipo_account: tipoAccount,
      turno,
      data: uscita.created_at,
      netto_atteso: nettoAtteso,
      netto_registrato: uscita.netto ?? null,
      netto_inviato: nettoFinale,
      uscita_status: statoComplessivo,
      rog_status: rogBridge?.status || null,
      rog_tx_hash: rogBridge?.tx_hash || null,
      rog_donation_id: rogBridge?.donation_id || null,
      rog_posizioni_attese: rogBridge?.posizioni_attese || 0,
      rog_posizioni_create: Array.isArray(rogBridge?.posizioni) ? rogBridge.posizioni.length : 0,
      anomalies: normalized
    };
    allRecords.push(record);

    if (normalized.length === 0) {
      totalConformi += 1;
    } else {
      totalConAnomalie += 1;
      for (const code of normalized) {
        anomaliesByType.set(code, (anomaliesByType.get(code) || 0) + 1);
        const severity = classifySeverity(code);
        if (severity === 'CRITICAL') totalCritical += 1;
        if (severity === 'MEDIUM') totalMedium += 1;
        if (severity === 'INFO') totalInfo += 1;
        if (severity === 'CRITICAL') {
          criticalRecords.push({
            anomaly: code,
            severity,
            event_key: eventKey,
            posizione: numeroUscitaWallet,
            wallet,
            turno,
            data: uscita.created_at,
            importo_previsto: nettoAtteso,
            importo_registrato: uscita.netto ?? null,
            importo_inviato: nettoFinale,
            tx_hash: rogBridge?.tx_hash || null,
            donation_id: rogBridge?.donation_id || null,
            posizioni_attese: rogBridge?.posizioni_attese || 0,
            posizioni_create: Array.isArray(rogBridge?.posizioni) ? rogBridge.posizioni.length : 0,
            stato_uranus: statoComplessivo,
            stato_rog: rogBridge?.status || null,
            azione_correttiva: 'RICONCILIAZIONE_MANUALE'
          });
        }
      }
    }
  }

  if (rogPool) {
    const rogueDonations = rogDonations.filter((d) => {
      const src = d.payload?.source || d.payload?.eventKey || '';
      return String(src).toUpperCase().includes('URANUS');
    });
    const bridgeKeys = new Set(rogBridgeRows.map((r) => r.event_key).filter(Boolean));
    const donationsWithoutBridge = rogueDonations.filter((d) => {
      const key = d.donation_id || d.payload?.eventKey;
      return !key || !bridgeKeys.has(key);
    });
    const rogueWithoutEventKey = rogueDonations.filter((d) => !d.donation_id);
    if (rogueWithoutEventKey.length > 0) {
      console.log(`⚠️ POSIZIONI_CREATE_SENZA_EVENT_KEY: ${rogueWithoutEventKey.length}`);
      anomaliesByType.set(
        'POSIZIONI_CREATE_SENZA_EVENT_KEY',
        (anomaliesByType.get('POSIZIONI_CREATE_SENZA_EVENT_KEY') || 0) + rogueWithoutEventKey.length
      );
      totalCritical += rogueWithoutEventKey.length;
    }
    if (donationsWithoutBridge.length > 0) {
      console.log(`⚠️ TXHASH_SENZA_BRIDGE_CORRISPONDENTE: ${donationsWithoutBridge.length}`);
      anomaliesByType.set(
        'TXHASH_SENZA_BRIDGE_CORRISPONDENTE',
        (anomaliesByType.get('TXHASH_SENZA_BRIDGE_CORRISPONDENTE') || 0) + donationsWithoutBridge.length
      );
      totalCritical += donationsWithoutBridge.length;
    }
    await rogPool.end();
  }

  const summary = {
    uscite_analizzate: uscite.length,
    uscite_conformi: totalConformi,
    uscite_con_anomalie: totalConAnomalie,
    anomalie_totali: totalCritical + totalMedium + totalInfo,
    anomalie_critiche: totalCritical,
    anomalie_medie: totalMedium,
    anomalie_informative: totalInfo,
    bridge_rog_completati: totalRogCompleted,
    bridge_rog_pending: totalRogPending,
    bridge_rog_in_riconciliazione: totalRogRecon,
    posizioni_rog_previste: totalPosizioniRogAttese,
    posizioni_rog_create: totalPosizioniRogCreate,
    posizioni_rog_mancanti: Math.max(0, totalPosizioniRogAttese - totalPosizioniRogCreate),
    posizioni_nettuno_mancanti: totalNettunoMancanti,
    funzioni_uranus_mancanti: totalFunzioniMancanti,
    pharaoh_mancanti_o_non_accantonati: totalPharaohMancanti,
    payout_diversi_da_480: totalPayoutDiversi480,
    eccezioni_fortunato_500_valide: totalEccezioniFortunato
  };

  const anomaliesByTypeObj = {};
  for (const [key, value] of anomaliesByType.entries()) {
    anomaliesByTypeObj[key] = value;
  }

  const report = {
    summary,
    anomalies_by_type: anomaliesByTypeObj,
    critical_records: criticalRecords,
    all_records: allRecords
  };

  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const reportPath = path.join(reportsDir, `audit-uscite-l3-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n## RIEPILOGO GENERALE');
  console.log(`- totale uscite L3 analizzate: ${summary.uscite_analizzate}`);
  console.log(`- totale uscite conformi: ${summary.uscite_conformi}`);
  console.log(`- totale uscite con anomalie: ${summary.uscite_con_anomalie}`);
  console.log(`- totale anomalie critiche: ${summary.anomalie_critiche}`);
  console.log(`- totale anomalie medie: ${summary.anomalie_medie}`);
  console.log(`- totale anomalie informative: ${summary.anomalie_informative}`);
  console.log(`- totale bridge ROG completati: ${summary.bridge_rog_completati}`);
  console.log(`- totale bridge ROG pending: ${summary.bridge_rog_pending}`);
  console.log(`- totale bridge ROG in riconciliazione: ${summary.bridge_rog_in_riconciliazione}`);
  console.log(`- totale posizioni Small ROG previste: ${summary.posizioni_rog_previste}`);
  console.log(`- totale posizioni Small ROG realmente create: ${summary.posizioni_rog_create}`);
  console.log(`- differenza totale posizioni ROG mancanti: ${summary.posizioni_rog_mancanti}`);
  console.log(`- totale posizioni Nettuno mancanti: ${summary.posizioni_nettuno_mancanti}`);
  console.log(`- totale funzioni URANUS mancanti: ${summary.funzioni_uranus_mancanti}`);
  console.log(`- totale PHARAOH mancanti o non accantonati: ${summary.pharaoh_mancanti_o_non_accantonati}`);
  console.log(`- totale payout diversi da 480 USDC: ${summary.payout_diversi_da_480}`);
  console.log(`- totale eccezioni storiche Fortunato/FONDO valide a 500 USDC: ${summary.eccezioni_fortunato_500_valide}`);

  console.log('\n## CONTEGGIO ANOMALIE PER TIPO');
  for (const key of [
    'BRIDGE_PENDING_SENZA_TXHASH_OLTRE_30_MIN',
    'TXHASH_SENZA_DONAZIONE_ROG',
    'BRIDGE_AMBIGUO_REQUIRES_RECONCILIATION',
    'POSIZIONI_ROG_INFERIORI_AL_PREVISTO',
    'DONATION_FLOW_NON_COMPLETATO',
    'USCITA_L3_COMPLETATA_SENZA_BRIDGE_COMPLETATO',
    'EVENT_KEY_DUPLICATA_IN_ROG',
    'POSIZIONI_CREATE_SENZA_EVENT_KEY',
    'TXHASH_SENZA_BRIDGE_CORRISPONDENTE',
    'NETTO_L3_DIVERSO_DA_480',
    'CASSA_CON_NETTO_610',
    'FUNZIONI_URANUS_MANCANTI',
    'NETTUNO_POSIZIONI_MANCANTI',
    'PHARAOH_NON_CREATO_O_NON_ACCANTONATO'
  ]) {
    console.log(`- ${key}: ${anomaliesByTypeObj[key] || 0}`);
  }

  console.log('\n## DETTAGLIO RECORD CRITICI');
  for (const row of criticalRecords) {
    console.log(`- ${row.anomaly} (${row.severity}) event_key=${row.event_key} wallet=${row.wallet} turno=${row.turno} data=${row.data} importo_previsto=${fmt(row.importo_previsto)} importo_registrato=${fmt(row.importo_registrato)} importo_inviato=${fmt(row.importo_inviato)} tx_hash=${row.tx_hash || 'n/a'} donation_id=${row.donation_id || 'n/a'} pos_attese=${row.posizioni_attese} pos_create=${row.posizioni_create} stato_uranus=${row.stato_uranus} stato_rog=${row.stato_rog || 'n/a'} azione=${row.azione_correttiva}`);
  }

  const dateLabel = stamp.slice(0, 10);
  const timeLabel = stamp.slice(11).replace(/-/g, ':');
  console.log(`\nAUDIT URANUS L3 — generato il ${dateLabel} alle ${timeLabel}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Uscite analizzate: ${summary.uscite_analizzate}`);
  console.log(`Conformi: ${summary.uscite_conformi}`);
  console.log(`Anomalie totali: ${summary.anomalie_totali}`);
  console.log(`Anomalie critiche: ${summary.anomalie_critiche}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Audit fallito:', err.message);
    process.exit(1);
  });
