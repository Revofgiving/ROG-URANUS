const PDFDocument = require('pdfkit');
const { ethers } = require('ethers');
const pgConn = require('../../pg-connection-manager');
const statePg = require('../../state-persistence-pg');
const cassaROGManager = require('../../cassa-rog-manager');

const DEFAULT_CONTRACT_ADDRESS = '0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0';
const DEFAULT_RPC_URL = 'https://polygon-rpc.com';
const USDC_DECIMALS = 6;

const REPORT_ABI = [
  'function getContractStats() view returns (uint256 totalDonatedUSDC, uint256 totalDistributedUSDC, uint256 activeDonations, uint256 donationCount, uint256 distributionCount)'
];

// ABI minimale per leggere il saldo USDC direttamente dal token ERC-20
const ERC20_BALANCE_ABI = [
  'function balanceOf(address account) view returns (uint256)'
];

const DEFAULT_USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

const MONTH_NAMES_IT = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre'
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatAmountIT(value, decimals = 2) {
  const n = toNumber(value, 0);
  return n.toLocaleString('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatDateIT(dateLike) {
  if (!dateLike) return '-';
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('it-IT');
}

function parseSafeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeReportPeriod(options = {}) {
  const now = new Date();

  const inputMonth = toNumber(options.month, NaN);
  const inputYear = toNumber(options.year, NaN);
  const hasMonthYear = Number.isInteger(inputMonth) && inputMonth >= 1 && inputMonth <= 12
    && Number.isInteger(inputYear) && inputYear >= 2020 && inputYear <= 2100;

  let startDate;
  let endDate;

  if (hasMonthYear) {
    startDate = new Date(inputYear, inputMonth - 1, 1, 0, 0, 0, 0);
    endDate = new Date(inputYear, inputMonth, 1, 0, 0, 0, 0);
  } else {
    const from = parseSafeDate(options.fromDate);
    const to = parseSafeDate(options.toDate);

    if (from && to && to > from) {
      startDate = from;
      endDate = to;
    } else if (from && !to) {
      startDate = new Date(from.getFullYear(), from.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(from.getFullYear(), from.getMonth() + 1, 1, 0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }
  }

  const monthIndex = startDate.getMonth();
  const year = startDate.getFullYear();

  // Calcola se il periodo copre più di un mese
  const endMonthIndex = endDate.getMonth() === 0 ? 11 : endDate.getMonth() - 1;
  const endYear = endDate.getMonth() === 0 ? endDate.getFullYear() - 1 : endDate.getFullYear();
  const isMultiMonth = (year !== endYear || monthIndex !== endMonthIndex);

  let periodLabel;
  let fileTag;

  if (isMultiMonth) {
    periodLabel = `${MONTH_NAMES_IT[monthIndex]} ${year} - ${MONTH_NAMES_IT[endMonthIndex]} ${endYear}`;
    fileTag = `${year}_${String(monthIndex + 1).padStart(2, '0')}_a_${endYear}_${String(endMonthIndex + 1).padStart(2, '0')}`;
  } else {
    periodLabel = `${MONTH_NAMES_IT[monthIndex]} ${year}`;
    fileTag = `${year}_${String(monthIndex + 1).padStart(2, '0')}`;
  }

  return {
    startDate,
    endDate,
    periodLabel,
    month: monthIndex + 1,
    year,
    fileTag
  };
}

async function collectPostgresStats(startDate, endDate) {
  await pgConn.initDatabase();
  const pool = pgConn.getPool();

  const [
    positionsTotalRes,
    positionsByMovementRes,
    walletsTotalRes,
    donationsPeriodRes,
    donationsByTypeRes
  ] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::INT AS total_positions
      FROM wallet_positions
    `),
    pool.query(`
      SELECT
        movimento,
        COUNT(*)::INT AS total_positions,
        COUNT(DISTINCT wallet)::INT AS unique_wallets
      FROM wallet_positions
      GROUP BY movimento
      ORDER BY movimento
    `),
    pool.query(`
      SELECT COUNT(*)::INT AS total_wallets
      FROM wallet_master
    `),
    pool.query(`
      SELECT
        COUNT(*)::INT AS donations_count,
        COALESCE(SUM(amount_usdc), 0)::TEXT AS total_donated_usdc
      FROM donations
      WHERE COALESCE(ts, created_at) >= $1
        AND COALESCE(ts, created_at) < $2
    `, [startDate.toISOString(), endDate.toISOString()]),
    pool.query(`
      SELECT
        donation_type,
        COUNT(*)::INT AS donations_count,
        COALESCE(SUM(amount_usdc), 0)::TEXT AS total_donated_usdc
      FROM donations
      WHERE COALESCE(ts, created_at) >= $1
        AND COALESCE(ts, created_at) < $2
      GROUP BY donation_type
      ORDER BY donation_type
    `, [startDate.toISOString(), endDate.toISOString()])
  ]);

  let bilancio = null;
  try {
    bilancio = await cassaROGManager.getBilancioComplessivo();
  } catch (error) {
    bilancio = null;
  }

  return {
    totalPositions: toNumber(positionsTotalRes.rows?.[0]?.total_positions, 0),
    positionsByMovement: Array.isArray(positionsByMovementRes.rows)
      ? positionsByMovementRes.rows.map(row => ({
        movimento: row.movimento || 'N/D',
        totalPositions: toNumber(row.total_positions, 0),
        uniqueWallets: toNumber(row.unique_wallets, 0)
      }))
      : [],
    totalWallets: toNumber(walletsTotalRes.rows?.[0]?.total_wallets, 0),
    donationsPeriod: {
      count: toNumber(donationsPeriodRes.rows?.[0]?.donations_count, 0),
      totalUSDC: toNumber(donationsPeriodRes.rows?.[0]?.total_donated_usdc, 0)
    },
    donationsByType: Array.isArray(donationsByTypeRes.rows)
      ? donationsByTypeRes.rows.map(row => ({
        type: row.donation_type || 'standard',
        count: toNumber(row.donations_count, 0),
        totalUSDC: toNumber(row.total_donated_usdc, 0)
      }))
      : [],
    cassa: bilancio
  };
}

async function collectOnChainStats() {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_RPC_URL || DEFAULT_RPC_URL
  );

  const contractAddress = process.env.ROG_CONTRACT_ADDRESS || DEFAULT_CONTRACT_ADDRESS;
  const contract = new ethers.Contract(contractAddress, REPORT_ABI, provider);

  const usdcAddress = process.env.USDC_CONTRACT_ADDRESS || DEFAULT_USDC_ADDRESS;
  const usdcToken = new ethers.Contract(usdcAddress, ERC20_BALANCE_ABI, provider);

  const result = {
    contractAddress,
    available: false,
    totalDonatedUSDC: null,
    totalDistributedUSDC: null,
    contractUSDCBalance: null,
    lastDonationId: null,
    lastDistributionId: null,
    error: null
  };

  try {
    const [stats, usdcBalanceRaw] = await Promise.all([
      contract.getContractStats(),
      usdcToken.balanceOf(contractAddress)
    ]);

    result.available = true;
    result.totalDonatedUSDC = toNumber(ethers.utils.formatUnits(stats.totalDonatedUSDC, USDC_DECIMALS), 0);
    result.totalDistributedUSDC = toNumber(ethers.utils.formatUnits(stats.totalDistributedUSDC, USDC_DECIMALS), 0);
    result.contractUSDCBalance = toNumber(ethers.utils.formatUnits(usdcBalanceRaw, USDC_DECIMALS), 0);
    result.lastDonationId = toNumber(stats.donationCount.toString(), 0);
    result.lastDistributionId = toNumber(stats.distributionCount.toString(), 0);
  } catch (error) {
    result.error = error.message || String(error);
  }

  return result;
}

async function collectVotingStats(startDate, endDate) {
  const votingState = await statePg.getState('voting', {
    votazioniAttive: [],
    votiEspressi: {},
    risultatiStorici: []
  });

  const storico = Array.isArray(votingState.risultatiStorici)
    ? votingState.risultatiStorici
    : [];

  const startTs = startDate.getTime();
  const endTs = endDate.getTime();

  const chiuseNelPeriodo = storico.filter(votazione => {
    const rawDate = votazione?.dataChiusura || votazione?.dataFine || votazione?.createdAt;
    const date = parseSafeDate(rawDate);
    if (!date) return false;
    const ts = date.getTime();
    return ts >= startTs && ts < endTs;
  });

  const formatted = chiuseNelPeriodo
    .map(v => ({
      id: v.id || '-',
      titolo: v.titolo || 'Senza titolo',
      categoria: v.categoria || 'governance',
      dataChiusura: v.dataChiusura || v.dataFine || v.createdAt || null,
      votiTotali: toNumber(v.votiTotali, 0),
      stato: v.stato || 'chiusa',
      vincitore: v.risultato?.vincitore || 'N/D',
      percentuale: v.risultato?.percentuale || '0'
    }))
    .sort((a, b) => new Date(b.dataChiusura || 0) - new Date(a.dataChiusura || 0));

  return {
    activeCount: Array.isArray(votingState.votazioniAttive) ? votingState.votazioniAttive.length : 0,
    closedInPeriodCount: formatted.length,
    closedInPeriod: formatted
  };
}

function createPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `ROG Report ${payload.period.periodLabel}`,
        Author: 'ROG Admin Panel',
        Subject: 'Report periodico movimentazioni'
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ensureSpace = (minHeight = 80) => {
      const limit = doc.page.height - doc.page.margins.bottom;
      if ((doc.y + minHeight) > limit) {
        doc.addPage();
      }
    };

    const sectionTitle = (title) => {
      ensureSpace(40);
      doc.moveDown(0.7);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(title);
      doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).strokeColor('#cbd5e1').stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).fillColor('#111827');
    };

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a').text('ROG - REPORT PERIODICO', { align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).fillColor('#334155').text(`Periodo: ${payload.period.periodLabel}`, { align: 'center' });
    doc.text(`Generato il: ${formatDateIT(new Date())}`, { align: 'center' });

    sectionTitle('1) Riepilogo generale');
    doc.text(`Wallet totali registrati: ${formatAmountIT(payload.postgres.totalWallets, 0)}`);
    doc.text(`Posizioni totali: ${formatAmountIT(payload.postgres.totalPositions, 0)}`);
    doc.text(`Donazioni nel periodo: ${formatAmountIT(payload.postgres.donationsPeriod.count, 0)}`);
    doc.text(`Importo donato nel periodo (DB): ${formatAmountIT(payload.postgres.donationsPeriod.totalUSDC)} USDC`);

    sectionTitle('2) Donazioni per tipologia (periodo selezionato)');
    if (!payload.postgres.donationsByType.length) {
      doc.text('Nessuna donazione trovata nel periodo selezionato.');
    } else {
      for (const row of payload.postgres.donationsByType) {
        ensureSpace(24);
        doc.text(`• ${row.type.toUpperCase()}: ${formatAmountIT(row.count, 0)} donazioni - ${formatAmountIT(row.totalUSDC)} USDC`);
      }
    }

    sectionTitle('3) Posizioni per movimento');
    if (!payload.postgres.positionsByMovement.length) {
      doc.text('Nessun dato disponibile.');
    } else {
      for (const row of payload.postgres.positionsByMovement) {
        ensureSpace(24);
        doc.text(
          `• ${row.movimento}: ${formatAmountIT(row.totalPositions, 0)} posizioni (${formatAmountIT(row.uniqueWallets, 0)} wallet unici)`
        );
      }
    }

    sectionTitle('4) Cassa ROG');
    if (!payload.postgres.cassa) {
      doc.text('Bilancio Cassa ROG non disponibile.');
    } else {
      doc.text(`Saldo complessivo: ${formatAmountIT(payload.postgres.cassa.saldoComplessivo)} €`);
      doc.text(`Entrate totali: ${formatAmountIT(payload.postgres.cassa.totaleEntrate)} €`);
      doc.text(`Uscite totali: ${formatAmountIT(payload.postgres.cassa.totaleUscite)} €`);
      doc.moveDown(0.3);
      const sezioni = payload.postgres.cassa.sezioni || {};
      for (const [sezione, stats] of Object.entries(sezioni)) {
        ensureSpace(20);
        doc.text(`• ${sezione}: saldo ${formatAmountIT(stats.saldo)} €`);
      }
    }

    sectionTitle('5) Dati on-chain smart contract');
    if (!payload.onChain.available) {
      doc.text('Dati on-chain non disponibili al momento.');
      if (payload.onChain.error) {
        doc.fontSize(9).fillColor('#7f1d1d').text(`Errore: ${payload.onChain.error}`);
        doc.fontSize(10).fillColor('#111827');
      }
    } else {
      doc.text(`Contract: ${payload.onChain.contractAddress}`);
      doc.text(`Total Donated (on-chain): ${formatAmountIT(payload.onChain.totalDonatedUSDC)} USDC`);
      doc.text(`Total Distributed (on-chain): ${formatAmountIT(payload.onChain.totalDistributedUSDC)} USDC`);
      doc.text(`USDC Balance contratto: ${formatAmountIT(payload.onChain.contractUSDCBalance)} USDC`);
      doc.text(`Ultimo donationId: ${formatAmountIT(payload.onChain.lastDonationId, 0)}`);
      doc.text(`Ultimo distributionId: ${formatAmountIT(payload.onChain.lastDistributionId, 0)}`);
    }

    sectionTitle('6) Votazioni DAO (chiuse nel periodo)');
    doc.text(`Votazioni attive correnti: ${formatAmountIT(payload.voting.activeCount, 0)}`);
    doc.text(`Votazioni chiuse nel periodo: ${formatAmountIT(payload.voting.closedInPeriodCount, 0)}`);

    if (!payload.voting.closedInPeriod.length) {
      doc.text('Nessuna votazione chiusa nel periodo selezionato.');
    } else {
      doc.moveDown(0.3);
      for (const vote of payload.voting.closedInPeriod.slice(0, 20)) {
        ensureSpace(40);
        doc.font('Helvetica-Bold').text(`• ${vote.titolo}`);
        doc.font('Helvetica').text(
          `  Categoria: ${vote.categoria} | Stato: ${vote.stato} | Voti: ${formatAmountIT(vote.votiTotali, 0)}`
        );
        doc.text(`  Vincitore: ${vote.vincitore} (${vote.percentuale}%)`);
        doc.text(`  Chiusura: ${formatDateIT(vote.dataChiusura)}`);
      }
    }

    doc.moveDown(1.2);
    doc.fontSize(8).fillColor('#64748b').text(
      'Documento generato automaticamente dal pannello admin ROG. Conservare per pubblicazione mensile sul sito.',
      { align: 'center' }
    );

    doc.end();
  });
}

async function generateReportPDF(options = {}) {
  const period = normalizeReportPeriod(options);

  const [postgres, onChain, voting] = await Promise.all([
    collectPostgresStats(period.startDate, period.endDate),
    collectOnChainStats(),
    collectVotingStats(period.startDate, period.endDate)
  ]);

  const payload = { period, postgres, onChain, voting };
  const pdfBuffer = await createPdfBuffer(payload);
  const fileName = `ROG_Report_${period.fileTag}.pdf`;

  return {
    fileName,
    pdfBuffer,
    payload
  };
}

module.exports = {
  generateReportPDF,
  normalizeReportPeriod
};
