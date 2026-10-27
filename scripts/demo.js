const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Status Enum mapping
const StatusNames = [
  "None",        // 0
  "Submitted",   // 1
  "UnderReview", // 2
  "Approved",    // 3
  "Rejected",    // 4
  "PickedUp",    // 5
  "InTransit",   // 6
  "Received",    // 7
  "Inspected",   // 8
  "Disputed",    // 9
  "Accepted",    // 10
  "Refunded"     // 11
];

function printStep(stepNum, title, desc) {
  console.log(`\n┌────────────────────────────────────────────────────────┐`);
  console.log(`│ STEP ${stepNum}: ${title.padEnd(46)}│`);
  console.log(`└────────────────────────────────────────────────────────┘`);
  if (desc) console.log(`  ℹ️  ${desc}\n`);
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🌐 NexReturn - Blockchain Return & Escrow Lifecycle Demo   ║
║      Decentralized Product Returns, Courier & Escrow System   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const [admin, seller, customer, logistics, inspector, oracle] = await ethers.getSigners();

  console.log("👥 Participants Configuration:");
  console.log(`  👑 Admin:     ${admin.address}`);
  console.log(`  🏪 Seller:    ${seller.address}`);
  console.log(`  🛍️  Customer:  ${customer.address}`);
  console.log(`  🚚 Logistics: ${logistics.address}`);
  console.log(`  🔍 Inspector: ${inspector.address}`);
  console.log(`  🛰️  Oracle:    ${oracle.address}\n`);

  // 1. Deploy fresh contract for self-contained demonstration
  printStep(1, "Deploy & Initialize Contract", "Deploying ReturnManagement and configuring roles");
  const ReturnManagement = await ethers.getContractFactory("ReturnManagement");
  const contract = await ReturnManagement.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log(`  ✅ Contract deployed at: ${contractAddress}`);

  await (await contract.connect(admin).addSeller(seller.address)).wait();
  await (await contract.connect(admin).addLogistics(logistics.address)).wait();
  await (await contract.connect(admin).addInspector(inspector.address)).wait();
  await (await contract.connect(admin).addOracle(oracle.address)).wait();
  console.log(`  ✅ All 4 ecosystem participants authorized by Admin.`);

  // SCENARIO 1: Full Happy Path (Purchase -> Return -> Escrow -> Inspection -> Refund)
  console.log(`\n===============================================================`);
  console.log(`  ▶ SCENARIO 1: Complete Happy Path Return & Instant Escrow Refund`);
  console.log(`===============================================================`);

  const orderId = 5001;
  const itemPrice = ethers.parseEther("1.5");

  printStep(2, "Product Retail Purchase", "Seller registers customer's purchase on-chain");
  const regTx = await contract.connect(seller).registerPurchase(orderId, customer.address, itemPrice);
  await regTx.wait();
  const purchase = await contract.getPurchase(orderId);
  console.log(`  🛒 Purchase Registered:`);
  console.log(`     Order ID:   #${purchase.orderId}`);
  console.log(`     Customer:   ${purchase.customer}`);
  console.log(`     Amount:     ${ethers.formatEther(purchase.amount)} ETH`);
  console.log(`     Verified:   ${await contract.verifyPurchase(orderId, customer.address)}`);

  printStep(3, "Customer Raises Return", "Customer provides reason and cryptographic photo proof hash");
  const proofHash = ethers.keccak256(ethers.toUtf8Bytes("proof-photo-cracked-display-serial-88392"));
  const returnTx = await contract.connect(customer).raiseReturn(
    orderId,
    "Screen has vertical colored lines and display flickering upon unboxing",
    proofHash
  );
  const receipt = await returnTx.wait();
  const returnId = 1;
  const status1 = await contract.getStatus(returnId);
  console.log(`  📦 Return Raised:`);
  console.log(`     Return ID:  #${returnId}`);
  console.log(`     Proof Hash: ${proofHash}`);
  console.log(`     Status:     ${StatusNames[status1]} (${status1})`);

  printStep(4, "Seller Review & Approval", "Seller reviews claim and locks 1.5 ETH in Escrow");
  await (await contract.connect(seller).reviewReturn(returnId)).wait();
  console.log(`  🔍 Status after review: ${StatusNames[await contract.getStatus(returnId)]}`);

  const approveTx = await contract.connect(seller).approveReturn(returnId, { value: itemPrice });
  await approveTx.wait();
  const escrowBal = await contract.escrowBalance(returnId);
  console.log(`  🔒 Status after approval: ${StatusNames[await contract.getStatus(returnId)]}`);
  console.log(`  💰 Escrow Balance Locked: ${ethers.formatEther(escrowBal)} ETH`);

  printStep(5, "Logistics Pickup", "Courier arrives at customer address and picks up return parcel");
  const pickupTx = await contract.connect(logistics).confirmPickup(returnId);
  await pickupTx.wait();
  console.log(`  🚚 Status: ${StatusNames[await contract.getStatus(returnId)]} (Picked up by Logistics)`);

  printStep(6, "Oracle Carrier Tracking", "Shipment tracking oracle broadcasts transit and arrival checkpoints");
  console.log("  🛰️  Oracle broadcast: Carrier departed customer city [Waypoint A]");
  await (await contract.connect(oracle).updateShipment(returnId, false)).wait(); // InTransit
  console.log(`  📡 Status: ${StatusNames[await contract.getStatus(returnId)]}`);

  console.log("  🛰️  Oracle broadcast: Package arrived at central Return Inspection Center [Hub B]");
  await (await contract.connect(oracle).updateShipment(returnId, true)).wait();  // Received
  console.log(`  📦 Status: ${StatusNames[await contract.getStatus(returnId)]}`);

  printStep(7, "Quality Inspection", "Inspector assesses condition and serial number authenticity");
  console.log("  🔍 Inspector Report: Condition verified intact, serial matches, damage aligns with claim.");
  await (await contract.connect(inspector).markInspected(returnId, true)).wait();
  console.log(`  ✅ Status: ${StatusNames[await contract.getStatus(returnId)]} (Accepted)`);

  printStep(8, "Escrow Refund Release", "Escrow releases 1.5 ETH payout directly to customer wallet");
  const balanceBefore = await ethers.provider.getBalance(customer.address);
  
  const refundTx = await contract.connect(customer).releaseRefund(returnId);
  const refundReceipt = await refundTx.wait();
  const gasSpent = refundReceipt.gasUsed * refundReceipt.gasPrice;
  const balanceAfter = await ethers.provider.getBalance(customer.address);
  const netReceived = balanceAfter + gasSpent - balanceBefore;

  console.log(`  💸 Refund Payout Executed!`);
  console.log(`     Net Amount Credited: ${ethers.formatEther(netReceived)} ETH`);
  console.log(`     Escrow Balance:      ${ethers.formatEther(await contract.escrowBalance(returnId))} ETH`);
  console.log(`     Final State:         ${StatusNames[await contract.getStatus(returnId)]}`);

  const history = await contract.getReturnHistory(returnId);
  console.log(`\n  📜 Chronological Audit Trail:`);
  history.forEach((st, idx) => {
    console.log(`     ${idx + 1}. ${StatusNames[st]}`);
  });

  // SCENARIO 2: Disputed Return & Admin Arbitration
  console.log(`\n===============================================================`);
  console.log(`  ▶ SCENARIO 2: Damaged/Mismatch Item -> Dispute Arbitration`);
  console.log(`===============================================================`);

  const orderId2 = 5002;
  const itemPrice2 = ethers.parseEther("0.8");
  await (await contract.connect(seller).registerPurchase(orderId2, customer.address, itemPrice2)).wait();

  const proofHash2 = ethers.keccak256(ethers.toUtf8Bytes("proof-photo-order-5002"));
  await (await contract.connect(customer).raiseReturn(orderId2, "Defective camera lens", proofHash2)).wait();
  const returnId2 = 2;

  await (await contract.connect(seller).reviewReturn(returnId2)).wait();
  await (await contract.connect(seller).approveReturn(returnId2, { value: itemPrice2 })).wait();
  await (await contract.connect(logistics).confirmPickup(returnId2)).wait();
  await (await contract.connect(oracle).updateShipment(returnId2, false)).wait();
  await (await contract.connect(oracle).updateShipment(returnId2, true)).wait();

  console.log("  ⚠️  Inspector finds counterfeit item / tampered packaging!");
  await (await contract.connect(inspector).markInspected(returnId2, false)).wait();
  console.log(`  🚨 Status: ${StatusNames[await contract.getStatus(returnId2)]} (Disputed)`);

  printStep(9, "Admin Arbitration Resolution", "Admin examines evidence and arbitrates dispute");
  console.log("  ⚖️  Admin ruling: Item tampered by customer -> Favoring Seller (Escrow returned)");
  const sellerBalBefore = await ethers.provider.getBalance(seller.address);
  await (await contract.connect(admin).resolveDispute(returnId2, false)).wait();
  const sellerBalAfter = await ethers.provider.getBalance(seller.address);

  console.log(`  ✅ Dispute settled! Seller received refund of: ${ethers.formatEther(sellerBalAfter - sellerBalBefore)} ETH`);
  console.log(`  🔒 Final Return #2 Status: ${StatusNames[await contract.getStatus(returnId2)]}`);

  console.log(`\n===============================================================`);
  console.log(`  🎉 End-to-End Demo Simulation Completed Successfully!`);
  console.log(`===============================================================\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Demo failed:", err);
    process.exit(1);
  });
