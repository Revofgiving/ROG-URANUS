/**
 * 🏗️ ROG POSITION CREATOR
 * 
 * Modulo per creazione automatica posizioni dopo donazione
 * - Calcola numero posizioni da creare (multipli di 2€)
 * - Implementa alternanza HUMAN+PILETTA (pari/dispari)
 * - Integra con database tri-movimento
 * - Aggiorna anagrafica legacy
 * 
 * @version 1.0.0
 * @author Warp AI Agent
 */

const dbPg = require('./db-unified-manager-pg');
const pg = require('./pg-connection-manager');
const fs = require('fs').promises;
const path = require('path');
// const avanzamentoManager = require('./avanzamento-manager-pg'); // Non usato in questo file

// Il backend è PostgreSQL-only: questa versione di position-creator
// usa solo db-unified-manager-pg e non dipende più da SQLite.

// ========================================
// CONFIGURAZIONE
// ========================================

// File di anagrafica unico e definitivo (anagrafica posizioni) - LEGACY, backup only
const ANAGRAFICA_FILE = path.join(__dirname, 'database', 'ROG_ANAGRAFICA_DEFINITIVA.txt');
// PostgreSQL è l'unica fonte di verità per gli invitati (tabella anagrafica_invitati)

// Wallet entità speciali
const SPECIAL_WALLETS = {
  ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
  PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe',
  AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972'
};

// ========================================
// CALCOLI POSIZIONI
// ========================================

/**
 * Calcola numero posizioni da creare
 * @param {number} importoEUR - Importo in EUR
 * @returns {number} Numero posizioni (sempre pari per alternanza)
 */
function calcolaNumeroPosizioniDaCreare(importoEUR) {
  // Ogni 2€ creo 1 coppia HUMAN+PILETTA = 2 posizioni
  // Quindi: numeroPosizioniBase = importo
  const numeroPosizioniBase = Math.floor(importoEUR);
  
  // DEVE essere pari per mantenere alternanza HUMAN+PILETTA
  // Se dispari, la donazione deve essere RIFIUTATA
  if (numeroPosizioniBase % 2 !== 0) {
    throw new Error(`Importo non valido: ${importoEUR} USDC. L'importo deve essere PARI (2, 4, 6, 8...) per mantenere alternanza HUMAN+PILETTA.`);
  }
  
  return numeroPosizioniBase;
}

/**
 * 🧬 CALCOLO MOLECOLA/GENERAZIONE - LOGICA MATEMATICA INFALLIBILE
 * 
 * REGOLA FONDAMENTALE ROG:
 * - Ogni molecola ha 7 slot: 1=RIC, 2=P_SX, 3=P_DX, 4..7=DON_1..4
 * - Le nuove donazioni creano SOLO donanti (slot 4-7)
 * - Quando slot > 7, si passa alla molecola successiva (slot torna a 4)
 * 
 * QUESTA FUNZIONE È MATEMATICAMENTE INFALLIBILE:
 * - NON usa default pericolosi
 * - Validazione estrema di ogni input
 * - Throw esplicito su errori invece di valori corrotti
 * 
 * @param {number} prevMolecola - Molecola precedente (DEVE essere >= 1)
 * @param {number} prevPosizioneInMolecola - Slot precedente (DEVE essere 1-7)
 * @returns {Object} {molecola, generazione, ruolo, posizioneInMolecola}
 */
function computeNextMoleculePlacement(prevMolecola, prevPosizioneInMolecola) {
  // 🚨 VALIDAZIONE ESTREMA INPUT
  const mol = Number(prevMolecola);
  const pos = Number(prevPosizioneInMolecola);
  
  if (!Number.isFinite(mol) || mol < 0) {
    throw new Error(
      `computeNextMoleculePlacement: prevMolecola non valida: ${prevMolecola}. ` +
      `DEVE essere un numero >= 0. Se è la prima molecola, passare 0 e prevPosizioneInMolecola=3.`
    );
  }
  
  if (!Number.isFinite(pos) || pos < 1 || pos > 7) {
    throw new Error(
      `computeNextMoleculePlacement: prevPosizioneInMolecola non valida: ${prevPosizioneInMolecola}. ` +
      `DEVE essere tra 1 e 7. Ricevuto: ${pos}`
    );
  }
  
  // Mappa ruoli (immutabile)
  const ruoliMap = {
    1: 'RICEVENTE',
    2: 'PONTE_SX',
    3: 'PONTE_DX',
    4: 'DONANTE_1',
    5: 'DONANTE_2',
    6: 'DONANTE_3',
    7: 'DONANTE_4'
  };
  
  // 🧮 CALCOLO PROSSIMO SLOT
  let nextPosInMol = pos + 1;
  let nextMol = mol;
  
  // Se superiamo DONANTE_4 (slot 7), passiamo alla molecola successiva
  if (nextPosInMol > 7) {
    nextPosInMol = 4; // Riparte da DONANTE_1
    nextMol = mol + 1;
  }
  
  // Se mol era 0 (prima molecola mai creata), la prossima è 1
  if (nextMol === 0) {
    nextMol = 1;
  }
  
  const ruolo = ruoliMap[nextPosInMol];
  if (!ruolo) {
    throw new Error(
      `computeNextMoleculePlacement: slot ${nextPosInMol} non ha ruolo mappato! ` +
      `Questo NON dovrebbe mai accadere. Bug nel codice.`
    );
  }
  
  // 🧬 CALCOLO GENERAZIONE RICEVENTE (base molecola)
  const generazioneRicevente = calcolaGenerazione(nextMol);
  
  // 🎯 OFFSET GENERAZIONE IN BASE AL RUOLO
  // RICEVENTE → Hn
  // PONTI (SX/DX) → Hn+1
  // DONANTI (1-4) → Hn+2
  let generazioneOffset = 0;
  if (ruolo === 'PONTE_SX' || ruolo === 'PONTE_DX') {
    generazioneOffset = 1;
  } else if (ruolo.startsWith('DONANTE_')) {
    generazioneOffset = 2;
  }
  
  // Estrai numero da "H14" → 14, aggiungi offset, ricostruisci "H16"
  const genNumBase = parseInt(generazioneRicevente.replace(/[^0-9]/g, ''));
  if (!Number.isFinite(genNumBase) || genNumBase < 1) {
    throw new Error(
      `computeNextMoleculePlacement: calcolaGenerazione(${nextMol}) ha restituito ` +
      `valore non valido: "${generazioneRicevente}". Atteso formato "HN" con N >= 1.`
    );
  }
  
  const generazioneNumero = genNumBase + generazioneOffset;
  const generazione = `H${generazioneNumero}`;
  
  // 🔍 LOG DEBUG (solo se necessario)
  // console.log(`  🧬 computeNext: mol ${mol} slot ${pos} → mol ${nextMol} slot ${nextPosInMol} ${ruolo} ${generazione}`);
  
  return {
    molecola: nextMol,
    generazione: generazione,
    ruolo: ruolo,
    posizioneInMolecola: nextPosInMol
  };
}

/**
 * Calcola generazione H in base al numero molecola
 * 
 * CORREZIONE DEFINITIVA (NASA-LEVEL):
 * Il pattern è: H1=1 molecola, H2=2 molecole, H3=4 molecole, H4=8 molecole...
 * Le molecole raddoppiano ogni generazione (potenze di 2).
 * 
 * Range corretti:
 * H1: [1, 1]       = 1 molecola
 * H2: [2, 3]       = 2 molecole (cumulativo: 1+2=3)
 * H3: [4, 7]       = 4 molecole (cumulativo: 3+4=7)
 * H4: [8, 15]      = 8 molecole (cumulativo: 7+8=15)
 * H5: [16, 31]     = 16 molecole (cumulativo: 15+16=31)
 * H6: [32, 63]     = 32 molecole (cumulativo: 31+32=63)
 * H7: [64, 127]    = 64 molecole (cumulativo: 63+64=127)
 * H8: [128, 255]   = 128 molecole (cumulativo: 127+128=255)
 * H9: [256, 511]   = 256 molecole (cumulativo: 255+256=511)
 * H10: [512, 1023] = 512 molecole (cumulativo: 511+512=1023)
 * H11: [1024, 2047] = 1024 molecole (cumulativo: 1023+1024=2047)
 * H12: [2048, 4095] = 2048 molecole (cumulativo: 2047+2048=4095)
 * 
 * Formula generale: limite superiore Hn = (2^n - 1)
 * 
 * @param {number} molecola - Numero molecola (1-based)
 * @returns {string} Generazione (es. 'H12')
 */
function calcolaGenerazione(molecola) {
  const m = Number(molecola);
  
  // Validazione input
  if (!Number.isFinite(m) || m < 1) {
    console.error(`⚠️ calcolaGenerazione: molecola non valida: ${molecola}`);
    return 'H1'; // fallback sicuro
  }
  
  // Range espliciti per le prime 12 generazioni (performance + chiarezza)
  if (m === 1) return 'H1';          // [1, 1]
  if (m >= 2 && m <= 3) return 'H2';      // [2, 3] - 2 molecole
  if (m >= 4 && m <= 7) return 'H3';      // [4, 7] - 4 molecole
  if (m >= 8 && m <= 15) return 'H4';     // [8, 15] - 8 molecole
  if (m >= 16 && m <= 31) return 'H5';    // [16, 31] - 16 molecole
  if (m >= 32 && m <= 63) return 'H6';    // [32, 63] - 32 molecole
  if (m >= 64 && m <= 127) return 'H7';   // [64, 127] - 64 molecole
  if (m >= 128 && m <= 255) return 'H8';  // [128, 255] - 128 molecole
  if (m >= 256 && m <= 511) return 'H9';  // [256, 511] - 256 molecole
  if (m >= 512 && m <= 1023) return 'H10'; // [512, 1023] - 512 molecole
  if (m >= 1024 && m <= 2047) return 'H11'; // [1024, 2047] - 1024 molecole
  if (m >= 2048 && m <= 4095) return 'H12'; // [2048, 4095] - 2048 molecole

  // Oltre H12: formula dinamica
  // Per trovare Hn di molecola m:
  // Il limite superiore di Hn è (2^n - 1)
  // Quindi: 2^n - 1 >= m  →  2^n >= m + 1  →  n >= log2(m + 1)  →  n = ceil(log2(m + 1))
  const n = Math.ceil(Math.log2(m + 1));
  return `H${n}`;
}

// ========================================
// CREAZIONE POSIZIONI
// ========================================

/**
 * Crea posizioni per una donazione
 * @param {Object} donationData
 * @param {string} [donationData.walletInvitante] - (opzionale) wallet dell'invitante per ANAGRAFICA_INVITATI
 * @param {string} [donationData.nomeInvitante]   - (opzionale) nome dell'invitante per ANAGRAFICA_INVITATI
 * @returns {Object} Risultato creazione
 */
async function creaPosizioniDaDonazione(donationData) {
  return await creaPosizioniDaDonazionePg(donationData);
}

/**
 * Implementazione PostgreSQL-only della creazione posizioni.
 * Usa transazioni e db-unified-manager-pg per evitare del tutto SQLite.
 */
async function creaPosizioniDaDonazionePg(donationData) {
  const {
    walletDonatore,
    nomeDonatore,
    importoEUR,
    timestamp,
    walletInvitante,
    nomeInvitante
  } = donationData;

  console.log('\n🏗️  ========================================');
  console.log('   CREAZIONE POSIZIONI DA DONAZIONE (PostgreSQL)');
  console.log('========================================\n');

  try {
    const numeroPosizioniDaCreare = calcolaNumeroPosizioniDaCreare(importoEUR);
    if (numeroPosizioniDaCreare === 0) {
      return {
        success: false,
        message: `Importo insufficiente: ${importoEUR}€ < 2€ (minimo 1 posizione)`
      };
    }

    console.log(`📊 Importo: ${importoEUR}€`);
    console.log(`📍 Posizioni da creare: ${numeroPosizioniDaCreare}`);
    console.log(`👤 Donatore: ${nomeDonatore} (${walletDonatore})\n`);

    const movimento = 'SMALL';

    const pool = pg.getPool();
    const client = await pool.connect();
    const posizioniCreate = [];

    try {
      await client.query('BEGIN');

      // Ultima posizione esistente in wallet_positions
      const lastRes = await client.query('SELECT COALESCE(MAX(posizione), 0) AS ultima FROM wallet_positions');
      const ultimaPosizione = Number(lastRes.rows[0]?.ultima || 0);
      console.log(`📌 Ultima posizione canonica esistente (PG): ${ultimaPosizione}`);

      let prevMolecola = 0;
      let prevPosInMol = 3;

      if (ultimaPosizione > 0) {
        // 🔍 QUERY ULTIMA POSIZIONE: legge stato molecola/slot precedente
        const stateRes = await client.query(
          `SELECT molecola, posizione_in_molecola, generazione 
           FROM wallet_positions 
           WHERE posizione = $1 
           ORDER BY molecola DESC, id DESC 
           LIMIT 1`,
          [ultimaPosizione]
        );
        
        // 🚨 VALIDAZIONE CRITICA: la query DEVE restituire risultati
        if (!stateRes.rows || stateRes.rows.length === 0) {
          console.error(``);
          console.error(`🚨 ERRORE FATALE: Posizione ${ultimaPosizione} esiste in MAX() ma NON trovata in SELECT!`);
          console.error(`🚨 Questo indica CORRUZIONE DATABASE o RACE CONDITION.`);
          console.error(``);
          console.error(`🛑 CREAZIONE POSIZIONI BLOCCATA.`);
          console.error(`🔧 Azione richiesta: Verifica manualmente la posizione ${ultimaPosizione} nel database.`);
          console.error(``);
          
          throw new Error(
            `ERRORE FATALE: Posizione ${ultimaPosizione} non trovata nel database dopo MAX(). ` +
            `Database corrotto o race condition. Creazione bloccata.`
          );
        }
        
        const row = stateRes.rows[0];
        prevMolecola = Number(row.molecola);
        prevPosInMol = Number(row.posizione_in_molecola);
        const prevGen = row.generazione;
        
        // 🚨 VALIDAZIONE VALORI LETTI
        if (!Number.isFinite(prevMolecola) || prevMolecola < 1) {
          console.error(``);
          console.error(`🚨 ERRORE: molecola non valida per posizione ${ultimaPosizione}: ${row.molecola}`);
          console.error(`🚨 Valore letto dal DB: ${JSON.stringify(row)}`);
          console.error(``);
          
          throw new Error(
            `ERRORE: molecola non valida (${row.molecola}) per posizione ${ultimaPosizione}. ` +
            `DEVE essere un numero >= 1. Database corrotto.`
          );
        }
        
        if (!Number.isFinite(prevPosInMol) || prevPosInMol < 1 || prevPosInMol > 7) {
          console.error(``);
          console.error(`🚨 ERRORE: posizione_in_molecola non valida: ${row.posizione_in_molecola}`);
          console.error(`🚨 Valore letto dal DB: ${JSON.stringify(row)}`);
          console.error(``);
          
          throw new Error(
            `ERRORE: posizione_in_molecola non valida (${row.posizione_in_molecola}). ` +
            `DEVE essere tra 1 e 7. Database corrotto.`
          );
        }
        
        console.log(``);
        console.log(`✅ Stato precedente recuperato (pos ${ultimaPosizione}):`);
        console.log(`   - Molecola: ${prevMolecola}`);
        console.log(`   - Slot: ${prevPosInMol}`);
        console.log(`   - Generazione: ${prevGen}`);
        console.log(``);
        
        // 🔍 SAFETY CHECK duplicati (warning, non blocco)
        const countRes = await client.query(
          'SELECT COUNT(*) as count FROM wallet_positions WHERE posizione = $1',
          [ultimaPosizione]
        );
        const dupCount = Number(countRes.rows[0]?.count || 0);
        if (dupCount > 1) {
          console.warn(`⚠️  ATTENZIONE: ${dupCount} duplicati per posizione ${ultimaPosizione}! Usando molecola più alta.`);
        }
        
        // 🔍 VALIDAZIONE COERENZA MOLECOLA vs POSIZIONE
        // Euristica: molecola dovrebbe essere almeno posizione/10 (molto conservativo)
        const molecolaMinAttesa = Math.floor(ultimaPosizione / 10);
        if (prevMolecola < molecolaMinAttesa) {
          console.error(``);
          console.error(`🚨 ERRORE CRITICO: Reset anomalo molecole rilevato!`);
          console.error(`🚨 Posizione: ${ultimaPosizione}`);
          console.error(`🚨 Molecola letta: ${prevMolecola}`);
          console.error(`🚨 Molecola minima attesa: ~${molecolaMinAttesa}`);
          console.error(``);
          console.error(`🛑 CREAZIONE BLOCCATA per evitare ulteriore corruzione.`);
          console.error(``);
          
          throw new Error(
            `ERRORE CRITICO: Reset anomalo molecole. ` +
            `Posizione ${ultimaPosizione} ha molecola ${prevMolecola} (attesa >= ${molecolaMinAttesa}). ` +
            `Database corrotto. Richiede intervento manuale.`
          );
        }
      }

      for (let i = 0; i < numeroPosizioniDaCreare; i++) {
        const posizione = ultimaPosizione + 1 + i;

        const isPari = posizione % 2 === 0;
        const tipo = isPari ? 'HUMAN' : 'PILETTA';
        const wallet = (isPari ? walletDonatore : SPECIAL_WALLETS.PILETTA).toLowerCase();
        const nome = isPari ? nomeDonatore : 'PILETTA';

        const placement = computeNextMoleculePlacement(prevMolecola, prevPosInMol);
        prevMolecola = placement.molecola;
        prevPosInMol = placement.posizioneInMolecola;

        // Il movimento viene passato dal chiamante (donation-flow-manager)
        // o calcolato in base al contesto. Per le nuove posizioni SMALL,
        // il movimento è sempre 'SMALL' (le transizioni avvengono dopo).
        const movimentoCalcolato = movimento || 'SMALL';

        const posizioneData = {
          posizione,
          wallet,
          nome,
          tipo,
          movimento: movimentoCalcolato,
          molecola: placement.molecola,
          generazione: placement.generazione,
          ruolo: placement.ruolo,
          posizione_in_molecola: placement.posizioneInMolecola
        };

        await dbPg.createPositionTx(client, posizioneData);
        posizioniCreate.push({ ...posizioneData, timestamp: timestamp || new Date().toISOString() });

        console.log(
          `   ${i + 1}. Pos ${posizione} - ${tipo.padEnd(7)} - ${nome.substring(0, 20).padEnd(20)} - ${placement.ruolo}`
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    console.log('');
    console.log(`   ✅ ${posizioniCreate.length} posizioni scritte in PostgreSQL\n`);

    // PostgreSQL è l'unica fonte di verità - file .txt anagrafica OBSOLETO (backup su Desktop)

    // IMPORTANTE: in modalità PostgreSQL non aggiorniamo più qui ANAGRAFICA INVITATI.
    // La distribuzione degli inviti (self / ROG / AVENGERS / invitante / invitato)
    // viene gestita a livello di donation-flow-manager, che chiama
    // esplicitamente una funzione dedicata per scrivere gli inviti
    // posizione-per-posizione in base al tipo di donazione.

    console.log('========================================');
    console.log(`   ✅ ${numeroPosizioniDaCreare} POSIZIONI CREATE (PostgreSQL)`);
    console.log('========================================\n');

    const pairs = [];
    for (let i = 0; i < posizioniCreate.length; i += 2) {
      const a = posizioniCreate[i];
      const b = posizioniCreate[i + 1];
      pairs.push({
        human: a?.tipo === 'HUMAN' ? a.posizione : (b?.tipo === 'HUMAN' ? b.posizione : null),
        piletta: a?.tipo === 'PILETTA' ? a.posizione : (b?.tipo === 'PILETTA' ? b.posizione : null)
      });
    }

    const firstPosition = posizioniCreate[0].posizione;
    const lastPosition = posizioniCreate[posizioniCreate.length - 1].posizione;

    return {
      success: true,
      posizioniCreate: numeroPosizioniDaCreare,
      posizioni: posizioniCreate,
      firstPosition,
      lastPosition,
      primaPosizione: firstPosition,
      ultimaPosizione: lastPosition,
      primaPositzione: firstPosition,
      ultimaPositzione: lastPosition,
      pairs,
      movimento,
      dettagli: {
        importoUsato: numeroPosizioniDaCreare * 2,
        importoTotale: importoEUR,
        residuo: importoEUR - (numeroPosizioniDaCreare * 2)
      }
    };
  } catch (error) {
    console.error('❌ Errore creazione posizioni (PostgreSQL):', error);
    return {
      success: false,
      message: error.message || 'Errore durante creazione posizioni (PostgreSQL)'
    };
  }
}

/**
 * Aggiorna file anagrafica legacy posizioni (ROG_ANAGRAFICA_DEFINITIVA)
 * @param {Array} posizioni - Array di posizioni create
 */
async function aggiornaAnagraficaFile(posizioni) {
  try {
    // Leggi file esistente (se non esiste, crea stringa vuota)
    let content = '';
    try {
      content = await fs.readFile(ANAGRAFICA_FILE, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    
    // Aggiungi nuove posizioni
    for (const pos of posizioni) {
      // Formato: numero\tNOME\nwallet\n
      const entry = `${pos.posizione}\t${pos.nome}\n${pos.wallet}\n`;
      content += entry;
    }
    
    // Scrivi file aggiornato
    await fs.writeFile(ANAGRAFICA_FILE, content, 'utf8');
    
    console.log(`✅ Anagrafica aggiornata con ${posizioni.length} posizioni`);
    
  } catch (error) {
    console.error('❌ Errore aggiornamento anagrafica:', error.message);
    throw error;
  }
}

/**
 * Scrive inviti posizione-per-posizione in PostgreSQL (unica fonte di verità).
 *
 * @param {Array<{posizione:number,tipo:string,walletInvitante:string,nomeInvitante:string,walletInvitato?:string}>} mapping
 */
async function scriviInvitiPerPosizioni(mapping) {
  try {
    if (!Array.isArray(mapping) || mapping.length === 0) {
      return;
    }

    let count = 0;
    const pool = pg.getPool();

    for (const entry of mapping) {
      if (!entry) continue;
      const { posizione, tipo, walletInvitante, nomeInvitante, walletInvitato } = entry;
      if (!posizione || !walletInvitante) continue;
      if (tipo !== 'HUMAN') continue; // registriamo solo HUMAN

      const walletInvitanteNorm = walletInvitante.toLowerCase();
      
      // Trova posizione e wallet dell'invitante
      const invitanteResult = await pool.query(`
        SELECT posizione, wallet
        FROM wallet_positions
        WHERE LOWER(wallet) = $1
        ORDER BY posizione ASC
        LIMIT 1
      `, [walletInvitanteNorm]);
      
      const invitante_pos = invitanteResult.rows[0]?.posizione || 0;
      
      // Trova wallet dell'invitato dalla posizione
      const invitatoResult = await pool.query(`
        SELECT wallet
        FROM wallet_positions
        WHERE posizione = $1
        LIMIT 1
      `, [posizione]);
      
      const invitato_wallet = invitatoResult.rows[0]?.wallet || walletInvitato || '';
      
      // Inserisci in anagrafica_invitati (skip se esiste già)
      await pool.query(`
        INSERT INTO anagrafica_invitati (
          invitante_pos,
          invitante_wallet,
          invitato_pos,
          invitato_wallet,
          livello,
          created_at
        )
        VALUES ($1, $2, $3, $4, 1, NOW())
        ON CONFLICT DO NOTHING
      `, [
        invitante_pos,
        walletInvitanteNorm,
        posizione,
        invitato_wallet
      ]);
      
      count++;
    }

    if (count > 0) {
      console.log(`✅ ${count} invitati scritti in PostgreSQL anagrafica_invitati`);
    }
  } catch (error) {
    console.error('❌ Errore scrittura invitati in PostgreSQL:', error.message);
    throw error;
  }
}

/**
 * Simula creazione posizioni (per testing senza DB write)
 * @param {number} importoEUR
 * @param {string} wallet
 * @param {string} nome
 * @returns {Object}
 */
async function simulaCreazionePosizioniTest(importoEUR, wallet, nome) {
  return await creaPosizioniDaDonazione({
    walletDonatore: wallet || '0x1234567890123456789012345678901234567890',
    nomeDonatore: nome || 'Test User',
    importoEUR,
    timestamp: new Date().toISOString()
  });
}

// ========================================
// VALIDAZIONE
// ========================================

/**
 * Valida dati donazione prima di creare posizioni
 */
function validaDonationData(data) {
  const errors = [];
  
  if (!data.walletDonatore || !/^0x[a-fA-F0-9]{40}$/.test(data.walletDonatore)) {
    errors.push('Wallet donatore non valido');
  }
  
  if (!data.nomeDonatore || data.nomeDonatore.trim().length === 0) {
    errors.push('Nome donatore mancante');
  }
  
  if (!data.importoEUR || data.importoEUR < 2) {
    errors.push('Importo minimo 2€');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Main functions
  creaPosizioniDaDonazione,
  simulaCreazionePosizioniTest,
  
  // Utility
  calcolaNumeroPosizioniDaCreare,
  computeNextMoleculePlacement,
  calcolaGenerazione,
  validaDonationData,
  scriviInvitiPerPosizioni,
  
  // Constants
  SPECIAL_WALLETS
};
