// npx hardhat run scripts/deploy.js --network localhost
// npx hardhat run scripts/deploy.js --network besuLocal
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Iniciando deploy com a conta:", deployer.address);

  // 1. Deploy do WydenCoin
  console.log("-> Fazendo deploy do WydenCoin...");
  const wc = await ethers.deployContract("WydenCoin");
  await wc.waitForDeployment();
  const wcAddress = await wc.getAddress();
  console.log(`[+] WydenCoin (WC) publicado em: ${wcAddress}`);

  // 2. Deploy do RedemptionManager
  console.log("-> Fazendo deploy do RedemptionManager...");
  const rm = await ethers.deployContract("RedemptionManager", [wcAddress]);
  await rm.waitForDeployment();
  const rmAddress = await rm.getAddress();
  console.log(`[+] RedemptionManager publicado em: ${rmAddress}`);

  // 3. Vincular RedemptionManager no WydenCoin
  console.log("-> Autorizando RedemptionManager no WydenCoin...");
  const txLink = await wc.setRedemptionManager(rmAddress);
  await txLink.wait();
  console.log("[OK] RedemptionManager autorizado com sucesso.");

  // 4. Configurar MINTER_ROLE
  const minterTarget = process.env.MINTER_ADDRESS || deployer.address;
  const minterRole = await wc.MINTER_ROLE();
  if (!(await wc.hasRole(minterRole, minterTarget))) {
    const txMinter = await wc.grantRole(minterRole, minterTarget);
    await txMinter.wait();
    console.log(`[OK] MINTER_ROLE concedida a ${minterTarget}`);
  }

  // 5. Configurar CONFIRMER_ROLE e MANAGER_ROLE
  const confirmerTarget = process.env.CONFIRMER_ADDRESS || deployer.address;
  const managerTarget = process.env.MANAGER_ADDRESS || deployer.address;
  const confirmerRole = await rm.CONFIRMER_ROLE();
  const managerRole = await rm.MANAGER_ROLE();

  if (!(await rm.hasRole(confirmerRole, confirmerTarget))) {
    const txConfirmer = await rm.grantRole(confirmerRole, confirmerTarget);
    await txConfirmer.wait();
    console.log(`[OK] CONFIRMER_ROLE concedida a ${confirmerTarget}`);
  }

  if (!(await rm.hasRole(managerRole, managerTarget))) {
    const txManager = await rm.grantRole(managerRole, managerTarget);
    await txManager.wait();
    console.log(`[OK] MANAGER_ROLE concedida a ${managerTarget}`);
  }

  // 6. Exportar endereços para addresses.json
  const deployedAddresses = {
    WydenCoin: wcAddress,
    RedemptionManager: rmAddress,
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    updatedAt: new Date().toISOString()
  };

  const outputPath = path.join(__dirname, "..", "addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployedAddresses, null, 2));
  console.log(`[OK] Endereços gravados em: ${outputPath}`);
  console.log("\nDeploy finalizado com sucesso!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
