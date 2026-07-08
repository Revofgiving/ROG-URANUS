const { ethers } = require('ethers');

async function checkRole() {
  const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
  
  const abi = [
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ];
  
  const contract = new ethers.Contract(
    "0x0723a5d24afCe5732c9D5C00Ae580934d5664Aa0",
    abi,
    provider
  );
  
  const BACKEND_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BACKEND_ROLE"));
  const rogDaoWallet = ethers.utils.getAddress("0xfe6a02c8f88f002d37fc4e88cb95fe929f1f2f2e");
  
  console.log("Verificando BACKEND_ROLE per ROG DAO wallet...");
  console.log("Role hash:", BACKEND_ROLE);
  console.log("Account:", rogDaoWallet);
  
  const hasRole = await contract.hasRole(BACKEND_ROLE, rogDaoWallet);
  
  console.log("\n✅ Risultato:", hasRole ? "TRUE - Ruolo assegnato!" : "FALSE - Ruolo NON assegnato");
}

checkRole().catch(console.error);
