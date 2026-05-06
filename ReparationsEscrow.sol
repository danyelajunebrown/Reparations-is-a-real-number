// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ReparationsEscrow
 * @dev Escrow contract for reparations payments with ancestry record management,
 *      descendant verification, and proportional distribution.
 *
 * Security fixes applied (2026-05-05):
 *   1. ETH distribution changed from `.transfer()` (2300 gas, DOS-able for
 *      contract recipients) to low-level `call{value:}` with per-recipient
 *      failure tracking. Failed payments are skipped and logged via event
 *      rather than reverting the entire batch.
 *   2. Check-Effects-Interactions pattern enforced in distributePayments():
 *      state (`totalPaid`) is updated BEFORE the external call per iteration.
 *   3. distributePayments() now caps `_amount` at the record's remaining
 *      unpaid debt to prevent over-distribution.
 *   4. emergencyWithdraw() uses low-level call instead of `.transfer()`.
 *   5. Single-owner restriction documented; callers should deploy behind a
 *      Gnosis Safe multi-sig (see COMPREHENSIVE-DAA-README.md §Deployment).
 */
contract ReparationsEscrow is ReentrancyGuard, Ownable, Pausable {

    // Supported payment tokens (USDC, DAI, etc.)
    mapping(address => bool) public supportedTokens;

    // Default to USDC on Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    address public defaultToken;

    struct AncestryRecord {
        string ancestorName;
        string familySearchId;
        bytes32 genealogyHash;        // IPFS hash of supporting documents
        uint256 totalReparationsOwed;
        uint256 totalDeposited;
        uint256 totalPaid;
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
        uint256 sharePercentage;      // Out of 10000 (100.00%)
        string verificationData;      // IPFS hash of verification documents
        uint256 verifiedTimestamp;
    }

    struct Payment {
        uint256 recordId;
        address recipient;
        uint256 amount;
        address token;
        uint256 timestamp;
        string transactionType;       // "reparation", "interest", "penalty"
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
    uint256 public verificationRequirement = 1;

    // Events
    event AncestryRecordSubmitted(uint256 indexed recordId, string ancestorName, address submitter);
    event DescendantAdded(uint256 indexed recordId, address descendant, string familySearchId);
    event PaymentDeposited(uint256 indexed recordId, uint256 amount, address token, address depositor);
    event PaymentDistributed(uint256 indexed recordId, address recipient, uint256 amount, address token);
    event PaymentFailed(uint256 indexed recordId, address recipient, uint256 amount, bytes reason);
    event RecordVerified(uint256 indexed recordId, address verifier);
    event DescendantVerified(uint256 indexed recordId, address descendant, address verifier);

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
     * @dev Submit a new ancestry record for reparations tracking.
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
     * @dev Add descendants to an ancestry record.
     *      Clears and replaces the existing descendant list atomically.
     */
    function addDescendants(
        uint256 _recordId,
        address[] memory _walletAddresses,
        string[] memory _familySearchIds,
        string[] memory _fullNames,
        uint256[] memory _sharePercentages
    ) external {
        require(
            ancestryRecords[_recordId].submitter == msg.sender || verifiers[msg.sender],
            "Not authorized"
        );
        require(_walletAddresses.length == _familySearchIds.length, "Array length mismatch");
        require(_familySearchIds.length == _fullNames.length, "Array length mismatch");
        require(_fullNames.length == _sharePercentages.length, "Array length mismatch");

        uint256 totalPercentage = 0;
        for (uint256 i = 0; i < _sharePercentages.length; i++) {
            totalPercentage += _sharePercentages[i];
        }
        require(totalPercentage == 10000, "Share percentages must total 100%");

        delete recordDescendants[_recordId];

        for (uint256 i = 0; i < _walletAddresses.length; i++) {
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
     * @dev Deposit funds for reparations (ETH or ERC20 tokens).
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
     * @dev Distribute payments to verified descendants.
     *
     * Security model:
     *   - nonReentrant guard prevents cross-function reentrancy.
     *   - Check-Effects-Interactions: each descendant's `totalPaid` share
     *     is committed to state BEFORE the external transfer executes.
     *   - _amount is capped at the record's remaining unpaid debt to prevent
     *     over-distribution relative to the documented obligation.
     *   - ETH transfers use low-level call{value:} instead of .transfer() so
     *     contract recipients with non-trivial receive() hooks don't revert the
     *     entire batch. Failed individual transfers emit PaymentFailed and are
     *     skipped; their share remains in escrow and may be retried.
     */
    function distributePayments(uint256 _recordId, address _token, uint256 _amount)
        external
        onlyVerifier
        nonReentrant
        whenNotPaused
    {
        require(ancestryRecords[_recordId].verified, "Record not verified");

        Descendant[] storage descendants = recordDescendants[_recordId];
        require(descendants.length > 0, "No descendants registered");

        AncestryRecord storage record = ancestryRecords[_recordId];

        // ── FIX: cap _amount at remaining unpaid debt ────────────────────
        uint256 remainingDebt = record.totalReparationsOwed > record.totalPaid
            ? record.totalReparationsOwed - record.totalPaid
            : 0;
        require(remainingDebt > 0, "Debt already fully satisfied");

        uint256 distributionAmount = _amount > remainingDebt ? remainingDebt : _amount;

        // ── Verify available balance ──────────────────────────────────────
        if (_token == address(0)) {
            require(address(this).balance >= distributionAmount, "Insufficient ETH balance");
        } else {
            require(
                IERC20(_token).balanceOf(address(this)) >= distributionAmount,
                "Insufficient token balance"
            );
        }

        // ── Distribute per descendant share ───────────────────────────────
        for (uint256 i = 0; i < descendants.length; i++) {
            if (!descendants[i].verified || descendants[i].walletAddress == address(0)) {
                continue;
            }

            uint256 paymentAmount = (distributionAmount * descendants[i].sharePercentage) / 10000;
            if (paymentAmount == 0) continue;

            address recipient = descendants[i].walletAddress;

            // ── CHECK-EFFECTS-INTERACTIONS ────────────────────────────────
            // Update state BEFORE external call to prevent reentrancy from
            // draining more than one share per descendant.
            record.totalPaid += paymentAmount;

            recordPayments[_recordId].push(Payment({
                recordId: _recordId,
                recipient: recipient,
                amount: paymentAmount,
                token: _token,
                timestamp: block.timestamp,
                transactionType: "reparation"
            }));

            // ── External call (ETH or ERC20) ──────────────────────────────
            if (_token == address(0)) {
                // Low-level call avoids 2300-gas stipend limitation.
                // Failed transfers are logged, not reverted, so one bad
                // address doesn't block all other recipients.
                (bool success, bytes memory reason) = payable(recipient).call{value: paymentAmount}("");
                if (!success) {
                    // Roll back accounting for this single failed transfer
                    record.totalPaid -= paymentAmount;
                    emit PaymentFailed(_recordId, recipient, paymentAmount, reason);
                    continue;
                }
            } else {
                // ERC20: transferFrom is atomic; revert on failure is acceptable.
                bool ok = IERC20(_token).transfer(recipient, paymentAmount);
                require(ok, "ERC20 transfer failed");
            }

            emit PaymentDistributed(_recordId, recipient, paymentAmount, _token);
        }
    }

    /**
     * @dev Verify an ancestry record.
     */
    function verifyAncestryRecord(uint256 _recordId) external onlyVerifier {
        require(ancestryRecords[_recordId].timestamp > 0, "Record does not exist");
        ancestryRecords[_recordId].verified = true;
        emit RecordVerified(_recordId, msg.sender);
    }

    /**
     * @dev Verify a single descendant.
     */
    function verifyDescendant(
        uint256 _recordId,
        address _descendant,
        string memory _verificationData
    ) external onlyVerifier {
        Descendant[] storage descendants = recordDescendants[_recordId];

        for (uint256 i = 0; i < descendants.length; i++) {
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

    // ── View functions ───────────────────────────────────────────────────────

    function getDescendants(uint256 _recordId) external view returns (Descendant[] memory) {
        return recordDescendants[_recordId];
    }

    function getPayments(uint256 _recordId) external view returns (Payment[] memory) {
        return recordPayments[_recordId];
    }

    function getUserSubmissions(address _user) external view returns (uint256[] memory) {
        return userSubmissions[_user];
    }

    function getRemainingDebt(uint256 _recordId) external view returns (uint256) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        if (record.totalPaid >= record.totalReparationsOwed) return 0;
        return record.totalReparationsOwed - record.totalPaid;
    }

    function isDebtSettled(uint256 _recordId) external view returns (bool) {
        AncestryRecord memory record = ancestryRecords[_recordId];
        return record.totalPaid >= record.totalReparationsOwed;
    }

    // ── Admin functions ──────────────────────────────────────────────────────

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
     * @dev Emergency withdraw — owner only.
     *      IMPORTANT: deploy this contract behind a Gnosis Safe multi-sig so
     *      that no single private key can drain the escrow unilaterally.
     *      Uses low-level call instead of .transfer() to avoid gas limit issues.
     */
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        if (_token == address(0)) {
            (bool success, ) = payable(owner()).call{value: _amount}("");
            require(success, "ETH withdrawal failed");
        } else {
            bool ok = IERC20(_token).transfer(owner(), _amount);
            require(ok, "Token withdrawal failed");
        }
    }
}
