require('dotenv').config();

/**
 * 🚀 ROG SMART CONTRACT EVENT LISTENER
 * 
 * Ascolta eventi dallo smart contract ROGDao e comunica al backend
 * per creare automaticamente posizioni nell'anagrafica
 * 
 * @author ROG System
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const donationFlowManager = require('./donation-flow-manager');
const dbPg = require('./db-unified-manager-pg');
const { getPolygonProvider } = require('./polygon-provider');

// ========================================
// CONFIGURAZIONE
// ========================================

// Polygon RPC - usa provider con fallback automatico
// (getPolygonProvider tenta tutti gli RPC configurati finché uno funziona)

// Indirizzo smart contract (LIVE su Polygon Mainnet)
const CONTRACT_ADDRESS = process.env.ROG_CONTRACT_ADDRESS || '0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0';

// ABI completo (caricato da file ROGDao-ABI.json)
const ABI_PATH = path.join(__dirname, 'abis', 'ROGDao-ABI.json');
let CONTRACT_ABI;
try {
  CONTRACT_ABI = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
  console.log('✅ ABI completo caricato da ROGDao-ABI.json');
} catch (error) {
  console.error('❌ Errore caricamento ABI, uso ABI essenziale:', error.message);
  // Fallback ABI essenziale
  CONTRACT_ABI = [
    'event DonationRegistered(uint256 indexed donationId, address indexed donor, uint256 amount, uint256 timeout)',
    'event DonationCompleted(uint256 indexed donationId, address indexed donor, uint256 amount, uint256 rgxTokens, bytes32 txHash)',
    'event DonationCancelled(uint256 indexed donationId, address indexed donor, string reason)',
    'event DistributionRegistered(uint256 indexed txId, address indexed recipient, uint256 amount, bytes32 txHash)',
    'function completeDonation(uint256 donationId, bytes32 externalTxHash) external',
    'function registerDistribution(address recipient, uint256 amount, bytes32 externalTxHash) external'
  ];
}

// Conversione USDC → EUR (1.155 USDC = 1 EUR)
const USDC_TO_EUR_RATE = 1.155;

// ========================================
// PROVIDER E CONTRACT
// ========================================

let provider;
let contract;
let backendSigner;

/**
 * Inizializza connessione al contratto
 */
async function initializeContract() {
  try {
    console.log('🔗 Connessione a Polygon (con fallback RPC)...');
    provider = await getPolygonProvider();
    
    console.log(`📜 Contratto: ${CONTRACT_ADDRESS}`);
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    
    // Backend wallet per chiamare completeDonation
    if (process.env.BACKEND_PRIVATE_KEY) {
      const key = process.env.BACKEND_PRIVATE_KEY.trim();
      try {
        if (key.includes(' ')) {
          // Probabile mnemonic (12/24 parole)
          backendSigner = ethers.Wallet.fromPhrase(key).connect(provider);
        } else {
          // Probabile private key esadecimale 0x...
          backendSigner = new ethers.Wallet(key, provider);
        }
        console.log(`✅ Backend wallet: ${backendSigner.address}`);
      } catch (err) {
        console.error('❌ BACKEND_PRIVATE_KEY non valida - funzionerà solo l\'ascolto eventi:', err.message);
      }
    } else {
      console.warn('⚠️  BACKEND_PRIVATE_KEY non configurata - solo ascolto eventi');
    }
    
    console.log('✅ Smart contract connesso');
    return true;
  } catch (error) {
    console.error('❌ Errore inizializzazione contratto:', error.message);
    return false;
  }
}

/**
 * Avvia ascolto eventi
 */
function startListening() {
  if (!contract) {
    console.error('❌ Contratto non inizializzato');
    return;
  }
  
  console.log('👂 Avvio ascolto eventi smart contract...\n');
  
  // ========================================
  // EVENTO: DonationRegistered
  // ========================================
  contract.on('DonationRegistered', async (donationId, donor, amount, timeout, event) => {
    try {
      console.log('\n📥 DONAZIONE REGISTRATA');
      console.log('===================================');
      console.log(`Donation ID: ${donationId}`);
      console.log(`Donatore:    ${donor}`);
      console.log(`Importo:     ${ethers.utils.formatUnits(amount, 6)} USDC`);
      console.log(`Timeout:     ${new Date(Number(timeout) * 1000).toLocaleString()}`);
      console.log(`Block:       ${event.blockNumber}`);
      console.log(`TxHash:      ${event.transactionHash}`);
      
      // Qui potresti fare validazioni aggiuntive o notifiche
      
    } catch (error) {
      console.error('❌ Errore gestione DonationRegistered:', error);
    }
  });
  
  // ========================================
  // EVENTO: DonationCompleted
  // ========================================
  contract.on('DonationCompleted', async (donationId, donor, amount, rgxTokens, txHash, event) => {
    try {
      console.log('\n✅ DONAZIONE COMPLETATA (on-chain)');
      console.log('===================================');
      console.log(`Donation ID: ${donationId}`);
      console.log(`Donatore:    ${donor}`);
      console.log(`Importo:     ${ethers.utils.formatUnits(amount, 6)} USDC`);
      console.log(`Token RGx:   ${rgxTokens}`);
      console.log(`TxHash SC:   ${txHash}`);
      console.log(`Block:       ${event.blockNumber}`);
      console.log(`TxHash:      ${event.transactionHash}`);

      // Persist RGx (source-of-truth: evento on-chain) su PostgreSQL
      // ATTENZIONE: la creazione posizioni / logica donazione è ora gestita
      // UNICAMENTE dal listener USDC (usdc-incoming-listener.js) per evitare
      // doppie elaborazioni. Questo handler registra solo il credito RGx.
      try {
        await dbPg.upsertRGxCreditRecord({
          wallet: donor,
          donationId: String(donationId),
          rgxTokens: Number(rgxTokens),
          chainTxHash: event.transactionHash,
          logIndex: event.logIndex,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('⚠️  Errore persistenza RGx (PG):', e.message || e);
      }
    } catch (error) {
      console.error('❌ Errore gestione DonationCompleted:', error);
    }
  });
  
  // ========================================
  // EVENTO: DonationCancelled
  // ========================================
  contract.on('DonationCancelled', (donationId, donor, reason, event) => {
    console.log('\n❌ DONAZIONE CANCELLATA');
    console.log('===================================');
    console.log(`Donation ID: ${donationId}`);
    console.log(`Donatore:    ${donor}`);
    console.log(`Motivo:      ${reason}`);
    console.log(`Block:       ${event.blockNumber}`);
  });
  
  // ========================================
  // EVENTO: DistributionRegistered
  // ========================================
  contract.on('DistributionRegistered', async (txId, recipient, amount, txHash, event) => {
    try {
      console.log('\n💸 DISTRIBUZIONE REGISTRATA');
      console.log('===================================');
      console.log(`TX ID:       ${txId}`);
      console.log(`Ricevente:   ${recipient}`);
      console.log(`Importo:     ${ethers.utils.formatUnits(amount, 6)} USDC`);
      console.log(`TxHash SC:   ${txHash}`);
      console.log(`Block:       ${event.blockNumber}`);
      console.log(`ChainTxHash: ${event.transactionHash}`);

      // Persistenza "doni ricevuti" per Area Personale su PostgreSQL (da implementare).
      // Per ora registriamo solo un log; la logica di tracciamento doni ricevuti
      // verrà migrata su una tabella dedicata in Postgres.
      const amountUSDC = parseFloat(ethers.utils.formatUnits(amount, 6));

      console.log('ℹ️  DistributionRegistered (PG-only):', {
        recipient,
        amountUSDC,
        txId: String(txId),
        txHash: String(txHash),
        chainTxHash: event.transactionHash
      });
    } catch (error) {
      console.error('❌ Errore gestione DistributionRegistered:', error);
    }
  });
  
  // Gestione errori generali
  contract.on('error', (error) => {
    console.error('\n❌ ERRORE CONTRATTO:', error.message);
  });
  
  console.log('✅ Listener attivo - In ascolto eventi...\n');
}

/**
 * Ferma ascolto eventi
 */
function stopListening() {
  if (contract) {
    contract.removeAllListeners();
    console.log('🛑 Listener fermato');
  }
}

/**
 * Completa donazione dallo smart contract (chiamata dal backend dopo verifica USDC)
 */
async function completeDonationOnChain(donationId, externalTxHash) {
  if (!backendSigner) {
    throw new Error('Backend signer non configurato');
  }
  
  try {
    const contractWithSigner = contract.connect(backendSigner);
    const tx = await contractWithSigner.completeDonation(donationId, externalTxHash);
    console.log(`⏳ Transazione inviata: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`✅ Donazione completata on-chain (block ${receipt.blockNumber})`);
    
    return receipt;
  } catch (error) {
    console.error('❌ Errore completamento donazione:', error);
    throw error;
  }
}

/**
 * Registra distribuzione on-chain
 */
async function registerDistributionOnChain(recipient, amount, externalTxHash) {
  if (!backendSigner) {
    throw new Error('Backend signer non configurato');
  }
  
  try {
    const contractWithSigner = contract.connect(backendSigner);
    const tx = await contractWithSigner.registerDistribution(recipient, amount, externalTxHash);
    console.log(`⏳ Transazione inviata: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`✅ Distribuzione registrata on-chain (block ${receipt.blockNumber})`);
    
    return receipt;
  } catch (error) {
    console.error('❌ Errore registrazione distribuzione:', error);
    throw error;
  }
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  initializeContract,
  startListening,
  stopListening,
  completeDonationOnChain,
  registerDistributionOnChain,
  CONTRACT_ADDRESS,
  USDC_TO_EUR_RATE
};

// ========================================
// AVVIO STANDALONE (se eseguito direttamente)
// ========================================

if (require.main === module) {
  console.log('🚀 ROG SMART CONTRACT LISTENER');
  console.log('=====================================\n');
  
  (async () => {
    const ok = await initializeContract();
    if (ok) {
      startListening();
      
      // Gestione graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n\n🛑 Shutting down...');
        stopListening();
        process.exit(0);
      });
    } else {
      console.error('❌ Impossibile avviare listener');
      process.exit(1);
    }
  })();
}
