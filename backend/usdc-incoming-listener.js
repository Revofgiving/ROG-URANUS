require('dotenv').config();

const { ethers } = require('ethers');
const statePg = require('./state-persistence-pg');

const donationFlowManager = require('./donation-flow-manager');
const pgConn = require('./pg-connection-manager');
const { getPolygonProvider } = require('./polygon-provider');
const pendingDonationStore = require('./pending-donation-store');
const giftIntentStore = require('./gift-intent-store');

// ========================================
// CONFIG
// ========================================

// Wallet ROG Cassa (destinazione donazioni)
const ROG_WALLET = (process.env.ROG_WALLET_ADDRESS || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790').toLowerCase();
const URANUS_CASSA_WALLET = (process.env.URANUS_CASSA_WALLET || process.env.URANO_FUND_WALLET || process.env.CASSA_WALLET || '').toLowerCase();

// USDC Token su Polygon Mainnet (NUOVO USDC di Circle)
const USDC_CONTRACT = (process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359').toLowerCase();

const USDC_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() external view returns (uint8)'
];

const STATE_KEY = 'usdc_listener';

// Quanti identificatori univoci teniamo in memoria per evitare reprocess
const MAX_PROCESSED_IDS = 5000;

// Range di blocchi per queryFilter (per evitare timeout / limiti RPC)
// Nota: alcuni RPC pubblici (es. polygon-rpc.com) limitano fortemente eth_getLogs.
// Tenere basso di default e ridurre automaticamente se il provider risponde "Block range is too large".
const QUERY_CHUNK_SIZE = Number(process.env.USDC_LISTENER_QUERY_CHUNK || 200);
const MIN_QUERY_CHUNK_SIZE = Number(process.env.USDC_LISTENER_MIN_QUERY_CHUNK || 50);

let provider;
let usdc;
let transferFilter;
let started = false;

async function loadState() {
  try {
    const saved = await statePg.getState(STATE_KEY, {
      lastProcessedBlock: 0,
      processedEventIds: []
    });
    return {
      lastProcessedBlock: Number(saved.lastProcessedBlock || 0),
      processedEventIds: Array.isArray(saved.processedEventIds) ? saved.processedEventIds : []
    };
  } catch (err) {
    console.error('❌ Errore loadState usdc-listener:', err.message);
    return { lastProcessedBlock: 0, processedEventIds: [] };
  }
}

async function saveState(state) {
  const compact = {
    lastProcessedBlock: Number(state.lastProcessedBlock || 0),
    processedEventIds: (state.processedEventIds || []).slice(-MAX_PROCESSED_IDS)
  };
  await statePg.setState(STATE_KEY, compact);
}

function getEventId(event) {
  // Unico anche se nello stesso tx ci sono più transfer
  // Ethers v5 event ha logIndex e transactionHash
  return `${event.transactionHash}:${event.logIndex}`;
}
function windowBounds(iso, minutes = 30) {
  const ts = new Date(iso).getTime();
  const delta = minutes * 60 * 1000;
  return {
    start: new Date(ts - delta).toISOString(),
    end: new Date(ts + delta).toISOString()
  };
}

async function appendBridgeAnomaly(code, payload) {
  const state = await statePg.getState('uranus_bridge_anomalies', { items: [] });
  const items = Array.isArray(state.items) ? state.items : [];
  items.push({ code, payload, at: new Date().toISOString() });
  await statePg.setState('uranus_bridge_anomalies', { items: items.slice(-2000) });
}

async function findUranusBridgeMatches({ walletOrigine, walletCassa, amountUSDC, timestampIso }) {
  if (!Number.isFinite(amountUSDC)) return [];
  await pgConn.initDatabase();
  const { start, end } = windowBounds(timestampIso, 30);
  const rows = await pgConn.queryMany(
    `SELECT * FROM uranus_bridge_events
     WHERE status = 'PENDING'
       AND tx_hash IS NULL
       AND event_key IS NOT NULL
       AND LOWER(wallet_origine) = LOWER($1)
       AND LOWER(wallet_cassa) = LOWER($2)
       AND importo_ricevuto = $3
       AND created_at BETWEEN $4 AND $5
     ORDER BY created_at ASC`,
    [walletOrigine, walletCassa, amountUSDC, start, end]
  );
  return rows || [];
}

async function handleTransfer({ from, to, value, event }) {
  const id = getEventId(event);

  // Deduplica
  const state = await loadState();
  if (state.processedEventIds.includes(id)) {
    return { skipped: true, reason: 'already_processed', id };
  }

  // Consideriamo solo transfer in ingresso a ROG
  if ((to || '').toLowerCase() !== ROG_WALLET) {
    return { skipped: true, reason: 'not_to_rog', id };
  }

  // Decimali USDC (Circle) = 6
  const amountUSDC = Number(ethers.utils.formatUnits(value, 6));

  // Timestamp dal blocco
  const block = await provider.getBlock(event.blockNumber);
  const timestampIso = block?.timestamp ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();

  console.log('\n💰 USDC INCOMING TRANSFER DETECTED');
  console.log('===================================');
  console.log(`From:      ${from}`);
  console.log(`To:        ${to}`);
  console.log(`Amount:    ${amountUSDC} USDC`);
  console.log(`TxHash:    ${event.transactionHash}`);
  console.log(`Block:     ${event.blockNumber}`);
  console.log(`LogIndex:  ${event.logIndex}`);
  // 🌉 BRIDGE URANUS → ROG: se il transfer arriva dalla cassa Uranus,
  // usa il flusso donazione standard con event_key idempotente.
  if (URANUS_CASSA_WALLET && String(from || '').toLowerCase() === URANUS_CASSA_WALLET) {
    try {
      const existing = await pgConn.queryOne(
        `SELECT * FROM uranus_bridge_events WHERE tx_hash = $1 LIMIT 1`,
        [event.transactionHash]
      );
      if (existing?.event_key) {
        console.log(`♻️ Bridge URANUS già collegato (event_key=${existing.event_key})`);
        state.processedEventIds.push(id);
        state.lastProcessedBlock = Math.max(state.lastProcessedBlock || 0, Number(event.blockNumber || 0));
        await saveState(state);
        return { success: true, id, deduped: true, eventKey: existing.event_key };
      }

      const matches = await findUranusBridgeMatches({
        walletOrigine: from,
        walletCassa: to,
        amountUSDC,
        timestampIso
      });

      if (matches.length === 0) {
        console.warn('⚠️ BRIDGE_EVENT_NOT_FOUND: nessun record compatibile');
        await appendBridgeAnomaly('BRIDGE_EVENT_NOT_FOUND', {
          tx_hash: event.transactionHash,
          wallet_origine: from,
          wallet_cassa: to,
          amount_usdc: amountUSDC,
          timestamp: timestampIso
        });
        return { success: false, id, error: 'BRIDGE_EVENT_NOT_FOUND' };
      }

      if (matches.length > 1) {
        console.warn(`⚠️ BRIDGE_EVENT_AMBIGUOUS: ${matches.length} record compatibili`);
        const keys = matches.map((m) => m.event_key);
        await pgConn.query(
          `UPDATE uranus_bridge_events
             SET status = 'REQUIRES_RECONCILIATION',
                 error = 'BRIDGE_EVENT_AMBIGUOUS',
                 updated_at = NOW()
           WHERE event_key = ANY($1::text[])`,
          [keys]
        );
        await appendBridgeAnomaly('BRIDGE_EVENT_AMBIGUOUS', {
          tx_hash: event.transactionHash,
          event_keys: keys,
          wallet_origine: from,
          wallet_cassa: to,
          amount_usdc: amountUSDC,
          timestamp: timestampIso
        });
        return { success: false, id, error: 'BRIDGE_EVENT_AMBIGUOUS' };
      }

      const bridgeRow = matches[0];
      await pgConn.query(
        `UPDATE uranus_bridge_events
           SET tx_hash = $2,
               status = 'FUNDS_RECEIVED',
               updated_at = NOW()
         WHERE event_key = $1`,
        [bridgeRow.event_key, event.transactionHash]
      );

      console.log(`🌉 Bridge URANUS collegato (event_key=${bridgeRow.event_key}) → flusso donazione standard`);
      const donationResult = await donationFlowManager.processDonation({
        donationId: bridgeRow.event_key,
        donor: bridgeRow.wallet_beneficiario,
        amountUSDC,
        txHash: event.transactionHash,
        timestamp: timestampIso,
        donationType: 'uranus-l3',
        source: bridgeRow.source || 'URANUS_L3',
        eventKey: bridgeRow.event_key
      });

      if (!donationResult.success) {
        await pgConn.query(
          `UPDATE uranus_bridge_events
             SET status = 'FAILED',
                 error = $2,
                 updated_at = NOW()
           WHERE event_key = $1`,
          [bridgeRow.event_key, donationResult.error || 'processDonation failed']
        );
        console.error('❌ Errore processDonation (URANUS bridge):', donationResult.error);
        return { success: false, id, error: donationResult.error };
      }

      const posizioni = donationResult.positions?.posizioni || donationResult.positions?.positions || null;
      await pgConn.query(
        `UPDATE uranus_bridge_events
           SET status = 'COMPLETED',
               importo_utilizzato = $2,
               posizioni = $3,
               donation_id = $4,
               updated_at = NOW()
         WHERE event_key = $1`,
        [
          bridgeRow.event_key,
          amountUSDC,
          posizioni ? JSON.stringify(posizioni) : null,
          donationResult.donation?.donationId || bridgeRow.event_key
        ]
      );

      state.processedEventIds.push(id);
      state.lastProcessedBlock = Math.max(state.lastProcessedBlock || 0, Number(event.blockNumber || 0));
      await saveState(state);

      return { success: true, id, donationResult };
    } catch (bridgeErr) {
      console.error('❌ Errore gestione bridge URANUS:', bridgeErr.message || bridgeErr);
      return { success: false, id, error: bridgeErr.message || String(bridgeErr) };
    }
  }


  // 🎁 CERCA DONAZIONE PENDENTE: Se il frontend ha registrato una donazione
  // con questo txHash (es. Carta Regalo), usa quei dati (incluso beneficiaryWallet)
  // Cerchiamo prima per txHash, poi per donor wallet (fallback per race condition)
  let pendingData = pendingDonationStore.findByTxHash(event.transactionHash);
  // Traccia se il match è avvenuto per txHash (esatto, non "stale"): serve per
  // decidere se è sicuro completare un regalo direttamente dal listener.
  let matchedByTxHash = !!pendingData;
  
  // FALLBACK: Se non troviamo per txHash, cerchiamo per donor wallet
  // Questo risolve il race condition quando il listener riceve il transfer
  // prima che il frontend aggiorni il txHash
  if (!pendingData) {
    pendingData = pendingDonationStore.findByDonor(from);
    if (pendingData) {
      console.log(`📋 Trovata donazione pendente per wallet donor: ${pendingData.donationId}`);
      // Aggiorna il txHash nella donazione pendente
      pendingDonationStore.update(pendingData.donationId, { txHash: event.transactionHash });
    }
  }
  
  let donationType = 'standard';
  let beneficiaryWallet = null;
  let beneficiaryName = null;
  let giftMessage = null;
  
  if (pendingData) {
    console.log(`📋 Trovata donazione pendente registrata dal frontend: ${pendingData.donationId}`);
    console.log(`   Tipo donazione: ${pendingData.donationType || 'standard'}`);
    donationType = pendingData.donationType || 'standard';
    beneficiaryWallet = pendingData.beneficiaryWallet || null;
    beneficiaryName = pendingData.beneficiaryName || null;
    giftMessage = pendingData.giftMessage || null;
    
    if (beneficiaryWallet) {
      console.log(`🎁 CARTA REGALO rilevata! Beneficiario: ${beneficiaryWallet}`);
    }
    if (donationType === 'dono-al-volo') {
      console.log(`🚀 DONO AL VOLO rilevato! Destinatari dalla lista FIFO`);
    }
  } else {
    // 🎁 RECUPERO DUREVOLE (anti-perdita): prima di deferire, cerchiamo un intento
    // di carta regalo PERSISTITO su PostgreSQL (gift_intents) ancora privo di
    // tx_hash, che combaci ESATTAMENTE per (donatore, importo). Copre il caso in
    // cui il browser è morto dopo il transfer ma prima di comunicare il txHash
    // reale, e/o il backend è stato riavviato (store in-memory vuoto).
    let pgIntent = null;
    try {
      pgIntent = await giftIntentStore.findPendingByDonorAmount(from, amountUSDC);
    } catch (e) {
      console.warn('⚠️  Lookup gift_intents fallito (non bloccante):', e.message || e);
    }

    if (pgIntent && pgIntent.beneficiary_wallet) {
      const bound = await giftIntentStore.bindTxHash(pgIntent.gift_id, event.transactionHash);
      console.log(`🎁 Intento regalo DUREVOLE recuperato per (donor, importo): ${pgIntent.gift_id} → ${pgIntent.beneficiary_wallet} (bind tx: ${bound})`);

      // Usiamo i dati persistiti per completare il regalo verso il beneficiario
      // corretto. Impostiamo una pendingData sintetica e proseguiamo (NO defer).
      pendingData = {
        donationId: pgIntent.gift_id,
        donor: from,
        amountUSDC,
        txHash: event.transactionHash,
        donationType: 'carta-regalo',
        beneficiaryWallet: pgIntent.beneficiary_wallet,
        giftMessage: pgIntent.gift_message || null
      };
      matchedByTxHash = true; // abbiamo legato proprio questa tx all'intento
      donationType = 'carta-regalo';
      beneficiaryWallet = pgIntent.beneficiary_wallet;
      giftMessage = pgIntent.gift_message || null;
    } else {
      console.log(`⚠️  Nessuna donazione pendente trovata per txHash o wallet.`);
      console.log(`⏳ DEFER: Attendo registrazione dal frontend (potrebbe essere carta regalo)...`);

      // 🎁 FIX CARTA REGALO: NON processare subito se non c'è pendingData!
      // Il frontend potrebbe non aver ancora registrato la donazione.
      // Aspettiamo che /api/donation/register venga chiamato.
      // Salviamo solo lo stato per evitare re-detection.
      state.processedEventIds.push(id);
      state.lastProcessedBlock = Math.max(state.lastProcessedBlock || 0, Number(event.blockNumber || 0));
      await saveState(state);

      // Registra come "pending" così /api/donation/register può trovarlo
      pendingDonationStore.register(`usdc_${id}`, {
        donationId: `usdc_${id}`,
        donor: from,
        amountUSDC,
        txHash: event.transactionHash,
        status: 'USDC_RECEIVED_AWAITING_FRONTEND',
        usdcReceivedAt: timestampIso,
        blockNumber: event.blockNumber,
        donationType: 'unknown' // Sarà aggiornato dal frontend
      });

      console.log(`✅ Transfer USDC salvato come USDC_RECEIVED_AWAITING_FRONTEND`);
      console.log(`   Il frontend dovrà chiamare /api/donation/register per completare.`);
      return { success: true, id, deferred: true, reason: 'waiting_for_frontend_registration' };
    }
  }

  // 🔬 MODALITÀ FORENSE: Verifichiamo on-chain e creiamo posizioni
  // Il listener USDC ora processa donazioni complete con verifica blockchain
  
  // 🚨 FIX RACE CONDITION: Se il donationId NON è numerico (donation_xxx, pending_xxx, ecc.),
  // NON processiamo immediatamente. Il listener può trovare entry stale via findByDonor()
  // con donationType sbagliato (es. 'dono-al-volo' da una donazione precedente).
  // Solo IDs numerici (da registerDonation() on-chain) sono sicuri da processare.
  // Il frontend processerà tramite /api/donation/verify con i dati corretti.
  const donationIdToUse = pendingData?.donationId || id;
  const isNumericId = /^\d+$/.test(String(donationIdToUse));
  const isTemporaryId = !isNumericId;
  
  // 🎁 RECUPERO ROBUSTO CARTA REGALO:
  // Se abbiamo i dati COMPLETI del regalo e il match è esatto per txHash (quindi
  // NON un'entry "stale" trovata per donor), completiamo SUBITO dal listener
  // invece di deferire. Così le posizioni del beneficiario vengono create anche
  // se il frontend non chiama /api/donation/verify (es. pagina chiusa dopo il
  // transfer). L'idempotenza per txHash (getProcessedDonation + mutex per-txHash
  // in processDonation) evita qualsiasi doppia creazione se anche /verify dovesse
  // processare la stessa transazione.
  const isGiftReadyFromListener =
    matchedByTxHash &&
    (pendingData.donationType === 'carta-regalo') &&
    !!pendingData.beneficiaryWallet;

  if (isTemporaryId && pendingData && !isGiftReadyFromListener) {
    console.log('⏳ DonationId non-numerico rilevato - DEFER processing');
    console.log(`   ID: ${donationIdToUse} (tipo: ${pendingData.donationType || 'unknown'})`);
    console.log('   Attendo che frontend completi il flusso via /api/donation/verify...');
    
    // Marca come USDC_RECEIVED ma NON processare ancora
    pendingDonationStore.update(pendingData.donationId, {
      status: 'USDC_RECEIVED',
      txHash: event.transactionHash,
      usdcReceivedAt: timestampIso,
      blockNumber: event.blockNumber
    });
    
    // Marca come processato per evitare re-detection, ma non creiamo posizioni
    state.processedEventIds.push(id);
    state.lastProcessedBlock = Math.max(state.lastProcessedBlock || 0, Number(event.blockNumber || 0));
    await saveState(state);
    
    console.log('✅ USDC transfer marcato come ricevuto - posizioni verranno create da /api/donation/verify');
    return { success: true, id, deferred: true, reason: 'waiting_for_numeric_donationId' };
  }

  if (isTemporaryId && isGiftReadyFromListener) {
    console.log('🎁 Carta regalo con dati completi (match txHash): completamento dal listener (recupero robusto).');
    console.log(`   Beneficiario: ${pendingData.beneficiaryWallet}`);
  }
  
  const donationResult = await donationFlowManager.processDonation({
    donationId: donationIdToUse,
    donor: from,
    amountUSDC,
    txHash: event.transactionHash,
    timestamp: timestampIso,
    donationType,
    // Dati opzionali per Carta Regalo (recuperati dal pending store)
    beneficiaryWallet,
    beneficiaryName,
    giftMessage
  });

  if (!donationResult.success) {
    console.error('❌ Errore processDonation (USDC listener forense):', donationResult.error);
    // NON marchiamo come processato per poter riprovare dopo
    return { success: false, id, error: donationResult.error };
  }

  // Marca come processato (donazione completata con posizioni)
  state.processedEventIds.push(id);
  state.lastProcessedBlock = Math.max(state.lastProcessedBlock || 0, Number(event.blockNumber || 0));
  await saveState(state);

  // Se c'era una donazione pendente registrata dal frontend, aggiorna lo stato
  // così /api/donation/verify può ritornare il risultato corretto
  if (pendingData?.donationId) {
    pendingDonationStore.update(pendingData.donationId, {
      status: 'COMPLETED',
      positions: donationResult.positions,
      processedByListener: true
    });
    console.log(`📋 Donazione pendente ${pendingData.donationId} marcata come COMPLETED`);
  }

  console.log('✅ USDC transfer processato con successo (posizioni create dal listener forense)');
  console.log(`   Posizioni create: ${donationResult.donation?.positionsCreated || 0}`);
  console.log(`   Range: ${donationResult.donation?.firstPosition} → ${donationResult.donation?.lastPosition}`);
  return { success: true, id, donationResult };
}

async function catchUpFromHistory() {
  const state = await loadState();

  const currentBlock = await provider.getBlockNumber();

  // Se non abbiamo uno state, partiamo da uno start block configurabile.
  // Default: ultimi ~20k blocchi (Polygon è veloce, ma meglio limitare).
  const defaultStart = Math.max(0, currentBlock - Number(process.env.USDC_LISTENER_DEFAULT_LOOKBACK_BLOCKS || 20000));
  const envStart = process.env.USDC_LISTENER_START_BLOCK ? Number(process.env.USDC_LISTENER_START_BLOCK) : null;

  // Se USDC_LISTENER_START_BLOCK è impostato, lo trattiamo come "forza rescan da qui"
  // (anche se lo state locale ha un lastProcessedBlock più avanti). La deduplica su processedEventIds
  // evita doppie elaborazioni.
  let fromBlock;
  if (Number.isFinite(envStart)) {
    fromBlock = envStart;
  } else if (state.lastProcessedBlock > 0) {
    fromBlock = state.lastProcessedBlock;
  } else {
    fromBlock = defaultStart;
  }

  let toBlock = currentBlock;

  if (fromBlock > toBlock) {
    fromBlock = toBlock;
  }

  console.log(`\n⏪ USDC listener catch-up: scanning blocks ${fromBlock}..${toBlock} (initialChunk=${QUERY_CHUNK_SIZE})`);

  // Chunk adattivo: se l'RPC risponde "Block range is too large" riduciamo e riproviamo.
  let chunk = QUERY_CHUNK_SIZE;

  for (let start = fromBlock; start <= toBlock; ) {
    const end = Math.min(toBlock, start + chunk - 1);

    let events;
    try {
      events = await usdc.queryFilter(transferFilter, start, end);
    } catch (err) {
      const msg = (err && (err.message || err.toString())) || '';
      const isRangeTooLarge = msg.includes('Block range is too large') || msg.includes('block range is too large');

      if (isRangeTooLarge && chunk > MIN_QUERY_CHUNK_SIZE) {
        const next = Math.max(MIN_QUERY_CHUNK_SIZE, Math.floor(chunk / 2));
        console.warn(`⚠️  RPC limit: Block range is too large. Reducing chunk ${chunk} -> ${next} and retrying...`);
        chunk = next;
        continue; // retry same start with smaller chunk
      }

      console.error(`❌ queryFilter failed for blocks ${start}-${end}:`, msg);
      // Se fallisce comunque, saltiamo questo range minimo per evitare loop infinito
      start = end + 1;
      continue;
    }

    // Processa solo quelli verso ROG
    for (const ev of events) {
      try {
        await handleTransfer({
          from: ev.args?.from,
          to: ev.args?.to,
          value: ev.args?.value,
          event: ev
        });
      } catch (err) {
        console.error('❌ Error processing historical USDC event:', err.message || err);
      }
    }

    // Aggiorna lastProcessedBlock anche se non ci sono eventi
    const s = await loadState();
    s.lastProcessedBlock = Math.max(s.lastProcessedBlock || 0, end);
    await saveState(s);

    // Avanza al chunk successivo
    start = end + 1;
  }

  console.log('✅ USDC listener catch-up completed');
}

async function initialize() {
  provider = await getPolygonProvider();
  usdc = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);
  transferFilter = usdc.filters.Transfer(null, ROG_WALLET);

  return true;
}

async function start() {
  if (started) return;
  started = true;

  if (!provider || !usdc) {
    await initialize();
  }

  await catchUpFromHistory();

  console.log('\n👂 USDC listener: subscribing to incoming Transfer events...');

  usdc.on(transferFilter, async (from, to, value, event) => {
    try {
      await handleTransfer({ from, to, value, event });
    } catch (err) {
      console.error('❌ USDC listener runtime error:', err.message || err);
    }
  });
}

function stop() {
  if (!usdc || !transferFilter) return;
  usdc.removeAllListeners(transferFilter);
  started = false;
}

module.exports = {
  initialize,
  start,
  stop,
  ROG_WALLET,
  USDC_CONTRACT
};
