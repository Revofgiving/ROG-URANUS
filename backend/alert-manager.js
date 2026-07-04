/**
 * 🔔 URANO v2 — Alert Manager
 *
 * Notifiche in tempo reale su Telegram (e opzionalmente WhatsApp)
 * per eventi critici della piattaforma.
 *
 * CONFIGURAZIONE (.env):
 *   TELEGRAM_BOT_TOKEN   → token del bot Telegram (da @BotFather, gratuito)
 *   TELEGRAM_CHAT_ID     → chat ID di Jonny (invia /start al bot per ottenerlo)
 *   TWILIO_SID           → [opzionale] Twilio Account SID (WhatsApp)
 *   TWILIO_TOKEN         → [opzionale] Twilio Auth Token
 *   TWILIO_WHATSAPP_FROM → [opzionale] numero WhatsApp Twilio (es. whatsapp:+14155238886)
 *   JONNY_WHATSAPP       → [opzionale] WhatsApp di Jonny (es. whatsapp:+39345...)
 *
 * COME CREARE IL BOT TELEGRAM (5 minuti, gratuito):
 *   1. Apri Telegram → cerca @BotFather → /newbot
 *   2. Dai un nome e username al bot → ricevi il TELEGRAM_BOT_TOKEN
 *   3. Avvia il bot con /start → chiama GET /api/admin/stato per vedere il tuo chat_id
 *      oppure: https://api.telegram.org/bot{TOKEN}/getUpdates
 *   4. Imposta TELEGRAM_CHAT_ID con il tuo chat_id
 *
 * LIVELLI DI ALERT:
 *   🚨 CRITICAL — azione immediata richiesta
 *   ⚠️  WARNING  — situazione anomala
 *   ℹ️  INFO     — evento importante (es. payout 6.000 USDC)
 */

const https = require('https');

// ============================================================
// TELEGRAM — API gratuita, nessuna dipendenza esterna
// ============================================================

/**
 * Invia un messaggio al bot Telegram di Jonny.
 * Silenzioso se TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID non configurati.
 *
 * @param {string} text - Testo del messaggio (supporta HTML base: <b>, <i>, <code>)
 */
async function sendTelegramAlert(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;  // non configurato, silenzioso

  const body = JSON.stringify({
    chat_id:    chatId,
    text:       text.slice(0, 4096),  // limite Telegram
    parse_mode: 'HTML'
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', (e) => {
      console.warn('[ALERT] Telegram non raggiungibile:', e.message);
      resolve();
    });
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ============================================================
// WHATSAPP — via Twilio (opzionale, richiede account Twilio)
// ============================================================

/**
 * Invia un messaggio WhatsApp tramite Twilio.
 * Silenzioso se le credenziali Twilio non sono configurate.
 *
 * @param {string} text - Testo del messaggio
 */
async function sendWhatsAppAlert(text) {
  const sid      = process.env.TWILIO_SID;
  const token    = process.env.TWILIO_TOKEN;
  const from     = process.env.TWILIO_WHATSAPP_FROM;  // es. whatsapp:+14155238886
  const to       = process.env.JONNY_WHATSAPP;        // es. whatsapp:+39345...
  if (!sid || !token || !from || !to) return;  // non configurato

  const body    = new URLSearchParams({ Body: text.slice(0, 1600), From: from, To: to });
  const payload = body.toString();
  const auth    = Buffer.from(`${sid}:${token}`).toString('base64');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
      method:   'POST',
      headers:  {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', (e) => {
      console.warn('[ALERT] WhatsApp non raggiungibile:', e.message);
      resolve();
    });
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ============================================================
// DISPATCHER CENTRALIZZATO
// ============================================================

const ICONS = {
  CRITICAL: '🚨',
  WARNING:  '⚠️',
  INFO:     'ℹ️',
  PAYOUT:   '💰',
  KYC:      '🪪',
  BLOCCO:   '🔴',
  SBLOCCO:  '🟢'
};

/**
 * Invia un alert su Telegram e (se configurato) WhatsApp.
 *
 * @param {'CRITICAL'|'WARNING'|'INFO'|'PAYOUT'|'KYC'|'BLOCCO'|'SBLOCCO'} livello
 * @param {string} evento   - Nome evento (es. 'RATE_LIMIT', 'PAYOUT_L3', 'KYC_VERIFIED')
 * @param {string} dettaglio - Dettaglio human-readable
 */
async function sendAlert(livello, evento, dettaglio) {
  const icon = ICONS[livello] || '📌';
  const ts   = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  const msg =
    `${icon} <b>URANO — ${livello}</b>\n` +
    `📌 <b>${evento}</b>\n` +
    `${dettaglio}\n` +
    `🕐 ${ts}`;

  // Log locale sempre
  console.log(`🔔 [ALERT ${livello}] ${evento} | ${dettaglio}`);

  // Invia in parallelo senza bloccare
  Promise.all([
    sendTelegramAlert(msg).catch(() => {}),
    sendWhatsAppAlert(`${icon} URANO ${livello}\n${evento}\n${dettaglio}\n${ts}`).catch(() => {})
  ]).catch(() => {});
}

// ============================================================
// ALERT PREDEFINITI (helper per i punti critici)
// ============================================================

/** Notifica payout L3 (Faraone riceve 6.000 USDC) */
function alertPayout(wallet, netto, turno) {
  sendAlert('PAYOUT',
    'PAYOUT L3',
    `Wallet: <code>${wallet.substring(0, 14)}...</code>\nNetto: <b>${netto.toLocaleString()} USDC</b>\nTurno: ${turno}`
  );
}

/** Notifica KYC verificato */
function alertKycVerificato(wallet) {
  sendAlert('KYC', 'KYC_VERIFIED', `Wallet <code>${wallet.substring(0, 14)}...</code> ha completato il KYC`);
}

/** Notifica tentativo accesso admin non autorizzato */
function alertAdminUnauthorized(ip) {
  sendAlert('CRITICAL', 'ADMIN_UNAUTHORIZED', `Tentativo accesso admin non autorizzato da IP: <code>${ip}</code>`);
}

/** Notifica rate limit raggiunto */
function alertRateLimit(ip, endpoint) {
  sendAlert('WARNING', 'RATE_LIMIT', `IP <code>${ip}</code> ha superato il rate limit su ${endpoint}`);
}

/** Notifica sistema bloccato da Jonny */
function alertSistemaBlocco(motivo) {
  sendAlert('BLOCCO', '🔴 SISTEMA BLOCCATO', `Motivo: ${motivo}`);
}

/** Notifica sistema sbloccato */
function alertSistemaRiaperto() {
  sendAlert('SBLOCCO', '🟢 SISTEMA RIAPERTO', 'Il sistema URANO è tornato operativo');
}

/** Notifica errore critico (es. fallimento payout) */
function alertErroreCritico(contesto, messaggio) {
  sendAlert('CRITICAL', `ERRORE — ${contesto}`, messaggio);
}

// ============================================================
// USCITA CASSA + APPROVAZIONE DONO (Telegram)
// ============================================================

// Helper generico POST verso Telegram Bot API (non blocca mai il chiamante).
function telegramApiPost(method, token, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); resolve(); });
    req.on('error', (e) => { console.warn('[ALERT] Telegram non raggiungibile:', e.message); resolve(); });
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

/** Alert su OGNI uscita reale di USDC dalla cassa (dono/payout distribuito). Best-effort. */
function alertUscitaCassa({ destinatario, importoUsdc, motivo = '', txHash = null }) {
  const dest  = destinatario ? String(destinatario) : 'n/a';
  const short = dest.length > 12 ? `${dest.slice(0, 8)}...${dest.slice(-4)}` : dest;
  const link  = txHash ? `\n\ud83d\udd17 https://polygonscan.com/tx/${txHash}` : '';
  const ts    = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const msg =
    `\ud83d\udcb8 <b>USCITA CASSA URANUS</b>\n` +
    `Importo: <b>${Number(importoUsdc).toLocaleString()} USDC</b>\n` +
    `Destinatario: <code>${short}</code>\n` +
    (motivo ? `Motivo: ${motivo}\n` : '') +
    `\ud83d\udd50 ${ts}${link}`;
  console.log(`\ud83d\udcb8 [ALERT USCITA] ${importoUsdc} USDC \u2192 ${short} (${motivo})`);
  sendTelegramAlert(msg).catch(() => {});
}

/** Invia a Isa un messaggio con pulsanti Approva/Rifiuta per autorizzare l'invio di un dono. */
function inviaApprovazioneDono({ donoId, wallet, importo, tipoUscita }) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();
  const dest = wallet ? `${String(wallet).slice(0, 8)}...${String(wallet).slice(-4)}` : 'n/a';
  const text =
    `\ud83d\udfe1 <b>DONO DA APPROVARE #${donoId}</b>\n` +
    `Importo: <b>${Number(importo).toLocaleString()} USDC</b>\n` +
    `Destinatario: <code>${dest}</code>\n` +
    `Tipo: ${tipoUscita || 'n/a'}\n` +
    `Premi <b>Approva invio</b> per distribuire il dono.`;
  const body = JSON.stringify({
    chat_id:    chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[
      { text: '\u2705 Approva invio', callback_data: `approve_gift:${donoId}` },
      { text: '\u274c Rifiuta',        callback_data: `reject_gift:${donoId}` }
    ]] }
  });
  return telegramApiPost('sendMessage', token, body);
}

/** Chiude lo spinner del pulsante su Telegram dopo un callback. */
function answerCallbackQuery(callbackQueryId, text = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackQueryId) return Promise.resolve();
  const body = JSON.stringify({ callback_query_id: callbackQueryId, text: String(text).slice(0, 200) });
  return telegramApiPost('answerCallbackQuery', token, body);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  sendAlert,
  sendTelegramAlert,
  sendWhatsAppAlert,
  // Uscita cassa + approvazione dono
  alertUscitaCassa,
  inviaApprovazioneDono,
  answerCallbackQuery,
  // Helper predefiniti
  alertPayout,
  alertKycVerificato,
  alertAdminUnauthorized,
  alertRateLimit,
  alertSistemaBlocco,
  alertSistemaRiaperto,
  alertErroreCritico
};
