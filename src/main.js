import { spin } from './game/spin.js';
import { loadStats, loadBloom, checkHash160s, getRawWalletData } from './game/wallets.js';
import {
  hash160ToAddress,
  randomPrivKey,
  deriveAll,
  parsePrivKey,
} from './game/crypto.js';
import { Log } from './ui/log.js';
import { ClassicReels } from './ui/slot-classic.js';
import { RealisticReels } from './ui/slot-realistic.js';
import { WinDialog } from './ui/win-dialog.js';
import { sfx, setMuted, unlock } from './audio/audio.js';

// Throttle for autospin only — manual spamming has no extra cooldown beyond
// the natural duration of the spin animation. With "no delay" on, autospin
// drops to one frame per spin so the CPU doesn't get pegged.
const AUTOSPIN_DELAY_MS = 250;
const AUTOSPIN_DELAY_NO_DELAY_MS = 16;
const SATS_PER_BTC = 100_000_000;

function fmtNumber(n) {
  return n.toLocaleString('en-US');
}

function fmtUsdShort(usd) {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  return `$${fmtNumber(Math.round(usd))}`;
}

function fmtOdds(walletCount) {
  // 2^256 is huge; use logs for the scientific form.
  // log10(2^256) = 256 * log10(2) ≈ 77.0588
  const log10Keyspace = 256 * Math.log10(2);
  const log10Denom = log10Keyspace - Math.log10(walletCount);
  const exponent = Math.floor(log10Denom);
  const mantissa = Math.pow(10, log10Denom - exponent);
  return `1 in ${mantissa.toFixed(2)} × 10^${exponent}`;
}

function fmtTagline(usd) {
  const billions = Math.floor(usd / 1e9);
  if (billions >= 1) return `Win up to ${fmtNumber(billions)} billion dollars!`;
  const millions = Math.floor(usd / 1e6);
  if (millions >= 1) return `Win up to ${fmtNumber(millions)} million dollars!`;
  return `Win up to ${fmtNumber(Math.floor(usd))} dollars!`;
}

function renderHeaderStats(stats) {
  const totalBtc = stats.totalBtc;
  const totalUsd = totalBtc * stats.btcUsdApprox;
  document.getElementById('tagline').textContent = fmtTagline(totalUsd);
  document.getElementById('stat-jackpot-btc').textContent =
    `${fmtNumber(Math.round(totalBtc))} BTC`;
  document.getElementById('stat-jackpot-usd').textContent =
    `≈ ${fmtUsdShort(totalUsd)}`;
  document.getElementById('stat-odds').textContent = fmtOdds(
    stats.walletCount
  );
  document.getElementById('stat-odds-flavor').textContent =
    'about 10⁷× harder than picking one specific atom in the universe';
  document.getElementById('stat-wallet-count').textContent = fmtNumber(
    stats.walletCount
  );
  document.getElementById('stat-snapshot').textContent =
    `price snapshot: ${stats.priceSnapshotDate}`;
}

function shorten(s, n = 8) {
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

async function main() {
  const stats = await loadStats();
  // Eager-load Bloom so the first spin doesn't have a visible stall.
  loadBloom();

  renderHeaderStats(stats);

  const log = new Log(document.getElementById('log'));
  log.append(
    `Loaded ${stats.walletCount} wallets · jackpot ${stats.totalBtc.toFixed(2)} BTC.`
  );
  log.append(`Odds per spin: ${fmtOdds(stats.walletCount)}.`);
  log.append('Pull the lever.');

  const classic = new ClassicReels(document.getElementById('reels-classic'));
  const realistic = new RealisticReels(
    document.getElementById('reels-realistic')
  );
  classic.show();
  realistic.hide();

  const winDialog = new WinDialog(
    document.getElementById('win-dialog'),
    stats.btcUsdApprox
  );

  const pullBtn = document.getElementById('pull-btn');
  const realisticToggle = document.getElementById('toggle-realistic');
  const noDelayToggle = document.getElementById('toggle-no-delay');
  const autospinToggle = document.getElementById('toggle-autospin');
  const soundToggle = document.getElementById('toggle-sound');

  let realisticMode = false;
  realisticToggle.addEventListener('change', (e) => {
    realisticMode = e.target.checked;
    if (realisticMode) {
      classic.hide();
      realistic.show();
    } else {
      realistic.hide();
      classic.show();
    }
  });

  setMuted(!soundToggle.checked);
  soundToggle.addEventListener('change', (e) => {
    setMuted(!e.target.checked);
  });

  // Web Workers Parallel Search -----------------------------------------------
  const workersToggle = document.getElementById('toggle-workers');
  const threadsInput = document.getElementById('input-threads');
  const turboBadge = document.getElementById('turbo-badge');
  const turboSpeedEl = document.getElementById('turbo-speed');

  if (navigator.hardwareConcurrency) {
    threadsInput.value = Math.max(1, navigator.hardwareConcurrency - 1);
  }

  let activeWorkers = [];
  let workerStats = {
    totalSpins: 0,
    lastTotalSpins: 0,
    startTime: 0,
    intervalId: null,
    logIntervalId: null
  };

  async function startWorkers() {
    if (activeWorkers.length > 0) return;

    log.append('Starting Turbo Parallel Search (Web Workers)...');
    pullBtn.disabled = true;
    turboBadge.classList.remove('hidden');

    const threadCount = parseInt(threadsInput.value, 10) || 4;
    const rawData = await getRawWalletData();

    workerStats.totalSpins = 0;
    workerStats.lastTotalSpins = 0;
    workerStats.startTime = Date.now();

    // Spawn workers
    for (let i = 0; i < threadCount; i++) {
      const worker = new Worker(
        new URL('./game/search-worker.js', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = function (e) {
        const { type, data } = e.data;
        if (type === 'progress') {
          workerStats.totalSpins += data.spins;
        } else if (type === 'win') {
          stopWorkers();

          const result = data;
          const matchedAddress = hash160ToAddress(result.match.hash160);
          log.append(
            `🎉 MATCH (Web Worker): ${matchedAddress} ` +
              `(${(Number(result.match.balanceSats) / SATS_PER_BTC).toFixed(8)} BTC)`
          );

          sfx.win();
          autospinToggle.checked = false;
          winDialog.show(result);
        } else if (type === 'error') {
          log.append(`[Worker Error]: ${data}`);
        }
      };

      worker.postMessage({
        type: 'init',
        data: {
          bloomBits: rawData.bloomBits,
          bloomM: rawData.bloomM,
          bloomK: rawData.bloomK,
          tableBytes: rawData.tableBytes
        }
      });

      worker.postMessage({ type: 'start' });
      activeWorkers.push(worker);
    }

    // Update speed every second
    workerStats.intervalId = setInterval(() => {
      const spinsSinceLast = workerStats.totalSpins - workerStats.lastTotalSpins;
      workerStats.lastTotalSpins = workerStats.totalSpins;
      turboSpeedEl.textContent = fmtNumber(spinsSinceLast);
    }, 1000);

    // Progress log every 3 seconds
    workerStats.logIntervalId = setInterval(() => {
      log.append(`[Turbo] Checked ${fmtNumber(workerStats.totalSpins)} keys...`);
    }, 3000);
  }

  function stopWorkers() {
    if (activeWorkers.length === 0) return;

    clearInterval(workerStats.intervalId);
    clearInterval(workerStats.logIntervalId);

    activeWorkers.forEach((w) => {
      w.postMessage({ type: 'stop' });
      w.terminate();
    });
    activeWorkers = [];

    turboBadge.classList.add('hidden');
    pullBtn.disabled = false;
    log.append(
      `Stopped Turbo Search. Total keys checked in session: ${fmtNumber(workerStats.totalSpins)}`
    );
  }

  workersToggle.addEventListener('change', (e) => {
    if (autospinToggle.checked) {
      if (e.target.checked) {
        startWorkers();
      } else {
        stopWorkers();
        if (!busy) onPull();
      }
    }
  });

  autospinToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      if (workersToggle.checked) {
        startWorkers();
      } else if (!busy) {
        onPull();
      }
    } else {
      if (activeWorkers.length > 0) {
        stopWorkers();
      }
    }
  });

  // Settings dialog ----------------------------------------------------------
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDialog = document.getElementById('settings-dialog');
  const settingsClose = document.getElementById('settings-close');
  const manualInput = document.getElementById('manual-key-input');
  const manualBtn = document.getElementById('manual-check-btn');
  const manualResult = document.getElementById('manual-result');

  settingsBtn.addEventListener('click', () => {
    if (typeof settingsDialog.showModal === 'function') {
      settingsDialog.showModal();
    } else {
      settingsDialog.setAttribute('open', '');
    }
  });
  settingsClose.addEventListener('click', () => settingsDialog.close());

  function setManualResult(text, kind) {
    manualResult.textContent = text;
    manualResult.classList.remove('ok', 'fail', 'err');
    if (kind) manualResult.classList.add(kind);
  }

  async function onManualCheck() {
    setManualResult('', null);
    const raw = manualInput.value.trim();
    if (!raw) {
      setManualResult('Enter a private key first.', 'err');
      return;
    }
    let parsed;
    try {
      parsed = parsePrivKey(raw);
    } catch (err) {
      setManualResult(err.message, 'err');
      return;
    }
    setManualResult('Checking…', null);
    try {
      const derived = deriveAll(parsed.privKey);
      const candidates = [
        derived.hash160Uncompressed,
        derived.hash160Compressed
      ];
      const hit = await checkHash160s(candidates);
      log.append(
        `manual: addr=${derived.addressUncompressed.slice(0, 8)}… ` +
          `(${parsed.format}) → ${hit ? 'MATCH' : 'no match'}`
      );
      if (hit) {
        setManualResult('🎉 Match! Opening prize dialog…', 'ok');
        settingsDialog.close();
        winDialog.show({
          privKey: parsed.privKey,
          derived,
          match: hit
        });
      } else {
        setManualResult(
          `No match. Address: ${derived.addressUncompressed}`,
          'fail'
        );
      }
    } catch (err) {
      setManualResult(`Error: ${err.message}`, 'err');
    }
  }

  manualBtn.addEventListener('click', onManualCheck);
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onManualCheck();
    }
  });

  // Dev-win flag for QA / curious source-readers.
  const devWin = new URLSearchParams(location.search).get('devwin') === '1';

  let busy = false;
  async function onPull() {
    if (busy) return;
    busy = true;
    pullBtn.disabled = true;
    unlock();
    sfx.lever();

    let forced = null;
    if (devWin) {
      // Force a "win" against the genesis address by reusing its hash160.
      // We don't actually have Satoshi's privkey, so the WIF shown will
      // unlock nothing — it's purely for verifying the win UX.
      const priv = randomPrivKey();
      const derived = deriveAll(priv);
      const fakeMatch = {
        hash160: derived.hash160Uncompressed,
        balanceSats: 5_000_000_000n,
      };
      forced = { privKey: priv, match: fakeMatch };
    }

    const reels = realisticMode ? realistic : classic;
    const noDelay = noDelayToggle.checked;

    if (!noDelay) reels.startSpin();

    let result;
    if (noDelay) {
      result = await spin({ devWin: forced });
    } else {
      const spinAnim = new Promise((r) => setTimeout(r, 1100));
      [, result] = await Promise.all([spinAnim, spin({ devWin: forced })]);
    }

    log.append(
      `key=${shorten(result.privKeyHex, 6)} ` +
        `addr=${shorten(result.derived.addressUncompressed, 6)}`
    );

    if (noDelay) {
      if (realisticMode) realistic.flashResult(result.privKeyHex, result.win);
      else classic.flashResult(result.win);
    } else if (realisticMode) {
      await realistic.stopSpin(result.privKeyHex, result.win);
    } else {
      await classic.stopSpin(result.win);
    }

    if (result.win) {
      const matchedAddress = hash160ToAddress(result.match.hash160);
      log.append(
        `🎉 MATCH: ${matchedAddress} ` +
          `(${(Number(result.match.balanceSats) / SATS_PER_BTC).toFixed(8)} BTC)`
      );
      sfx.win();
      // Stop autospin on win — let the player see what happened.
      if (autospinToggle.checked) autospinToggle.checked = false;
      winDialog.show(result);
    } else {
      log.append('→ no match');
      sfx.lose();
    }

    busy = false;
    pullBtn.disabled = false;

    if (autospinToggle.checked) {
      const delay = noDelayToggle.checked
        ? AUTOSPIN_DELAY_NO_DELAY_MS
        : AUTOSPIN_DELAY_MS;
      setTimeout(onPull, delay);
    }
  }

  pullBtn.addEventListener('click', onPull);
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (settingsDialog.open || document.getElementById('win-dialog').open) return;
    if (activeWorkers.length > 0) return; // Ignore spacebar if Web Workers are active
    e.preventDefault();
    onPull();
  });
}

main().catch((err) => {
  console.error(err);
  const log = document.getElementById('log');
  if (log) log.value = `Error: ${err.message}`;
});
