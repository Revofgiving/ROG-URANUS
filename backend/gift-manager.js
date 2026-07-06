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

const crypto = require('crypto');
const pg = require('./pg-connection-manager');
const { URANUS_CASSA_WALLET } = require('./wallet-cassa'); // 🏛️ UNICO riferimento cassa Uranus

// ── COSTANTI ──────────────────────────────────────────────────────

const GIFT_EXPIRY_DAYS = 180;                  // 6 mesi per ritirare il dono
const GIFT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Controlla scadenze ogni ora
const READY_CHECK_INTERVAL_MS = 60 * 1000;     // Notifica "dono pronto" ogni 60s
// Cassa URANUS: i doni non ritirati restano qui (i fondi non escono mai senza ACCETTA DONO).
const CASSA_URANUS_WALLET = URANUS_CASSA_WALLET;

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

  // Migrazione idempotente: chiave evento per impedire doni DUPLICATI sulla stessa uscita
  // (redeploy / riesecuzione cascata FIFO). I record storici restano con event_key NULL
  // e in PostgreSQL i NULL non collidono nell'indice UNIQUE → nessun conflitto in migrazione.
  await pg.query(`ALTER TABLE doni_pendenti ADD COLUMN IF NOT EXISTS event_key TEXT`);
  await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_doni_event_key ON doni_pendenti(event_key)`);

  // Tabella audit (NUOVA, additiva): traccia le correzioni amministrative del wallet di un
  // singolo dono PENDING. Non modifica alcuna tabella esistente.
  await pg.query(`
    CREATE TABLE IF NOT EXISTS doni_wallet_corrections (
      id SERIAL PRIMARY KEY,
      dono_id INTEGER NOT NULL,
      vecchio_wallet TEXT NOT NULL,
      nuovo_wallet TEXT NOT NULL,
      admin TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('🎁 [GiftManager] Tabelle doni_pendenti + messaggi pronte');
}
/**
 * Recupera doni pendenti per area admin (tutti i wallet).
 * Include check sintetici per prevenire doppio payout.
 */
async function getDoniPendentiAdmin({ limit = 200, offset = 0 } = {}) {
  const [doni, duplicates] = await Promise.all([
    pg.queryMany(
      `SELECT * FROM doni_pendenti WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    pg.queryMany(
      `SELECT event_key, COUNT(*)::int AS cnt
       FROM doni_pendenti
       WHERE event_key IS NOT NULL
       GROUP BY event_key`
    )
  ]);
  const dupMap = new Map(duplicates.map(d => [d.event_key, Number(d.cnt)]));
  return doni.map(d => {
    const numeroUscita = d.dettagli?.numeroUscita || null;
    const turnoMatch = typeof numeroUscita === 'string' ? /L3-turno-(\d+)/.exec(numeroUscita) : null;
    const turno = turnoMatch ? Number(turnoMatch[1]) : null;
    return {
    ...d,
    priority: d.id === 3 ? 'HIGH' : 'NORMAL',
    l3_turno: turno,
    causale: d.dettagli?.causale || null,
    checks: {
      status_pending: d.status === 'PENDING',
      tx_hash_null: !d.tx_hash,
      importo_480: Number(d.importo) === 480,
      event_key_unique: d.event_key ? (dupMap.get(d.event_key) || 0) === 1 : false,
    }
  };
  });
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

  // ── IDEMPOTENZA: event_key univoca-per-evento e stabile-per-replay ──
  // Discriminatore evento:
  //  • Nettuno passa dettagli.numeroUscita (id uscita FIFO) → già univoco.
  //  • L3/L4/L5 NON ricevono il turno: usiamo come sequenza il numero di doni GIÀ
  //    CONCLUSI (ACCEPTED/EXPIRED) per la stessa (wallet, livello, tipo_uscita).
  //    Resta stabile durante un replay (il dono in corso è PENDING → non contato)
  //    e cresce solo dopo la chiusura del precedente, distinguendo un'uscita
  //    legittima futura da una semplice riesecuzione/redeploy.
  let discriminatore;
  if (dettagli && dettagli.numeroUscita != null) {
    discriminatore = `u:${dettagli.numeroUscita}`;
  } else {
    const seqRow = await pg.queryOne(
      `SELECT COUNT(*)::int AS n FROM doni_pendenti
       WHERE wallet = $1 AND livello = $2 AND tipo_uscita = $3
         AND status IN ('ACCEPTED', 'EXPIRED')`,
      [w, livello, tipoUscita]
    );
    discriminatore = `s:${seqRow ? seqRow.n : 0}`;
  }
  const eventKey = crypto
    .createHash('sha256')
    .update(`${w}|${livello}|${tipoUscita}|${Number(importo)}|${discriminatore}`)
    .digest('hex');

  // Crea dono pendente (scadenza cablata su GIFT_EXPIRY_DAYS: unica fonte di verità).
  // ON CONFLICT (event_key) DO NOTHING → redeploy/replay cascata non creano un secondo dono.
  const dono = await pg.queryOne(
    `INSERT INTO doni_pendenti (wallet, importo, livello, tipo_uscita, status, expires_at, dettagli, event_key)
     VALUES ($1, $2, $3, $4, 'PENDING', NOW() + ($6 || ' days')::interval, $5, $7)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [w, importo, livello, tipoUscita, JSON.stringify(dettagli), String(GIFT_EXPIRY_DAYS), eventKey]
  );

  // Conflitto: dono già presente per questa esatta uscita. Idempotente: nessun secondo
  // record e NESSUN secondo messaggio. Restituiamo il record esistente.
  if (!dono) {
    const esistente = await pg.queryOne(`SELECT * FROM doni_pendenti WHERE event_key = $1`, [eventKey]);
    console.log(`🎁 [GiftManager] Dono già presente per ${w.substring(0, 10)} ${tipoUscita} (event_key) — creazione duplicata ignorata`);
    return esistente;
  }

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

// Finestra di approvazione Isa (mod 4A): attiva finche now < GIFT_APPROVAL_UNTIL (ISO).
// Se la env non e impostata o non e una data valida -> gate DISATTIVO (flusso normale).
function isApprovalWindowActive() {
  const until = process.env.GIFT_APPROVAL_UNTIL;
  if (!until) return false;
  const t = Date.parse(until);
  if (isNaN(t)) return false;
  return Date.now() < t;
}

// Esegue il pagamento reale di un dono gia in stato PROCESSING e lo finalizza (ACCEPTED,
// bookkeeping, registro on-chain, messaggio). NON gestisce il revert su fallimento: e
// responsabilita del chiamante. Usato da approvaDono (mod 4A).
async function _eseguiPayoutDono(dono) {
  const w = String(dono.wallet).toLowerCase();
  const donoId = dono.id;
  let payout;
  try {
    const payoutMgr = require('./payout-manager');
    payout = await payoutMgr.inviaPagamento(w, Number(dono.importo), `${dono.tipo_uscita} dono #${donoId}`);
  } catch (e) {
    payout = { success: false, error: e.message };
  }
  if (!payout.success) return { success: false, error: payout.error };
  const txHash = payout.txHash;
  await pg.query(
    `UPDATE doni_pendenti SET status = 'ACCEPTED', accepted_at = NOW(), tx_hash = $1 WHERE id = $2`,
    [txHash, donoId]
  );
  await pg.queryOne(
    `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, livello, turno, status)
     VALUES ('SISTEMA', $1, $2, $3, $4, $5, NULL, 'COMPLETATA') RETURNING *`,
    [dono.importo, txHash, dono.tipo_uscita, w, dono.livello]
  );
  try {
    const chainRegistrar = require('./chain-registrar');
    chainRegistrar.registerPayout(w, Number(dono.importo), dono.livello, txHash);
  } catch (_) {}
  const livelloNomi = { 3: 'Venere', 5: 'Saturno', 6: 'Nettuno', 4: 'Giove' };
  await inviaMessaggio(w, {
    subject: `✅ Dono accettato!`,
    content: `Hai ricevuto il dono di ${dono.importo} USDC da ${livelloNomi[dono.livello] || 'Sistema'}. Distribuito al tuo wallet (tx: ${txHash}).`,
    type: 'gift_accepted',
    giftId: donoId,
  });
  console.log(`✅ [GiftManager] Dono #${donoId} pagato: ${dono.importo} USDC -> ${w.substring(0, 10)} (tx ${txHash})`);
  return { success: true, donoId, importo: Number(dono.importo), wallet: w, txHash };
}

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
      throw new Error('Dono scaduto — i 180 giorni sono trascorsi');
    }
    throw new Error('Dono non trovato, già accettato o in elaborazione');
  }

  // Guard-rail: evita doppio payout su stesso event_key o record già con tx_hash
  if (dono.tx_hash) {
    await pg.query(`UPDATE doni_pendenti SET status = 'PENDING' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
    throw new Error('Dono già associato a tx_hash — payout bloccato');
  }
  if (dono.event_key) {
    const dup = await pg.queryOne(
      `SELECT id FROM doni_pendenti
       WHERE event_key = $1 AND id <> $2 AND status IN ('ACCEPTED','PROCESSING')`,
      [dono.event_key, donoId]
    );
    if (dup) {
      await pg.query(`UPDATE doni_pendenti SET status = 'PENDING' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
      throw new Error('Event key già completata — payout bloccato');
    }
  }

  // 🔐 GATE APPROVAZIONE ISA (mod 4A): durante la finestra (GIFT_APPROVAL_UNTIL) il dono
  // NON parte subito: va in ATTESA_APPROVAZIONE e viene inviato solo col "si" di Isa su
  // Telegram. Non blocca nient'altro: riguarda solo questo dono.
  if (isApprovalWindowActive()) {
    await pg.query(`UPDATE doni_pendenti SET status = 'ATTESA_APPROVAZIONE' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
    try {
      require('./alert-manager').inviaApprovazioneDono({ donoId, wallet: w, importo: Number(dono.importo), tipoUscita: dono.tipo_uscita });
    } catch (_) {}
    await inviaMessaggio(w, {
      subject: `⏳ Dono in verifica`,
      content: `Il tuo dono di ${dono.importo} USDC e in fase di verifica di sicurezza e verra inviato a breve, dopo l'approvazione. Non serve fare altro.`,
      type: 'gift_pending_approval',
      giftId: donoId,
    });
    console.log(`🟡 [GiftManager] Dono #${donoId} in ATTESA_APPROVAZIONE - ${w.substring(0, 10)}`);
    return { success: true, donoId, pendingApproval: true, message: 'In attesa di approvazione di sicurezza (Isa)' };
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

// ── APPROVAZIONE / RIFIUTO DONO (mod 4A, via Telegram) ──
// Isa approva l'invio: claim ATOMICO ATTESA_APPROVAZIONE->PROCESSING, poi payout reale.
async function approvaDono(donoId) {
  const dono = await pg.queryOne(
    `UPDATE doni_pendenti SET status = 'PROCESSING' WHERE id = $1 AND status = 'ATTESA_APPROVAZIONE' RETURNING *`,
    [donoId]
  );
  if (!dono) {
    const row = await pg.queryOne(`SELECT status FROM doni_pendenti WHERE id = $1`, [donoId]);
    return { success: false, alreadyHandled: true, status: row ? row.status : 'NOT_FOUND' };
  }
  if (dono.tx_hash) {
    await pg.query(`UPDATE doni_pendenti SET status = 'ATTESA_APPROVAZIONE' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
    return { success: false, error: 'Dono già associato a tx_hash' };
  }
  if (dono.event_key) {
    const dup = await pg.queryOne(
      `SELECT id FROM doni_pendenti
       WHERE event_key = $1 AND id <> $2 AND status IN ('ACCEPTED','PROCESSING')`,
      [dono.event_key, donoId]
    );
    if (dup) {
      await pg.query(`UPDATE doni_pendenti SET status = 'ATTESA_APPROVAZIONE' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
      return { success: false, error: 'Event key già completata' };
    }
  }
  const res = await _eseguiPayoutDono(dono);
  if (!res.success) {
    await pg.query(`UPDATE doni_pendenti SET status = 'ATTESA_APPROVAZIONE' WHERE id = $1 AND status = 'PROCESSING'`, [donoId]);
    return { success: false, error: res.error };
  }
  return res;
}

// Isa rifiuta/sospende: il dono torna PENDING (potra essere riproposto in seguito).
async function rifiutaDono(donoId) {
  const dono = await pg.queryOne(
    `UPDATE doni_pendenti SET status = 'PENDING' WHERE id = $1 AND status = 'ATTESA_APPROVAZIONE' RETURNING *`,
    [donoId]
  );
  if (!dono) {
    const row = await pg.queryOne(`SELECT status FROM doni_pendenti WHERE id = $1`, [donoId]);
    return { success: false, alreadyHandled: true, status: row ? row.status : 'NOT_FOUND' };
  }
  try {
    await inviaMessaggio(dono.wallet, {
      subject: `Dono in sospeso`,
      content: `Il tuo dono di ${dono.importo} USDC e temporaneamente in sospeso per una verifica. Potrai riprovare piu tardi.`,
      type: 'gift_hold',
      giftId: donoId,
    });
  } catch (_) {}
  return { success: true, donoId, status: 'PENDING' };
}

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
    const liv = ({ 3: 'Venere', 4: 'Giove', 5: 'Saturno', 6: 'Nettuno' })[dono.livello] || 'Sistema';
    await inviaMessaggio(dono.wallet, {
      subject: `🎁 Dono #${dono.id} pronto — ${Number(dono.importo).toFixed(0)} USDC`,
      content: `Il tuo dono #${dono.id} da ${liv} è pronto: ${Number(dono.importo).toFixed(0)} USDC verranno versati nel tuo wallet. Clicca "ACCETTA DONO" per riceverlo (il bottone si è illuminato), entro la scadenza del countdown.`,
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
 * Controlla e scade i doni non accettati dopo 180 giorni.
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
 * Normalizza paginazione.
 */
function normalizePagination({ page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;
  return { page: safePage, pageSize: safePageSize, offset };
}

/**
 * Recupera messaggi per un wallet (più recenti prima), con paginazione.
 */
async function getMessaggi(wallet, options = {}) {
  const { page, pageSize, offset } = normalizePagination(options);
  const recipient = wallet.toLowerCase();
  const [messaggi, totalRow] = await Promise.all([
    pg.queryMany(
      `SELECT * FROM messaggi WHERE recipient_wallet = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [recipient, pageSize, offset]
    ),
    pg.queryOne(`SELECT COUNT(*)::int AS total FROM messaggi WHERE recipient_wallet = $1`, [recipient]),
  ]);
  const total = Number(totalRow?.total) || 0;
  return {
    items: messaggi,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
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
 * Recupera doni pendenti per un wallet (paginati).
 */
async function getDoniPendenti(wallet, options = {}) {
  const { page, pageSize, offset } = normalizePagination(options);
  const w = wallet.toLowerCase();
  const [doni, totalRow] = await Promise.all([
    pg.queryMany(
      `SELECT *, 
       EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS giorni_rimanenti
     FROM doni_pendenti 
     WHERE wallet = $1 AND status = 'PENDING' 
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
      [w, pageSize, offset]
    ),
    pg.queryOne(
      `SELECT COUNT(*)::int AS total FROM doni_pendenti WHERE wallet = $1 AND status = 'PENDING'`,
      [w]
    ),
  ]);
  if (!doni.length) {
    const total = Number(totalRow?.total) || 0;
    return {
      items: [],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
  // "pronto" = il dono è distribuibile ORA, cioè i fondi sono già presenti nel
  // wallet cassa URANUS (saldo ≥ importo). Il bottone "ACCETTA DONO" è cliccabile
  // solo quando pronto === true. Se il saldo non è leggibile → pronto false (gate
  // finale comunque applicato in accettaDono).
  let saldoCassa = null;
  try { saldoCassa = await require('./payout-manager').getSaldoTreasury(); } catch (_) {}
  const total = Number(totalRow?.total) || 0;
  return {
    items: doni.map(d => ({
      ...d,
      saldoCassa,
      pronto: saldoCassa == null ? false : Number(saldoCassa) >= Number(d.importo),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/**
 * Recupera storico doni (tutti gli status), con paginazione.
 */
async function getStoricoDoni(wallet, options = {}) {
  const { page, pageSize, offset } = normalizePagination(options);
  const w = wallet.toLowerCase();
  const [storico, totalRow] = await Promise.all([
    pg.queryMany(
      `SELECT * FROM doni_pendenti WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [w, pageSize, offset]
    ),
    pg.queryOne(`SELECT COUNT(*)::int AS total FROM doni_pendenti WHERE wallet = $1`, [w]),
  ]);
  const total = Number(totalRow?.total) || 0;
  return {
    items: storico,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// CORREZIONE AMMINISTRATIVA WALLET (SINGOLO DONO, SOLO PENDING)
// ════════════════════════════════════════════════════════════════════

/**
 * Corregge il wallet destinatario di UN SINGOLO dono, consentito SOLO se status='PENDING'.
 * Operazione amministrativa puntuale: nessun update massivo, nessun cascade, nessuna modifica
 * ad accounts.wallet o ad altre tabelle. NON tocca event_key. Esegue in transazione e registra
 * un audit log (vecchio/nuovo wallet, id dono, admin, timestamp).
 *
 * @param {number} donoId - ID del dono da correggere
 * @param {string} nuovoWallet - Nuovo wallet destinatario (0x...)
 * @param {string} adminId - Identificativo dell'admin che esegue (per audit)
 * @returns {Object} esito con vecchio/nuovo wallet
 */
async function correggiWalletDonoPending(donoId, nuovoWallet, adminId) {
  if (!nuovoWallet || !/^0x[a-fA-F0-9]{40}$/.test(nuovoWallet)) {
    throw new Error('Nuovo wallet non valido');
  }
  const nuovo = nuovoWallet.toLowerCase();

  return pg.transaction(async () => {
    // Lock di riga + lettura stato corrente: blocca race con accettaDono (PENDING→PROCESSING).
    const corrente = await pg.queryOne(
      `SELECT id, wallet, status FROM doni_pendenti WHERE id = $1 FOR UPDATE`,
      [donoId]
    );
    if (!corrente) throw new Error(`Dono #${donoId} non trovato`);
    // Consentito SOLO su PENDING. PROCESSING/ACCEPTED/EXPIRED non possono essere modificati.
    if (corrente.status !== 'PENDING') {
      throw new Error(`Correzione non consentita: dono #${donoId} in stato ${corrente.status} (ammesso solo PENDING)`);
    }
    const vecchioWallet = corrente.wallet;

    // UPDATE solo della colonna wallet (event_key invariata). Doppio gate su status='PENDING'.
    const aggiornato = await pg.queryOne(
      `UPDATE doni_pendenti SET wallet = $2 WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [donoId, nuovo]
    );

    // Audit log (stessa transazione): se fallisce, rollback anche della correzione.
    await pg.query(
      `INSERT INTO doni_wallet_corrections (dono_id, vecchio_wallet, nuovo_wallet, admin)
       VALUES ($1, $2, $3, $4)`,
      [donoId, vecchioWallet, nuovo, adminId || 'ADMIN']
    );

    console.log(`🔧 [GiftManager] Correzione wallet dono #${donoId}: ${vecchioWallet} → ${nuovo} (admin: ${adminId || 'ADMIN'})`);
    return { success: true, donoId, vecchioWallet, nuovoWallet: nuovo, status: aggiornato.status };
  });
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
  approvaDono,
  rifiutaDono,
  isApprovalWindowActive,
  notificaDoniPronti,
  processaScadenze,
  getDoniPendenti,
  getDoniPendentiAdmin,
  getStoricoDoni,
  correggiWalletDonoPending,
  inviaMessaggio,
  getMessaggi,
  segnaLetti,
  contaNonLetti,
  initGiftTables,
  GIFT_EXPIRY_DAYS,
};
