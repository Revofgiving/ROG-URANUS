/**
 * 🌀 SUPERURANO — Database Manager
 *
 * Schema unificato: URANO 2 (PHARAON ÷10) + URANO 1 (FIFO) + Bridge.
 */
'use strict';

const pg = require('./pg-connection-manager');

// ========================================
// SCHEMA
// ========================================

const SCHEMA_SQL = `

-- Account registrati nel sistema
CREATE TABLE IF NOT EXISTS accounts (
  id            SERIAL PRIMARY KEY,
  wallet        TEXT NOT NULL UNIQUE,
  nome          TEXT,
  ticket_number INTEGER UNIQUE,
  tipo          TEXT NOT NULL DEFAULT 'PRIMARIO',    -- PRIMARIO | PERPETUO | GEMELLO | SIMBIONTE | FONDO | CASSA
  sigla         TEXT,
  parent_wallet TEXT,
  status        TEXT NOT NULL DEFAULT 'REGISTRATO',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tavole (numerazione globale sequenziale)
CREATE TABLE IF NOT EXISTS tavole (
  id            SERIAL PRIMARY KEY,
  numero        INTEGER NOT NULL UNIQUE,
  sezione       TEXT NOT NULL,                        -- ENTRATA | URANO
  livello       INTEGER NOT NULL DEFAULT 0,
  blocco        INTEGER,
  tipo          TEXT NOT NULL DEFAULT 'PERCORSO',     -- PERCORSO | SDOPPIAMENTO
  capacita      INTEGER NOT NULL,
  faraone_wallet TEXT,
  turno         INTEGER NOT NULL DEFAULT 1,
  doni_ricevuti NUMERIC(12,2) DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'APERTA',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Posizioni (caselle) dentro ogni tavola
CREATE TABLE IF NOT EXISTS posizioni (
  id                     SERIAL PRIMARY KEY,
  tavola_id              INTEGER NOT NULL REFERENCES tavole(id),
  casella                INTEGER NOT NULL,
  wallet                 TEXT NOT NULL,
  nome                   TEXT,
  tipo                   TEXT NOT NULL,               -- DONATORE | EREDE | FARAONE | SIMBIONTE | PERPETUO | GEMELLO | PROGREDITO
  dono_importo           NUMERIC(12,2) DEFAULT 0,
  sdoppiamento_tavola_id INTEGER,
  numero_posizione       INTEGER,                      -- numerazione Sole L0 globale (0..N), riserve 26+14k incluse
  status                 TEXT NOT NULL DEFAULT 'ATTIVO',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tavola_id, casella)
);

-- Turni di gioco per ogni livello
CREATE TABLE IF NOT EXISTS turni (
  id                  SERIAL PRIMARY KEY,
  sezione             TEXT NOT NULL,                   -- ENTRATA | URANO
  livello             INTEGER NOT NULL,
  blocco              INTEGER,
  numero_turno        INTEGER NOT NULL,
  faraone_wallet      TEXT NOT NULL,
  faraone_tipo        TEXT DEFAULT 'PRIMARIO',
  tavola_faraone_num  INTEGER,
  sacerdoti_necessari INTEGER NOT NULL,
  sacerdoti_entrati   INTEGER DEFAULT 0,
  tavole_create       INTEGER DEFAULT 0,
  prima_tavola_num    INTEGER,
  ultima_tavola_num   INTEGER,
  doni_totali         NUMERIC(12,2) DEFAULT 0,
  status              TEXT DEFAULT 'IN_CORSO',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Funzioni rilasciate (Perpetuo, Gemello, Simbionti, Crediti)
CREATE TABLE IF NOT EXISTS funzioni (
  id                      SERIAL PRIMARY KEY,
  tipo                    TEXT NOT NULL,
  account_origine_wallet  TEXT NOT NULL,
  account_generato_wallet TEXT,
  sigla                   TEXT,
  ticket_prenotato        INTEGER,
  importo                 NUMERIC(12,2) DEFAULT 0,
  turno_rilascio          INTEGER NOT NULL,
  turno_entrata           INTEGER,
  tavola_posizionamento   INTEGER,
  posizione_in_tavola     TEXT,
  status                  TEXT DEFAULT 'RILASCIATO',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Contenitori (code FIFO)
CREATE TABLE IF NOT EXISTS contenitori (
  id                  SERIAL PRIMARY KEY,
  tipo                TEXT NOT NULL,                   -- 5 | 5.1 | 5.2 | 5.3
  wallet              TEXT NOT NULL,
  ticket_number       INTEGER,
  nome                TEXT,
  importo_disponibile NUMERIC(12,2) DEFAULT 0,
  provenienza         TEXT,
  status              TEXT DEFAULT 'IN_ATTESA',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Donazioni registrate
CREATE TABLE IF NOT EXISTS donazioni (
  id              SERIAL PRIMARY KEY,
  donor_wallet    TEXT NOT NULL,
  importo         NUMERIC(12,2) NOT NULL,
  tx_hash         TEXT UNIQUE,
  tipo            TEXT DEFAULT 'DONO',
  destinatario_wallet TEXT,
  tavola_id       INTEGER,
  livello         INTEGER,
  turno           INTEGER,
  status          TEXT DEFAULT 'COMPLETATA',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Doni a credito
CREATE TABLE IF NOT EXISTS doni_credito (
  id                    SERIAL PRIMARY KEY,
  rilasciato_da_wallet  TEXT NOT NULL,
  rilasciato_al_livello INTEGER NOT NULL,
  importo               NUMERIC(12,2) DEFAULT 10,
  assegnato_a_wallet    TEXT,
  turno_rilascio        INTEGER,
  status                TEXT DEFAULT 'STANDBY',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Stato globale persistente
CREATE TABLE IF NOT EXISTS state_persistence (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Storico avanzamenti (audit trail)
CREATE TABLE IF NOT EXISTS storico_avanzamenti (
  id              SERIAL PRIMARY KEY,
  wallet          TEXT NOT NULL,
  tipo_account    TEXT,
  da_livello      INTEGER,
  a_livello       INTEGER,
  da_blocco       INTEGER,
  a_blocco        INTEGER,
  turno           INTEGER,
  doni_ricevuti   NUMERIC(12,2),
  doni_trattenuti NUMERIC(12,2),
  netto           NUMERIC(12,2),
  evento          TEXT,
  dettagli        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- KYC Verifications
CREATE TABLE IF NOT EXISTS kyc_verifications (
  id          SERIAL PRIMARY KEY,
  wallet      TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  session_id  TEXT,
  proof_id    TEXT,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indici
CREATE INDEX IF NOT EXISTS idx_accounts_wallet          ON accounts(wallet);
CREATE INDEX IF NOT EXISTS idx_accounts_ticket          ON accounts(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tavole_numero            ON tavole(numero);
CREATE INDEX IF NOT EXISTS idx_tavole_status            ON tavole(status);
CREATE INDEX IF NOT EXISTS idx_tavole_livello_turno     ON tavole(livello, turno);
CREATE INDEX IF NOT EXISTS idx_posizioni_tavola         ON posizioni(tavola_id);
CREATE INDEX IF NOT EXISTS idx_posizioni_wallet         ON posizioni(wallet);
CREATE INDEX IF NOT EXISTS idx_contenitori_tipo_status  ON contenitori(tipo, status);
CREATE INDEX IF NOT EXISTS idx_funzioni_tipo_status     ON funzioni(tipo, status);
CREATE INDEX IF NOT EXISTS idx_turni_livello_status     ON turni(livello, status);
CREATE INDEX IF NOT EXISTS idx_doni_credito_status      ON doni_credito(status);
CREATE INDEX IF NOT EXISTS idx_kyc_wallet               ON kyc_verifications(wallet);
CREATE INDEX IF NOT EXISTS idx_kyc_status               ON kyc_verifications(status);
`;

// ========================================
// SCHEMA FIFO (Nettuno) + BRIDGE
// ========================================

const SCHEMA_FIFO_SQL = `
-- Coda FIFO (URANO 1)
CREATE TABLE IF NOT EXISTS coda_fifo (
  id            SERIAL PRIMARY KEY,
  posizione     INTEGER NOT NULL UNIQUE,
  wallet        TEXT NOT NULL,
  nome          TEXT,
  tipo          TEXT NOT NULL DEFAULT 'HUMAN',
  is_rientro    BOOLEAN DEFAULT FALSE,
  generazione   INTEGER DEFAULT 0,
  importo       NUMERIC(12,2) DEFAULT 10,
  uscita_numero INTEGER,
  status        TEXT DEFAULT 'IN_CODA',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Storico uscite FIFO
CREATE TABLE IF NOT EXISTS storico_uscite_fifo (
  id                   SERIAL PRIMARY KEY,
  numero_uscita        INTEGER NOT NULL UNIQUE,
  posizione_coda       INTEGER NOT NULL,
  wallet               TEXT NOT NULL,
  tipo_uscita          TEXT NOT NULL,
  is_rientro           BOOLEAN DEFAULT FALSE,
  generazione          INTEGER DEFAULT 0,
  lordo                NUMERIC(12,2),
  costo_rientri        NUMERIC(12,2),
  num_rientri          INTEGER DEFAULT 0,
  rog_small            NUMERIC(12,2) DEFAULT 0,
  contributo_pharaon   NUMERIC(12,2) DEFAULT 0,
  accantonamento_cassa NUMERIC(12,2) DEFAULT 0,
  netto                NUMERIC(12,2),
  rientri_usati        INTEGER DEFAULT 0,
  posizioni_da_donatori INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Flussi esterni cross-sistema (ROG SMALL, PHARAON)
CREATE TABLE IF NOT EXISTS flussi_esterni (
  id              SERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL,
  origine_wallet  TEXT NOT NULL,
  importo         NUMERIC(12,2) NOT NULL,
  num_posizioni   INTEGER DEFAULT 0,
  uscita_numero   INTEGER,
  tipo_uscita     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Bridge log (audit trail del collegamento URANO 2 → URANO 1)
CREATE TABLE IF NOT EXISTS bridge_log (
  id                SERIAL PRIMARY KEY,
  wallet            TEXT NOT NULL,
  evento            TEXT NOT NULL,
  netto_originale   NUMERIC(12,2),
  deduzioni_totali  NUMERIC(12,2),
  netto_finale      NUMERIC(12,2),
  dettagli          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Predisposizioni (pre-mappatura deterministica tavole e funzioni)
-- Chiave PER-INGRESSO: ogni posizione (tavola di sdoppiamento) ha il proprio percorso futuro.
CREATE TABLE IF NOT EXISTS predisposizioni (
  id                     SERIAL PRIMARY KEY,
  wallet                 TEXT NOT NULL,
  turno_corrente         INTEGER,
  turno_previsto         INTEGER,
  tavola_sdoppiamento_num INTEGER,
  posizione_coda         INTEGER,
  sacerdoti_necessari    INTEGER,
  persone_nuove          INTEGER,
  ha_funzioni            BOOLEAN DEFAULT FALSE,
  funzioni_previste      JSONB,
  struttura_turno        JSONB,
  riepilogo_economico    JSONB,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet, tavola_sdoppiamento_num)
);

-- Coda FIFO crediti (lista di attesa per distribuzione doni a credito)
CREATE TABLE IF NOT EXISTS coda_crediti (
  id            SERIAL PRIMARY KEY,
  credito_id    INTEGER NOT NULL,
  wallet        TEXT NOT NULL,
  importo       NUMERIC(12,2) DEFAULT 10,
  provenienza   TEXT,
  status        TEXT DEFAULT 'IN_CODA',
  assegnato_a   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coda_crediti_status ON coda_crediti(status);
CREATE INDEX IF NOT EXISTS idx_predisposizioni_wallet ON predisposizioni(wallet);
CREATE INDEX IF NOT EXISTS idx_predisposizioni_turno  ON predisposizioni(turno_previsto);
CREATE INDEX IF NOT EXISTS idx_coda_fifo_status    ON coda_fifo(status);
CREATE INDEX IF NOT EXISTS idx_coda_fifo_posizione ON coda_fifo(posizione);
CREATE INDEX IF NOT EXISTS idx_coda_fifo_wallet    ON coda_fifo(wallet);
CREATE INDEX IF NOT EXISTS idx_storico_fifo_wallet ON storico_uscite_fifo(wallet);
CREATE INDEX IF NOT EXISTS idx_flussi_tipo         ON flussi_esterni(tipo);
CREATE INDEX IF NOT EXISTS idx_bridge_wallet       ON bridge_log(wallet);
`;

// ========================================
// INIZIALIZZAZIONE
// ========================================

// ========================================
// SCHEMA HUB (news, risorse, comunicazioni, testimonianze)
// ========================================

const SCHEMA_HUB_SQL = `
CREATE TABLE IF NOT EXISTS hub_news (
  id         SERIAL PRIMARY KEY,
  titolo     TEXT NOT NULL,
  excerpt    TEXT DEFAULT '',
  categoria  VARCHAR(50) DEFAULT 'aggiornamenti',
  badge      VARCHAR(50),
  data       VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_risorse (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  tipo       VARCHAR(20) DEFAULT 'PDF',
  dimensione VARCHAR(30) DEFAULT '',
  categoria  VARCHAR(50) DEFAULT 'documenti',
  data_item  VARCHAR(20),
  url        TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_comunicazioni (
  id         SERIAL PRIMARY KEY,
  titolo     TEXT NOT NULL,
  testo      TEXT DEFAULT '',
  categoria  VARCHAR(50) DEFAULT 'ufficiali',
  tag        VARCHAR(50) DEFAULT 'Ufficiale',
  data       VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_testimonianze (
  id         SERIAL PRIMARY KEY,
  wallet     TEXT NOT NULL,
  messaggio  TEXT NOT NULL,
  livello    VARCHAR(30) DEFAULT 'SOLE',
  status     VARCHAR(20) DEFAULT 'pending',
  data       VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_eventi (
  id               SERIAL PRIMARY KEY,
  nome             TEXT NOT NULL,
  data             VARCHAR(20),
  ora              VARCHAR(10),
  tipo             VARCHAR(20) DEFAULT 'online',
  descrizione      TEXT DEFAULT '',
  link             TEXT DEFAULT '',
  location         TEXT DEFAULT '',
  max_partecipanti INTEGER DEFAULT 100,
  iscritti         INTEGER DEFAULT 0,
  status           VARCHAR(20) DEFAULT 'upcoming',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_news_created       ON hub_news(created_at);
CREATE INDEX IF NOT EXISTS idx_hub_risorse_categoria  ON hub_risorse(categoria);
CREATE INDEX IF NOT EXISTS idx_hub_com_created        ON hub_comunicazioni(created_at);
CREATE INDEX IF NOT EXISTS idx_hub_tes_status         ON hub_testimonianze(status);
CREATE INDEX IF NOT EXISTS idx_hub_eventi_data        ON hub_eventi(data);
`;

let initialized = false;

async function initDatabase() {
  if (initialized) return;
console.log('🌀 Inizializzazione database SUPERURANO...');
  await pg.query(SCHEMA_SQL);
  initialized = true;
  console.log('✅ Database SUPERURANO pronto');

  // Schema Nettuno (FIFO)
  await pg.query(SCHEMA_FIFO_SQL);
  console.log('\u2705 Tabelle Nettuno (FIFO) pronte');

  // Schema Hub (news, risorse, comunicazioni, testimonianze)
  await pg.query(SCHEMA_HUB_SQL);
  console.log('\u2705 Tabelle Hub (news/risorse/comunicazioni) pronte');
  
    // Migrazione automatica KYC
  await pg.query(`
    ALTER TABLE kyc_verifications
    ADD COLUMN IF NOT EXISTS source TEXT
  `);

  console.log('✅ Migrazione kyc_verifications.source verificata');

  // Migrazione numero_posizione: numerazione Sole L0 globale (0..N) con riserve Gemelli 26+14k.
  // Popolata dall'allocatore Sole in donation-flow-manager. UNIQUE parziale (solo dove valorizzata).
  await pg.query(`ALTER TABLE posizioni ADD COLUMN IF NOT EXISTS numero_posizione INTEGER`);
  await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_posizioni_numero_posizione
                  ON posizioni(numero_posizione) WHERE numero_posizione IS NOT NULL`);
  console.log('✅ Migrazione posizioni.numero_posizione verificata');

  // Migrazione predisposizioni: da chiave per-wallet a PER-INGRESSO (wallet + tavola_sdoppiamento)
  // cos\u00ec ogni posizione del wallet ha un proprio percorso futuro (come ROG small/medium/large).
  try {
    await pg.query(`ALTER TABLE predisposizioni DROP CONSTRAINT IF EXISTS predisposizioni_wallet_key`);
    await pg.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'predisposizioni_wallet_sdopp_key') THEN
        ALTER TABLE predisposizioni ADD CONSTRAINT predisposizioni_wallet_sdopp_key UNIQUE (wallet, tavola_sdoppiamento_num);
      END IF;
    END $$;`);
    console.log('\u2705 Migrazione predisposizioni per-ingresso verificata');
  } catch (e) {
    console.error('\u26a0\ufe0f Migrazione predisposizioni fallita:', e.message);
  }
}

// ========================================
// ACCOUNTS
// ========================================

async function createAccount({ wallet, nome, tipo = 'PRIMARIO', sigla = null, parentWallet = null }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO accounts (wallet, nome, tipo, sigla, parent_wallet)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, accounts.nome)
     RETURNING *`,
    [wallet.toLowerCase(), nome, tipo, sigla, parentWallet ? parentWallet.toLowerCase() : null]
  );
}

async function getAccount(wallet) {
  await initDatabase();
  return await pg.queryOne('SELECT * FROM accounts WHERE wallet = $1', [wallet.toLowerCase()]);
}

function isTicketGemello(n) {
  return n >= 26 && (n - 26) % 14 === 0;
}

async function assignTicket(wallet) {
  await initDatabase();
  const w = wallet.toLowerCase();
  const maxRow = await pg.queryOne('SELECT COALESCE(MAX(ticket_number), 0) AS max_ticket FROM accounts');
  let candidate = Number(maxRow.max_ticket) + 1;
  while (isTicketGemello(candidate)) {
    const occupato = await pg.queryOne('SELECT id FROM accounts WHERE ticket_number = $1', [candidate]);
    if (!occupato) { candidate++; } else { candidate++; }
  }
  return await pg.queryOne(
    'UPDATE accounts SET ticket_number = $1, status = $2 WHERE wallet = $3 RETURNING *',
    [candidate, 'IN_CODA', w]
  );
}

async function assignSpecificTicket(wallet, ticketNumber) {
  await initDatabase();
  return await pg.queryOne(
    'UPDATE accounts SET ticket_number = $1, status = $2 WHERE wallet = $3 RETURNING *',
    [ticketNumber, 'IN_CODA', wallet.toLowerCase()]
  );
}

async function getAccountByTicket(ticketNumber) {
  await initDatabase();
  return await pg.queryOne('SELECT * FROM accounts WHERE ticket_number = $1', [ticketNumber]);
}

// ========================================
// TAVOLE
// ========================================

async function getNextTavolaNumero() {
  await initDatabase();
  const row = await pg.queryOne('SELECT COALESCE(MAX(numero), 0) + 1 AS next_num FROM tavole');
  return row.next_num;
}

async function createTavola({ numero, sezione, livello, blocco = null, tipo = 'PERCORSO', capacita, faraoneWallet, turno = 1 }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO tavole (numero, sezione, livello, blocco, tipo, capacita, faraone_wallet, turno)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [numero, sezione, livello, blocco, tipo, capacita, faraoneWallet ? faraoneWallet.toLowerCase() : null, turno]
  );
}

async function getTavola(numero) { await initDatabase(); return await pg.queryOne('SELECT * FROM tavole WHERE numero = $1', [numero]); }
async function getTavolaById(id) { await initDatabase(); return await pg.queryOne('SELECT * FROM tavole WHERE id = $1', [id]); }

async function updateTavolaStatus(numero, status) {
  await initDatabase();
  return await pg.queryOne('UPDATE tavole SET status = $1 WHERE numero = $2 RETURNING *', [status, numero]);
}

async function updateTavolaDoni(numero, importo) {
  await initDatabase();
  return await pg.queryOne('UPDATE tavole SET doni_ricevuti = doni_ricevuti + $1 WHERE numero = $2 RETURNING *', [importo, numero]);
}

async function countPosizioniInTavola(tavolaId) {
  await initDatabase();
  const row = await pg.queryOne(
    'SELECT COUNT(*) AS cnt FROM posizioni WHERE tavola_id = $1 AND tipo != $2',
    [tavolaId, 'EREDE']
  );
  return Number(row?.cnt) || 0;
}

// ========================================
// POSIZIONI
// ========================================

async function createPosizione({ tavolaId, casella, wallet, nome, tipo, donoImporto = 0, numeroPosizione = null }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO posizioni (tavola_id, casella, wallet, nome, tipo, dono_importo, numero_posizione)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tavolaId, casella, wallet.toLowerCase(), nome, tipo, donoImporto, numeroPosizione]
  );
}

async function getPosizioniTavola(tavolaId) {
  await initDatabase();
  return await pg.queryMany('SELECT * FROM posizioni WHERE tavola_id = $1 ORDER BY casella ASC', [tavolaId]);
}

async function updatePosizioneSdoppiamento(posizioneId, sdoppiamentoTavolaId) {
  await initDatabase();
  return await pg.queryOne(
    'UPDATE posizioni SET sdoppiamento_tavola_id = $1 WHERE id = $2 RETURNING *',
    [sdoppiamentoTavolaId, posizioneId]
  );
}

// ========================================
// TURNI
// ========================================

async function createTurno({ sezione, livello, blocco, numeroTurno, faraoneWallet, faraoneTipo = 'PRIMARIO', tavolaFaraoneNum = null, sacerdotiNecessari }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO turni (sezione, livello, blocco, numero_turno, faraone_wallet, faraone_tipo, tavola_faraone_num, sacerdoti_necessari)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [sezione, livello, blocco, numeroTurno, faraoneWallet.toLowerCase(), faraoneTipo, tavolaFaraoneNum, sacerdotiNecessari]
  );
}

async function getTurnoCorrente(sezione, livello) {
  await initDatabase();
  return await pg.queryOne(
    `SELECT * FROM turni WHERE sezione = $1 AND livello = $2 AND status = 'IN_CORSO' ORDER BY numero_turno DESC LIMIT 1`,
    [sezione, livello]
  );
}

async function incrementSacerdotiEntrati(turnoId) {
  await initDatabase();
  return await pg.queryOne('UPDATE turni SET sacerdoti_entrati = sacerdoti_entrati + 1 WHERE id = $1 RETURNING *', [turnoId]);
}

async function incrementTavolaCreate(turnoId) {
  await initDatabase();
  return await pg.queryOne('UPDATE turni SET tavole_create = tavole_create + 1 WHERE id = $1 RETURNING *', [turnoId]);
}

async function completaTurno(turnoId, doniTotali) {
  await initDatabase();
  return await pg.queryOne(
    `UPDATE turni SET status = 'COMPLETATO', doni_totali = $1 WHERE id = $2 RETURNING *`,
    [doniTotali, turnoId]
  );
}

// ========================================
// CONTENITORI
// ========================================

async function addToContenitore({ tipo, wallet, ticketNumber, nome, importo, provenienza }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO contenitori (tipo, wallet, ticket_number, nome, importo_disponibile, provenienza)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tipo, wallet.toLowerCase(), ticketNumber, nome, importo, provenienza]
  );
}

async function getNextFromContenitore(tipo) {
  await initDatabase();
  return await pg.queryOne(
    `SELECT * FROM contenitori WHERE tipo = $1 AND status = 'IN_ATTESA'
     ORDER BY ticket_number ASC NULLS LAST, id ASC LIMIT 1`,
    [tipo]
  );
}

async function markContenitoreUsato(id) {
  await initDatabase();
  return await pg.queryOne(`UPDATE contenitori SET status = 'USATO' WHERE id = $1 RETURNING *`, [id]);
}

async function countInContenitore(tipo) {
  await initDatabase();
  const row = await pg.queryOne(
    `SELECT COUNT(*) AS cnt FROM contenitori WHERE tipo = $1 AND status = 'IN_ATTESA'`, [tipo]
  );
  return Number(row?.cnt) || 0;
}

// ========================================
// FUNZIONI
// ========================================

async function createFunzione({ tipo, accountOrigineWallet, accountGeneratoWallet, sigla, ticketPrenotato, importo, turnoRilascio, turnoEntrata, tavolaPosizionamento, posizioneInTavola }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO funzioni (tipo, account_origine_wallet, account_generato_wallet, sigla, ticket_prenotato, importo, turno_rilascio, turno_entrata, tavola_posizionamento, posizione_in_tavola)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [tipo, accountOrigineWallet.toLowerCase(), accountGeneratoWallet ? accountGeneratoWallet.toLowerCase() : null, sigla, ticketPrenotato, importo, turnoRilascio, turnoEntrata ?? null, tavolaPosizionamento, posizioneInTavola]
  );
}

async function getFunzioniByOrigine(wallet) {
  await initDatabase();
  return await pg.queryMany(
    'SELECT * FROM funzioni WHERE account_origine_wallet = $1 ORDER BY created_at ASC',
    [wallet.toLowerCase()]
  );
}

async function getFunzioniPendentiPerTurno(turno, tipo = null) {
  await initDatabase();
  const params = [turno];
  let sql = `SELECT * FROM funzioni WHERE turno_entrata = $1 AND status = 'RILASCIATO'`;
  if (tipo) { sql += ' AND tipo = $2'; params.push(tipo); }
  sql += ' ORDER BY id ASC';
  return await pg.queryMany(sql, params);
}

// ========================================
// POSIZIONE ATTIVA
// ========================================

async function getPosizioneAttivaEntrata(wallet) {
  await initDatabase();
  return await pg.queryOne(
    `SELECT p.id, p.casella, p.tipo, p.status AS posizione_status,
            t.numero AS tavola_numero, t.status AS tavola_status, t.turno
     FROM posizioni p
     JOIN tavole t ON p.tavola_id = t.id
     WHERE p.wallet = $1 AND t.livello = 0
       AND p.tipo = 'DONATORE' AND p.status = 'ATTIVO'
     LIMIT 1`,
    [wallet.toLowerCase()]
  );
}

// ========================================
// DONAZIONI
// ========================================

async function createDonazione({ donorWallet, importo, txHash, tipo = 'DONO', destinatarioWallet = null, tavolaId = null, livello = null, turno = null }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO donazioni (donor_wallet, importo, tx_hash, tipo, destinatario_wallet, tavola_id, livello, turno)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [donorWallet.toLowerCase(), importo, txHash, tipo, destinatarioWallet ? destinatarioWallet.toLowerCase() : null, tavolaId, livello, turno]
  );
}

// ========================================
// DONI A CREDITO
// ========================================

async function createDonoCredito({ rilasciatoDaWallet, rilasciatoAlLivello, importo = 10, turnoRilascio }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO doni_credito (rilasciato_da_wallet, rilasciato_al_livello, importo, turno_rilascio)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [rilasciatoDaWallet.toLowerCase(), rilasciatoAlLivello, importo, turnoRilascio]
  );
}

async function assegnaDoniCredito(numDoni) {
  await initDatabase();
  const inAttesa = await pg.queryMany(
    `SELECT id, wallet, nome FROM contenitori
     WHERE tipo = '5.1' AND status = 'IN_ATTESA' ORDER BY id ASC LIMIT $1`, [numDoni]
  );
  if (inAttesa.length === 0) return [];
  const crediti = await pg.queryMany(
    `SELECT id FROM doni_credito WHERE status = 'STANDBY' ORDER BY id ASC LIMIT $1`, [inAttesa.length]
  );
  if (crediti.length === 0) return [];
  const daDare = Math.min(inAttesa.length, crediti.length);
  const risultati = [];
  for (let i = 0; i < daDare; i++) {
    const contenitore = inAttesa[i];
    const credito = crediti[i];
    const accountAggiornato = await assignTicket(contenitore.wallet);
    const ticketNumber = accountAggiornato.ticket_number;
    await pg.query(`UPDATE doni_credito SET status = 'ASSEGNATO', assegnato_a_wallet = $1 WHERE id = $2`, [contenitore.wallet, credito.id]);
    await pg.query(`UPDATE contenitori SET status = 'USATO' WHERE id = $1`, [contenitore.id]);
    const nuovoC = await addToContenitore({
      tipo: '5', wallet: contenitore.wallet, ticketNumber, nome: contenitore.nome,
      importo: 10, provenienza: 'CREDITO'
    });
    risultati.push({ wallet: contenitore.wallet, ticketNumber, creditoId: credito.id, nuovoContenitoreId: nuovoC.id });
    console.log(`   🎫 Dono a credito → ${contenitore.wallet.substring(0, 10)}... ticket #${ticketNumber}`);
  }
  return risultati;
}

// ========================================
// STATE PERSISTENCE
// ========================================

async function getState(key, defaultValue = {}) {
  await initDatabase();
  const row = await pg.queryOne('SELECT value FROM state_persistence WHERE key = $1', [key]);
  return row ? row.value : defaultValue;
}

async function setState(key, value) {
  await initDatabase();
  await pg.query(
    `INSERT INTO state_persistence (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// ========================================
// STORICO
// ========================================

async function registraAvanzamento({ wallet, tipoAccount, daLivello, aLivello, daBlocco, aBlocco, turno, doniRicevuti, doniTrattenuti, netto, evento, dettagli }) {
  await initDatabase();
  return await pg.queryOne(
    `INSERT INTO storico_avanzamenti (wallet, tipo_account, da_livello, a_livello, da_blocco, a_blocco, turno, doni_ricevuti, doni_trattenuti, netto, evento, dettagli)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [wallet.toLowerCase(), tipoAccount, daLivello, aLivello, daBlocco, aBlocco, turno, doniRicevuti, doniTrattenuti, netto, evento, dettagli ? JSON.stringify(dettagli) : null]
  );
}

// ========================================
// KILL SWITCH
// ========================================

async function bloccaSistema(motivo = 'Blocco di emergenza') {
  await initDatabase();
  await pg.query(
    `INSERT INTO state_persistence (key, value, updated_at) VALUES ('sistema_blocco', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify({ bloccato: true, motivo, timestamp: new Date().toISOString() })]
  );
}

async function sbloccaSistema() {
  await initDatabase();
  await pg.query(
    `INSERT INTO state_persistence (key, value, updated_at) VALUES ('sistema_blocco', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify({ bloccato: false, timestamp: new Date().toISOString() })]
  );
}

async function isSistemaBlocato() {
  await initDatabase();
  const row = await pg.queryOne('SELECT value FROM state_persistence WHERE key = $1', ['sistema_blocco']);
  return row?.value?.bloccato === true;
}

async function getStatoBlocco() {
  await initDatabase();
  const row = await pg.queryOne('SELECT value FROM state_persistence WHERE key = $1', ['sistema_blocco']);
  if (!row) return { bloccato: false };
  return row.value;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  initDatabase,
  createAccount, getAccount, assignTicket, assignSpecificTicket, getAccountByTicket,
  getNextTavolaNumero, createTavola, getTavola, getTavolaById,
  updateTavolaStatus, updateTavolaDoni, countPosizioniInTavola,
  createPosizione, getPosizioniTavola, updatePosizioneSdoppiamento,
  createTurno, getTurnoCorrente, incrementSacerdotiEntrati, incrementTavolaCreate, completaTurno,
  addToContenitore, getNextFromContenitore, markContenitoreUsato, countInContenitore,
  createFunzione, getFunzioniByOrigine, getFunzioniPendentiPerTurno,
  getPosizioneAttivaEntrata,
  createDonazione,
  createDonoCredito, assegnaDoniCredito,
  getState, setState,
  registraAvanzamento,
  bloccaSistema, sbloccaSistema, isSistemaBlocato, getStatoBlocco
};
