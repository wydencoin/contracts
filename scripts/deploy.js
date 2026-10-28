// npx hardhat run scripts/deploy.js --network besuLocal
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const wc = await ethers.deployContract("WydenCoin");
  await wc.waitForDeployment();
  console.log("WydenCoin:", await wc.getAddress(), "admin:", deployer.address);

  if (process.env.MINTER_ADDRESS) {
    await (await wc.grantRole(await wc.MINTER_ROLE(), process.env.MINTER_ADDRESS)).wait();
    console.log("MINTER_ROLE concedido a", process.env.MINTER_ADDRESS);
  }
  // Depois do deploy do RedemptionManager: wc.setRedemptionManager(<endereço>)
}

main().catch((e) => { console.error(e); process.exit(1); });
