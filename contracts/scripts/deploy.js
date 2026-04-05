const { ethers, network } = require("hardhat");

// USDC addresses per network
const USDC_ADDRESSES = {
  "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",         // Base Mainnet (Circle native)
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // Base Sepolia testnet
  "mainnet": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",      // Ethereum Mainnet
  "sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",      // Ethereum Sepolia
  "hardhat": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",      // Use mainnet address for local fork
};

async function main() {
  const networkName = network.name;
  const usdcAddress = USDC_ADDRESSES[networkName];

  if (!usdcAddress) {
    throw new Error(`No USDC address configured for network: ${networkName}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  DEPLOYING ReparationsEscrow`);
  console.log(`  Network: ${networkName} (chain ${network.config.chainId})`);
  console.log(`  USDC:    ${usdcAddress}`);
  console.log(`${"═".repeat(60)}\n`);

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n && networkName !== "hardhat") {
    throw new Error("Deployer has no ETH for gas. Fund the wallet first.");
  }

  // Deploy
  console.log("Deploying ReparationsEscrow...");
  const ReparationsEscrow = await ethers.getContractFactory("ReparationsEscrow");
  const escrow = await ReparationsEscrow.deploy(usdcAddress);
  await escrow.waitForDeployment();

  const contractAddress = await escrow.getAddress();

  console.log(`\n✓ ReparationsEscrow deployed to: ${contractAddress}`);
  console.log(`  Transaction hash: ${escrow.deploymentTransaction().hash}`);

  // Verify the deployer is owner and verifier
  const owner = await escrow.owner();
  const isVerifier = await escrow.verifiers(deployer.address);
  console.log(`  Owner: ${owner}`);
  console.log(`  Deployer is verifier: ${isVerifier}`);

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    chainId: network.config.chainId,
    contractAddress,
    usdcAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    transactionHash: escrow.deploymentTransaction().hash,
    blockNumber: escrow.deploymentTransaction().blockNumber
  };

  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.resolve(__dirname, "../../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const filename = `${networkName}-deployment.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\n  Deployment info saved to: deployments/${filename}`);

  // Also save the ABI for frontend use
  const artifact = require("../../contracts/artifacts/contracts/ReparationsEscrow.sol/ReparationsEscrow.json");
  fs.writeFileSync(
    path.join(deploymentsDir, "ReparationsEscrow-abi.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log(`  ABI saved to: deployments/ReparationsEscrow-abi.json`);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  DEPLOYMENT COMPLETE`);
  console.log(`${"═".repeat(60)}`);
  console.log(`\n  Contract: ${contractAddress}`);
  console.log(`  Network:  ${networkName}`);
  if (networkName === "base") {
    console.log(`  Explorer: https://basescan.org/address/${contractAddress}`);
  } else if (networkName === "base-sepolia") {
    console.log(`  Explorer: https://sepolia.basescan.org/address/${contractAddress}`);
  } else if (networkName === "mainnet") {
    console.log(`  Explorer: https://etherscan.io/address/${contractAddress}`);
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
