/**
 * gift-reconciler.js
 *
 * Rete di sicurezza DUREVOLE per le Carte Regalo: garantisce che un regalo
 * pagato (USDC trasferiti) si traduca SEMPRE in posizioni per il beneficiario,
 * anche se:
 *   - il browser del donatore si chiude dopo il transfer (niente /verify)
 *   - il backend si riavvia (lo store in-memory viene perso)
 *   - il listener USDC è disabilitato
 *   - una singola elaborazione fallisce temporaneamente
 *
 * Come: legge da PostgreSQL (gift_intents) gli intenti PENDING che hanno già un
 * tx_hash reale e li completa chiamando donationFlowManager.processDonation().
 * L'operazione è IDEMPOTENTE: processDonation deduplica per tx_hash (mutex
 * per-tx + record donations), quindi anche se /verify o il listener hanno già
 * creato le posizioni, qui NON si creano doppioni: si marca solo COMPLETED.
 *
 * È volutamente indipendente dal listener USDC: è l'ancora di salvataggio.
 */

const giftIntentStore = require('./gift-intent-store');

let intervalHandle = null;
let running = false; // evita esecuzioni sovrapposte

function isEnabled() {
  return (process.env.GIFT_RECONCILER_ENABLED || 'true').toLowerCase() === 'true';
}

const INTERVAL_MS = parseInt(process.env.GIFT_RECONCILER_INTERVAL_MS || '30000', 10);
const GRACE_SECONDS = parseInt(process.env.GIFT_RECONCILER_GRACE_SECONDS || '45', 10);
const MAX_ATTEMPTS = parseInt(process.env.GIFT_RECONCILER_MAX_ATTEMPTS || '20', 10);
const BATCH_LIMIT = parseInt(process.env.GIFT_RECONCILER_BATCH_LIMIT || '50', 10);
const STARTUP_DELAY_MS = parseInt(process.env.GIFT_RECONCILER_STARTUP_DELAY_MS || '8000', 10);

async function reconcileOne(intent) {
  // require ritardato per evitare cicli di require all'avvio
  const donationFlowManager = require('./donation-flow-manager');

  const giftId = intent.gift_id;
  const donor = intent.donor_wallet;
  const beneficiaryWallet = intent.beneficiary_wallet;
  const amountUSDC = Number(intent.amount_usdc);
  const txHash = intent.tx_hash;
  const giftMessage = intent.gift_message || null;

  try {
    const result = await donationFlowManager.processDonation({
      donationId: giftId,
      donor,
      amountUSDC,
      txHash,
      timestamp: new Date().toISOString(),
      donationType: 'carta-regalo',
      beneficiaryWallet,
      giftMessage
    });

    // success o deduped => il regalo è (già) completato: marchiamo COMPLETED.
    if (result && (result.success || result.deduped)) {
      await giftIntentStore.markCompleted(giftId);
      console.log(`🎁 [reconciler] Regalo completato/recuperato: ${giftId} → ${beneficiaryWallet} (${amountUSDC} USDC)`);
      return true;
    }

    const errMsg = (result && result.message) || (result && result.error) || 'processDonation senza success';
    await giftIntentStore.incrementAttempt(giftId, errMsg);
    console.warn(`⚠️  [reconciler] Regalo ${giftId} non completato (tentativo registrato): ${errMsg}`);
    return false;
  } catch (error) {
    await giftIntentStore.incrementAttempt(giftId, error.message || String(error));
    console.error(`❌ [reconciler] Errore processando regalo ${giftId}:`, error.message || error);
    return false;
  }
}

async function runOnce() {
  if (running) return; // niente esecuzioni sovrapposte
  running = true;
  try {
    const intents = await giftIntentStore.getReconcilable({
      graceSeconds: GRACE_SECONDS,
      maxAttempts: MAX_ATTEMPTS,
      limit: BATCH_LIMIT
    });

    if (!intents.length) return;

    console.log(`🔁 [reconciler] Trovati ${intents.length} regali PENDING da verificare...`);
    for (const intent of intents) {
      await reconcileOne(intent);
    }
  } catch (error) {
    console.error('❌ [reconciler] Errore nel ciclo di riconciliazione:', error.message || error);
  } finally {
    running = false;
  }
}

function start() {
  if (!isEnabled()) {
    console.log('ℹ️  Gift reconciler disabilitato (GIFT_RECONCILER_ENABLED=false)');
    return;
  }
  if (intervalHandle) return; // già avviato

  console.log(`✅ Gift reconciler avviato (intervallo ${INTERVAL_MS}ms, grace ${GRACE_SECONDS}s)`);

  // Prima passata poco dopo l'avvio (recupera eventuali regali rimasti in sospeso
  // prima di un riavvio del backend), poi a intervalli regolari.
  setTimeout(() => { runOnce(); }, STARTUP_DELAY_MS);
  intervalHandle = setInterval(() => { runOnce(); }, INTERVAL_MS);

  // Non tenere vivo il processo solo per questo timer.
  if (intervalHandle && typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { start, stop, runOnce };
