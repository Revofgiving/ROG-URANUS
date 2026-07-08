/**
 * 🧬 MOLECOLE MANAGER - Sistema di formazione e gestione molecole ROG
 * 
 * LOGICA MOLECOLE:
 * - Sistema a generazioni: H1=1mol, H2=2mol, H3=4mol, H4=8mol... (2^(N-1))
 * - Tre sequenze separate: RICEVENTI, PONTI, DONANTI
 * - LARGE: Posizioni storiche + transizioni da MEDIUM (movimento dinamico dal DB)
 * - MEDIUM: Posizioni intermedie (movimento dinamico dal DB)  
 * - SMALL: Posizioni correnti con pattern HUMAN+PILETTA (pari/dispari)
 * 
 * Struttura molecola:
 * - 1 RICEVENTE
 * - 2 PONTI (SX HUMAN + DX PILETTA)
 * - 4 DONANTI (pattern HUMAN/PILETTA alternato)
 * 
 * @author ROG System
 * @version 2.0.0
 */

// anagrafica-manager legacy potrebbe non essere presente. In tal caso usiamo PostgreSQL come sorgente.
let anagraficaManager;
try {
  anagraficaManager = require('./anagrafica-manager');
} catch (err) {
  const pg = require('./pg-connection-manager');

  anagraficaManager = {
    async getPositionsByRange(start, end) {
      const pool = pg.getPool();
      const result = await pool.query(`
        SELECT
          wp.posizione,
          wp.wallet,
          wp.movimento,
          wm.nome,
          wm.tipo,
          wp.created_at
        FROM wallet_positions wp
        LEFT JOIN wallet_master wm ON wm.wallet = wp.wallet
        WHERE wp.posizione BETWEEN $1 AND $2
        ORDER BY wp.posizione ASC
      `, [start, end]);
      return result.rows;
    },

    async getUserPositions(wallet) {
      const pool = pg.getPool();
      const result = await pool.query(`
        SELECT
          wp.posizione,
          wp.wallet,
          wp.movimento,
          wm.nome,
          wm.tipo,
          wp.created_at
        FROM wallet_positions wp
        LEFT JOIN wallet_master wm ON wm.wallet = wp.wallet
        WHERE wp.wallet = $1
        ORDER BY wp.posizione ASC
      `, [String(wallet || '').toLowerCase()]);
      return result.rows;
    },

    async getLastPosition() {
      const pool = pg.getPool();
      const result = await pool.query('SELECT MAX(posizione) as last FROM wallet_positions');
      return Number(result.rows[0]?.last || 0);
    },

    async getStats() {
      const pool = pg.getPool();
      const result = await pool.query('SELECT COUNT(DISTINCT posizione) as totale FROM wallet_positions');
      return { totale: Number(result.rows[0]?.totale || 0) };
    }
  };
}

class MolecoleManager {
  constructor() {
    this.molecoleCache = new Map();
    // Stato progressione sequenze (calcolato dinamicamente)
    this.ultimoRicevente = 0;
    this.ultimoPonte = 0;
    this.ultimoDonante = 0;
  }

  /**
   * 🔢 REGOLA FONDAMENTALE DI PROGRESSIONE MOLECOLARE ("ALLA 874")
   *
   * Questa funzione è LA SOLA sorgente di verità per calcolare la
   * prossima molecola a partire dall'ultima ESISTENTE, indipendentemente
   * dal movimento (SMALL / MEDIUM / LARGE).
   *
   * Input: posizioni REALI lette dal database dell'ULTIMA molecola creata.
   *   - prevRiceventePos  → campo "ricevente_pos" dell'ultima molecola
   *   - prevPonteDxPos    → campo "ponte_dx_pos" dell'ultima molecola
   *   - prevDonante4Pos   → campo "donante4_pos" dell'ultima molecola
   *
   * Output: oggetto con le 7 nuove posizioni per la NUOVA molecola:
   *   - ricevente_pos
   *   - ponte_sx_pos
   *   - ponte_dx_pos
   *   - donante1_pos .. donante4_pos
   *
   * Regola (lineare, senza nessuna logica per generazione):
   *   ricevente_new   = prevRiceventePos + 1
   *   ponte_sx_new    = prevPonteDxPos + 1
   *   ponte_dx_new    = ponte_sx_new + 1
   *   donante1_new    = prevDonante4Pos + 1
   *   donante2_new    = donante1_new + 1
   *   donante3_new    = donante2_new + 1
   *   donante4_new    = donante3_new + 1
   */
  computeNextMoleculeFromPrevPositions(prevRiceventePos, prevPonteDxPos, prevDonante4Pos) {
    if (
      typeof prevRiceventePos !== 'number' ||
      typeof prevPonteDxPos !== 'number' ||
      typeof prevDonante4Pos !== 'number'
    ) {
      throw new Error('computeNextMoleculeFromPrevPositions richiede tre numeri (prevRiceventePos, prevPonteDxPos, prevDonante4Pos)');
    }

    const ricevente_pos = prevRiceventePos + 1;

    const ponte_sx_pos = prevPonteDxPos + 1;
    const ponte_dx_pos = ponte_sx_pos + 1;

    const donante1_pos = prevDonante4Pos + 1;
    const donante2_pos = donante1_pos + 1;
    const donante3_pos = donante2_pos + 1;
    const donante4_pos = donante3_pos + 1;

    return {
      ricevente_pos,
      ponte_sx_pos,
      ponte_dx_pos,
      donante1_pos,
      donante2_pos,
      donante3_pos,
      donante4_pos
    };
  }

  /**
   * Calcola quale generazione appartiene una molecola
   * @param {number} numeroMolecola - Numero molecola
   * @returns {number} Generazione HN
   */
  getGenerazioneDaMolecola(numeroMolecola) {
    return Math.floor(Math.log2(numeroMolecola)) + 1;
  }

  /**
   * Calcola range molecole per generazione
   * @param {number} N - Numero generazione
   * @returns {Object} {inizio, fine, totale}
   */
  getRangeMolecole(N) {
    const molecolePrecedenti = Math.pow(2, N - 1) - 1;
    const molecoleGenerazione = Math.pow(2, N - 1);
    
    return {
      inizio: molecolePrecedenti + 1,
      fine: molecolePrecedenti + molecoleGenerazione,
      totale: molecoleGenerazione
    };
  }

  /**
   * Calcola posizioni RICEVENTE/PONTI/DONANTI per molecola
   * Segue le regole specificate con 3 sequenze progressive separate:
   * - RICEVENTI: progressione +1 dall'ultimo ricevente
   * - PONTI: progressione +1 (SX dall'ultimo DX precedente, DX da SX appena creato)
   * - DONANTI: progressione +1 (Donante1 dall'ultimo Donante4 precedente, poi sequenziali)
   * 
   * @param {number} numeroMolecola - Numero molecola
   * @returns {Object} {ricevente, ponti: [sx, dx], donanti: [1,2,3,4]}
   */
  async calcolaPosizioniMolecola(numeroMolecola) {
    // MOLECOLA 1: Posizioni iniziali fisse
    if (numeroMolecola === 1) {
      return {
        ricevente: 1,
        ponti: [2, 3],        // SX=2 (HUMAN), DX=3 (PILETTA)
        donanti: [4, 5, 6, 7] // 1=4 (HUMAN-PARI), 2=5 (PILETTA-DISPARI), 3=6 (HUMAN-PARI), 4=7 (PILETTA-DISPARI)
      };
    }
    
    // Per molecole successive, calcola ricorsivamente dall'ultima molecola precedente
    const molecolaPrecedente = await this.calcolaPosizioniMolecola(numeroMolecola - 1);
    
    // REGOLE PROGRESSIONE SEQUENZIALE:
    
    // 1. RICEVENTE: +1 dall'ultimo ricevente della molecola precedente
    const nuovoRicevente = molecolaPrecedente.ricevente + 1;
    
    // 2. PONTE SX (HUMAN): +1 dall'ultimo ponte DX della molecola precedente
    const nuovoPonteSX = molecolaPrecedente.ponti[1] + 1;
    
    // 3. PONTE DX (PILETTA): +1 dal ponte SX appena creato
    const nuovoPonteDX = nuovoPonteSX + 1;
    
    // 4. DONANTE 1 (HUMAN - PARI): +1 dall'ultimo donante 4 della molecola precedente
    const nuovoDonante1 = molecolaPrecedente.donanti[3] + 1;
    
    // 5. DONANTE 2 (PILETTA - DISPARI): +1 dal donante 1 appena creato
    const nuovoDonante2 = nuovoDonante1 + 1;
    
    // 6. DONANTE 3 (HUMAN - PARI): +1 dal donante 2 appena creato
    const nuovoDonante3 = nuovoDonante2 + 1;
    
    // 7. DONANTE 4 (PILETTA - DISPARI): +1 dal donante 3 appena creato
    const nuovoDonante4 = nuovoDonante3 + 1;
    
    return {
      ricevente: nuovoRicevente,
      ponti: [nuovoPonteSX, nuovoPonteDX],
      donanti: [nuovoDonante1, nuovoDonante2, nuovoDonante3, nuovoDonante4]
    };
  }

  /**
   * Ottiene molecola per numero specifico
   * @param {number} numeroMolecola - Numero della molecola
   * @returns {Promise<Object>} Dati molecola
   */
  async getMolecolaByNumero(numeroMolecola) {
    try {
      // Verifica cache
      if (this.molecoleCache.has(numeroMolecola)) {
        return this.molecoleCache.get(numeroMolecola);
      }

      // Calcola posizioni secondo algoritmo 3 sequenze
      const posizioni = await this.calcolaPosizioniMolecola(numeroMolecola);
      
      // Recupera dati dall'anagrafica
      const [ricevente] = await anagraficaManager.getPositionsByRange(
        posizioni.ricevente, posizioni.ricevente
      );
      
      const ponti = await anagraficaManager.getPositionsByRange(
        posizioni.ponti[0], posizioni.ponti[1]
      );
      
      const donanti = await anagraficaManager.getPositionsByRange(
        posizioni.donanti[0], posizioni.donanti[3]
      );

      if (!ricevente) {
        return null;
      }

      // Costruisce molecola
      const molecola = {
        id: numeroMolecola,
        generazione: this.getGenerazioneDaMolecola(numeroMolecola),
        livello: ricevente.movimento || 'SMALL',
        stato: donanti.length === 4 ? 'COMPLETA' : 'IN_CORSO',
        ricevente: {
          wallet: ricevente.wallet,
          nome: ricevente.nome,
          posizione: ricevente.posizione,
          tipo: ricevente.tipo
        },
        ponti: [
          ponti[0] ? {
            wallet: ponti[0].wallet,
            nome: ponti[0].nome,
            posizione: ponti[0].posizione,
            tipo: ponti[0].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.ponti[0], tipo: 'HUMAN' },
          ponti[1] ? {
            wallet: ponti[1].wallet,
            nome: ponti[1].nome,
            posizione: ponti[1].posizione,
            tipo: ponti[1].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.ponti[1], tipo: 'PILETTA' }
        ],
        donanti: [
          donanti[0] ? {
            wallet: donanti[0].wallet,
            nome: donanti[0].nome,
            posizione: donanti[0].posizione,
            tipo: donanti[0].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.donanti[0], tipo: 'HUMAN' },
          donanti[1] ? {
            wallet: donanti[1].wallet,
            nome: donanti[1].nome,
            posizione: donanti[1].posizione,
            tipo: donanti[1].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.donanti[1], tipo: 'PILETTA' },
          donanti[2] ? {
            wallet: donanti[2].wallet,
            nome: donanti[2].nome,
            posizione: donanti[2].posizione,
            tipo: donanti[2].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.donanti[2], tipo: 'HUMAN' },
          donanti[3] ? {
            wallet: donanti[3].wallet,
            nome: donanti[3].nome,
            posizione: donanti[3].posizione,
            tipo: donanti[3].tipo
          } : { wallet: null, nome: 'In attesa...', posizione: posizioni.donanti[3], tipo: 'PILETTA' }
        ],
        dataCreazione: ricevente.created_at || new Date().toISOString().split('T')[0]
      };

      // Salva in cache
      this.molecoleCache.set(numeroMolecola, molecola);

      return molecola;

    } catch (error) {
      console.error(`Errore recupero molecola ${numeroMolecola}:`, error);
      throw error;
    }
  }

  /**
   * Ottiene tutte le molecole di un wallet
   * @param {string} wallet - Indirizzo wallet
   * @returns {Promise<Array>} Array di molecole
   */
  async getMolecoleByWallet(wallet) {
    try {
      // Ottiene tutte le posizioni del wallet
      const posizioni = await anagraficaManager.getUserPositions(wallet);

      if (!posizioni || posizioni.length === 0) {
        return [];
      }

      // Trova le molecole dove questo wallet appare come ricevente
      // NOTA: Per ora cerchiamo tutte le molecole fino a un limite ragionevole
      // e filtriamo quelle dove il wallet è presente
      
      const molecoleSet = new Set();
      const lastPos = await anagraficaManager.getLastPosition();
      
      // Stima numero massimo molecole (circa 1 ogni 7 posizioni)
      const maxMolecole = Math.min(5000, Math.ceil(lastPos / 7));
      
      // Cerca molecole dove wallet è ricevente (più efficiente)
      for (let m = 1; m <= maxMolecole; m++) {
        try {
          const posizioniMol = await this.calcolaPosizioniMolecola(m);
          
          // Verifica se il wallet è in una delle posizioni di questa molecola
          const walletInMolecola = posizioni.some(pos => 
            pos.posizione === posizioniMol.ricevente ||
            posizioniMol.ponti.includes(pos.posizione) ||
            posizioniMol.donanti.includes(pos.posizione)
          );
          
          if (walletInMolecola) {
            molecoleSet.add(m);
          }
          
          // Se abbiamo superato l'ultima posizione del wallet, possiamo fermarci
          const maxPosWallet = Math.max(...posizioni.map(p => p.posizione));
          if (posizioniMol.donanti[3] > maxPosWallet + 1000) {
            break;
          }
        } catch (e) {
          // Molecola non esiste ancora, stop
          break;
        }
      }

      // Recupera i dettagli di ogni molecola
      const molecole = [];
      for (const numeroMolecola of Array.from(molecoleSet).sort((a, b) => a - b)) {
        const molecola = await this.getMolecolaByNumero(numeroMolecola);
        if (molecola) {
          molecole.push(molecola);
        }
      }

      return molecole;

    } catch (error) {
      console.error(`Errore recupero molecole wallet ${wallet}:`, error);
      throw error;
    }
  }

  /**
   * Determina lo stato di una molecola in base ai donanti
   * @param {Array} donanti - Array donanti
   * @returns {string} COMPLETA o IN_CORSO
   */
  determinaStatoMolecola(donanti) {
    const donantiPresenti = donanti.filter(d => d !== null && d.wallet).length;
    return donantiPresenti === 4 ? 'COMPLETA' : 'IN_CORSO';
  }

  /**
   * Valida una molecola secondo le regole ROG
   * @param {Object} molecola - Dati molecola
   * @returns {Object} Risultato validazione
   */
  validaMolecola(molecola) {
    const errori = [];

    // 1 ricevente
    if (!molecola.ricevente) {
      errori.push('Manca il ricevente');
    }

    // 2 ponti
    if (!molecola.ponti || molecola.ponti.length !== 2) {
      errori.push('Devono esserci esattamente 2 ponti');
    } else {
      // Verifica pattern HUMAN + PILETTA
      const tipiPonti = molecola.ponti.map(p => p.tipo);
      if (!tipiPonti.includes('HUMAN') || !tipiPonti.includes('PILETTA')) {
        errori.push('I ponti devono essere 1 HUMAN e 1 PILETTA');
      }
    }

    // 4 donanti
    if (!molecola.donanti || molecola.donanti.length !== 4) {
      errori.push('Devono esserci esattamente 4 donanti');
    }

    return {
      valida: errori.length === 0,
      errori
    };
  }

  /**
   * Ottiene statistiche generali molecole
   * @returns {Promise<Object>} Statistiche
   */
  async getStatisticheMolecole() {
    try {
      const stats = await anagraficaManager.getStats();
      
      // Calcola numero totale molecole (circa)
      const molecoleTotali = Math.ceil(stats.totale / 4);

      return {
        totale: molecoleTotali,
        complete: Math.floor(molecoleTotali * 0.7), // Stima 70% complete
        inCorso: Math.ceil(molecoleTotali * 0.3) // Stima 30% in corso
      };

    } catch (error) {
      console.error('Errore statistiche molecole:', error);
      throw error;
    }
  }
}

module.exports = new MolecoleManager();
