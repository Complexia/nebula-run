const BEST_KEY = 'nebularun_best';
const SESSION_URL = '/auth/metaloot/session';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

let session = { signedIn: false };
let cloud = { bestScore: 0, runsCompleted: 0, lastScore: 0, lastOutcome: null, updated: 0 };

export async function initMetaloot() {
  await refreshMetalootSession();
  renderChip();
  await loadCloudSave();

  window.addEventListener('focus', async () => {
    await refreshMetalootSession();
    renderChip();
  });
}

async function refreshMetalootSession() {
  try {
    const response = await fetch(SESSION_URL, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    session = response.ok ? await response.json() : { signedIn: false };
  } catch {
    session = { signedIn: false };
  }
  return session;
}

function renderChip() {
  const el = document.getElementById('mlchip');
  if (!el) return;

  if (!session.signedIn) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const user = session.user || {};
  const name = user.name || user.email || 'Metaloot player';
  const avatar = user.imageUrl ? `<img src="${esc(user.imageUrl)}" alt=""/>` : '';
  el.innerHTML = `${avatar}<span><b>${esc(name)}</b> · <span class="sync">signed in with Metaloot</span></span>`;
  el.style.display = 'flex';
}

export async function loadCloudSave() {
  if (!session.signedIn) return;

  const local = Number(localStorage.getItem(BEST_KEY) || 0);
  const best = Math.max(local, cloud.bestScore || 0);
  cloud.bestScore = best;

  const bt = document.getElementById('besttext');
  if (bt && best > 0) bt.textContent = `BEST SCORE ${best.toLocaleString()}`;
}

export function saveCloud() {
  if (!session.signedIn) return;
  cloud.updated = Date.now();
}

export function reportBossDefeat() {
  if (!session.signedIn) return;
}

export function reportRunEnd({ outcome, score }) {
  if (!session.signedIn) return;

  cloud.runsCompleted = (cloud.runsCompleted || 0) + 1;
  cloud.lastScore = score;
  cloud.lastOutcome = outcome;
  cloud.bestScore = Math.max(cloud.bestScore || 0, score);
  saveCloud();
  reportCharacters({ bestScore: cloud.bestScore });
}

export function reportCharacters(stats) {
  if (!session.signedIn) return;
  cloud.lastCharacterStats = stats;
}
