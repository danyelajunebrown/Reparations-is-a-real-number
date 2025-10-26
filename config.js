// config.js
// Loads environment variables from .env file
require('dotenv').config();

module.exports = {
    // Google Cloud Vision API
    googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY,
    
    // Database configuration
    database: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'reparations',
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
    },
    
    // Storage configuration
    storage: {
        root: process.env.STORAGE_ROOT || './storage'
    },
    
    // Server configuration
    server: {
        port: parseInt(process.env.PORT) || 3000,
        host: process.env.HOST || 'localhost'
    },
    
    // IPFS configuration (optional)
    ipfs: {
        enabled: process.env.IPFS_ENABLED === 'true',
        gateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
        apiUrl: process.env.IPFS_API_URL
    },
    
    // Blockchain configuration
    blockchain: {
        networkId: parseInt(process.env.BLOCKCHAIN_NETWORK_ID) || 5,
        contractAddress: process.env.CONTRACT_ADDRESS,
        rpcUrl: process.env.BLOCKCHAIN_RPC_URL
    }
};
