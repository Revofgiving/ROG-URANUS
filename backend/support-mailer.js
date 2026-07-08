const nodemailer = require('nodemailer');

// SMTP disabilitato se non configurato (es. su Coolify senza servizio esterno)
const SMTP_ENABLED = !!(process.env.ROG_SMTP_HOST && process.env.ROG_SMTP_HOST !== '127.0.0.1');

// Configurazione base SMTP - DA ADATTARE ai tuoi parametri reali.
const transporter = SMTP_ENABLED ? nodemailer.createTransport({
  host: process.env.ROG_SMTP_HOST,
  port: Number(process.env.ROG_SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.ROG_SMTP_USER || '',
    pass: process.env.ROG_SMTP_PASS || ''
  }
}) : null;

const SUPPORT_EMAIL = 'revolutionofgivingrog@protonmail.com';

/**
 * Invia una mail di notifica quando un wallet non viene trovato in anagrafica.
 *
 * @param {string} wallet - wallet non trovato
 */
async function notifyWalletNotFound(wallet) {
  const walletNorm = String(wallet || '').toLowerCase();

  const mailOptions = {
    from: process.env.ROG_MAIL_FROM || 'Revolution of Giving <no-reply@revolutionofgiving.com>',
    to: SUPPORT_EMAIL,
    subject: `[ROG] Wallet NON trovato in anagrafica: ${walletNorm}`,
    text: [
      'Ciao Team ROG,',
      '',
      'un utente ha tentato di accedere alla sezione "Già Iscritto" con un wallet che',
      'non è stato trovato in anagrafica / database Postgres.',
      '',
      `Wallet: ${walletNorm}`,
      `Data:  ${new Date().toISOString()}`,
      '',
      'Si prega di verificare manualmente la corrispondenza tra:',
      '- anagrafica legacy (file ROG_ANAGRAFICA_DEFINITIVA.txt)',
      '- tabelle Postgres (wallet_master, wallet_positions, community_registrations)',
      '',
      'Grazie,',
      'Backend ROG'
    ].join('\n')
  };

  // Se SMTP non configurato, logga solo e non tenta invio
  if (!SMTP_ENABLED || !transporter) {
    console.log(`⚠️  SMTP non configurato - notifica wallet non trovato NON inviata: ${walletNorm}`);
    return;
  }

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Notifica inviata al supporto per wallet non trovato: ${walletNorm}`);
  } catch (err) {
    console.error('❌ Errore invio mail supporto (wallet non trovato):', err.message || err);
  }
}

module.exports = {
  notifyWalletNotFound
};
