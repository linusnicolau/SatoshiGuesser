import { BloomFilter } from './bloom.js';
import { WalletTable } from './wallet-table.js';

let _bloom = null;
let _tablePromise = null;
let _stats = null;

export async function loadBloom() {
  if (_bloom) return _bloom;
  const buf = await fetch('/data/satoshi-bloom.bin').then((r) =>
    r.arrayBuffer()
  );
  _bloom = BloomFilter.deserialize(new Uint8Array(buf));
  return _bloom;
}

export async function loadStats() {
  if (_stats) return _stats;
  _stats = await fetch('/data/wallet-stats.json').then((r) => r.json());
  return _stats;
}

async function loadTable() {
  if (!_tablePromise) {
    _tablePromise = fetch('/data/satoshi-wallets.bin')
      .then((r) => r.arrayBuffer())
      .then((buf) => new WalletTable(new Uint8Array(buf)));
  }
  return _tablePromise;
}

/**
 * Probe candidate hash160s. Returns the first {hash160, balanceSats}
 * that survives both the Bloom filter and the sorted-table confirmation,
 * or null. The Bloom check is O(k) — fast, in-memory. The table lookup
 * is only triggered on a Bloom hit.
 */
export async function checkHash160s(candidates) {
  const bloom = await loadBloom();
  const hits = [];
  for (const h of candidates) {
    if (bloom.has(h)) hits.push(h);
  }
  if (hits.length === 0) return null;

  const tbl = await loadTable();
  for (const h of hits) {
    const balanceSats = tbl.lookup(h);
    if (balanceSats !== null) {
      return { hash160: h, balanceSats };
    }
  }
  return null;
}

export async function getRawWalletData() {
  const bloom = await loadBloom();
  const tbl = await loadTable();
  return {
    bloomBits: bloom.bits,
    bloomM: bloom.m,
    bloomK: bloom.k,
    tableBytes: tbl.bytes
  };
}

