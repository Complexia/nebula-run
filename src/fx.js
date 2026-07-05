import * as THREE from 'three';

// Speed streaks, particle bursts, and camera-shake trauma.
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.trauma = 0;
    this._buildStreaks();
  }

  _buildStreaks() {
    this.streakGeo = new THREE.BoxGeometry(0.09, 0.07, 1);
    this.streakMats = [0xc026ff, 0x00f0ff, 0xff8a00, 0xff4fd8].map((c) =>
      new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.streaks = [];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(this.streakGeo, this.streakMats[i % this.streakMats.length]);
      m.userData = { s: -1e9, lat: 0, y: 0, len: 30 };
      this.scene.add(m);
      this.streaks.push(m);
    }
  }

  _rollStreak(st, playerS, rndAhead) {
    const ud = st.userData;
    ud.s = playerS + (rndAhead ? 40 + Math.random() * 400 : 180 + Math.random() * 260);
    ud.lat = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 50);
    ud.y = 0.3 + Math.random() * 9;
    ud.len = 25 + Math.random() * 35;
  }

  update(dt, world, playerS, speedNorm) {
    this.trauma = Math.max(0, this.trauma - dt * 2.2);

    const basis = new THREE.Matrix4();
    for (const st of this.streaks) {
      const ud = st.userData;
      if (ud.s < playerS - 40) this._rollStreak(st, playerS, ud.s < -1e8);
      st.position.copy(world.worldPos(ud.s, ud.lat));
      st.position.y += ud.y;
      const f = world.frameAt(ud.s);
      st.quaternion.setFromRotationMatrix(basis.makeBasis(f.side, f.up, f.tan));
      st.scale.z = ud.len * (1 + speedNorm * 1.6);
    }
    const op = 0.04 + speedNorm * 0.26;
    for (const m of this.streakMats) m.opacity = op;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const ud = p.userData;
      ud.life -= dt;
      if (ud.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.position.x += ud.vx * dt;
      p.position.y += ud.vy * dt;
      p.position.z += ud.vz * dt;
      ud.vy -= 20 * dt;
      const k = ud.life / ud.maxLife;
      p.scale.setScalar(ud.baseScale * k);
      p.material.opacity = k * 0.9;
    }
  }

  burst(pos, color, n = 12, speed = 45, life = 0.5) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      m.position.copy(pos);
      const sp = speed * (0.6 + Math.random() * 0.8);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      m.userData = {
        life: life * (0.7 + Math.random() * 0.6), maxLife: life,
        vx: Math.cos(ang) * sp,
        vy: 8 + Math.random() * 16,
        vz: Math.sin(ang) * sp * 0.7,
        baseScale: 0.6 + Math.random() * 0.8,
      };
      this.scene.add(m);
      this.particles.push(m);
    }
  }

  crashBurst(pos) {
    this.burst(pos, 0xc026ff, 14, 55, 0.9);
    this.burst(pos, 0xff8a00, 12, 65, 0.8);
    this.burst(pos, 0x00f0ff, 10, 50, 0.7);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    flash.position.copy(pos);
    flash.userData = { life: 0.2, maxLife: 0.2, vx: 0, vy: 0, vz: 0, baseScale: 1.6 };
    this.scene.add(flash);
    this.particles.push(flash);
    this.shake(1);
  }

  boostTrail(pos, tan) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6 })
    );
    m.position.copy(pos).addScaledVector(tan, -2.6);
    m.position.x += (Math.random() - 0.5) * 1.4;
    m.position.y += (Math.random() - 0.5) * 0.8 - 0.4;
    const back = 36 + Math.random() * 10;
    m.userData = {
      life: 0.3, maxLife: 0.3,
      vx: -tan.x * back + (Math.random() - 0.5) * 8,
      vy: -3 - Math.random() * 5,
      vz: -tan.z * back,
      baseScale: 0.9,
    };
    this.scene.add(m);
    this.particles.push(m);
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  clear() {
    for (const p of this.particles) {
      this.scene.remove(p);
      p.geometry.dispose();
    }
    this.particles.length = 0;
    this.trauma = 0;
    for (const st of this.streaks) st.userData.s = -1e9;
  }
}
