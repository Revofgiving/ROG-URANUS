/**
 * ⛓️ URANUS — Chain Registrar
 *
 * Modulo che interagisce con UranusRegistry smart contract su Polygon
 * per registrare tutte le transazioni URANUS on-chain.
 *
 * PRINCIPIO: Fire-and-forget con retry.
 *   - Se la registrazione on-chain fallisce, logga errore ma NON blocca il flusso
 *   - Le operazioni del backend (payout, bridge, ecc.) continuano normalmente
 *   - Il registro on-chain è per trasparenza, non è bloccante
 *
 * PREREQUISITI:
 *   - URANUS_REGISTRY_ADDRESS nel .env
 *   - URANUS_BACKEND_PRIVATE_KEY nel .env (wallet con BACKEND_ROLE su UranusRegistry)
 *   - POLYGON_RPC_URL nel .env
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { ethers } = require('ethers');

// ── ABI minima di UranusRegistry ────────────────────────────────────
// Solo le funzioni che il backend chiama
const URANUS_REGISTRY_ABI = [
  'function registerDonation(address wallet, uint256 amount, bytes32 externalTxHash) external returns (uint256)',
  'function registerPayout(address wallet, uint256 amount, uint8 level, bytes32 externalTxHash) external returns (uint256)',
  'function registerBridgeEvent(address wallet, string txType, uint256 amount, string targetPlatform) external returns (uint256)',
  'function registerCrossReference(uint256 localTxId, string remotePlatform, bytes32 remoteTxHash) external returns (uint256)',
  'function getTotalTransactions() external view returns (uint256)',
  'function getContractStats() external view returns (uint256, uint256, uint256, uint256, uint256, uint256, address, uint256)',
  'event DonationRegistered(uint256 indexed txId, address indexed wallet, uint256 amount, bytes32 txHash)',
  'event PayoutRegistered(uint256 indexed txId, address indexed wallet, uint256 amount, uint8 level, bytes32 txHash)',
  'event BridgeEventRegistered(uint256 indexed txId, address indexed wallet, string txType, string targetPlatform, uint256 amount)',
  'event CrossReferenceCreated(uint256 indexed refId, uint256 indexed localTxId, string remotePlatform, bytes32 remoteTxHash)',
];

// USDC ha 6 decimali
const USDC_DECIMALS = 6;

// ── STATO ──────────────────────────────────────────────────────────

let provider = null;
let signer = null;
let contract = null;
let initialized = false;
let disabled = false;

// Coda di retry per operazioni fallite
const retryQueue = [];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ── INIZIALIZZAZIONE ────────────────────────────────────────────────

function init() {
  if (initialized) return true;

  const registryAddress = process.env.URANUS_REGISTRY_ADDRESS;
  const privateKey = process.env.URANUS_BACKEND_PRIVATE_KEY;
  const rpcUrl = process.env.POLYGON_RPC_URL;

  if (!registryAddress || !privateKey || !rpcUrl) {
    console.log('⛓️  [ChainRegistrar] DISABILITATO — variabili mancanti:');
    if (!registryAddress) console.log('   ❌ URANUS_REGISTRY_ADDRESS');
    if (!privateKey) console.log('   ❌ URANUS_BACKEND_PRIVATE_KEY');
    if (!rpcUrl) console.log('   ❌ POLYGON_RPC_URL');
    disabled = true;
    return false;
  }

  try {
    provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    signer = new ethers.Wallet(privateKey, provider);
    contract = new ethers.Contract(registryAddress, URANUS_REGISTRY_ABI, signer);
    initialized = true;
    console.log(`⛓️  [ChainRegistrar] Inizializzato — Registry: ${registryAddress}`);
    console.log(`   Backend wallet: ${signer.address}`);
    return true;
  } catch (err) {
    console.error(`⛓️  [ChainRegistrar] ERRORE init: ${err.message}`);
    disabled = true;
    return false;
  }
}

// ── HELPER: Converti USDC interi a 6 decimali ──────────────────────

function usdcToWei(usdcAmount) {
  return ethers.utils.parseUnits(usdcAmount.toString(), USDC_DECIMALS);
}

// ── HELPER: txHash stringa → bytes32 ────────────────────────────────

function txHashToBytes32(txHash) {
  if (!txHash || txHash === 'DEV_SKIP') return ethers.constants.HashZero;
  if (txHash.startsWith('0x') && txHash.length === 66) return txHash;
  // Per txHash interni (es. PAYOUT_L3_0x..._timestamp), calcoliamo keccak256
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(txHash));
}

// ── FIRE-AND-FORGET WRAPPER ─────────────────────────────────────────

async function fireAndForget(label, fn) {
  if (disabled || !initialized) {
    if (!disabled) init();
    if (disabled) return null;
  }

  try {
    const tx = await fn();
    const receipt = await tx.wait();
    console.log(`   ⛓️  [OnChain] ${label} — tx: ${receipt.transactionHash}`);
    return receipt;
  } catch (err) {
    console.error(`   ⛓️  [OnChain] ${label} FALLITO: ${err.message}`);
    // Aggiungi alla coda di retry
    retryQueue.push({ label, fn, retries: 0, lastError: err.message });
    scheduleRetry();
    return null;
  }
}

// ── RETRY SCHEDULER ─────────────────────────────────────────────────

let retryTimer = null;

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const pending = [...retryQueue];
    retryQueue.length = 0;

    for (const item of pending) {
      if (item.retries >= MAX_RETRIES) {
        console.error(`   ⛓️  [OnChain] ${item.label} — ABBANDONATO dopo ${MAX_RETRIES} tentativi: ${item.lastError}`);
        continue;
      }
      try {
        const tx = await item.fn();
        const receipt = await tx.wait();
        console.log(`   ⛓️  [OnChain] ${item.label} — RETRY OK: ${receipt.transactionHash}`);
      } catch (err) {
        item.retries++;
        item.lastError = err.message;
        retryQueue.push(item);
      }
    }

    if (retryQueue.length > 0) scheduleRetry();
  }, RETRY_DELAY_MS);
}

// ════════════════════════════════════════════════════════════════════
// FUNZIONI PUBBLICHE
// ════════════════════════════════════════════════════════════════════

/**
 * Registra una donazione d'ingresso on-chain
 * @param {string} wallet - Wallet del donatore
 * @param {number} amountUsdc - Importo in USDC (es. 20)
 * @param {string} txHash - Hash della transazione USDC su Polygon
 */
async function registerDonation(wallet, amountUsdc, txHash) {
  return fireAndForget(`Donation ${wallet.substring(0, 10)} ${amountUsdc} USDC`, () =>
    contract.registerDonation(wallet, usdcToWei(amountUsdc), txHashToBytes32(txHash))
  );
}

/**
 * Registra un payout on-chain
 * @param {string} wallet - Wallet destinatario
 * @param {number} amountUsdc - Importo netto in USDC
 * @param {number} level - Livello (3=Venere, 5=Saturno, 6=Nettuno)
 * @param {string} txHash - Hash tx payout (o stringa interna)
 */
async function registerPayout(wallet, amountUsdc, level, txHash) {
  return fireAndForget(
    `Payout L${level} ${wallet.substring(0, 10)} ${amountUsdc} USDC`,
    () =>
      contract.registerPayout(
        wallet,
        usdcToWei(amountUsdc),
        level,
        txHashToBytes32(txHash),
        {
          gasLimit: 100000,
          maxPriorityFeePerGas: ethers.utils.parseUnits('35', 'gwei'),
          maxFeePerGas: ethers.utils.parseUnits('100', 'gwei'),
        }
      )
  );
}

/**
 * Registra un bridge event cross-piattaforma on-chain
 * @param {string} wallet - Wallet dell'utente
 * @param {string} txType - Tipo (BRIDGE_ROG_SMALL, BRIDGE_PHARAOH, BRIDGE_RIENTRI_SOLE, etc.)
 * @param {number} amountUsdc - Importo in USDC
 * @param {string} targetPlatform - Piattaforma destinazione (ROG, PHARAOH, URANUS)
 */
async function registerBridgeEvent(wallet, txType, amountUsdc, targetPlatform) {
  return fireAndForget(`Bridge ${txType} → ${targetPlatform} ${amountUsdc} USDC`, () =>
    contract.registerBridgeEvent(wallet, txType, usdcToWei(amountUsdc), targetPlatform)
  );
}

/**
 * Crea un cross-reference tra transazione locale e remota
 * @param {number} localTxId - ID transazione locale in UranusRegistry
 * @param {string} remotePlatform - Piattaforma remota (ROG, PHARAOH)
 * @param {string} remoteTxHash - Hash/ID della tx remota
 */
async function registerCrossReference(localTxId, remotePlatform, remoteTxHash) {
  return fireAndForget(`CrossRef ${localTxId} ↔ ${remotePlatform}`, () =>
    contract.registerCrossReference(localTxId, remotePlatform, txHashToBytes32(remoteTxHash))
  );
}

/**
 * Ottieni statistiche dal contratto (view, no gas)
 */
async function getOnChainStats() {
  if (disabled || !initialized) {
    if (!disabled) init();
    if (disabled) return { disabled: true };
  }
  try {
    const stats = await contract.getContractStats();
    return {
      totalDonations: Number(stats[0]),
      totalPayouts: Number(stats[1]),
      totalBridgeEvents: Number(stats[2]),
      totalCrossRefs: Number(stats[3]),
      donationsVolume: ethers.utils.formatUnits(stats[4], USDC_DECIMALS),
      payoutsVolume: ethers.utils.formatUnits(stats[5], USDC_DECIMALS),
      parentDAO: stats[6],
      platformCount: Number(stats[7]),
    };
  } catch (err) {
    console.error(`⛓️  [ChainRegistrar] getOnChainStats ERRORE: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Stato del modulo
 */
function getStatus() {
  return {
    initialized,
    disabled,
    retryQueueLength: retryQueue.length,
    registryAddress: process.env.URANUS_REGISTRY_ADDRESS || null,
    backendWallet: signer?.address || null,
  };
}

// ── INIT AL CARICAMENTO ─────────────────────────────────────────────
init();

module.exports = {
  registerDonation,
  registerPayout,
  registerBridgeEvent,
  registerCrossReference,
  getOnChainStats,
  getStatus,
  init,
};
