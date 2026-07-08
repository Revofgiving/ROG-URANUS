/**
 * 🔄 ROG AVANZAMENTO MANAGER - PostgreSQL VERSION
 *
 * Gestisce lo stato molecolare (posizioni_stato) e l'avanzamento dei ruoli
 * nei tre movimenti SMALL / MEDIUM / LARGE, secondo le regole ROG:
 *
 * - Ogni posizione ha un numero posizionale globale (posizione) e un wallet.
 * - Ogni posizione nasce in una molecola con un ruolo strutturale:
 *   RICEVENTE, PONTE_SX, PONTE_DX, DONANTE_1..4.
 * - Per ogni molecola, le generazioni sono sempre:
 *   RICEVENTE → Hn, PONTI → H(n+1), DONANTI → H(n+2).
 * - Le posizioni attraversano i movimenti SMALL → MEDIUM → LARGE,
 *   mantenendo lo stesso numero di posizione e (per SMALL/MEDIUM) la
 *   stessa generazione H di appartenenza; in LARGE assumono la
 *   generazione dei donanti LARGE del blocco in cui entrano.
 * - Le stelline indicano il numero di cicli completati per ogni
 *   movimento: stelle_rosse (SMALL), stelle_verdi (MEDIUM),
 *   stelle_blu (LARGE).
 * - Tutte le donazioni di SMALL e MEDIUM vanno sempre in cassa ROG;
 *   gli "accumuli" sono solo contabilità a livello di wallet/posizione.
 *
 * Questa versione usa esclusivamente PostgreSQL (pg-connection-manager
 * e db-unified-manager-pg) e NON dipende più da SQLite.
 */

const pg = require('./pg-connection-manager');
const dbPg = require('./db-unified-manager-pg');

// ========================================
// COSTANTI DI RUOLO E GENERAZIONE
// ========================================

/**
 * Offset di generazione per ogni ruolo rispetto alla generazione del RICEVENTE.
 * Vale per tutti i movimenti (SMALL, MEDIUM, LARGE).
 *
 * Se il RICEVENTE è in Hn:
 * - PONTE_SX / PONTE_DX → H(n+1)
 * - DONANTE_1..4        → H(n+2)
 */
const OFFSET_RUOLO = {
  RICEVENTE: 0,
  PONTE_SX: 1,
  PONTE_DX: 1,
  DONANTE_1: 2,
  DONANTE_2: 2,
  DONANTE_3: 2,
  DONANTE_4: 2
};

/**
 * Mapping del campo stelline per ogni movimento.
 */
const STELLE_PER_MOVIMENTO = {
  SMALL: 'stelle_rosse',
  MEDIUM: 'stelle_verdi',
  LARGE: 'stelle_blu'
};

// ========================================
// HELPER GENERAZIONI
// ========================================

/**
 * Calcola la generazione base (Hn) di una molecola a partire dal numero
 * di molecola.
 *
 * Regola: H1 = molecola 1,
 *         H2 = molecole 2..3,
 *         H3 = molecole 4..7,
 *         H4 = 8..15, ...
 *         in generale: H = floor(log2(molecola)) + 1
 */
function calcolaGenerazioneBaseDaMolecola(numeroMolecola) {
  if (!numeroMolecola || numeroMolecola <= 0) {
    throw new Error(`Numero molecola non valido: ${numeroMolecola}`);
  }
  return Math.floor(Math.log2(numeroMolecola)) + 1;
}

/**
 * Dato il numero di molecola e il ruolo strutturale, calcola la
 * generazione SMALL effettiva (Hn/Hn+1/Hn+2) per quella posizione.
 */
function calcolaGenerazioneSmallDaMolecolaERuolo(numeroMolecola, ruolo) {
  const base = calcolaGenerazioneBaseDaMolecola(numeroMolecola);
  const offset = OFFSET_RUOLO[ruolo] ?? 0;
  return base + offset;
}

// ========================================
// INIZIALIZZAZIONE DATABASE
// ========================================

/**
 * Inizializza il contesto PostgreSQL per il modulo di avanzamento.
 *
 * In pratica si limita a garantire che il pool PG sia inizializzato.
 * Le migrazioni 002/003/004 si occupano della creazione/aggiornamento
 * dello schema posizioni_stato e delle tabelle correlate.
 */
async function inizializzaDatabase() {
  await pg.initDatabase();
}

// ========================================
// POSIZIONI: INIZIALIZZAZIONE E QUERY
// ========================================

/**
 * Inizializza lo stato avanzamenti per una singola posizione.
 *
 * - Legge i dati strutturali dal database canonico (wallet_positions,
 *   wallet_master) tramite db-unified-manager-pg.getPosition.
 * - Calcola molecola_creazione, ruolo_creazione, generazioni H.
 * - Inserisce/aggiorna la riga in posizioni_stato mantenendo la
 *   pseudonimia (nessun nome in chiaro, solo wallet/posizione).
 *
 * @param {number} posizione - numero di posizione globale ROG
 * @param {string} [walletHint] - opzionale, wallet atteso (per verifica)
 */
async function inizializzaPosizione(posizione, walletHint = null) {
  if (!posizione || Number.isNaN(Number(posizione))) {
    throw new Error(`posizione non valida: ${posizione}`);
  }

  await inizializzaDatabase();

  const posNum = Number(posizione);

  // 1. Recupera info strutturali dal DB canonico (wallet_positions + wallet_master)
  const posInfo = await dbPg.getPosition(posNum);
  if (!posInfo) {
    throw new Error(`Posizione ${posNum} non trovata in wallet_positions`);
  }

  const wallet = String(posInfo.wallet || '').toLowerCase();
  if (!wallet || !wallet.startsWith('0x')) {
    throw new Error(`Wallet non valido per posizione ${posNum}: ${wallet}`);
  }

  if (walletHint && walletHint.toLowerCase() !== wallet) {
    console.warn(
      `⚠️  inizializzaPosizione: wallet hint ${walletHint} non coincide con wallet ${wallet} per posizione ${posNum}`
    );
  }

  const molecola = Number(posInfo.molecola || 0);
  const ruoloCreazione = String(posInfo.ruolo || '').toUpperCase();
  const movimento = String(posInfo.movimento || '').toUpperCase() || 'SMALL';

  if (!molecola || !ruoloCreazione) {
    throw new Error(
      `Posizione ${posNum}: dati incompleti da wallet_positions (molecola=${molecola}, ruolo=${ruoloCreazione})`
    );
  }

  // 2. Calcola generazioni per SMALL
  const generazioneSmallBase = calcolaGenerazioneBaseDaMolecola(molecola); // Hn (ricevente)
  const offset = OFFSET_RUOLO[ruoloCreazione] ?? 0;
  const generazioneSmall = generazioneSmallBase + offset;

  const client = await pg.getClient();
  try {
    await client.query('BEGIN');

    // 3. Inserisci/aggiorna posizioni_stato
    await client.query(
      `INSERT INTO posizioni_stato (
         posizione,
         wallet,
         molecola_creazione,
         ruolo_creazione,
         generazione_small_nativa,
         movimento_corrente,
         generazione_small,
         generazione_medium,
         generazione_large,
         ruolo_corrente,
         ciclo_corrente,
         stelle_rosse,
         stelle_verdi,
         stelle_blu,
         pronto_small_to_medium,
         pronto_medium_to_large,
         entered_small_at,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, NULL, NULL,
         $8,
         1,
         0, 0, 0,
         FALSE,
         FALSE,
         NOW(),
         NOW(),
         NOW()
       )
       ON CONFLICT (posizione) DO UPDATE SET
         wallet = EXCLUDED.wallet,
         molecola_creazione = EXCLUDED.molecola_creazione,
         ruolo_creazione = EXCLUDED.ruolo_creazione,
         generazione_small_nativa = EXCLUDED.generazione_small_nativa,
         movimento_corrente = EXCLUDED.movimento_corrente,
         generazione_small = EXCLUDED.generazione_small,
         ruolo_corrente = EXCLUDED.ruolo_corrente,
         updated_at = NOW();
      `,
      [
        posNum,
        wallet,
        molecola,
        ruoloCreazione,
        generazioneSmallBase,
        movimento,
        generazioneSmall,
        ruoloCreazione,
      ]
    );

    await client.query('COMMIT');

    return {
      posizione: posNum,
      wallet,
      molecola,
      ruolo_creazione: ruoloCreazione,
      movimento_iniziale: movimento,
      generazione_small_nativa: generazioneSmallBase,
      generazione_small: generazioneSmall
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ errore in inizializzaPosizione (PG):', error.message || error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Restituisce lo stato completo di una posizione da posizioni_stato.
 */
async function getStatoPosizione(posizione) {
  await inizializzaDatabase();
  const posNum = Number(posizione);
  if (!posNum || Number.isNaN(posNum)) {
    throw new Error(`posizione non valida: ${posizione}`);
  }

  const row = await pg.queryOne(
    `SELECT * FROM posizioni_stato WHERE posizione = $1`,
    [posNum]
  );

  return row || null;
}

/**
 * Restituisce statistiche aggregate per generazione e movimento
 * usando la view v_statistiche_generazioni definita in 002.
 */
async function getStatisticheGenerazioni() {
  await inizializzaDatabase();
  const rows = await pg.queryMany(
    `SELECT * FROM v_statistiche_generazioni ORDER BY generazione_nativa, movimento_corrente`
  );
  return rows;
}

// ========================================
// AVANZAMENTO CICLI (STELLINE + ROTAZIONE RUOLI)
// ========================================

function normalizzaMovimento(movimento) {
  const m = String(movimento || '').toUpperCase();
  if (!['SMALL', 'MEDIUM', 'LARGE'].includes(m)) {
    throw new Error(`Movimento non valido: ${movimento}`);
  }
  return m;
}

function getCampoStelle(movimento) {
  const m = normalizzaMovimento(movimento);
  const campo = STELLE_PER_MOVIMENTO[m];
  if (!campo) {
    throw new Error(`Nessun campo stelline definito per movimento ${m}`);
  }
  return campo;
}

/**
 * Avanza TUTTI i riceventi di un movimento per il ciclo corrente:
 * - +1 stella (rosse / verdi / blu)
 * - +1 ciclo_corrente
 * - ruolo_corrente → 'DONANTE_4' (come logica legacy)
 *
 * NOTA: la generazione (Hn/Hn+1/Hn+2) rimane invariata; non tocchiamo
 * i campi generazione_small/medium/large.
 */
async function avanzaRiceventiPg(client, movimento) {
  const m = normalizzaMovimento(movimento);
  const campoStelle = getCampoStelle(m);

  const sql = `
    UPDATE posizioni_stato
    SET
      ${campoStelle} = ${campoStelle} + 1,
      ciclo_corrente = ciclo_corrente + 1,
      ruolo_corrente = CASE
        WHEN ruolo_creazione LIKE 'DONANTE%' THEN ruolo_creazione
        ELSE 'DONANTE_4'
      END,
      ultimo_dono_ricevuto = NOW(),
      updated_at = NOW()
    WHERE movimento_corrente = $1
      AND ruolo_corrente = 'RICEVENTE'
  `;

  const res = await client.query(sql, [m]);
  return res.rowCount || 0;
}

/**
 * Avanza TUTTI i ponti di un movimento:
 * - ruolo_corrente LIKE 'PONTE%' → 'RICEVENTE'
 * - le generazioni rimangono invariate (restano nella loro H effettiva).
 */
async function avanzaPontiPg(client, movimento) {
  const m = normalizzaMovimento(movimento);

  const sql = `
    UPDATE posizioni_stato
    SET
      ruolo_corrente = 'RICEVENTE',
      updated_at = NOW()
    WHERE movimento_corrente = $1
      AND ruolo_corrente LIKE 'PONTE%'
  `;

  const res = await client.query(sql, [m]);
  return res.rowCount || 0;
}

/**
 * Avanza TUTTI i donanti di un movimento per il ciclo corrente:
 * - DONANTE_1/2 → PONTE_SX
 * - DONANTE_3/4 → PONTE_DX
 * (come da logica legacy in avanzamento-manager.js)
 */
async function avanzaDonantiPg(client, movimento) {
  const m = normalizzaMovimento(movimento);

  const sql = `
    UPDATE posizioni_stato
    SET
      ruolo_corrente = CASE
        WHEN ruolo_creazione IN ('DONANTE_1', 'DONANTE_2') THEN 'PONTE_SX'
        WHEN ruolo_creazione IN ('DONANTE_3', 'DONANTE_4') THEN 'PONTE_DX'
        ELSE 'PONTE_SX'
      END,
      updated_at = NOW()
    WHERE movimento_corrente = $1
      AND ruolo_corrente LIKE 'DONANTE%'
  `;

  const res = await client.query(sql, [m]);
  return res.rowCount || 0;
}

/**
 * Esegue l'onda di avanzamento ruoli per un singolo movimento:
 * - RICEVENTI → (stella + ciclo) → DONANTE_4
 * - PONTI → RICEVENTI
 * - DONANTI → PONTI
 */
async function avanzaRuoliPerMovimentoPg(client, movimento) {
  const m = normalizzaMovimento(movimento);
  const avanzatiRiceventi = await avanzaRiceventiPg(client, m);
  const avanzatiPonti = await avanzaPontiPg(client, m);
  const avanzatiDonanti = await avanzaDonantiPg(client, m);

  return {
    movimento: m,
    avanzatiRiceventi,
    avanzatiPonti,
    avanzatiDonanti
  };
}

/**
 * Registra il completamento di una generazione Hn per un certo movimento.
 * È il TRIGGER che userà il cycle-completion-engine PG quando tutti i
 * riceventi Hn hanno completato il ciclo corrente.
 */
async function registraCompletamentoGenerazione(movimento, generazioneNativa) {
  const m = normalizzaMovimento(movimento);
  const gen = Number(generazioneNativa);
  if (!gen || Number.isNaN(gen)) {
    throw new Error(`generazioneNativa non valida: ${generazioneNativa}`);
  }

  await inizializzaDatabase();

  const sql = `
    INSERT INTO generazioni_completate (
      movimento,
      generazione_nativa,
      riceventi_completati,
      avanzamento_eseguito,
      created_at,
      updated_at
    ) VALUES ($1, $2, 0, FALSE, NOW(), NOW())
    ON CONFLICT (movimento, generazione_nativa) DO UPDATE SET
      updated_at = EXCLUDED.updated_at
  `;

  await pg.query(sql, [m, gen]);

  return { movimento: m, generazione_nativa: gen };
}

/**
 * Esegue l'avanzamento di massa dopo il completamento di una generazione.
 * Replica la parte \"onda ruoli\" di avanzamento-manager.js e in più
 * innesca i passaggi SMALL→MEDIUM e MEDIUM→LARGE e la pulizia LARGE.
 *
 * Step:
 * 1) Avanza ruoli per il movimento che ha completato la generazione.
 * 2) Se il trigger è in SMALL, propaga l'onda anche a MEDIUM.
 * 3) Marca avanzamento_eseguito = TRUE per quella generazione.
 * 4) Verifica passaggi SMALL→MEDIUM e MEDIUM→LARGE.
 * 5) In LARGE, rimuove chi ha completato 8 cicli.
 */
async function avanzaInteraGenerazione(movimento, generazioneNativa) {
  const m = normalizzaMovimento(movimento);
  const gen = Number(generazioneNativa);
  if (!gen || Number.isNaN(gen)) {
    throw new Error(`generazioneNativa non valida: ${generazioneNativa}`);
  }

  await inizializzaDatabase();

  const client = await pg.getClient();
  try {
    await client.query('BEGIN');

    // 1. Avanza ruoli per il movimento che ha completato la generazione
    const avanzamentoPrimario = await avanzaRuoliPerMovimentoPg(client, m);

    // 2. Se la generazione completata è in SMALL, l'onda coinvolge anche MEDIUM
    let avanzamentoSecondario = null;
    if (m === 'SMALL') {
      avanzamentoSecondario = await avanzaRuoliPerMovimentoPg(client, 'MEDIUM');
    }

    // 3. Marca avanzamento_eseguito = TRUE per la generazione trigger
    await client.query(
      `UPDATE generazioni_completate
       SET avanzamento_eseguito = TRUE,
           updated_at = NOW()
       WHERE movimento = $1 AND generazione_nativa = $2`,
      [m, gen]
    );

    await client.query('COMMIT');

    // Dopo l'onda ruoli, verifichiamo possibili passaggi di movimento
    const passaggi = [];
    if (m === 'SMALL' || m === 'MEDIUM') {
      passaggi.push(...await verificaPassaggiMovimentoPg(m));
    }
    // Da SMALL può scatenare anche passaggi MEDIUM→LARGE (vasi comunicanti)
    if (m === 'SMALL') {
      passaggi.push(...await verificaPassaggiMovimentoPg('MEDIUM'));
    }

    // In LARGE, dopo l'onda globale, rimuoviamo chi ha concluso l'8° ciclo
    let removedLarge = 0;
    if (m === 'LARGE') {
      removedLarge = await rimuoviCompletatiLargePg();
    }

    return {
      success: true,
      movimento: m,
      generazione_nativa: gen,
      avanzamentoPrimario,
      avanzamentoSecondario,
      passaggi,
      removedLarge
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ errore in avanzaInteraGenerazione (PG):', error.message || error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verifica se ci sono generazioni pronte al passaggio SMALL→MEDIUM o MEDIUM→LARGE
 * per un dato movimento e, se presenti, esegue il passaggio per ognuna.
 *
 * La regola di soglia è:
 * - SMALL  → stelle_rosse >= 3 per TUTTE le posizioni della generazione nel movimento
 * - MEDIUM → stelle_verdi >= 3 per TUTTE le posizioni della generazione nel movimento
 */
async function verificaPassaggiMovimentoPg(movimentoCorrente) {
  const m = normalizzaMovimento(movimentoCorrente);
  if (m === 'LARGE') {
    return [];
  }

  await inizializzaDatabase();

  const campoStelle = m === 'SMALL' ? 'stelle_rosse' : 'stelle_verdi';
  const soglia = 3;

  // Seleziona le generazioni (generazione_small_nativa) per cui tutte le posizioni
  // nel movimento hanno raggiunto almeno la soglia di stelle.
  const sql = `
    SELECT generazione_small_nativa AS generazione_nativa,
           COUNT(*) AS posizioni_count,
           MIN(${campoStelle}) AS min_stelle,
           MAX(${campoStelle}) AS max_stelle
    FROM posizioni_stato
    WHERE movimento_corrente = $1
    GROUP BY generazione_small_nativa
    HAVING MIN(${campoStelle}) = $2 AND MAX(${campoStelle}) = $2
  `;

  const rows = await pg.queryMany(sql, [m, soglia]);

  const risultati = [];
  for (const row of rows) {
    const gen = Number(row.generazione_nativa);
    if (!gen || Number.isNaN(gen)) continue;

    const res = await eseguiPassaggioMovimentoPg(m, gen, Number(row.posizioni_count));
    risultati.push(res);
  }

  return risultati;
}

/**
 * Esegue passaggio movimento per intera generazione (SMALL→MEDIUM o MEDIUM→LARGE).
 *
 * - Tutte le posizioni con generazione_small_nativa = Hn e movimento_corrente = movimentoDa
 *   vengono spostate nel movimento successivo come DONANTE_4 ciclo 1.
 * - In SMALL→MEDIUM inizializziamo generazione_medium = generazione_small.
 * - In MEDIUM→LARGE per ora lasciamo generazione_large = NULL; verrà
 *   valorizzata quando saranno assegnate le molecole LARGE.
 */
async function eseguiPassaggioMovimentoPg(movimentoDa, generazioneNativa, posizioniCountAtteso = null) {
  const da = normalizzaMovimento(movimentoDa);
  const gen = Number(generazioneNativa);
  if (!gen || Number.isNaN(gen)) {
    throw new Error(`generazioneNativa non valida in eseguiPassaggioMovimentoPg: ${generazioneNativa}`);
  }

  const a = da === 'SMALL' ? 'MEDIUM' : 'LARGE';

  await inizializzaDatabase();
  const client = await pg.getClient();

  try {
    await client.query('BEGIN');

    const now = new Date();

    // Aggiorna tutte le posizioni della generazione per il movimento indicato
    const sqlUpdate = `
      UPDATE posizioni_stato
      SET
        movimento_corrente = $1,
        ciclo_corrente = 1,
        ruolo_corrente = 'DONANTE_4',
        pronto_small_to_medium = FALSE,
        pronto_medium_to_large = FALSE,
        generazione_medium = CASE
          WHEN $1 = 'MEDIUM' THEN COALESCE(generazione_medium, generazione_small)
          ELSE generazione_medium
        END,
        -- generazione_large verrà impostata quando si assegneranno le molecole LARGE
        entered_medium_at = CASE
          WHEN $1 = 'MEDIUM' THEN COALESCE(entered_medium_at, NOW())
          ELSE entered_medium_at
        END,
        entered_large_at = CASE
          WHEN $1 = 'LARGE' THEN COALESCE(entered_large_at, NOW())
          ELSE entered_large_at
        END,
        updated_at = NOW()
      WHERE generazione_small_nativa = $2
        AND movimento_corrente = $3
    `;

    const resUpdate = await client.query(sqlUpdate, [a, gen, da]);

    const effettive = resUpdate.rowCount || 0;
    if (posizioniCountAtteso !== null && effettive !== posizioniCountAtteso) {
      console.warn(
        `⚠️  eseguiPassaggioMovimentoPg: posizioni attese=${posizioniCountAtteso}, aggiornate=${effettive} (H${gen} ${da}→${a})`
      );
    }

    // Registra in coda_passaggi_movimento per tracciamento
    await client.query(
      `INSERT INTO coda_passaggi_movimento (
         generazione_nativa,
         movimento_da,
         movimento_a,
         posizioni_count,
         posizioni_processate,
         stato,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'COMPLETED', NOW(), NOW())`,
      [gen, da, a, effettive, effettive]
    );

    await client.query('COMMIT');

    return {
      generazione_nativa: gen,
      movimento_da: da,
      movimento_a: a,
      posizioni: effettive
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ errore in eseguiPassaggioMovimentoPg:', error.message || error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Rimuove dal sistema le posizioni che hanno concluso l'8° ciclo in LARGE.
 * Regola: quando stelle_blu >= 8 la posizione esce definitivamente.
 */
async function rimuoviCompletatiLargePg() {
  await inizializzaDatabase();

  const sql = `
    DELETE FROM posizioni_stato
    WHERE movimento_corrente = 'LARGE'
      AND stelle_blu >= 8
  `;

  const res = await pg.query(sql, []);
  return res.rowCount || 0;
}

module.exports = {
  // Config / init
  inizializzaDatabase,

  // Posizioni
  inizializzaPosizione,
  getStatoPosizione,
  getStatisticheGenerazioni,

  // Avanzamento cicli / passaggi movimenti
  registraCompletamentoGenerazione,
  avanzaInteraGenerazione,
  verificaPassaggiMovimentoPg,
  eseguiPassaggioMovimentoPg,
  rimuoviCompletatiLargePg,

  // Costanti / helper
  OFFSET_RUOLO,
  STELLE_PER_MOVIMENTO,
  calcolaGenerazioneBaseDaMolecola,
};
