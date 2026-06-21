/**
 * 🎁 URANUS — Gift Manager (Doni Pendenti)
 *
 * Gestisce il flusso "ACCETTA DONO":
 *   1. Quando un dono è pronto (uscita L3, L5, Nettuno), NON viene pagato subito
 *   2. Viene creato un DONO PENDENTE nel DB
 *   3. L'utente vede il bottone "ACCETTA DONO" illuminato nella dashboard
 *   4. L'utente clicca → il dono viene distribuito
 *   5. Se dopo 6 MESI nessuno clicca → il dono resta definitivamente in cassa URANUS
 *
 * MESSAGGISTICA:
 *   Ogni evento genera un messaggio nella chat interna dell'utente.
 */
'use strict';

const pg = require('./pg-connection-manager');

// ── COSTANTI ──────────────────────────────────────────────────────

const GIFT_EXPIRY_DAYS = 180;                  // 6 mesi per ritirare il dono
const GIFT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Controlla scadenze ogni ora
const READY_CHECK_INTERVAL_MS = 60 * 1000;     // Notifica "dono pronto" ogni 60s
const CASSA_ROG_WALLET = process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';
// Cassa URANUS: i doni non ritirati restano qui (i fondi non escono mai senza ACCETTA DONO).
const CASSA_URANUS_WALLET = process.env.URANO_FUND_WALLET || process.env.CASSA_WALLET || '0x0000000000000000000000000000000000000002';

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
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days'),
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

  // Migrazione idempotente: flag per notificare UNA sola volta quando il dono è pronto (fondi in cassa).
  await pg.query(`ALTER TABLE doni_pendenti ADD COLUMN IF NOT EXISTS pronto_notificato BOOLEAN DEFAULT FALSE`);

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

  // Crea dono pendente (scadenza cablata su GIFT_EXPIRY_DAYS: unica fonte di verità)
  const dono = await pg.queryOne(
    `INSERT INTO doni_pendenti (wallet, importo, livello, tipo_uscita, status, expires_at, dettagli)
     VALUES ($1, $2, $3, $4, 'PENDING', NOW() + ($6 || ' days')::interval, $5) RETURNING *`,
    [w, importo, livello, tipoUscita, JSON.stringify(dettagli), String(GIFT_EXPIRY_DAYS)]
  );

  // A creazione il dono è solo "in arrivo": i fondi potrebbero non essere ancora in cassa.
  // Il messaggio "dono pronto" + l'illuminazione del bottone arrivano dopo, quando il saldo
  // cassa copre l'importo (vedi notificaDoniPronti).
  await inviaMessaggio(w, {
    subject: `🎁 Nuovo dono in arrivo da ${livelloNome}`,
    content: `Hai un dono di ${importo} USDC da ${livelloNome} in arrivo. Ti avviseremo quando sarà pronto per il ritiro e il bottone "ACCETTA DONO" si illuminerà. Hai 6 mesi per ritirarlo.`,
    type: 'gift_incoming',
    giftId: dono.id,
  });

  console.log(`🎁 [GiftManager] Dono pendente creato: ${importo} USDC per ${w.substring(0, 10)} da ${livelloNome} (scade tra ${GIFT_EXPIRY_DAYS} giorni)`);
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

  // CLAIM ATOMICO PENDING→PROCESSING: solo chi vince procede al pagamento reale.
  // Evita doppio invio / race condition su un'operazione che muove USDC veri.
  const dono = await pg.queryOne(
    `UPDATE doni_pendenti SET status = 'PROCESSING'
     WHERE id = $1 AND wallet = $2 AND status = 'PENDING' AND expires_at > NOW()
     RETURNING *`,
    [donoId, w]
  );
  if (!dono) {
    const row = await pg.queryOne(`SELECT status, expires_at FROM doni_pendenti WHERE id = $1 AND wallet = $2`, [donoId, w]);
    if (row && row.status === 'PENDING' && new Date(row.expires_at) < new Date()) {
      await pg.query(`UPDATE doni_pendenti SET status = 'EXPIRED', expired_at = NOW() WHERE id = $1 AND status = 'PENDING'`, [donoId]);
      throw new Error('Dono scaduto — i 90 giorni sono trascorsi');
    }
    throw new Error('Dono non trovato, già accettato o in elaborazione');
  }

  // 💸 PAYOUT REALE on-chain dalla cassa URANUS. Il bottone "ACCETTA DONO" distribuisce
  // automaticamente: se i fondi NON sono ancora presenti in cassa (balanceOf < importo),
  // inviaPagamento fallisce e il dono torna PENDING (ritentabile). Niente doppio invio.
  let payout;
  try {
    const payoutMgr = require('./payout-manager');
    payout = await payoutMgr.inviaPagamento(w, Number(dono.importo), `${dono.tipo_uscita} dono #${donoId}`);
  } catch (e) {
    payout = { success: false, error: e.message };
  }
  if (!payout.success) {
    await pg.query(`UPDATE doni_pendenti SET status = 'PENDING' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
    throw new Error(`Dono non ancora distribuibile (fondi non disponibili in cassa URANUS): ${payout.error || 'saldo insufficiente'}`);
  }
  const txHash = payout.txHash;

  // Pagamento riuscito → marca ACCETTATO con la transazione reale
  await pg.query(
    `UPDATE doni_pendenti SET status = 'ACCEPTED', accepted_at = NOW(), tx_hash = $1 WHERE id = $2`,
    [txHash, donoId]
  );

  // Bookkeeping interno
  await pg.queryOne(
    `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, livello, turno, status)
     VALUES ('SISTEMA', $1, $2, $3, $4, $5, NULL, 'COMPLETATA') RETURNING *`,
    [dono.importo, txHash, dono.tipo_uscita, w, dono.livello]
  );

  // Registro on-chain (record della distribuzione)
  try {
    const chainRegistrar = require('./chain-registrar');
    chainRegistrar.registerPayout(w, Number(dono.importo), dono.livello, txHash);
  } catch (_) {}

  // Messaggio conferma
  const livelloNomi = { 3: 'Venere', 5: 'Saturno', 6: 'Nettuno', 4: 'Giove' };
  await inviaMessaggio(w, {
    subject: `✅ Dono accettato!`,
    content: `Hai accettato il dono di ${dono.importo} USDC da ${livelloNomi[dono.livello] || 'Sistema'}. Il dono è stato distribuito al tuo wallet (tx: ${txHash}).`,
    type: 'gift_accepted',
    giftId: donoId,
  });

  console.log(`✅ [GiftManager] Dono #${donoId} ACCETTATO + pagato: ${dono.importo} USDC → ${w.substring(0, 10)} (tx ${txHash})`);
  return { success: true, donoId, importo: Number(dono.importo), wallet: w, txHash };
}

// ════════════════════════════════════════════════════════════════════
// NOTIFICA "DONO PRONTO" (quando i fondi sono in cassa)
// ════════════════════════════════════════════════════════════════════

/**
 * Invia UNA sola volta il messaggio "dono pronto per te!" per ogni dono PENDING
 * diventato distribuibile (fondi presenti in cassa URANUS: saldo ≥ importo),
 * in sincronia con l'illuminazione del bottone ACCETTA DONO. Dedup via colonna
 * pronto_notificato.
 */
async function notificaDoniPronti() {
  let saldo = null;
  try { saldo = await require('./payout-manager').getSaldoTreasury(); } catch (_) {}
  if (saldo == null) return 0;
  const pronti = await pg.queryMany(
    `SELECT * FROM doni_pendenti
     WHERE status = 'PENDING' AND pronto_notificato = FALSE AND importo <= $1`,
    [saldo]
  );
  for (const dono of pronti) {
    await inviaMessaggio(dono.wallet, {
      subject: `🎁 Dono pronto per te!`,
      content: `Dono pronto per te! Per riceverlo direttamente nel tuo wallet clicca il bottone che si è appena illuminato!!!`,
      type: 'gift_ready',
      giftId: dono.id,
    });
    await pg.query(`UPDATE doni_pendenti SET pronto_notificato = TRUE WHERE id = $1`, [dono.id]);
    console.log(`🎁 [GiftManager] Notifica "dono pronto" → ${dono.wallet.substring(0, 10)} (#${dono.id}, ${dono.importo} USDC)`);
  }
  return pronti.length;
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
    // Non ritirato entro 6 mesi: l'importo non è MAI uscito dalla cassa (transfer solo
    // su ACCETTA DONO) → resta DEFINITIVAMENTE in cassa URANUS. Registriamo il forfeit.
    await pg.queryOne(
      `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, livello, turno, status)
       VALUES ('SISTEMA', $1, $2, 'EXPIRED_RESTA_CASSA_URANUS', $3, $4, NULL, 'COMPLETATA') RETURNING *`,
      [dono.importo, `EXPIRED_${dono.id}_${Date.now()}`, CASSA_URANUS_WALLET, dono.livello]
    );

    // Messaggio all'utente
    await inviaMessaggio(dono.wallet, {
      subject: `⏰ Dono scaduto`,
      content: `Il dono di ${dono.importo} USDC è scaduto dopo 6 mesi senza essere ritirato. L'importo resta definitivamente nella cassa URANUS.`,
      type: 'gift_expired',
      giftId: dono.id,
    });

    console.log(`⏰ [GiftManager] Dono #${dono.id} SCADUTO: ${dono.importo} USDC resta in cassa URANUS (${dono.wallet.substring(0, 10)})`);
  }

  if (scaduti.length > 0) {
    console.log(`⏰ [GiftManager] ${scaduti.length} doni scaduti → restano in cassa URANUS`);
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
  const doni = await pg.queryMany(
    `SELECT *, 
       EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS giorni_rimanenti
     FROM doni_pendenti 
     WHERE wallet = $1 AND status = 'PENDING' 
     ORDER BY created_at ASC`,
    [wallet.toLowerCase()]
  );
  if (!doni.length) return doni;
  // "pronto" = il dono è distribuibile ORA, cioè i fondi sono già presenti nel
  // wallet cassa URANUS (saldo ≥ importo). Il bottone "ACCETTA DONO" è cliccabile
  // solo quando pronto === true. Se il saldo non è leggibile → pronto false (gate
  // finale comunque applicato in accettaDono).
  let saldoCassa = null;
  try { saldoCassa = await require('./payout-manager').getSaldoTreasury(); } catch (_) {}
  return doni.map(d => ({
    ...d,
    saldoCassa,
    pronto: saldoCassa == null ? false : Number(saldoCassa) >= Number(d.importo),
  }));
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
let readyTimer = null;

function avviaControlloScadenze() {
  if (expiryTimer) return;
  expiryTimer = setInterval(async () => {
    try { await processaScadenze(); } catch (e) { console.error('⏰ [GiftManager] Errore scadenze:', e.message); }
  }, GIFT_CHECK_INTERVAL_MS);
  readyTimer = setInterval(async () => {
    try { await notificaDoniPronti(); } catch (e) { console.error('🎁 [GiftManager] Errore notifica pronti:', e.message); }
  }, READY_CHECK_INTERVAL_MS);
  console.log(`🎁 [GiftManager] Scadenze (${GIFT_CHECK_INTERVAL_MS / 60000} min) + notifica doni pronti (${READY_CHECK_INTERVAL_MS / 1000}s) attivi`);
}

// Auto-start
initGiftTables().then(() => avviaControlloScadenze()).catch(e => console.error('🎁 [GiftManager] Init errore:', e.message));

module.exports = {
  creaDonoPendente,
  accettaDono,
  notificaDoniPronti,
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
