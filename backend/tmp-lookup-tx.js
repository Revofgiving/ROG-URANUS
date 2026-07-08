const { ethers } = require('ethers');

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const ROG  = '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790';
const TF   = ethers.utils.id('Transfer(address,address,uint256)');

const rpcs = [
  'https://polygon.meowrpc.com',
  'https://1rpc.io/matic',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro'
];

const hashes = [
  '0xc62e3e7d48de7cc81c704908ac747a186febcb8c3f406b1af2ba9a95c0dbd831',
  '0x9a3816c084c836e2aa5acc4ad7b1183111405f909632c6d51ca0fc495d4bb6f2'
];

async function run() {
  for (const rpc of rpcs) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      const block = await p.getBlockNumber();
      console.log('RPC ok:', rpc, '(block', block + ')');

      for (const hash of hashes) {
        console.log('\n--- TX:', hash);
        const receipt = await p.getTransactionReceipt(hash);
        if (!receipt) {
          console.log('  ATTENZIONE: receipt non trovato');
          continue;
        }
        console.log('  Block:', receipt.blockNumber, '| Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
        console.log('  From (TX sender):', receipt.from);

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== USDC) continue;
          if (log.topics[0] !== TF) continue;
          const from   = '0x' + log.topics[1].slice(26);
          const to     = '0x' + log.topics[2].slice(26);
          const amount = parseInt(log.data, 16) / 1e6;
          console.log('  USDC Transfer:');
          console.log('    from   (DONOR):', from);
          console.log('    to            :', to);
          console.log('    amount        :', amount, 'USDC');
          console.log('    verso ROG?    :', to.toLowerCase() === ROG ? 'SI' : 'NO — ATTENZIONE');
        }
      }
      return; // trovato RPC funzionante, stop
    } catch (e) {
      console.log('RPC', rpc, 'fallito:', e.message.slice(0, 100));
    }
  }
  console.log('\nNessun RPC disponibile. Verifica connessione internet.');
}

run().catch(console.error);
