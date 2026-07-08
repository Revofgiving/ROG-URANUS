require('dotenv').config();
const { ethers } = require('ethers');

/**
 * Script per assegnare BACKEND_ROLE al wallet ROG DAO
 * Esegui con: node grant-backend-role.js
 */

async function grantBackendRole() {
  console.log('🔧 Assegnazione BACKEND_ROLE al wallet ROG DAO...\n');

  // Configurazione
  const ROG_CONTRACT_ADDRESS = '0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0';
  const ROG_DAO_ADDRESS = '0x3c84A8463284e8F7E698eDd8CAfaBa023E4a9366';
  const BACKEND_ROLE = '0x25cf2b509f2a7f322675b2a5322b182f44ad2c03ac941a0af17c9b178f5d5d5f';
  
  // IMPORTANTE: Devi usare la private key del wallet ROG CASSA (owner del contratto)
  // NON quella di ROG DAO!
  const ROG_CASSA_PRIVATE_KEY = process.env.ROG_CASSA_PRIVATE_KEY;
  
  if (!ROG_CASSA_PRIVATE_KEY) {
    console.error('❌ ERRORE: ROG_CASSA_PRIVATE_KEY non trovata nel .env');
    console.log('\nAggiungi questa riga al file .env:');
    console.log('ROG_CASSA_PRIVATE_KEY=<private_key_di_ROG_CASSA>');
    process.exit(1);
  }

  // Connessione provider
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/'
  );

  // Wallet ROG CASSA (deve essere l'owner del contratto)
  const wallet = new ethers.Wallet(ROG_CASSA_PRIVATE_KEY, provider);
  
  console.log('📍 Wallet ROG CASSA:', wallet.address);
  console.log('📍 ROG DAO Address:', ROG_DAO_ADDRESS);
  console.log('📍 Contract:', ROG_CONTRACT_ADDRESS);
  console.log('');

  // ABI minimo per grantRole
  const contractABI = [
    'function grantRole(bytes32 role, address account) external',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function BACKEND_ROLE() view returns (bytes32)'
  ];

  const contract = new ethers.Contract(ROG_CONTRACT_ADDRESS, contractABI, wallet);

  try {
    // 1. Verifica ruolo attuale
    console.log('1️⃣ Verifica ruolo attuale...');
    const hasRoleBefore = await contract.hasRole(BACKEND_ROLE, ROG_DAO_ADDRESS);
    console.log('   ROG DAO ha BACKEND_ROLE:', hasRoleBefore ? '✅ SÌ' : '❌ NO');
    
    if (hasRoleBefore) {
      console.log('\n✅ BACKEND_ROLE già assegnato! Niente da fare.');
      return;
    }

    // 2. Stima gas
    console.log('\n2️⃣ Stima gas per la transazione...');
    const gasEstimate = await contract.estimateGas.grantRole(BACKEND_ROLE, ROG_DAO_ADDRESS);
    console.log('   Gas stimato:', gasEstimate.toString());

    // 3. Esegui grantRole
    console.log('\n3️⃣ Invio transazione grantRole...');
    
    // Gas price per Polygon (min 30 Gwei)
    const feeData = await provider.getFeeData();
    const maxPriorityFeePerGas = ethers.utils.parseUnits('30', 'gwei'); // 30 Gwei tip
    const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits('100', 'gwei');
    
    const tx = await contract.grantRole(BACKEND_ROLE, ROG_DAO_ADDRESS, {
      gasLimit: gasEstimate.mul(120).div(100), // +20% di margine
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      maxFeePerGas: maxFeePerGas
    });
    
    console.log('   📤 Transazione inviata:', tx.hash);
    console.log('   ⏳ Attendi conferma...');

    // 4. Attendi conferma
    const receipt = await tx.wait();
    console.log('   ✅ Transazione confermata in blocco:', receipt.blockNumber);

    // 5. Verifica finale
    console.log('\n4️⃣ Verifica finale...');
    const hasRoleAfter = await contract.hasRole(BACKEND_ROLE, ROG_DAO_ADDRESS);
    console.log('   ROG DAO ha BACKEND_ROLE:', hasRoleAfter ? '✅ SÌ' : '❌ NO');

    if (hasRoleAfter) {
      console.log('\n🎉 SUCCESSO! BACKEND_ROLE assegnato correttamente a ROG DAO!');
      console.log('\n📝 Prossimi passi:');
      console.log('   1. Aggiorna BACKEND_PRIVATE_KEY nel .env con la chiave di ROG DAO');
      console.log('   2. Aggiorna la stessa variabile su Coolify');
      console.log('   3. Redeploy del backend');
    } else {
      console.log('\n❌ ERRORE: Il ruolo non è stato assegnato correttamente.');
    }

  } catch (error) {
    console.error('\n❌ ERRORE durante l\'esecuzione:');
    console.error(error.message);
    
    if (error.message.includes('insufficient funds')) {
      console.log('\n💡 Soluzione: Il wallet ROG CASSA non ha abbastanza MATIC per pagare il gas.');
      console.log('   Invia almeno 0.1 MATIC a:', wallet.address);
    }
    
    process.exit(1);
  }
}

// Esegui lo script
grantBackendRole()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
