import { fmtTime } from './utils.js';

export class HUD {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.comboEl = document.getElementById('combo');
    this.timeEl = document.getElementById('time');
    this.lapEl = document.getElementById('lap');
    this.speedEl = document.getElementById('speedval');
    this.speedBigEl = document.getElementById('speedbig');
    this.boostArc = document.getElementById('boostarc');
    this.boostPct = document.getElementById('boostpct');
    this.bestEl = document.getElementById('besttime');
    this.toastEl = document.getElementById('toast');
    this.trackEl = document.getElementById('trackname');
    this.pips = Array.from(document.querySelectorAll('#shield .pip'));

    this.combo = 1.0;
    this.comboTimer = 0;
    this._toastTimer = null;
  }

  setBest(t) {
    if (this.bestEl) this.bestEl.textContent = t > 0 ? fmtTime(t) : '--:--';
  }

  updateScore(val) {
    if (this.scoreEl) {
      this.scoreEl.innerHTML = `<span class="num">${Math.floor(val).toLocaleString()}</span>`;
    }
  }

  setTime(sec) {
    if (this.timeEl) this.timeEl.textContent = fmtTime(sec);
  }

  setLap(current, total = 8) {
    if (this.lapEl) this.lapEl.textContent = `${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  }

  setSpeed(kmh) {
    const s = Math.floor(kmh).toLocaleString();
    if (this.speedEl) this.speedEl.textContent = s;
    if (this.speedBigEl) this.speedBigEl.textContent = s;
  }

  setBoost(b) {
    if (this.boostPct) this.boostPct.textContent = String(Math.floor(b * 100)).padStart(2, '0');
    if (this.boostArc) {
      const circ = 263.9;
      this.boostArc.setAttribute('stroke-dashoffset', String(circ * (1 - b)));
      this.boostArc.style.stroke = b > 0.65 ? '#ff8a00' : '#c026ff';
    }
  }

  setShield(n) {
    this.pips.forEach((p, i) => p.classList.toggle('off', i >= n));
  }

  setTrack(name) {
    if (this.trackEl) this.trackEl.textContent = name;
  }

  addCombo(amount = 0.2) {
    this.combo = Math.min(8, this.combo + amount);
    this.comboTimer = 2.5;
  }

  resetCombo() {
    this.combo = 1.0;
    this.comboTimer = 0;
  }

  decayCombo(dt) {
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.combo = Math.max(1.0, this.combo - dt * 0.5);
    if (this.comboEl) {
      this.comboEl.textContent = `x${this.combo.toFixed(1)} COMBO`;
      this.comboEl.style.color = this.combo > 4 ? '#ff6ad8' : (this.combo > 2 ? '#c026ff' : '#a89cd8');
    }
  }

  showToast(text, ms = 1200) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  reset() {
    this.resetCombo();
    this.updateScore(0);
    this.setTime(0);
    this.setShield(3);
    this.decayCombo(0);
  }
}
