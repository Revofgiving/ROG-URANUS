/**
 * 🌊 ROG GENERAZIONE MANAGER - Sistema Cascata Distribuzioni
 * 
 * Gestisce il sistema di distribuzione a cascata per generazioni:
 * - PUNTO 55: Riceventi diretti ricevono doni man mano che molecole si chiudono
 * - PUNTI 57-62: Riceventi dei riceventi aspettano completamento intera generazione
 * 
 * REGOLE CASCATA:
 * 1. H10 ricevono doni progressivamente (molecola per molecola)
 * 2. Quando TUTTI H10 hanno ricevuto → distribuzione massa a TUTTI H8
 * 3. Quando TUTTI H8 hanno ricevuto → distribuzione massa a TUTTI H6
 * 4. Quando TUTTI H6 hanno ricevuto → distribuzione massa a TUTTI H4
 * 5. Quando TUTTI H4 hanno ricevuto → distribuzione massa a TUTTI H2
 * 6. Quando TUTTI H2 hanno ricevuto → apertura nuova generazione H11
 * 
 * @author Warp AI Agent
 * @version 1.0.0 - Cascata Completa
 * @date 17 Novembre 2025
 */

const statePg = require('./state-persistence-pg');

// ========================================
// CONFIGURAZIONE
// ========================================

const STATE_KEY = 'generazioni_cascata';

/**
 * Formule molecole per generazione
 * HN = 2^(N-1) molecole
 */
const FORMULE = {
  molecoleInGenerazione: (N) => Math.pow(2, N - 1),
  molecoleCumulative: (N) => Math.pow(2, N) - 1,
  getGenerazioneDaMolecola: (molecola) => {
    if (molecola === 0) return 0;
    return Math.floor(Math.log2(molecola)) + 1;
  }
};

/**
 * Mappa generazioni → range molecole
 */
const GENERAZIONI_MAP = {
  1: { nome: 'H1', molecole: 1, inizio: 1, fine: 1 },
  2: { nome: 'H2', molecole: 2, inizio: 2, fine: 3 },
  3: { nome: 'H3', molecole: 4, inizio: 4, fine: 7 },
  4: { nome: 'H4', molecole: 8, inizio: 8, fine: 15 },
  5: { nome: 'H5', molecole: 16, inizio: 16, fine: 31 },
  6: { nome: 'H6', molecole: 32, inizio: 32, fine: 63 },
  7: { nome: 'H7', molecole: 64, inizio: 64, fine: 127 },
  8: { nome: 'H8', molecole: 128, inizio: 128, fine: 255 },
  9: { nome: 'H9', molecole: 256, inizio: 256, fine: 511 },
  10: { nome: 'H10', molecole: 512, inizio: 512, fine: 1023 },
  11: { nome: 'H11', molecole: 1024, inizio: 1024, fine: 2047 },
  12: { nome: 'H12', molecole: 2048, inizio: 2048, fine: 4095 }
};

// ========================================
// GESTIONE STATO
// ========================================

/**
 * Legge stato cascata generazioni da PostgreSQL
 */
async function readCascataState() {
  try {
    const saved = await statePg.getState(STATE_KEY, null);
    if (!saved) {
      console.log('⚠️  Stato generazioni-cascata non esiste, creo iniziale');
      const initialState = await createInitialState();
      await saveCascataState(initialState);
      return initialState;
    }
    return saved;
  } catch (error) {
    console.error('❌ Errore lettura generazioni-cascata:', error.message);
    // Tenta di creare stato iniziale
    const initialState = await createInitialState();
    await saveCascataState(initialState);
    return initialState;
  }
}

/**
 * Salva stato cascata in PostgreSQL
 */
async function saveCascataState(state) {
  try {
    await statePg.setState(STATE_KEY, state);
  } catch (error) {
    console.error('❌ Errore salvataggio generazioni-cascata:', error.message);
  }
}

/**
 * Crea stato iniziale da doni_mancanti.txt
 */
async function createInitialState() {
  console.log('🔄 Creazione stato iniziale da doni_mancanti.txt...');
  
  // Stato iniziale basato su conversazione summary
  // H10: molecola 873 completata, 362/512 molecole (70.70%)
  // H8: 37 pending (posizioni 219-255)
  // H6: 9 pending (posizioni 55-63)
  // H4: 2 pending (posizioni 14-15)
  // H2: complete
  
  const state = {
    generazioneCorrente: 10, // H10 in corso
    molecolaCorrente: 873,
    
    generazioni: {
      10: { // H10
        nome: 'H10',
        totaleMolecole: 512,
        molecoleCompletate: 362,
        molecoleMancanti: 150,
        percentualeCompletamento: 70.70,
        completata: false,
        bloccoCascata: false, // False perché riceventi diretti
        riceventiPendenti: 150,
        primoDonoCompletato: false
      },
      8: { // H8
        nome: 'H8',
        totaleMolecole: 128,
        molecoleCompletate: 91, // 128 - 37
        molecoleMancanti: 37,
        percentualeCompletamento: 71.09,
        completata: false,
        bloccoCascata: true, // True: aspetta H10
        riceventiPendenti: 37,
        secondoDonoCompletato: false
      },
      6: { // H6
        nome: 'H6',
        totaleMolecole: 32,
        molecoleCompletate: 23, // 32 - 9
        molecoleMancanti: 9,
        percentualeCompletamento: 71.88,
        completata: false,
        bloccoCascata: true, // True: aspetta H8
        riceventiPendenti: 9,
        terzoDonoCompletato: false
      },
      4: { // H4
        nome: 'H4',
        totaleMolecole: 8,
        molecoleCompletate: 6, // 8 - 2
        molecoleMancanti: 2,
        percentualeCompletamento: 75.00,
        completata: false,
        bloccoCascata: true, // True: aspetta H6
        riceventiPendenti: 2,
        quartoDonoCompletato: false
      },
      2: { // H2
        nome: 'H2',
        totaleMolecole: 2,
        molecoleCompletate: 2,
        molecoleMancanti: 0,
        percentualeCompletamento: 100.00,
        completata: true,
        bloccoCascata: false,
        riceventiPendenti: 0,
        quintoDonoCompletato: true
      }
    },
    
    cascataBloccata: true,
    prossimaGenerazioneBloccata: 8, // H8 aspetta H10
    
    log: [{
      timestamp: new Date().toISOString(),
      azione: 'INIT_STATE',
      messaggio: 'Stato iniziale creato da doni_mancanti.txt',
      stato: {
        H10: '362/512 (70.70%) - 150 molecole mancanti',
        H8: '91/128 (71.09%) - 37 doni pendenti - BLOCCATA',
        H6: '23/32 (71.88%) - 9 doni pendenti - BLOCCATA',
        H4: '6/8 (75.00%) - 2 doni pendenti - BLOCCATA',
        H2: '2/2 (100%) - COMPLETA'
      }
    }],
    
    ultimoAggiornamento: new Date().toISOString()
  };
  
  console.log('✅ Stato iniziale creato:');
  console.log(`   H10: ${state.generazioni[10].molecoleCompletate}/${state.generazioni[10].totaleMolecole} (${state.generazioni[10].percentualeCompletamento}%)`);
  console.log(`   H8: ${state.generazioni[8].riceventiPendenti} pendenti - BLOCCATA`);
  console.log(`   H6: ${state.generazioni[6].riceventiPendenti} pendenti - BLOCCATA`);
  console.log(`   H4: ${state.generazioni[4].riceventiPendenti} pendenti - BLOCCATA`);
  console.log(`   H2: COMPLETA`);
  
  return state;
}

// ========================================
// FUNZIONI PRINCIPALI
// ========================================

/**
 * Registra completamento molecola (ricevente diretto riceve dono)
 * PUNTO 55: Distribuzione progressiva
 * 
 * @param {number} numeroMolecola - Numero molecola completata
 * @param {number} generazione - Generazione (es: 10 per H10)
 * @param {string} ricevente - Wallet ricevente
 * @param {number} importo - Importo dono
 * @returns {Promise<Object>} Risultato con eventuale trigger cascata
 */
async function registraMolecolaCompletata(numeroMolecola, generazione, ricevente, importo) {
  const state = await readCascataState();
  
  if (!state.generazioni[generazione]) {
    return {
      success: false,
      error: `Generazione H${generazione} non trovata nello stato`
    };
  }
  
  const gen = state.generazioni[generazione];
  
  console.log(`\n💎 MOLECOLA COMPLETATA`);
  console.log(`   Molecola: #${numeroMolecola}`);
  console.log(`   Generazione: H${generazione}`);
  console.log(`   Ricevente: ${ricevente}`);
  console.log(`   Importo: ${importo}€`);
  
  // Aggiorna contatori
  gen.molecoleCompletate++;
  gen.molecoleMancanti = gen.totaleMolecole - gen.molecoleCompletate;
  gen.percentualeCompletamento = ((gen.molecoleCompletate / gen.totaleMolecole) * 100).toFixed(2);
  gen.riceventiPendenti = gen.molecoleMancanti;
  
  console.log(`   Progresso: ${gen.molecoleCompletate}/${gen.totaleMolecole} (${gen.percentualeCompletamento}%)`);
  
  // Aggiorna molecola corrente sistema
  state.molecolaCorrente = Math.max(state.molecolaCorrente, numeroMolecola);
  
  // Log
  state.log.push({
    timestamp: new Date().toISOString(),
    azione: 'MOLECOLA_COMPLETATA',
    molecola: numeroMolecola,
    generazione: `H${generazione}`,
    ricevente,
    importo,
    progresso: `${gen.molecoleCompletate}/${gen.totaleMolecole}`
  });
  
  // Verifica se generazione completata
  let triggerCascata = false;
  if (gen.molecoleCompletate >= gen.totaleMolecole) {
    console.log(`\n🎉 GENERAZIONE H${generazione} COMPLETATA!`);
    gen.completata = true;
    gen.primoDonoCompletato = true;
    
    // Trigger cascata a generazione inferiore
    triggerCascata = await verificaETriggaCascata(state, generazione);
    
    state.log.push({
      timestamp: new Date().toISOString(),
      azione: 'GENERAZIONE_COMPLETATA',
      generazione: `H${generazione}`,
      triggerCascata: triggerCascata.triggered
    });
  }
  
  state.ultimoAggiornamento = new Date().toISOString();
  await saveCascataState(state);
  
  return {
    success: true,
    generazione: `H${generazione}`,
    progresso: {
      completate: gen.molecoleCompletate,
      totali: gen.totaleMolecole,
      percentuale: gen.percentualeCompletamento,
      mancanti: gen.molecoleMancanti
    },
    generazioneCompletata: gen.completata,
    triggerCascata: triggerCascata || { triggered: false }
  };
}

/**
 * Verifica se deve scattare cascata e la trigga
 * PUNTI 57-62: Distribuzione a cascata quando generazione completa
 * 
 * @param {Object} state - Stato corrente
 * @param {number} generazioneCompletata - Generazione appena completata
 * @returns {Promise<Object>} Info trigger cascata
 */
async function verificaETriggaCascata(state, generazioneCompletata) {
  console.log(`\n🌊 VERIFICA CASCATA per H${generazioneCompletata}...`);
  
  // Mappa: quando H10 completa → distribuzione a H8
  const cascataMap = {
    10: 8,  // H10 completa → H8 riceve
    8: 6,   // H8 completa → H6 riceve
    6: 4,   // H6 completa → H4 riceve
    4: 2,   // H4 completa → H2 riceve
    2: 0    // H2 completa → apertura H11
  };
  
  const generazioneSuccessiva = cascataMap[generazioneCompletata];
  
  if (generazioneSuccessiva === undefined) {
    console.log(`   ℹ️  Nessuna cascata definita per H${generazioneCompletata}`);
    return { triggered: false };
  }
  
  if (generazioneSuccessiva === 0) {
    console.log(`   🎯 H2 completata → Pronta apertura H11`);
    state.cascataBloccata = false;
    state.prossimaGenerazioneBloccata = null;
    
    return {
      triggered: true,
      tipo: 'APERTURA_GENERAZIONE',
      generazione: 11,
      messaggio: 'Tutte le distribuzioni complete - Pronta apertura H11'
    };
  }
  
  const genSuccessiva = state.generazioni[generazioneSuccessiva];
  
  if (!genSuccessiva) {
    console.log(`   ⚠️  Generazione H${generazioneSuccessiva} non trovata nello stato`);
    return { triggered: false };
  }
  
  console.log(`   → Trigger distribuzione a H${generazioneSuccessiva}`);
  console.log(`   → Riceventi pendenti: ${genSuccessiva.riceventiPendenti}`);
  
  // Sblocca cascata per generazione successiva
  genSuccessiva.bloccoCascata = false;
  state.prossimaGenerazioneBloccata = generazioneSuccessiva - 2; // Prossima dopo questa
  
  return {
    triggered: true,
    tipo: 'DISTRIBUZIONE_MASSA',
    generazioneOrigine: generazioneCompletata,
    generazioneTarget: generazioneSuccessiva,
    riceventiDaProcessare: genSuccessiva.riceventiPendenti,
    messaggio: `H${generazioneCompletata} completa → Distribuzione massa a TUTTI H${generazioneSuccessiva}`,
    bloccoCascata: genSuccessiva.bloccoCascata
  };
}

/**
 * Verifica se può distribuire a ricevente del ricevente
 * PUNTO 57-62: Blocco finché generazione non completa
 * 
 * @param {number} generazioneRicevente - Generazione del ricevente (es: 8 per H8)
 * @returns {Promise<Object>} { permesso: boolean, motivo: string }
 */
async function puoDistribuireARiceventeDelRicevente(generazioneRicevente) {
  const state = await readCascataState();
  
  const gen = state.generazioni[generazioneRicevente];
  
  if (!gen) {
    return {
      permesso: false,
      motivo: `Generazione H${generazioneRicevente} non trovata`,
      bloccoCascata: true
    };
  }
  
  if (gen.bloccoCascata) {
    // Trova quale generazione deve completare prima
    const generazioneDaCompletare = generazioneRicevente + 2;
    const genDaCompletare = state.generazioni[generazioneDaCompletare];
    
    return {
      permesso: false,
      motivo: `BLOCCO CASCATA: H${generazioneRicevente} deve aspettare completamento H${generazioneDaCompletare}`,
      bloccoCascata: true,
      generazioneBloccante: generazioneDaCompletare,
      molecoleMancanti: genDaCompletare ? genDaCompletare.molecoleMancanti : 'N/A',
      progressoBloccante: genDaCompletare ? `${genDaCompletare.molecoleCompletate}/${genDaCompletare.totaleMolecole}` : 'N/A'
    };
  }
  
  return {
    permesso: true,
    motivo: `Cascata sbloccata per H${generazioneRicevente}`,
    bloccoCascata: false
  };
}

/**
 * Registra distribuzione completata a ricevente del ricevente
 * 
 * @param {number} generazione - Generazione del ricevente
 * @param {string} ricevente - Wallet ricevente
 * @param {number} importo - Importo distribuito
 * @returns {Promise<Object>} Risultato
 */
async function registraDistribuzioneRiceventeDelRicevente(generazione, ricevente, importo) {
  const state = await readCascataState();
  
  const gen = state.generazioni[generazione];
  
  if (!gen) {
    return {
      success: false,
      error: `Generazione H${generazione} non trovata`
    };
  }
  
  console.log(`\n💰 DISTRIBUZIONE RICEVENTE DEL RICEVENTE`);
  console.log(`   Generazione: H${generazione}`);
  console.log(`   Ricevente: ${ricevente}`);
  console.log(`   Importo: ${importo}€`);
  
  // Aggiorna contatori
  gen.riceventiPendenti--;
  gen.molecoleCompletate = gen.totaleMolecole - gen.riceventiPendenti;
  gen.percentualeCompletamento = ((gen.molecoleCompletate / gen.totaleMolecole) * 100).toFixed(2);
  
  console.log(`   Progresso: ${gen.molecoleCompletate}/${gen.totaleMolecole} (${gen.percentualeCompletamento}%)`);
  
  // Log
  state.log.push({
    timestamp: new Date().toISOString(),
    azione: 'DISTRIBUZIONE_RICEVENTE_DEL_RICEVENTE',
    generazione: `H${generazione}`,
    ricevente,
    importo,
    progresso: `${gen.molecoleCompletate}/${gen.totaleMolecole}`
  });
  
  // Verifica completamento
  let triggerCascata = false;
  if (gen.riceventiPendenti <= 0) {
    console.log(`\n🎉 H${generazione} - TUTTI HANNO RICEVUTO!`);
    gen.completata = true;
    
    // Marca ciclo completato in base a generazione
    const cicliMap = { 8: 'secondoDono', 6: 'terzoDono', 4: 'quartoDono', 2: 'quintoDono' };
    const cicloCampo = cicliMap[generazione];
    if (cicloCampo) {
      gen[`${cicloCampo}Completato`] = true;
    }
    
    // Trigger cascata successiva
    triggerCascata = await verificaETriggaCascata(state, generazione);
    
    state.log.push({
      timestamp: new Date().toISOString(),
      azione: 'TUTTI_RICEVUTO',
      generazione: `H${generazione}`,
      triggerCascata: triggerCascata.triggered
    });
  }
  
  state.ultimoAggiornamento = new Date().toISOString();
  await saveCascataState(state);
  
  return {
    success: true,
    generazione: `H${generazione}`,
    progresso: {
      completate: gen.molecoleCompletate,
      totali: gen.totaleMolecole,
      percentuale: gen.percentualeCompletamento,
      pendenti: gen.riceventiPendenti
    },
    tuttiHannoRicevuto: gen.riceventiPendenti <= 0,
    triggerCascata: triggerCascata || { triggered: false }
  };
}

/**
 * Ottiene stato corrente generazioni
 */
async function getStatoGenerazioni() {
  const state = await readCascataState();
  
  const result = {
    generazioneCorrente: `H${state.generazioneCorrente}`,
    molecolaCorrente: state.molecolaCorrente,
    cascataBloccata: state.cascataBloccata,
    prossimaGenerazioneBloccata: state.prossimaGenerazioneBloccata ? `H${state.prossimaGenerazioneBloccata}` : null,
    generazioni: {}
  };
  
  // Formatta generazioni
  Object.keys(state.generazioni).forEach(gen => {
    const g = state.generazioni[gen];
    result.generazioni[g.nome] = {
      totaleMolecole: g.totaleMolecole,
      completate: g.molecoleCompletate,
      mancanti: g.molecoleMancanti,
      percentuale: g.percentualeCompletamento,
      completata: g.completata,
      bloccoCascata: g.bloccoCascata,
      riceventiPendenti: g.riceventiPendenti
    };
  });
  
  return result;
}

/**
 * Calcola molecole mancanti per completamento generazione
 */
function calcolaMolecoleMancanti(generazione, molecoleCompletate) {
  const genInfo = GENERAZIONI_MAP[generazione];
  if (!genInfo) return null;
  
  return {
    generazione: genInfo.nome,
    totaleMolecole: genInfo.molecole,
    completate: molecoleCompletate,
    mancanti: genInfo.molecole - molecoleCompletate,
    percentuale: ((molecoleCompletate / genInfo.molecole) * 100).toFixed(2)
  };
}

/**
 * Ottiene log recenti
 */
async function getLogRecenti(limit = 20) {
  const state = await readCascataState();
  return state.log.slice(-limit);
}

// ========================================
// IMPORT DA doni_mancanti.txt
// ========================================

/**
 * Importa stato da doni_mancanti.txt (se necessario)
 */
async function importaDaDoniMancanti(filePath) {
  try {
    console.log(`\n📥 IMPORT DA doni_mancanti.txt`);
    console.log(`   File: ${filePath}`);
    
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Parsing semplificato - già conosciamo i dati
    const pending = {
      H8: [],
      H6: [],
      H4: []
    };
    
    let currentGen = null;
    
    lines.forEach(line => {
      if (line.includes('H8:')) currentGen = 'H8';
      else if (line.includes('H6:')) currentGen = 'H6';
      else if (line.includes('H4:')) currentGen = 'H4';
      else if (currentGen && line.match(/^\d+\t/)) {
        const pos = parseInt(line.split('\t')[0]);
        pending[currentGen].push(pos);
      }
    });
    
    console.log(`   H8: ${pending.H8.length} posizioni pendenti`);
    console.log(`   H6: ${pending.H6.length} posizioni pendenti`);
    console.log(`   H4: ${pending.H4.length} posizioni pendenti`);
    
    return pending;
    
  } catch (error) {
    console.error('❌ Errore import doni_mancanti.txt:', error);
    return null;
  }
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  // Funzioni principali
  registraMolecolaCompletata,
  puoDistribuireARiceventeDelRicevente,
  registraDistribuzioneRiceventeDelRicevente,
  
  // Stato e utility
  getStatoGenerazioni,
  calcolaMolecoleMancanti,
  getLogRecenti,
  
  // Import
  importaDaDoniMancanti,
  
  // Gestione stato (per test)
  readCascataState,
  saveCascataState,
  createInitialState,
  
  // Costanti
  FORMULE,
  GENERAZIONI_MAP
};
