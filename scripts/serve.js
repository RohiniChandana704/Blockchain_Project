const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const ETHERS_DIST = path.join(__dirname, "..", "node_modules", "ethers", "dist", "ethers.umd.min.js");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf"
};

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  let reqPath = decodeURI(req.url.split("?")[0]);

  // Route: /ethers.umd.min.js or /js/ethers.umd.min.js
  if (reqPath === "/ethers.umd.min.js" || reqPath === "/js/ethers.umd.min.js") {
    if (fs.existsSync(ETHERS_DIST)) {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      return fs.createReadStream(ETHERS_DIST).pipe(res);
    }
  }

  // Default to index.html
  if (reqPath === "/" || reqPath === "") {
    reqPath = "/index.html";
  }

  const filePath = path.join(FRONTEND_DIR, reqPath);

  // Security check: ensure path stays within FRONTEND_DIR
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA if not found
      const indexPath = path.join(FRONTEND_DIR, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return fs.createReadStream(indexPath).pipe(res);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 NexReturn Web Application Server Running at:`);
  console.log(`   👉 Local:   http://localhost:${PORT}`);
  console.log(`   👉 Network: http://127.0.0.1:${PORT}`);
  console.log(`   📂 Serving: ${FRONTEND_DIR}\n`);
});
