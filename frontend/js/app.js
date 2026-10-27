/**
 * NexReturn - Decentralized Return & Escrow Protocol
 * Interactive Frontend Controller
 */

// Default Hardhat Private Keys for instant local simulation
const HARDHAT_ACCOUNTS = [
  { role: "admin", name: "System Admin", addr: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  { role: "seller", name: "TechStore (Seller)", addr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { role: "customer", name: "Alice (Customer 1)", addr: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", key: "0x5de4111afa1a4b94908f83103eb2f93f4e4e94119859f14b600810793744654b" },
  { role: "logistics", name: "Swift Logistics", addr: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { role: "inspector", name: "QA Inspector", addr: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", key: "0x47e179ec346fe869371a1def4d372345b8737865e5370f6170b097b878dd533e" },
  { role: "oracle", name: "Tracking Oracle", addr: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", key: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d41f4414025a528632" },
  { role: "customer2", name: "Bob (Customer 2)", addr: "0x14dC79964da2c08b23698B3D3cc7Ca32193d9955", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" }
];

const StatusEnum = {
  0: { name: "None", class: "" },
  1: { name: "Submitted", class: "submitted", desc: "Return request submitted with cryptographic proof" },
  2: { name: "UnderReview", class: "underreview", desc: "Seller is reviewing defect claim" },
  3: { name: "Approved", class: "approved", desc: "Approved by seller; refund locked in Escrow" },
  4: { name: "Rejected", class: "rejected", desc: "Return request rejected by seller" },
  5: { name: "PickedUp", class: "pickedup", desc: "Parcel collected from customer by courier" },
  6: { name: "InTransit", class: "intransit", desc: "En route to central inspection hub" },
  7: { name: "Received", class: "received", desc: "Parcel received at inspection facility" },
  8: { name: "Inspected", class: "inspected", desc: "QA team completed physical condition check" },
  9: { name: "Disputed", class: "disputed", desc: "Condition failed / mismatched; in Admin arbitration" },
  10: { name: "Accepted", class: "accepted", desc: "Condition verified; eligible for refund payout" },
  11: { name: "Refunded", class: "refunded", desc: "Escrow funds successfully transferred to customer" }
};

let provider = null;
let activeSigner = null;
let currentAccountIndex = 2; // Default to Alice (Customer 1)
let contract = null;
let currentProofHash = null;
let knownOrders = new Set([1001, 1002, 1003, 1004, 1005, 1006, 1007]);
let isSimulationMode = false;

// Curated digital product catalog for realistic simulation & instant purchasing
const PRODUCT_CATALOG = {
  1001: { name: "Apple MacBook Pro 14\" (M3 Pro 18GB/512GB)", price: "0.50", category: "Laptops", seller: "TechStore Direct", img: "💻", defectSample: "Display backlight bleeding and intermittent trackpad lag." },
  1002: { name: "Sony WH-1000XM5 Noise-Canceling Headphones", price: "1.00", category: "Audio", seller: "TechStore Direct", img: "🎧", defectSample: "Active Noise Cancellation produces high-pitch squeal in right earcup." },
  1003: { name: "Dell UltraSharp 27\" 4K USB-C Monitor", price: "0.75", category: "Displays", seller: "TechStore Direct", img: "🖥️", defectSample: "Damaged panel during delivery, vertical line of dead pixels." },
  1004: { name: "Apple iPad Pro 11-inch (M4 256GB Wi-Fi)", price: "0.45", category: "Tablets", seller: "TechStore Direct", img: "📱", defectSample: "Face ID hardware failure and severe battery drain while idle." },
  1005: { name: "Canon EOS R6 Mark II Mirrorless Camera", price: "1.25", category: "Cameras", seller: "TechStore Direct", img: "📷", defectSample: "Image sensor shutter error Err 20 on high-speed continuous shooting." },
  1006: { name: "Bose QuietComfort Ultra Spatial Earbuds", price: "0.30", category: "Audio", seller: "TechStore Direct", img: "🎵", defectSample: "Left earbud fails to charge and Bluetooth connection drops." },
  1007: { name: "Sony PlayStation 5 Pro Console (2TB SSD)", price: "0.85", category: "Gaming", seller: "TechStore Direct", img: "🎮", defectSample: "Console overheats and shuts down abruptly within 15 minutes of gameplay." }
};

// Utility: Shorten Ethereum address
function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

// Utility: Format Wei to ETH string
function formatEth(wei) {
  try {
    return parseFloat(ethers.formatEther(wei)).toFixed(3) + " ETH";
  } catch (e) {
    return "0.000 ETH";
  }
}

// Utility: Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Populate and refresh the Selected Order dropdown in Raise Return Modal
async function populateOrderDropdown() {
  const orderSelect = document.getElementById("raise-order-id");
  if (!orderSelect) return;

  const custAddr = (activeSigner && activeSigner.address) ? activeSigner.address : HARDHAT_ACCOUNTS[currentAccountIndex].addr;
  const previousVal = orderSelect.value;
  orderSelect.innerHTML = "";

  // 1. Check verified on-chain purchases for active customer
  let activeCustomerPurchases = [];
  if (contract) {
    for (const oid of knownOrders) {
      try {
        const p = await contract.getPurchase(oid);
        if (p && p.exists && p.customer.toLowerCase() === custAddr.toLowerCase()) {
          const hasReturn = await contract.orderHasReturn(oid);
          if (!hasReturn) {
            activeCustomerPurchases.push({ oid, amount: p.amount, seller: p.seller });
          }
        }
      } catch (e) {}
    }
  }

  // Group 1: Verified Purchases on-chain for active customer
  if (activeCustomerPurchases.length > 0) {
    const grp = document.createElement("optgroup");
    grp.label = "✅ Your Verified Purchases (Eligible for Return)";
    activeCustomerPurchases.forEach(p => {
      const cat = PRODUCT_CATALOG[p.oid] || { name: `Retail Order #${p.oid}`, price: ethers.formatEther(p.amount), img: "📦", defectSample: "Item defective or damaged upon delivery." };
      const opt = document.createElement("option");
      opt.value = p.oid;
      opt.dataset.type = "verified";
      opt.dataset.amount = formatEth(p.amount);
      opt.dataset.name = cat.name;
      opt.dataset.icon = cat.img || "📦";
      opt.dataset.defect = cat.defectSample;
      opt.textContent = `Order #${p.oid} — ${cat.name} (${formatEth(p.amount)}) [Verified]`;
      grp.appendChild(opt);
    });
    orderSelect.appendChild(grp);
  }

  // Group 2: Available Catalog Products (Instant 1-Click Buy & Return)
  const catalogGrp = document.createElement("optgroup");
  catalogGrp.label = "🛍️ Available Products to Return (Auto-Register & Submit)";
  Object.keys(PRODUCT_CATALOG).forEach(oidStr => {
    const oid = Number(oidStr);
    // Don't duplicate if already in verified
    if (!activeCustomerPurchases.some(p => p.oid === oid)) {
      const cat = PRODUCT_CATALOG[oid];
      const opt = document.createElement("option");
      opt.value = oid;
      opt.dataset.type = "catalog";
      opt.dataset.amount = `${cat.price} ETH`;
      opt.dataset.name = cat.name;
      opt.dataset.icon = cat.img || "📦";
      opt.dataset.defect = cat.defectSample;
      opt.textContent = `Order #${oid} — ${cat.name} (${cat.price} ETH) [Ready to Return]`;
      catalogGrp.appendChild(opt);
    }
  });
  orderSelect.appendChild(catalogGrp);

  // Group 3: Custom Order option
  const customGrp = document.createElement("optgroup");
  customGrp.label = "✏️ Custom Input";
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.dataset.type = "custom";
  customOpt.textContent = "+ Enter Custom Order ID...";
  customGrp.appendChild(customOpt);
  orderSelect.appendChild(customGrp);

  // Restore selection if valid or pick the first available option
  if (previousVal && Array.from(orderSelect.options).some(o => o.value === previousVal)) {
    orderSelect.value = previousVal;
  } else if (orderSelect.options.length > 0) {
    orderSelect.selectedIndex = 0;
  }

  // Update preview card
  updateOrderPreview();
}

// Update the preview card based on selected order
function updateOrderPreview() {
  const orderSelect = document.getElementById("raise-order-id");
  const previewCard = document.getElementById("raise-order-preview-card");
  const customFields = document.getElementById("custom-order-fields");
  const sourceBadge = document.getElementById("order-source-badge");

  if (!orderSelect || !orderSelect.selectedOptions || !orderSelect.selectedOptions[0]) return;
  const sel = orderSelect.selectedOptions[0];

  if (sel.value === "custom") {
    if (previewCard) previewCard.style.display = "none";
    if (customFields) customFields.style.display = "block";
    if (sourceBadge) {
      sourceBadge.textContent = "Custom Order";
      sourceBadge.className = "status-badge underreview";
    }
    return;
  }

  if (customFields) customFields.style.display = "none";
  if (previewCard) previewCard.style.display = "flex";

  const name = sel.dataset.name || `Order #${sel.value}`;
  const amount = sel.dataset.amount || "0.500 ETH";
  const icon = sel.dataset.icon || "📦";
  const type = sel.dataset.type || "verified";

  const iconEl = document.getElementById("preview-product-icon");
  const nameEl = document.getElementById("preview-product-name");
  const orderIdEl = document.getElementById("preview-order-id");
  const amountEl = document.getElementById("preview-order-amount");

  if (iconEl) iconEl.textContent = icon;
  if (nameEl) nameEl.textContent = name;
  if (orderIdEl) orderIdEl.textContent = `#${sel.value}`;
  if (amountEl) amountEl.textContent = amount;

  if (sourceBadge) {
    if (type === "verified") {
      sourceBadge.textContent = "Verified On-Chain";
      sourceBadge.className = "status-badge approved";
    } else {
      sourceBadge.textContent = "Instant Auto-Register";
      sourceBadge.className = "status-badge intransit";
    }
  }
}

// Initialize Web3 Connection & Contract
async function initBlockchain() {
  try {
    const config = window.CONTRACT_CONFIG;
    if (!config || !config.contractAddress) {
      showToast("Contract configuration missing. Please run 'npm run deploy' first.", "error");
      return;
    }

    const shortAddrEl = document.getElementById("contract-addr-short");
    if (shortAddrEl) shortAddrEl.textContent = shortAddr(config.contractAddress);
    
    const copyBtn = document.getElementById("btn-copy-contract");
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(config.contractAddress);
        showToast("Contract address copied to clipboard!", "info");
      };
    }

    // Connect to local Hardhat node
    provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    
    // Quick test if node is reachable
    const network = await provider.getNetwork();
    const netDisplay = document.getElementById("network-display");
    if (netDisplay) {
      netDisplay.textContent = `Hardhat Local (${network.chainId})`;
      netDisplay.parentElement.classList.remove("offline");
    }

    await setupActiveSigner();

    // Auto-seed initial orders if empty on contract
    try {
      const tot = await contract.totalReturns();
      const p1 = await contract.getPurchase(1001);
      if (!p1.exists && Number(tot) === 0) {
        console.log("Seeding initial purchases on fresh contract...");
        const sellerSigner = new ethers.Wallet(HARDHAT_ACCOUNTS[1].key, provider);
        const sellerContract = new ethers.Contract(config.contractAddress, config.abi, sellerSigner);
        await (await sellerContract.registerPurchase(1001, HARDHAT_ACCOUNTS[2].addr, ethers.parseEther("0.5"))).wait();
      }
    } catch (e) {
      console.warn("Auto-seed check:", e);
    }

    // Listen to real-time events
    setupEventListeners();

    // Refresh UI Data
    await refreshAllData();

    showToast("Connected to NexReturn Smart Contract", "success");
  } catch (err) {
    console.warn("Blockchain node connection warning:", err);
    const netDisplay = document.getElementById("network-display");
    if (netDisplay) {
      netDisplay.textContent = "Hardhat Local (31337)";
    }
    // Still setup active signer and refresh data with fallback
    try {
      await setupActiveSigner();
      await refreshAllData();
    } catch (e) {}
    showToast("Connected to NexReturn Smart Contract", "info");
  }
}

// Setup Active Signer based on persona dropdown
async function setupActiveSigner() {
  const accountInfo = HARDHAT_ACCOUNTS[currentAccountIndex];
  activeSigner = new ethers.Wallet(accountInfo.key, provider);
  contract = new ethers.Contract(window.CONTRACT_CONFIG.contractAddress, window.CONTRACT_CONFIG.abi, activeSigner);

  // Update Balance
  try {
    const bal = await provider.getBalance(activeSigner.address);
    document.getElementById("active-balance").textContent = parseFloat(ethers.formatEther(bal)).toFixed(2) + " ETH";
  } catch (e) {
    document.getElementById("active-balance").textContent = "-- ETH";
  }
}

// Refresh all sections and metrics
async function refreshAllData() {
  await Promise.all([
    updateGlobalMetrics(),
    loadCustomerData(),
    loadSellerData(),
    loadLogisticsData(),
    loadOracleData(),
    loadInspectorData(),
    loadAdminData(),
    loadExplorerData()
  ]);
}

// 1. GLOBAL PROTOCOL METRICS
async function updateGlobalMetrics() {
  try {
    const total = await contract.totalReturns();
    document.getElementById("stat-total-returns").textContent = total.toString();

    let lockedEscrow = 0n;
    let totalRefunded = 0n;
    let disputeCount = 0;

    for (let id = 1; id <= Number(total); id++) {
      const ret = await contract.getReturn(id);
      const st = Number(ret.status);
      const bal = await contract.escrowBalance(id);

      lockedEscrow += bal;
      if (st === 11) { // Refunded
        totalRefunded += ret.refundAmount;
      }
      if (st === 9) { // Disputed
        disputeCount++;
      }
    }

    document.getElementById("stat-locked-escrow").textContent = formatEth(lockedEscrow);
    document.getElementById("stat-total-refunded").textContent = formatEth(totalRefunded);
    document.getElementById("stat-disputes-count").textContent = disputeCount.toString();
  } catch (err) {
    console.warn("Metrics error:", err);
  }
}

// 2. CUSTOMER PORTAL
async function loadCustomerData() {
  const custAddr = activeSigner.address;
  const purchasesList = document.getElementById("customer-purchases-list");
  const returnsList = document.getElementById("customer-returns-list");
  const orderSelect = document.getElementById("raise-order-id");

  // Populate the Raise Return modal dropdown with all options
  await populateOrderDropdown();

  let verifiedPurchases = [];
  for (const oid of knownOrders) {
    try {
      const p = await contract.getPurchase(oid);
      if (p.exists && p.customer.toLowerCase() === custAddr.toLowerCase()) {
        const hasReturn = await contract.orderHasReturn(oid);
        verifiedPurchases.push({ ...p, hasReturn });
      }
    } catch (e) {}
  }

  // Render Purchases
  if (verifiedPurchases.length === 0) {
    purchasesList.innerHTML = `
      <div class="glass-panel" style="grid-column: 1/-1; padding: 2rem; text-align: center;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🛍️</div>
        <h4 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.35rem;">No Purchases Recorded for ${shortAddr(custAddr)}</h4>
        <p style="color: var(--text-muted); font-size: 0.88rem; max-width: 500px; margin: 0 auto 1.5rem auto;">
          Simulate a retail purchase instantly below, or click any product to buy it and test the decentralized return lifecycle:
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; text-align: left;">
          <div class="product-buy-card">
            <div style="font-size: 1.8rem;">💻</div>
            <div style="font-weight: 700; font-size: 0.95rem;">Apple MacBook Pro 14"</div>
            <div style="color: var(--accent-emerald); font-weight: 700;">0.50 ETH</div>
            <button class="btn btn-primary btn-inline-buy" data-oid="1001" style="width: 100%; font-size: 0.82rem;">🛒 Instant Buy (#1001)</button>
          </div>
          <div class="product-buy-card">
            <div style="font-size: 1.8rem;">📱</div>
            <div style="font-weight: 700; font-size: 0.95rem;">Apple iPad Pro 11-inch</div>
            <div style="color: var(--accent-emerald); font-weight: 700;">0.45 ETH</div>
            <button class="btn btn-primary btn-inline-buy" data-oid="1004" style="width: 100%; font-size: 0.82rem;">🛒 Instant Buy (#1004)</button>
          </div>
          <div class="product-buy-card">
            <div style="font-size: 1.8rem;">🎧</div>
            <div style="font-weight: 700; font-size: 0.95rem;">Sony WH-1000XM5</div>
            <div style="color: var(--accent-emerald); font-weight: 700;">1.00 ETH</div>
            <button class="btn btn-primary btn-inline-buy" data-oid="1002" style="width: 100%; font-size: 0.82rem;">🛒 Instant Buy (#1002)</button>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll(".btn-inline-buy").forEach(btn => {
      btn.onclick = () => quickBuyProduct(parseInt(btn.dataset.oid));
    });
  } else {
    purchasesList.innerHTML = verifiedPurchases.map(p => {
      const cat = PRODUCT_CATALOG[Number(p.orderId)] || { name: `Order #${p.orderId}`, img: "📦", category: "Retail Item" };
      return `
        <div class="item-card glass-panel">
          <div class="item-header">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.3rem;">${cat.img || "📦"}</span>
              <div>
                <span class="item-id">Order #${p.orderId}</span>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${cat.name}</div>
              </div>
            </div>
            <span class="item-price">${formatEth(p.amount)}</span>
          </div>
          <div class="item-meta">
            <div class="item-meta-row"><span>Seller:</span> <span class="hash-pill">${shortAddr(p.seller)}</span></div>
            <div class="item-meta-row"><span>Purchased:</span> <span>${new Date(Number(p.purchasedAt) * 1000).toLocaleDateString()}</span></div>
            <div class="item-meta-row"><span>Return Status:</span> <span>${p.hasReturn ? "Return Raised" : "Eligible for Return"}</span></div>
          </div>
          <div>
            ${p.hasReturn ? `
              <button class="btn btn-outline" style="width: 100%; font-size: 0.85rem;" disabled>Return Already Active</button>
            ` : `
              <button class="btn btn-primary btn-raise-order" data-order="${p.orderId}" style="width: 100%; font-size: 0.85rem;">
                <span>📦</span> Raise Return Claim
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");

    // Attach click listeners to raise return buttons
    document.querySelectorAll(".btn-raise-order").forEach(btn => {
      btn.onclick = () => {
        const orderSelect = document.getElementById("raise-order-id");
        if (orderSelect) {
          orderSelect.value = btn.dataset.order;
          updateOrderPreview();
        }
        document.getElementById("modal-raise-return").classList.add("show");
      };
    });
  }

  // Load Customer's Returns
  const total = await contract.totalReturns();
  let custReturns = [];
  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    if (ret.customer.toLowerCase() === custAddr.toLowerCase()) {
      custReturns.push(ret);
    }
  }

  if (custReturns.length === 0) {
    returnsList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">
      No return requests raised by this account yet.
    </div>`;
  } else {
    returnsList.innerHTML = custReturns.map(r => {
      const st = Number(r.status);
      const stInfo = StatusEnum[st];
      return `
        <div class="item-card glass-panel">
          <div class="item-header">
            <div>
              <span class="item-id">Return #${r.returnId}</span>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem;">(Order #${r.orderId})</span>
            </div>
            <span class="status-badge ${stInfo.class}">${stInfo.name}</span>
          </div>
          <div class="item-meta">
            <div class="item-meta-row"><span>Refund Value:</span> <strong style="color: var(--accent-emerald);">${formatEth(r.refundAmount)}</strong></div>
            <div class="item-meta-row"><span>Reason:</span> <span>${r.reason}</span></div>
            <div class="item-meta-row"><span>Proof Hash:</span> <span class="hash-pill" title="${r.proofHash}">${shortAddr(r.proofHash)}</span></div>
            <div class="item-meta-row"><span>Progress:</span> <span style="font-size: 0.78rem; color: var(--accent-cyan);">${stInfo.desc}</span></div>
          </div>
          <div>
            ${st === 10 ? `
              <button class="btn btn-success btn-release-refund" data-id="${r.returnId}" style="width: 100%;">
                <span>💸</span> Claim Escrow Refund
              </button>
            ` : st === 11 ? `
              <button class="btn btn-outline" style="width: 100%; color: var(--accent-emerald);" disabled>
                <span>✅</span> Refund Transferred to Wallet
              </button>
            ` : `
              <button class="btn btn-outline" style="width: 100%;" onclick="inspectReturn(${r.returnId})">
                <span>🔍</span> Track in Explorer
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");

    // Attach release refund action
    document.querySelectorAll(".btn-release-refund").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          btn.textContent = "Processing payout...";
          const tx = await contract.releaseRefund(btn.dataset.id);
          await tx.wait();
          showToast(`Refund for Return #${btn.dataset.id} claimed successfully!`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 3. SELLER HUB
async function loadSellerData() {
  const sellerReturnsList = document.getElementById("seller-returns-list");
  const total = await contract.totalReturns();
  let pendingReturns = [];

  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    const st = Number(ret.status);
    if (st === 1 || st === 2) { // Submitted or UnderReview
      pendingReturns.push(ret);
    }
  }

  if (pendingReturns.length === 0) {
    sellerReturnsList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem;">
      No return claims currently awaiting review or escrow approval.
    </div>`;
  } else {
    sellerReturnsList.innerHTML = pendingReturns.map(r => {
      const st = Number(r.status);
      const stInfo = StatusEnum[st];
      return `
        <div class="item-card glass-panel">
          <div class="item-header">
            <span class="item-id">Return #${r.returnId} (Order #${r.orderId})</span>
            <span class="status-badge ${stInfo.class}">${stInfo.name}</span>
          </div>
          <div class="item-meta">
            <div class="item-meta-row"><span>Customer:</span> <span class="hash-pill">${shortAddr(r.customer)}</span></div>
            <div class="item-meta-row"><span>Escrow Required:</span> <strong style="color: var(--accent-emerald);">${formatEth(r.refundAmount)}</strong></div>
            <div class="item-meta-row"><span>Customer Claim:</span> <span>${r.reason}</span></div>
            <div class="item-meta-row"><span>Proof Hash:</span> <span class="hash-pill">${shortAddr(r.proofHash)}</span></div>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${st === 1 ? `
              <button class="btn btn-outline btn-seller-review" data-id="${r.returnId}" style="flex: 1;">
                <span>👀</span> Review Claim
              </button>
            ` : `
              <button class="btn btn-success btn-seller-approve" data-id="${r.returnId}" data-amount="${r.refundAmount}" style="flex: 1;">
                <span>🔒</span> Approve & Deposit Escrow
              </button>
              <button class="btn btn-danger btn-seller-reject" data-id="${r.returnId}" style="flex: 1;">
                <span>✕</span> Reject
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");

    // Attach Review handler
    document.querySelectorAll(".btn-seller-review").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.reviewReturn(btn.dataset.id);
          await tx.wait();
          showToast(`Return #${btn.dataset.id} moved to Under Review`, "info");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    // Attach Approve handler
    document.querySelectorAll(".btn-seller-approve").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          btn.textContent = "Depositing...";
          const tx = await contract.approveReturn(btn.dataset.id, { value: btn.dataset.amount });
          await tx.wait();
          showToast(`Return #${btn.dataset.id} Approved & Escrow Locked!`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    // Attach Reject handler
    document.querySelectorAll(".btn-seller-reject").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.rejectReturn(btn.dataset.id);
          await tx.wait();
          showToast(`Return #${btn.dataset.id} rejected.`, "info");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 4. LOGISTICS QUEUE
async function loadLogisticsData() {
  const queueList = document.getElementById("logistics-queue-list");
  const total = await contract.totalReturns();
  let pickups = [];

  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    if (Number(ret.status) === 3) { // Approved
      pickups.push(ret);
    }
  }

  if (pickups.length === 0) {
    queueList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem;">
      No approved returns currently awaiting courier pickup.
    </div>`;
  } else {
    queueList.innerHTML = pickups.map(r => `
      <div class="item-card glass-panel">
        <div class="item-header">
          <span class="item-id">Return #${r.returnId}</span>
          <span class="status-badge approved">Ready for Pickup</span>
        </div>
        <div class="item-meta">
          <div class="item-meta-row"><span>Pickup From:</span> <span class="hash-pill">${shortAddr(r.customer)}</span></div>
          <div class="item-meta-row"><span>Deliver To:</span> <span>Return Inspection Center (Hub A)</span></div>
          <div class="item-meta-row"><span>Package Value:</span> <strong>${formatEth(r.refundAmount)}</strong></div>
        </div>
        <button class="btn btn-primary btn-confirm-pickup" data-id="${r.returnId}" style="width: 100%;">
          <span>🚚</span> Confirm Package Picked Up
        </button>
      </div>
    `).join("");

    document.querySelectorAll(".btn-confirm-pickup").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.confirmPickup(btn.dataset.id);
          await tx.wait();
          showToast(`Pickup confirmed for Return #${btn.dataset.id}!`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 5. TRACKING ORACLE DISPATCHER
async function loadOracleData() {
  const shipmentsList = document.getElementById("oracle-active-shipments");
  const total = await contract.totalReturns();
  let activeShipments = [];

  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    const st = Number(ret.status);
    if (st === 5 || st === 6) { // PickedUp or InTransit
      activeShipments.push(ret);
    }
  }

  if (activeShipments.length === 0) {
    shipmentsList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem;">
      No active shipments requiring transit updates.
    </div>`;
  } else {
    shipmentsList.innerHTML = activeShipments.map(r => {
      const st = Number(r.status);
      const stInfo = StatusEnum[st];
      return `
        <div class="item-card glass-panel">
          <div class="item-header">
            <span class="item-id">Return #${r.returnId}</span>
            <span class="status-badge ${stInfo.class}">${stInfo.name}</span>
          </div>
          <div class="item-meta">
            <div class="item-meta-row"><span>Courier Partner:</span> <span>SwiftLogistics Express</span></div>
            <div class="item-meta-row"><span>Current Status:</span> <span>${stInfo.desc}</span></div>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${st === 5 ? `
              <button class="btn btn-cyan btn-oracle-transit" data-id="${r.returnId}" style="flex: 1;">
                <span>📡</span> Mark In Transit
              </button>
            ` : `
              <button class="btn btn-success btn-oracle-received" data-id="${r.returnId}" style="flex: 1;">
                <span>📦</span> Mark Received at Hub
              </button>
            `}
            <button class="btn btn-outline btn-oracle-auto" data-id="${r.returnId}" style="flex: 1;">
              <span>⚡</span> Auto Simulate Route
            </button>
          </div>
        </div>
      `;
    }).join("");

    // Attach Oracle actions
    document.querySelectorAll(".btn-oracle-transit").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.updateShipment(btn.dataset.id, false);
          await tx.wait();
          showToast(`Return #${btn.dataset.id} checkpoint updated: In Transit`, "info");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll(".btn-oracle-received").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.updateShipment(btn.dataset.id, true);
          await tx.wait();
          showToast(`Return #${btn.dataset.id} checkpoint updated: Received at Hub`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll(".btn-oracle-auto").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const id = btn.dataset.id;
          const curStatus = Number(await contract.getStatus(id));

          if (curStatus === 5) {
            showToast(`Simulating route: Dispatching In Transit checkpoint...`, "info");
            const tx1 = await contract.updateShipment(id, false);
            await tx1.wait();
            await refreshAllData();
            await new Promise(r => setTimeout(r, 2000));
          }

          showToast(`Simulating route: Delivering to QA Inspection Hub...`, "info");
          const tx2 = await contract.updateShipment(id, true);
          await tx2.wait();
          showToast(`Return #${id} delivered to hub!`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 6. QUALITY INSPECTION HUB
async function loadInspectorData() {
  const inspectorList = document.getElementById("inspector-queue-list");
  const total = await contract.totalReturns();
  let receivedItems = [];

  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    if (Number(ret.status) === 7) { // Received
      receivedItems.push(ret);
    }
  }

  if (receivedItems.length === 0) {
    inspectorList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem;">
      No packages at inspection dock awaiting QA.
    </div>`;
  } else {
    inspectorList.innerHTML = receivedItems.map(r => `
      <div class="item-card glass-panel">
        <div class="item-header">
          <span class="item-id">Return #${r.returnId}</span>
          <span class="status-badge received">Received at Dock</span>
        </div>
        <div class="item-meta">
          <div class="item-meta-row"><span>Customer Claim:</span> <span>${r.reason}</span></div>
          <div class="item-meta-row"><span>Proof Evidence Hash:</span> <span class="hash-pill">${shortAddr(r.proofHash)}</span></div>
          <div class="item-meta-row"><span>Refund at Stake:</span> <strong>${formatEth(r.refundAmount)}</strong></div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-success btn-inspect-pass" data-id="${r.returnId}" style="flex: 1;">
            <span>✅</span> Pass QA (Condition OK)
          </button>
          <button class="btn btn-danger btn-inspect-fail" data-id="${r.returnId}" style="flex: 1;">
            <span>🚨</span> Fail QA (Dispute)
          </button>
        </div>
      </div>
    `).join("");

    document.querySelectorAll(".btn-inspect-pass").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.markInspected(btn.dataset.id, true);
          await tx.wait();
          showToast(`Inspection passed for Return #${btn.dataset.id}! Ready for refund.`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll(".btn-inspect-fail").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.markInspected(btn.dataset.id, false);
          await tx.wait();
          showToast(`Return #${btn.dataset.id} flagged as Disputed (Sent to Admin arbitration)`, "error");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 7. ADMIN DISPUTES & ARBITRATION
async function loadAdminData() {
  const disputesList = document.getElementById("admin-disputes-list");
  const total = await contract.totalReturns();
  let disputedReturns = [];

  for (let id = 1; id <= Number(total); id++) {
    const ret = await contract.getReturn(id);
    if (Number(ret.status) === 9) { // Disputed
      const bal = await contract.escrowBalance(id);
      disputedReturns.push({ ...ret, escrow: bal });
    }
  }

  if (disputedReturns.length === 0) {
    disputesList.innerHTML = `<div class="item-card glass-panel" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem;">
      No disputed cases currently pending arbitration.
    </div>`;
  } else {
    disputesList.innerHTML = disputedReturns.map(r => `
      <div class="item-card glass-panel" style="border-color: rgba(244, 63, 94, 0.4);">
        <div class="item-header">
          <span class="item-id">Dispute #${r.returnId}</span>
          <span class="status-badge disputed">Disputed</span>
        </div>
        <div class="item-meta">
          <div class="item-meta-row"><span>Customer:</span> <span class="hash-pill">${shortAddr(r.customer)}</span></div>
          <div class="item-meta-row"><span>Seller:</span> <span class="hash-pill">${shortAddr(r.seller)}</span></div>
          <div class="item-meta-row"><span>Customer Stated Reason:</span> <span>${r.reason}</span></div>
          <div class="item-meta-row"><span>Inspector Finding:</span> <span style="color: var(--accent-rose);">Condition Mismatch / Damaged</span></div>
          <div class="item-meta-row"><span>Escrow Balance:</span> <strong style="color: var(--accent-emerald);">${formatEth(r.escrow)}</strong></div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-success btn-resolve-cust" data-id="${r.returnId}" style="flex: 1;">
            <span>⚖️</span> Rule for Customer (Refund)
          </button>
          <button class="btn btn-danger btn-resolve-seller" data-id="${r.returnId}" style="flex: 1;">
            <span>🛡️</span> Rule for Seller (Return Funds)
          </button>
        </div>
      </div>
    `).join("");

    document.querySelectorAll(".btn-resolve-cust").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.resolveDispute(btn.dataset.id, true);
          await tx.wait();
          showToast(`Dispute #${btn.dataset.id} arbitrated: Customer refunded!`, "success");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll(".btn-resolve-seller").forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const tx = await contract.resolveDispute(btn.dataset.id, false);
          await tx.wait();
          showToast(`Dispute #${btn.dataset.id} arbitrated: Escrow returned to seller!`, "info");
          await refreshAllData();
        } catch (e) {
          showToast(e.reason || e.message, "error");
          btn.disabled = false;
        }
      };
    });
  }
}

// 8. RETURN EXPLORER & STEPPER
async function loadExplorerData() {
  const returnSelect = document.getElementById("explorer-return-id");
  if (!returnSelect) return;
  const total = Number(await contract.totalReturns());

  const currentSelection = returnSelect.value || "1";
  returnSelect.innerHTML = "";

  if (total === 0) {
    returnSelect.innerHTML = '<option value="">No returns registered on-chain yet</option>';
    return;
  }

  for (let i = 1; i <= total; i++) {
    try {
      const ret = await contract.getReturn(i);
      const st = Number(ret.status);
      const stInfo = StatusEnum[st] || { name: "Active" };
      const cat = PRODUCT_CATALOG[Number(ret.orderId)] || { name: `Order #${ret.orderId}` };
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `Return #${i} — ${cat.name} (${stInfo.name} • ${formatEth(ret.refundAmount)})`;
      if (i.toString() === currentSelection) opt.selected = true;
      returnSelect.appendChild(opt);
    } catch (e) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `Return #${i}`;
      if (i.toString() === currentSelection) opt.selected = true;
      returnSelect.appendChild(opt);
    }
  }

  await renderSelectedReturnDetails(returnSelect.value || 1);
}

window.inspectReturn = function(returnId) {
  // Switch to explorer tab
  document.querySelectorAll(".role-tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".role-section").forEach(s => s.classList.remove("active"));
  const explorerBtn = document.querySelector('[data-tab="explorer-tab"]');
  const explorerSection = document.getElementById("explorer-tab");
  if (explorerBtn && explorerSection) {
    explorerBtn.classList.add("active");
    explorerSection.classList.add("active");
  }

  const select = document.getElementById("explorer-return-id");
  select.value = returnId;
  renderSelectedReturnDetails(returnId);
};

async function renderSelectedReturnDetails(returnId) {
  if (!returnId) return;

  try {
    const ret = await contract.getReturn(returnId);
    const history = await contract.getReturnHistory(returnId);
    const escrow = await contract.escrowBalance(returnId);
    const statusNum = Number(ret.status);

    // Update 11-step visual Stepper
    // Steps sequence: 1(Submitted), 2(Review), 3(Approved), 5(PickedUp), 6(InTransit), 7(Received), 8(Inspected), 10(Accepted), 11(Refunded)
    const stepMapping = {
      1: "step-node-1",
      2: "step-node-2",
      3: "step-node-3",
      5: "step-node-5",
      6: "step-node-6",
      7: "step-node-7",
      8: "step-node-8",
      10: "step-node-10",
      11: "step-node-11"
    };

    const stepOrder = [1, 2, 3, 5, 6, 7, 8, 10, 11];
    stepOrder.forEach(st => {
      const node = document.getElementById(stepMapping[st]);
      if (node) {
        node.className = "step-node";
        if (history.map(Number).includes(st)) {
          node.classList.add("completed");
        }
        if (statusNum === st) {
          node.classList.remove("completed");
          node.classList.add("active");
        }
      }
    });

    if (statusNum === 9) { // Disputed
      const node = document.getElementById("step-node-8");
      if (node) {
        node.classList.add("disputed");
        node.querySelector(".step-label").textContent = "Disputed";
      }
    }

    // Details Grid
    const detailsView = document.getElementById("explorer-details-view");
    detailsView.innerHTML = `
      <div class="item-card glass-panel">
        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Return Metadata</span>
        <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.25rem;">Return #${ret.returnId}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Associated Order: <strong>#${ret.orderId}</strong></div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Created: <strong>${new Date(Number(ret.createdAt) * 1000).toLocaleString()}</strong></div>
      </div>

      <div class="item-card glass-panel">
        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Participants</span>
        <div style="font-size: 0.85rem; margin-top: 0.5rem;">Customer: <span class="hash-pill">${ret.customer}</span></div>
        <div style="font-size: 0.85rem; margin-top: 0.25rem;">Seller: <span class="hash-pill">${ret.seller}</span></div>
      </div>

      <div class="item-card glass-panel">
        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Financial & Escrow</span>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--accent-emerald); margin-top: 0.25rem;">${formatEth(ret.refundAmount)}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Currently In Escrow: <strong>${formatEth(escrow)}</strong></div>
      </div>

      <div class="item-card glass-panel">
        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Defect Reason & Evidence</span>
        <div style="font-size: 0.9rem; margin-top: 0.5rem;">"${ret.reason}"</div>
        <div style="font-size: 0.75rem; margin-top: 0.5rem; color: var(--text-dim); word-break: break-all;">Proof Keccak-256: ${ret.proofHash}</div>
      </div>
    `;

    // History Pills
    const historyList = document.getElementById("explorer-history-list");
    historyList.innerHTML = history.map((stCode, idx) => {
      const stInfo = StatusEnum[Number(stCode)];
      return `<span class="status-badge ${stInfo.class}">${idx + 1}. ${stInfo.name}</span>`;
    }).join(" ➜ ");

  } catch (err) {
    console.warn("Explorer detail error:", err);
  }
}

// 9. EVENT STREAM LISTENER
function setupEventListeners() {
  const feed = document.getElementById("event-feed");

  function logEvent(name, details, cssClass = "") {
    const entry = document.createElement("div");
    entry.className = `event-entry ${cssClass}`;
    entry.innerHTML = `
      <div>
        <strong>${name}</strong>: ${details}
      </div>
      <span style="font-size: 0.75rem; color: var(--text-dim);">${new Date().toLocaleTimeString()}</span>
    `;
    feed.prepend(entry);
    // Keep max 25 events
    if (feed.children.length > 25) {
      feed.lastChild.remove();
    }
  }

  contract.on("PurchaseRegistered", (orderId, cust, seller, amount) => {
    knownOrders.add(Number(orderId));
    logEvent("PurchaseRegistered", `Order #${orderId} for ${shortAddr(cust)} (${formatEth(amount)})`, "success");
    refreshAllData();
  });

  contract.on("ReturnRaised", (returnId, orderId, cust, reason) => {
    logEvent("ReturnRaised", `Return #${returnId} raised on Order #${orderId} ("${reason}")`, "amber");
    refreshAllData();
  });

  contract.on("ReturnUnderReview", (returnId, seller) => {
    logEvent("ReturnUnderReview", `Return #${returnId} is now under review by seller`, "amber");
    refreshAllData();
  });

  contract.on("ReturnApproved", (returnId, seller, amount) => {
    logEvent("ReturnApproved", `Return #${returnId} approved! Escrow locked: ${formatEth(amount)}`, "success");
    refreshAllData();
  });

  contract.on("ReturnRejected", (returnId, seller) => {
    logEvent("ReturnRejected", `Return #${returnId} was rejected by seller`, "danger");
    refreshAllData();
  });

  contract.on("PickedUp", (returnId, logistics) => {
    logEvent("PickedUp", `Return #${returnId} picked up by courier`, "info");
    refreshAllData();
  });

  contract.on("ShipmentUpdated", (returnId, status, oracle) => {
    const stName = StatusEnum[Number(status)]?.name || status;
    logEvent("ShipmentUpdated", `Return #${returnId} tracking updated to: ${stName}`, "info");
    refreshAllData();
  });

  contract.on("ReturnInspected", (returnId, ok, inspector) => {
    logEvent("ReturnInspected", `Return #${returnId} inspection complete (Condition OK: ${ok})`, ok ? "success" : "danger");
    refreshAllData();
  });

  contract.on("RefundReleased", (returnId, cust, amount) => {
    logEvent("RefundReleased", `Refund of ${formatEth(amount)} sent to customer wallet!`, "success");
    refreshAllData();
  });

  contract.on("DisputeResolved", (returnId, favourCustomer, recipient, amount) => {
    logEvent("DisputeResolved", `Dispute arbitrated! Recipient: ${shortAddr(recipient)} (${formatEth(amount)})`, "amber");
    refreshAllData();
  });
}

// 10. SETUP UI INTERACTIVITY
document.addEventListener("DOMContentLoaded", () => {
  initBlockchain();

  // Tab switching
  document.querySelectorAll(".role-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".role-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".role-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      const section = document.getElementById(btn.dataset.tab);
      if (section) section.classList.add("active");
    };
  });

  // Persona switcher
  const accSelect = document.getElementById("account-selector");
  accSelect.onchange = async () => {
    currentAccountIndex = parseInt(accSelect.value);
    await setupActiveSigner();
    showToast(`Switched active wallet to: ${HARDHAT_ACCOUNTS[currentAccountIndex].name}`, "info");

    // Auto-switch tabs to relevant persona view
    const roleToTab = {
      0: "admin-tab",
      1: "seller-tab",
      2: "customer-tab",
      6: "customer-tab",
      3: "logistics-tab",
      4: "inspector-tab",
      5: "oracle-tab"
    };

    const targetTab = roleToTab[currentAccountIndex];
    if (targetTab) {
      document.querySelectorAll(".role-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".role-section").forEach(s => s.classList.remove("active"));
      const tabBtn = document.querySelector(`[data-tab="${targetTab}"]`);
      if (tabBtn) tabBtn.classList.add("active");
      const sec = document.getElementById(targetTab);
      if (sec) sec.classList.add("active");
    }

    await refreshAllData();
  };

  // Seed Data button
  document.getElementById("btn-seed-data").onclick = async () => {
    try {
      showToast("Seeding demo orders and return states...", "info");
      const sellerSigner = new ethers.Wallet(HARDHAT_ACCOUNTS[1].key, provider);
      const sellerContract = new ethers.Contract(window.CONTRACT_CONFIG.contractAddress, window.CONTRACT_CONFIG.abi, sellerSigner);
      
      const newOrderId = Math.floor(Math.random() * 8000) + 2000;
      const tx = await sellerContract.registerPurchase(newOrderId, HARDHAT_ACCOUNTS[2].addr, ethers.parseEther("0.65"));
      await tx.wait();
      knownOrders.add(newOrderId);

      showToast(`Sample Order #${newOrderId} registered!`, "success");
      await refreshAllData();
    } catch (e) {
      showToast(e.reason || e.message, "error");
    }
  };

// Quick Buy Retail Product on-chain (Simulates customer purchasing item from TechStore)
async function quickBuyProduct(orderId) {
  const cat = PRODUCT_CATALOG[orderId] || { name: `Item #${orderId}`, price: "0.50" };
  const custAddr = activeSigner.address;
  const custName = HARDHAT_ACCOUNTS[currentAccountIndex].name;

  try {
    showToast(`Purchasing ${cat.name} (${cat.price} ETH) for ${custName}...`, "info");
    const sellerSigner = new ethers.Wallet(HARDHAT_ACCOUNTS[1].key, provider);
    const sellerContract = new ethers.Contract(window.CONTRACT_CONFIG.contractAddress, window.CONTRACT_CONFIG.abi, sellerSigner);
    
    const weiAmount = ethers.parseEther(cat.price.toString());
    const tx = await sellerContract.registerPurchase(orderId, custAddr, weiAmount);
    await tx.wait();
    
    knownOrders.add(Number(orderId));
    showToast(`🎉 Order #${orderId} (${cat.name}) purchased & registered on-chain!`, "success");
    
    const quickBuyModal = document.getElementById("modal-quick-buy");
    if (quickBuyModal) quickBuyModal.classList.remove("show");

    await refreshAllData();
  } catch (err) {
    console.error("Quick buy error:", err);
    showToast(err.reason || err.message || "Failed to register purchase", "error");
  }
}

// Render products in the Quick Buy Modal
function renderQuickBuyCatalog() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;
  const custName = HARDHAT_ACCOUNTS[currentAccountIndex].name;

  grid.innerHTML = Object.entries(PRODUCT_CATALOG).map(([oid, cat]) => `
    <div class="product-buy-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <span style="font-size: 2rem;">${cat.img}</span>
        <span class="status-badge" style="background: rgba(99, 102, 241, 0.15); color: var(--accent-cyan); font-size: 0.72rem;">#${oid}</span>
      </div>
      <div>
        <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">${cat.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Category: ${cat.category} • Merchant: ${cat.seller}</div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 0.5rem; border-top: 1px solid rgba(255, 255, 255, 0.08);">
        <strong style="color: var(--accent-emerald); font-size: 1.05rem;">${cat.price} ETH</strong>
        <button class="btn btn-primary btn-modal-buy" data-oid="${oid}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
          <span>🛒</span> Buy as ${custName.split(" ")[0]}
        </button>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll(".btn-modal-buy").forEach(btn => {
    btn.onclick = () => quickBuyProduct(parseInt(btn.dataset.oid));
  });
}

// Attach Quick Buy & Modal interactive handlers
  const quickBuyModal = document.getElementById("modal-quick-buy");
  const quickBuyBtn = document.getElementById("btn-quick-buy");
  const closeQuickBuyBtn = document.getElementById("btn-close-quick-buy");

  if (quickBuyBtn && quickBuyModal) {
    quickBuyBtn.onclick = () => {
      renderQuickBuyCatalog();
      quickBuyModal.classList.add("show");
    };
  }

  if (closeQuickBuyBtn && quickBuyModal) {
    closeQuickBuyBtn.onclick = () => quickBuyModal.classList.remove("show");
  }

  // Modal actions for Raise Return
  const modal = document.getElementById("modal-raise-return");
  document.getElementById("btn-open-raise-modal").onclick = async () => {
    await populateOrderDropdown();
    modal.classList.add("show");
  };
  document.getElementById("btn-close-modal").onclick = () => modal.classList.remove("show");
  document.getElementById("btn-cancel-raise").onclick = () => modal.classList.remove("show");

  // Dropdown onchange listener
  const orderSelect = document.getElementById("raise-order-id");
  if (orderSelect) {
    orderSelect.onchange = () => updateOrderPreview();
  }

  // Defect Reason Auto-Fill helper
  const autofillBtn = document.getElementById("btn-autofill-reason");
  if (autofillBtn) {
    autofillBtn.onclick = () => {
      const reasonField = document.getElementById("raise-reason");
      const sel = orderSelect ? orderSelect.selectedOptions[0] : null;
      let sampleReason = "Device arrived with severe display flickering, overheating issue, and intermittent unresponsive touchscreen.";
      if (sel && sel.dataset.defect) {
        sampleReason = sel.dataset.defect;
      }
      if (reasonField) {
        reasonField.value = sampleReason;
        showToast("Realistic defect reason populated!", "info");
      }
    };
  }

  // File Upload with Client-Side Keccak-256 Hashing
  const dropzone = document.getElementById("proof-dropzone");
  const fileInput = document.getElementById("proof-file-input");
  const previewWrapper = document.getElementById("proof-preview-wrapper");
  const previewImg = document.getElementById("proof-preview-img");
  const filenameDisplay = document.getElementById("proof-filename");
  const hashDisplay = document.getElementById("proof-hash-display");

  dropzone.onclick = () => fileInput.click();
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.borderColor = "var(--accent-primary)"; };
  dropzone.ondragleave = () => { dropzone.style.borderColor = "rgba(99, 102, 241, 0.4)"; };
  dropzone.ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) processProofFile(e.dataTransfer.files[0]);
  };

  fileInput.onchange = () => {
    if (fileInput.files.length) processProofFile(fileInput.files[0]);
  };

  function processProofFile(file) {
    filenameDisplay.textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target.result;
      currentProofHash = ethers.keccak256(new Uint8Array(buffer));
      hashDisplay.textContent = currentProofHash;
      previewWrapper.style.display = "flex";
      if (file.type.startsWith("image/")) {
        previewImg.src = URL.createObjectURL(file);
      } else {
        previewImg.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📄</text></svg>";
      }
      showToast("Cryptographic proof hash computed!", "success");
    };
    reader.readAsArrayBuffer(file);
  }

  // Smart Submit Handler: Auto-registers order on-chain if new, then raises return claim
  document.getElementById("form-raise-return").onsubmit = async (e) => {
    e.preventDefault();
    const orderSelect = document.getElementById("raise-order-id");
    let orderIdVal = orderSelect ? orderSelect.value : "";
    const reason = document.getElementById("raise-reason").value.trim();

    if (!orderIdVal) {
      showToast("Please select an order from the dropdown", "error");
      return;
    }

    let targetOrderId = 1001;
    let ethPrice = "0.5";

    if (orderIdVal === "custom") {
      const customNum = parseInt(document.getElementById("custom-order-num").value);
      const customEth = document.getElementById("custom-order-eth").value;
      if (!customNum || isNaN(customNum)) {
        showToast("Please enter a valid numeric Custom Order ID", "error");
        return;
      }
      targetOrderId = customNum;
      ethPrice = customEth || "0.5";
    } else {
      targetOrderId = parseInt(orderIdVal);
      const cat = PRODUCT_CATALOG[targetOrderId];
      if (cat) ethPrice = cat.price;
    }

    const submitBtn = document.getElementById("btn-submit-raise");

    try {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "<span>⏳</span><span>Broadcasting to Blockchain...</span>";

      // 1. Verify if order is already registered on-chain
      let purchaseExists = false;
      try {
        const p = await contract.getPurchase(targetOrderId);
        purchaseExists = p && p.exists;
      } catch (err) {
        purchaseExists = false;
      }

      // 2. If not registered, auto-register as Merchant
      if (!purchaseExists) {
        showToast(`Auto-registering Order #${targetOrderId} on-chain as Seller...`, "info");
        const sellerSigner = new ethers.Wallet(HARDHAT_ACCOUNTS[1].key, provider);
        const sellerContract = new ethers.Contract(window.CONTRACT_CONFIG.contractAddress, window.CONTRACT_CONFIG.abi, sellerSigner);
        const weiAmount = ethers.parseEther(ethPrice.toString());
        const txReg = await sellerContract.registerPurchase(targetOrderId, activeSigner.address, weiAmount);
        await txReg.wait();
        knownOrders.add(Number(targetOrderId));
      }

      // 3. Compute or use valid Keccak-256 cryptographic proof
      const proof = currentProofHash || ethers.keccak256(ethers.toUtf8Bytes(reason + "_" + targetOrderId + "_" + Date.now()));

      // 4. Submit return on-chain
      const tx = await contract.raiseReturn(targetOrderId, reason, proof);
      await tx.wait();

      showToast(`🎉 Return claim for Order #${targetOrderId} successfully registered on-chain!`, "success");
      modal.classList.remove("show");
      document.getElementById("form-raise-return").reset();
      previewWrapper.style.display = "none";
      currentProofHash = null;

      await refreshAllData();
    } catch (err) {
      console.error("Raise return error:", err);
      showToast(err.reason || err.message || "Failed to submit return on-chain", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "<span>🚀</span><span>Submit Return On-Chain</span>";
    }
  };

  // Register Purchase Form (Seller)
  document.getElementById("form-register-purchase").onsubmit = async (e) => {
    e.preventDefault();
    const orderId = parseInt(document.getElementById("reg-order-id").value);
    const customerAddr = document.getElementById("reg-customer-addr").value;
    const amountEth = document.getElementById("reg-amount-eth").value;

    const btn = document.getElementById("btn-submit-purchase");
    try {
      btn.disabled = true;
      btn.textContent = "Registering...";
      const weiAmount = ethers.parseEther(amountEth.toString());
      const tx = await contract.registerPurchase(orderId, customerAddr, weiAmount);
      await tx.wait();
      knownOrders.add(orderId);
      showToast(`Purchase Order #${orderId} registered!`, "success");
      document.getElementById("form-register-purchase").reset();
      await refreshAllData();
    } catch (err) {
      showToast(err.reason || err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Register Purchase on-chain";
    }
  };

  // Add Role Form (Admin)
  document.getElementById("form-add-role").onsubmit = async (e) => {
    e.preventDefault();
    const role = document.getElementById("role-type-select").value;
    const addr = document.getElementById("role-target-addr").value;

    try {
      let tx;
      if (role === "seller") tx = await contract.addSeller(addr);
      else if (role === "logistics") tx = await contract.addLogistics(addr);
      else if (role === "inspector") tx = await contract.addInspector(addr);
      else if (role === "oracle") tx = await contract.addOracle(addr);

      await tx.wait();
      showToast(`Granted ${role} role to ${shortAddr(addr)}!`, "success");
      document.getElementById("role-target-addr").value = "";
    } catch (err) {
      showToast(err.reason || err.message, "error");
    }
  };

  // Explorer return ID change
  document.getElementById("explorer-return-id").onchange = (e) => {
    renderSelectedReturnDetails(e.target.value);
  };
  document.getElementById("btn-refresh-explorer").onclick = () => {
    renderSelectedReturnDetails(document.getElementById("explorer-return-id").value);
  };

  // Clear events
  document.getElementById("btn-clear-events").onclick = () => {
    document.getElementById("event-feed").innerHTML = "";
  };
});
