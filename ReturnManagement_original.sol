// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ReturnManagement {
    enum Status { None, Submitted, UnderReview, Approved, Rejected, PickedUp, InTransit, Received, Inspected, Disputed, Accepted, Refunded }

    struct Purchase {
        uint256 orderId;
        address customer;
        address seller;
        uint256 amount;
        uint256 purchasedAt;
        bool exists;
    }

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

    address public admin;
    uint256 private nextReturnId = 1;

    mapping(address => bool) public registeredSellers;
    mapping(address => bool) public logisticsPartners;
    mapping(address => bool) public inspectors;
    mapping(address => bool) public oracles;

    mapping(uint256 => Purchase) internal purchases;
    mapping(uint256 => ReturnRequest) internal returnsById;
    mapping(uint256 => uint256) public escrowBalance;
    mapping(uint256 => Status[]) internal statusHistory;

    event ReturnRaised(uint256 indexed returnId, uint256 indexed orderId, address customer);
    event StatusChanged(uint256 indexed returnId, Status status);
    event RefundReleased(uint256 indexed returnId, address customer, uint256 amount);

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

    constructor() {
        admin = msg.sender;
    }

    // ---------- Participant management (admin) ----------
    function addSeller(address a) external onlyAdmin { registeredSellers[a] = true; }
    function addLogistics(address a) external onlyAdmin { logisticsPartners[a] = true; }
    function addInspector(address a) external onlyAdmin { inspectors[a] = true; }
    function addOracle(address a) external onlyAdmin { oracles[a] = true; }

    // ---------- ProductRegistry ----------
    function registerPurchase(uint256 orderId, address customer, uint256 amount) external {
        require(registeredSellers[msg.sender], "Not a registered seller");
        require(!purchases[orderId].exists, "Order already registered");
        require(customer != address(0), "Invalid customer");
        purchases[orderId] = Purchase(orderId, customer, msg.sender, amount, block.timestamp, true);
    }

    function verifyPurchase(uint256 orderId, address customer) public view returns (bool) {
        Purchase storage p = purchases[orderId];
        return p.exists && p.customer == customer;
    }

    // ---------- ReturnRequest ----------
    function raiseReturn(uint256 orderId, string memory reason, bytes32 proofHash) external returns (uint256) {
        require(verifyPurchase(orderId, msg.sender), "Purchase not verified");
        require(proofHash != bytes32(0), "Proof hash required");

        uint256 id = nextReturnId++;
        Purchase storage p = purchases[orderId];
        returnsById[id] = ReturnRequest(
            id, orderId, msg.sender, p.seller, reason, proofHash, p.amount, false, Status.Submitted, block.timestamp
        );
        statusHistory[id].push(Status.Submitted);
        emit ReturnRaised(id, orderId, msg.sender);
        return id;
    }

    function reviewReturn(uint256 id) external onlySeller(id) inState(id, Status.Submitted) {
        _setStatus(id, Status.UnderReview);
    }

    function approveReturn(uint256 id) external payable onlySeller(id) inState(id, Status.UnderReview) {
        require(msg.value == returnsById[id].refundAmount, "Escrow must equal refund amount");
        escrowBalance[id] = msg.value;
        _setStatus(id, Status.Approved);
    }

    function rejectReturn(uint256 id) external onlySeller(id) inState(id, Status.UnderReview) {
        _setStatus(id, Status.Rejected);
    }

    function confirmPickup(uint256 id) external inState(id, Status.Approved) {
        require(logisticsPartners[msg.sender], "Not a logistics partner");
        _setStatus(id, Status.PickedUp);
    }

    // Called by the shipment tracking oracle
    function updateShipment(uint256 id, bool delivered) external {
        require(oracles[msg.sender], "Not an authorised oracle");
        Status s = returnsById[id].status;
        if (!delivered) {
            require(s == Status.PickedUp, "Invalid state");
            _setStatus(id, Status.InTransit);
        } else {
            require(s == Status.InTransit, "Invalid state");
            _setStatus(id, Status.Received);
        }
    }

    function markInspected(uint256 id, bool conditionOk) external inState(id, Status.Received) {
        require(inspectors[msg.sender], "Not an inspector");
        returnsById[id].conditionOk = conditionOk;
        _setStatus(id, Status.Inspected);
        _setStatus(id, conditionOk ? Status.Accepted : Status.Disputed);
    }

    // ---------- RefundEscrow ----------
    function releaseRefund(uint256 id) external inState(id, Status.Accepted) {
        _payout(id);
    }

    function resolveDispute(uint256 id, bool favourCustomer) external onlyAdmin inState(id, Status.Disputed) {
        if (favourCustomer) {
            _setStatus(id, Status.Accepted);
            _payout(id);
        } else {
            uint256 amount = escrowBalance[id];
            escrowBalance[id] = 0;
            _setStatus(id, Status.Rejected);
            (bool ok, ) = payable(returnsById[id].seller).call{value: amount}("");
            require(ok, "Return to seller failed");
        }
    }

    function _payout(uint256 id) internal {
        uint256 amount = escrowBalance[id];
        escrowBalance[id] = 0;                 // effects before interaction (re-entrancy safe)
        _setStatus(id, Status.Refunded);
        (bool ok, ) = payable(returnsById[id].customer).call{value: amount}("");
        require(ok, "Refund transfer failed");
        emit RefundReleased(id, returnsById[id].customer, amount);
    }

    function _setStatus(uint256 id, Status s) internal {
        returnsById[id].status = s;
        statusHistory[id].push(s);
        emit StatusChanged(id, s);
    }

    // ---------- Views ----------
    function getStatus(uint256 id) external view returns (Status) {
        return returnsById[id].status;
    }

    function getReturnHistory(uint256 id) external view returns (Status[] memory) {
        return statusHistory[id];
    }
}
