const ReparationsLedger = artifacts.require("ReparationsLedger");

module.exports = function (deployer) {
  deployer.deploy(ReparationsLedger);
};
