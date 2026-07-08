/**
 * 🗳️ ROG VOTING NOTIFICATIONS SYSTEM
 * 
 * Sistema automatico che invia notifiche a tutti gli utenti con ≥1 RGx
 * quando viene creata una nuova votazione.
 * 
 * FLUSSO:
 * 1. Smart contract emette evento VotingCreated
 * 2. Backend ascolta evento
 * 3. Recupera lista utenti con RGx ≥1 dallo smart contract
 * 4. Invia messaggio automatico a ciascun utente nella messaggistica
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 */

const ethers = require('ethers');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ========================================
// CONFIGURAZIONE
// ========================================

const CONTRACT_ADDRESS = process.env.ROG_CONTRACT_ADDRESS || '0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/';
const DATABASE_PATH = path.join(__dirname, 'messaging.db');

// ABI essenziale per votazioni
const CONTRACT_ABI = [
  "event VotingCreated(uint256 indexed votingId, string description, uint256 projectAmount, uint256 endTime)",
  "function getUserInfo(address user) external view returns (uint256 totalDonated, uint256 totalReceived, uint256 rgxTokensOwned, bool hasZKKYC_, uint256 donationCount, bool isActive)",
  "function getTotalVotings() external view returns (uint256)",
  "function getVotingDetails(uint256 votingId) external view returns (string memory description, uint256 projectAmount, uint256 startTime, uint256 endTime, uint256 yesVotes, uint256 noVotes, bool executed, bool approved)"
];

// ========================================
// DATABASE SETUP
// ========================================

let db = null;

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DATABASE_PATH, (err) => {
      if (err) {
        console.error('❌ Errore apertura database messaggi:', err);
        reject(err);
        return;
      }
      
      console.log('✅ Database messaggi connesso');
      
      // Crea tabella messaggi se non esiste
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_wallet TEXT NOT NULL,
          sender TEXT NOT NULL,
          subject TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'system',
          voting_id INTEGER,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          read BOOLEAN DEFAULT 0,
          UNIQUE(recipient_wallet, voting_id, type)
        )
      `, (err) => {
        if (err) {
          console.error('❌ Errore creazione tabella:', err);
          reject(err);
          return;
        }
        
        console.log('✅ Tabella messages pronta');
        
        // Crea indici per performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_recipient ON messages(recipient_wallet)`, () => {
          db.run(`CREATE INDEX IF NOT EXISTS idx_voting ON messages(voting_id)`, () => {
            db.run(`CREATE INDEX IF NOT EXISTS idx_read ON messages(read)`, () => {
              resolve();
            });
          });
        });
      });
    });
  });
}

// ========================================
// SMART CONTRACT LISTENER
// ========================================

class VotingNotificationSystem {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.isListening = false;
  }
  
  async initialize() {
    try {
      console.log('🔗 Connessione a Polygon...');
      this.provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
      
      console.log(`📜 Contratto: ${CONTRACT_ADDRESS}`);
      this.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.provider);
      
      // Inizializza database
      await initializeDatabase();
      
      console.log('✅ Sistema notifiche votazioni inizializzato');
      return true;
    } catch (error) {
      console.error('❌ Errore inizializzazione:', error);
      return false;
    }
  }
  
  /**
   * Avvia ascolto eventi VotingCreated
   */
  startListening() {
    if (!this.contract) {
      console.error('❌ Contratto non inizializzato');
      return;
    }
    
    if (this.isListening) {
      console.warn('⚠️ Listener già attivo');
      return;
    }
    
    console.log('👂 Avvio ascolto eventi VotingCreated...\n');
    
    // Ascolta eventi VotingCreated
    this.contract.on('VotingCreated', async (votingId, description, projectAmount, endTime, event) => {
      try {
        console.log('\n🗳️ NUOVA VOTAZIONE CREATA');
        console.log('===================================');
        console.log(`Voting ID:    ${votingId}`);
        console.log(`Descrizione:  ${description}`);
        console.log(`Importo:      ${ethers.formatUnits(projectAmount, 6)} USDC`);
        console.log(`Fine:         ${new Date(Number(endTime) * 1000).toLocaleString('it-IT')}`);
        console.log(`Block:        ${event.blockNumber}`);
        console.log(`TxHash:       ${event.transactionHash}`);
        
        // Elabora notifiche
        await this.processVotingNotifications(votingId, description, projectAmount, endTime);
        
      } catch (error) {
        console.error('❌ Errore gestione VotingCreated:', error);
      }
    });
    
    this.isListening = true;
    console.log('✅ Listener attivo - In ascolto eventi VotingCreated...\n');
  }
  
  /**
   * Elabora e invia notifiche per una nuova votazione
   */
  async processVotingNotifications(votingId, description, projectAmount, endTime) {
    try {
      console.log(`\n📤 Elaborazione notifiche per Votazione #${votingId}...`);
      
      // 1. Recupera tutti gli utenti con RGx ≥1 dallo smart contract
      const eligibleUsers = await this.getEligibleVoters();
      
      if (eligibleUsers.length === 0) {
        console.log('⚠️ Nessun utente con RGx ≥1 trovato');
        return;
      }
      
      console.log(`✅ Trovati ${eligibleUsers.length} utenti con diritto di voto`);
      
      // 2. Crea messaggio notifica
      const message = this.createVotingMessage(votingId, description, projectAmount, endTime);
      
      // 3. Invia messaggio a tutti gli utenti eligibili
      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;
      
      for (const wallet of eligibleUsers) {
        try {
          const inserted = await this.sendMessageToUser(wallet, message, votingId);
          if (inserted) {
            successCount++;
          } else {
            skipCount++;
          }
        } catch (error) {
          console.error(`❌ Errore invio a ${wallet}:`, error.message);
          errorCount++;
        }
      }
      
      console.log(`\n📊 RISULTATO INVIO NOTIFICHE:`);
      console.log(`   ✅ Inviate: ${successCount}`);
      console.log(`   ⏭️  Saltate (duplicati): ${skipCount}`);
      console.log(`   ❌ Errori: ${errorCount}`);
      console.log(`   📧 Totale destinatari: ${eligibleUsers.length}`);
      
    } catch (error) {
      console.error('❌ Errore elaborazione notifiche:', error);
      throw error;
    }
  }
  
  /**
   * Recupera tutti gli utenti con RGx ≥1 dallo smart contract
   */
  async getEligibleVoters() {
    try {
      // STRATEGIA: Leggiamo dal database locale gli wallet che hanno donato
      // Poi verifichiamo on-chain quali hanno RGx ≥1
      
      const wallets = await this.getUniqueWallets();
      const eligibleVoters = [];
      
      console.log(`🔍 Verifica ${wallets.length} wallet per diritto di voto...`);
      
      for (const wallet of wallets) {
        try {
          const userInfo = await this.contract.getUserInfo(wallet);
          const rgxBalance = userInfo.rgxTokensOwned.toNumber();
          
          if (rgxBalance >= 1) {
            eligibleVoters.push(wallet);
            console.log(`   ✅ ${wallet}: ${rgxBalance} RGx`);
          }
        } catch (error) {
          console.error(`   ⚠️ Errore verifica ${wallet}:`, error.message);
        }
      }
      
      return eligibleVoters;
      
    } catch (error) {
      console.error('❌ Errore recupero eligible voters:', error);
      return [];
    }
  }
  
  /**
   * Recupera wallet unici dal database anagrafica
   */
  async getUniqueWallets() {
    return new Promise((resolve, reject) => {
      // Leggiamo dal database anagrafica
      const anagraficaDb = new sqlite3.Database(
        path.join(__dirname, 'anagrafica.db'),
        sqlite3.OPEN_READONLY,
        (err) => {
          if (err) {
            console.error('❌ Errore apertura anagrafica DB:', err);
            resolve([]); // Fallback: array vuoto
            return;
          }
          
          anagraficaDb.all(
            `SELECT DISTINCT wallet FROM anagrafica 
             WHERE tipo = 'HUMAN' AND wallet IS NOT NULL AND wallet != ''`,
            [],
            (err, rows) => {
              anagraficaDb.close();
              
              if (err) {
                console.error('❌ Errore query wallet:', err);
                resolve([]);
                return;
              }
              
              const wallets = rows.map(row => row.wallet);
              resolve(wallets);
            }
          );
        }
      );
    });
  }
  
  /**
   * Crea messaggio formattato per votazione
   */
  createVotingMessage(votingId, description, projectAmount, endTime) {
    const importoFormatted = ethers.formatUnits(projectAmount, 6);
    const dataFine = new Date(Number(endTime) * 1000).toLocaleDateString('it-IT');
    
    let subject = `🗳️ Nuova Votazione DAO #${votingId}`;
    
    let content = `🗳️ **NUOVA VOTAZIONE DAO ATTIVA**\n\n`;
    content += `**Votazione #${votingId}**\n\n`;
    content += `📝 **Descrizione:**\n${description}\n\n`;
    
    if (parseFloat(importoFormatted) > 0) {
      content += `💰 **Importo Progetto:** ${parseFloat(importoFormatted).toLocaleString('it-IT')} USDC\n\n`;
    }
    
    content += `⏰ **Scadenza:** ${dataFine}\n`;
    content += `⏳ **Durata:** 5 giorni\n\n`;
    content += `📊 **Come votare:**\n`;
    content += `1. Vai alla sezione Votazioni DAO\n`;
    content += `2. Leggi attentamente la proposta\n`;
    content += `3. Esprimi il tuo voto (SÌ o NO)\n\n`;
    content += `✅ Il tuo voto conta! Ogni wallet = 1 voto\n`;
    content += `🔗 Vota ora: ${process.env.BASE_URL || 'https://revolutionofgiving.eth'}/votazioni.html`;
    
    return {
      sender: '🗳️ DAO Governance',
      subject: subject,
      content: content,
      type: 'voting'
    };
  }
  
  /**
   * Invia messaggio a singolo utente
   */
  async sendMessageToUser(wallet, message, votingId) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO messages 
         (recipient_wallet, sender, subject, content, type, voting_id, timestamp, read) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.toLowerCase(),
          message.sender,
          message.subject,
          message.content,
          message.type,
          votingId.toString(),
          new Date().toISOString(),
          0
        ],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          // this.changes indica se è stato inserito (1) o ignorato per duplicato (0)
          resolve(this.changes > 0);
        }
      );
    });
  }
  
  /**
   * Ferma ascolto eventi
   */
  stopListening() {
    if (this.contract && this.isListening) {
      this.contract.removeAllListeners('VotingCreated');
      this.isListening = false;
      console.log('🛑 Listener fermato');
    }
  }
  
  /**
   * Test: Invia notifica manualmente per votazione esistente
   */
  async testNotification(votingId) {
    try {
      console.log(`\n🧪 TEST: Invio notifiche per Votazione #${votingId}...`);
      
      const details = await this.contract.getVotingDetails(votingId);
      
      await this.processVotingNotifications(
        votingId,
        details[0], // description
        details[1], // projectAmount
        details[3]  // endTime
      );
      
      console.log('✅ Test completato');
      
    } catch (error) {
      console.error('❌ Errore test:', error);
    }
  }
}

// ========================================
// API ENDPOINTS (da integrare in server Express)
// ========================================

/**
 * GET /api/messages/:wallet
 * Recupera messaggi per un wallet specifico
 */
function getUserMessages(wallet, unreadOnly = false) {
  return new Promise((resolve, reject) => {
    let query = `SELECT * FROM messages WHERE recipient_wallet = ? ORDER BY timestamp DESC`;
    
    if (unreadOnly) {
      query = `SELECT * FROM messages WHERE recipient_wallet = ? AND read = 0 ORDER BY timestamp DESC`;
    }
    
    db.all(query, [wallet.toLowerCase()], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      resolve(rows);
    });
  });
}

/**
 * POST /api/messages/:messageId/read
 * Marca messaggio come letto
 */
function markMessageAsRead(messageId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE messages SET read = 1 WHERE id = ?`,
      [messageId],
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        resolve({ success: true });
      }
    );
  });
}

/**
 * GET /api/messages/:wallet/unread-count
 * Conta messaggi non letti
 */
function getUnreadCount(wallet) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM messages WHERE recipient_wallet = ? AND read = 0`,
      [wallet.toLowerCase()],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        resolve(row.count);
      }
    );
  });
}

// ========================================
// ESPORTAZIONI
// ========================================

module.exports = {
  VotingNotificationSystem,
  getUserMessages,
  markMessageAsRead,
  getUnreadCount
};

// ========================================
// AVVIO STANDALONE (se eseguito direttamente)
// ========================================

if (require.main === module) {
  (async () => {
    console.log('🗳️ ROG VOTING NOTIFICATIONS SYSTEM');
    console.log('===================================\n');
    
    const system = new VotingNotificationSystem();
    
    const initialized = await system.initialize();
    
    if (!initialized) {
      console.error('❌ Inizializzazione fallita');
      process.exit(1);
    }
    
    // Avvia listener
    system.startListening();
    
    console.log('✅ Sistema attivo. Premi Ctrl+C per terminare.\n');
    
    // Gestione chiusura pulita
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Chiusura sistema...');
      system.stopListening();
      if (db) {
        db.close(() => {
          console.log('✅ Database chiuso');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
    
  })();
}
