const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReturnManagement System Tests", function () {
  let ReturnManagement;
  let contract;
  let admin, seller, customer, logistics, inspector, oracle, stranger;

  // Status Enum mirror
  const Status = {
    None: 0,
    Submitted: 1,
    UnderReview: 2,
    Approved: 3,
    Rejected: 4,
    PickedUp: 5,
    InTransit: 6,
    Received: 7,
    Inspected: 8,
    Disputed: 9,
    Accepted: 10,
    Refunded: 11,
  };

  const sampleProofHash = ethers.keccak256(ethers.toUtf8Bytes("defect-photo-proof-evidence"));
  const refundAmount = ethers.parseEther("1.0");

  beforeEach(async function () {
    [admin, seller, customer, logistics, inspector, oracle, stranger] = await ethers.getSigners();

    ReturnManagement = await ethers.getContractFactory("ReturnManagement");
    contract = await ReturnManagement.deploy();
    await contract.waitForDeployment();

    // Register standard actors
    await contract.connect(admin).addSeller(seller.address);
    await contract.connect(admin).addLogistics(logistics.address);
    await contract.connect(admin).addInspector(inspector.address);
    await contract.connect(admin).addOracle(oracle.address);
  });

  describe("1. Successful return from raise to refund (Full Happy Path)", function () {
    it("should execute the complete lifecycle from purchase to refund payout", async function () {
      const orderId = 101;

      // 1. Seller registers purchase
      await expect(contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount))
        .to.emit(contract, "PurchaseRegistered")
        .withArgs(orderId, customer.address, seller.address, refundAmount);

      expect(await contract.verifyPurchase(orderId, customer.address)).to.be.true;

      // 2. Customer raises return
      await expect(contract.connect(customer).raiseReturn(orderId, "Damaged screen on arrival", sampleProofHash))
        .to.emit(contract, "ReturnRaised")
        .withArgs(1, orderId, customer.address, "Damaged screen on arrival", sampleProofHash);

      expect(await contract.getStatus(1)).to.equal(Status.Submitted);

      // 3. Seller reviews return
      await expect(contract.connect(seller).reviewReturn(1))
        .to.emit(contract, "ReturnUnderReview")
        .withArgs(1, seller.address);

      expect(await contract.getStatus(1)).to.equal(Status.UnderReview);

      // 4. Seller approves return and deposits escrow
      await expect(contract.connect(seller).approveReturn(1, { value: refundAmount }))
        .to.emit(contract, "ReturnApproved")
        .withArgs(1, seller.address, refundAmount);

      expect(await contract.getStatus(1)).to.equal(Status.Approved);
      expect(await contract.escrowBalance(1)).to.equal(refundAmount);

      // 5. Logistics confirms pickup
      await expect(contract.connect(logistics).confirmPickup(1))
        .to.emit(contract, "PickedUp")
        .withArgs(1, logistics.address);

      expect(await contract.getStatus(1)).to.equal(Status.PickedUp);

      // 6. Oracle updates shipment to InTransit
      await expect(contract.connect(oracle).updateShipment(1, false))
        .to.emit(contract, "ShipmentUpdated")
        .withArgs(1, Status.InTransit, oracle.address);

      expect(await contract.getStatus(1)).to.equal(Status.InTransit);

      // 7. Oracle updates shipment to Received at inspection hub
      await expect(contract.connect(oracle).updateShipment(1, true))
        .to.emit(contract, "ShipmentUpdated")
        .withArgs(1, Status.Received, oracle.address);

      expect(await contract.getStatus(1)).to.equal(Status.Received);

      // 8. Inspector marks condition OK
      await expect(contract.connect(inspector).markInspected(1, true))
        .to.emit(contract, "ReturnInspected")
        .withArgs(1, true, inspector.address);

      expect(await contract.getStatus(1)).to.equal(Status.Accepted);

      // 9. Release refund to customer
      const initialCustomerBalance = await ethers.provider.getBalance(customer.address);

      const tx = await contract.connect(customer).releaseRefund(1);
      const receipt = await tx.wait();
      const gasSpent = receipt.gasUsed * receipt.gasPrice;

      const finalCustomerBalance = await ethers.provider.getBalance(customer.address);

      expect(finalCustomerBalance + gasSpent - initialCustomerBalance).to.equal(refundAmount);
      expect(await contract.getStatus(1)).to.equal(Status.Refunded);
      expect(await contract.escrowBalance(1)).to.equal(0);

      // Verify status history
      const history = await contract.getReturnHistory(1);
      const historyNumbers = history.map((s) => Number(s));
      expect(historyNumbers).to.deep.equal([
        Status.Submitted,
        Status.UnderReview,
        Status.Approved,
        Status.PickedUp,
        Status.InTransit,
        Status.Received,
        Status.Inspected,
        Status.Accepted,
        Status.Refunded,
      ]);
    });
  });

  describe("2. Seller rejects a return", function () {
    it("should allow the seller to review and reject a return", async function () {
      const orderId = 102;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(orderId, "Changed my mind", sampleProofHash);

      await contract.connect(seller).reviewReturn(1);
      expect(await contract.getStatus(1)).to.equal(Status.UnderReview);

      await expect(contract.connect(seller).rejectReturn(1))
        .to.emit(contract, "ReturnRejected")
        .withArgs(1, seller.address);

      expect(await contract.getStatus(1)).to.equal(Status.Rejected);
      expect(await contract.escrowBalance(1)).to.equal(0);
    });
  });

  describe("3. Disputed return resolution (Admin Arbitration)", function () {
    beforeEach(async function () {
      const orderId = 103;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(orderId, "Not working", sampleProofHash);
      await contract.connect(seller).reviewReturn(1);
      await contract.connect(seller).approveReturn(1, { value: refundAmount });
      await contract.connect(logistics).confirmPickup(1);
      await contract.connect(oracle).updateShipment(1, false);
      await contract.connect(oracle).updateShipment(1, true);

      // Inspector finds item damaged or condition mismatch
      await contract.connect(inspector).markInspected(1, false);
      expect(await contract.getStatus(1)).to.equal(Status.Disputed);
    });

    it("should resolve dispute in favor of customer (favourCustomer = true)", async function () {
      const initialCustBalance = await ethers.provider.getBalance(customer.address);

      await expect(contract.connect(admin).resolveDispute(1, true))
        .to.emit(contract, "DisputeResolved")
        .withArgs(1, true, customer.address, refundAmount)
        .to.emit(contract, "RefundReleased")
        .withArgs(1, customer.address, refundAmount);

      const finalCustBalance = await ethers.provider.getBalance(customer.address);
      expect(finalCustBalance - initialCustBalance).to.equal(refundAmount);
      expect(await contract.getStatus(1)).to.equal(Status.Refunded);
      expect(await contract.escrowBalance(1)).to.equal(0);
    });

    it("should resolve dispute against customer and return escrow to seller (favourCustomer = false)", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);

      await expect(contract.connect(admin).resolveDispute(1, false))
        .to.emit(contract, "DisputeResolved")
        .withArgs(1, false, seller.address, refundAmount);

      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      expect(finalSellerBalance - initialSellerBalance).to.equal(refundAmount);
      expect(await contract.getStatus(1)).to.equal(Status.Rejected);
      expect(await contract.escrowBalance(1)).to.equal(0);
    });
  });

  describe("4. Unauthorized caller reverts for role-restricted functions", function () {
    beforeEach(async function () {
      await contract.connect(seller).registerPurchase(201, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(201, "Defective component", sampleProofHash);
    });

    it("should revert if non-admin tries to add participants", async function () {
      await expect(contract.connect(stranger).addSeller(stranger.address)).to.be.revertedWith("Only admin");
      await expect(contract.connect(stranger).addLogistics(stranger.address)).to.be.revertedWith("Only admin");
      await expect(contract.connect(stranger).addInspector(stranger.address)).to.be.revertedWith("Only admin");
      await expect(contract.connect(stranger).addOracle(stranger.address)).to.be.revertedWith("Only admin");
    });

    it("should revert if non-seller tries to register purchase", async function () {
      await expect(
        contract.connect(stranger).registerPurchase(202, customer.address, refundAmount)
      ).to.be.revertedWith("Not a registered seller");
    });

    it("should revert if non-customer tries to raise return for an order", async function () {
      await expect(
        contract.connect(stranger).raiseReturn(201, "Hijack", sampleProofHash)
      ).to.be.revertedWith("Purchase not verified");
    });

    it("should revert if non-seller tries to review, approve, or reject return", async function () {
      await expect(contract.connect(stranger).reviewReturn(1)).to.be.revertedWith("Not the seller");
      await contract.connect(seller).reviewReturn(1);

      await expect(
        contract.connect(stranger).approveReturn(1, { value: refundAmount })
      ).to.be.revertedWith("Not the seller");

      await expect(contract.connect(stranger).rejectReturn(1)).to.be.revertedWith("Not the seller");
    });

    it("should revert if non-logistics calls confirmPickup", async function () {
      await contract.connect(seller).reviewReturn(1);
      await contract.connect(seller).approveReturn(1, { value: refundAmount });
      await expect(contract.connect(stranger).confirmPickup(1)).to.be.revertedWith("Not a logistics partner");
    });

    it("should revert if non-oracle calls updateShipment", async function () {
      await contract.connect(seller).reviewReturn(1);
      await contract.connect(seller).approveReturn(1, { value: refundAmount });
      await contract.connect(logistics).confirmPickup(1);
      await expect(contract.connect(stranger).updateShipment(1, false)).to.be.revertedWith("Not an authorised oracle");
    });

    it("should revert if non-inspector calls markInspected", async function () {
      await contract.connect(seller).reviewReturn(1);
      await contract.connect(seller).approveReturn(1, { value: refundAmount });
      await contract.connect(logistics).confirmPickup(1);
      await contract.connect(oracle).updateShipment(1, false);
      await contract.connect(oracle).updateShipment(1, true);

      await expect(contract.connect(stranger).markInspected(1, true)).to.be.revertedWith("Not an inspector");
    });

    it("should revert if non-admin calls resolveDispute", async function () {
      await contract.connect(seller).reviewReturn(1);
      await contract.connect(seller).approveReturn(1, { value: refundAmount });
      await contract.connect(logistics).confirmPickup(1);
      await contract.connect(oracle).updateShipment(1, false);
      await contract.connect(oracle).updateShipment(1, true);
      await contract.connect(inspector).markInspected(1, false);

      await expect(contract.connect(stranger).resolveDispute(1, true)).to.be.revertedWith("Only admin");
    });
  });

  describe("5. Wrong-state calls are reverted", function () {
    it("should prevent actions taken out of order", async function () {
      const orderId = 301;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(orderId, "Faulty unit", sampleProofHash);

      // State is Submitted: approving before review should fail
      await expect(
        contract.connect(seller).approveReturn(1, { value: refundAmount })
      ).to.be.revertedWith("Invalid state");

      // Pickup before approval should fail
      await expect(contract.connect(logistics).confirmPickup(1)).to.be.revertedWith("Invalid state");

      // Oracle update before pickup should fail
      await expect(contract.connect(oracle).updateShipment(1, false)).to.be.revertedWith("Invalid state");

      // Review state
      await contract.connect(seller).reviewReturn(1); // Now UnderReview

      // Trying to review again should fail
      await expect(contract.connect(seller).reviewReturn(1)).to.be.revertedWith("Invalid state");

      // Marking inspected when not Received should fail
      await expect(contract.connect(inspector).markInspected(1, true)).to.be.revertedWith("Invalid state");

      // Releasing refund before Accepted should fail
      await expect(contract.connect(customer).releaseRefund(1)).to.be.revertedWith("Invalid state");

      // Resolving dispute when not Disputed should fail
      await expect(contract.connect(admin).resolveDispute(1, true)).to.be.revertedWith("Invalid state");
    });
  });

  describe("6. Duplicate order, empty proof hash, and wrong escrow amount reverted", function () {
    it("should revert when registering a duplicate order", async function () {
      const orderId = 401;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);

      await expect(
        contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount)
      ).to.be.revertedWith("Order already registered");
    });

    it("should revert when raising a return with empty proof hash", async function () {
      const orderId = 402;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);

      await expect(
        contract.connect(customer).raiseReturn(orderId, "No proof provided", ethers.ZeroHash)
      ).to.be.revertedWith("Proof hash required");
    });

    it("should revert when raising duplicate returns for the same order", async function () {
      const orderId = 403;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(orderId, "Initial issue", sampleProofHash);

      await expect(
        contract.connect(customer).raiseReturn(orderId, "Second attempt", sampleProofHash)
      ).to.be.revertedWith("Return already raised for this order");
    });

    it("should revert when approving with wrong escrow amount", async function () {
      const orderId = 404;
      await contract.connect(seller).registerPurchase(orderId, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(orderId, "Wrong size", sampleProofHash);
      await contract.connect(seller).reviewReturn(1);

      // Send less than refund amount
      await expect(
        contract.connect(seller).approveReturn(1, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("Escrow must equal refund amount");

      // Send more than refund amount
      await expect(
        contract.connect(seller).approveReturn(1, { value: ethers.parseEther("2.0") })
      ).to.be.revertedWith("Escrow must equal refund amount");
    });
  });

  describe("7. Views and Helpers", function () {
    it("should return correct totalReturns and details", async function () {
      expect(await contract.totalReturns()).to.equal(0);
      await contract.connect(seller).registerPurchase(501, customer.address, refundAmount);
      await contract.connect(customer).raiseReturn(501, "Defect", sampleProofHash);

      expect(await contract.totalReturns()).to.equal(1);
      const allIds = await contract.getAllReturnIds();
      expect(allIds.length).to.equal(1);
      expect(allIds[0]).to.equal(1n);

      const ret = await contract.getReturn(1);
      expect(ret.orderId).to.equal(501n);
      expect(ret.customer).to.equal(customer.address);
      expect(ret.reason).to.equal("Defect");

      const purchase = await contract.getPurchase(501);
      expect(purchase.customer).to.equal(customer.address);
      expect(purchase.amount).to.equal(refundAmount);
    });
  });
});
