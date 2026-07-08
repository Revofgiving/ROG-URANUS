/**
 * 🔒 CONFIGURAZIONE CORS - Backend ROG
 * 
 * Gestisce le policy CORS (Cross-Origin Resource Sharing)
 * per controllare quali domini possono accedere alle API
 * 
 * @version 1.0.0
 */

// ========================================
// DOMINI AUTORIZZATI
// ========================================

/**
 * Lista dei domini che possono accedere alle API
 * IMPORTANTE: Aggiorna questa lista per produzione!
 */
const allowedOrigins = [
  // Sviluppo locale - tutte le porte comuni
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:8080',

  // ⚠️  RIMOSSO: 'null' era una vulnerabilità CORS bypass (iframe sandboxed / file://)

  // PRODUZIONE - Backend Coolify DigitalOcean
  'https://rog-backend.165.245.209.171.nip.io',

  // PRODUZIONE - Revolution of Giving
  'https://revolutionofgiving.eth',
  'https://www.revolutionofgiving.eth',
  'https://revolutionofgiving.eth.link',        // Gateway IPFS
  'https://www.revolutionofgiving.eth.link',    // Gateway IPFS con www
  'https://revolutionofgiving.eth.limo',        // Gateway IPFS alternativo
  'https://www.revolutionofgiving.eth.limo',    // Gateway IPFS alternativo con www

  // Gateway IPFS Pinata
  'https://gateway.pinata.cloud',

  // Gateway IPFS generici (per qualsiasi hash)
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
  'https://dweb.link'
];

// ========================================
// CONFIGURAZIONE CORS
// ========================================

const corsOptions = {
  /**
   * Funzione origin personalizzata
   * Controlla se l'origine della richiesta è autorizzata
   */
  origin: function (origin, callback) {
    // Permetti richieste senza origin (Postman, curl, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // Permetti tutti i gateway IPFS con subdomain CID
    // es: https://bafybei....ipfs.dweb.link, https://bafybei....ipfs.io, ecc.
    const ipfsPatterns = [
      '.ipfs.dweb.link',
      '.ipfs.io',
      '.ipfs.cloudflare-ipfs.com',
      '.ipfs.nftstorage.link',
      '.ipfs.w3s.link'
    ];
    if (ipfsPatterns.some(p => origin.includes(p))) {
      return callback(null, true);
    }

    // Permetti gateway Pinata con CID nell'URL
    if (origin.startsWith('https://') && origin.includes('.mypinata.cloud')) {
      return callback(null, true);
    }

    // Controlla whitelist esatta
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS: Origine bloccata - ${origin}`);
      callback(new Error('Non autorizzato dalla policy CORS'));
    }
  },
  
  /**
   * Permetti invio credenziali (cookies, auth headers)
   */
  credentials: true,
  
  /**
   * Status code per richieste OPTIONS riuscite
   * 200 per compatibilità con browser vecchi
   */
  optionsSuccessStatus: 200,
  
  /**
   * Metodi HTTP permessi
   */
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  
  /**
   * Headers che il client può inviare
   */
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  
  /**
   * Headers esposti al client nelle risposte
   */
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'X-Request-Id',
    'X-Response-Time'
  ],
  
  /**
   * Tempo cache per richieste preflight (in secondi)
   * 86400 = 24 ore
   */
  maxAge: 86400
};

// ========================================
// MODALITÀ SVILUPPO vs PRODUZIONE
// ========================================

/**
 * In modalità sviluppo, permetti tutti i domini localhost
 */
if (process.env.NODE_ENV === 'development') {
  console.log('🔓 CORS: Modalità sviluppo - Tutti i localhost autorizzati');
  
  // Sovrascivi origin per accettare tutti i localhost
  corsOptions.origin = function (origin, callback) {
    if (!origin) return callback(null, true);
    
    // Permetti tutti i localhost e 127.0.0.1
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Non autorizzato dalla policy CORS'));
    }
  };
}

/**
 * In produzione, usa whitelist stretta
 */
if (process.env.NODE_ENV === 'production') {
  console.log('🔒 CORS: Modalità produzione - Solo domini whitelist');
  console.log(`   Domini autorizzati: ${allowedOrigins.filter(o => o.includes('https')).join(', ')}`);
}

// ========================================
// FUNZIONI HELPER
// ========================================

/**
 * Aggiungi un dominio alla whitelist runtime
 * @param {string} domain - Dominio da aggiungere
 */
function addAllowedOrigin(domain) {
  if (!allowedOrigins.includes(domain)) {
    allowedOrigins.push(domain);
    console.log(`✅ CORS: Aggiunto dominio autorizzato - ${domain}`);
  }
}

/**
 * Rimuovi un dominio dalla whitelist
 * @param {string} domain - Dominio da rimuovere
 */
function removeAllowedOrigin(domain) {
  const index = allowedOrigins.indexOf(domain);
  if (index > -1) {
    allowedOrigins.splice(index, 1);
    console.log(`❌ CORS: Rimosso dominio autorizzato - ${domain}`);
  }
}

/**
 * Ottieni lista domini autorizzati
 * @returns {Array} Lista domini
 */
function getAllowedOrigins() {
  return [...allowedOrigins];
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  corsOptions,
  allowedOrigins,
  addAllowedOrigin,
  removeAllowedOrigin,
  getAllowedOrigins
};
