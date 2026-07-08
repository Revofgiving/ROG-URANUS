const { ethers } = require('ethers');

async function verifyGrantedRole() {
  const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
  
  const txHash = "0xc21bec1504988b7261ab85ad7b7d60201b51a749298ca9de5eef102c7e0aca39";
  
  console.log("Leggendo transaction receipt...\n");
  const receipt = await provider.getTransactionReceipt(txHash);
  
  // Event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)
  const roleGrantedTopic = ethers.utils.id("RoleGranted(bytes32,address,address)");
  
  const roleGrantedLog = receipt.logs.find(log => log.topics[0] === roleGrantedTopic);
  
  if (roleGrantedLog) {
    const role = roleGrantedLog.topics[1];
    const account = ethers.utils.getAddress('0x' + roleGrantedLog.topics[2].slice(26));
    
    console.log("✅ RoleGranted event trovato:");
    console.log("   Role hash:", role);
    console.log("   Account:  ", account);
    
    // Ora verifichiamo se questo account ha questo ruolo
    const abi = ["function hasRole(bytes32 role, address account) view returns (bool)"];
    const contract = new ethers.Contract(
      "0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0",
      abi,
      provider
    );
    
    const hasRole = await contract.hasRole(role, account);
    console.log("\n✅ Verifica on-chain:");
    console.log("   hasRole(", role, ",", account, ") =", hasRole);
  } else {
    console.log("❌ Nessun RoleGranted event trovato nella transazione");
  }
}

verifyGrantedRole().catch(console.error);
