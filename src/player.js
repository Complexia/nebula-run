import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { TRACK } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const KMH_PER_UNIT = 34;   // internal units/s -> displayed km/h

// The glowing orb ship. All motion happens in track space (s = distance
// along the centerline, lat = lateral offset in world units).
export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildOrb();
    this._initTrail();
    this.t = 0;
    this.reset();
  }

  _buildOrb() {
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.45, 28, 28),
      new THREE.MeshPhongMaterial({
        color: 0x2a0f55, emissive: 0x6b1a99, shininess: 12,
        transparent: true, opacity: 0.42, depthWrite: false,
      })
    );
    this.group.add(this.shell);

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 22, 22),
      new THREE.MeshBasicMaterial({ color: 0xfff9e6 })
    );
    this.group.add(this.core);

    this.circuit = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 28, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.18, wireframe: true })
    );
    this.group.add(this.circuit);

    const ringMat = () => new THREE.MeshBasicMaterial({
      color: 0xc026ff, transparent: true, opacity: 0.76,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.045, 8, 34), ringMat());
    this.ring.rotation.x = Math.PI * 0.5;
    this.group.add(this.ring);

    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.045, 8, 34), ringMat());
    this.ring2.material.color.set(0x00f0ff);
    this.ring2.rotation.x = Math.PI * 0.5;
    this.ring2.scale.setScalar(0.6);
    this.group.add(this.ring2);

    for (let i = 0; i < 3; i++) {
      const circ = new THREE.Mesh(
        new THREE.TorusGeometry(1.5 - i * 0.09, 0.026, 4, 22),
        new THREE.MeshBasicMaterial({
          color: i === 1 ? 0x00f0ff : 0xc026ff, transparent: true, opacity: 0.72,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      circ.rotation.x = (i - 1) * 0.8;
      circ.rotation.y = i * 1.1;
      this.group.add(circ);
    }

    this.light = new THREE.PointLight(0xc026ff, 2.2, 125);
    this.group.add(this.light);

    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(2.25, 18, 18),
      new THREE.MeshBasicMaterial({
        color: 0xc026ff, transparent: true, opacity: 0.11,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.group.add(this.halo);
  }

  _initTrail() {
    this.trailN = 24;
    this.trailPts = [];
    for (let i = 0; i < this.trailN; i++) this.trailPts.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 6), 3));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.trailMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xc026ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.trailMesh.frustumCulled = false;
    this.scene.add(this.trailMesh);
  }

  reset(startS = 0) {
    this.s = startS;
    this.prevS = startS;
    this.lat = 0;
    this.latVel = 0;
    this.speed = 30;
    this.boost = 0.5;
    this.boosting = false;
    this.iframes = 0;
    this.edge = false;
    this.group.position.set(0, 1.35, startS);
    for (const p of this.trailPts) p.copy(this.group.position);
  }

  baseSpeed() {
    return 30 + Math.min(16, Math.max(0, this.s) * 0.005);
  }

  update(dt, world, input) {
    this.t += dt;
    this.prevS = this.s;

    // -- steering: velocity-based, snappy, self-centering the moment you let go
    const steer = clamp(input.steer, -1, 1);
    const latSpeed = 16 + this.speed * 0.16;
    this.latVel = damp(this.latVel, steer * latSpeed, 12, dt);
    this.lat += this.latVel * dt;
    this.edge = false;
    if (Math.abs(this.lat) > TRACK.maxLat) {
      this.lat = clamp(this.lat, -TRACK.maxLat, TRACK.maxLat);
      if (Math.sign(this.latVel) === Math.sign(this.lat)) this.latVel *= -0.25;
      this.edge = true;
    }

    // -- throttle
    const base = this.baseSpeed();
    let target = base, rate = 1.1;
    this.boosting = false;
    if (input.boost && this.boost > 0.02) {
      this.boost = Math.max(0, this.boost - dt * 0.42);
      target = base * 1.5 + 6;
      rate = 2.4;
      this.boosting = true;
    } else if (input.brake) {
      target = base * 0.55;
      rate = 3.0;
      this.boost = clamp(this.boost + dt * 0.16, 0, 1);
    } else {
      this.boost = clamp(this.boost + dt * 0.05, 0, 1);
    }
    this.speed = damp(this.speed, target, rate, dt);
    this.s += this.speed * dt;

    this.iframes = Math.max(0, this.iframes - dt);

    // -- place the orb in the world
    const pos = world.worldPos(this.s, this.lat);
    pos.y += 1.35 + Math.sin(this.t * 2.2) * 0.08;
    this.group.position.copy(pos);
    const look = pos.clone().add(world.tangentAt(this.s));
    this.group.lookAt(look);
    this.group.rotateZ(clamp(-this.latVel * 0.028, -0.45, 0.45));

    // -- orb animation
    this.ring.rotation.z = this.s * 0.012 + this.lat * 0.12;
    this.ring2.rotation.z = -this.s * 0.018;
    this.core.scale.setScalar(0.85 + Math.sin(this.t * 8) * 0.05 + this.boosting * 0.3);
    this.core.material.color.setHex(this.boosting ? 0xffffff : 0xfff9e6);
    const hscale = 1.0 + (this.boosting ? 0.55 : 0) + Math.sin(this.t * 9) * 0.06;
    this.halo.scale.setScalar(hscale);
    this.halo.material.opacity = 0.08 + (this.boosting ? 0.2 : 0);
    this.halo.material.color.setHex(this.boosting ? 0xe8faff : 0xc026ff);
    this.light.color.setHex(this.boosting ? 0xffe070 : 0xc026ff);
    this.light.intensity = 2.2 + (this.boosting ? 4.5 : 0);

    // damage blink
    if (this.iframes > 0) {
      this.shell.material.opacity = 0.2 + (Math.sin(this.t * 30) > 0 ? 0.4 : 0);
    } else {
      this.shell.material.opacity = 0.42;
    }

    this._updateTrail();
  }

  _updateTrail() {
    for (let i = this.trailPts.length - 1; i > 0; i--) this.trailPts[i].copy(this.trailPts[i - 1]);
    this.trailPts[0].copy(this.group.position);
    this.trailPts[0].y -= 0.25;

    const posAttr = this.trailMesh.geometry.attributes.position;
    const dir = new THREE.Vector3(), side = new THREE.Vector3();
    const n = this.trailPts.length;
    for (let i = 0; i < n; i++) {
      const a = this.trailPts[Math.max(0, i - 1)];
      const b = this.trailPts[Math.min(n - 1, i + 1)];
      dir.subVectors(a, b);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      side.crossVectors(dir, UP).normalize();
      const w = 0.6 * (1 - i / (n - 1)) + 0.03;
      const p = this.trailPts[i];
      posAttr.setXYZ(i * 2, p.x - side.x * w, p.y, p.z - side.z * w);
      posAttr.setXYZ(i * 2 + 1, p.x + side.x * w, p.y, p.z + side.z * w);
    }
    posAttr.needsUpdate = true;
    this.trailMesh.material.opacity = 0.35 + (this.boosting ? 0.35 : 0);
    this.trailMesh.material.color.setHex(this.boosting ? 0xffe066 : 0xc026ff);
  }

  applyHit() {
    this.speed *= 0.55;
    this.latVel *= 0.5;
    this.iframes = 1.6;
  }

  addBoost(amount) { this.boost = clamp(this.boost + amount, 0, 1); }
  getBoost() { return this.boost; }
  getKmh() { return Math.floor(this.speed * KMH_PER_UNIT); }
  getPosition() { return this.group.position; }
}
