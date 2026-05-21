import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { BloomFilter } from '../src/game/bloom.js';
import { WalletTable } from '../src/game/wallet-table.js';
import { deriveAll, bytesToHex, privKeyToWif } from '../src/game/crypto.js';

const ROOT = resolve(import.meta.dirname, '..');
const BLOOM_PATH = resolve(ROOT, 'public/data/satoshi-bloom.bin');
const TABLE_PATH = resolve(ROOT, 'public/data/satoshi-wallets.bin');
const STATS_PATH = resolve(ROOT, 'public/data/wallet-stats.json');

// Simple zero-dependency dotenv loader
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let val = match[2].trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          process.env[key] = val;
        }
      }
    } catch (err) {
      console.warn(`[Warning] Could not load .env file: ${err.message}`);
    }
  }
}

loadEnv();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8961307464:AAEKetDqXwpAaKrh2vKlnsw9StMgMvjiAk0';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[Telegram] Skipping notification (Token or Chat ID not configured)');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Telegram Error] Failed to send: ${errText}`);
    }
  } catch (err) {
    console.error(`[Telegram Error] Exception: ${err.message}`);
  }
}

function fmtNumber(n) {
  return n.toLocaleString('en-US');
}

function fmtDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  return `${hours}h ${minutes}m ${seconds}s`;
}

if (isMainThread) {
  // MASTER PROCESS
  console.log('===================================================');
  console.log('       SATOSHI GUESSER - CLOUD MINER 🚀           ');
  console.log('===================================================');

  if (!existsSync(BLOOM_PATH) || !existsSync(TABLE_PATH) || !existsSync(STATS_PATH)) {
    console.error('Error: Wallet files not found. Please run "npm run build" first to generate binary files.');
    process.exit(1);
  }

  const bloomBytes = readFileSync(BLOOM_PATH);
  const tableBytes = readFileSync(TABLE_PATH);
  const stats = JSON.parse(readFileSync(STATS_PATH, 'utf8'));

  const cpuCount = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  console.log(`System: ${os.type()} (${os.arch()}) with ${cpuCount} logical cores`);
  console.log(`Target: ${fmtNumber(stats.walletCount)} Satoshi wallets`);
  console.log(`Jackpot: ${fmtNumber(stats.totalBtc)} BTC (~$${fmtNumber(Math.round(stats.totalBtc * stats.btcUsdApprox))})`);
  console.log(`Telegram Chat ID: ${TELEGRAM_CHAT_ID ? TELEGRAM_CHAT_ID : 'Not Configured (Set TELEGRAM_CHAT_ID)'}`);
  console.log('===================================================\n');

  let totalSpins = 0;
  let lastTotalSpins = 0;
  let spinsSec = 0;
  const startTime = Date.now();

  // Send boot Telegram message
  const bootMessage = `🚀 *SatoshiGuesser Cloud Miner Started!*
💻 *OS:* ${os.type()} (${os.arch()})
🔥 *Threads:* ${cpuCount} CPU cores
💰 *Jackpot:* ${stats.totalBtc.toFixed(2)} BTC (~$${(stats.totalBtc * stats.btcUsdApprox).toLocaleString('en-US')})
🎯 *Target Wallets:* ${fmtNumber(stats.walletCount)}
🕒 *Update Interval:* Every 30 minutes
Status: Running at full speed in the background...`;

  sendTelegramMessage(bootMessage);

  const workers = [];

  // Spawning threads
  for (let i = 0; i < cpuCount; i++) {
    const worker = new Worker(import.meta.filename, {
      workerData: { bloomBytes, tableBytes }
    });

    worker.on('message', (msg) => {
      const { type, data } = msg;
      if (type === 'progress') {
        totalSpins += data.spins;
      } else if (type === 'win') {
        handleWin(data);
      }
    });

    worker.on('error', (err) => {
      console.error(`[Worker Thread ${i} Error]:`, err);
    });

    workers.push(worker);
  }

  // Calculate speed every second
  setInterval(() => {
    spinsSec = totalSpins - lastTotalSpins;
    lastTotalSpins = totalSpins;
  }, 1000);

  // Status log to console every 10 seconds (ideal for cloud server logs)
  setInterval(() => {
    const elapsed = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Checked: ${fmtNumber(totalSpins)} keys | Speed: ${fmtNumber(spinsSec)} keys/sec | Elapsed: ${fmtDuration(elapsed)} | Hits: 0`);
  }, 10000);

  // Periodic Telegram progress update (every 30 minutes)
  setInterval(() => {
    const elapsed = Date.now() - startTime;
    const avgSpeed = Math.round((totalSpins / elapsed) * 1000);
    const progressMessage = `📊 *SatoshiGuesser Progress Update*
⏱ *Elapsed:* ${fmtDuration(elapsed)}
🔑 *Total Checked:* ${fmtNumber(totalSpins)} keys
⚡ *Average Speed:* ${fmtNumber(avgSpeed)} keys/sec
🏆 *Keys Found:* 0
Miner is running healthy! 🟢`;
    sendTelegramMessage(progressMessage);
  }, 30 * 60 * 1000);

  async function handleWin(winData) {
    // Stop all workers immediately
    workers.forEach(w => w.terminate());

    const { privKeyHex, derived, match } = winData;
    const balanceBtc = Number(match.balanceSats) / 100_000_000;
    const address = match.hash160 === derived.hash160Compressed ? derived.addressCompressed : derived.addressUncompressed;
    const privKeyWif = privKeyToWif(derived.privKey, match.hash160 === derived.hash160Compressed);

    const consoleWinStr = `
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨
🎉🎉 URGENT: SATOSHI NAKAMOTO'S PRIVATE KEY FOUND! 🎉🎉
===========================================================
Bitcoin Address:  ${address}
Balance:          ${balanceBtc} BTC
Private Key (Hex): ${privKeyHex}
Private Key (WIF): ${privKeyWif}
===========================================================
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨
    `;
    console.log(consoleWinStr);

    const telegramWinMsg = `🚨🚨🚨 *URGENT: SATOSHI KEY FOUND!* 🚨🚨🚨
The keyspace has been successfully solved!

💰 *Balance:* ${balanceBtc.toFixed(8)} BTC
📍 *Bitcoin Address:* \`${address}\`
🔑 *Private Key (Hex):* \`${privKeyHex}\`
🔐 *Private Key (WIF):* \`${privKeyWif}\`

⚠️ *INSTRUCTIONS:* Sweep this balance immediately into a wallet under your direct control using standard wallet import tools (like Electrum, BlueWallet, or Bitcoin Core). Do not share these credentials with anyone!
💸 *Congratulations!* 💸`;

    await sendTelegramMessage(telegramWinMsg);
    process.exit(0);
  }

  // HTTP Web Dashboard & Health Check (required by Hugging Face Spaces)
  const PORT = process.env.PORT || 7860;
  const server = http.createServer((req, res) => {
    const elapsed = Date.now() - startTime;
    const avgSpeed = Math.round((totalSpins / elapsed) * 1000);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Satoshi Guesser Cloud Miner</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0d0e12; color: #e6e7eb; padding: 2rem; text-align: center; }
    .card { background: #15171f; border: 1px solid #2a2e3d; border-radius: 12px; padding: 2rem; max-width: 600px; margin: 2rem auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    h1 { color: #f7931a; letter-spacing: 0.05em; font-size: 1.8rem; margin-top: 0; }
    .status { color: #2bd47d; font-weight: 800; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 0.1em; display: flex; align-items: center; justify-content: center; gap: 0.4rem; }
    .status-dot { display: inline-block; width: 10px; height: 10px; background: #2bd47d; border-radius: 50%; box-shadow: 0 0 10px #2bd47d; animation: pulse 1.5s infinite; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin: 2rem 0; text-align: left; }
    .stat-box { background: #1d2030; padding: 1rem; border-radius: 8px; border: 1px solid #2a2e3d; }
    .label { font-size: 0.72rem; text-transform: uppercase; color: #8d92a3; letter-spacing: 0.05em; }
    .val { font-size: 1.2rem; font-weight: bold; color: #ffd166; font-family: monospace; margin-top: 0.25rem; }
    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.5; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Satoshi Guesser Cloud Miner 🚀</h1>
    <div class="status">
      <span class="status-dot"></span>
      <span>Active & Searching</span>
    </div>
    
    <div class="stats">
      <div class="stat-box">
        <div class="label">Keys Checked</div>
        <div class="val">${fmtNumber(totalSpins)}</div>
      </div>
      <div class="stat-box">
        <div class="label">Current Speed</div>
        <div class="val">${fmtNumber(spinsSec)} keys/s</div>
      </div>
      <div class="stat-box">
        <div class="label">Average Speed</div>
        <div class="val">${fmtNumber(avgSpeed)} keys/s</div>
      </div>
      <div class="stat-box">
        <div class="label">Elapsed Time</div>
        <div class="val">${fmtDuration(elapsed)}</div>
      </div>
      <div class="stat-box" style="grid-column: span 2;">
        <div class="label">Active Threads</div>
        <div class="val">${cpuCount} cores (${os.type()})</div>
      </div>
      <div class="stat-box" style="grid-column: span 2;">
        <div class="label">Jackpot</div>
        <div class="val" style="color: #2bd47d;">${fmtNumber(stats.totalBtc)} BTC (~$${fmtNumber(Math.round(stats.totalBtc * stats.btcUsdApprox))})</div>
      </div>
    </div>
    
    <p style="font-size: 0.8rem; color: #8d92a3; margin-bottom: 0;">Dashboard auto-refreshes every 5s. Telegram alerts active. 🟢</p>
  </div>
</body>
</html>`);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Web Dashboard] Listening on http://0.0.0.0:${PORT}`);
  });
} else {
  // WORKER THREAD PROCESS
  const { bloomBytes, tableBytes } = workerData;
  const bloom = BloomFilter.deserialize(bloomBytes);
  const table = new WalletTable(tableBytes);

  const batchSize = 10000;
  
  while (true) {
    let hit = null;
    let privKey;
    let derived;

    for (let i = 0; i < batchSize; i++) {
      const buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      derived = deriveAll(buf);
      
      if (bloom.has(derived.hash160Compressed)) {
        const balanceSats = table.lookup(derived.hash160Compressed);
        if (balanceSats !== null) {
          hit = { hash160: derived.hash160Compressed, balanceSats };
          privKey = buf;
          break;
        }
      }
      
      if (bloom.has(derived.hash160Uncompressed)) {
        const balanceSats = table.lookup(derived.hash160Uncompressed);
        if (balanceSats !== null) {
          hit = { hash160: derived.hash160Uncompressed, balanceSats };
          privKey = buf;
          break;
        }
      }
    }

    if (hit) {
      parentPort.postMessage({
        type: 'win',
        data: {
          privKeyHex: bytesToHex(privKey),
          derived,
          match: hit
        }
      });
      break;
    } else {
      parentPort.postMessage({
        type: 'progress',
        data: { spins: batchSize }
      });
    }
  }
}
