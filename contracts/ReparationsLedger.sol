// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title ReparationsLedger
 * @dev Smart contract for tracking genealogy data and reparations payments
 */
contract ReparationsLedger is Ownable, ReentrancyGuard {
    
    struct AncestryRecord {
        string name;                    // Person's name
        string genealogyDataHash;       // IPFS hash of genealogy documents
        uint256 calculatedReparations;  // Amount owed in wei
        bool verified;                  // Has been verified by authorities
        bool settled;                   // Has debt been paid
        address submitter;              // Who submitted this record
        uint256 submissionTime;         // When it was submitted
        string notes;                   // Additional information
    }
    
    struct PaymentRecord {
        uint256 amount;                 // Amount paid
        address recipient;              // Who received payment
        uint256 timestamp;              // When payment was made
        string transactionHash;         // Reference to payment transaction
    }
    
    // Mapping from record ID to ancestry record
    mapping(bytes32 => AncestryRecord) public ancestryRecords;
    
    // Mapping from record ID to payment history
    mapping(bytes32 => PaymentRecord[]) public paymentHistory;
    
    // Mapping of verified authorities who can approve records
    mapping(address => bool) public verificationAuthorities;
    
    // Events
    event RecordSubmitted(bytes32 indexed recordId, string name, address submitter);
    event RecordVerified(bytes32 indexed recordId, address verifiedBy);
    event PaymentMade(bytes32 indexed recordId, uint256 amount, address recipient);
    event DebtSettled(bytes32 indexed recordId, string name);
    event AuthorityAdded(address authority);
    event AuthorityRemoved(address authority);
    
    constructor() {
        // Contract owner is initial verification authority
        verificationAuthorities[msg.sender] = true;
    }
    
    /**
     * @dev Add a verification authority
     * @param authority Address to add as verification authority
     */
    function addVerificationAuthority(address authority) external onlyOwner {
        verificationAuthorities[authority] = true;
        emit AuthorityAdded(authority);
    }
    
    /**
     * @dev Remove a verification authority
     * @param authority Address to remove as verification authority
     */
    function removeVerificationAuthority(address authority) external onlyOwner {
        verificationAuthorities[authority] = false;
        emit AuthorityRemoved(authority);
    }
    
    /**
     * @dev Submit a new ancestry record for verification
     * @param name Name of the ancestor
     * @param genealogyDataHash IPFS hash of supporting documents
     * @param calculatedReparations Amount of reparations calculated
     * @param notes Additional notes or context
     */
    function submitAncestryRecord(
        string memory name,
        string memory genealogyDataHash,
        uint256 calculatedReparations,
        string memory notes
    ) external returns (bytes32) {
        // Create unique ID for this record
        bytes32 recordId = keccak256(abi.encodePacked(
            name,
            genealogyDataHash,
            msg.sender,
            block.timestamp
        ));
        
        // Ensure record doesn't already exist
        require(ancestryRecords[recordId].submitter == address(0), "Record already exists");
        
        // Create the record
        ancestryRecords[recordId] = AncestryRecord({
            name: name,
            genealogyDataHash: genealogyDataHash,
            calculatedReparations: calculatedReparations,
            verified: false,
            settled: false,
            submitter: msg.sender,
            submissionTime: block.timestamp,
            notes: notes
        });
        
        emit RecordSubmitted(recordId, name, msg.sender);
        return recordId;
    }
    
    /**
     * @dev Verify an ancestry record
     * @param recordId ID of the record to verify
     */
    function verifyRecord(bytes32 recordId) external {
        require(verificationAuthorities[msg.sender], "Not authorized to verify");
        require(ancestryRecords[recordId].submitter != address(0), "Record does not exist");
        require(!ancestryRecords[recordId].verified, "Record already verified");
        
        ancestryRecords[recordId].verified = true;
        emit RecordVerified(recordId, msg.sender);
    }
    
    /**
     * @dev Record a reparations payment
     * @param recordId ID of the ancestry record
     * @param recipient Address of payment recipient
     * @param transactionHash Reference to the actual payment transaction
     */
    function recordPayment(
        bytes32 recordId,
        address recipient,
        string memory transactionHash
    ) external payable nonReentrant {
        require(ancestryRecords[recordId].submitter != address(0), "Record does not exist");
        require(ancestryRecords[recordId].verified, "Record not verified");
        require(!ancestryRecords[recordId].settled, "Debt already settled");
        require(msg.value > 0, "Payment amount must be greater than 0");
        
        // Record the payment
        paymentHistory[recordId].push(PaymentRecord({
            amount: msg.value,
            recipient: recipient,
            timestamp: block.timestamp,
            transactionHash: transactionHash
        }));
        
        // Check if total payments cover the calculated reparations
        uint256 totalPaid = getTotalPaid(recordId);
        if (totalPaid >= ancestryRecords[recordId].calculatedReparations) {
            ancestryRecords[recordId].settled = true;
            emit DebtSettled(recordId, ancestryRecords[recordId].name);
        }
        
        emit PaymentMade(recordId, msg.value, recipient);
        
        // Transfer payment to recipient
        payable(recipient).transfer(msg.value);
    }
    
    /**
     * @dev Get total amount paid for a record
     * @param recordId ID of the ancestry record
     */
    function getTotalPaid(bytes32 recordId) public view returns (uint256) {
        uint256 total = 0;
        PaymentRecord[] memory payments = paymentHistory[recordId];
        for (uint256 i = 0; i < payments.length; i++) {
            total += payments[i].amount;
        }
        return total;
    }
    
    /**
     * @dev Get payment history for a record
     * @param recordId ID of the ancestry record
     */
    function getPaymentHistory(bytes32 recordId) external view returns (PaymentRecord[] memory) {
        return paymentHistory[recordId];
    }
    
    /**
     * @dev Check if a debt is settled
     * @param recordId ID of the ancestry record
     */
    function isDebtSettled(bytes32 recordId) external view returns (bool) {
        return ancestryRecords[recordId].settled;
    }
    
    /**
     * @dev Get remaining debt amount
     * @param recordId ID of the ancestry record
     */
    function getRemainingDebt(bytes32 recordId) external view returns (uint256) {
        if (ancestryRecords[recordId].settled) {
            return 0;
        }
        
        uint256 totalPaid = getTotalPaid(recordId);
        uint256 totalOwed = ancestryRecords[recordId].calculatedReparations;
        
        if (totalPaid >= totalOwed) {
            return 0;
        }
        
        return totalOwed - totalPaid;
    }
}
