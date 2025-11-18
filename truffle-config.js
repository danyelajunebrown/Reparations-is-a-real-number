module.exports = {
  // Networks define how you connect to your ethereum client and let you set the
  // defaults web3 uses to send transactions. If you don't specify one truffle
  // will spin up a development blockchain for you on port 9545 when you
  // run `develop` or `test`. You can ask a truffle command to use a specific
  // network from the command line, e.g
  //
  // $ truffle test --network <network-name>

  networks: {
    // Local development network (Ganache)
    development: {
      host: "127.0.0.1",     // Localhost (default: none)
      port: 8545,            // Standard Ethereum port (default: none)
      network_id: "*",       // Any network (default: none)
      gas: 6721975,          // Gas limit
      gasPrice: 20000000000, // 20 gwei (default: 100 gwei)
    },

    // Ganache CLI
    ganache: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "5777", // Ganache default
      gas: 6721975,
      gasPrice: 20000000000,
    },

    // Uncomment for testnets (when ready to deploy)
    // goerli: {
    //   provider: () => new HDWalletProvider(mnemonic, `https://goerli.infura.io/v3/YOUR-PROJECT-ID`),
    //   network_id: 5,       // Goerli's id
    //   gas: 5500000,        // Goerli has a lower block limit than mainnet
    //   confirmations: 2,    // # of confs to wait between deployments. (default: 0)
    //   timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
    //   skipDryRun: true     // Skip dry run before migrations? (default: false for public nets )
    // },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    timeout: 100000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.8.19",    // Fetch exact version from solc-bin (default: truffle's version)
      settings: {          // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "byzantium"
      }
    }
  }
};
