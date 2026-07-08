/**
 * USDC Backfill - Recupero transazioni mancate
 * 
 * Scansiona i blocchi passati per trovare transfer USDC alla cassa ROG
 * che non sono stati processati (posizioni non create).
 * 
 * Uso:
 *   node usdc-backfill.js [--from-block=XXXXX] [--dry-run]
 *   
 * Oppure da API:
 *   POST /api/admin/backfill-usdc
 */

require('dotenv').config();

const { ethers } = require('ethers');
const { getPolygonProvider } = require('./polygon-provider');
const donationFlowManager = require('./donation-flow-manager');
const statePg = require('./state-persistence-pg');

// Config
const ROG_WALLET = (process.env.ROG_WALLET_ADDRESS || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790').toLowerCase();
const USDC_CONTRACT = process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

const USDC_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Chunk size per query (evita timeout RPC)
const QUERY_CHUNK = 500;

/**
 * Recupera tutte le transazioni USDC mancate in un range di blocchi
 */
async function backfillUSDCTransfers(options = {}) {
  const {
    fromBlock = null,      // Blocco iniziale (default: ultimo processato)
    toBlock = 'latest',    // Blocco finale
    dryRun = false,        // Se true, non processa, solo elenca
    forceReprocess = false // Se true, riprocessa anche tx già processate
  } = options;

  console.log('\n🔄 USDC BACKFILL - Recupero transazioni mancate');
  console.log('='.repeat(50));

  const provider = await getPolygonProvider();
  const usdc = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);

  // Determina range blocchi
  const currentBlock = await provider.getBlockNumber();
  const state = await statePg.getState('usdc_listener', { lastProcessedBlock: 0, processedEventIds: [] });
  
  let startBlock = fromBlock || state.lastProcessedBlock || (currentBlock - 50000); // Default: ultimi ~2 giorni
  let endBlock = toBlock === 'latest' ? currentBlock : Number(toBlock);

  console.log(`📊 Range: blocco ${startBlock} → ${endBlock} (${endBlock - startBlock} blocchi)`);
  console.log(`🎯 Destinazione: ${ROG_WALLET}`);
  console.log(`💎 Contratto USDC: ${USDC_CONTRACT}`);
  console.log(`🔍 Dry run: ${dryRun ? 'SÌ (solo analisi)' : 'NO (processerà donazioni)'}`);
  console.log('');

  const processedIds = new Set(state.processedEventIds || []);
  const foundTransfers = [];
  const processedResults = [];

  // Query a chunk per evitare limiti RPC
  for (let from = startBlock; from <= endBlock; from += QUERY_CHUNK) {
    const to = Math.min(from + QUERY_CHUNK - 1, endBlock);
    
    process.stdout.write(`\r  Scanning blocchi ${from}-${to}...`);

    try {
      // Filter: transfer TO cassa ROG
      const filter = usdc.filters.Transfer(null, ROG_WALLET);
      const events = await usdc.queryFilter(filter, from, to);

      for (const event of events) {
        const eventId = `${event.transactionHash}:${event.logIndex}`;
        const fromAddr = event.args.from.toLowerCase();
        const amount = Number(ethers.utils.formatUnits(event.args.value, 6));

        // Skip se già processato (a meno che forceReprocess)
        if (processedIds.has(eventId) && !forceReprocess) {
          continue;
        }

        foundTransfers.push({
          eventId,
          txHash: event.transactionHash,
          from: fromAddr,
          amount,
          block: event.blockNumber,
          logIndex: event.logIndex,
          alreadyProcessed: processedIds.has(eventId)
        });
      }
    } catch (err) {
      console.error(`\n⚠️ Errore query blocchi ${from}-${to}:`, err.message);
      // Continua con chunk successivo
    }
  }

  console.log(`\n\n📋 Trovate ${foundTransfers.length} transazioni USDC verso cassa ROG`);

  if (foundTransfers.length === 0) {
    console.log('✅ Nessuna transazione mancante da recuperare');
    return { success: true, found: 0, processed: 0, results: [] };
  }

  // Mostra dettagli
  console.log('\n--- Transazioni trovate ---');
  for (const tx of foundTransfers) {
    const status = tx.alreadyProcessed ? '✓ già processata' : '⚠️ DA PROCESSARE';
    console.log(`  ${tx.amount} USDC | ${tx.from.slice(0,10)}... | block ${tx.block} | ${status}`);
    console.log(`    txHash: ${tx.txHash}`);
  }

  // Filtra solo quelle non processate
  const toProcess = foundTransfers.filter(tx => !tx.alreadyProcessed || forceReprocess);
  
  if (toProcess.length === 0) {
    console.log('\n✅ Tutte le transazioni sono già state processate');
    return { success: true, found: foundTransfers.length, processed: 0, results: [] };
  }

  console.log(`\n🔧 ${toProcess.length} transazioni da processare`);

  if (dryRun) {
    console.log('\n⚠️ DRY RUN - Nessuna azione eseguita');
    return { 
      success: true, 
      dryRun: true, 
      found: foundTransfers.length, 
      toProcess: toProcess.length,
      transactions: toProcess 
    };
  }

  // Processa le transazioni mancanti
  console.log('\n🚀 Avvio processamento...\n');

  for (const tx of toProcess) {
    console.log(`\n Processing: ${tx.amount} USDC da ${tx.from.slice(0,10)}...`);
    
    try {
      // Ottieni timestamp dal blocco
      const block = await provider.getBlock(tx.block);
      const timestamp = block?.timestamp 
        ? new Date(block.timestamp * 1000).toISOString() 
        : new Date().toISOString();

      const result = await donationFlowManager.processDonation({
        donationId: tx.eventId,
        donor: tx.from,
        amountUSDC: tx.amount,
        txHash: tx.txHash,
        timestamp,
        donationType: 'standard', // Backfill = sempre standard
        source: 'backfill'
      });

      if (result.success) {
        console.log(`  ✅ Posizioni create: ${result.posizioniCreate || result.positions?.length || 'N/A'}`);
        processedResults.push({ ...tx, success: true, result });
        
        // Aggiorna stato
        processedIds.add(tx.eventId);
      } else {
        console.log(`  ❌ Errore: ${result.error || result.message || 'Sconosciuto'}`);
        processedResults.push({ ...tx, success: false, error: result.error });
      }
    } catch (err) {
      console.error(`  ❌ Eccezione: ${err.message}`);
      processedResults.push({ ...tx, success: false, error: err.message });
    }

    // Pausa per non sovraccaricare
    await new Promise(r => setTimeout(r, 500));
  }

  // Salva stato aggiornato
  await statePg.setState('usdc_listener', {
    lastProcessedBlock: endBlock,
    processedEventIds: Array.from(processedIds).slice(-5000)
  });

  const successCount = processedResults.filter(r => r.success).length;
  const failCount = processedResults.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Backfill completato: ${successCount} OK, ${failCount} errori`);

  return {
    success: true,
    found: foundTransfers.length,
    processed: toProcess.length,
    successCount,
    failCount,
    results: processedResults
  };
}

/**
 * Trova transazioni USDC per un wallet specifico (per debug)
 */
async function findWalletTransactions(walletAddress, options = {}) {
  const { fromBlock = null, limit = 50 } = options;

  const provider = getPolygonProvider();
  const usdc = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);
  const currentBlock = await provider.getBlockNumber();
  const startBlock = fromBlock || (currentBlock - 100000);

  console.log(`\n🔍 Ricerca transazioni USDC per wallet: ${walletAddress}`);
  console.log(`   Range: ${startBlock} → ${currentBlock}`);

  const wallet = walletAddress.toLowerCase();
  const results = [];

  // Cerca transfer IN USCITA dal wallet VERSO cassa ROG
  for (let from = startBlock; from <= currentBlock && results.length < limit; from += QUERY_CHUNK) {
    const to = Math.min(from + QUERY_CHUNK - 1, currentBlock);
    
    try {
      const filter = usdc.filters.Transfer(wallet, ROG_WALLET);
      const events = await usdc.queryFilter(filter, from, to);

      for (const event of events) {
        results.push({
          txHash: event.transactionHash,
          from: event.args.from,
          to: event.args.to,
          amount: Number(ethers.utils.formatUnits(event.args.value, 6)),
          block: event.blockNumber,
          logIndex: event.logIndex
        });
      }
    } catch (err) {
      // Ignora errori singoli chunk
    }
  }

  console.log(`   Trovate: ${results.length} transazioni`);
  return results;
}

// Export per uso come modulo
module.exports = {
  backfillUSDCTransfers,
  findWalletTransactions
};

// Esecuzione CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const forceReprocess = args.includes('--force');
  
  let fromBlock = null;
  const fromArg = args.find(a => a.startsWith('--from-block='));
  if (fromArg) {
    fromBlock = Number(fromArg.split('=')[1]);
  }

  backfillUSDCTransfers({ fromBlock, dryRun, forceReprocess })
    .then(result => {
      console.log('\n📊 Risultato:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('❌ Errore fatale:', err);
      process.exit(1);
    });
}
