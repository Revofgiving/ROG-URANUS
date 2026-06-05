-- URANO v2 Backend — Schema PostgreSQL
-- psql $DATABASE_URL -f database/init.sql
-- Idempotente (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS accounts (
  id            SERIAL PRIMARY KEY,
  wallet        TEXT NOT NULL UNIQUE,
  nome          TEXT,
  ticket_number INTEGER UNIQUE,
  tipo          TEXT NOT NULL DEFAULT 'STANDARD',
  status        TEXT NOT NULL DEFAULT 'REGISTRATO',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tavole (
  id             SERIAL PRIMARY KEY,
  numero         INTEGER NOT NULL UNIQUE,
  sezione        TEXT NOT NULL DEFAULT 'URANO',
  livello        INTEGER NOT NULL DEFAULT 0,
  tipo           TEXT NOT NULL DEFAULT 'PERCORSO',
  capacita       INTEGER NOT NULL,
  faraone_wallet TEXT,
  turno          INTEGER NOT NULL DEFAULT 1,
  doni_ricevuti  NUMERIC(12,2) DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'APERTA',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS posizioni (
  id                     SERIAL PRIMARY KEY,
  tavola_id              INTEGER NOT NULL REFERENCES tavole(id),
  casella                INTEGER NOT NULL,
  wallet                 TEXT NOT NULL,
  nome                   TEXT,
  tipo                   TEXT NOT NULL DEFAULT 'DONATORE',
  dono_importo           NUMERIC(12,2) DEFAULT 0,
  sdoppiamento_tavola_id INTEGER,
  status                 TEXT NOT NULL DEFAULT 'ATTIVO',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tavola_id, casella)
);
CREATE TABLE IF NOT EXISTS turni (
  id                  SERIAL PRIMARY KEY,
  livello             INTEGER NOT NULL DEFAULT 1,
  numero_turno        INTEGER NOT NULL,
  faraone_wallet      TEXT NOT NULL,
  sacerdoti_necessari INTEGER NOT NULL DEFAULT 18,
  sacerdoti_entrati   INTEGER DEFAULT 0,
  doni_totali         NUMERIC(12,2) DEFAULT 0,
  status              TEXT DEFAULT 'IN_CORSO',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS donazioni (
  id              SERIAL PRIMARY KEY,
  donor_wallet    TEXT NOT NULL,
  importo         NUMERIC(12,2) NOT NULL,
  tx_hash         TEXT UNIQUE,
  tipo            TEXT DEFAULT 'DONO',
  tavola_id       INTEGER,
  livello         INTEGER,
  turno           INTEGER,
  status          TEXT DEFAULT 'COMPLETATA',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Rientri: HUMAN (6 per uscita) e CASSA_ROG (18 per uscita)
CREATE TABLE IF NOT EXISTS rientri (
  id              SERIAL PRIMARY KEY,
  faraone_wallet  TEXT NOT NULL,
  turno_origine   INTEGER NOT NULL,
  rientro_numero  INTEGER NOT NULL,
  importo         NUMERIC(12,2) DEFAULT 10,
  tipo_rientro    TEXT NOT NULL DEFAULT 'HUMAN',
  status          TEXT DEFAULT 'IN_ATTESA',
  tavola_id       INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS storico_uscite (
  id                   SERIAL PRIMARY KEY,
  wallet               TEXT NOT NULL,
  tipo_uscita          TEXT NOT NULL DEFAULT 'HUMAN',
  turno                INTEGER,
  lordo                NUMERIC(12,2),
  costo_rientri        NUMERIC(12,2),
  num_rientri          INTEGER DEFAULT 0,
  costo_rog_small      NUMERIC(12,2) DEFAULT 0,
  posizioni_rog_small  INTEGER DEFAULT 0,
  costo_rog            NUMERIC(12,2) DEFAULT 0,
  posizioni_rog        INTEGER DEFAULT 0,
  contributo_pharaon   NUMERIC(12,2) DEFAULT 0,
  accantonamento_cassa NUMERIC(12,2) DEFAULT 0,
  netto                NUMERIC(12,2),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Fondo cassa ROG (accantonamenti da uscite CASSA_ROG)
CREATE TABLE IF NOT EXISTS fondo_cassa (
  id             SERIAL PRIMARY KEY,
  importo        NUMERIC(12,2) NOT NULL,
  wallet_origine TEXT NOT NULL,
  turno          INTEGER,
  descrizione    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Flussi cross-sistema (ROG SMALL, ROG, PHARAON)
CREATE TABLE IF NOT EXISTS flussi_esterni (
  id              SERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL,
  origine_wallet  TEXT NOT NULL,
  importo         NUMERIC(12,2) NOT NULL,
  num_posizioni   INTEGER DEFAULT 0,
  turno_origine   INTEGER,
  tipo_uscita     TEXT NOT NULL,
  status          TEXT DEFAULT 'REGISTRATO',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS state_persistence (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_wallet       ON accounts(wallet);
CREATE INDEX IF NOT EXISTS idx_accounts_ticket       ON accounts(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tavole_numero         ON tavole(numero);
CREATE INDEX IF NOT EXISTS idx_tavole_status         ON tavole(status);
CREATE INDEX IF NOT EXISTS idx_tavole_livello_turno  ON tavole(livello, turno);
CREATE INDEX IF NOT EXISTS idx_posizioni_tavola      ON posizioni(tavola_id);
CREATE INDEX IF NOT EXISTS idx_posizioni_wallet      ON posizioni(wallet);
CREATE INDEX IF NOT EXISTS idx_turni_livello_status  ON turni(livello, status);
CREATE INDEX IF NOT EXISTS idx_rientri_status        ON rientri(status);
CREATE INDEX IF NOT EXISTS idx_rientri_wallet        ON rientri(faraone_wallet);
CREATE INDEX IF NOT EXISTS idx_flussi_tipo           ON flussi_esterni(tipo);
CREATE INDEX IF NOT EXISTS idx_flussi_status         ON flussi_esterni(status);

INSERT INTO state_persistence (key, value)
VALUES ('sistema_blocco', '{"bloccato": false}')
ON CONFLICT (key) DO NOTHING;
