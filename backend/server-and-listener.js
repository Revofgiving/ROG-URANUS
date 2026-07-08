require('dotenv').config();

/**
 * 🚀 ROG UNIFIED BACKEND ENTRYPOINT (API + SMART CONTRACT LISTENER)
 *
 * - Avvia il server API Express (api-server.js)
 * - Avvia il listener eventi smart contract (smart-contract-listener.js)
 *
 * Da usare come entrypoint unico in produzione (es. Coolify).
 * Aggiornato: 23 Dicembre 2025 - Tutti i servizi ABILITATI
 */

// ========================================
// INIZIALIZZAZIONE DATABASE
// ========================================

const pgConnectionManager = require('./pg-connection-manager');

async function initializeDatabases() {
  console.log('\n🔌 Inizializzazione database...');
  
  // Tenta inizializzazione PostgreSQL (se disponibile)
  const pgEnabled = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || false;
  
  if (pgEnabled) {
    try {
      await pgConnectionManager.initDatabase();
      console.log('✅ PostgreSQL inizializzato correttamente');
      
      // 🚀 OTTIMIZZAZIONE: Crea indici per scalabilità 10M+ posizioni
      try {
        const dbOptimizer = require('./db-indexes-optimizer');
        await dbOptimizer.createAllIndexes();
        console.log('✅ Indici database ottimizzati per scalabilità');
      } catch (optErr) {
        console.warn('⚠️  Ottimizzazione indici fallita (non bloccante):', optErr.message);
      }
      
    } catch (error) {
      console.warn('⚠️  PostgreSQL non disponibile:', error.message);
      console.log('ℹ️  Fallback a SQLite per operazioni locali');
    }
  } else {
    console.log('ℹ️  PostgreSQL non configurato (DATABASE_URL mancante)');
    console.log('ℹ️  Uso SQLite per sviluppo locale');
  }
}

// Funzione principale async
async function startServer() {
  try {
    // 1. Inizializza database
    await initializeDatabases();
    
    // 2. Avvia il server API (basta require: api-server.js fa già app.listen)
    require('./api-server');
    
    // 3. Avvia smart contract listener
    await startSmartContractListener();
    
    // 4. Avvia USDC incoming listener (opzionale)
    await startUSDCListener();
    
    // 4b. Backfill automatico transazioni USDC mancate (opzionale)
    await runStartupBackfill();
    
    // 5. Avvia worker distribuzioni LARGE
    startLargeDistributionWorker();
    
    // 6. Avvia worker coda donazioni (NUOVO - Scalabilità 600+ donazioni/min)
    startDonationWorker();
    
    console.log('\n✅ ROG Backend completamente avviato\n');
    
  } catch (error) {
    console.error('\n❌ Errore critico durante avvio server:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// ========================================
// SMART CONTRACT LISTENER
// ========================================

async function startSmartContractListener() {
  // Controlla se il listener è abilitato (default: false per evitare connessioni non necessarie)
  const enabled = (process.env.SMART_CONTRACT_LISTENER_ENABLED || 'false').toLowerCase() === 'true';
  
  if (!enabled) {
    console.log('ℹ️  Smart contract listener disabilitato (SMART_CONTRACT_LISTENER_ENABLED!=true)');
    console.log('   Le donazioni sono gestite direttamente dal frontend + API');
    return;
  }
  
  const smartListener = require('./smart-contract-listener');
  
  console.log('\n🔌 Inizializzazione smart contract listener...');
  
  try {
    const ok = await smartListener.initializeContract();
    
    if (ok) {
      smartListener.startListening();
      console.log('✅ Smart contract listener avviato');
    } else {
      console.warn('⚠️  Smart contract listener non disponibile (RPC non raggiungibile)');
      console.warn('   Backend continuerà a funzionare usando SOLO database PostgreSQL');
      console.warn('   Le operazioni di LETTURA (posizioni, invitati) funzioneranno normalmente');
    }
  } catch (error) {
    console.warn('⚠️  Smart contract listener non disponibile:', error.message);
    console.warn('   Backend continuerà a funzionare usando SOLO database PostgreSQL');
    console.warn('   ⚠️  ATTENZIONE: Donazioni/rientri NON verranno processati automaticamente');
  }
}

// ========================================
// USDC INCOMING LISTENER
// ========================================

async function startUSDCListener() {

  const usdcIncomingListener = require('./usdc-incoming-listener');
  const usdcEnabled = (process.env.USDC_INCOMING_LISTENER_ENABLED || 'false').toLowerCase() === 'true';
  
  if (usdcEnabled) {
    try {
      await usdcIncomingListener.start();
      console.log('✅ USDC incoming listener avviato');
    } catch (err) {
      console.error('❌ Impossibile avviare USDC incoming listener:', err.message || err);
    }
  } else {
    console.log('ℹ️ USDC incoming listener disabilitato (USDC_INCOMING_LISTENER_ENABLED=false)');
  }
}

// ========================================
// USDC BACKFILL (STARTUP)
// ========================================

async function runStartupBackfill() {
  const backfillEnabled = (process.env.USDC_BACKFILL_ON_STARTUP || 'true').toLowerCase() === 'true';
  
  if (!backfillEnabled) {
    console.log('ℹ️  USDC backfill all\'avvio disabilitato');
    return;
  }
  
  try {
    const usdcBackfill = require('./usdc-backfill');
    console.log('\n🔄 Avvio backfill automatico transazioni USDC...');
    
    // Backfill degli ultimi ~6 ore (circa 10800 blocchi su Polygon)
    const result = await usdcBackfill.backfillUSDCTransfers({
      fromBlock: null, // Usa ultimo blocco processato
      dryRun: false
    });
    
    if (result.processed > 0) {
      console.log(`✅ Backfill completato: ${result.successCount} donazioni recuperate`);
    } else {
      console.log('✅ Backfill: nessuna transazione mancante');
    }
  } catch (err) {
    console.warn('⚠️  Backfill USDC fallito (non bloccante):', err.message);
  }
}

// ========================================
// LARGE DISTRIBUTION WORKER
// ========================================

function startLargeDistributionWorker() {
  // Il worker LARGE è pesante e dipende da SQLite; per sicurezza lo abilitiamo
  // SOLO quando esplicitamente richiesto tramite variabile ENABLE_LARGE_WORKER=true.
  // In modalità PostgreSQL-only (Coolify) è comunque disabilitato.

  const isPgOnly = process.env.DATABASE_URL && !process.env.ENABLE_SQLITE_WORKER;
  if (isPgOnly) {
    console.log('ℹ️  Large distribution worker disabilitato (PostgreSQL-only mode)');
    return;
  }

  const enabled = (process.env.ENABLE_LARGE_WORKER || '').toLowerCase() === 'true';
  if (!enabled) {
    console.log('ℹ️  Large distribution worker disabilitato (ENABLE_LARGE_WORKER!=true)');
    return;
  }
  
  const largeDistributionWorker = require('./large-distribution-worker');
  largeDistributionWorker.start();
  console.log('✅ Large distribution worker avviato');
}

// ========================================
// DONATION WORKER (NUOVO)
// ========================================

function startDonationWorker() {
  const donationWorker = require('./donation-worker');
  donationWorker.start();
  console.log('✅ Donation queue worker avviato');
}


// ========================================
// AVVIA SERVER
// ========================================

startServer();
