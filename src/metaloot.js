// Metaloot platform integration — the single place the game talks to the
// platform (vendor/metaloot.js, loaded as a plain script before this module).
// Every call is fire-and-forget with a swallowing .catch: guest mode, offline,
// or a dead platform must never touch gameplay.

const PLATFORM = 'https://web-production-3191c.up.railway.app'; // platform origin — swapped at deploy time
const GAME = 'nebula-run';
const BEST_KEY = 'nebularun_best';       // same key main.js uses
const SLOT = 'main';

const ML = window.Metaloot || null;
const quiet = (fn) => { try { fn()?.catch?.(() => {}); } catch { /* never throws into the game */ } };
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// cloud save shape — reconciled with localStorage on boot, written on run end
let cloud = { bestScore: 0, runsCompleted: 0, lastScore: 0, lastOutcome: null, updated: 0 };

// ---------------------------------------------------------------- boot
export async function initMetaloot() {
  if (!ML) return;
  try {
    ML.init({ platform: PLATFORM, game: GAME });
    await ML.ready;
    renderChip();
    await loadCloudSave();
  } catch { /* guest / offline — game runs identically */ }
}

// small identity chip, bottom-center, above the overlays
function renderChip() {
  const el = document.getElementById('mlchip');
  if (!el) return;
  if (ML.signedIn) {
    const u = ML.user;
    el.innerHTML = (u.avatar ? `<img src="${esc(u.avatar)}" alt=""/>` : '') +
      `<span><b>${esc(u.username || u.name || 'pilot')}</b> · <span class="sync">synced to Metaloot</span></span>`;
  } else {
    el.innerHTML = ML.loginUrl
      ? `Guest run — <a href="${esc(ML.loginUrl)}">sign in on Metaloot</a> to keep your loot`
      : 'Guest run — sign in on Metaloot to keep your loot';
  }
  el.style.display = 'flex';
}

// pull the cloud save and reconcile best score both directions
export async function loadCloudSave() {
  if (!ML?.signedIn) return;
  const save = await ML.saves.get(SLOT).catch(() => null);
  if (save && save.data) cloud = { ...cloud, ...save.data };
  const local = Number(localStorage.getItem(BEST_KEY) || 0);
  const best = Math.max(local, cloud.bestScore || 0);
  if (best > local) {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
    const bt = document.getElementById('besttext');
    if (bt) bt.textContent = `BEST SCORE — ${best}`;
  }
  if (best > (cloud.bestScore || 0)) { cloud.bestScore = best; saveCloud(); }
  else cloud.bestScore = best;
}

export function saveCloud() {
  if (!ML?.signedIn) return;
  cloud.updated = Date.now();
  quiet(() => ML.saves.put(SLOT, cloud));
}

// ---------------------------------------------------------------- run hooks
// boss down (main.js breach-phase transition) — one-shot artifact
export function reportBossDefeat() {
  quiet(() => ML?.items.grant({
    key: 'warden-core', name: 'Warden Core', kind: 'artifact', icon: '⚡', rarity: 'epic',
    description: "Still humming with the Choir Warden's storm song.",
    quantity: 1, mode: 'set',
  }));
}

// run end, any outcome — cloud save, rewards, character sync
export function reportRunEnd({ outcome, score, kills = 0, shards = 0, time = 0 }) {
  if (!ML) return;
  cloud.runsCompleted = (cloud.runsCompleted || 0) + 1;
  cloud.lastScore = score;
  cloud.lastOutcome = outcome;
  cloud.bestScore = Math.max(cloud.bestScore || 0, score);
  saveCloud();

  if (outcome === 'victory') {
    quiet(() => ML.items.grant({
      key: 'nebula-core', name: 'Nebula Core', kind: 'artifact', icon: '✧', rarity: 'epic',
      description: 'Proof you rode the edge of light through the lanes.',
      quantity: 1, mode: 'set',
    }));
  }
  reportCharacters({ kills, bestScore: cloud.bestScore });
}

// both stances share run stats; level tracks completed runs
export function reportCharacters(stats) {
  const level = Math.max(1, cloud.runsCompleted || 1);
  quiet(() => ML?.characters.upsert({ key: 'tempest', name: 'Tempest Stance', class: 'Storm Skirmisher', level, stats }));
  quiet(() => ML?.characters.upsert({ key: 'bulwark', name: 'Bulwark Stance', class: 'Aegis Breaker', level, stats }));
}
