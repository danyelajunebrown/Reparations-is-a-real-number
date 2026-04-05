require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

// Deployer private key — MUST be set in .env
// Generate with: node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },

  paths: {
    sources: "./contracts/contracts",
    tests: "./contracts/test",
    cache: "./contracts/cache",
    artifacts: "./contracts/artifacts"
  },

  networks: {
    // Local development
    hardhat: {
      chainId: 31337
    },

    // Base Sepolia Testnet
    "base-sepolia": {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: "auto"
    },

    // Base Mainnet
    "base": {
      url: "https://mainnet.base.org",
      chainId: 8453,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: "auto"
    },

    // Ethereum Mainnet (migration path)
    "mainnet": {
      url: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: "auto"
    },

    // Ethereum Sepolia Testnet
    "sepolia": {
      url: "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: "auto"
    }
  },

  // USDC contract addresses per network
  // Referenced by deploy script, not by Hardhat directly
  // Base Mainnet USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  // Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  // Ethereum Mainnet USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || "",
      "base-sepolia": process.env.BASESCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  }
};
