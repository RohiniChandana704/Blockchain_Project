// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReturnManagement
 * @author Student Project
 * @notice Blockchain-based Digital Product Return Management System.
 *         Coordinates product registration, return requests, physical item transit/inspection,
 *         and an automated escrow-based refund mechanism.
 * @dev Implements a three-module architecture in a single contract:
 *      1. ProductRegistry: Tracks authentic retail purchases between seller and customer.
 *      2. ReturnRequest: Manages multi-role state progression of return lifecycles.
 *      3. RefundEscrow: Holds refund funds securely and executes re-entrancy-safe payouts.
 */
contract ReturnManagement {
    // ============================================================================
    // DATA STRUCTURES & ENUMS
    // ============================================================================

    /**
     * @notice Return lifecycle status enumeration.
     * @dev Flow:
     *      Submitted -> UnderReview -> Approved (or Rejected) -> PickedUp ->
     *      InTransit -> Received -> Inspected -> Accepted (or Disputed) ->
     *      Refunded (or Rejected via dispute resolution).
     */
    enum Status {
        None,         // 0: Default uninitialized state
        Submitted,    // 1: Customer submitted return request with proof hash
        UnderReview,  // 2: Seller initiated review
        Approved,     // 3: Seller approved return and locked refund in escrow
        Rejected,     // 4: Seller rejected return or dispute settled against customer
        PickedUp,     // 5: Logistics partner confirmed item pickup from customer
        InTransit,    // 6: Tracking oracle updated shipment to en route
        Received,     // 7: Tracking oracle confirmed arrival at inspection center
        Inspected,    // 8: Quality inspector verified condition
        Disputed,     // 9: Condition failed/mismatched, awaiting admin arbitration
        Accepted,     // 10: Condition verified OK or dispute resolved in customer favor
        Refunded      // 11: Escrow released refund back to customer wallet
    }

    /**
     * @notice Structure representing an original verified retail purchase.
     */
    struct Purchase {
        uint256 orderId;
        address customer;
        address seller;
        uint256 amount;
        uint256 purchasedAt;
        bool exists;
    }

    /**
     * @notice Structure representing an individual return request.
     */
    struct ReturnRequest {
        uint256 returnId;
        uint256 orderId;
        address customer;
        address seller;
        string reason;
        bytes32 proofHash;
        uint256 refundAmount;
        bool conditionOk;
        Status status;
        uint256 createdAt;
    }

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================

    /// @notice System administrator who can manage roles and resolve disputes.
    address public admin;

    /// @dev Auto-incrementing identifier counter for returns.
    uint256 private nextReturnId = 1;

    /// @dev Reentrancy lock flag.
    bool private locked;

    // Role mappings
    mapping(address => bool) public registeredSellers;
    mapping(address => bool) public logisticsPartners;
    mapping(address => bool) public inspectors;
    mapping(address => bool) public oracles;

    // Registry & storage mappings
    mapping(uint256 => Purchase) public purchases;
    mapping(uint256 => ReturnRequest) public returnsById;
    mapping(uint256 => uint256) public escrowBalance;
    mapping(uint256 => Status[]) internal statusHistory;
    mapping(uint256 => bool) public orderHasReturn;

    /// @dev List of all return IDs for enumeration in the UI and scripts.
    uint256[] private allReturnIds;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event ParticipantAdded(string role, address indexed account);
    event PurchaseRegistered(uint256 indexed orderId, address indexed customer, address indexed seller, uint256 amount);
    event ReturnRaised(uint256 indexed returnId, uint256 indexed orderId, address indexed customer, string reason, bytes32 proofHash);
    event ReturnUnderReview(uint256 indexed returnId, address indexed seller);
    event ReturnApproved(uint256 indexed returnId, address indexed seller, uint256 escrowAmount);
    event ReturnRejected(uint256 indexed returnId, address indexed seller);
    event PickedUp(uint256 indexed returnId, address indexed logistics);
    event ShipmentUpdated(uint256 indexed returnId, Status status, address indexed oracle);
    event ReturnInspected(uint256 indexed returnId, bool conditionOk, address indexed inspector);
    event RefundReleased(uint256 indexed returnId, address indexed customer, uint256 amount);
    event DisputeResolved(uint256 indexed returnId, bool favourCustomer, address indexed recipient, uint256 amount);
    event StatusChanged(uint256 indexed returnId, Status status);

    // ============================================================================
    // MODIFIERS
    // ============================================================================

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlySeller(uint256 returnId) {
        require(returnsById[returnId].seller == msg.sender, "Not the seller");
        _;
    }

    modifier inState(uint256 returnId, Status expected) {
        require(returnsById[returnId].status == expected, "Invalid state");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /**
     * @notice Initializes the contract and sets the deployer as the admin.
     */
    constructor() {
        admin = msg.sender;
    }

    // ============================================================================
    // PARTICIPANT ROLE MANAGEMENT (Admin Only)
    // ============================================================================

    /**
     * @notice Grants the seller role to an address.
     * @param a The address of the seller.
     */
    function addSeller(address a) external onlyAdmin {
        require(a != address(0), "Invalid address");
        registeredSellers[a] = true;
        emit ParticipantAdded("Seller", a);
    }

    /**
     * @notice Grants the logistics partner role to an address.
     * @param a The address of the logistics partner.
     */
    function addLogistics(address a) external onlyAdmin {
        require(a != address(0), "Invalid address");
        logisticsPartners[a] = true;
        emit ParticipantAdded("Logistics", a);
    }

    /**
     * @notice Grants the inspector role to an address.
     * @param a The address of the inspector.
     */
    function addInspector(address a) external onlyAdmin {
        require(a != address(0), "Invalid address");
        inspectors[a] = true;
        emit ParticipantAdded("Inspector", a);
    }

    /**
     * @notice Grants the oracle role to an address.
     * @param a The address of the oracle agent.
     */
    function addOracle(address a) external onlyAdmin {
        require(a != address(0), "Invalid address");
        oracles[a] = true;
        emit ParticipantAdded("Oracle", a);
    }

    // ============================================================================
    // PRODUCT REGISTRY
    // ============================================================================

    /**
     * @notice Registers an initial retail purchase on-chain.
     * @param orderId Unique order identification number.
     * @param customer Address of the purchasing customer.
     * @param amount Original purchase and potential refund amount in wei.
     */
    function registerPurchase(uint256 orderId, address customer, uint256 amount) external {
        require(registeredSellers[msg.sender], "Not a registered seller");
        require(orderId > 0, "Invalid order ID");
        require(!purchases[orderId].exists, "Order already registered");
        require(customer != address(0), "Invalid customer");
        require(amount > 0, "Amount must be greater than zero");

        purchases[orderId] = Purchase({
            orderId: orderId,
            customer: customer,
            seller: msg.sender,
            amount: amount,
            purchasedAt: block.timestamp,
            exists: true
        });

        emit PurchaseRegistered(orderId, customer, msg.sender, amount);
    }

    /**
     * @notice Verifies if a purchase order exists and belongs to the given customer.
     * @param orderId The order ID to check.
     * @param customer The customer address to verify against.
     * @return bool True if order exists and belongs to customer, false otherwise.
     */
    function verifyPurchase(uint256 orderId, address customer) public view returns (bool) {
        Purchase storage p = purchases[orderId];
        return p.exists && p.customer == customer;
    }

    // ============================================================================
    // RETURN REQUEST LIFECYCLE
    // ============================================================================

    /**
     * @notice Allows a customer to initiate a return request for a verified purchase.
     * @param orderId The original purchase order ID.
     * @param reason Textual reason for returning the product.
     * @param proofHash Cryptographic hash (e.g. SHA-256 / Keccak-256) of uploaded proof evidence.
     * @return uint256 The generated returnId.
     */
    function raiseReturn(uint256 orderId, string memory reason, bytes32 proofHash) external returns (uint256) {
        require(verifyPurchase(orderId, msg.sender), "Purchase not verified");
        require(!orderHasReturn[orderId], "Return already raised for this order");
        require(proofHash != bytes32(0), "Proof hash required");
        require(bytes(reason).length > 0, "Reason required");

        uint256 id = nextReturnId++;
        Purchase storage p = purchases[orderId];
        orderHasReturn[orderId] = true;

        returnsById[id] = ReturnRequest({
            returnId: id,
            orderId: orderId,
            customer: msg.sender,
            seller: p.seller,
            reason: reason,
            proofHash: proofHash,
            refundAmount: p.amount,
            conditionOk: false,
            status: Status.Submitted,
            createdAt: block.timestamp
        });

        allReturnIds.push(id);
        statusHistory[id].push(Status.Submitted);

        emit ReturnRaised(id, orderId, msg.sender, reason, proofHash);
        emit StatusChanged(id, Status.Submitted);

        return id;
    }

    /**
     * @notice Seller acknowledges and begins review of the submitted return request.
     * @param id The return ID.
     */
    function reviewReturn(uint256 id) external onlySeller(id) inState(id, Status.Submitted) {
        _setStatus(id, Status.UnderReview);
        emit ReturnUnderReview(id, msg.sender);
    }

    /**
     * @notice Seller approves the return request and deposits the exact refund amount into escrow.
     * @param id The return ID.
     */
    function approveReturn(uint256 id) external payable onlySeller(id) inState(id, Status.UnderReview) {
        require(msg.value == returnsById[id].refundAmount, "Escrow must equal refund amount");
        require(escrowBalance[id] == 0, "Escrow already deposited");

        escrowBalance[id] = msg.value;
        _setStatus(id, Status.Approved);
        emit ReturnApproved(id, msg.sender, msg.value);
    }

    /**
     * @notice Seller rejects the return request during review.
     * @param id The return ID.
     */
    function rejectReturn(uint256 id) external onlySeller(id) inState(id, Status.UnderReview) {
        _setStatus(id, Status.Rejected);
        emit ReturnRejected(id, msg.sender);
    }

    /**
     * @notice Logistics partner confirms physical pickup of the return package from customer.
     * @param id The return ID.
     */
    function confirmPickup(uint256 id) external inState(id, Status.Approved) {
        require(logisticsPartners[msg.sender], "Not a logistics partner");
        _setStatus(id, Status.PickedUp);
        emit PickedUp(id, msg.sender);
    }

    /**
     * @notice External automated shipment tracking oracle updates item delivery progress.
     * @param id The return ID.
     * @param delivered If false, package is InTransit; if true, package has been Received.
     */
    function updateShipment(uint256 id, bool delivered) external {
        require(oracles[msg.sender], "Not an authorised oracle");
        Status s = returnsById[id].status;
        if (!delivered) {
            require(s == Status.PickedUp, "Invalid state");
            _setStatus(id, Status.InTransit);
            emit ShipmentUpdated(id, Status.InTransit, msg.sender);
        } else {
            require(s == Status.InTransit, "Invalid state");
            _setStatus(id, Status.Received);
            emit ShipmentUpdated(id, Status.Received, msg.sender);
        }
    }

    /**
     * @notice Authorized inspection partner assesses item quality upon arrival.
     * @param id The return ID.
     * @param conditionOk True if item matches description/intact, false if mismatched/damaged.
     */
    function markInspected(uint256 id, bool conditionOk) external inState(id, Status.Received) {
        require(inspectors[msg.sender], "Not an inspector");

        returnsById[id].conditionOk = conditionOk;
        _setStatus(id, Status.Inspected);
        emit ReturnInspected(id, conditionOk, msg.sender);

        Status nextStatus = conditionOk ? Status.Accepted : Status.Disputed;
        _setStatus(id, nextStatus);
    }

    // ============================================================================
    // REFUND ESCROW & DISPUTE ARBITRATION
    // ============================================================================

    /**
     * @notice Triggers escrow refund payout to customer after inspection passes (Accepted).
     * @param id The return ID.
     */
    function releaseRefund(uint256 id) external nonReentrant inState(id, Status.Accepted) {
        _payout(id);
    }

    /**
     * @notice Administrator arbitrates a disputed return item.
     * @param id The return ID.
     * @param favourCustomer If true, refund customer; if false, refund seller and reject.
     */
    function resolveDispute(uint256 id, bool favourCustomer) external onlyAdmin nonReentrant inState(id, Status.Disputed) {
        if (favourCustomer) {
            _setStatus(id, Status.Accepted);
            uint256 amount = escrowBalance[id];
            _payout(id);
            emit DisputeResolved(id, true, returnsById[id].customer, amount);
        } else {
            uint256 amount = escrowBalance[id];
            require(amount > 0, "No escrow funds to return");

            // State changes before external call (Checks-Effects-Interactions pattern)
            escrowBalance[id] = 0;
            _setStatus(id, Status.Rejected);

            address sellerRecipient = returnsById[id].seller;
            emit DisputeResolved(id, false, sellerRecipient, amount);

            (bool ok, ) = payable(sellerRecipient).call{value: amount}("");
            require(ok, "Return to seller failed");
        }
    }

    /**
     * @dev Internal payout routine releasing escrow to the verified customer.
     *      Strictly follows Checks-Effects-Interactions to prevent re-entrancy.
     * @param id The return ID.
     */
    function _payout(uint256 id) internal {
        uint256 amount = escrowBalance[id];
        require(amount > 0, "No escrow balance");

        // Effects before interactions
        escrowBalance[id] = 0;
        _setStatus(id, Status.Refunded);

        address customerRecipient = returnsById[id].customer;
        emit RefundReleased(id, customerRecipient, amount);

        // Interaction
        (bool ok, ) = payable(customerRecipient).call{value: amount}("");
        require(ok, "Refund transfer failed");
    }

    /**
     * @dev Internal status transition helper that maintains complete audit history.
     * @param id The return ID.
     * @param s New status to transition to.
     */
    function _setStatus(uint256 id, Status s) internal {
        returnsById[id].status = s;
        statusHistory[id].push(s);
        emit StatusChanged(id, s);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Returns current status of a return request.
     * @param id Return ID.
     * @return Status enum value.
     */
    function getStatus(uint256 id) external view returns (Status) {
        return returnsById[id].status;
    }

    /**
     * @notice Returns full chronological status transition history of a return.
     * @param id Return ID.
     * @return Status[] Array of chronological statuses.
     */
    function getReturnHistory(uint256 id) external view returns (Status[] memory) {
        return statusHistory[id];
    }

    /**
     * @notice Returns complete ReturnRequest record.
     * @param id Return ID.
     * @return ReturnRequest struct data.
     */
    function getReturn(uint256 id) external view returns (ReturnRequest memory) {
        return returnsById[id];
    }

    /**
     * @notice Returns complete Purchase record.
     * @param orderId Original order ID.
     * @return Purchase struct data.
     */
    function getPurchase(uint256 orderId) external view returns (Purchase memory) {
        return purchases[orderId];
    }

    /**
     * @notice Returns total number of returns raised to date.
     */
    function totalReturns() external view returns (uint256) {
        return nextReturnId - 1;
    }

    /**
     * @notice Returns list of all return IDs.
     */
    function getAllReturnIds() external view returns (uint256[] memory) {
        return allReturnIds;
    }
}
