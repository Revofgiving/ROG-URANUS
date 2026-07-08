/**
 * 🚫 ROG BLACKLIST MANAGER
 * 
 * Gestisce la lista di persone bloccate dal ricevere doni.
 * Anche se verificate tramite ZK-KYC, queste persone NON devono
 * ricevere alcun dono in quanto negative e disturbanti.
 * 
 * NOTA: Sistema pseudonimo - i nomi vengono associati ai wallet
 * quando identificati (es. durante ZK-KYC o registrazione).
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 7 Febbraio 2026
 */

const statePg = require('./state-persistence-pg');

// ========================================
// BLACKLIST NOMI (PERMANENTE)
// ========================================

/**
 * Lista nomi blacklistati - queste persone NON possono ricevere doni
 * anche se hanno completato ZK-KYC
 */
const BLACKLISTED_NAMES = [
  'antonio trapasso',
  'antonietta di rienzo',
  'maurizio di rienzo',
  'vincenzo costantino',
  'francesco costantino',
  'giorgia costantino',
  'brunilda metohu'
];

// ========================================
// BLACKLIST WALLET (DINAMICA) - PostgreSQL
// ========================================

const STATE_KEY = 'blacklist';

let blacklistState = {
  wallets: [],
  nameToWallet: {},
  logs: []
};

let initialized = false;

/**
 * Inizializza stato blacklist da PostgreSQL
 */
async function init() {
  if (initialized) return;

  try {
    const saved = await statePg.getState(STATE_KEY, {
      wallets: [],
      nameToWallet: {},
      logs: []
    });
    blacklistState = { ...blacklistState, ...saved };
    initialized = true;
    console.log('🚫 Blacklist Manager inizializzato (PostgreSQL)');
    console.log(`   Nomi blacklistati: ${BLACKLISTED_NAMES.length}`);
    console.log(`   Wallet blacklistati: ${blacklistState.wallets.length}`);
  } catch (err) {
    console.error('❌ Errore init blacklist:', err.message || err);
    initialized = true; // Continua comunque con stato vuoto
  }
}

/**
 * Salva stato in PostgreSQL
 */
async function saveState() {
  await statePg.setState(STATE_KEY, blacklistState);
}

// ========================================
// VERIFICA BLACKLIST
// ========================================

/**
 * Normalizza nome per confronto
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Rimuove accenti
    .replace(/\s+/g, ' ');
}

/**
 * Verifica se un nome è nella blacklist
 * 
 * @param {string} name - Nome da verificare
 * @returns {boolean} True se blacklistato
 */
function isNameBlacklisted(name) {
  const normalizedInput = normalizeName(name);
  
  return BLACKLISTED_NAMES.some(blacklistedName => {
    const normalized = normalizeName(blacklistedName);
    return normalizedInput === normalized || 
           normalizedInput.includes(normalized) ||
           normalized.includes(normalizedInput);
  });
}

/**
 * Verifica se un wallet è nella blacklist
 * 
 * @param {string} wallet - Wallet da verificare
 * @returns {Promise<boolean>} True se blacklistato
 */
async function isWalletBlacklisted(wallet) {
  await init();
  
  const walletLower = String(wallet || '').toLowerCase();
  return blacklistState.wallets.includes(walletLower);
}

/**
 * Verifica se utente può ricevere doni
 * Controlla sia nome che wallet
 * 
 * @param {Object} params - { wallet, nome }
 * @returns {Promise<Object>} { allowed, reason }
 */
async function canReceiveGifts(params) {
  await init();
  
  const { wallet, nome } = params;
  const walletLower = String(wallet || '').toLowerCase();

  // 1. Verifica wallet blacklistato
  if (blacklistState.wallets.includes(walletLower)) {
    return {
      allowed: false,
      reason: 'Wallet nella blacklist - impossibile ricevere doni',
      blacklisted: true
    };
  }

  // 2. Verifica nome blacklistato
  if (nome && isNameBlacklisted(nome)) {
    // Associa wallet al nome per future verifiche
    await associateWalletToName(walletLower, nome);
    
    return {
      allowed: false,
      reason: 'Utente nella blacklist - impossibile ricevere doni',
      blacklisted: true,
      matchedName: nome
    };
  }

  return {
    allowed: true,
    blacklisted: false
  };
}

/**
 * Associa un wallet a un nome blacklistato
 * (per bloccare automaticamente il wallet in futuro)
 */
async function associateWalletToName(wallet, name) {
  await init();
  
  const walletLower = wallet.toLowerCase();
  const nameNorm = normalizeName(name);

  // Se il nome è blacklistato, aggiungi il wallet alla blacklist
  if (isNameBlacklisted(name)) {
    if (!blacklistState.wallets.includes(walletLower)) {
      blacklistState.wallets.push(walletLower);
    }
    
    blacklistState.nameToWallet[nameNorm] = walletLower;
    
    blacklistState.logs.push({
      action: 'AUTO_BLACKLIST',
      wallet: walletLower,
      name: name,
      timestamp: new Date().toISOString(),
      reason: 'Nome corrisponde a persona nella blacklist'
    });

    await saveState();

    console.log(`🚫 BLACKLIST: Wallet ${walletLower} associato a nome blacklistato: ${name}`);
  }
}

// ========================================
// GESTIONE BLACKLIST (ADMIN)
// ========================================

/**
 * Aggiunge wallet alla blacklist manualmente
 * 
 * @param {string} wallet - Wallet da blacklistare
 * @param {string} reason - Motivo
 * @param {string} addedBy - Admin che aggiunge
 */
async function addWalletToBlacklist(wallet, reason, addedBy) {
  await init();
  
  const walletLower = wallet.toLowerCase();
  
  if (!blacklistState.wallets.includes(walletLower)) {
    blacklistState.wallets.push(walletLower);
    
    blacklistState.logs.push({
      action: 'MANUAL_ADD',
      wallet: walletLower,
      reason,
      addedBy,
      timestamp: new Date().toISOString()
    });

    await saveState();
    
    console.log(`🚫 BLACKLIST: Aggiunto wallet ${walletLower}`);
    console.log(`   Motivo: ${reason}`);
    console.log(`   Da: ${addedBy}`);
    
    return { success: true, wallet: walletLower };
  }
  
  return { success: false, reason: 'Wallet già in blacklist' };
}

/**
 * Rimuove wallet dalla blacklist
 * ATTENZIONE: Usare con cautela!
 */
async function removeWalletFromBlacklist(wallet, reason, removedBy) {
  await init();
  
  const walletLower = wallet.toLowerCase();
  const index = blacklistState.wallets.indexOf(walletLower);
  
  if (index > -1) {
    blacklistState.wallets.splice(index, 1);
    
    blacklistState.logs.push({
      action: 'REMOVE',
      wallet: walletLower,
      reason,
      removedBy,
      timestamp: new Date().toISOString()
    });

    await saveState();
    
    console.log(`⚠️  BLACKLIST: Rimosso wallet ${walletLower}`);
    
    return { success: true };
  }
  
  return { success: false, reason: 'Wallet non trovato in blacklist' };
}

/**
 * Ottiene lista completa blacklist
 */
async function getBlacklist() {
  await init();
  
  return {
    names: BLACKLISTED_NAMES,
    wallets: blacklistState.wallets,
    nameToWallet: blacklistState.nameToWallet,
    totalBlocked: BLACKLISTED_NAMES.length + blacklistState.wallets.length
  };
}

/**
 * Ottiene log azioni blacklist
 */
async function getBlacklistLogs() {
  await init();
  return blacklistState.logs;
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  init,
  isNameBlacklisted,
  isWalletBlacklisted,
  canReceiveGifts,
  associateWalletToName,
  addWalletToBlacklist,
  removeWalletFromBlacklist,
  getBlacklist,
  getBlacklistLogs,
  BLACKLISTED_NAMES
};
