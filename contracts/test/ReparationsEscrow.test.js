const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReparationsEscrow", function () {
  let escrow, owner, verifier, participant, descendant;
  let mockUSDC;

  beforeEach(async function () {
    [owner, verifier, participant, descendant] = await ethers.getSigners();

    // Deploy a mock ERC20 for USDC
    const MockToken = await ethers.getContractFactory("Migrations"); // Use any simple contract
    // Actually let's just use address(0) for ETH-only tests

    const ReparationsEscrow = await ethers.getContractFactory("ReparationsEscrow");
    // Use a dummy address for USDC in tests
    escrow = await ReparationsEscrow.deploy(ethers.ZeroAddress);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set deployer as owner", async function () {
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("should set deployer as verifier", async function () {
      expect(await escrow.verifiers(owner.address)).to.be.true;
    });
  });

  describe("Ancestry Records", function () {
    it("should submit an ancestry record", async function () {
      const tx = await escrow.connect(participant).submitAncestryRecord(
        "John Smith",
        "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("genealogy-doc-hash")),
        ethers.parseEther("1000"), // 1000 USDC equivalent
        "Test DAA record"
      );

      await tx.wait();
      const record = await escrow.ancestryRecords(1);
      expect(record.ancestorName).to.equal("John Smith");
      expect(record.familySearchId).to.equal("LTVZ-D9S");
      expect(record.submitter).to.equal(participant.address);
      expect(record.verified).to.be.false;
    });

    it("should verify an ancestry record", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      await escrow.connect(owner).verifyAncestryRecord(1);
      const record = await escrow.ancestryRecords(1);
      expect(record.verified).to.be.true;
    });

    it("should reject verification from non-verifier", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      await expect(
        escrow.connect(participant).verifyAncestryRecord(1)
      ).to.be.revertedWith("Not authorized verifier");
    });
  });

  describe("Revisable DAA Amounts", function () {
    it("should update reparations owed", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Initial DAA"
      );

      // Methodology matures, amount changes
      await escrow.connect(owner).updateReparationsOwed(
        1,
        ethers.parseEther("1500"),
        "Updated per Craemer (2015) methodology revision"
      );

      const record = await escrow.ancestryRecords(1);
      expect(record.totalReparationsOwed).to.equal(ethers.parseEther("1500"));
    });

    it("should emit event with old and new amounts", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      await expect(
        escrow.connect(owner).updateReparationsOwed(
          1, ethers.parseEther("2000"), "Research update"
        )
      ).to.emit(escrow, "ReparationsAmountUpdated")
        .withArgs(1, ethers.parseEther("1000"), ethers.parseEther("2000"), "Research update");
    });

    it("should reject update from non-verifier", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      await expect(
        escrow.connect(participant).updateReparationsOwed(
          1, ethers.parseEther("2000"), "Unauthorized"
        )
      ).to.be.revertedWith("Not authorized verifier");
    });
  });

  describe("ETH Deposits", function () {
    it("should accept ETH deposits", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      await escrow.connect(participant).depositReparations(
        1, ethers.ZeroAddress, 0,
        { value: ethers.parseEther("1.0") }
      );

      const record = await escrow.ancestryRecords(1);
      expect(record.totalDeposited).to.equal(ethers.parseEther("1.0"));
    });
  });

  describe("Debt Tracking", function () {
    it("should calculate remaining debt correctly", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      const remaining = await escrow.getRemainingDebt(1);
      expect(remaining).to.equal(ethers.parseEther("1000"));

      const settled = await escrow.isDebtSettled(1);
      expect(settled).to.be.false;
    });

    it("should track net debt including historical payments", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "John Smith", "LTVZ-D9S",
        ethers.keccak256(ethers.toUtf8Bytes("hash")),
        ethers.parseEther("1000"), "Test"
      );

      // Record historical payment (e.g., Belinda Sutton model)
      await escrow.connect(owner).recordHistoricalPayment(
        1, ethers.parseEther("100"), "ipfs://proof-hash"
      );

      const netDebt = await escrow.getNetDebtOwed(1);
      expect(netDebt).to.equal(ethers.parseEther("900"));
    });
  });

  describe("View Functions", function () {
    it("should return full record details", async function () {
      await escrow.connect(participant).submitAncestryRecord(
        "Angelica Chesley", "P4RF-PFQ",
        ethers.keccak256(ethers.toUtf8Bytes("genealogy")),
        ethers.parseEther("5000"), "Adrian Brown DAA"
      );

      const record = await escrow.getRecord(1);
      expect(record.ancestorName).to.equal("Angelica Chesley");
      expect(record.familySearchId).to.equal("P4RF-PFQ");
      expect(record.totalReparationsOwed).to.equal(ethers.parseEther("5000"));
      expect(record.submitter).to.equal(participant.address);
    });
  });
});
