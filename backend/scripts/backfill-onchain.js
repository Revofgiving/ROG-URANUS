/**
 * ⛓️  URANUS — BACKFILL ON-CHAIN delle transazioni GIÀ avvenute.
 *
 * Registra sul contratto UranusRegistry (solo AUDIT, nessun fondo):
 *   - le 82 donazioni certificate (USDC + XAUt0) con il loro HASH REALE e importo USDC-equivalente
 *   - il payout della pos 0 (Fortunato, 500 USDC, L3)
 *
 * SICUREZZA:
 *   - Chiave dal .env via dotenv (MAI stampata). Verifica chainId 137.
 *   - IDEMPOTENTE: salta le tx già registrate (usedTxHashes on-chain).
 *   - Sequenziale con attesa conferma + sleep ≥ cooldown (1s) → nessun rate-limit.
 *   - Sotto i limiti del circuit breaker (10.000 reg/ora, 1M USDC/ora).
 *   - DRY_RUN di default; APPLY=true per inviare le transazioni.
 *
 * USO:
 *   node backend/scripts/backfill-onchain.js              # DRY_RUN
 *   APPLY=true node backend/scripts/backfill-onchain.js   # esegue
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ENV_FILE = process.env.ENV_FILE || '/Users/admin/Desktop/URANUS_SMART_CONTRACT_22GIUGNO/.env';
require('dotenv').config({ path: ENV_FILE });
const { ethers } = require('ethers');

const REGISTRY = process.env.REGISTRY_ADDRESS || '0x0261257A0793617f9a0e4355170B757035768013';
const RPC = process.env.RPC_OVERRIDE || process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const PK = process.env.DEPLOYER_PRIVATE_KEY;
const MAP_DIR = process.env.MAP_DIR
  || (fs.existsSync(path.resolve(__dirname, 'data', 'URANUS-mappa-definitiva-20260703.csv'))
        ? path.resolve(__dirname, 'data')
        : path.resolve(__dirname, '../../MAPPA-DEFINITIVA-03LUGLIO'));
const MAPPA_CSV = path.join(MAP_DIR, 'URANUS-mappa-definitiva-20260703.csv');

const FORTUNATO = '0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4';
const DONO_POS0_TX = '0x1ae343c5e4d46ab94d7bcd57f476b0fd11cd559ac4e6496eae2496bedaaf6a15';
const DONO_POS0_USDC = 500;
const SLEEP_MS = Number(process.env.SLEEP_MS || 1500);

const ABI = [
  'function registerDonation(address,uint256,bytes32) returns (uint256)',
  'function registerPayout(address,uint256,uint8,bytes32) returns (uint256)',
  'function usedTxHashes(bytes32) view returns (bool)',
  'function getContractStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,address,uint256)',
];

function parseCsvLine(line){const o=[];let c='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch=='"'){if(line[i+1]=='"'){c+='"';i++;}else q=false;}else c+=ch;}else{if(ch=='"')q=true;else if(ch==','){o.push(c);c='';}else c+=ch;}}o.push(c);return o;}
function readCsv(f){const r=fs.readFileSync(f,'utf8').replace(/\r/g,'');const L=r.split('\n').filter(x=>x.length);const h=parseCsvLine(L[0]);return L.slice(1).map(l=>{const c=parseCsvLine(l);const o={};h.forEach((k,i)=>o[k]=c[i]);return o;});}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// gasLimit ESPLICITO: bypassa eth_estimateGas (che alcuni RPC rifiutano) come fa chain-registrar.
const FEE = { gasLimit: 300000, maxPriorityFeePerGas: ethers.utils.parseUnits('40', 'gwei'), maxFeePerGas: ethers.utils.parseUnits('200', 'gwei') };
const LIMIT = Number(process.env.LIMIT || 0); // se >0, processa solo le prime N (per test)

(async () => {
  if (!PK) throw new Error('DEPLOYER_PRIVATE_KEY mancante nel .env');
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  if (net.chainId !== 137) throw new Error('RPC NON su Polygon mainnet (chainId ' + net.chainId + ')');
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(REGISTRY, ABI, wallet);

  // Costruisci le donazioni per-tx dalla mappa (CASSA+HUMAN raggruppate per hash)
  const mappa = readCsv(MAPPA_CSV);
  const byTx = new Map();
  for (const r of mappa) {
    const tx = (r.tx_hash || '').trim();
    const tipo = (r.tipo || '').toUpperCase();
    if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx) || !['CASSA', 'HUMAN'].includes(tipo)) continue;
    if (!byTx.has(tx)) byTx.set(tx, { human: null, pos: 0, token: r.token || 'USDC' });
    const g = byTx.get(tx); g.pos++;
    if (tipo === 'HUMAN') g.human = (r.wallet || '').toLowerCase();
  }
  const donations = [...byTx.entries()].map(([tx, g]) => ({ tx, wallet: g.human, amount: (g.pos / 2) * 20, token: g.token }));

  console.log('=== BACKFILL ON-CHAIN ===');
  console.log('registry:', REGISTRY, '| signer:', wallet.address, '| chainId:', net.chainId);
  console.log('donazioni dalla mappa:', donations.length, '| di cui XAUt0:', donations.filter(d => d.token === 'XAUt0').length);

  let toDo = [], done = 0;
  for (const d of donations) { if (await c.usedTxHashes(d.tx)) done++; else toDo.push(d); }
  if (LIMIT > 0) { console.log('LIMIT attivo: processo solo le prime', LIMIT); toDo = toDo.slice(0, LIMIT); }
  const payoutDone = await c.usedTxHashes(DONO_POS0_TX);
  const stats = await c.getContractStats();
  const bal = await provider.getBalance(wallet.address);
  console.log('già on-chain:', done, '| da registrare:', toDo.length, '| payout pos0 già on-chain:', payoutDone);
  console.log('contatori on-chain: donations=' + stats[0], 'payouts=' + stats[1]);
  console.log('saldo MATIC signer:', ethers.utils.formatEther(bal));

  if (process.env.APPLY !== 'true') {
    if (toDo.length) {
      try { const r = await c.callStatic.registerDonation(toDo[0].wallet, ethers.utils.parseUnits(String(toDo[0].amount), 6), toDo[0].tx); console.log('SIMULAZIONE 1a donazione: OK (txId ' + r.toString() + ')'); }
      catch (e) { console.error('SIMULAZIONE REVERT:', e.reason || e.message); }
    }
    const totale = toDo.length + (payoutDone ? 0 : 1);
    console.log('\nDRY_RUN: nessuna tx inviata. Da inviare in APPLY: ' + totale + ' transazioni (~' + SLEEP_MS + 'ms tra una e l\'altra).');
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (let i = 0; i < toDo.length; i++) {
    const d = toDo[i];
    try {
      const tx = await c.registerDonation(d.wallet, ethers.utils.parseUnits(String(d.amount), 6), d.tx, FEE);
      const rc = await tx.wait();
      rc.status === 1 ? ok++ : fail++;
      console.log(`[${i + 1}/${toDo.length}] ${d.token} ${d.wallet.slice(0, 10)} ${d.amount} USDC → ${rc.status === 1 ? 'OK' : 'REVERT'} ${tx.hash}`);
    } catch (e) { fail++; console.error(`[${i + 1}/${toDo.length}] ERRORE ${d.tx.slice(0, 12)}: ${e.reason || e.message}`); }
    await sleep(SLEEP_MS);
  }
  if (!payoutDone && LIMIT === 0) {
    try {
      const tx = await c.registerPayout(FORTUNATO, ethers.utils.parseUnits(String(DONO_POS0_USDC), 6), 3, DONO_POS0_TX, FEE);
      const rc = await tx.wait();
      rc.status === 1 ? ok++ : fail++;
      console.log(`[payout pos0] 500 USDC L3 → ${rc.status === 1 ? 'OK' : 'REVERT'} ${tx.hash}`);
    } catch (e) { fail++; console.error('[payout pos0] ERRORE:', e.reason || e.message); }
  }
  const s2 = await c.getContractStats();
  console.log(`\nFatto. ok=${ok} fail=${fail} | contatori on-chain: donations=${s2[0]} payouts=${s2[1]}`);
  process.exit(fail > 0 ? 2 : 0);
})().catch(e => { console.error('ERRORE:', e.reason || (e.error && e.error.message) || e.message); process.exit(1); });
