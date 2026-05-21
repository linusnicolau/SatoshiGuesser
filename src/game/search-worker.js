import { deriveAll, randomPrivKey, bytesToHex } from './crypto.js';
import { BloomFilter } from './bloom.js';
import { WalletTable } from './wallet-table.js';

let bloom = null;
let table = null;
let running = false;
let totalSpins = 0;
let batchSize = 1000;

self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === 'init') {
    const { bloomBits, bloomM, bloomK, tableBytes } = data;
    bloom = new BloomFilter(bloomM, bloomK, bloomBits);
    table = new WalletTable(tableBytes);
    self.postMessage({ type: 'status', data: 'initialized' });
  } else if (type === 'start') {
    if (!bloom || !table) {
      self.postMessage({ type: 'error', data: 'Worker not initialized' });
      return;
    }
    if (!running) {
      running = true;
      runBatch();
    }
  } else if (type === 'stop') {
    running = false;
    self.postMessage({ type: 'status', data: 'stopped' });
  }
};

function runBatch() {
  if (!running) return;

  let spinsThisBatch = 0;

  for (let i = 0; i < batchSize; i++) {
    const privKey = randomPrivKey();
    const derived = deriveAll(privKey);
    const candidates = [derived.hash160Uncompressed, derived.hash160Compressed];

    let hit = null;
    for (const h of candidates) {
      if (bloom.has(h)) {
        // Double check against sorted WalletTable
        const balanceSats = table.lookup(h);
        if (balanceSats !== null) {
          hit = { hash160: h, balanceSats };
          break;
        }
      }
    }

    spinsThisBatch++;
    totalSpins++;

    if (hit) {
      running = false;
      self.postMessage({
        type: 'win',
        data: {
          win: true,
          privKey,
          privKeyHex: bytesToHex(privKey),
          derived,
          match: hit
        }
      });
      return;
    }
  }

  // Report progress back to main thread
  self.postMessage({
    type: 'progress',
    data: {
      spins: spinsThisBatch
    }
  });

  // Schedule next batch on the next tick to keep event loop responsive
  setTimeout(runBatch, 0);
}
