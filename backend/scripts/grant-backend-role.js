/**
 * ⛓️  URANUS — Attiva il registry on-chain: assegna BACKEND_ROLE al wallet backend.
 *
 * CAUSA: il constructor di UranusRegistry assegna al deployer solo DEFAULT_ADMIN_ROLE
 * + EMERGENCY_ROLE, NON BACKEND_ROLE. Senza BACKEND_ROLE ogni registerDonation/
 * registerPayout fa revert ("caller is not backend"). L'owner (= wallet backend) si
 * auto-assegna il ruolo con grantBackendRole (onlyOwner).
 *
 * SICUREZZA:
 *   - Chiave letta dal .env del progetto smart contract via dotenv (MAI stampata).
 *   - DRY_RUN di default (solo letture). APPLY=true per inviare la transazione.
 *   - Verifica: chainId 137 (Polygon), signer == owner, ruolo non già presente, saldo gas.
 *
 * USO:
 *   node backend/scripts/grant-backend-role.js            # DRY_RUN (verifica)
 *   APPLY=true node backend/scripts/grant-backend-role.js # esegue la grant
 *   ENV_FILE=/path/.env  REGISTRY_ADDRESS=0x..  RPC_OVERRIDE=https://..  (override opzionali)
 */
'use strict';

const ENV_FILE = process.env.ENV_FILE || '/Users/admin/Desktop/URANUS_SMART_CONTRACT_22GIUGNO/.env';
require('dotenv').config({ path: ENV_FILE });
const { ethers } = require('ethers');

const REGISTRY = process.env.REGISTRY_ADDRESS || '0x0261257A0793617f9a0e4355170B757035768013';
const RPC = process.env.RPC_OVERRIDE || process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const PK = process.env.DEPLOYER_PRIVATE_KEY;

const ABI = [
  'function owner() view returns (address)',
  'function BACKEND_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function paused() view returns (bool)',
  'function circuitBreakerTriggered() view returns (bool)',
  'function emergencyMode() view returns (bool)',
  'function grantBackendRole(address) external',
];

(async () => {
  if (!PK) throw new Error('DEPLOYER_PRIVATE_KEY mancante nel .env');
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(REGISTRY, ABI, wallet);

  const owner = await c.owner();
  const role = await c.BACKEND_ROLE();
  const isOwner = owner.toLowerCase() === wallet.address.toLowerCase();
  const has = await c.hasRole(role, wallet.address);
  const paused = await c.paused().catch(() => null);
  const cb = await c.circuitBreakerTriggered().catch(() => null);
  const em = await c.emergencyMode().catch(() => null);

  console.log('=== STATO REGISTRY ===');
  console.log('chainId            :', net.chainId, '(atteso 137 = Polygon)');
  console.log('registry           :', REGISTRY);
  console.log('signer (deployer)  :', wallet.address);
  console.log('owner contratto    :', owner, '| signer==owner:', isOwner);
  console.log('BACKEND_ROLE signer:', has);
  console.log('paused/circuit/emrg:', paused, '/', cb, '/', em);

  if (net.chainId !== 137) throw new Error('RPC NON su Polygon mainnet (chainId != 137) — interrompo');

  if (process.env.APPLY !== 'true') {
    console.log('\nDRY_RUN: nessuna transazione inviata.');
    console.log(has ? '→ Ruolo GIÀ presente: nulla da fare.'
                    : '→ Rilancia con APPLY=true per assegnare BACKEND_ROLE.');
    process.exit(0);
  }

  if (has) { console.log('Ruolo già presente, nulla da fare.'); process.exit(0); }
  if (!isOwner) throw new Error('Signer NON è owner: non può assegnare il ruolo');

  const bal = await provider.getBalance(wallet.address);
  console.log('\nSaldo MATIC signer :', ethers.utils.formatEther(bal));
  if (bal.isZero()) throw new Error('Signer senza MATIC per il gas');

  console.log('Invio grantBackendRole(' + wallet.address + ') ...');
  const tx = await c.grantBackendRole(wallet.address, {
    maxPriorityFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
    maxFeePerGas: ethers.utils.parseUnits('250', 'gwei'),
  });
  console.log('TX:', tx.hash, '→ https://polygonscan.com/tx/' + tx.hash);
  const rcpt = await tx.wait();
  console.log('Confermata. status:', rcpt.status, '| block:', rcpt.blockNumber);
  console.log('hasRole DOPO       :', await c.hasRole(role, wallet.address));
  console.log(rcpt.status === 1 ? '✅ BACKEND_ROLE assegnato — registry attivo' : '⚠️ tx status 0 (revert)');
  process.exit(rcpt.status === 1 ? 0 : 2);
})().catch(e => { console.error('ERRORE:', e.reason || (e.error && e.error.message) || e.message); process.exit(1); });
