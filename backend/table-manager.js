/**
 * 🎲 URANO — Table Manager
 *
 * Gestisce creazione, numerazione e sdoppiamento delle tavole.
 *
 * REGOLE CHIAVE:
 * - Reg.2: Ogni donatore genera una tavola di sdoppiamento (posto al centro come futuro erede/faraone)
 * - Reg.5: Le tavole sono numerate sequenzialmente, la numerazione prosegue turno dopo turno
 * - Reg.7: I Simbionti NON generano tavole di sdoppiamento
 *
 * CAPACITÀ TAVOLE:
 * - Livello 0 Sole: 6 caselle
 * - Livello 1 Luna: 2 caselle
 * - Livello 2 Mercurio: 3 caselle per tavola
 * - Livello 3 Venere: 3 caselle per tavola
 * - Livello 4 Giove: 3 caselle per tavola  [Blocco 2]
 * - Livello 5 Saturno: 3 caselle per tavola [Blocco 2]
 */

const db = require('./db-manager');

// ========================================
// COSTANTI
// ========================================

const LIVELLI = {
  SOLE:     { numero: 0, nome: 'Sole',     capacita: 6, sezione: 'ENTRATA', blocco: null },
  LUNA:     { numero: 1, nome: 'Luna',     capacita: 2, sezione: 'URANO',   blocco: 1 },
  MERCURIO: { numero: 2, nome: 'Mercurio', capacita: 3, sezione: 'URANO',   blocco: 1 },
  VENERE:   { numero: 3, nome: 'Venere',   capacita: 3, sezione: 'URANO',   blocco: 1 },
  GIOVE:    { numero: 4, nome: 'Giove',    capacita: 3, sezione: 'URANO',   blocco: 2 },
  SATURNO:  { numero: 5, nome: 'Saturno',  capacita: 3, sezione: 'URANO',   blocco: 2 },
};

function getLivelloConfig(livello) {
  const configs = Object.values(LIVELLI);
  return configs.find(c => c.numero === livello) || null;
}

// ========================================
// CREAZIONE TAVOLE
// ========================================

/**
 * Crea una tavola di PERCORSO (quella dove il Faraone/Erede riceve i doni).
 *
 * @param {number} livello - 0-5
 * @param {string} faraoneWallet - Wallet dell'erede/faraone al centro
 * @param {number} turno - Turno corrente
 * @param {number} [numeroForzato] - Se specificato, usa questo numero (reg.4: il Faraone porta la sua tavola)
 * @returns {Object} Tavola creata
 */
async function creaTavolaPercorso(livello, faraoneWallet, turno, numeroForzato = null) {
  const config = getLivelloConfig(livello);
  if (!config) throw new Error(`Livello ${livello} non valido`);

  const numero = numeroForzato ?? await db.getNextTavolaNumero();

  const tavola = await db.createTavola({
    numero,
    sezione: config.sezione,
    livello,
    blocco: config.blocco,
    tipo: 'PERCORSO',
    capacita: config.capacita,
    faraoneWallet,
    turno
  });

  console.log(`   🎲 Tavola PERCORSO #${numero} creata (L${livello} ${config.nome}, cap=${config.capacita})`);
  return tavola;
}

/**
 * Crea una tavola di SDOPPIAMENTO per un donatore (reg.2).
 *
 * Dopo che un donatore fa il dono, il sistema gli crea una tavola
 * e lo posiziona al centro come futuro erede/faraone.
 *
 * @param {number} livello - Livello della tavola padre
 * @param {string} donatoreWallet - Wallet del donatore
 * @param {number} turno - Turno corrente
 * @returns {Object} Tavola di sdoppiamento creata
 */
async function creaTavolaSdoppiamento(livello, donatoreWallet, turno) {
  const config = getLivelloConfig(livello);
  if (!config) throw new Error(`Livello ${livello} non valido`);

  const numero = await db.getNextTavolaNumero();

  // La tavola di sdoppiamento ha la stessa capacità del livello
  // (nel livello Sole = 6, Luna = 2, altri = 3)
  const tavola = await db.createTavola({
    numero,
    sezione: config.sezione,
    livello,
    blocco: config.blocco,
    tipo: 'SDOPPIAMENTO',
    capacita: config.capacita,
    faraoneWallet: donatoreWallet,
    turno
  });

  console.log(`   🔀 Tavola SDOPPIAMENTO #${numero} creata per ${donatoreWallet.substring(0, 10)}... (L${livello})`);
  return tavola;
}

// ========================================
// POSIZIONAMENTO DONATORE
// ========================================

/**
 * Posiziona un donatore in una casella della tavola e gestisce lo sdoppiamento.
 *
 * @param {Object} params
 * @param {number} params.tavolaId - ID tavola di percorso
 * @param {number} params.tavolaNumero - Numero tavola
 * @param {number} params.livello - Livello corrente
 * @param {string} params.wallet - Wallet donatore
 * @param {string} params.nome - Nome donatore
 * @param {string} params.tipo - DONATORE | SIMBIONTE | PERPETUO | GEMELLO
 * @param {number} params.donoImporto - Importo del dono
 * @param {number} params.turno - Turno corrente
 * @param {boolean} params.sdoppiabile - Se true crea tavola sdoppiamento (reg.7: simbionti = false)
 * @returns {Object} { posizione, tavolaSdoppiamento }
 */
async function posizionaDonatore({ tavolaId, tavolaNumero, livello, wallet, nome, tipo, donoImporto, turno, sdoppiabile = true, numeroPosizioneBase = null }) {
const config = getLivelloConfig(livello);

// Retry automatico su duplicate key (race condition casella)
const MAX_RETRIES = 3;
let posizione = null;
let occupate = null;
let casella = null;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  occupate = await db.countPosizioniInTavola(tavolaId);
  casella = occupate + 1;

  if (casella > config.capacita) {
    throw new Error(`Tavola #${tavolaNumero} piena (${occupate}/${config.capacita})`);
  }

  try {
    posizione = await db.createPosizione({
      tavolaId,
      casella,
      wallet,
      nome,
      tipo,
      donoImporto,
      // numero_posizione Sole L0 = (turno-1)*6 + casella; passato come base dal chiamante.
      numeroPosizione: (numeroPosizioneBase != null) ? numeroPosizioneBase + casella : null
    });
    break;
  } catch (err) {
    const isDuplicate = err.message && err.message.includes('posizioni_tavola_id_casella_key');
    if (!isDuplicate || attempt === MAX_RETRIES) throw err;
    console.warn(`⚠️ posizionaDonatore: casella ${casella} già occupata (attempt ${attempt}/${MAX_RETRIES}) — ricalcolo...`);
  }
}

  // Aggiorna totale doni ricevuti nella tavola
  await db.updateTavolaDoni(tavolaNumero, donoImporto);

  console.log(`   📍 ${nome} posizionato in tavola #${tavolaNumero} casella ${casella}/${config.capacita} (${tipo}, dono=${donoImporto})`);

  // Sdoppiamento (reg.2): crea tavola e metti donatore al centro come futuro erede
  // Reg.7: I Simbionti NON si sdoppiano
  let tavolaSdoppiamento = null;

  if (sdoppiabile && tipo !== 'SIMBIONTE') {
    tavolaSdoppiamento = await creaTavolaSdoppiamento(livello, wallet, turno);

    // Aggiorna la posizione con il riferimento alla tavola di sdoppiamento
    await db.updatePosizioneSdoppiamento(posizione.id, tavolaSdoppiamento.id);

    console.log(`   🔀 Sdoppiamento: tavola #${tavolaSdoppiamento.numero} con ${nome} al centro`);
  }

  // Verifica se la tavola è ora completa
  const nuoveOccupate = occupate + 1;
  const tavolaCompleta = nuoveOccupate >= config.capacita;

  if (tavolaCompleta) {
    await db.updateTavolaStatus(tavolaNumero, 'COMPLETATA');
    console.log(`   ✅ Tavola #${tavolaNumero} COMPLETATA (${nuoveOccupate}/${config.capacita})`);
  }

  return {
    posizione,
    tavolaSdoppiamento,
    tavolaCompleta,
    casellaOccupata: casella,
    totaleCaselle: config.capacita
  };
}

// ========================================
// PROGRESSIONE SACERDOTI (da un livello al successivo)
// ========================================

/**
 * Avanza i sacerdoti da un livello completato al livello successivo.
 *
 * Il documento descrive i sacerdoti che PROGREDISCONO con il Faraone:
 *   - Sacerdoti 1-2 appaiono a Luna → poi a Mercurio → poi a Venere
 *   - Sacerdoti 3-6 appaiono a Mercurio → poi a Venere
 *   - Sacerdoti 7-18 entrano direttamente a Venere
 *
 * Quando un livello si completa, questa funzione crea le tavole al livello
 * superiore e vi inserisce i sacerdoti come PROGREDITO (importo già contabilizzato).
 *
 * @param {number} daLivello       - Livello di origine (es. 1=Luna, 2=Mercurio)
 * @param {number} aLivello        - Livello di destinazione (es. 2=Mercurio, 3=Venere)
 * @param {number} turnoNumero     - Numero turno corrente
 * @param {string} faraoneWallet   - Wallet del Faraone di turno
 * @returns {Array} Lista delle tavole create al livello superiore
 */
async function avanzaSacerdotiAlLivello(daLivello, aLivello, turnoNumero, faraoneWallet) {
  const pg = require('./pg-connection-manager');

  // Recupera tutti i sacerdoti dal livello di origine (PERCORSO completate di quel turno)
  // Include sia DONATORE (entrati nuovi) sia PROGREDITO (già avanzati da un livello precedente)
  const sacerdoti = await pg.queryMany(
    `SELECT p.wallet, p.nome
     FROM posizioni p
     JOIN tavole t ON p.tavola_id = t.id
     WHERE t.livello = $1
       AND t.turno   = $2
       AND t.tipo    = 'PERCORSO'
       AND p.tipo   != 'EREDE'
     ORDER BY p.id ASC`,
    [daLivello, turnoNumero]
  );

  if (sacerdoti.length === 0) {
    console.log(`   ℹ️  Nessun sacerdote da avanzare da L${daLivello} → L${aLivello}`);
    return [];
  }

  const destConfig = getLivelloConfig(aLivello);
  if (!destConfig) throw new Error(`Livello destinazione ${aLivello} non valido`);

  console.log(`\n   ⬆️  PROGRESSIONE: ${sacerdoti.length} sacerdoti L${daLivello} → L${aLivello} (${destConfig.nome})`);

  const tavolaCreate = [];
  let sacIdx = 0;

  // FASE 1: Riempi tavole APERTE già esistenti al livello destinazione
  // (es. tavole Funzioni con Simbionti/Perpetuo che hanno ancora caselle libere)
  const aperte = await pg.queryMany(
    `SELECT * FROM tavole WHERE livello = $1 AND turno = $2 AND tipo = 'PERCORSO' AND status = 'APERTA' ORDER BY numero ASC`,
    [aLivello, turnoNumero]
  );

  for (const tavola of aperte) {
    if (sacIdx >= sacerdoti.length) break;
    const occupate = await db.countPosizioniInTavola(tavola.id);
    const libere = destConfig.capacita - occupate;

    for (let j = 0; j < libere && sacIdx < sacerdoti.length; j++) {
      const sac = sacerdoti[sacIdx];
      await db.createPosizione({
        tavolaId:    tavola.id,
        casella:     occupate + j + 1,
        wallet:      sac.wallet,
        nome:        sac.nome,
        tipo:        'PROGREDITO',
        donoImporto: 0
      });
      console.log(`     → ${sac.nome || sac.wallet.substring(0, 10)} progredisce a L${aLivello} tavola #${tavola.numero} casella ${occupate + j + 1}`);
      sacIdx++;
    }

    const nuoveOccupate = await db.countPosizioniInTavola(tavola.id);
    if (nuoveOccupate >= destConfig.capacita) {
      await db.updateTavolaStatus(tavola.numero, 'COMPLETATA');
      console.log(`   ✅ Tavola #${tavola.numero} COMPLETATA (${nuoveOccupate}/${destConfig.capacita})`);
    }
  }

  // FASE 2: Crea nuove tavole per i sacerdoti rimanenti
  while (sacIdx < sacerdoti.length) {
    const remaining = sacerdoti.length - sacIdx;
    const batchSize = Math.min(remaining, destConfig.capacita);
    const batch = sacerdoti.slice(sacIdx, sacIdx + batchSize);

    const tavola = await creaTavolaPercorso(aLivello, faraoneWallet, turnoNumero);

    for (let j = 0; j < batch.length; j++) {
      const sac = batch[j];
      await db.createPosizione({
        tavolaId:    tavola.id,
        casella:     j + 1,
        wallet:      sac.wallet,
        nome:        sac.nome,
        tipo:        'PROGREDITO',
        donoImporto: 0
      });
      console.log(`     → ${sac.nome || sac.wallet.substring(0, 10)} progredisce a L${aLivello} tavola #${tavola.numero} casella ${j + 1}`);
    }

    if (batch.length === destConfig.capacita) {
      await db.updateTavolaStatus(tavola.numero, 'COMPLETATA');
    }

    tavolaCreate.push(tavola);
    sacIdx += batchSize;
  }

  console.log(`   ✅ Progressione completata: ${sacerdoti.length} sacerdoti avanzati a L${aLivello}`);
  return tavolaCreate;
}

// ========================================
// QUERY TAVOLE
// ========================================

/**
 * Trova la tavola di percorso attiva per un livello/turno
 */
async function getTavolaPercorsoAttiva(livello, turno) {
  const pg = require('./pg-connection-manager');
  return await pg.queryOne(
    `SELECT * FROM tavole
     WHERE livello = $1 AND turno = $2 AND tipo = 'PERCORSO' AND status = 'APERTA'
     ORDER BY numero ASC LIMIT 1`,
    [livello, turno]
  );
}

/**
 * Conta tavole create in un turno (per reg.5)
 */
async function countTavoleInTurno(turno) {
  const pg = require('./pg-connection-manager');
  const row = await pg.queryOne(
    'SELECT COUNT(*) AS cnt FROM tavole WHERE turno = $1',
    [turno]
  );
  return Number(row?.cnt) || 0;
}

/**
 * Ottiene tutte le tavole di sdoppiamento di un turno
 */
async function getTavoleSdoppiamentoTurno(turno) {
  const pg = require('./pg-connection-manager');
  return await pg.queryMany(
    `SELECT * FROM tavole WHERE turno = $1 AND tipo = 'SDOPPIAMENTO' ORDER BY numero ASC`,
    [turno]
  );
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  creaTavolaPercorso,
  creaTavolaSdoppiamento,
  posizionaDonatore,
  avanzaSacerdotiAlLivello,
  getTavolaPercorsoAttiva,
  countTavoleInTurno,
  getTavoleSdoppiamentoTurno,
  getLivelloConfig,
  LIVELLI
};
