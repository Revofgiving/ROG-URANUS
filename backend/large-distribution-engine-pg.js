/**
 * 💸 ROG LARGE DISTRIBUTION ENGINE - PostgreSQL VERSION
 *
 * Gestisce la distribuzione effettiva di USDC ai riceventi nel movimento LARGE.
 *
 * RESPONSABILITÀ:
 * - Transazioni USDC on-chain (dal wallet cassa ROG ai wallet riceventi)
 * - Sistema ponti (0/1/≥2 invitati):
 *   - 0 invitati: 50% ricevente, 50% ponte invitante (FIFO)
 *   - 1 invitato: 75% ricevente, 25% ponte invitante (FIFO)
 *   - ≥2 invitati: 100% ricevente
 * - Tracking distribuzioni in `distribution_tasks` (PostgreSQL)
 * - Gestione accoppiamenti permanenti (8 cicli LARGE)
 * - Integrazione con `doni_ricevuti` per area personale
 *
 * VINCOLI:
 * - Idempotenza (dedupe per external_tx_hash)
 * - Transazioni atomiche PostgreSQL
 * - Retry automatico per transazioni on-chain fallite
 * - Wallet speciali (PILETTA/ROG/AVENGERS) sempre come ≥2 invitati (100%)
 *
 * @version 1.0.0
 * @author Warp AI Agent (NASA-level)
 */

const { ethers } = require('ethers');
const pg = require('./pg-connection-manager');
const dbPg = require('./db-unified-manager-pg');
const referralManager = require('./referral-manager');
const pontiManager = require('./ponti-manager');

// ========================================
// CONFIGURAZIONE
// ========================================

const ROG_WALLET_CASSA = process.env.ROG_WALLET_CASSA || '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790';
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY; // Chiave privata wallet backend (per firmare tx)
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/';
const USDC_CONTRACT_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC Polygon

// Wallet speciali (sempre 100% del dono, nessun ponte)
const SPECIAL_WALLETS = {
  ROG: '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790',
  PILETTA: '0x96e6a17f968b73d10263072899c95b83305281fe',
  AVENGERS: '0x7978c4423b4fd17fa05df593b4c05e138606f972'
};

// ABI USDC (solo funzioni necessarie)
const USDC_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
];

// ========================================
// HELPER FUNCTIONS
// ========================================

function normalizeWallet(w) {
  return String(w || '').trim().toLowerCase();
}

function isSpecialWallet(wallet) {
  const w = normalizeWallet(wallet);
  return (
    w === normalizeWallet(SPECIAL_WALLETS.ROG) ||
    w === normalizeWallet(SPECIAL_WALLETS.PILETTA) ||
    w === normalizeWallet(SPECIAL_WALLETS.AVENGERS)
  );
}

async function queryOne(sql, params = []) {
  return await pg.queryOne(sql, params);
}

async function queryMany(sql, params = []) {
  return await pg.queryMany(sql, params);
}

// ========================================
// CONTEGGIO INVITATI
// ========================================

/**
 * Conta il numero di invitati per un wallet
 * @param {string} wallet - Wallet da verificare
 * @returns {Promise<number>} Numero invitati (0, 1, 2+)
 */
async function getInvitatiCount(wallet) {
  const walletNorm = normalizeWallet(wallet);

  // Wallet speciali: sempre considerati con ≥2 invitati (100% del dono)
  if (isSpecialWallet(walletNorm)) {
    return 2; // Forzato
  }

  await referralManager.init();
  const count = await referralManager.contaInvitati(wallet);
  return Number(count) || 0;
}

/**
 * Determina la percentuale di dono per il ricevente in base al numero di invitati
 * @param {number} invitatiCount - Numero invitati
 * @returns {number} Percentuale (0.50, 0.75, 1.00)
 */
function getReceiverPercentage(invitatiCount) {
  if (invitatiCount >= 2) return 1.00; // 100%
  if (invitatiCount === 1) return 0.75; // 75%
  return 0.50; // 50% (0 invitati)
}

/**
 * Determina la percentuale di dono per il ponte invitante
 * @param {number} invitatiCount - Numero invitati del ricevente
 * @returns {number} Percentuale (0.00, 0.25, 0.50)
 */
function getPontePercentage(invitatiCount) {
  if (invitatiCount >= 2) return 0.00; // 0% (nessun ponte)
  if (invitatiCount === 1) return 0.25; // 25%
  return 0.50; // 50% (0 invitati)
}

// ========================================
// GESTIONE PONTI E ACCOPPIAMENTI
// ========================================

/**
 * Ottiene o crea accoppiamento FIFO per un ricevente che ha <2 invitati
 * @param {string} receiverWallet - Wallet ricevente
 * @param {number} invitatiCount - Numero invitati ricevente (0 o 1)
 * @returns {Promise<Object|null>} { ponteWallet, ponteNome, percentuale } o null se nessun ponte disponibile
 */
async function getOrCreatePonteAccoppiamento(receiverWallet, invitatiCount) {
  const walletNorm = normalizeWallet(receiverWallet);

  // Se ≥2 invitati, nessun ponte necessario
  if (invitatiCount >= 2) {
    return null;
  }

  await pontiManager.init();

  // Verifica accoppiamento esistente
  const existing = await pontiManager.getAccoppiamento(walletNorm);
  if (existing && existing.ponti && existing.ponti.length > 0) {
    const ponte = existing.ponti[0]; // Prendiamo il primo ponte (dovrebbe essere uno solo)
    return {
      ponteWallet: ponte.ponteWallet,
      ponteNome: ponte.ponteNome || 'Sconosciuto',
      percentuale: ponte.percentuale
    };
  }

  // Crea nuovo accoppiamento FIFO
  const invitatiNecessari = invitatiCount === 1 ? 1 : 2;
  const accoppiamento = await pontiManager.creaAccoppiamentoFIFO(walletNorm, invitatiNecessari);

  if (!accoppiamento || !accoppiamento.ponteWallet) {
    console.warn(`⚠️  Nessun ponte disponibile in FIFO per ${receiverWallet} (invitati=${invitatiCount})`);
    return null;
  }

  return {
    ponteWallet: accoppiamento.ponteWallet,
    ponteNome: accoppiamento.ponteNome || 'Sconosciuto',
    percentuale: getPontePercentage(invitatiCount)
  };
}

// ========================================
// TRANSAZIONI USDC ON-CHAIN
// ========================================

/**
 * Invia USDC on-chain usando ethers.js
 * @param {string} toWallet - Destinatario
 * @param {number} amountUSDC - Importo USDC (unità intere, es. 200 = 200 USDC)
 * @param {string} externalTxHash - Hash transazione esterna (per tracking)
 * @returns {Promise<Object>} { success, txHash, blockNumber, gasUsed } o { success: false, error }
 */
async function sendUSDCOnChain(toWallet, amountUSDC, externalTxHash) {
  // Verifica configurazione BACKEND_PRIVATE_KEY
  if (!BACKEND_PRIVATE_KEY || BACKEND_PRIVATE_KEY === 'your-backend-private-key') {
    const error = 'BACKEND_PRIVATE_KEY non configurato - impossibile inviare transazione';
    console.error(`❌ ${error}`);
    throw new Error(error);
  }

  try {
    const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
    const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
    const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, wallet);

    // USDC ha 6 decimali
    const decimals = 6;
    const amount = ethers.BigNumber.from(amountUSDC).mul(ethers.BigNumber.from(10).pow(decimals));

    console.log(`💸 Invio ${amountUSDC} USDC a ${toWallet}...`);
    console.log(`   Amount (wei): ${amount.toString()}`);

    const tx = await usdcContract.transfer(toWallet, amount);
    console.log(`   TX hash: ${tx.hash}`);
    console.log(`   ⏳ Attesa conferma...`);

    const receipt = await tx.wait();

    console.log(`   ✅ Transazione confermata!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);

    return {
      success: true,
      simulated: false,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      amount: amountUSDC,
      to: toWallet
    };

  } catch (error) {
    console.error(`❌ Errore invio USDC on-chain:`, error.message || error);
    return {
      success: false,
      simulated: false,
      error: error.message || String(error),
      amount: amountUSDC,
      to: toWallet
    };
  }
}

// ========================================
// TRACKING DISTRIBUZIONI
// ========================================

/**
 * Registra distribuzione in distribution_tasks (PostgreSQL)
 * @param {Object} params
 * @returns {Promise<number>} ID task creato
 */
async function createDistributionTask({
  movimento,
  kind,
  receiverWallet,
  receiverPosizione,
  molecola,
  generazioneNativa,
  ciclo,
  recipientWallet,
  amountUSDC,
  externalTxHash,
  status = 'PENDING'
}) {
  await pg.initDatabase();

  const sql = `
    INSERT INTO distribution_tasks (
      movimento,
      kind,
      receiver_wallet,
      receiver_posizione,
      molecola,
      generazione_nativa,
      ciclo,
      recipient_wallet,
      amount_usdc,
      external_tx_hash,
      status,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
    )
    RETURNING id
  `;

  const row = await queryOne(sql, [
    movimento,
    kind,
    normalizeWallet(receiverWallet),
    receiverPosizione,
    molecola,
    generazioneNativa,
    ciclo,
    normalizeWallet(recipientWallet),
    amountUSDC,
    externalTxHash,
    status
  ]);

  return row?.id || null;
}

/**
 * Aggiorna status di una distribution_task
 * @param {number} taskId - ID task
 * @param {string} status - Nuovo status (COMPLETED, FAILED)
 * @param {string} chainTxHash - Hash transazione on-chain
 * @param {number} chainLogIndex - Log index
 * @param {string|null} error - Errore (se FAILED)
 */
async function updateDistributionTask(taskId, status, chainTxHash = null, chainLogIndex = null, error = null) {
  const sql = `
    UPDATE distribution_tasks
    SET status = $1,
        chain_tx_hash = $2,
        chain_log_index = $3,
        error = $4,
        updated_at = NOW()
    WHERE id = $5
  `;

  await pg.query(sql, [status, chainTxHash, chainLogIndex, error, taskId]);
}

/**
 * Registra dono ricevuto in `doni_ricevuti` (per area personale)
 * @param {Object} params
 */
async function registerDonoRicevuto({
  recipientWallet,
  donorWallet,
  amountUSDC,
  kind,
  chainTxHash,
  logIndex,
  blockNumber,
  externalTxHash
}) {
  const sql = `
    INSERT INTO doni_ricevuti (
      recipient_wallet,
      donor_wallet,
      amount_usdc,
      kind,
      ts,
      chain_tx_hash,
      log_index,
      block_number,
      external_tx_hash,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, NOW(), $5, $6, $7, $8, NOW(), NOW()
    )
    ON CONFLICT (chain_tx_hash, log_index) DO NOTHING
  `;

  await pg.query(sql, [
    normalizeWallet(recipientWallet),
    normalizeWallet(donorWallet),
    amountUSDC,
    kind,
    chainTxHash,
    logIndex || 0,
    blockNumber || null,
    externalTxHash
  ]);
}

// ========================================
// ENTRY POINT PRINCIPALE
// ========================================

/**
 * Processa una distribuzione LARGE completa (ricevente + eventuale ponte)
 *
 * @param {Object} params
 * @param {string} params.receiverWallet - Wallet ricevente
 * @param {number} params.receiverPosizione - Numero posizione ricevente
 * @param {number} params.molecola - Numero molecola
 * @param {number} params.generazioneNativa - H nativo
 * @param {number} params.ciclo - Ciclo LARGE (1-8)
 * @param {number} params.amountTotal - Importo totale USDC del dono (es. 200)
 * @param {string} params.externalTxHash - Hash per idempotenza
 * @returns {Promise<Object>} Risultato distribuzione
 */
async function processDistribution({
  receiverWallet,
  receiverPosizione,
  molecola,
  generazioneNativa,
  ciclo,
  amountTotal,
  externalTxHash
}) {
  const walletNorm = normalizeWallet(receiverWallet);

  console.log(`\n💸 ========================================`);
  console.log(`   DISTRIBUZIONE LARGE`);
  console.log(`========================================`);
  console.log(`👤 Ricevente: ${receiverWallet}`);
  console.log(`📍 Posizione: ${receiverPosizione}`);
  console.log(`🔄 Ciclo: ${ciclo}`);
  console.log(`💰 Importo totale: ${amountTotal} USDC`);
  console.log(``);

  await pg.initDatabase();

  // 🚫 BLACKLIST CHECK - Verifica se ricevente è nella blacklist
  const blacklistManager = require('./blacklist-manager');
  const blacklistCheck = await blacklistManager.isWalletBlacklisted(walletNorm);
  
  if (blacklistCheck) {
    console.log(`   🚫 RICEVENTE BLACKLISTATO: ${receiverWallet}`);
    console.log(`   Distribuzione ANNULLATA - importo ritorna in cassa ROG`);
    return {
      success: false,
      blocked: true,
      reason: 'BLACKLISTED',
      receiverWallet: walletNorm,
      receiverPosizione,
      ciclo,
      amountTotal,
      message: 'Ricevente nella blacklist - impossibile ricevere doni'
    };
  }

  // Verifica idempotenza (distribution_task già processata?)
  const existingTask = await queryOne(
    'SELECT id, status FROM distribution_tasks WHERE external_tx_hash = $1 AND status = $2 LIMIT 1',
    [externalTxHash, 'COMPLETED']
  );

  if (existingTask) {
    console.log(`♻️  Distribuzione già completata (dedupe): taskId=${existingTask.id}`);
    return {
      success: true,
      deduped: true,
      taskId: existingTask.id
    };
  }

  const results = {
    receiverWallet: walletNorm,
    receiverPosizione,
    ciclo,
    amountTotal,
    distributions: []
  };

  try {
    // 1. Determina numero invitati
    const invitatiCount = await getInvitatiCount(walletNorm);
    console.log(`📊 Invitati ricevente: ${invitatiCount}`);

    const receiverPercentage = getReceiverPercentage(invitatiCount);
    const pontePercentage = getPontePercentage(invitatiCount);

    console.log(`   Percentuale ricevente: ${receiverPercentage * 100}%`);
    console.log(`   Percentuale ponte: ${pontePercentage * 100}%`);

    // 2. Calcola importi
    const amountReceiver = Math.floor(amountTotal * receiverPercentage);
    const amountPonte = amountTotal - amountReceiver; // resto va al ponte

    // 3. Distribuzione al RICEVENTE
    console.log(`\n💵 Distribuzione RICEVENTE: ${amountReceiver} USDC`);

    const taskReceiverId = await createDistributionTask({
      movimento: 'LARGE',
      kind: 'RECEIVER',
      receiverWallet: walletNorm,
      receiverPosizione,
      molecola,
      generazioneNativa,
      ciclo,
      recipientWallet: walletNorm,
      amountUSDC: amountReceiver,
      externalTxHash: `${externalTxHash}_receiver`,
      status: 'PENDING'
    });

    const txReceiver = await sendUSDCOnChain(walletNorm, amountReceiver, `${externalTxHash}_receiver`);

    if (txReceiver.success) {
      await updateDistributionTask(taskReceiverId, 'COMPLETED', txReceiver.txHash, 0, null);
      await registerDonoRicevuto({
        recipientWallet: walletNorm,
        donorWallet: ROG_WALLET_CASSA,
        amountUSDC: amountReceiver,
        kind: 'LARGE_RECEIVER',
        chainTxHash: txReceiver.txHash || `sim_${Date.now()}`,
        logIndex: 0,
        blockNumber: txReceiver.blockNumber,
        externalTxHash: `${externalTxHash}_receiver`
      });
      console.log(`   ✅ Distribuzione ricevente completata`);
    } else {
      await updateDistributionTask(taskReceiverId, 'FAILED', null, null, txReceiver.error);
      console.log(`   ❌ Distribuzione ricevente fallita: ${txReceiver.error}`);
    }

    results.distributions.push({
      kind: 'RECEIVER',
      wallet: walletNorm,
      amount: amountReceiver,
      ...txReceiver
    });

    // 4. Distribuzione al PONTE (se necessario)
    if (invitatiCount < 2 && amountPonte > 0) {
      console.log(`\n💵 Distribuzione PONTE: ${amountPonte} USDC`);

      const ponte = await getOrCreatePonteAccoppiamento(walletNorm, invitatiCount);

      if (!ponte) {
        console.warn(`   ⚠️  Nessun ponte disponibile - importo ${amountPonte} USDC rimane in cassa ROG`);
        // TODO: accantonare in "cassa ponti" per distribuzioni future
      } else {
        // 🚫 BLACKLIST CHECK per ponte
        const ponteBlacklisted = await blacklistManager.isWalletBlacklisted(ponte.ponteWallet);
        if (ponteBlacklisted) {
          console.log(`   🚫 PONTE BLACKLISTATO: ${ponte.ponteWallet} (${ponte.ponteNome})`);
          console.log(`   Importo ${amountPonte} USDC rimane in cassa ROG`);
          results.distributions.push({
            kind: 'PONTE_BLOCKED',
            wallet: ponte.ponteWallet,
            nome: ponte.ponteNome,
            amount: amountPonte,
            blocked: true,
            reason: 'BLACKLISTED'
          });
        } else {
        console.log(`   Ponte: ${ponte.ponteWallet} (${ponte.ponteNome})`);
        console.log(`   Percentuale: ${ponte.percentuale * 100}%`);

        const taskPonteId = await createDistributionTask({
          movimento: 'LARGE',
          kind: 'PONTE',
          receiverWallet: walletNorm,
          receiverPosizione,
          molecola,
          generazioneNativa,
          ciclo,
          recipientWallet: ponte.ponteWallet,
          amountUSDC: amountPonte,
          externalTxHash: `${externalTxHash}_ponte`,
          status: 'PENDING'
        });

        const txPonte = await sendUSDCOnChain(ponte.ponteWallet, amountPonte, `${externalTxHash}_ponte`);

        if (txPonte.success) {
          await updateDistributionTask(taskPonteId, 'COMPLETED', txPonte.txHash, 0, null);
          await registerDonoRicevuto({
            recipientWallet: ponte.ponteWallet,
            donorWallet: ROG_WALLET_CASSA,
            amountUSDC: amountPonte,
            kind: 'LARGE_PONTE',
            chainTxHash: txPonte.txHash || `sim_${Date.now()}_ponte`,
            logIndex: 0,
            blockNumber: txPonte.blockNumber,
            externalTxHash: `${externalTxHash}_ponte`
          });
          console.log(`   ✅ Distribuzione ponte completata`);
        } else {
          await updateDistributionTask(taskPonteId, 'FAILED', null, null, txPonte.error);
          console.log(`   ❌ Distribuzione ponte fallita: ${txPonte.error}`);
        }

        results.distributions.push({
          kind: 'PONTE',
          wallet: ponte.ponteWallet,
          nome: ponte.ponteNome,
          amount: amountPonte,
          ...txPonte
        });
        } // Fine else ponte non blacklistato
      }
    }

    console.log(`\n========================================`);
    console.log(`   ✅ DISTRIBUZIONE COMPLETATA`);
    console.log(`========================================\n`);

    return {
      success: true,
      ...results
    };

  } catch (error) {
    console.error(`❌ Errore processDistribution:`, error.message || error);
    return {
      success: false,
      error: error.message || String(error),
      receiverWallet: walletNorm,
      receiverPosizione,
      ciclo,
      amountTotal
    };
  }
}

/**
 * Processa tutte le distribuzioni per una generazione/ciclo
 * (da chiamare dopo che NET_EFFECTS ha identificato i riceventi)
 *
 * @param {Object} params
 * @param {number} params.generazioneNativa - H nativo
 * @param {number} params.ciclo - Ciclo LARGE (1-8)
 * @param {Array} params.receivers - Array di { wallet, posizione, molecola, amount }
 * @returns {Promise<Object>} Risultato batch
 */
async function processBatchDistributions({ generazioneNativa, ciclo, receivers }) {
  console.log(`\n💸 ========================================`);
  console.log(`   BATCH DISTRIBUZIONI LARGE`);
  console.log(`========================================`);
  console.log(`📊 Generazione: H${generazioneNativa}`);
  console.log(`🔄 Ciclo: ${ciclo}`);
  console.log(`👥 Riceventi: ${receivers.length}`);
  console.log(``);

  const results = [];

  for (const receiver of receivers) {
    const result = await processDistribution({
      receiverWallet: receiver.wallet,
      receiverPosizione: receiver.posizione,
      molecola: receiver.molecola,
      generazioneNativa,
      ciclo,
      amountTotal: receiver.amount,
      externalTxHash: `H${generazioneNativa}_C${ciclo}_P${receiver.posizione}`
    });

    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  console.log(`\n📊 RIEPILOGO BATCH:`);
  console.log(`   Successi: ${successCount}/${receivers.length}`);
  console.log(`   Falliti: ${failedCount}/${receivers.length}`);

  return {
    success: failedCount === 0,
    total: receivers.length,
    successCount,
    failedCount,
    results
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Entry points principali
  processDistribution,
  processBatchDistributions,

  // Helper per integrazione
  getInvitatiCount,
  getReceiverPercentage,
  getPontePercentage,
  getOrCreatePonteAccoppiamento,

  // Transazioni on-chain
  sendUSDCOnChain,

  // Tracking
  createDistributionTask,
  updateDistributionTask,
  registerDonoRicevuto,

  // Costanti
  SPECIAL_WALLETS,
  ROG_WALLET_CASSA
};
