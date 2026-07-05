// Simple WebAudio procedural engine for Nebula Run

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.enabled = true;
    this.lastPickup = 0;
  }

  _ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  }

  playEngine(speed) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.engine) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 620;
      o.type = 'sawtooth';
      o.frequency.value = 36;
      g.gain.value = 0.012;
      const n = this.ctx.createBufferSource();
      // simple noise for engine rumble
      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;
      noise.loop = true;
      const ng = this.ctx.createGain();
      ng.gain.value = 0.008;
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 140;
      nf.Q.value = 1.6;

      const merge = this.ctx.createGain();
      o.connect(f);
      f.connect(g);
      noise.connect(nf);
      nf.connect(ng);
      g.connect(merge);
      ng.connect(merge);
      merge.connect(this.master);
      o.start();
      noise.start();
      this.engine = { o, g, ng, f, nf, base: 36 };
    }
    const s = Math.max(0.6, Math.min(1.9, speed / 1350));
    this.engine.o.frequency.value = this.engine.base * (0.7 + s * 0.9);
    this.engine.g.gain.value = 0.009 * (0.6 + s * 0.6);
    this.engine.ng.gain.value = 0.006 * (0.4 + s * 0.5);
  }

  pickup() {
    if (!this.enabled) return;
    this._ensure();
    const t = this.ctx.currentTime;
    if (t - this.lastPickup < 0.05) return;
    this.lastPickup = t;

    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sine';
    o.frequency.value = 820;
    f.type = 'lowpass';
    f.frequency.value = 1800;
    g.gain.value = 0.22;

    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 1320;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.12;

    o.connect(f); f.connect(g); g.connect(this.master);
    o2.connect(g2); g2.connect(this.master);

    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.22, now);
    g.gain.linearRampToValueAtTime(0.0001, now + 0.28);
    o.frequency.setValueAtTime(820, now);
    o.frequency.linearRampToValueAtTime(1340, now + 0.24);
    o2.frequency.setValueAtTime(1320, now);
    o2.frequency.linearRampToValueAtTime(1680, now + 0.18);

    o.start(now);
    o2.start(now);
    o.stop(now + 0.32);
    o2.stop(now + 0.3);
  }

  boostStart() {
    if (!this.enabled) return;
    this._ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = 68;
    f.type = 'lowpass'; f.frequency.value = 980;
    g.gain.value = 0.1;
    o.connect(f); f.connect(g); g.connect(this.master);
    const now = this.ctx.currentTime;
    o.frequency.setValueAtTime(68, now);
    o.frequency.linearRampToValueAtTime(190, now + 0.6);
    g.gain.setValueAtTime(0.1, now);
    g.gain.linearRampToValueAtTime(0.001, now + 0.7);
    o.start(now);
    o.stop(now + 0.75);
  }

  hit() {
    if (!this.enabled) return;
    this._ensure();
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(110, now);
    o.frequency.linearRampToValueAtTime(42, now + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, now);
    g.gain.linearRampToValueAtTime(0.001, now + 0.28);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + 0.3);

    const n = this.ctx.createBufferSource();
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = b;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 380; nf.Q.value = 0.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.3, now);
    ng.gain.linearRampToValueAtTime(0.001, now + 0.26);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(now);
  }

  gate(perfect = false) {
    if (!this.enabled) return;
    this._ensure();
    const now = this.ctx.currentTime;
    const notes = perfect ? [660, 880, 1320] : [520, 780];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      const st = now + i * 0.06;
      g.gain.setValueAtTime(0.16, st);
      g.gain.linearRampToValueAtTime(0.001, st + 0.4);
      o.start(st); o.stop(st + 0.45);
    });
  }

  crash() {
    if (!this.enabled) return;
    this._ensure();
    const now = this.ctx.currentTime;
    // low thump + noise
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 48;
    const g = this.ctx.createGain();
    g.gain.value = 0.8;
    o.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.8, now);
    g.gain.linearRampToValueAtTime(0.001, now + 0.9);

    const n = this.ctx.createBufferSource();
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.1, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = b;
    const ng = this.ctx.createGain();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.value = 420;
    ng.gain.value = 0.65;
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    ng.gain.setValueAtTime(0.65, now);
    ng.gain.linearRampToValueAtTime(0.001, now + 1.0);
    n.start(now);
    o.start(now);
    o.stop(now + 1.0);
  }

  win() {
    if (!this.enabled) return;
    this._ensure();
    const now = this.ctx.currentTime;
    [720, 940, 1180].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g); g.connect(this.master);
      const st = now + i * 0.07;
      g.gain.setValueAtTime(0.18, st);
      g.gain.linearRampToValueAtTime(0.001, st + 0.55);
      o.start(st);
      o.stop(st + 0.65);
    });
  }

  stopAll() {
    if (this.engine) {
      try { this.engine.g.gain.value = 0.001; } catch {}
    }
  }
}
