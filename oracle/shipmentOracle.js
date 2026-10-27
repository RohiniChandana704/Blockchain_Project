/**
 * NexReturn Automated Shipment Tracking Oracle Service
 *
 * This daemon acts as the off-chain oracle bridge connecting courier logistics tracking APIs
 * (e.g. FedEx, DHL, UPS) with the on-chain ReturnManagement smart contract.
 *
 * Responsibilities:
 * 1. Monitors for PickedUp returns on-chain.
 * 2. Simulates carrier GPS transit checkpoints.
 * 3. Dispatches authorized updateShipment(returnId, false) -> InTransit.
 * 4. Dispatches authorized updateShipment(returnId, true)  -> Received at QA Hub.
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "oracleConfig.json");
const ARTIFACT_PATH = path.join(__dirname, "..", "artifacts", "deployedAddress.json");

// Default Hardhat account #5 for Oracle
const DEFAULT_ORACLE_PRIVATE_KEY =
  process.env.ORACLE_PRIVATE_KEY ||
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d41f4414025a528632"; // Hardhat #5

const StatusEnum = {
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

function getStatusName(statusNum) {
  const names = Object.keys(StatusEnum);
  return names[statusNum] || "Unknown";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
  if (fs.existsSync(ARTIFACT_PATH)) {
    return JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
  }
  return null;
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🛰️  NexReturn Automated Carrier & Shipment Tracking Oracle   ║
║      Real-time Courier Bridge & On-chain Checkpoint Daemon     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);

  const config = await loadConfig();
  if (!config || !config.contractAddress) {
    console.error("❌ Configuration not found. Please deploy the contract first via:");
    console.error("   npm run deploy\n");
    process.exit(1);
  }

  console.log(`🌐 Connecting to Blockchain Provider: ${RPC_URL}`);
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    await provider.getNetwork();
  } catch (err) {
    console.error("\n❌ Could not connect to local Ethereum node at " + RPC_URL);
    console.error("   Please ensure your Hardhat node is running:");
    console.error("   1. Open a terminal and run: npm run node");
    console.error("   2. In another terminal run: npm run deploy");
    console.error("   3. Then restart the oracle: npm run oracle\n");
    process.exit(1);
  }

  const oracleWallet = new ethers.Wallet(DEFAULT_ORACLE_PRIVATE_KEY, provider);
  console.log(`🔐 Oracle Signer Address: ${oracleWallet.address}`);
  console.log(`📍 Contract Address:     ${config.contractAddress}`);

  const contract = new ethers.Contract(config.contractAddress, config.abi, oracleWallet);

  // Verify oracle authorization on-chain
  const isAuthorized = await contract.oracles(oracleWallet.address);
  if (!isAuthorized) {
    console.warn(`⚠️  Signer ${oracleWallet.address} is not yet authorized as an oracle on the contract!`);
    console.warn(`   Admin must authorize via addOracle(${oracleWallet.address})\n`);
  } else {
    console.log(`✅ Oracle authorization verified on-chain.`);
  }

  const inProcessing = new Set();

  async function processShipment(returnId) {
    if (inProcessing.has(returnId)) return;
    inProcessing.add(returnId);

    try {
      const returnData = await contract.getReturn(returnId);
      const currentStatus = Number(returnData.status);

      console.log(`\n📦 [Return #${returnId}] Detected in state: ${getStatusName(currentStatus)}`);

      if (currentStatus === StatusEnum.PickedUp) {
        console.log(`⏳ [Return #${returnId}] Simulating courier dispatch & transit route...`);
        await sleep(3500);

        console.log(`🛰️  [Return #${returnId}] Dispatching checkpoint: InTransit (Courier Route Waypoint 1)`);
        const tx1 = await contract.updateShipment(returnId, false);
        await tx1.wait();
        console.log(`✅ [Return #${returnId}] On-chain state updated: InTransit (Tx: ${tx1.hash.slice(0, 14)}...)`);

        await sleep(3500);

        console.log(`🛰️  [Return #${returnId}] Dispatching checkpoint: Received (Arrived at Return QA Hub)`);
        const tx2 = await contract.updateShipment(returnId, true);
        await tx2.wait();
        console.log(`✅ [Return #${returnId}] On-chain state updated: Received (Tx: ${tx2.hash.slice(0, 14)}...)`);
      } else if (currentStatus === StatusEnum.InTransit) {
        console.log(`⏳ [Return #${returnId}] Parcel in transit. Simulating hub arrival...`);
        await sleep(3500);

        console.log(`🛰️  [Return #${returnId}] Dispatching checkpoint: Received (Arrived at Return QA Hub)`);
        const tx = await contract.updateShipment(returnId, true);
        await tx.wait();
        console.log(`✅ [Return #${returnId}] On-chain state updated: Received (Tx: ${tx.hash.slice(0, 14)}...)`);
      }
    } catch (err) {
      console.error(`❌ [Return #${returnId}] Oracle update failed:`, err.message);
    } finally {
      inProcessing.delete(returnId);
    }
  }

  // Initial backlog scan
  console.log("\n🔍 Scanning contract for pending PickedUp or InTransit shipments...");
  try {
    const total = await contract.totalReturns();
    console.log(`📊 Total returns on contract: ${total}`);
    for (let id = 1; id <= total; id++) {
      const s = Number(await contract.getStatus(id));
      if (s === StatusEnum.PickedUp || s === StatusEnum.InTransit) {
        console.log(`👉 Found eligible Return #${id} (Status: ${getStatusName(s)})`);
        processShipment(id);
      }
    }
  } catch (err) {
    console.error("Error scanning returns:", err.message);
  }

  // Real-time Event Listeners
  console.log("\n🎧 Listening for live PickedUp and ShipmentUpdated events...");
  contract.on("PickedUp", (returnId, logisticsAddress) => {
    console.log(`\n🔔 Event: PickedUp for Return #${returnId} by ${logisticsAddress}`);
    processShipment(Number(returnId));
  });

  contract.on("ShipmentUpdated", (returnId, status, oracleAddress) => {
    console.log(`📡 Event: ShipmentUpdated for Return #${returnId} -> ${getStatusName(Number(status))} by ${oracleAddress}`);
  });

  // Keep alive with heartbeat log
  setInterval(() => {
    process.stdout.write(`💓 Oracle heartbeat: listening for courier updates... (${new Date().toLocaleTimeString()})\r`);
  }, 10000);
}

main().catch((err) => {
  console.error("Fatal Oracle Error:", err);
  process.exit(1);
});
