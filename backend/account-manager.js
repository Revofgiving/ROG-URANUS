/**
 * 👤 URANO — Account Manager
 *
 * Gestisce registrazione account, rilascio ticket sequenziale,
 * e classificazione in PRIMARIO / PERPETUO / GEMELLO / SIMBIONTE.
 * Adattato da PHARAON con importi ÷ 10.
 */
'use strict';

const db = require('./db-manager');
const containerManager = require('./container-manager');

const QUOTA_INGRESSO = 10;

const DICHIARAZIONE = {
  HA_DONO_10: 'HA_DONO_10',
  NON_HA_DONO: 'NON_HA_DONO'
};

// ========================================
// REGISTRAZIONE
// ========================================

async function registraAccount({ wallet, nome, dichiarazioneDono }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error('Wallet non valido');
  }
  if (!nome || nome.trim().length === 0) {
    throw new Error('Nome obbligatorio');
  }
  if (!Object.values(DICHIARAZIONE).includes(dichiarazioneDono)) {
    throw new Error(`Dichiarazione dono non valida: ${dichiarazioneDono}. Valori: ${Object.values(DICHIARAZIONE).join(', ')}`);
  }

  const w = wallet.toLowerCase();
  const existing = await db.getAccount(w);
  if (existing && existing.ticket_number) {
    throw new Error(`Account ${w} già registrato con ticket ${existing.ticket_number}`);
  }

  console.log(`\n👤 Registrazione account URANO`);
  console.log(`   Wallet: ${w}`);
  console.log(`   Nome: ${nome}`);
  console.log(`   Dichiarazione: ${dichiarazioneDono}`);

  const account = await db.createAccount({ wallet: w, nome, tipo: 'PRIMARIO' });

  let ticketNumber = null;
  if (dichiarazioneDono === DICHIARAZIONE.HA_DONO_10) {
    const updated = await db.assignTicket(w);
    ticketNumber = updated.ticket_number;
    console.log(`   ✅ Ticket rilasciato: ${ticketNumber}`);
  } else {
    console.log(`   ⏳ Ticket NON rilasciato (in attesa doni a credito)`);
  }

  let contenitore;
  switch (dichiarazioneDono) {
    case DICHIARAZIONE.HA_DONO_10:
      contenitore = await containerManager.inserisciInContenitore({
        tipo: '5', wallet: w, ticketNumber, nome,
        importo: QUOTA_INGRESSO, provenienza: 'ISCRIZIONE'
      });
      break;
    case DICHIARAZIONE.NON_HA_DONO:
      contenitore = await containerManager.inserisciInContenitore({
        tipo: '5.1', wallet: w, ticketNumber: null, nome,
        importo: 0, provenienza: 'ISCRIZIONE'
      });
      console.log(`   ⏳ In attesa doni a credito (contenitore 5.1)`);
      break;
  }

  console.log(`   📦 Posizionato in contenitore ${contenitore.tipo}`);

  return {
    success: true, account, ticketNumber, contenitore,
    message: ticketNumber
      ? `Account registrato con ticket ${ticketNumber}`
      : `Account registrato — ticket in attesa di dono a credito`
  };
}

// ========================================
// ACCOUNT SECONDARI (Perpetuo / Gemello)
// ========================================

async function creaPerpetuo(parentWallet, parentSigla, perpetuoNumero) {
  const sigla = `${parentSigla}.${perpetuoNumero}`;
  const perpetuoWallet = `${parentWallet.toLowerCase()}_P${perpetuoNumero}`;

  console.log(`   🔄 Creazione PERPETUO: ${sigla} (da ${parentSigla})`);

  const account = await db.createAccount({
    wallet: perpetuoWallet, nome: `Perpetuo ${sigla}`,
    tipo: 'PERPETUO', sigla, parentWallet
  });

  return { account, sigla, wallet: perpetuoWallet };
}

async function creaGemello(parentWallet, parentSigla, gemelloNumero) {
  const sigla = `${gemelloNumero}-${parentSigla}`;

  const pg = require('./pg-connection-manager');
  const countRow = await pg.queryOne(`SELECT COUNT(*) AS cnt FROM accounts WHERE tipo = 'GEMELLO'`);
  const ordineGlobale = Number(countRow?.cnt) + 1;
  const ticketPrenotato = 26 + (ordineGlobale - 1) * 14;

  const gemelloWallet = `${parentWallet.toLowerCase()}_G${gemelloNumero}`;

  console.log(`   👥 Creazione GEMELLO: ${sigla} (ticket prenotato: ${ticketPrenotato})`);

  const account = await db.createAccount({
    wallet: gemelloWallet, nome: `Gemello ${sigla}`,
    tipo: 'GEMELLO', sigla, parentWallet
  });

  const accountConTicket = await db.assignSpecificTicket(gemelloWallet, ticketPrenotato);

  return { account: accountConTicket, sigla, wallet: gemelloWallet, ticketPrenotato };
}

async function countPerpetui(parentWallet) {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM accounts WHERE parent_wallet = $1 AND tipo = 'PERPETUO'`,
    [parentWallet.toLowerCase()]
  );
  return Number(row?.cnt) || 0;
}

async function countGemelli(parentWallet) {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM accounts WHERE parent_wallet = $1 AND tipo = 'GEMELLO'`,
    [parentWallet.toLowerCase()]
  );
  return Number(row?.cnt) || 0;
}

async function getAccountInfo(wallet) {
  const account = await db.getAccount(wallet);
  if (!account) return null;
  const perpetui = await countPerpetui(wallet);
  const gemelli = await countGemelli(wallet);
  return { ...account, perpetui_rilasciati: perpetui, gemelli_rilasciati: gemelli };
}

module.exports = {
  registraAccount, creaPerpetuo, creaGemello,
  countPerpetui, countGemelli, getAccountInfo,
  QUOTA_INGRESSO, DICHIARAZIONE
};
