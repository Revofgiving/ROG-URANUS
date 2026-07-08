/**
 * 🔍 ROG USDC TRANSACTION VERIFIER
 * 
 * Verifica automaticamente che il wallet ROG abbia ricevuto
 * l'importo USDC corretto dalla transazione specifica
 * 
 * @author ROG System
 */

const { ethers } = require('ethers');

// ========================================
// CONFIGURAZIONE
// ========================================

// Polygon RPC
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/';

// Wallet ROG Cassa (destinazione donazioni)
const ROG_WALLET = '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790';

// USDC Token su Polygon Mainnet (NUOVO USDC di Circle)
const USDC_CONTRACT = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

// ABI USDC (solo funzioni necessarie)
const USDC_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Provider Polygon
let provider;
let usdcContract;

/**
 * Inizializza provider e contratto USDC
 */
function initialize() {
  try {
    provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
    usdcContract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);
    console.log('✅ USDC Verifier inizializzato');
    return true;
  } catch (error) {
    console.error('❌ Errore inizializzazione USDC Verifier:', error.message);
    return false;
  }
}

/**
 * Verifica che una transazione USDC sia valida
 * 
 * @param {string} txHash - Hash della transazione da verificare
 * @param {string} expectedFrom - Wallet donatore atteso
 * @param {string} expectedAmount - Importo USDC atteso (in unità USDC, es. "10.00")
 * @returns {Object} Risultato verifica
 */
async function verifyUSDCTransaction(txHash, expectedFrom, expectedAmount) {
  try {
    console.log('\n🔍 VERIFICA TRANSAZIONE USDC');
    console.log('===================================');
    console.log(`TxHash:       ${txHash}`);
    console.log(`Da:           ${expectedFrom}`);
    console.log(`Importo:      ${expectedAmount} USDC`);
    console.log(`Destinazione: ${ROG_WALLET}`);
    
    // 1. Recupera transazione
    const tx = await provider.getTransaction(txHash);
    
    if (!tx) {
      return {
        success: false,
        error: 'Transazione non trovata',
        txHash
      };
    }
    
    console.log(`\n📋 Transazione trovata (block ${tx.blockNumber || 'pending'})`);
    
    // 2. Verifica che sia confermata
    if (!tx.blockNumber) {
      return {
        success: false,
        error: 'Transazione non ancora confermata',
        txHash,
        status: 'pending'
      };
    }
    
    // 3. Recupera receipt per verificare successo
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return {
        success: false,
        error: 'Receipt non disponibile',
        txHash
      };
    }
    
    if (receipt.status !== 1) {
      return {
        success: false,
        error: 'Transazione fallita on-chain',
        txHash,
        receipt
      };
    }
    
    console.log(`✅ Transazione confermata (status: ${receipt.status})`);
    
    // 4. Verifica che sia una transazione USDC
    if (tx.to.toLowerCase() !== USDC_CONTRACT.toLowerCase()) {
      return {
        success: false,
        error: 'Transazione non è verso contratto USDC',
        txHash,
        actualTo: tx.to,
        expectedTo: USDC_CONTRACT
      };
    }
    
    console.log(`✅ Contratto destinazione: USDC`);
    
    // 5. Decodifica input per estrarre destinatario e importo
    let decodedData;
    try {
      const iface = new ethers.utils.Interface(USDC_ABI);
      decodedData = iface.parseTransaction({ data: tx.data });
    } catch (error) {
      return {
        success: false,
        error: 'Impossibile decodificare dati transazione',
        txHash
      };
    }
    
    // 6. Verifica che sia una funzione transfer
    if (decodedData.name !== 'transfer') {
      return {
        success: false,
        error: `Funzione chiamata non è transfer: ${decodedData.name}`,
        txHash
      };
    }
    
    const actualRecipient = decodedData.args[0];
    const actualAmount = decodedData.args[1];
    
    console.log(`\n📊 DATI TRANSAZIONE:`);
    console.log(`   Da:        ${tx.from}`);
    console.log(`   A:         ${actualRecipient}`);
    console.log(`   Importo:   ${ethers.formatUnits(actualAmount, 6)} USDC`);
    
    // 7. Verifica mittente
    if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
      return {
        success: false,
        error: 'Mittente non corrisponde',
        txHash,
        expected: {
          from: expectedFrom
        },
        actual: {
          from: tx.from
        }
      };
    }
    
    console.log(`✅ Mittente verificato: ${tx.from}`);
    
    // 8. Verifica destinatario (wallet ROG)
    if (actualRecipient.toLowerCase() !== ROG_WALLET.toLowerCase()) {
      return {
        success: false,
        error: 'Destinatario non è wallet ROG',
        txHash,
        expected: {
          to: ROG_WALLET
        },
        actual: {
          to: actualRecipient
        }
      };
    }
    
    console.log(`✅ Destinatario verificato: ${actualRecipient}`);
    
    // 9. Verifica importo (con tolleranza minima per arrotondamenti)
    const expectedAmountWei = ethers.parseUnits(expectedAmount.toString(), 6);
    const tolerance = ethers.parseUnits('0.01', 6); // Tolleranza 0.01 USDC
    
    const diff = actualAmount > expectedAmountWei 
      ? actualAmount - expectedAmountWei 
      : expectedAmountWei - actualAmount;
    
    if (diff > tolerance) {
      return {
        success: false,
        error: 'Importo non corrisponde',
        txHash,
        expected: {
          amount: ethers.formatUnits(expectedAmountWei, 6),
          amountWei: expectedAmountWei.toString()
        },
        actual: {
          amount: ethers.formatUnits(actualAmount, 6),
          amountWei: actualAmount.toString()
        },
        difference: ethers.formatUnits(diff, 6)
      };
    }
    
    console.log(`✅ Importo verificato: ${ethers.formatUnits(actualAmount, 6)} USDC`);
    
    // 10. Tutto verificato!
    console.log(`\n✅ VERIFICA COMPLETATA CON SUCCESSO`);
    console.log(`===================================\n`);
    
    return {
      success: true,
      txHash,
      blockNumber: tx.blockNumber,
      timestamp: await getBlockTimestamp(tx.blockNumber),
      verified: {
        from: tx.from,
        to: actualRecipient,
        amount: ethers.formatUnits(actualAmount, 6),
        amountWei: actualAmount.toString()
      },
      receipt
    };
    
  } catch (error) {
    console.error('❌ Errore verifica transazione:', error);
    return {
      success: false,
      error: error.message,
      txHash
    };
  }
}

/**
 * Ottiene timestamp del blocco
 */
async function getBlockTimestamp(blockNumber) {
  try {
    const block = await provider.getBlock(blockNumber);
    return block ? block.timestamp : null;
  } catch (error) {
    console.error('Errore recupero timestamp:', error);
    return null;
  }
}

/**
 * Verifica bilancio USDC del wallet ROG
 */
async function checkROGBalance() {
  try {
    const balance = await usdcContract.balanceOf(ROG_WALLET);
    const balanceFormatted = ethers.formatUnits(balance, 6);
    
    console.log(`💰 Bilancio wallet ROG: ${balanceFormatted} USDC`);
    
    return {
      success: true,
      balance: balanceFormatted,
      balanceWei: balance.toString()
    };
  } catch (error) {
    console.error('❌ Errore verifica bilancio:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Monitora transazioni USDC in entrata al wallet ROG in tempo reale
 */
function watchIncomingUSDC(callback) {
  console.log('👀 Monitoraggio transazioni USDC in entrata...');
  
  // Filtra eventi Transfer verso wallet ROG
  const filter = usdcContract.filters.Transfer(null, ROG_WALLET);
  
  usdcContract.on(filter, async (from, to, amount, event) => {
    console.log('\n💰 NUOVA DONAZIONE RICEVUTA!');
    console.log('===================================');
    console.log(`Da:      ${from}`);
    console.log(`Importo: ${ethers.formatUnits(amount, 6)} USDC`);
    console.log(`TxHash:  ${event.log.transactionHash}`);
    console.log(`Block:   ${event.log.blockNumber}`);
    
    if (callback) {
      callback({
        from,
        to,
        amount: ethers.formatUnits(amount, 6),
        amountWei: amount.toString(),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber
      });
    }
  });
  
  return () => {
    usdcContract.removeAllListeners(filter);
    console.log('🛑 Monitoraggio fermato');
  };
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  initialize,
  verifyUSDCTransaction,
  checkROGBalance,
  watchIncomingUSDC,
  ROG_WALLET,
  USDC_CONTRACT
};

// ========================================
// TEST STANDALONE
// ========================================

if (require.main === module) {
  console.log('🔍 ROG USDC TRANSACTION VERIFIER - TEST MODE');
  console.log('=====================================\n');
  
  if (initialize()) {
    // Test verifica bilancio
    checkROGBalance();
    
    // Test monitoraggio (esempio)
    console.log('\n👀 Avvio monitoraggio transazioni...');
    const stopWatch = watchIncomingUSDC((donation) => {
      console.log('✅ Donazione rilevata e processata');
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down...');
      stopWatch();
      process.exit(0);
    });
  } else {
    console.error('❌ Impossibile inizializzare verifier');
    process.exit(1);
  }
}
