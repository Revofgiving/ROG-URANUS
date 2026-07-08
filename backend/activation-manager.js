/**
 * 🚀 ROG ACTIVATION MANAGER - ATTIVAZIONE AUTOMATICA AREA PERSONALE
 * 
 * Quando l'anagrafica viene aggiornata con nuovi iscritti:
 * 1. Attiva immediatamente l'area personale
 * 2. Invia messaggio nella messaggistica con posizioni ottenute
 * 
 * @author Warp AI Agent
 * @version 1.0.0 - NASA Precision
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ========================================
// CONFIGURAZIONE PERCORSI
// ========================================

const BASE_DIR = path.join(__dirname, '..');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_DATA_FILE = path.join(__dirname, 'users-data.json');
const ACTIVE_USERS_FILE = path.join(__dirname, 'active-users.json');

// ========================================
// INIZIALIZZAZIONE FILE
// ========================================

function initializeActivationFiles() {
  // Crea active-users.json se non esiste
  if (!fsSync.existsSync(ACTIVE_USERS_FILE)) {
    fsSync.writeFileSync(ACTIVE_USERS_FILE, JSON.stringify({}, null, 2));
    console.log('✅ File active-users.json creato');
  }
  
  // Verifica esistenza messages.json
  if (!fsSync.existsSync(MESSAGES_FILE)) {
    fsSync.writeFileSync(MESSAGES_FILE, JSON.stringify({ messages: [] }, null, 2));
    console.log('✅ File messages.json creato');
  }
  
  // Verifica esistenza users-data.json
  if (!fsSync.existsSync(USERS_DATA_FILE)) {
    fsSync.writeFileSync(USERS_DATA_FILE, JSON.stringify({}, null, 2));
    console.log('✅ File users-data.json creato');
  }
}

// ========================================
// GESTIONE UTENTI ATTIVI
// ========================================

/**
 * Attiva area personale per un utente
 * @param {string} wallet - Wallet address dell'utente
 * @param {string} nome - Nome dell'utente
 * @returns {Promise<Object>}
 */
async function activateUserArea(wallet, nome) {
  try {
    const walletLower = wallet.toLowerCase();
    
    // Leggi utenti attivi
    const activeUsersData = await fs.readFile(ACTIVE_USERS_FILE, 'utf8');
    const activeUsers = JSON.parse(activeUsersData);
    
    // Verifica se già attivo
    if (activeUsers[walletLower]) {
      console.log(`ℹ️  Utente ${nome} (${wallet}) già attivo`);
      return {
        success: true,
        alreadyActive: true,
        wallet: walletLower,
        activatedAt: activeUsers[walletLower].activatedAt
      };
    }
    
    // Attiva utente
    activeUsers[walletLower] = {
      wallet: walletLower,
      nome: nome,
      activatedAt: new Date().toISOString(),
      status: 'active'
    };
    
    // Salva
    await fs.writeFile(ACTIVE_USERS_FILE, JSON.stringify(activeUsers, null, 2));
    
    console.log(`✅ Area personale ATTIVATA per ${nome} (${wallet})`);
    
    return {
      success: true,
      alreadyActive: false,
      wallet: walletLower,
      nome: nome,
      activatedAt: activeUsers[walletLower].activatedAt
    };
    
  } catch (error) {
    console.error('❌ Errore attivazione area personale:', error);
    throw error;
  }
}

/**
 * Verifica se un utente ha l'area personale attiva
 * @param {string} wallet - Wallet address
 * @returns {Promise<boolean>}
 */
async function isUserActive(wallet) {
  try {
    const walletLower = wallet.toLowerCase();
    const activeUsersData = await fs.readFile(ACTIVE_USERS_FILE, 'utf8');
    const activeUsers = JSON.parse(activeUsersData);
    
    return !!activeUsers[walletLower];
  } catch (error) {
    console.error('❌ Errore verifica utente attivo:', error);
    return false;
  }
}

// ========================================
// GESTIONE MESSAGGI
// ========================================

/**
 * Invia messaggio di benvenuto con posizioni ottenute
 * @param {string} wallet - Wallet destinatario
 * @param {string} nome - Nome destinatario
 * @param {Array} posizioni - Array di posizioni create [{human: N, piletta: N}]
 * @returns {Promise<Object>}
 */
async function sendPositionsMessage(wallet, nome, posizioni) {
  try {
    const walletLower = wallet.toLowerCase();
    
    // Leggi messaggi esistenti
    const messagesData = await fs.readFile(MESSAGES_FILE, 'utf8');
    const data = JSON.parse(messagesData);
    const messages = data.messages || [];
    
    // Prepara lista posizioni per il messaggio (SOLO HUMAN, non PILETTA)
    const posizioniNumeri = posizioni.map(p => `n°${p.human}`).join(', ');
    const totalePosizioni = posizioni.length; // Solo posizioni HUMAN
    
    // Crea messaggio
    const message = {
      id: uuidv4(),
      recipient: walletLower,
      sender: 'system',
      subject: '🎉 Complimenti! Posizioni Ottenute',
      content: `Complimenti ${nome}! Hai ottenuto le seguenti posizioni: ${posizioniNumeri}.\n\nTotale: ${totalePosizioni} posizioni\n\nLe tue posizioni sono ora attive nel sistema ROG e inizieranno a generare cicli di donazioni.\n\nBuon inizio della tua avventura in Revolution of Giving! 🚀`,
      timestamp: new Date().toISOString(),
      read: false,
      type: 'position_notification',
      priority: 'high',
      metadata: {
        posizioniHuman: posizioni.map(p => p.human),
        totalePosizioni: totalePosizioni,
        numeroCoppie: posizioni.length
      }
    };
    
    // Aggiungi messaggio
    messages.push(message);
    
    // Salva
    await fs.writeFile(MESSAGES_FILE, JSON.stringify({ messages }, null, 2));
    
    console.log(`✅ Messaggio inviato a ${nome} (${wallet})`);
    console.log(`   Posizioni: ${posizioniNumeri}`);
    
    return {
      success: true,
      messageId: message.id,
      wallet: walletLower,
      posizioni: posizioni,
      timestamp: message.timestamp
    };
    
  } catch (error) {
    console.error('❌ Errore invio messaggio posizioni:', error);
    throw error;
  }
}

/**
 * Invia messaggio ZK-KYC richiesta (Punto 49)
 * @param {string} wallet - Wallet destinatario
 * @param {string} nome - Nome destinatario
 * @param {number} accumuloAttuale - Accumulo MEDIUM→LARGE corrente
 * @param {string} zkKYCUrl - URL verifica Polygon ID
 * @returns {Promise<Object>}
 */
async function sendZKKYCRequiredMessage(wallet, nome, accumuloAttuale, zkKYCUrl) {
  try {
    const walletLower = wallet.toLowerCase();
    
    // Leggi messaggi esistenti
    const messagesData = await fs.readFile(MESSAGES_FILE, 'utf8');
    const data = JSON.parse(messagesData);
    const messages = data.messages || [];
    
    // Crea messaggio
    const message = {
      id: uuidv4(),
      recipient: walletLower,
      sender: 'system',
      subject: '⚠️ VERIFICA ZK-KYC RICHIESTA - Primo Dono LARGE',
      content: `Attenzione ${nome}!\n\nIl tuo accumulo MEDIUM→LARGE ha raggiunto ${accumuloAttuale}€ su 100€ necessari per la transizione.\n\n🔒 VERIFICA IDENTITÀ OBBLIGATORIA\nPer ricevere il tuo primo dono in movimento LARGE (superiore a 100€), è necessario completare la verifica ZK-KYC tramite Polygon ID.\n\n👉 CLICCA QUI PER VERIFICARE:\n${zkKYCUrl}\n\n⚠️ IMPORTANTE:\n- La verifica è obbligatoria per legge (soglia >100€)\n- I costi di verifica sono a tuo carico\n- La verifica protegge la tua privacy (zero-knowledge)\n- Una volta completata, potrai ricevere tutti i doni LARGE\n\nNon potrai ricevere doni superiori a 100€ fino al completamento della verifica.`,
      timestamp: new Date().toISOString(),
      read: false,
      type: 'zkkyc_required',
      priority: 'critical',
      metadata: {
        accumuloAttuale: accumuloAttuale,
        sogliaRichiesta: 100,
        zkKYCUrl: zkKYCUrl,
        verificaCompletata: false
      }
    };
    
    // Aggiungi messaggio
    messages.push(message);
    
    // Salva
    await fs.writeFile(MESSAGES_FILE, JSON.stringify({ messages }, null, 2));
    
    console.log(`⚠️  Messaggio ZK-KYC inviato a ${nome} (${wallet})`);
    console.log(`   Accumulo: ${accumuloAttuale}€/100€`);
    
    return {
      success: true,
      messageId: message.id,
      wallet: walletLower,
      accumuloAttuale: accumuloAttuale,
      timestamp: message.timestamp
    };
    
  } catch (error) {
    console.error('❌ Errore invio messaggio ZK-KYC:', error);
    throw error;
  }
}

/**
 * Invia messaggio per posizioni bulk (rientri automatici)
 * @param {string} wallet - Wallet destinatario
 * @param {string} nome - Nome destinatario
 * @param {Object} bulkInfo - Info posizioni bulk {importoEuro, numeroCoppie, posizioni, movimentoOrigine, cicloOrigine}
 * @returns {Promise<Object>}
 */
async function sendBulkPositionsMessage(wallet, nome, bulkInfo) {
  try {
    const walletLower = wallet.toLowerCase();
    
    // Leggi messaggi esistenti
    const messagesData = await fs.readFile(MESSAGES_FILE, 'utf8');
    const data = JSON.parse(messagesData);
    const messages = data.messages || [];
    
    // Prepara lista posizioni (SOLO HUMAN, non PILETTA)
    const posizioniNumeri = bulkInfo.posizioni.map(p => `n°${p.human}`).join(', ');
    const totalePosizioni = bulkInfo.numeroCoppie; // Solo posizioni HUMAN
    
    // Crea messaggio
    const message = {
      id: uuidv4(),
      recipient: walletLower,
      sender: 'system',
      subject: '🎊 Rientro Automatico - Nuove Posizioni!',
      content: `Complimenti ${nome}! Il tuo ${bulkInfo.movimentoOrigine} ${bulkInfo.cicloOrigine} ha generato un rientro automatico!\n\n💰 Importo dedicato: ${bulkInfo.importoEuro}€\n📍 Posizioni ottenute: ${posizioniNumeri}\n\nTotale: ${totalePosizioni} nuove posizioni\n\nTutte le tue nuove posizioni partono da SMALL ciclo 1 e sono già attive nel sistema!\n\nContinua così! 🚀✨`,
      timestamp: new Date().toISOString(),
      read: false,
      type: 'bulk_position_notification',
      priority: 'high',
      metadata: {
        posizioniHuman: bulkInfo.posizioni.map(p => p.human),
        totalePosizioni: totalePosizioni,
        numeroCoppie: bulkInfo.numeroCoppie,
        importoEuro: bulkInfo.importoEuro,
        movimentoOrigine: bulkInfo.movimentoOrigine,
        cicloOrigine: bulkInfo.cicloOrigine
      }
    };
    
    // Aggiungi messaggio
    messages.push(message);
    
    // Salva
    await fs.writeFile(MESSAGES_FILE, JSON.stringify({ messages }, null, 2));
    
    console.log(`✅ Messaggio rientro automatico inviato a ${nome}`);
    console.log(`   ${bulkInfo.movimentoOrigine} ${bulkInfo.cicloOrigine} → ${totalePosizioni} posizioni`);
    
    return {
      success: true,
      messageId: message.id,
      wallet: walletLower,
      bulkInfo: bulkInfo,
      timestamp: message.timestamp
    };
    
  } catch (error) {
    console.error('❌ Errore invio messaggio bulk:', error);
    throw error;
  }
}

// ========================================
// FUNZIONE PRINCIPALE: PROCESSO COMPLETO
// ========================================

/**
 * Processa nuovo iscritto: attiva area personale + invia messaggio
 * @param {Object} userData - {nome, wallet, posizioni}
 * @returns {Promise<Object>}
 */
async function processNewUser(userData) {
  try {
    const { nome, wallet, posizioni } = userData;
    
    console.log(`\n🔄 PROCESSO ATTIVAZIONE per ${nome} (${wallet})`);
    
    // 1. Attiva area personale
    const activationResult = await activateUserArea(wallet, nome);
    
    // 2. Invia messaggio con posizioni
    const messageResult = await sendPositionsMessage(wallet, nome, posizioni);
    
    console.log(`✅ PROCESSO COMPLETATO per ${nome}`);
    console.log(`   - Area personale: ${activationResult.alreadyActive ? 'GIÀ ATTIVA' : 'ATTIVATA'}`);
    console.log(`   - Messaggio inviato: ${messageResult.messageId}`);
    
    return {
      success: true,
      activation: activationResult,
      message: messageResult,
      wallet: wallet.toLowerCase(),
      nome: nome
    };
    
  } catch (error) {
    console.error('❌ Errore processo nuovo utente:', error);
    throw error;
  }
}

/**
 * Processa posizioni bulk (rientri automatici)
 * @param {Object} bulkData - {nome, wallet, bulkInfo}
 * @returns {Promise<Object>}
 */
async function processBulkPositions(bulkData) {
  try {
    const { nome, wallet, bulkInfo } = bulkData;
    
    console.log(`\n🔄 PROCESSO RIENTRO AUTOMATICO per ${nome}`);
    console.log(`   ${bulkInfo.movimentoOrigine} ${bulkInfo.cicloOrigine} → ${bulkInfo.importoEuro}€`);
    
    // L'area personale dovrebbe già essere attiva, ma verifichiamo
    const isActive = await isUserActive(wallet);
    if (!isActive) {
      console.log('⚠️  Area personale non attiva, attivazione...');
      await activateUserArea(wallet, nome);
    }
    
    // Invia messaggio di rientro automatico
    const messageResult = await sendBulkPositionsMessage(wallet, nome, bulkInfo);
    
    console.log(`✅ PROCESSO RIENTRO COMPLETATO per ${nome}`);
    
    return {
      success: true,
      message: messageResult,
      wallet: wallet.toLowerCase(),
      nome: nome,
      bulkInfo: bulkInfo
    };
    
  } catch (error) {
    console.error('❌ Errore processo bulk:', error);
    throw error;
  }
}

// ========================================
// INIZIALIZZAZIONE
// ========================================

initializeActivationFiles();

// ========================================
// EXPORT
// ========================================

module.exports = {
  activateUserArea,
  isUserActive,
  sendPositionsMessage,
  sendBulkPositionsMessage,
  sendZKKYCRequiredMessage,
  processNewUser,
  processBulkPositions
};
