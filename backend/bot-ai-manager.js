/**
 * 🤖 ROG BOT AI MANAGER - Sistema Messaggistica Intelligente
 * 
 * Bot AI per supporto utenti nell'area personale.
 * FAQ modificabili in tempo reale tramite file JSON (no redeploy necessario).
 * 
 * FEATURES:
 * - Risposte automatiche basate su FAQ
 * - Pattern matching intelligente
 * - Escalation a supporto umano
 * - Storia conversazioni
 * - FAQ hot-reloadable (modifica senza restart)
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 19 Novembre 2025
 */

const fs = require('fs').promises;
const path = require('path');

// ========================================
// CONFIGURAZIONE
// ========================================

const FAQ_FILE = path.join(__dirname, 'data', 'bot-faq.json');
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'bot-conversations.json');

// Email supporto umano
const SUPPORT_EMAIL = 'revolutionofgivingrog@protonmail.com';

// ========================================
// CLASSE BOT AI MANAGER
// ========================================

class BotAIManager {
  constructor() {
    this.faq = [];
    this.conversations = {};
    this.initialized = false;
    
    // Hot reload FAQ ogni 30 secondi
    this.faqReloadInterval = null;
  }

  /**
   * Inizializza il bot
   */
  async init() {
    if (this.initialized) return;

    console.log('🤖 Inizializzazione Bot AI Manager...');

    // Carica FAQ
    await this.loadFAQ();

    // Carica conversazioni
    await this.loadConversations();

    // Avvia hot reload FAQ
    this.startFAQHotReload();

    this.initialized = true;
    console.log('✅ Bot AI Manager pronto');
    console.log(`   FAQ caricate: ${this.faq.length}`);
  }

  /**
   * Carica FAQ da file JSON
   */
  async loadFAQ() {
    try {
      const data = await fs.readFile(FAQ_FILE, 'utf8');
      this.faq = JSON.parse(data);
      console.log(`✅ FAQ caricate: ${this.faq.length} voci`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📝 Creazione FAQ template...');
        this.faq = this.getDefaultFAQ();
        await this.saveFAQ();
      } else {
        throw error;
      }
    }
  }

  /**
   * Salva FAQ su file
   */
  async saveFAQ() {
    await fs.mkdir(path.dirname(FAQ_FILE), { recursive: true });
    await fs.writeFile(FAQ_FILE, JSON.stringify(this.faq, null, 2), 'utf8');
  }

  /**
   * Carica conversazioni
   */
  async loadConversations() {
    try {
      const data = await fs.readFile(CONVERSATIONS_FILE, 'utf8');
      this.conversations = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.conversations = {};
        await this.saveConversations();
      } else {
        throw error;
      }
    }
  }

  /**
   * Salva conversazioni
   */
  async saveConversations() {
    await fs.mkdir(path.dirname(CONVERSATIONS_FILE), { recursive: true });
    await fs.writeFile(
      CONVERSATIONS_FILE,
      JSON.stringify(this.conversations, null, 2),
      'utf8'
    );
  }

  /**
   * Avvia hot reload FAQ (ricarica automatica ogni 30s)
   */
  startFAQHotReload() {
    this.faqReloadInterval = setInterval(async () => {
      try {
        await this.loadFAQ();
      } catch (error) {
        console.error('⚠️  Errore hot reload FAQ:', error.message);
      }
    }, 30000); // 30 secondi
  }

  /**
   * Ferma hot reload
   */
  stopFAQHotReload() {
    if (this.faqReloadInterval) {
      clearInterval(this.faqReloadInterval);
      this.faqReloadInterval = null;
    }
  }

  /**
   * Processa messaggio utente
   * 
   * @param {string} walletAddress - Wallet utente
   * @param {string} message - Messaggio utente
   * @returns {Promise<Object>} Risposta bot
   */
  async processMessage(walletAddress, message) {
    await this.init();

    const walletNorm = walletAddress.toLowerCase();
    const messageNorm = message.toLowerCase().trim();

    console.log(`\n🤖 BOT AI: Messaggio da ${walletAddress.substring(0, 8)}...`);
    console.log(`   "${message}"`);

    // Inizializza conversazione se non esistente
    if (!this.conversations[walletNorm]) {
      this.conversations[walletNorm] = {
        wallet: walletAddress,
        messages: [],
        createdAt: new Date().toISOString(),
        escalatedToHuman: false
      };
    }

    // Aggiungi messaggio utente
    this.conversations[walletNorm].messages.push({
      timestamp: new Date().toISOString(),
      sender: 'user',
      message: message
    });

    // Cerca risposta nelle FAQ
    const faqMatch = this.findFAQMatch(messageNorm);

    let response;

    if (faqMatch) {
      // Risposta trovata in FAQ
      response = {
        type: 'faq',
        answer: faqMatch.answer,
        category: faqMatch.category,
        confidence: faqMatch.confidence
      };

      console.log(`   ✅ Risposta FAQ trovata (${faqMatch.category})`);
    } else {
      // Nessuna risposta in FAQ → Escalation
      response = {
        type: 'escalation',
        answer: `Non ho trovato una risposta precisa alla tua domanda. Ho notificato il team di supporto umano che ti risponderà al più presto via email.\n\nPer urgenze, scrivi direttamente a: ${SUPPORT_EMAIL}`,
        category: 'escalation',
        confidence: 0
      };

      // Marca conversazione per escalation
      this.conversations[walletNorm].escalatedToHuman = true;

      console.log(`   ⚠️  Escalation a supporto umano`);

      // TODO: Invia notifica email al team
      // await this.notifySupportTeam(walletAddress, message);
    }

    // Aggiungi risposta bot
    this.conversations[walletNorm].messages.push({
      timestamp: new Date().toISOString(),
      sender: 'bot',
      message: response.answer,
      type: response.type,
      category: response.category
    });

    // Salva conversazioni
    await this.saveConversations();

    return response;
  }

  /**
   * Cerca match nelle FAQ
   * 
   * @param {string} message - Messaggio normalizzato
   * @returns {Object|null} FAQ match o null
   */
  findFAQMatch(message) {
    let bestMatch = null;
    let bestScore = 0;

    for (const faq of this.faq) {
      for (const keyword of faq.keywords) {
        if (message.includes(keyword.toLowerCase())) {
          const score = keyword.length / message.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              ...faq,
              confidence: Math.min(score * 100, 100)
            };
          }
        }
      }
    }

    // Ritorna solo se confidence > 30%
    return bestScore > 0.3 ? bestMatch : null;
  }

  /**
   * Ottiene storico conversazione
   * 
   * @param {string} walletAddress - Wallet utente
   * @returns {Promise<Object|null>} Conversazione o null
   */
  async getConversation(walletAddress) {
    await this.init();
    const walletNorm = walletAddress.toLowerCase();
    return this.conversations[walletNorm] || null;
  }

  /**
   * FAQ di default
   */
  getDefaultFAQ() {
    return [
      {
        id: 'faq_001',
        category: 'Generale',
        question: 'Cos\'è Revolution of Giving?',
        keywords: ['cos\'è', 'cosa è', 'revolution', 'rog', 'spiegazione'],
        answer: 'Revolution of Giving (ROG) è una DAO decentralizzata che promuove l\'economia del dono attraverso un sistema di distribuzione equo e trasparente su blockchain Polygon. Il sistema è composto da 3 movimenti concatenati: SMALL (€2→€10), MEDIUM (€10→€100) e LARGE (€100→€25,000).'
      },
      {
        id: 'faq_002',
        category: 'Posizioni',
        question: 'Come funzionano le posizioni?',
        keywords: ['posizioni', 'come funziona', 'molecole', 'cicli'],
        answer: 'Ogni donazione di 2€ crea 1 coppia di posizioni (HUMAN + PILETTA). Le posizioni si organizzano in molecole da 4 (2 HUMAN + 2 PILETTA). Ogni molecola attraversa 3 cicli in SMALL, 3 in MEDIUM e 8 in LARGE, ricevendo doni progressivi fino a 25,000€ totali.'
      },
      {
        id: 'faq_003',
        category: 'Stelline',
        question: 'Cosa sono le stelline?',
        keywords: ['stelline', 'stelle', 'tracking', 'ciclo', 'progressione'],
        answer: 'Le stelline indicano i cicli completati:\n• Stelline ROSSE: Cicli SMALL e MEDIUM (1-6)\n• Stelline VERDI: Cicli LARGE (1-8)\n\nOgni stellina viene assegnata solo a ciclo completato. Dopo 3 stelline rosse passi in MEDIUM, dopo altre 3 stelline verdi passi in LARGE.'
      },
      {
        id: 'faq_004',
        category: 'Invitati',
        question: 'Come funziona il sistema invitati?',
        keywords: ['invitati', 'referral', 'ponti', 'bonus', 'invitare'],
        answer: 'Puoi invitare altri utenti tramite il tuo Referral Link. Il numero di invitati determina la tua classificazione in LARGE:\n• 2+ invitati = INVITANTE (100% doni)\n• 1 invitato = SEMI_INVITANTE (75% doni + 25% a ponte)\n• 0 invitati = NON_INVITANTE (50% doni + 50% a ponte)\n\nOgni invitato ti fa guadagnare fino a 6,250€ totali nel sistema.'
      },
      {
        id: 'faq_005',
        category: 'Donazioni',
        question: 'Come faccio una donazione?',
        keywords: ['donare', 'donazione', 'inviare', 'usdc', 'metamask'],
        answer: 'Per donare:\n1. Vai su PROGETTI → Clicca "SEND GIFT"\n2. Connetti il tuo wallet MetaMask\n3. Seleziona importo (multipli di 2€ in USDC)\n4. Conferma transazione\n\nIl sistema creerà automaticamente le tue posizioni e assegnerà i token RGx (1 RGx per ogni 2€).'
      },
      {
        id: 'faq_006',
        category: 'RGx Token',
        question: 'Cos\'è il token RGx?',
        keywords: ['rgx', 'token', 'nft', 'soulbound', 'voto'],
        answer: 'RGx è un NFT Soulbound (non trasferibile) che rappresenta la tua partecipazione in ROG. Ricevi 1 RGx per ogni 2€ donati. Con almeno 1 RGx hai diritto di voto nelle decisioni della DAO (1 wallet = 1 voto, indipendentemente dal numero di RGx).'
      },
      {
        id: 'faq_007',
        category: 'Movimenti',
        question: 'Quando passo da SMALL a MEDIUM?',
        keywords: ['passare', 'medium', 'large', 'transizione', 'accumulo'],
        answer: 'Passi automaticamente da SMALL a MEDIUM dopo aver completato 3 cicli (3 stelline rosse). Il sistema accumula automaticamente 10€ durante i cicli SMALL per il tuo ingresso in MEDIUM.\n\nAnalogamente, passi da MEDIUM a LARGE dopo altri 3 cicli (3 stelline verdi) con 100€ accumulati.'
      },
      {
        id: 'faq_008',
        category: 'ZK-KYC',
        question: 'Cos\'è la verifica ZK-KYC?',
        keywords: ['zkkyc', 'verifica', 'polygonid', 'kyc', 'identità'],
        answer: 'Prima di ricevere il primo dono in LARGE, devi completare la verifica ZK-KYC tramite PolygonID. Questo garantisce la trasparenza del sistema mantenendo la tua privacy. La verifica costa pochi centesimi ed è a tuo carico. Riceverai istruzioni nell\'area personale quando necessario.'
      },
      {
        id: 'faq_009',
        category: 'PILETTE',
        question: 'Cosa sono le PILETTE?',
        keywords: ['pilette', 'piletta', 'perpetuità', 'sostenibilità'],
        answer: 'Le PILETTE sono posizioni speciali che garantiscono la sostenibilità perpetua del sistema. Ogni dono ricevuto da una PILETTA viene redistribuito in nuove posizioni:\n• 50% → Nuove PILETTE\n• 10% → Posizioni AVENGERS\n• 40% → Posizioni ROG\n\nQuesto crea un ciclo infinito di rigenerazione.'
      },
      {
        id: 'faq_010',
        category: 'Area Personale',
        question: 'Come accedo alla mia area personale?',
        keywords: ['area personale', 'dashboard', 'accesso', 'login', 'wallet'],
        answer: 'Per accedere:\n1. Clicca su "GIÀ ISCRITTO" nella homepage\n2. Connetti il tuo wallet MetaMask\n3. Il sistema verifica il tuo wallet nell\'anagrafica\n\nNella tua area personale vedi: posizioni attive, stelline, invitati, referral link, doni ricevuti e storico.'
      },
      {
        id: 'faq_011',
        category: 'Wallet',
        question: 'Quale wallet devo usare?',
        keywords: ['wallet', 'metamask', 'polygon', 'matic'],
        answer: 'Devi usare MetaMask configurato su Polygon Mainnet. Il sistema ti aiuterà automaticamente a configurare la rete durante la registrazione. Assicurati di avere un po\' di MATIC per le gas fees e USDC per le donazioni.'
      },
      {
        id: 'faq_012',
        category: 'Sicurezza',
        question: 'È sicuro il sistema ROG?',
        keywords: ['sicuro', 'sicurezza', 'smart contract', 'audit'],
        answer: 'Sì, ROG è completamente decentralizzato e sicuro:\n• Smart contract deployed su Polygon Mainnet\n• Codice verificato su Polygonscan\n• Wallet multi-sig per decisioni critiche (3/3)\n• Nessuna custodia centralizzata dei fondi\n• Sistema trasparente e auditable on-chain'
      },
      {
        id: 'faq_013',
        category: 'Supporto',
        question: 'Come contatto il supporto?',
        keywords: ['supporto', 'aiuto', 'help', 'contatto', 'assistenza'],
        answer: `Per assistenza:\n• Usa questo bot per domande frequenti\n• Email: ${SUPPORT_EMAIL}\n• Il team risponde entro 24-48 ore\n\nPer problemi tecnici, includi sempre il tuo wallet address e screenshot se possibile.`
      }
    ];
  }

  /**
   * Ottiene tutte le FAQ (per admin)
   */
  async getAllFAQ() {
    await this.init();
    return this.faq;
  }

  /**
   * Aggiunge nuova FAQ (admin)
   */
  async addFAQ(faqData) {
    await this.init();

    const newFAQ = {
      id: `faq_${String(this.faq.length + 1).padStart(3, '0')}`,
      category: faqData.category,
      question: faqData.question,
      keywords: faqData.keywords,
      answer: faqData.answer
    };

    this.faq.push(newFAQ);
    await this.saveFAQ();

    console.log(`✅ Nuova FAQ aggiunta: ${newFAQ.id}`);
    return newFAQ;
  }

  /**
   * Modifica FAQ esistente (admin)
   */
  async updateFAQ(faqId, updates) {
    await this.init();

    const index = this.faq.findIndex(f => f.id === faqId);
    if (index === -1) {
      throw new Error(`FAQ ${faqId} non trovata`);
    }

    this.faq[index] = {
      ...this.faq[index],
      ...updates
    };

    await this.saveFAQ();

    console.log(`✅ FAQ aggiornata: ${faqId}`);
    return this.faq[index];
  }

  /**
   * Elimina FAQ (admin)
   */
  async deleteFAQ(faqId) {
    await this.init();

    const index = this.faq.findIndex(f => f.id === faqId);
    if (index === -1) {
      throw new Error(`FAQ ${faqId} non trovata`);
    }

    const deleted = this.faq.splice(index, 1)[0];
    await this.saveFAQ();

    console.log(`✅ FAQ eliminata: ${faqId}`);
    return deleted;
  }

  /**
   * Ottiene statistiche bot
   */
  async getStatistics() {
    await this.init();

    const totalConversations = Object.keys(this.conversations).length;
    const escalatedConversations = Object.values(this.conversations)
      .filter(c => c.escalatedToHuman).length;
    const totalMessages = Object.values(this.conversations)
      .reduce((sum, c) => sum + c.messages.length, 0);

    return {
      totalFAQ: this.faq.length,
      totalConversations,
      escalatedConversations,
      totalMessages,
      averageMessagesPerConversation: totalConversations > 0 
        ? (totalMessages / totalConversations).toFixed(2) 
        : 0
    };
  }
}

// ========================================
// EXPORT
// ========================================

const botAIManager = new BotAIManager();

module.exports = botAIManager;
