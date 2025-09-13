// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title ReparationsLedger
/// @notice Minimal contract to publish Merkle-root snapshots and verify Merkle proofs
contract ReparationsLedger {
    address public owner;
    uint256 public snapshotCount;

    struct Snapshot {
        bytes32 merkleRoot;
        uint256 timestamp;
        string metadataURI; // optional: IPFS/Arweave/HTTP pointer describing the snapshot
    }

    mapping(uint256 => Snapshot) public snapshots;

    event SnapshotPublished(
        uint256 indexed snapshotId,
        bytes32 indexed merkleRoot,
        uint256 timestamp,
        string metadataURI
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "ReparationsLedger: caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        snapshotCount = 0;
    }

    /// @notice Publish a new snapshot (Merkle root) with optional metadata URI.
    /// @param merkleRoot The Merkle root hash of the snapshot.
    /// @param metadataURI Optional URI describing the snapshot (e.g., IPFS CID).
    /// @return snapshotId The incremental id of the saved snapshot.
    function publishSnapshot(bytes32 merkleRoot, string calldata metadataURI)
        external
        onlyOwner
        returns (uint256 snapshotId)
    {
        snapshotCount++;
        snapshotId = snapshotCount;
        snapshots[snapshotId] = Snapshot({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            metadataURI: metadataURI
        });

        emit SnapshotPublished(snapshotId, merkleRoot, block.timestamp, metadataURI);
    }

    /// @notice Update owner (multisig address recommended in production).
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ReparationsLedger: new owner is the zero address");
        owner = newOwner;
    }

    /// @notice Verify a Merkle proof for a given leaf against a root.
    /// @param root The Merkle root to verify against.
    /// @param leaf The leaf hash (typically keccak256 of the entry).
    /// @param proof An array of sibling hashes from leaf to root.
    /// @return True if proof is valid (leaf included in root) otherwise false.
    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof)
        public
        pure
        returns (bool)
    {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (computed <= sibling) {
                // sort pair to be consistent with off-chain tree ordering
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        return computed == root;
    }

    /// @notice Convenience getter for snapshot root
    function getSnapshotRoot(uint256 snapshotId) external view returns (bytes32) {
        return snapshots[snapshotId].merkleRoot;
    }
}
