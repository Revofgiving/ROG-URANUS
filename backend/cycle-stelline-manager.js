/**
 * 🎯 CYCLE & STELLINE MANAGER - Gestione Cicli e Stelline Automatiche
 * 
 * Sistema completo per:
 * - Avanzamento cicli automatico (1→2→3 per SMALL/MEDIUM, 1→8 per LARGE)
 * - Assegnazione stelline a completamento ciclo
 * - Transizioni automatiche SMALL→MEDIUM→LARGE
 * - Integrazione con db-unified-manager per persistenza (solo in ambiente legacy SQLite)
 * 
 * LOGICA STELLINE:
 * 🔴 SMALL: 1 stellina rossa per ciclo completato (max 3)
 * 🟢 MEDIUM: 1 stellina verde per ciclo completato (max 3) + 3 rosse ereditate
 * 🔵 LARGE: 1 stellina blu per ciclo completato (max 8) + 3 verdi + 3 rosse ereditate
 * 
 * TRANSIZIONI:
 * SMALL→MEDIUM: 3🔴 stelline + 10€ accumulo
 * MEDIUM→LARGE: 3🟢 stelline + 100€ accumulo
 * 
 * In modalità PostgreSQL-only (DATABASE_URL presente) questo modulo NON usa più
 * SQLite: le funzioni che richiedono avanzamenti complessi vengono disabilitate,
 * mentre per l'area personale vengono restituiti valori di stelline di default
 * (0 stelle, ciclo 1) per evitare crash mantenendo la UI funzionante.
 * 
 * @author Warp AI Agent
 * @version 2.1.0 - PostgreSQL-only safe
 * @date 13 Gennaio 2026
 */

const HAS_POSTGRES = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);
let dbManager = null;

// Carichiamo db-unified-manager (SQLite) SOLO se PostgreSQL non è configurato.
if (!HAS_POSTGRES) {
  try {
    // eslint-disable-next-line global-require
    dbManager = require('./db-unified-manager');
  } catch (err) {
    // In ambiente senza SQLite disponibile useremo solo i fallback.
    // Non rilanciamo l'errore per non bloccare il processo.
    // eslint-disable-next-line no-console
    console.warn('⚠️ cycle-stelline-manager: db-unified-manager non disponibile:', err.message);
  }
}

// Fonte di verità avanzamenti/stelline: tabella posizioni_stato in ROG_MASTER.db (solo legacy SQLite)
function getAvanzDb() {
  if (!dbManager) {
    throw new Error('Avanzamenti non disponibili: db-unified-manager (SQLite) non inizializzato');
  }
  dbManager.initDatabases();
  return dbManager.getDb().master;
}

// ========================================
// CONFIGURAZIONE CICLI E STELLINE
// ========================================

const MOVIMENTO_CONFIG = {
  SMALL: {
    cicli_totali: 3,
    dono_per_ciclo: [1, 2, 4], // €
    stelline_colore: 'ROSSA',
    transizione_a: 'MEDIUM',
    accumulo_required: 10.00,
    stelline_required: 3
  },
  MEDIUM: {
    cicli_totali: 3,
    dono_per_ciclo: [10, 20, 40], // €
    stelline_colore: 'VERDE',
    transizione_a: 'LARGE',
    accumulo_required: 100.00,
    stelline_required: 3,
    eredita_stelline_rosse: 3
  },
  LARGE: {
    cicli_totali: 8,
    dono_per_ciclo: [100, 200, 400, 800, 1600, 3200, 6400, 12800], // €
    stelline_colore: 'BLU',
    eredita_stelline_rosse: 3,
    eredita_stelline_verdi: 3
  }
};

// ========================================
// REGISTRAZIONE DONO E AVANZAMENTO CICLO
// ========================================

/**
 * Registra dono ricevuto e gestisce avanzamento ciclo
 * 
 * @param {number} posizione - Numero posizione
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @param {number} importoDono - Importo dono ricevuto in €
 * @returns {Promise<Object>} Risultato operazione
 */
async function registraDonoRicevuto(posizione, movimento, importoDono) {
  try {
    console.log(`\n💰 REGISTRAZIONE DONO RICEVUTO`);
    console.log(`   Posizione: ${posizione}`);
    console.log(`   Movimento: ${movimento}`);
    console.log(`   Importo: ${importoDono}€`);
    
    // Inizializza database
    dbManager.initDatabases();
    
    // Ottieni posizione corrente
    const pos = await dbManager.getPosition(posizione, movimento);
    if (!pos) {
      throw new Error(`Posizione ${posizione} non trovata in ${movimento}`);
    }
    
    const config = MOVIMENTO_CONFIG[movimento];
    const cicloCorrente = pos.ciclo_corrente || 1;
    
    console.log(`   Ciclo corrente: ${cicloCorrente}/${config.cicli_totali}`);
    console.log(`   Dono atteso: ${config.dono_per_ciclo[cicloCorrente - 1]}€`);
    
    // Verifica importo corretto
    const donoAtteso = config.dono_per_ciclo[cicloCorrente - 1];
    if (importoDono !== donoAtteso) {
      console.warn(`   ⚠️  Importo non corretto! Atteso ${donoAtteso}€, ricevuto ${importoDono}€`);
    }
    
    // Marca ciclo completato
    const result = await completaCiclo(posizione, movimento, cicloCorrente);
    
    // Verifica se serve transizione movimento
    if (result.transitaA) {
      const transResult = await eseguiTransizione(posizione, movimento, result.transitaA);
      result.transizione = transResult;
    }
    
    dbManager.closeDatabases();
    
    return {
      success: true,
      posizione,
      movimento,
      ciclo_completato: cicloCorrente,
      stelline_totali: result.stelline_totali,
      prossimo_ciclo: result.prossimo_ciclo,
      transita_a: result.transitaA || null,
      transizione: result.transizione || null
    };
    
  } catch (error) {
    console.error('❌ Errore registrazione dono:', error);
    dbManager.closeDatabases();
    throw error;
  }
}

// ========================================
// COMPLETAMENTO CICLO E STELLINE
// ========================================

/**
 * Completa un ciclo e assegna stellina
 * 
 * @param {number} posizione - Numero posizione
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @param {number} ciclo - Numero ciclo da completare
 * @returns {Promise<Object>} Risultato completamento
 */
async function completaCiclo(posizione, movimento, ciclo) {
  try {
    const config = MOVIMENTO_CONFIG[movimento];
    const db = dbManager.getDatabase(movimento);
    
    console.log(`\n✅ COMPLETAMENTO CICLO ${ciclo}`);
    
    // Marca ciclo completato
    const colonnaCiclo = `ciclo_${ciclo}_completato`;
    const colonnaData = `ciclo_${ciclo}_data`;
    
    await db.run(`
      UPDATE posizioni_${movimento.toLowerCase()}
      SET ${colonnaCiclo} = 1,
          ${colonnaData} = datetime('now')
      WHERE posizione = ?
    `, [posizione]);
    
    console.log(`   ✅ Ciclo ${ciclo} marcato completato`);
    
    // Assegna stellina
    const nuovoNumeroStelline = await aggiornaStellline(posizione, movimento);
    
    console.log(`   ⭐ Stelline ${config.stelline_colore}: ${nuovoNumeroStelline}/${config.stelline_required || config.cicli_totali}`);
    
    // Determina prossimo ciclo
    let prossimoCiclo = ciclo + 1;
    let transitaA = null;
    
    // Verifica se deve transitare
    if (movimento === 'SMALL' && ciclo === 3) {
      // Verifica accumulo 10€
      const pos = await dbManager.getPosition(posizione, movimento);
      if (pos.accumulo_medium >= 10.00) {
        console.log(`   📈 PRONTO PER TRANSIZIONE: SMALL → MEDIUM`);
        console.log(`      3🔴 stelline rosse + 10€ accumulo ✅`);
        transitaA = 'MEDIUM';
      }
    } else if (movimento === 'MEDIUM' && ciclo === 3) {
      // Verifica accumulo 100€
      const pos = await dbManager.getPosition(posizione, movimento);
      if (pos.accumulo_large >= 100.00) {
        console.log(`   📈 PRONTO PER TRANSIZIONE: MEDIUM → LARGE`);
        console.log(`      3🟢 stelline verdi + 100€ accumulo ✅`);
        transitaA = 'LARGE';
      }
    } else if (movimento === 'LARGE' && ciclo === 8) {
      console.log(`   🎉 PERCORSO LARGE COMPLETATO!`);
      console.log(`      8🔵 stelline blu - Utente ha ricevuto tutto`);
      prossimoCiclo = null; // Fine percorso
    }
    
    // Aggiorna ciclo corrente se non transita
    if (!transitaA && prossimoCiclo) {
      await db.run(`
        UPDATE posizioni_${movimento.toLowerCase()}
        SET ciclo_corrente = ?
        WHERE posizione = ?
      `, [prossimoCiclo, posizione]);
      
      console.log(`   ➡️  Avanzato a ciclo ${prossimoCiclo}`);
    }
    
    return {
      success: true,
      ciclo_completato: ciclo,
      stelline_totali: nuovoNumeroStelline,
      prossimo_ciclo: prossimoCiclo,
      transitaA: transitaA
    };
    
  } catch (error) {
    console.error('❌ Errore completamento ciclo:', error);
    throw error;
  }
}

/**
 * Aggiorna contatore stelline per movimento
 * 
 * NOTA IMPORTANTE:
 * - Per SMALL/MEDIUM: usa ancora le tabelle posizioni_small/medium (accumuli)
 * - Per LARGE: la logica delle stelline blu è ora gestita principalmente
 *   tramite data/avanzamenti.db (posizioni_stato) e sync-large-stelline.js.
 *   Questo metodo viene lasciato per retrocompatibilità ma non viene usato
 *   per sovrascrivere i valori già sincronizzati in posizioni_stato.
 * 
 * @param {number} posizione - Numero posizione
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @returns {Promise<number>} Nuovo numero stelline
 */
async function aggiornaStellline(posizione, movimento) {
  // Per LARGE non tocchiamo più direttamente le stelline qui,
  // perché sono state calcolate e salvate in avanzamenti.db.
  if (movimento === 'LARGE') {
    const dbAv = getAvanzDb();
    try {
      const row = await new Promise((resolve, reject) => {
        dbAv.get(
          'SELECT stelle_blu AS stelline FROM posizioni_stato WHERE posizione = ? AND movimento_corrente = "LARGE"',
          [posizione],
          (err, r) => (err ? reject(err) : resolve(r))
        );
      });
      return row?.stelline || 0;
    } catch (e) {
      return 0;
    }
  }

  const db = dbManager.getDatabase(movimento);
  const config = MOVIMENTO_CONFIG[movimento];
  
  let colonnaStellline;
  if (movimento === 'SMALL') colonnaStellline = 'stelline_rosse';
  else if (movimento === 'MEDIUM') colonnaStellline = 'stelline_verdi';
  
  // Incrementa stelline
  await db.run(`
    UPDATE posizioni_${movimento.toLowerCase()}
    SET ${colonnaStellline} = ${colonnaStellline} + 1
    WHERE posizione = ?
  `, [posizione]);
  
  // Leggi nuovo valore
  const row = await db.get(`
    SELECT ${colonnaStellline} as stelline
    FROM posizioni_${movimento.toLowerCase()}
    WHERE posizione = ?
  `, [posizione]);
  
  return row.stelline;
}

// ========================================
// TRANSIZIONI MOVIMENTO
// ========================================

/**
 * Esegue transizione SMALL→MEDIUM o MEDIUM→LARGE
 * 
 * @param {number} posizione - Numero posizione origine
 * @param {string} movimentoOrigine - SMALL | MEDIUM
 * @param {string} movimentoDestinazione - MEDIUM | LARGE
 * @returns {Promise<Object>} Risultato transizione
 */
async function eseguiTransizione(posizione, movimentoOrigine, movimentoDestinazione) {
  try {
    console.log(`\n🔄 TRANSIZIONE ${movimentoOrigine} → ${movimentoDestinazione}`);
    console.log(`   Posizione: ${posizione}`);
    
    // Ottieni posizione origine
    const posOrigine = await dbManager.getPosition(posizione, movimentoOrigine);
    if (!posOrigine) {
      throw new Error(`Posizione ${posizione} non trovata in ${movimentoOrigine}`);
    }
    
    // Trova prossima molecola libera in destinazione
    const prossimaMolecola = await trovaProssimaMolecolaLibera(movimentoDestinazione);
    
    console.log(`   Molecola destinazione: ${prossimaMolecola}`);
    console.log(`   Wallet: ${posOrigine.wallet}`);
    console.log(`   Nome: ${posOrigine.nome}`);
    
    // Crea nuova posizione in movimento destinazione
    const dbDest = dbManager.getDatabase(movimentoDestinazione);
    
    // Calcola generazione
    const generazione = calcolaGenerazioneDaMolecola(prossimaMolecola);
    
    // Determina ruolo in molecola (semplificato: usa modulo 4)
    const posizioneInMolecola = ((posizione - 1) % 4) + 1;
    let ruolo;
    if (posizioneInMolecola === 1) ruolo = 'RICEVENTE';
    else if (posizioneInMolecola === 2 || posizioneInMolecola === 3) ruolo = 'PONTE_SX';
    else ruolo = 'DONANTE_1';
    
    let sql, params;
    
    if (movimentoDestinazione === 'MEDIUM') {
      sql = `
        INSERT INTO posizioni_medium (
          posizione, nome, wallet, tipo, molecola, generazione, ruolo,
          ciclo_corrente, stelline_verdi, stelline_rosse,
          posizione_small, ingresso_medium_da_small
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 3, ?, datetime('now'))
      `;
      params = [
        posizione,
        posOrigine.nome,
        posOrigine.wallet,
        posOrigine.tipo,
        prossimaMolecola,
        generazione,
        ruolo,
        posizione // posizione_small
      ];
    } else if (movimentoDestinazione === 'LARGE') {
      sql = `
        INSERT INTO posizioni_large (
          posizione, nome, wallet, tipo, molecola, generazione, ruolo,
          ciclo_corrente, stelline_blu, stelline_verdi, stelline_rosse,
          origine, posizione_medium, ingresso_large_da_medium
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 3, 3, 'DA_MEDIUM', ?, datetime('now'))
      `;
      params = [
        posizione,
        posOrigine.nome,
        posOrigine.wallet,
        posOrigine.tipo,
        prossimaMolecola,
        generazione,
        ruolo,
        posizione // posizione_medium
      ];
    }
    
    await dbDest.run(sql, params);
    
    console.log(`   ✅ Posizione creata in ${movimentoDestinazione}`);
    console.log(`   Molecola: ${prossimaMolecola} (${generazione})`);
    console.log(`   Ruolo: ${ruolo}`);
    
    // Aggiorna tracking in MASTER
    await aggiornaMovimentoMaster(posOrigine.wallet, movimentoDestinazione);
    
    return {
      success: true,
      posizione_origine: posizione,
      movimento_origine: movimentoOrigine,
      movimento_destinazione: movimentoDestinazione,
      molecola: prossimaMolecola,
      generazione: generazione,
      stelline_ereditate: {
        rosse: movimentoDestinazione === 'MEDIUM' ? 3 : 3,
        verdi: movimentoDestinazione === 'LARGE' ? 3 : 0
      }
    };
    
  } catch (error) {
    console.error('❌ Errore transizione:', error);
    throw error;
  }
}

/**
 * Trova prossima molecola libera in un movimento
 * 
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @returns {Promise<number>} Numero molecola
 */
async function trovaProssimaMolecolaLibera(movimento) {
  const db = dbManager.getDatabase(movimento);
  
  // Trova ultima molecola usata
  const row = await db.get(`
    SELECT MAX(molecola) as max_molecola
    FROM posizioni_${movimento.toLowerCase()}
  `);
  
  const ultimaMolecola = row.max_molecola || 0;
  
  // Verifica se ultima molecola è completa (4 posizioni)
  const countRow = await db.get(`
    SELECT COUNT(*) as count
    FROM posizioni_${movimento.toLowerCase()}
    WHERE molecola = ?
  `, [ultimaMolecola]);
  
  if (countRow.count >= 4) {
    // Molecola piena, crea nuova
    return ultimaMolecola + 1;
  } else {
    // Molecola incompleta, usa quella
    return ultimaMolecola;
  }
}

/**
 * Calcola generazione H da numero molecola
 * 
 * @param {number} molecola - Numero molecola
 * @returns {string} Generazione (es. 'H2', 'H3', 'H10')
 */
function calcolaGenerazioneDaMolecola(molecola) {
  if (molecola <= 0) return 'H1';
  if (molecola <= 2) return 'H2';
  if (molecola <= 6) return 'H3';
  if (molecola <= 14) return 'H4';
  if (molecola <= 30) return 'H5';
  if (molecola <= 62) return 'H6';
  if (molecola <= 126) return 'H7';
  if (molecola <= 254) return 'H8';
  if (molecola <= 510) return 'H9';
  if (molecola <= 1022) return 'H10';
  if (molecola <= 2046) return 'H11';
  if (molecola <= 4094) return 'H12';
  
  // Oltre H12, calcolo dinamico
  let h = 13;
  let limite = 8190;
  while (molecola > limite) {
    h++;
    limite = Math.pow(2, h) - 2;
  }
  return `H${h}`;
}

/**
 * Aggiorna movimento massimo per wallet in MASTER
 * 
 * @param {string} wallet - Wallet address
 * @param {string} nuovoMovimento - MEDIUM | LARGE
 */
async function aggiornaMovimentoMaster(wallet, nuovoMovimento) {
  const dbMaster = dbManager.getDatabase('MASTER');
  
  await dbMaster.run(`
    UPDATE wallet_master
    SET movimento_max = ?
    WHERE wallet = ?
  `, [nuovoMovimento, wallet]);
  
  console.log(`   📊 MASTER aggiornato: movimento_max = ${nuovoMovimento}`);
}

// ========================================
// UTILITY - VISUALIZZAZIONE STELLINE
// ========================================

/**
 * Ottiene emoji stelline per una posizione
 * 
 * PRIORITÀ DATI:
 * - Se esiste una riga in data/avanzamenti.db (posizioni_stato), usa quella
 *   come fonte principale delle stelline (rosse, verdi, blu).
 * - Altrimenti, fallback su wallet_master/wallet_positions via db-unified-manager.
 * 
 * @param {number} posizione - Numero posizione
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @returns {Promise<string>} Emoji stelline (es. '🔴🔴🔴🟢🟢')
 */
async function getStellineEmoji(posizione, movimento) {
  // In modalità PostgreSQL-only NON abbiamo ancora la replica di posizioni_stato;
  // per evitare qualsiasi accesso a SQLite restituiamo stringa vuota.
  if (HAS_POSTGRES) {
    return '';
  }

  // Fonte di verità: posizioni_stato in ROG_MASTER.db (legacy SQLite)
  try {
    const dbAv = getAvanzDb();
    const row = await new Promise((resolve, reject) => {
      dbAv.get(
        'SELECT stelle_rosse, stelle_verdi, stelle_blu FROM posizioni_stato WHERE posizione = ?',
        [posizione],
        (err, r) => (err ? reject(err) : resolve(r))
      );
    });

    if (row) {
      let emoji = '';
      if (row.stelle_rosse) emoji += '🔴'.repeat(row.stelle_rosse);
      if (row.stelle_verdi) emoji += '🟢'.repeat(row.stelle_verdi);
      if (row.stelle_blu)   emoji += '🔵'.repeat(row.stelle_blu);
      return emoji;
    }
  } catch (e) {
    // ignore
  }

  return '';
}

/**
 * Ottiene stato completo ciclo per posizione
 * 
 * PRIORITÀ DATI:
 * - Se c'è una riga in posizioni_stato (avanzamenti.db), usa quella come
 *   fonte principale per ciclo_corrente e stelline.
 * - Altrimenti, fallback su db-unified-manager (wallet_positions / posizioni_*).
 * 
 * @param {number} posizione - Numero posizione
 * @param {string} movimento - SMALL | MEDIUM | LARGE
 * @returns {Promise<Object>} Stato dettagliato
 */
async function getStatoCiclo(posizione, movimento) {
  const movNorm = (movimento || 'SMALL').toUpperCase();
  const config = MOVIMENTO_CONFIG[movNorm] || MOVIMENTO_CONFIG.SMALL;

  // In modalità PostgreSQL-only ritorniamo uno stato "neutro" senza toccare SQLite.
  if (HAS_POSTGRES) {
    const stellineEmoji = '';
    return {
      posizione,
      movimento: movNorm,
      ciclo_corrente: 1,
      cicli_completati: 0,
      cicli_totali: config.cicli_totali,
      stelline_emoji: stellineEmoji,
      stelline_rosse: 0,
      stelline_verdi: 0,
      stelline_blu: 0,
      accumulo_medium: 0,
      accumulo_large: 0,
      pronto_transizione: false
    };
  }

  // Fonte di verità: posizioni_stato in ROG_MASTER.db (legacy SQLite)
  try {
    const dbAv = getAvanzDb();
    const row = await new Promise((resolve, reject) => {
      dbAv.get(
        'SELECT movimento_corrente, generazione_nativa, ruolo_corrente, ciclo_corrente, stelle_rosse, stelle_verdi, stelle_blu FROM posizioni_stato WHERE posizione = ?',
        [posizione],
        (err, r) => (err ? reject(err) : resolve(r))
      );
    });

    if (row) {
      const mov = (row.movimento_corrente || movNorm).toUpperCase();
      const cfg = MOVIMENTO_CONFIG[mov] || config;
      const stellineEmoji = await getStellineEmoji(posizione, mov);

      const cicliCompletati =
        mov === 'SMALL' ? (row.stelle_rosse || 0) :
        mov === 'MEDIUM' ? (row.stelle_verdi || 0) :
        (row.stelle_blu || 0);

      const prontoTransizione =
        (mov === 'SMALL' && (row.stelle_rosse || 0) >= 3) ||
        (mov === 'MEDIUM' && (row.stelle_verdi || 0) >= 3) ||
        false;

      return {
        posizione,
        movimento: mov,
        ciclo_corrente: row.ciclo_corrente || 1,
        cicli_completati: cicliCompletati,
        cicli_totali: cfg.cicli_totali,
        stelline_emoji: stellineEmoji,
        stelline_rosse: row.stelle_rosse || 0,
        stelline_verdi: row.stelle_verdi || 0,
        stelline_blu: row.stelle_blu || 0,
        accumulo_medium: 0,
        accumulo_large: 0,
        pronto_transizione: prontoTransizione
      };
    }
  } catch (e) {
    // ignore
  }

  // Se non abbiamo record avanzamenti, default minimale
  const stellineEmoji = await getStellineEmoji(posizione, movNorm);
  return {
    posizione,
    movimento: movNorm,
    ciclo_corrente: 1,
    cicli_completati: 0,
    cicli_totali: config.cicli_totali,
    stelline_emoji: stellineEmoji,
    stelline_rosse: 0,
    stelline_verdi: 0,
    stelline_blu: 0,
    accumulo_medium: 0,
    accumulo_large: 0,
    pronto_transizione: false
  };
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  registraDonoRicevuto,
  completaCiclo,
  eseguiTransizione,
  getStellineEmoji,
  getStatoCiclo,
  MOVIMENTO_CONFIG
};
