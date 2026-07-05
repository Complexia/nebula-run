import * as THREE from 'three';
import { clamp, fmtTime } from './utils.js';
import { World, TRACK } from './world.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { Player } from './player.js';
import { initMetaloot, reportRunEnd } from './metaloot.js';

const BEST_SCORE_KEY = 'nebularun_best';        // shared with the Metaloot cloud save
const BEST_TIME_KEY = 'nebularun_best_time';

// ---- renderer / scene -------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 1600);

scene.add(new THREE.HemisphereLight(0x9aa3ff, 0x0a0814, 0.8));
const dir = new THREE.DirectionalLight(0xaaccff, 0.7);
dir.position.set(80, 120, -70);
scene.add(dir);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- systems ----------------------------------------------------------------
const world = new World(scene);
const fx = new FX(scene);
const audio = new AudioSys();
const hud = new HUD();
const player = new Player(scene);

const state = {
  phase: 'menu',   // menu | playing | paused | dead | won
  runTime: 0,
  score: 0,
  sector: 1,
  shield: 3,
};

const input = { keys: {}, steer: 0, boost: false, brake: false, mouseX: 0, locked: false };

window.__nebula = { scene, camera, world, player, state, input, hud };

// ---- input ------------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  input.keys[e.code] = true;

  if (state.phase === 'playing') {
    if (e.code === 'Space') { input.boost = true; audio.boostStart(); e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.brake = true;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR') restart();
  } else if (state.phase === 'paused') {
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  } else if (state.phase === 'menu' || state.phase === 'dead' || state.phase === 'won') {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      state.phase === 'menu' ? startRun() : restart();
    }
  }
});

addEventListener('keyup', (e) => {
  input.keys[e.code] = false;
  if (e.code === 'Space') input.boost = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.brake = false;
});

function updateSteer() {
  if (input.locked) {
    input.steer = clamp(input.mouseX * 1.6, -1, 1);
    return;
  }
  let s = 0;
  if (input.keys['KeyA'] || input.keys['ArrowLeft']) s -= 1;
  if (input.keys['KeyD'] || input.keys['ArrowRight']) s += 1;
  input.steer = s;
}

// optional mouse steering: click the canvas to lock the pointer
addEventListener('mousedown', (e) => {
  if (state.phase === 'playing' && e.button === 0 && !input.locked) {
    document.body.requestPointerLock?.();
  }
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement && state.phase === 'playing') {
    input.mouseX = clamp(input.mouseX + e.movementX * 0.0026, -1, 1);
  }
});
addEventListener('pointerlockchange', () => {
  input.locked = !!document.pointerLockElement;
  if (!input.locked) input.mouseX = 0;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.phase === 'playing') togglePause();
});

// ---- flow ---------------------------------------------------------------
function togglePause() {
  if (state.phase === 'playing') {
    state.phase = 'paused';
    document.getElementById('pauseov').classList.remove('hidden');
    document.body.classList.remove('hud-on');
    audio.stopAll();
  } else if (state.phase === 'paused') {
    state.phase = 'playing';
    document.getElementById('pauseov').classList.add('hidden');
    document.body.classList.add('hud-on');
  }
}

document.getElementById('startbtn').onclick = startRun;
document.getElementById('retrybtn').onclick = restart;
document.getElementById('againbtn').onclick = restart;
document.getElementById('resumebtn').onclick = togglePause;

function hideOverlays() {
  for (const id of ['startov', 'deathov', 'winov', 'pauseov']) {
    document.getElementById(id).classList.add('hidden');
  }
}

function startRun() {
  hideOverlays();
  document.body.classList.add('hud-on');
  resetGame();
  state.phase = 'playing';
  snapCamera();
  setTimeout(() => {
    if (state.phase === 'playing' && state.runTime < 6) hud.showToast('HOLD SPACE TO BOOST', 1500);
  }, 2200);
}

function restart() {
  startRun();
}

function resetGame() {
  fx.clear();
  world.reset();
  world.ensure(460);
  player.reset(0);

  state.runTime = 0;
  state.score = 0;
  state.sector = 1;
  state.shield = 3;

  hud.reset();
  hud.setLap(1, TRACK.sectors);
  hud.setBest(loadBestTime());
  hud.setSpeed(player.getKmh());

  input.steer = 0;
  input.boost = false;
  input.brake = false;
  input.mouseX = 0;
}

function loadBestTime() {
  return parseFloat(localStorage.getItem(BEST_TIME_KEY) || '0') || 0;
}

function loadBestScore() {
  return parseInt(localStorage.getItem(BEST_SCORE_KEY) || '0', 10) || 0;
}

function endRun(victory) {
  state.phase = victory ? 'won' : 'dead';
  document.body.classList.remove('hud-on');
  audio.stopAll();

  const finalScore = Math.floor(state.score);
  const finalTime = state.runTime;

  // best score is shared with the Metaloot cloud save
  if (finalScore > loadBestScore()) {
    try { localStorage.setItem(BEST_SCORE_KEY, String(finalScore)); } catch {}
  }

  if (victory) {
    const prev = loadBestTime();
    const record = prev === 0 || finalTime < prev;
    if (record) {
      try { localStorage.setItem(BEST_TIME_KEY, String(finalTime)); } catch {}
      hud.setBest(finalTime);
    }
    document.getElementById('winov').classList.remove('hidden');
    document.getElementById('winstats').innerHTML =
      `SCORE <span class="v">${finalScore.toLocaleString()}</span> &nbsp;&nbsp; TIME <span class="v">${fmtTime(finalTime)}</span>` +
      (record ? ' &nbsp;&nbsp; <span class="v">NEW RECORD!</span>' : '');
    audio.win();
    reportRunEnd({ outcome: 'victory', score: finalScore, time: finalTime });
  } else {
    document.getElementById('deathov').classList.remove('hidden');
    document.getElementById('deathcause').textContent = 'Hull integrity depleted. Weave between the blocks — grazes are forgiven, impacts are not.';
    document.getElementById('deathstats').innerHTML =
      `SCORE <span class="v">${finalScore.toLocaleString()}</span> &nbsp;&nbsp; SECTOR <span class="v">${state.sector} / ${TRACK.sectors}</span>`;
    audio.crash();
    reportRunEnd({ outcome: 'crash', score: finalScore, time: finalTime });
  }
}

// ---- per-frame gameplay -------------------------------------------------
const hitFlashEl = document.getElementById('hitflash');
const speedFxEl = document.getElementById('speedfx');
let flashTimer = null;

function hitFlash() {
  if (!hitFlashEl) return;
  hitFlashEl.style.opacity = '1';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hitFlashEl.style.opacity = '0'; }, 90);
}

let edgeCooldown = 0;
let boostSpawn = 0;

function updatePlaying(dt) {
  player.update(dt, world, input);
  world.ensure(player.s + 460);
  world.update(dt, player.s);

  const events = world.collect(player.prevS, player.s, player.lat, player.iframes <= 0);

  for (const p of events.pickups) {
    state.score += 1500 * hud.combo;
    hud.addCombo(0.25);
    player.addBoost(0.12);
    audio.pickup();
    fx.burst(p.pos, 0xffe066, 12, 40);
  }

  for (const g of events.gates) {
    state.score += (g.perfect ? 6000 : 3000) * hud.combo;
    hud.addCombo(g.perfect ? 0.6 : 0.3);
    player.addBoost(g.perfect ? 0.35 : 0.2);
    audio.gate(g.perfect);
    fx.burst(g.pos, g.perfect ? 0x00f0ff : 0xff4fd8, 16, 60, 0.6);
    hud.showToast(g.perfect ? 'PERFECT GATE' : 'GATE CLEARED');
  }

  for (const h of events.hits) {
    state.shield--;
    hud.setShield(state.shield);
    hud.resetCombo();
    player.applyHit();
    fx.shake(0.55);
    fx.burst(h.pos, 0xff4060, 22, 55, 0.7);
    hitFlash();
    audio.hit();
    if (state.shield <= 0) {
      fx.crashBurst(player.getPosition());
      endRun(false);
      return;
    }
    hud.showToast(state.shield === 1 ? 'SHIELD CRITICAL' : 'SHIELD HIT');
  }

  // scraping the lane edge
  edgeCooldown -= dt;
  if (player.edge && edgeCooldown <= 0) {
    edgeCooldown = 0.25;
    fx.shake(0.12);
    fx.burst(player.getPosition(), 0x00f0ff, 4, 20, 0.3);
  }

  // boost exhaust
  if (player.boosting) {
    boostSpawn -= dt;
    if (boostSpawn <= 0) {
      boostSpawn = 0.03;
      fx.boostTrail(player.getPosition(), world.tangentAt(player.s));
    }
  }

  // score trickle + timers
  state.score += player.getKmh() * 0.25 * hud.combo * dt;
  state.runTime += dt;

  // sector progress
  const sector = Math.min(TRACK.sectors, 1 + Math.floor(player.s / TRACK.sectorLen));
  if (sector > state.sector) {
    state.sector = sector;
    hud.setLap(sector, TRACK.sectors);
    hud.showToast(`SECTOR ${String(sector).padStart(2, '0')} / ${String(TRACK.sectors).padStart(2, '0')}`);
    audio.gate(false);
  }

  if (player.s >= TRACK.finishS) {
    endRun(true);
    return;
  }

  // HUD
  hud.updateScore(state.score);
  hud.setTime(state.runTime);
  hud.setSpeed(player.getKmh());
  hud.setBoost(player.getBoost());
  hud.decayCombo(dt);

  audio.playEngine(player.getKmh());

  const speedNorm = clamp((player.speed - 26) / 45, 0, 1);
  if (speedFxEl) speedFxEl.style.opacity = String(0.3 + speedNorm * 0.7);
}

// ---- camera -----------------------------------------------------------------
function snapCamera() {
  const pos = world.worldPos(player.s - 15, 0);
  pos.y += 5.2;
  camera.position.copy(pos);
  const look = world.worldPos(player.s + 26, 0);
  look.y += 2.3;
  camera.lookAt(look);
}

function updateChaseCamera(dt) {
  const back = 13.5 + player.speed * 0.045;
  const target = world.worldPos(player.s - back, player.lat * 0.5);
  target.y += 5.1 + (player.boosting ? 0.4 : 0);
  camera.position.lerp(target, 1 - Math.exp(-9 * dt));

  const look = world.worldPos(player.s + 26, player.lat * 0.25);
  look.y += 2.3;
  camera.lookAt(look);

  // bank into turns
  camera.rotateZ(clamp(-player.latVel * 0.012, -0.16, 0.16));

  // speed widens the lens
  const speedNorm = clamp((player.speed - 26) / 45, 0, 1);
  const targetFov = 68 + speedNorm * 12 + (player.boosting ? 6 : 0);
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
  camera.updateProjectionMatrix();

  // shake
  const t2 = fx.trauma * fx.trauma;
  if (t2 > 0.0001) {
    camera.position.x += (Math.random() - 0.5) * t2 * 1.6;
    camera.position.y += (Math.random() - 0.5) * t2 * 1.6;
    camera.rotateZ((Math.random() - 0.5) * t2 * 0.06);
  }
}

function updateMenuCamera(now) {
  const t = now * 0.0004;
  const s = 40 + Math.sin(t * 0.5) * 12;
  const p = world.worldPos(s, 0);
  camera.position.set(p.x + Math.sin(t) * 20, p.y + 8 + Math.sin(t * 0.7) * 2, p.z - 26);
  const look = world.worldPos(s + 40, 0);
  look.y += 2;
  camera.lookAt(look);
}

// ---- minimap ------------------------------------------------------------
const minimapCanvas = document.getElementById('minimapcanvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function drawMinimap() {
  if (!minimapCtx) return;
  const w = minimapCanvas.width, h = minimapCanvas.height;
  minimapCtx.fillStyle = 'rgba(3,5,16,0.92)';
  minimapCtx.fillRect(0, 0, w, h);

  const back = 40, ahead = 300, span = back + ahead;
  const cx0 = world.centerX(player.s);
  const N = 48;

  minimapCtx.strokeStyle = '#c026ff';
  minimapCtx.lineWidth = 2;
  minimapCtx.shadowColor = '#c026ff';
  minimapCtx.shadowBlur = 5;
  minimapCtx.beginPath();
  for (let i = 0; i <= N; i++) {
    const s = player.s - back + (span * i) / N;
    const px = (i / N) * w;
    const py = clamp(h / 2 + (world.centerX(s) - cx0) * 0.55, 4, h - 4);
    i === 0 ? minimapCtx.moveTo(px, py) : minimapCtx.lineTo(px, py);
  }
  minimapCtx.stroke();
  minimapCtx.shadowBlur = 0;

  // finish marker
  if (TRACK.finishS > player.s - back && TRACK.finishS < player.s + ahead) {
    const px = ((TRACK.finishS - (player.s - back)) / span) * w;
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.moveTo(px, 3);
    minimapCtx.lineTo(px, h - 3);
    minimapCtx.stroke();
  }

  // player dot
  minimapCtx.fillStyle = '#00f0ff';
  minimapCtx.beginPath();
  minimapCtx.arc((back / span) * w, h / 2, 3.2, 0, Math.PI * 2);
  minimapCtx.fill();
}

// ---- loop -----------------------------------------------------------------
let last = performance.now();
let frame = 0;

function gameLoop(now = performance.now()) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  updateSteer();

  if (state.phase === 'playing') {
    updatePlaying(dt);
  }

  // fx keep animating in every phase for a live backdrop
  fx.update(dt, world, player.s, state.phase === 'playing' ? clamp((player.speed - 26) / 45, 0, 1) : 0.1);

  if (state.phase === 'playing' || state.phase === 'paused') {
    updateChaseCamera(dt);
  } else if (state.phase === 'menu') {
    updateMenuCamera(now);
    world.update(dt, 40);
  } else {
    // dead / won: hold a slow drift around the wreck / finish
    updateChaseCamera(dt * 0.3);
    world.update(dt, player.s);
  }

  if (state.phase === 'playing' && frame % 3 === 0) drawMinimap();

  renderer.render(scene, camera);
  frame++;
  requestAnimationFrame(gameLoop);
}

// ---- boot -----------------------------------------------------------------
function boot() {
  initMetaloot();
  world.ensure(500);
  world.update(0, 40);

  const bt = document.getElementById('besttext');
  if (bt) {
    const bs = loadBestScore(), btm = loadBestTime();
    const parts = [];
    if (bs > 0) parts.push(`BEST SCORE ${bs.toLocaleString()}`);
    if (btm > 0) parts.push(`BEST TIME ${fmtTime(btm)}`);
    bt.textContent = parts.join(' • ');
  }
  hud.setBest(loadBestTime());

  document.getElementById('startov').classList.remove('hidden');
  gameLoop();
}

boot();
