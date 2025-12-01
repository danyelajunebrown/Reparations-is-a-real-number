const ReparationsEscrow = artifacts.require("ReparationsEscrow");

module.exports = function (deployer) {
  // Deploy with USDC address (use testnet USDC for testing)
  const USDC_GOERLI = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
  deployer.deploy(ReparationsEscrow, USDC_GOERLI);
};
