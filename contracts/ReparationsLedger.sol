// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ReparationsLedger {
    // --- MERKLE VERIFICATION ---
    bytes32 public merkleRoot;

    // Owner-only control (for now, just the deployer)
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    // Set the Merkle root (from off-chain computation)
    function setMerkleRoot(bytes32 _root) public onlyOwner {
        merkleRoot = _root;
    }

    // Verify proof of inclusion for a leaf
    function verifyProof(bytes32 leaf, bytes32[] memory proof) public view returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == merkleRoot;
    }

    // --- ORIGINAL LEDGER ENTRIES ---
    struct Entry {
        string description;
        uint256 value;
        address addedBy;
    }

    Entry[] public entries;

    function addReparationsEntry(string memory _desc, uint256 _val) public {
        entries.push(Entry(_desc, _val, msg.sender));
    }

    function getEntriesCount() public view returns (uint256) {
        return entries.length;
    }
}
