const pgConn = require('./pg-connection-manager');

/**
 * Calcola H ricevente/donatori e range molecole per un dato numero di molecola.
 * Mantiene la stessa logica storica (serie 2^(H-1)).
 */
function computeHStatsFromMolecola(molecola) {
  if (!molecola || molecola <= 0) {
    return {
      riceventeH: null,
      donatoriH: null,
      molecoleMancanti: null,
      hStart: null,
      hEnd: null
    };
  }

  let riceventeH = 2;
  let totalMolecules = 0;

  // H2=2 molecole, H3=4, H4=8, H5=16, ...
  while (totalMolecules + Math.pow(2, riceventeH - 1) < molecola) {
    totalMolecules += Math.pow(2, riceventeH - 1);
    riceventeH++;
  }

  // Regola strutturale ROG: se un RICEVENTE è di generazione Hn,
  // i suoi DONANTI appartengono alla generazione H(n+2).
  const donatoriH = riceventeH + 2;
  const hStart = Math.pow(2, riceventeH - 1);
  const hEnd = Math.pow(2, riceventeH) - 1;
  const molecoleMancanti = Math.max(0, hEnd - molecola);

  return {
    riceventeH,
    donatoriH,
    molecoleMancanti,
    hStart,
    hEnd
  };
}

/**
 * Legge estremi posizioni per un movimento specifico da wallet_positions.
 * Restituisce min pos, max pos ricevente, max pos donanti.
 */
async function getMovementExtremesFromDb(movimento) {
  const MOV = String(movimento || '').toUpperCase();

  const row = await pgConn.queryOne(
    `SELECT 
       MIN(posizione) AS min_pos,
       MAX(CASE WHEN ruolo = 'RICEVENTE' THEN posizione END) AS max_ricevente_pos,
       MAX(CASE WHEN ruolo IN ('DONANTE_1','DONANTE_2','DONANTE_3','DONANTE_4') THEN posizione END) AS max_donante_pos
     FROM wallet_positions
     WHERE movimento = $1`,
    [MOV]
  );

  if (!row || row.min_pos === null) {
    return null;
  }

  return {
    minPos: row.min_pos !== null ? Number(row.min_pos) : null,
    maxPosRicevente: row.max_ricevente_pos !== null ? Number(row.max_ricevente_pos) : null,
    maxPosDonanti: row.max_donante_pos !== null ? Number(row.max_donante_pos) : null
  };
}

/**
 * Legge molecola massima globale da wallet_positions.
 * È la fonte di verità per "ultima molecola" nel sistema SMALL.
 */
async function getGlobalMolecolaInfo() {
  const row = await pgConn.queryOne(
    `SELECT 
       MIN(posizione) AS min_pos,
       MAX(posizione) AS max_pos,
       MAX(molecola) AS max_molecola
     FROM wallet_positions`,
    []
  );

  if (!row || row.max_molecola === null) {
    return null;
  }

  return {
    molecola: Number(row.max_molecola),
    minPosGlobale: row.min_pos !== null ? Number(row.min_pos) : null,
    maxPosGlobale: row.max_pos !== null ? Number(row.max_pos) : null
  };
}

/**
 * Restituisce la "molecola di riferimento" per un movimento:
 * - SMALL: usa la molecola globale (wallet_positions)
 * - MEDIUM/LARGE: usa l'ultima molecola CHIUSA in molecola_cycle_completed
 *   per quel movimento; se non esiste, fa fallback alla molecola globale.
 */
async function getMovementMolecola(movimento) {
  const MOV = String(movimento || '').toUpperCase();

  // SMALL → usa semplicemente la molecola globale
  if (MOV === 'SMALL') {
    const global = await getGlobalMolecolaInfo();
    return global ? global.molecola : null;
  }

  // MEDIUM / LARGE → proviamo prima da molecola_cycle_completed
  let row = null;
  try {
    row = await pgConn.queryOne(
      `SELECT MAX(molecola) AS max_molecola
         FROM molecola_cycle_completed
        WHERE movimento = $1`,
      [MOV]
    );
  } catch (error) {
    // Se la tabella non esiste ancora o c'è un errore di schema,
    // non blocchiamo le stats: faremo fallback alla molecola globale.
    const msg = (error && error.message) || '';
    if (msg.includes('relation "molecola_cycle_completed" does not exist')) {
      console.warn('⚠️  Tabella molecola_cycle_completed assente, uso molecola globale per', MOV);
    } else {
      console.warn('⚠️  Errore lettura molecola_cycle_completed per', MOV + ':', msg);
    }
    row = null;
  }

  if (row && row.max_molecola !== null) {
    return Number(row.max_molecola);
  }

  // Fallback specifico temporaneo per LARGE: ultima molecola chiusa nota = 896
  if (MOV === 'LARGE') {
    return 896;
  }

  // Fallback conservativo: usa molecola globale
  const global = await getGlobalMolecolaInfo();
  return global ? global.molecola : null;
}

/**
 * Statistiche per un singolo movimento.
 * Nota: la molecola corrente è specifica per movimento (SMALL usa quella globale,
 * mentre MEDIUM/LARGE usano l'ultima molecola CHIUSA per il proprio movimento).
 */
async function getMovementStats(movement) {
  await pgConn.initDatabase();

  const MOV = String(movement || '').toUpperCase();

  // 1) Molecola di riferimento per questo movimento
  const molecolaRef = await getMovementMolecola(MOV);
  if (!molecolaRef) {
    return null;
  }

  // 2) Estremi posizioni per il movimento richiesto
  const extremes = await getMovementExtremesFromDb(MOV);
  if (!extremes) {
    // Nessuna posizione ancora per questo movimento
    return null;
  }

  // 3) Calcolo H basato sulla molecola di riferimento del movimento
  const baseH = computeHStatsFromMolecola(molecolaRef);

  const riceventeH = baseH.riceventeH;
  const donatoriH = baseH.donatoriH;
  const hStart = baseH.hStart;
  const hEnd = baseH.hEnd;
  const molecoleMancanti = baseH.molecoleMancanti;

  return {
    // Molecola ricevente per questo movimento
    molecola: molecolaRef,

    // H di riferimento per questo movimento (rispetta la regola H(n+2) all'interno di computeHStats)
    riceventeH,
    donatoriH,

    // Quante molecole mancano per completare l'intera generazione corrente
    riceventiDaCompletareH: molecoleMancanti,

    // Placeholder conservativo: le "ricevute da distribuire" vengono gestite
    // dal generazione-manager; qui esponiamo 0 per compatibilità strutturale
    ricevuteDaDistribuireH: 0,

    // Estremi posizioni per questo movimento
    minPos: extremes.minPos,
    maxPosRicevente: extremes.maxPosRicevente,
    maxPosDonanti: extremes.maxPosDonanti,

    // Dettagli generazione/molecola
    molecoleMancanti,
    hStart,
    hEnd
  };
}

/**
 * Calcola il numero totale di posizioni HUMAN per una generazione H.
 * Ogni molecola ha ~3 posizioni HUMAN (su 7 totali).
 * H1=1 molecola, H2=2, H3=4, H4=8, H5=16, H6=32, H7=64...
 */
function getExpectedHumanPositionsForGeneration(hNum) {
  if (hNum < 1) return 0;
  // Numero molecole per generazione Hn = 2^(n-1)
  const numMolecole = Math.pow(2, hNum - 1);
  // Ogni molecola ha ~3 posizioni HUMAN (posizioni pari)
  // Ma per semplicità contiamo le molecole * 3 circa
  // In realtà dipende dalla struttura, usiamo un calcolo più preciso:
  // Posizioni per generazione = molecole * 7 slot, ma solo ~3-4 sono HUMAN
  return numMolecole * 3; // Approssimazione: 3 HUMAN per molecola
}

/**
 * Report transizioni tra movimenti.
 * Mostra per ogni generazione quante posizioni sono passate a MEDIUM e LARGE.
 */
async function getTransitionsReport() {
  await pgConn.initDatabase();

  try {
    // Query: conta posizioni per generazione e movimento
    // Usiamo la generazione dalla colonna 'generazione' in wallet_positions
    const rows = await pgConn.queryMany(`
      SELECT 
        generazione,
        movimento,
        COUNT(*) AS total_positions,
        COUNT(CASE WHEN tipo = 'HUMAN' THEN 1 END) AS human_positions
      FROM wallet_positions
      WHERE generazione IS NOT NULL
      GROUP BY generazione, movimento
      ORDER BY generazione ASC, movimento ASC
    `);

    // Organizza i dati per generazione
    const byGeneration = {};
    
    for (const row of rows) {
      const gen = row.generazione; // es. 'H2', 'H3', etc.
      if (!gen) continue;
      
      if (!byGeneration[gen]) {
        byGeneration[gen] = {
          generazione: gen,
          small: { total: 0, human: 0 },
          medium: { total: 0, human: 0 },
          large: { total: 0, human: 0 }
        };
      }
      
      const mov = (row.movimento || 'SMALL').toUpperCase();
      if (mov === 'SMALL') {
        byGeneration[gen].small.total = Number(row.total_positions) || 0;
        byGeneration[gen].small.human = Number(row.human_positions) || 0;
      } else if (mov === 'MEDIUM') {
        byGeneration[gen].medium.total = Number(row.total_positions) || 0;
        byGeneration[gen].medium.human = Number(row.human_positions) || 0;
      } else if (mov === 'LARGE') {
        byGeneration[gen].large.total = Number(row.total_positions) || 0;
        byGeneration[gen].large.human = Number(row.human_positions) || 0;
      }
    }

    // Calcola stato transizione per ogni generazione
    const transitions = [];
    
    // Ordina le generazioni numericamente (H1, H2, H3...)
    const sortedGens = Object.keys(byGeneration).sort((a, b) => {
      const numA = parseInt(a.replace('H', '')) || 0;
      const numB = parseInt(b.replace('H', '')) || 0;
      return numA - numB;
    });

    for (const gen of sortedGens) {
      const data = byGeneration[gen];
      const hNum = parseInt(gen.replace('H', '')) || 0;
      
      // Calcola posizioni attese (approssimazione basata su struttura molecole)
      const expectedHuman = getExpectedHumanPositionsForGeneration(hNum);
      
      // Totale posizioni HUMAN per questa generazione (somma di tutti i movimenti)
      const totalHuman = data.small.human + data.medium.human + data.large.human;
      
      // Stato transizione SMALL → MEDIUM
      let smallToMediumStatus = 'IN_SMALL';
      let smallToMediumProgress = 0;
      
      if (data.medium.human > 0 || data.large.human > 0) {
        const passedToMediumOrLarge = data.medium.human + data.large.human;
        if (data.small.human === 0) {
          smallToMediumStatus = 'COMPLETED';
          smallToMediumProgress = 100;
        } else {
          smallToMediumStatus = 'IN_PROGRESS';
          smallToMediumProgress = totalHuman > 0 
            ? Math.round((passedToMediumOrLarge / totalHuman) * 100) 
            : 0;
        }
      }

      // Stato transizione MEDIUM → LARGE
      let mediumToLargeStatus = 'NOT_STARTED';
      let mediumToLargeProgress = 0;
      
      if (data.large.human > 0) {
        const inMediumOrLarge = data.medium.human + data.large.human;
        if (data.medium.human === 0 && inMediumOrLarge > 0) {
          mediumToLargeStatus = 'COMPLETED';
          mediumToLargeProgress = 100;
        } else if (inMediumOrLarge > 0) {
          mediumToLargeStatus = 'IN_PROGRESS';
          mediumToLargeProgress = inMediumOrLarge > 0 
            ? Math.round((data.large.human / inMediumOrLarge) * 100) 
            : 0;
        }
      } else if (data.medium.human > 0) {
        mediumToLargeStatus = 'IN_MEDIUM';
      }

      transitions.push({
        generazione: gen,
        hNum,
        expectedHuman,
        totalHuman,
        inSmall: data.small.human,
        inMedium: data.medium.human,
        inLarge: data.large.human,
        smallToMedium: {
          status: smallToMediumStatus,
          progress: smallToMediumProgress,
          passed: data.medium.human + data.large.human,
          remaining: data.small.human
        },
        mediumToLarge: {
          status: mediumToLargeStatus,
          progress: mediumToLargeProgress,
          passed: data.large.human,
          remaining: data.medium.human
        }
      });
    }

    // Riepilogo globale
    const summary = {
      totalInSmall: transitions.reduce((sum, t) => sum + t.inSmall, 0),
      totalInMedium: transitions.reduce((sum, t) => sum + t.inMedium, 0),
      totalInLarge: transitions.reduce((sum, t) => sum + t.inLarge, 0),
      generationsInMedium: transitions.filter(t => t.inMedium > 0).map(t => t.generazione),
      generationsInLarge: transitions.filter(t => t.inLarge > 0).map(t => t.generazione),
      generationsCompletelyInMedium: transitions
        .filter(t => t.smallToMedium.status === 'COMPLETED' && t.inMedium > 0)
        .map(t => t.generazione),
      generationsCompletelyInLarge: transitions
        .filter(t => t.mediumToLarge.status === 'COMPLETED')
        .map(t => t.generazione)
    };

    return {
      success: true,
      transitions,
      summary
    };

  } catch (error) {
    console.error('Errore getTransitionsReport:', error);
    return {
      success: false,
      error: error.message,
      transitions: [],
      summary: null
    };
  }
}

/**
 * Statistiche complessive per SMALL / MEDIUM / LARGE.
 * Per ora SMALL è il movimento principale attivo; MEDIUM/LARGE
 * verranno popolati quando avremo posizioni per quei movimenti.
 */
async function getAllMovementStats() {
  try {
    const small = await getMovementStats('SMALL');
    const medium = await getMovementStats('MEDIUM');
    const large = await getMovementStats('LARGE');
    const transitions = await getTransitionsReport();

    return {
      success: true,
      small,
      medium,
      large,
      transitions: transitions.success ? transitions : null
    };
  } catch (error) {
    console.error('Errore getAllMovementStats:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getMovementStats,
  getAllMovementStats,
  getTransitionsReport
};
