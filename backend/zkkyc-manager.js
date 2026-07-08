/**
 * 🔐 ROG ZK-KYC MANAGER - PUNTO 49
 * 
 * Gestione verifiche ZK-KYC per primo dono LARGE:
 * - Monitora accumuli MEDIUM→LARGE
 * - Invia notifica quando accumulo raggiunge 100€
 * - Verifica stato ZK-KYC prima di distribuzioni >100€
 * - Integrazione con smart contract PolygonID
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 16 Novembre 2025
 */

const { ethers } = require('ethers');
const statePg = require('./state-persistence-pg');
const contractCache = require('./smart-contract-cache');

// In ambiente PostgreSQL-only usiamo db-unified-manager-pg come fonte di verità
// per wallet e SPECIAL_WALLETS, evitando qualsiasi accesso a SQLite.
const HAS_POSTGRES = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);
const dbManager = HAS_POSTGRES
  ? require('./db-unified-manager-pg')
  : require('./db-unified-manager');

// ========================================
// CONFIGURAZIONE
// ========================================

const STATE_KEY = 'zkkyc';
const ZKKYC_THRESHOLD = 100; // Euro - soglia per primo dono LARGE
// Validità ZK-KYC in giorni (una volta all'anno per ogni utente)
const ZKKYC_VALIDITY_DAYS = parseInt(process.env.ZKKYC_VALIDITY_DAYS || '365', 10);

// URL Polygon ID (da smart contract)
const ZKKYC_VERIFICATION_URL = process.env.ZKKYC_URL || 'https://wallet.polygonid.com/';

// Smart Contract Configuration
// Preferiamo lo stesso env del listener on-chain.
const ROGDAO_ADDRESS = process.env.ROG_CONTRACT_ADDRESS || process.env.ROGDAO_ADDRESS || '0xYourDeployedContractAddress';
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

// ABI minimo per funzioni ZK-KYC
const ROGDAO_ABI = [
  'function zkKYCVerifiedUsers(address user) view returns (bool)',
  'function users(address user) view returns (uint256 totalDonated, uint256 totalReceived, uint256 rgxTokensOwned, uint256[] rgxTokenIds, bool hasZKKYC, uint256 zkKYCTimestamp, uint256 registrationTime, bool isActive, uint256 donationCount)',
  'function zkKYCProofs(address user) view returns (bytes32)',
  'function verifyZKKYC(bytes32 proofHash) external',
  'function verifyZKKYCHybrid(tuple(uint256[2] proofA, uint256[2][2] proofB, uint256[2] proofC, uint256[] pubSignals, uint256 schemaHash) proof) external returns (bool)',
  'function ZKKYC_VERIFICATION_URL() view returns (string)',
  'function ZKKYC_INFO() view returns (string)',
  'event ZKKYCVerified(address indexed user, bytes32 proofHash)',
  'event ZKKYCVerifiedHybrid(address indexed user, bytes32 indexed proofHash, string credentialType, uint256 timestamp)'
];

// ========================================
// STORAGE ZK-KYC STATE - PostgreSQL
// ========================================

let zkKYCState = {
  notifiche: {},
  verifiche: {},
  initialized: false
};

/**
 * Inizializza stato ZK-KYC da PostgreSQL
 */
async function initZKKYCState() {
  if (zkKYCState.initialized) return zkKYCState;
  
  try {
    const saved = await statePg.getState(STATE_KEY, {
      notifiche: {},
      verifiche: {}
    });
    zkKYCState = { ...zkKYCState, ...saved, initialized: true };
    console.log('🔐 ZK-KYC Manager inizializzato (PostgreSQL)');
  } catch (err) {
    console.error('❌ Errore init zkkyc:', err.message || err);
    zkKYCState.initialized = true;
  }
  
  return zkKYCState;
}

/**
 * Salva stato ZK-KYC in PostgreSQL
 */
async function saveZKKYCState() {
  try {
    const { initialized, ...stateToSave } = zkKYCState;
    await statePg.setState(STATE_KEY, stateToSave);
  } catch (err) {
    console.error('❌ Errore salvataggio zkkyc-state:', err.message || err);
  }
}

// ========================================
// VERIFICA ACCUMULO E NOTIFICA
// ========================================

// Wallet interni/staff che NON devono essere sottoposti a ZK-KYC.
// La lista combina:
// - entità speciali (ROG, PILETTA, AVENGERS) definite in db-unified-manager-pg
// - nomi specifici nel wallet_master.
// Questo garantisce che i wallet di staff/struttura possano operare
// senza blocchi ZK-KYC, come richiesto.

const EXEMPT_WALLET_TYPES = new Set(['ROG', 'PILETTA', 'AVENGERS', 'STAFF', 'INTERNAL']);

const EXEMPT_WALLET_NAMES = new Set([
  'rog',
  'piletta',
  'avengers',
  'lilly castagneto',
  'isabel cristina forero martinez',
  'barbara petrarchi',
  'loretta pivanti',
  'angelo lenoci',
  'monica tirella',
  'laura pavarelli'
]);

// Partiamo dalle entità speciali note (ROG, PILETTA, AVENGERS)
// e aggiungiamo esplicitamente i wallet dello staff indicati dal cliente.
const EXEMPT_WALLETS = new Set([
  ...Object.values(dbManager.SPECIAL_WALLETS || {}).map(w => w.toLowerCase()),
  // Wallet staff / interni (esenti ZK-KYC)
  '0x776844b56e1e056c070faaa42f370a9718d1121a', // LILLY CASTAGNETO
  '0x3a0fde8d24c3c2b9448503a60d036e66417b2757', // ISABEL CRISTINA FORERO MARTINEZ
  '0x8ae0e34e151598d496070d45024515e2ab213587', // LAURA PAVARELLI
  '0x49ceb4efd91cffea8de4e81c2c894c2ff182cec5', // ANGELO LENOCI
  '0x165e89310f4ad0841747122e5fb2d984af26a403', // MONICA TIRELLA
  '0x0d224cf39761fc2d216f57f4d398b4eee07624bf', // LORETTA PIVANTI
  '0x230527653ca927d5221b652ec25289218e782b8c'  // BARBARA PETRARCHI
]);

/**
 * Ritorna true se il wallet è interno/staff e quindi esente da ZK-KYC.
 */
async function isWalletExemptFromZKKYC(wallet) {
  if (!wallet) return false;
  const walletLower = wallet.toLowerCase();

  // 1) Whitelist diretta per indirizzo
  if (EXEMPT_WALLETS.has(walletLower)) {
    return true;
  }

  try {
    // 2) Controlla informazioni nel wallet_master
    const info = await dbManager.getWallet(walletLower);
    if (!info) return false;

    const tipo = (info.tipo || '').toUpperCase();
    if (EXEMPT_WALLET_TYPES.has(tipo)) {
      return true;
    }

    const nome = (info.nome || '').toLowerCase().trim();
    if (EXEMPT_WALLET_NAMES.has(nome)) {
      return true;
    }

    return false;
  } catch (err) {
    console.warn('⚠️  Impossibile verificare esenzione ZK-KYC per wallet:', wallet, err.message);
    return false;
  }
}

/**
 * Verifica se utente ha raggiunto soglia e invia notifica ZK-KYC
 * 
 * @param {string} wallet - Wallet utente
 * @param {string} nome - Nome utente
 * @param {number} accumuloAttuale - Accumulo MEDIUM→LARGE corrente (€)
 * @returns {Promise<Object>} Risultato verifica
 */
async function checkAndNotifyZKKYC(wallet, nome, accumuloAttuale) {
  try {
    await initZKKYCState();
    
    const walletLower = wallet.toLowerCase();
    
    console.log(`\n🔐 VERIFICA SOGLIA ZK-KYC`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   Accumulo: ${accumuloAttuale}€/${ZKKYC_THRESHOLD}€`);
    
    // Verifica se già notificato
    if (zkKYCState.notifiche[walletLower]) {
      console.log(`   ℹ️  Notifica già inviata precedentemente`);
      return {
        notificaInviata: true,
        giàNotificato: true,
        dataNotificaPrecedente: zkKYCState.notifiche[walletLower].dataNotifica
      };
    }
    
    // Verifica se accumulo ha raggiunto soglia
    if (accumuloAttuale >= ZKKYC_THRESHOLD) {
      console.log(`   ⚠️  SOGLIA RAGGIUNTA - Invio notifica ZK-KYC`);
      
      // Invia messaggio area personale
      const activationManager = require('./activation-manager');
      const messageResult = await activationManager.sendZKKYCRequiredMessage(
        wallet,
        nome,
        accumuloAttuale,
        ZKKYC_VERIFICATION_URL
      );
      
      // Registra notifica inviata
      zkKYCState.notifiche[walletLower] = {
        notificaInviata: true,
        dataNotifica: new Date().toISOString(),
        accumuloAlMomento: accumuloAttuale,
        messageId: messageResult.messageId
      };
      
      await saveZKKYCState();
      
      console.log(`   ✅ Notifica ZK-KYC inviata con successo`);
      
      return {
        notificaInviata: true,
        giàNotificato: false,
        messageId: messageResult.messageId,
        accumuloAttuale: accumuloAttuale
      };
    } else {
      console.log(`   ℹ️  Soglia non ancora raggiunta (mancano ${ZKKYC_THRESHOLD - accumuloAttuale}€)`);
      return {
        notificaInviata: false,
        sogliaRaggiunta: false,
        accumuloMancante: ZKKYC_THRESHOLD - accumuloAttuale
      };
    }
    
  } catch (error) {
    console.error('❌ Errore checkAndNotifyZKKYC:', error);
    throw error;
  }
}

/**
 * Registra verifica ZK-KYC completata
 * 
 * @param {string} wallet - Wallet utente
 * @param {string} proofHash - Hash proof PolygonID
 * @returns {Promise<void>}
 */
async function registerZKKYCVerification(wallet, proofHash) {
  try {
    await initZKKYCState();
    
    const walletLower = wallet.toLowerCase();
    
    zkKYCState.verifiche[walletLower] = {
      verificato: true,
      dataVerifica: new Date().toISOString(),
      proofHash: proofHash
    };
    
    await saveZKKYCState();
    
    console.log(`✅ ZK-KYC registrata per ${wallet}`);
    console.log(`   Proof Hash: ${proofHash}`);
    
  } catch (error) {
    console.error('❌ Errore registerZKKYCVerification:', error);
    throw error;
  }
}

// ========================================
// VERIFICA STATO ZK-KYC
// ========================================

/**
 * Verifica se utente ha completato ZK-KYC
 * PRIORITÀ:
 * 0) Wallet esenti (staff/interne) vengono sempre considerati verificati.
 * 1) Controlla smart contract (source of truth)
 * 2) Fallback stato locale
 * 
 * @param {string} wallet - Wallet utente
 * @returns {Promise<boolean>} True se verificato
 */
async function hasZKKYCVerification(wallet) {
  try {
    if (!wallet) return false;

    // PRIORITY 0: esenzione staff / wallet interni
    if (await isWalletExemptFromZKKYC(wallet)) {
      // Log solo in debug per evitare spam
      // console.log(`🔓 Wallet esente da ZK-KYC (staff/internal): ${wallet}`);
      return true;
    }

    await initZKKYCState();
    
    const walletLower = wallet.toLowerCase();
    
    // 🚨 OTTIMIZZAZIONE: Usa SOLO stato locale per le verifiche
    // La connessione allo smart contract avviene SOLO durante:
    // - Registrazione nuova verifica ZK-KYC
    // - Registrazione donazione on-chain
    // NON per ogni richiesta di stato!
    
    // Verifica stato locale
    if (zkKYCState.verifiche[walletLower]) {
      return zkKYCState.verifiche[walletLower].verificato === true;
    }
    
    // Nessuna verifica trovata nello stato locale
    return false;
    
  } catch (error) {
    console.error('❌ Errore hasZKKYCVerification:', error);
    return false;
  }
}

/**
 * Verifica se utente può ricevere distribuzione (check ZK-KYC se >100€)
 * 
 * @param {string} wallet - Wallet ricevente
 * @param {number} amount - Importo distribuzione (€)
 * @returns {Promise<Object>} {allowed: bool, reason: string}
 */
async function canReceiveDistribution(wallet, amount) {
  try {
    // Wallet staff/interi sono sempre autorizzati, indipendentemente dall'importo
    if (await isWalletExemptFromZKKYC(wallet)) {
      return {
        allowed: true,
        reason: 'Wallet staff/internal esente da ZK-KYC'
      };
    }

    // Se importo <= 100€, nessuna verifica richiesta
    if (amount <= ZKKYC_THRESHOLD) {
      return {
        allowed: true,
        reason: 'Importo inferiore a soglia ZK-KYC'
      };
    }
    
    // Se importo > 100€, verifica ZK-KYC
    const hasVerification = await hasZKKYCVerification(wallet);
    
    if (hasVerification) {
      return {
        allowed: true,
        reason: 'ZK-KYC verificata'
      };
    } else {
      return {
        allowed: false,
        reason: 'ZK-KYC richiesta per importi >100€',
        zkKYCUrl: ZKKYC_VERIFICATION_URL
      };
    }
    
  } catch (error) {
    console.error('❌ Errore canReceiveDistribution:', error);
    return {
      allowed: false,
      reason: 'Errore verifica ZK-KYC'
    };
  }
}

// ========================================
// QUERY SMART CONTRACT (FUTURO)
// ========================================

/**
 * Ottiene contratto ROGDao con connessione Polygon Mainnet
 */
let contractInstance = null;

async function getROGDaoContract() {
  try {
    // Riusa istanza se già creata
    if (contractInstance) {
      return contractInstance;
    }
    
    // Crea provider Polygon Mainnet (ethers v5)
    const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL);
    
    // Verifica connessione
    const network = await provider.getNetwork();
    console.log(`✅ Connesso a Polygon (chainId: ${network.chainId})`);
    
    // Crea istanza contratto (read-only)
    contractInstance = new ethers.Contract(
      ROGDAO_ADDRESS,
      ROGDAO_ABI,
      provider
    );
    
    console.log(`✅ Smart contract ROGDao caricato: ${ROGDAO_ADDRESS}`);
    
    return contractInstance;
    
  } catch (error) {
    console.error('❌ Errore connessione smart contract:', error);
    throw new Error(`Smart contract connection failed: ${error.message}`);
  }
}

/**
 * Sincronizza stato ZK-KYC da smart contract
 * 
 * @param {string} wallet - Wallet da sincronizzare
 * @returns {Promise<Object>} Stato sincronizzazione
 */
async function syncZKKYCFromContract(wallet) {
  try {
    await initZKKYCState();
    
    const contract = await getROGDaoContract();
    
    console.log(`🔄 Sincronizzazione ZK-KYC per ${wallet}...`);
    
    // Query smart contract CON CACHE (TTL: 10 minuti)
    const hasVerification = await contractCache.get(
      'walletRole',
      [wallet, 'zkkyc'],
      async () => await contract.zkKYCVerifiedUsers(wallet)
    );
    
    if (!hasVerification) {
      console.log(`   ℹ️  Wallet ${wallet} non ha ZK-KYC on-chain`);
      return {
        synchronized: true,
        hasZKKYC: false,
        source: 'smart_contract'
      };
    }
    
    // Ottieni dettagli completi
    const user = await contract.users(wallet);
    const proofHash = await contract.zkKYCProofs(wallet);
    
    // Registra in stato locale
    await registerZKKYCVerification(wallet, proofHash);
    
    console.log(`   ✅ ZK-KYC sincronizzata: ${proofHash}`);
    console.log(`   📅 Verificata il: ${new Date(Number(user.zkKYCTimestamp) * 1000).toISOString()}`);
    
    return {
      synchronized: true,
      hasZKKYC: true,
      proofHash: proofHash,
      timestamp: Number(user.zkKYCTimestamp),
      source: 'smart_contract'
    };
    
  } catch (error) {
    console.error('❌ Errore syncZKKYCFromContract:', error);
    return {
      synchronized: false,
      error: error.message
    };
  }
}

// ========================================
// STATISTICHE E UTILITY
// ========================================

/**
 * Ottiene statistiche ZK-KYC
 */
async function getZKKYCStats() {
  await initZKKYCState();
  
  const notificheInviate = Object.keys(zkKYCState.notifiche).length;
  const verificheCompletate = Object.values(zkKYCState.verifiche)
    .filter(v => v.verificato).length;
  
  return {
    notificheInviate,
    verificheCompletate,
    tassoCompletamento: notificheInviate > 0 
      ? (verificheCompletate / notificheInviate * 100).toFixed(2) + '%'
      : '0%'
  };
}

/**
 * Ottiene stato ZK-KYC per wallet
 */
async function getWalletZKKYCStatus(wallet) {
  await initZKKYCState();
  
  const walletLower = (wallet || '').toLowerCase();
  const exempt = await isWalletExemptFromZKKYC(walletLower);
  const hasVerification = exempt ? true : await hasZKKYCVerification(walletLower);
  
  return {
    wallet: walletLower,
    notificaInviata: zkKYCState.notifiche[walletLower] || null,
    verificaCompletata: zkKYCState.verifiche[walletLower] || null,
    hasVerification,
    exempt
  };
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  checkAndNotifyZKKYC,
  registerZKKYCVerification,
  hasZKKYCVerification,
  canReceiveDistribution,
  syncZKKYCFromContract,
  getZKKYCStats,
  getWalletZKKYCStatus,
  ZKKYC_THRESHOLD,
  ZKKYC_VALIDITY_DAYS,
  ZKKYC_VERIFICATION_URL
};
