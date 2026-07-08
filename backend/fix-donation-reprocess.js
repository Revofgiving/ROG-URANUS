/**
 * 🔧 FIX - REPROCESSING MANUALE DONAZIONI STUCK
 *
 * Usare quando una donazione USDC è confermata on-chain (Status: Success su Polygonscan)
 * ma le posizioni non sono state create nel backend (es. dopo riavvio server).
 *
 * UTILIZZO:
 *   node fix-donation-reprocess.js <txHash>
 *   node fix-donation-reprocess.js <txHash> --dry-run       (solo verifica, non crea posizioni)
 *   node fix-donation-reprocess.js <txHash> --donor <wallet> --amount <usdc>  (forza valori senza RPC)
 *
 * ESEMPI:
 *   node fix-donation-reprocess.js 0x9a3816c084c836e2aa5acc4ad7b1...
 *   node fix-donation-reprocess.js 0xc62e3e7d48de7cc81c704908ac74... --dry-run
 */

require('dotenv').config();

const { ethers } = require('ethers');
const pgConnectionManager = require('./pg-connection-manager');
const donationFlowManager = require('./donation-flow-manager');

// ========================================
// CONFIG
// ========================================

const ROG_WALLET     = (process.env.ROG_WALLET_ADDRESS     || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790').toLowerCase();
const USDC_CONTRACT  = (process.env.USDC_CONTRACT_ADDRESS  || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359').toLowerCase();
const POLYGON_RPC    = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/';

const USDC_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() external view returns (uint8)'
];

// ========================================
// ARGOMENTI CLI
// ========================================

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('Uso: node fix-donation-reprocess.js <txHash> [--dry-run] [--donor <wallet>] [--amount <usdc>]');
  process.exit(0);
}

const txHash   = args[0];
const dryRun   = args.includes('--dry-run');
const forceDonor  = args[args.indexOf('--donor')  + 1] || null;
const forceAmount = args[args.indexOf('--amount') + 1] ? parseFloat(args[args.indexOf('--amount') + 1]) : null;

if (!txHash || !txHash.startsWith('0x')) {
  console.error('❌ txHash non valido. Deve iniziare con 0x');
  process.exit(1);
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('\n🔧 ROG - REPROCESSING MANUALE DONAZIONE');
  console.log('=========================================');
  console.log(`TxHash:  ${txHash}`);
  console.log(`DryRun:  ${dryRun ? 'SÌ (nessuna modifica)' : 'NO (eseguo realmente)'}`);
  console.log('');

  // 1. Inizializza PostgreSQL
  try {
    await pgConnectionManager.initDatabase();
    console.log('✅ PostgreSQL connesso');
  } catch (err) {
    console.error('❌ PostgreSQL non disponibile:', err.message);
    process.exit(1);
  }

  const pool = pgConnectionManager.getPool();

  // 2. Controlla se la donazione esiste già nel DB (idempotenza)
  console.log('\n🔍 STEP 1: Controllo donazione esistente nel DB...');
  const existing = await pool.query(
    `SELECT donation_id, tx_hash, donor_wallet, amount_usdc, donation_type, positions_created, payload
     FROM donations WHERE LOWER(tx_hash) = LOWER($1) LIMIT 1`,
    [txHash]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const payload = row.payload || {};

    console.log(`\n📋 Trovata nel DB:`);
    console.log(`   donation_id:       ${row.donation_id}`);
    console.log(`   donation_type:     ${row.donation_type}`);
    console.log(`   donor_wallet:      ${row.donor_wallet}`);
    console.log(`   amount_usdc:       ${row.amount_usdc}`);
    console.log(`   positions_created: ${row.positions_created}`);
    console.log(`   payload.success:   ${payload.success}`);

    if (payload.success && Number(row.positions_created) > 0) {
      console.log('\n✅ Donazione già processata correttamente. Niente da fare.');
      process.exit(0);
    }

    if (row.donation_type === 'manual-transfer') {
      console.log('\n⚠️  Trovata come manual-transfer (0 posizioni). Procedo al reprocessing...');
    } else if (!payload.success) {
      console.log('\n⚠️  Payload non success. Procedo al reprocessing...');
    } else {
      console.log('\n⚠️  Posizioni_created = 0 nonostante success. Procedo al reprocessing...');
    }
  } else {
    console.log('ℹ️  Donazione NON trovata nel DB. Prima esecuzione.');
  }

  // 3. Recupera dati tx on-chain (oppure usa parametri forzati)
  console.log('\n🔍 STEP 2: Lettura transazione on-chain...');

  let donorWallet, amountUSDC, timestampIso, logIndex;

  if (forceDonor && forceAmount) {
    // Modalità senza RPC (parametri manuali)
    donorWallet  = forceDonor.toLowerCase();
    amountUSDC   = forceAmount;
    timestampIso = new Date().toISOString();
    logIndex     = 0;
    console.log(`⚡ Uso parametri manuali: donor=${donorWallet} amount=${amountUSDC} USDC`);
  } else {
    try {
      const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
      const receipt  = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        console.error('❌ Receipt non trovato. La transazione è confermata su Polygonscan?');
        process.exit(1);
      }

      if (receipt.status !== 1) {
        console.error('❌ Transazione fallita on-chain (status != 1). Non processabile.');
        process.exit(1);
      }

      // Cerca il log Transfer USDC → ROG_WALLET
      const iface = new ethers.utils.Interface(USDC_ABI);
      const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');

      let found = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== USDC_CONTRACT) continue;
        if (log.topics[0] !== transferTopic) continue;

        const decoded = iface.parseLog(log);
        const to = (decoded.args.to || '').toLowerCase();

        if (to !== ROG_WALLET) continue;

        donorWallet  = (decoded.args.from || '').toLowerCase();
        amountUSDC   = parseFloat(ethers.utils.formatUnits(decoded.args.value, 6));
        logIndex     = log.logIndex;

        const block  = await provider.getBlock(receipt.blockNumber);
        timestampIso = block?.timestamp ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();

        found = true;
        break;
      }

      if (!found) {
        console.error('❌ Nessun Transfer USDC verso ROG_WALLET trovato in questa transazione.');
        console.error(`   ROG_WALLET atteso: ${ROG_WALLET}`);
        console.error('   Verifica che sia davvero una donazione ROG.');
        process.exit(1);
      }

      console.log(`✅ Transfer trovato:`);
      console.log(`   Donor:     ${donorWallet}`);
      console.log(`   Amount:    ${amountUSDC} USDC`);
      console.log(`   Timestamp: ${timestampIso}`);
      console.log(`   LogIndex:  ${logIndex}`);

    } catch (err) {
      console.error('❌ Errore lettura on-chain:', err.message);
      console.error('   Prova con --donor <wallet> --amount <usdc> per saltare la lettura RPC');
      process.exit(1);
    }
  }

  // 4. Validazioni
  if (!donorWallet || !/^0x[a-f0-9]{40}$/.test(donorWallet)) {
    console.error('❌ Wallet donatore non valido:', donorWallet);
    process.exit(1);
  }

  if (!Number.isFinite(amountUSDC) || amountUSDC <= 0) {
    console.error('❌ Importo non valido:', amountUSDC);
    process.exit(1);
  }

  if (amountUSDC % 2 !== 0 || !Number.isInteger(amountUSDC)) {
    console.warn(`⚠️  Importo ${amountUSDC} USDC non è multiplo di 2.`);
    console.warn('   ROG richiede donazioni pari (2, 4, 6, ...). Verificare se è corretto.');
    const rounded = Math.floor(amountUSDC / 2) * 2;
    if (rounded <= 0) {
      console.error('❌ Importo arrotondato = 0. Impossibile creare posizioni.');
      process.exit(1);
    }
    console.warn(`   Procedo con ${rounded} USDC (arrotondato al multiplo di 2 inferiore).`);
    amountUSDC = rounded;
  }

  // 5. DRY RUN: mostra cosa farebbe senza eseguire
  if (dryRun) {
    console.log('\n🟡 DRY RUN — Nessuna modifica eseguita.');
    console.log('\n📊 Cosa verrebbe fatto:');
    console.log(`   processDonation({`);
    console.log(`     donationId: "${txHash}:${logIndex || 0}",`);
    console.log(`     donor:      "${donorWallet}",`);
    console.log(`     amountUSDC: ${amountUSDC},`);
    console.log(`     txHash:     "${txHash}",`);
    console.log(`     timestamp:  "${timestampIso}",`);
    console.log(`     donationType: "standard"`);
    console.log(`   })`);
    console.log('\n   Usa senza --dry-run per eseguire realmente.');
    process.exit(0);
  }

  // 6. Esegui reprocessing
  console.log('\n🚀 STEP 3: Esecuzione processDonation...');

  // Costruiamo un donationId univoco derivato da txHash:logIndex
  const donationId = `${txHash.toLowerCase()}:${logIndex || 0}`;

  try {
    const result = await donationFlowManager.processDonation({
      donationId,
      donor:        donorWallet,
      amountUSDC,
      txHash,
      timestamp:    timestampIso,
      donationType: 'standard'
    });

    if (result.success) {
      console.log('\n✅ ==============================');
      console.log('   DONAZIONE REPROCESSATA!');
      console.log('================================');
      console.log(`   Posizioni create:  ${result.donation?.positionsCreated || 0}`);
      console.log(`   Prima posizione:   ${result.donation?.firstPosition}`);
      console.log(`   Ultima posizione:  ${result.donation?.lastPosition}`);
      console.log(`   Tipo:              ${result.donation?.donationType}`);
      if (result.deduped) {
        console.log('   (Nota: deduplicata — era già processata precedentemente)');
      }
    } else {
      console.error('\n❌ processDonation ha fallito:');
      console.error(`   Errore: ${result.error || result.message}`);

      if (result.error === 'COMMUNITY_REGISTRATION_REQUIRED') {
        console.error('\n💡 CAUSA: Il wallet non è iscritto alla community.');
        console.error('   Soluzione: registrare il wallet via /api/register-community prima di riprocessare.');
        console.error(`   Wallet: ${donorWallet}`);
      }

      process.exit(1);
    }

  } catch (err) {
    console.error('\n❌ Eccezione durante processDonation:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Errore fatale:', err);
  process.exit(1);
});
