// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ReparationsEscrow
 * @dev Enhanced contract for handling reparations payments with escrow, verification, and descendant management
 */
contract ReparationsEscrow is ReentrancyGuard, Ownable, Pausable {
    
    // Supported payment tokens (USDC, DAI, etc.)
    mapping(address => bool) public supportedTokens;
    
    // Default to USDC on mainnet: 0xA0b86a33E6441c8C55e7e39E83C4a14CA8d9D4A6
    address public defaultToken;
    
    struct AncestryRecord {
        string ancestorName;
        string familySearchId;
        bytes32 genealogyHash; // IPFS hash of supporting documents
        uint256 totalReparationsOwed;
        uint256 totalDeposited;
        uint256 totalPaid;
        uint256 historicalPaymentsReceived; // Pre-blockchain settlements (e.g., Belinda Sutton 1783)
        string historicalPaymentsProof; // IPFS hash of historical payment documentation
        bool historicalPaymentsVerified; // Has the historical payment claim been verified
        address submitter;
        uint256 timestamp;
        bool verified;
        string notes;
    }
    
    struct Descendant {
        address walletAddress;
        string familySearchId;
        string fullName;
        bool verified;
        uint256 sharePercentage; // Out of 10000 (100.00%)
        string verificationData; // IPFS hash of verification documents
        uint256 verifiedTimestamp;
    }
    
    struct Payment {
        uint256 recordId;
        address recipient;
        uint256 amount;
        address token;
        uint256 timestamp;
        string transactionType; // "reparation", "interest", "penalty"
    }
    
    // State variables
    uint256 public nextRecordId = 1;
    uint256 public nextPaymentId = 1;
    
    mapping(uint256 => AncestryRecord) public ancestryRecords;
    mapping(uint256 => Descendant[]) public recordDescendants;
    mapping(uint256 => Payment[]) public recordPayments;
    mapping(address => uint256[]) public userSubmissions;
    
    // Verification settings
    mapping(address => bool) public verifiers;
    uint256 public verificationRequirement = 1; // Number of verifiers needed

    // SECURITY: Timelock for emergency withdrawals
    uint256 public constant WITHDRAWAL_DELAY = 7 days;

    struct WithdrawalRequest {
        address token;
        uint256 amount;
        uint256 requestTime;
        bool executed;
    }

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    uint256 public nextWithdrawalId;

    // Events
    event AncestryRecordSubmitted(uint256 indexed recordId, string ancestorName, address submitter);
    event DescendantAdded(uint256 indexed recordId, address descendant, string familySearchId);
    event PaymentDeposited(uint256 indexed recordId, uint256 amount, address token, address depositor);
    event PaymentDistributed(uint256 indexed recordId, address recipient, uint256 amount, address token);
    event RecordVerified(uint256 indexed recordId, address verifier);
    event DescendantVerified(uint256 indexed recordId, address descendant, address verifier);
    event HistoricalPaymentRecorded(uint256 indexed recordId, uint256 amount, string proofIPFSHash);
    event HistoricalPaymentVerified(uint256 indexed recordId, uint256 amount);
    event WithdrawalRequested(uint256 indexed id, address token, uint256 amount, uint256 executeAfter);
    event WithdrawalExecuted(uint256 indexed id);
    event WithdrawalCancelled(uint256 indexed id);
    
    constructor(address _defaultToken) {
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
        verifiers[msg.sender] = true;
    }
    
    modifier onlyVerifier() {
        require(verifiers[msg.sender], "Not authorized verifier");
        _;
    }
    
    /**
     * @dev Submit a new ancestry record for reparations tracking
     */
    function submitAncestryRecord(
        string memory _ancestorName,
        string memory _familySearchId,
        bytes32 _genealogyHash,
        uint256 _totalReparationsOwed,
        string memory _notes
    ) external whenNotPaused returns (uint256) {
        require(bytes(_ancestorName).length > 0, "Ancestor name required");
        require(_totalReparationsOwed > 0, "Reparations amount must be positive");
        
        uint256 recordId = nextRecordId++;
        
        ancestryRecords[recordId] = AncestryRecord({
            ancestorName: _ancestorName,
            familySearchId: _familySearchId,
            genealogyHash: _genealogyHash,
            totalReparationsOwed: _totalReparationsOwed,
            totalDeposited: 0,
            totalPaid: 0,
            historicalPaymentsReceived: 0,
            historicalPaymentsProof: "",
            historicalPaymentsVerified: false,
            submitter: msg.sender,
            timestamp: block.timestamp,
            verified: false,
            notes: _notes
        });
        
        userSubmissions[msg.sender].push(recordId);
        
        emit AncestryRecordSubmitted(recordId, _ancestorName, msg.sender);
        return recordId;
    }
    
    /**
     * @dev Add descendants to an ancestry record
     */
    function addDescendants(
        uint256 _recordId,
        address[] memory _walletAddresses,
        string[] memory _familySearchIds,
        string[] memory _fullNames,
        uint256[] memory _sharePercentages
    ) external {
        require(ancestryRecords[_recordId].submitter == msg.sender || verifiers[msg.sender], "Not authorized");
        require(_walletAddresses.length == _familySearchIds.length, "Array length mismatch");
        require(_familySearchIds.length == _fullNames.length, "Array length mismatch");
        require(_fullNames.length == _sharePercentages.length, "Array length mismatch");
        
        // Verify percentages add up to 10000 (100%)
        uint256 totalPercentage = 0;
        for (uint i = 0; i < _sharePercentages.length; i++) {
            totalPercentage += _sharePercentages[i];
        }
        require(totalPercentage == 10000, "Share percentages must total 100%");
        
        // Clear existing descendants for this record
        delete recordDescendants[_recordId];
        
        // Add new descendants
        for (uint i = 0; i < _walletAddresses.length; i++) {
            recordDescendants[_recordId].push(Descendant({
                walletAddress: _walletAddresses[i],
                familySearchId: _familySearchIds[i],
                fullName: _fullNames[i],
                verified: false,
                sharePercentage: _sharePercentages[i],
                verificationData: "",
                verifiedTimestamp: 0
            }));
            
            emit DescendantAdded(_recordId, _walletAddresses[i], _familySearchIds[i]);
        }
    }
    
    /**
     * @dev Deposit funds for reparations (supports ETH and ERC20 tokens)
     */
    function depositReparations(uint256 _recordId, address _token, uint256 _amount) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(ancestryRecords[_recordId].timestamp > 0, "Record does not exist");
        
        uint256 depositAmount;
        
        if (_token == address(0)) {
            // ETH deposit
            depositAmount = msg.value;
        } else {
            // ERC20 token deposit
            require(supportedTokens[_token], "Token not supported");
            require(msg.value == 0, "Don't send ETH for token deposits");
            require(_amount > 0, "Amount must be positive");
            
            IERC20(_token).transferFrom(msg.sender, address(this), _amount);
            depositAmount = _amount;
        }
        
        ancestryRecords[_recordId].totalDeposited += depositAmount;
        
        emit PaymentDeposited(_recordId, depositAmount, _token, msg.sender);
    }
    
    /**
     * @dev Distribute payments to verified descendants
     * FIXED: Follows Checks-Effects-Interactions pattern
     */
    function distributePayments(uint256 _recordId, address _token, uint256 _amount)
        external
        onlyVerifier
        nonReentrant
        whenNotPaused
    {
        // CHECKS
        require(ancestryRecords[_recordId].verified, "Record not verified");

        Descendant[] storage descendants = recordDescendants[_recordId];
        require(descendants.length > 0, "No descendants registered");

        uint256 availableBalance;
        if (_token == address(0)) {
            availableBalance = address(this).balance;
        } else {
            availableBalance = IERC20(_token).balanceOf(address(this));
        }

        require(availableBalance >= _amount, "Insufficient contract balance");

        // EFFECTS - Update state BEFORE external calls
        uint256 totalDistributed = 0;

        for (uint i = 0; i < descendants.length; i++) {
            if (descendants[i].verified && descendants[i].walletAddress != address(0)) {
                uint256 paymentAmount = (_amount * descendants[i].sharePercentage) / 10000;

                if (paymentAmount > 0) {
                    // Record the payment BEFORE transfer
                    recordPayments[_recordId].push(Payment({
                        recordId: _recordId,
                        recipient: descendants[i].walletAddress,
                        amount: paymentAmount,
                        token: _token,
                        timestamp: block.timestamp,
                        transactionType: "reparation"
                    }));

                    totalDistributed += paymentAmount;
                }
            }
        }

        // Update total paid BEFORE transfers
        ancestryRecords[_recordId].totalPaid += totalDistributed;

        // INTERACTIONS - External calls last
        for (uint i = 0; i < descendants.length; i++) {
            if (descendants[i].verified && descendants[i].walletAddress != address(0)) {
                uint256 paymentAmount = (_amount * descendants[i].sharePercentage) / 10000;

                if (paymentAmount > 0) {
                    if (_token == address(0)) {
                        (bool success, ) = payable(descendants[i].walletAddress).call{value: paymentAmount}("");
                        require(success, "ETH transfer failed");
                    } else {
                        require(IERC20(_token).transfer(descendants[i].walletAddress, paymentAmount), "Token transfer failed");
                    }

                    emit PaymentDistributed(_recordId, descendants[i].walletAddress, paymentAmount, _token);
                }
            }
        }
    }
    
    /**
     * @dev Verify an ancestry record
     */
    function verifyAncestryRecord(uint256 _recordId) external onlyVerifier {
        require(ancestryRecords[_recordId].timestamp > 0, "Record does not exist");
        ancestryRecords[_recordId].verified = true;
        emit RecordVerified(_recordId, msg.sender);
    }
    
    /**
     * @dev Record historical payments received (pre-blockchain settlements)
     * Example: Belinda Sutton received £27 in 1783-1784 ($22,950 modern value)
     */
    function recordHistoricalPayment(
        uint256 _recordId,
        uint256 _amountReceived,
        string memory _proofIPFSHash
    ) external onlyVerifier {
        require(ancestryRecords[_recordId].timestamp > 0, "Record does not exist");
        require(_amountReceived > 0, "Amount must be positive");
        
        ancestryRecords[_recordId].historicalPaymentsReceived = _amountReceived;
        ancestryRecords[_recordId].historicalPaymentsProof = _proofIPFSHash;
        ancestryRecords[_recordId].historicalPaymentsVerified = false; // Requires separate verification
        
        emit HistoricalPaymentRecorded(_recordId, _amountReceived, _proofIPFSHash);
    }
    
    /**
     * @dev Verify historical payment claim after document review
     */
    function verifyHistoricalPayment(uint256 _recordId) external onlyVerifier {
        require(ancestryRecords[_recordId].timestamp > 0, "Record does not exist");
        require(ancestryRecords[_recordId].historicalPaymentsReceived > 0, "No historical payment recorded");
        require(bytes(ancestryRecords[_recordId].historicalPaymentsProof).length > 0, "No proof provided");
        
        ancestryRecords[_recordId].historicalPaymentsVerified = true;
        
        emit HistoricalPaymentVerified(_recordId, ancestryRecords[_recordId].historicalPaymentsReceived);
    }
    
    /**
     * @dev Get net debt owed (total owed - historical payments - blockchain payments)
     */
    function getNetDebtOwed(uint256 _recordId) external view returns (uint256) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        uint256 totalPaid = record.totalPaid + record.historicalPaymentsReceived;
        
        if (totalPaid >= record.totalReparationsOwed) {
            return 0;
        }
        return record.totalReparationsOwed - totalPaid;
    }
    
    /**
     * @dev Check if debt is fully settled (including historical payments)
     */
    function isDebtFullySettled(uint256 _recordId) external view returns (bool) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        uint256 totalPaid = record.totalPaid + record.historicalPaymentsReceived;
        return totalPaid >= record.totalReparationsOwed;
    }
    
    /**
     * @dev Verify a descendant
     */
    function verifyDescendant(uint256 _recordId, address _descendant, string memory _verificationData) 
        external 
        onlyVerifier 
    {
        Descendant[] storage descendants = recordDescendants[_recordId];
        
        for (uint i = 0; i < descendants.length; i++) {
            if (descendants[i].walletAddress == _descendant) {
                descendants[i].verified = true;
                descendants[i].verificationData = _verificationData;
                descendants[i].verifiedTimestamp = block.timestamp;
                
                emit DescendantVerified(_recordId, _descendant, msg.sender);
                return;
            }
        }
        
        revert("Descendant not found");
    }
    
    /**
     * @dev Get descendants for a record
     */
    function getDescendants(uint256 _recordId) external view returns (Descendant[] memory) {
        return recordDescendants[_recordId];
    }
    
    /**
     * @dev Get payments for a record
     */
    function getPayments(uint256 _recordId) external view returns (Payment[] memory) {
        return recordPayments[_recordId];
    }
    
    /**
     * @dev Get user's submitted records
     */
    function getUserSubmissions(address _user) external view returns (uint256[] memory) {
        return userSubmissions[_user];
    }
    
    /**
     * @dev Calculate remaining debt for a record
     */
    function getRemainingDebt(uint256 _recordId) external view returns (uint256) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        if (record.totalPaid >= record.totalReparationsOwed) {
            return 0;
        }
        return record.totalReparationsOwed - record.totalPaid;
    }
    
    /**
     * @dev Check if debt is fully settled
     */
    function isDebtSettled(uint256 _recordId) external view returns (bool) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        return record.totalPaid >= record.totalReparationsOwed;
    }
    
    // Admin functions
    function addVerifier(address _verifier) external onlyOwner {
        verifiers[_verifier] = true;
    }
    
    function removeVerifier(address _verifier) external onlyOwner {
        verifiers[_verifier] = false;
    }
    
    function addSupportedToken(address _token) external onlyOwner {
        supportedTokens[_token] = true;
    }
    
    function removeSupportedToken(address _token) external onlyOwner {
        supportedTokens[_token] = false;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Request emergency withdrawal (requires 7-day waiting period)
     * SECURITY: Timelock protects against malicious withdrawals
     */
    function requestWithdrawal(address _token, uint256 _amount) external onlyOwner returns (uint256) {
        require(_amount > 0, "Amount must be positive");

        uint256 id = nextWithdrawalId++;

        withdrawalRequests[id] = WithdrawalRequest({
            token: _token,
            amount: _amount,
            requestTime: block.timestamp,
            executed: false
        });

        emit WithdrawalRequested(id, _token, _amount, block.timestamp + WITHDRAWAL_DELAY);
        return id;
    }

    /**
     * @dev Execute withdrawal after delay period
     * SECURITY: Can only execute after WITHDRAWAL_DELAY has passed
     */
    function executeWithdrawal(uint256 _id) external onlyOwner {
        WithdrawalRequest storage request = withdrawalRequests[_id];

        require(!request.executed, "Already executed");
        require(block.timestamp >= request.requestTime + WITHDRAWAL_DELAY, "Withdrawal delay not passed");

        request.executed = true;

        if (request.token == address(0)) {
            require(address(this).balance >= request.amount, "Insufficient ETH balance");
            payable(owner()).transfer(request.amount);
        } else {
            require(IERC20(request.token).balanceOf(address(this)) >= request.amount, "Insufficient token balance");
            IERC20(request.token).transfer(owner(), request.amount);
        }

        emit WithdrawalExecuted(_id);
    }

    /**
     * @dev Cancel pending withdrawal request
     */
    function cancelWithdrawal(uint256 _id) external onlyOwner {
        WithdrawalRequest storage request = withdrawalRequests[_id];
        require(!request.executed, "Already executed");

        request.executed = true; // Mark as executed to prevent reuse
        emit WithdrawalCancelled(_id);
    }

    /**
     * @dev Get withdrawal request details
     */
    function getWithdrawalRequest(uint256 _id) external view returns (
        address token,
        uint256 amount,
        uint256 requestTime,
        uint256 executeAfter,
        bool executed
    ) {
        WithdrawalRequest memory request = withdrawalRequests[_id];
        return (
            request.token,
            request.amount,
            request.requestTime,
            request.requestTime + WITHDRAWAL_DELAY,
            request.executed
        );
    }
}
