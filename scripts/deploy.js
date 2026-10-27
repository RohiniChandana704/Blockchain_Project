const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n=======================================================");
  console.log("   🚀 NexReturn - Smart Contract Deployment & Setup    ");
  console.log("=======================================================\n");

  const signers = await ethers.getSigners();
  const [admin, seller, customer, logistics, inspector, oracle, customer2] = signers;

  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer (Admin):", admin.address);
  console.log("Admin Balance:   ", ethers.formatEther(await ethers.provider.getBalance(admin.address)), "ETH\n");

  // 1. Deploy Contract
  console.log("📦 Deploying ReturnManagement contract...");
  const ReturnManagement = await ethers.getContractFactory("ReturnManagement");
  const contract = await ReturnManagement.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("✅ ReturnManagement deployed at:", contractAddress);

  // 2. Authorize System Roles
  console.log("\n🔐 Authorizing System Roles...");
  
  const txSeller = await contract.connect(admin).addSeller(seller.address);
  await txSeller.wait();
  console.log("  • Seller Authorized:    ", seller.address);

  const txLogistics = await contract.connect(admin).addLogistics(logistics.address);
  await txLogistics.wait();
  console.log("  • Logistics Authorized: ", logistics.address);

  const txInspector = await contract.connect(admin).addInspector(inspector.address);
  await txInspector.wait();
  console.log("  • Inspector Authorized: ", inspector.address);

  const txOracle = await contract.connect(admin).addOracle(oracle.address);
  await txOracle.wait();
  console.log("  • Oracle Authorized:    ", oracle.address);

  // 3. Seed Initial Demo Purchases & Return Lifecycles
  console.log("\n🌱 Seeding Initial Purchase Records & Demo States...");

  // Purchase #1: 1001 for customer (0.5 ETH) - Ready for customer to raise return
  const p1Amount = ethers.parseEther("0.5");
  await (await contract.connect(seller).registerPurchase(1001, customer.address, p1Amount)).wait();
  console.log("  [Order #1001] Registered for Customer (0.5 ETH) -> Ready to raise return");

  // Purchase #2: 1002 for customer2 (1.0 ETH) -> Return #1 raised, reviewed & approved with Escrow
  const p2Amount = ethers.parseEther("1.0");
  await (await contract.connect(seller).registerPurchase(1002, customer2.address, p2Amount)).wait();
  const sampleProof1 = ethers.keccak256(ethers.toUtf8Bytes("defect-proof-photo-1002"));
  const r1Tx = await contract.connect(customer2).raiseReturn(1002, "Screen flicker and battery drains instantly", sampleProof1);
  await r1Tx.wait();
  await (await contract.connect(seller).reviewReturn(1)).wait();
  await (await contract.connect(seller).approveReturn(1, { value: p2Amount })).wait();
  console.log("  [Return #1] Order #1002 -> Approved with 1.0 ETH locked in Escrow (Awaiting Pickup)");

  // Purchase #3: 1003 for customer (0.75 ETH) -> Advanced to Disputed state (Ready for Dispute Arbitration)
  const p3Amount = ethers.parseEther("0.75");
  await (await contract.connect(seller).registerPurchase(1003, customer.address, p3Amount)).wait();
  const sampleProof2 = ethers.keccak256(ethers.toUtf8Bytes("defect-proof-photo-1003"));
  await (await contract.connect(customer).raiseReturn(1003, "Damaged housing and missing power brick", sampleProof2)).wait();
  await (await contract.connect(seller).reviewReturn(2)).wait();
  await (await contract.connect(seller).approveReturn(2, { value: p3Amount })).wait();
  await (await contract.connect(logistics).confirmPickup(2)).wait();
  await (await contract.connect(oracle).updateShipment(2, false)).wait(); // InTransit
  await (await contract.connect(oracle).updateShipment(2, true)).wait();  // Received
  await (await contract.connect(inspector).markInspected(2, false)).wait(); // Condition NOT ok -> Disputed!
  console.log("  [Return #2] Order #1003 -> Progressed to Disputed state (Awaiting Admin Arbitration)");

  // 4. Read Artifact ABI
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "ReturnManagement.sol", "ReturnManagement.json");
  let artifactAbi = [];
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    artifactAbi = artifact.abi;
  }

  // 5. Build Deployment Configuration Object
  const deploymentData = {
    contractAddress,
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    roles: {
      admin: { name: "System Administrator", address: admin.address },
      seller: { name: "TechStore Direct (Seller)", address: seller.address },
      customer: { name: "Alice (Customer 1)", address: customer.address },
      customer2: { name: "Bob (Customer 2)", address: customer2.address },
      logistics: { name: "SwiftLogistics Partner", address: logistics.address },
      inspector: { name: "VeriCheck Quality Labs", address: inspector.address },
      oracle: { name: "ChainTrack Shipment Oracle", address: oracle.address },
    },
    accounts: [
      { role: "admin", name: "System Admin", address: admin.address, index: 0 },
      { role: "seller", name: "TechStore (Seller)", address: seller.address, index: 1 },
      { role: "customer", name: "Alice (Customer)", address: customer.address, index: 2 },
      { role: "logistics", name: "Swift Logistics", address: logistics.address, index: 3 },
      { role: "inspector", name: "QA Inspector", address: inspector.address, index: 4 },
      { role: "oracle", name: "Shipment Oracle", address: oracle.address, index: 5 },
      { role: "customer2", name: "Bob (Customer 2)", address: customer2.address, index: 6 },
    ],
    abi: artifactAbi
  };

  // 6. Write Configuration Files for Frontend and Oracle
  const frontendDir = path.join(__dirname, "..", "frontend", "js");
  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }

  const oracleDir = path.join(__dirname, "..", "oracle");
  if (!fs.existsSync(oracleDir)) {
    fs.mkdirSync(oracleDir, { recursive: true });
  }

  const artifactsDir = path.join(__dirname, "..", "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Save to artifacts/deployedAddress.json
  fs.writeFileSync(
    path.join(artifactsDir, "deployedAddress.json"),
    JSON.stringify(deploymentData, null, 2)
  );

  // Save to frontend/js/contractConfig.js
  const frontendJsConfig = `// Auto-generated by scripts/deploy.js
window.CONTRACT_CONFIG = ${JSON.stringify(deploymentData, null, 2)};
`;
  fs.writeFileSync(path.join(frontendDir, "contractConfig.js"), frontendJsConfig);

  // Save to oracle/oracleConfig.json
  fs.writeFileSync(
    path.join(oracleDir, "oracleConfig.json"),
    JSON.stringify(deploymentData, null, 2)
  );

  console.log("\n📁 Configuration files generated:");
  console.log("  • artifacts/deployedAddress.json");
  console.log("  • frontend/js/contractConfig.js");
  console.log("  • oracle/oracleConfig.json");

  console.log("\n=======================================================");
  console.log("🎉 Deployment & Initialization Complete!");
  console.log("   Contract Address:", contractAddress);
  console.log("=======================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
