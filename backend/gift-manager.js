/**
 * 🎁 URANUS — Gift Manager (Doni Pendenti)
 *
 * Gestisce il flusso "ACCETTA DONO":
 *   1. Quando un dono è pronto (uscita L3, L5, Nettuno), NON viene pagato subito
 *   2. Viene creato un DONO PENDENTE nel DB
 *   3. L'utente vede il bottone "ACCETTA DONO" illuminato nella dashboard
 *   4. L'utente clicca → il dono viene distribuito
 *   5. Se dopo 90 GIORNI nessuno clicca → il dono va in CASSA ROG
 *
 * MESSAGGISTICA:
 *   Ogni evento genera un messaggio nella chat interna dell'utente.
 */
'use strict';

const pg = require('./pg-connection-manager');

// ── COSTANTI ──────────────────────────────────────────────────────

const GIFT_EXPIRY_DAYS = 90;
const GIFT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Controlla ogni ora
const CASSA_ROG_WALLET = process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';

// ── INIT DB ──────────────────────────────────────────────────────

async function initGiftTables() {
  // Tabella doni pendenti
  await pg.query(`
    CREATE TABLE IF NOT EXISTS doni_pendenti (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      importo NUMERIC NOT NULL,
      livello INTEGER NOT NULL,
      tipo_uscita TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
      accepted_at TIMESTAMPTZ,
      expired_at TIMESTAMPTZ,
      tx_hash TEXT,
      dettagli JSONB
    )
  `);

  // Tabella messaggi (chat sistema)
  await pg.query(`
    CREATE TABLE IF NOT EXISTS messaggi (
      id SERIAL PRIMARY KEY,
      recipient_wallet TEXT NOT NULL,
      sender TEXT NOT NULL DEFAULT 'SISTEMA',
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'system',
      gift_id INTEGER REFERENCES doni_pendenti(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  // Indici
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_doni_wallet ON doni_pendenti(wallet)`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_doni_status ON doni_pendenti(status)`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_messaggi_wallet ON messaggi(recipient_wallet)`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_messaggi_read ON messaggi(read)`);

  console.log('🎁 [GiftManager] Tabelle doni_pendenti + messaggi pronte');
}

// ════════════════════════════════════════════════════════════════════
// CREAZIONE DONO PENDENTE
// ════════════════════════════════════════════════════════════════════

/**
 * Crea un dono pendente. Chiamato da bridge-manager al posto del payout diretto.
 *
 * @param {string} wallet - Wallet destinatario
 * @param {number} importo - Importo in USDC
 * @param {number} livello - Livello di uscita (3=Venere, 5=Saturno, 6=Nettuno)
 * @param {string} tipoUscita - PAYOUT_L3, PAYOUT_L5, PAYOUT_NETTUNO
 * @param {Object} dettagli - Dettagli aggiuntivi (deduzioni, ecc.)
 * @returns {Object} Dono pendente creato
 */
async function creaDonoPendente(wallet, importo, livello, tipoUscita, dettagli = {}) {
  const w = wallet.toLowerCase();

  const livelloNomi = { 3: 'Venere', 5: 'Saturno', 6: 'Nettuno', 4: 'Giove' };
  const livelloNome = livelloNomi[livello] || `Livello ${livello}`;

  // Crea dono pendente
  const dono = await pg.queryOne(
    `INSERT INTO doni_pendenti (wallet, importo, livello, tipo_uscita, status, dettagli)
     VALUES ($1, $2, $3, $4, 'PENDING', $5) RETURNING *`,
    [w, importo, livello, tipoUscita, JSON.stringify(dettagli)]
  );

  // Invia messaggio all'utente
  await inviaMessaggio(w, {
    subject: `🎁 Dono pronto da ${livelloNome}!`,
    content: `Hai un dono di ${importo} USDC pronto da ${livelloNome}! Clicca "ACCETTA DONO" nella dashboard per riceverlo. Hai 90 giorni per accettare.`,
    type: 'gift_ready',
    giftId: dono.id,
  });

  console.log(`🎁 [GiftManager] Dono pendente creato: ${importo} USDC per ${w.substring(0, 10)} da ${livelloNome} (scade tra 90 giorni)`);
  return dono;
}

// ════════════════════════════════════════════════════════════════════
// ACCETTAZIONE DONO
// ════════════════════════════════════════════════════════════════════

/**
 * L'utente accetta un dono pendente. Il payout viene eseguito.
 *
 * @param {number} donoId - ID del dono pendente
 * @param {string} wallet - Wallet che accetta (deve corrispondere)
 * @returns {Object} Risultato accettazione
 */
async function accettaDono(donoId, wallet) {
  const w = wallet.toLowerCase();

  // Recupera dono
  const dono = await pg.queryOne(
    `SELECT * FROM doni_pendenti WHERE id = $1 AND wallet = $2 AND status = 'PENDING'`,
    [donoId, w]
  );

  if (!dono) {
    throw new Error('Dono non trovato, già accettato o scaduto');
  }

  // Verifica scadenza
  if (new Date(dono.expires_at) < new Date()) {
    await pg.query(`UPDATE doni_pendenti SET status = 'EXPIRED', expired_at = NOW() WHERE id = $1`, [donoId]);
    throw new Error('Dono scaduto — i 90 giorni sono trascorsi');
  }

  // Accetta: aggiorna status
  const txHash = `ACCEPTED_${w}_${Date.now()}`;
  await pg.query(
    `UPDATE doni_pendenti SET status = 'ACCEPTED', accepted_at = NOW(), tx_hash = $1 WHERE id = $2`,
    [txHash, donoId]
  );

  // Esegui il payout reale
  await pg.queryOne(
    `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, livello, turno, status)
     VALUES ('SISTEMA', $1, $2, $3, $4, $5, NULL, 'COMPLETATA') RETURNING *`,
    [dono.importo, txHash, dono.tipo_uscita, w, dono.livello]
  );

  // Registra on-chain
  try {
    const chainRegistrar = require('./chain-registrar');
    chainRegistrar.registerPayout(w, Number(dono.importo), dono.livello, txHash);
  } catch (_) {}

  // Messaggio conferma
  const livelloNomi = { 3: 'Venere', 5: 'Saturno', 6: 'Nettuno', 4: 'Giove' };
  await inviaMessaggio(w, {
    subject: `✅ Dono accettato!`,
    content: `Hai accettato il dono di ${dono.importo} USDC da ${livelloNomi[dono.livello] || 'Sistema'}. Il dono è stato distribuito al tuo wallet.`,
    type: 'gift_accepted',
    giftId: donoId,
  });

  console.log(`✅ [GiftManager] Dono #${donoId} ACCETTATO: ${dono.importo} USDC → ${w.substring(0, 10)}`);
  return { success: true, donoId, importo: Number(dono.importo), wallet: w };
}

// ════════════════════════════════════════════════════════════════════
// SCADENZA DONI (JOB PERIODICO)
// ════════════════════════════════════════════════════════════════════

/**
 * Controlla e scade i doni non accettati dopo 90 giorni.
 * I doni scaduti vanno in CASSA ROG.
 */
async function processaScadenze() {
  const scaduti = await pg.queryMany(
    `UPDATE doni_pendenti SET status = 'EXPIRED', expired_at = NOW()
     WHERE status = 'PENDING' AND expires_at < NOW()
     RETURNING *`
  );

  for (const dono of scaduti) {
    // Registra il dono in cassa ROG
    await pg.queryOne(
      `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, livello, turno, status)
       VALUES ('SISTEMA', $1, $2, 'EXPIRED_TO_CASSA', $3, $4, NULL, 'COMPLETATA') RETURNING *`,
      [dono.importo, `EXPIRED_${dono.id}_${Date.now()}`, CASSA_ROG_WALLET, dono.livello]
    );

    // Messaggio all'utente
    await inviaMessaggio(dono.wallet, {
      subject: `⏰ Dono scaduto`,
      content: `Il dono di ${dono.importo} USDC è scaduto dopo 90 giorni senza essere accettato. L'importo è stato trasferito alla cassa ROG.`,
      type: 'gift_expired',
      giftId: dono.id,
    });

    console.log(`⏰ [GiftManager] Dono #${dono.id} SCADUTO: ${dono.importo} USDC → CASSA ROG (${dono.wallet.substring(0, 10)})`);
  }

  if (scaduti.length > 0) {
    console.log(`⏰ [GiftManager] ${scaduti.length} doni scaduti processati → CASSA ROG`);
  }

  return scaduti.length;
}

// ════════════════════════════════════════════════════════════════════
// MESSAGGISTICA INTERNA
// ════════════════════════════════════════════════════════════════════

/**
 * Invia un messaggio sistema a un utente.
 */
async function inviaMessaggio(wallet, { subject, content, type = 'system', giftId = null }) {
  return pg.queryOne(
    `INSERT INTO messaggi (recipient_wallet, sender, subject, content, type, gift_id)
     VALUES ($1, 'SISTEMA', $2, $3, $4, $5) RETURNING *`,
    [wallet.toLowerCase(), subject, content, type, giftId]
  );
}

/**
 * Recupera messaggi per un wallet (più recenti prima).
 */
async function getMessaggi(wallet, limit = 50) {
  return pg.queryMany(
    `SELECT * FROM messaggi WHERE recipient_wallet = $1 ORDER BY created_at DESC LIMIT $2`,
    [wallet.toLowerCase(), limit]
  );
}

/**
 * Segna messaggi come letti.
 */
async function segnaLetti(wallet, messageIds) {
  if (!messageIds?.length) return;
  await pg.query(
    `UPDATE messaggi SET read = TRUE WHERE recipient_wallet = $1 AND id = ANY($2)`,
    [wallet.toLowerCase(), messageIds]
  );
}

/**
 * Conta messaggi non letti.
 */
async function contaNonLetti(wallet) {
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS count FROM messaggi WHERE recipient_wallet = $1 AND read = FALSE`,
    [wallet.toLowerCase()]
  );
  return Number(row?.count) || 0;
}

// ════════════════════════════════════════════════════════════════════
// QUERY
// ════════════════════════════════════════════════════════════════════

/**
 * Recupera doni pendenti per un wallet.
 */
async function getDoniPendenti(wallet) {
  return pg.queryMany(
    `SELECT *, 
       EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS giorni_rimanenti
     FROM doni_pendenti 
     WHERE wallet = $1 AND status = 'PENDING' 
     ORDER BY created_at ASC`,
    [wallet.toLowerCase()]
  );
}

/**
 * Recupera storico doni (tutti gli status).
 */
async function getStoricoDoni(wallet) {
  return pg.queryMany(
    `SELECT * FROM doni_pendenti WHERE wallet = $1 ORDER BY created_at DESC LIMIT 50`,
    [wallet.toLowerCase()]
  );
}

// ════════════════════════════════════════════════════════════════════
// JOB PERIODICO
// ════════════════════════════════════════════════════════════════════

let expiryTimer = null;

function avviaControlloScadenze() {
  if (expiryTimer) return;
  expiryTimer = setInterval(async () => {
    try { await processaScadenze(); } catch (e) { console.error('⏰ [GiftManager] Errore scadenze:', e.message); }
  }, GIFT_CHECK_INTERVAL_MS);
  console.log(`🎁 [GiftManager] Controllo scadenze attivo (ogni ${GIFT_CHECK_INTERVAL_MS / 60000} min)`);
}

// Auto-start
initGiftTables().then(() => avviaControlloScadenze()).catch(e => console.error('🎁 [GiftManager] Init errore:', e.message));

module.exports = {
  creaDonoPendente,
  accettaDono,
  processaScadenze,
  getDoniPendenti,
  getStoricoDoni,
  inviaMessaggio,
  getMessaggi,
  segnaLetti,
  contaNonLetti,
  initGiftTables,
  GIFT_EXPIRY_DAYS,
};
