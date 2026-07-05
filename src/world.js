import * as THREE from 'three';
import { mulberry32, clamp } from './utils.js';

const SEED = 20260705;
const UP = new THREE.Vector3(0, 1, 0);

// Track constants shared by player / main.
export const TRACK = {
  half: 10,        // visual half-width of the roadbed
  maxLat: 8.4,     // how far the player can steer off center
  chunk: 48,       // length of one generated road piece
  sectorLen: 420,
  sectors: 8,
};
TRACK.finishS = TRACK.sectorLen * TRACK.sectors;

const LANES = [-7, 0, 7];

// The centerline is an analytic function of distance s, so the track is
// infinite, always smooth, and never desyncs from the geometry riding it.
export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    this.chunks = [];      // { mesh, s }
    this.gates = [];       // { mesh, s, passed }
    this.obstacles = [];   // { mesh, s, lat, halfW, hit, spinMesh? }
    this.pickups = [];     // { mesh, s, lat, phase, baseY }
    this.finishMesh = null;

    this._buildSky();
    this._buildStars();
    this._buildShared();
    this.reset();
  }

  // ---- centerline ---------------------------------------------------------
  centerX(s) {
    // ease curve amplitude in over the first stretch so the launch is straight
    const ramp = Math.min(1, 0.18 + Math.max(0, s) / 800);
    return ramp * (26 * Math.sin(s * 0.0085) + 12 * Math.sin(s * 0.021 + 1.7));
  }

  centerY(s) {
    return 3.0 * Math.sin(s * 0.006) + 1.5 * Math.sin(s * 0.0145 + 2.1);
  }

  centerAt(s) { return new THREE.Vector3(this.centerX(s), this.centerY(s), s); }

  tangentAt(s) { return this.centerAt(s + 0.6).sub(this.centerAt(s - 0.6)).normalize(); }

  sideAt(s) { return new THREE.Vector3().crossVectors(this.tangentAt(s), UP).normalize(); }

  frameAt(s) {
    const tan = this.tangentAt(s);
    const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    return { tan, side, up };
  }

  worldPos(s, lat) { return this.centerAt(s).add(this.sideAt(s).multiplyScalar(lat)); }

  // ---- lifecycle ------------------------------------------------------------
  reset() {
    const drop = (list) => {
      for (const it of list) this._dispose(it.mesh || it);
      list.length = 0;
    };
    drop(this.chunks); drop(this.gates); drop(this.obstacles); drop(this.pickups);
    if (this.finishMesh) { this._dispose(this.finishMesh); this.finishMesh = null; }

    this.rng = mulberry32(SEED);   // same seed every run: the track is learnable
    this.spawnedTo = -64;
    this.nextGate = 240;
    this.nextObs = 170;
    this.nextPickup = 60;
  }

  ensure(horizon) {
    while (this.spawnedTo < horizon) {
      this._spawnChunk(this.spawnedTo);
      this.spawnedTo += TRACK.chunk;
    }
    while (this.nextGate < horizon && this.nextGate < TRACK.finishS - 140) {
      this._spawnGate(this.nextGate);
      this.nextGate += 260 + this.rng() * 160;
    }
    while (this.nextObs < horizon && this.nextObs < TRACK.finishS - 90) {
      this._spawnObstaclePattern(this.nextObs);
      const t = clamp(this.nextObs / 2600, 0, 1);
      this.nextObs += 130 - t * 65 + this.rng() * 45;
    }
    while (this.nextPickup < horizon && this.nextPickup < TRACK.finishS - 50) {
      this._spawnPickupChain(this.nextPickup);
      this.nextPickup += 110 + this.rng() * 90;
    }
    if (!this.finishMesh && horizon > TRACK.finishS - 20) this._spawnFinish();
  }

  update(dt, playerS) {
    this.time += dt;
    if (this.skyMat) this.skyMat.uniforms.uTime.value = this.time * 0.6;

    // the backdrop rides along so the camera never exits the sky sphere
    const anchor = this.centerAt(playerS);
    this.sky.position.copy(anchor);
    this.stars.position.copy(anchor);

    while (this.chunks.length && this.chunks[0].s + TRACK.chunk < playerS - 130) {
      this._dispose(this.chunks.shift().mesh);
    }
    const cull = (list, behind) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].s < playerS - behind) {
          this._dispose(list[i].mesh);
          list.splice(i, 1);
        }
      }
    };
    cull(this.gates, 60); cull(this.obstacles, 60); cull(this.pickups, 50);

    for (const p of this.pickups) {
      p.mesh.rotation.y = this.time * 3 + p.phase;
      p.mesh.position.y = p.baseY + Math.sin(this.time * 3.2 + p.phase) * 0.35;
    }
    for (const o of this.obstacles) {
      if (o.spinMesh) o.spinMesh.rotation.z = this.time * 2.6;
    }
    for (const g of this.gates) {
      const k = 1 + Math.sin(this.time * 2.2 + g.s) * 0.02;
      g.mesh.scale.setScalar(k);
    }
  }

  // Swept collision / pickup / gate check in track space, so it stays fair
  // and cannot tunnel at high speed or low framerate.
  collect(prevS, s, lat, checkObstacles) {
    const out = { hits: [], pickups: [], gates: [] };
    if (checkObstacles) {
      for (const o of this.obstacles) {
        if (o.hit) continue;
        // hitbox is slightly *smaller* than the visual so grazes are forgiven
        if (o.s > prevS - 1.6 && o.s < s + 1.6 && Math.abs(lat - o.lat) < o.halfW + 0.7) {
          o.hit = true;
          o.mesh.visible = false;
          out.hits.push({ pos: o.mesh.position.clone() });
        }
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.s > prevS - 1.6 && p.s < s + 1.6 && Math.abs(lat - p.lat) < 2.4) {
        out.pickups.push({ pos: p.mesh.position.clone() });
        this._dispose(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    for (const g of this.gates) {
      if (!g.passed && g.s <= s && g.s > prevS - 2) {
        g.passed = true;
        out.gates.push({ pos: g.mesh.position.clone(), perfect: Math.abs(lat) < 2.8 });
      }
    }
    return out;
  }

  // ---- shared resources -----------------------------------------------------
  _buildShared() {
    const add = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });

    this.bedMat = new THREE.MeshBasicMaterial({
      color: 0x060818, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false,
    });

    // lane ribbons + glowing edges, matching the 4-stripe look of the art.
    // each bright stripe sits on a wide faint ribbon of the same color — a
    // cheap bloom substitute that reads as glow without postprocessing.
    this.stripes = [
      { lat: 0, w: 4.5, y: 0.01, mat: add(0xc026ff, 0.06) },
      { lat: -7.6, w: 3.2, y: 0.02, mat: add(0xc026ff, 0.14) },
      { lat: -2.7, w: 2.4, y: 0.02, mat: add(0x00f0ff, 0.12) },
      { lat: 2.7, w: 2.4, y: 0.02, mat: add(0xff8a00, 0.12) },
      { lat: 7.6, w: 3.2, y: 0.02, mat: add(0xff4fd8, 0.14) },
      { lat: -7.6, w: 0.55, y: 0.03, mat: add(0xc026ff, 0.9) },
      { lat: -2.7, w: 0.42, y: 0.03, mat: add(0x00f0ff, 0.85) },
      { lat: 2.7, w: 0.42, y: 0.03, mat: add(0xff8a00, 0.85) },
      { lat: 7.6, w: 0.55, y: 0.03, mat: add(0xff4fd8, 0.9) },
      { lat: -10.3, w: 2.6, y: 0.04, mat: add(0xc026ff, 0.16) },
      { lat: 10.3, w: 2.6, y: 0.04, mat: add(0xff8a00, 0.16) },
      { lat: -10.3, w: 0.7, y: 0.05, mat: add(0xc026ff, 0.95) },
      { lat: 10.3, w: 0.7, y: 0.05, mat: add(0xff8a00, 0.95) },
      { lat: -10.3, w: 0.16, y: 0.12, mat: add(0xffffff, 0.5) },
      { lat: 10.3, w: 0.16, y: 0.12, mat: add(0xffffff, 0.5) },
    ];

    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.unitBoxEdges = new THREE.EdgesGeometry(this.unitBox);
    this.unitPlane = new THREE.PlaneGeometry(1, 1);
    this.pylonGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 6);
    this.capGeo = new THREE.SphereGeometry(0.22, 8, 8);
    this.gateOuterGeo = new THREE.TorusGeometry(12, 0.6, 8, 8);   // 8 segments = octagon
    this.gateInnerGeo = new THREE.TorusGeometry(10.2, 0.2, 6, 8);
    this.spinnerGeo = new THREE.TorusGeometry(2.4, 0.35, 6, 18);
    this.pickupCoreGeo = new THREE.IcosahedronGeometry(0.55, 0);
    this.pickupHaloGeo = new THREE.SphereGeometry(1.05, 12, 12);

    this.pylonMatC = add(0x00f0ff, 0.7);
    this.pylonMatP = add(0xc026ff, 0.7);
    this.capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.wallMats = [add(0xc026ff, 0.14), add(0x00f0ff, 0.12), add(0xff8a00, 0.12)];
    this.towerMat = new THREE.MeshBasicMaterial({ color: 0x05060f, transparent: true, opacity: 0.96 });
    this.towerEdgeMats = [
      new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.4 }),
      new THREE.LineBasicMaterial({ color: 0xc026ff, transparent: true, opacity: 0.4 }),
    ];
    this.gateMatOuter = add(0xff4fd8, 0.92);
    this.gateMatInner = add(0x00f0ff, 0.8);
    this.finishMatOuter = add(0xffffff, 0.95);
    this.finishMatInner = add(0xffe066, 0.85);
    this.blockMat = new THREE.MeshBasicMaterial({ color: 0x0c0e20, transparent: true, opacity: 0.98 });
    this.blockEdgeMat = new THREE.LineBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.95 });
    this.spinnerMat = add(0x00f0ff, 0.9);
    this.pickupCoreMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.pickupHaloMat = add(0xc026ff, 0.3);
  }

  // triangle-strip ribbon between two lateral offsets, following the centerline
  _ribbon(secs, latA, latB, y, mat) {
    const n = secs.length;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const { p, side } = secs[i];
      pos[i * 6 + 0] = p.x + side.x * latA;
      pos[i * 6 + 1] = p.y + side.y * latA + y;
      pos[i * 6 + 2] = p.z + side.z * latA;
      pos[i * 6 + 3] = p.x + side.x * latB;
      pos[i * 6 + 4] = p.y + side.y * latB + y;
      pos[i * 6 + 5] = p.z + side.z * latB;
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.own = true;   // unique geometry — dispose on recycle
    return mesh;
  }

  _spawnChunk(s0) {
    const step = 4;
    const n = TRACK.chunk / step + 1;
    const secs = [];
    for (let i = 0; i < n; i++) {
      const s = s0 + i * step;
      secs.push({ p: this.centerAt(s), side: this.sideAt(s) });
    }

    const g = new THREE.Group();
    g.add(this._ribbon(secs, -TRACK.half - 1.2, TRACK.half + 1.2, -0.4, this.bedMat));
    for (const sp of this.stripes) {
      g.add(this._ribbon(secs, sp.lat - sp.w / 2, sp.lat + sp.w / 2, sp.y, sp.mat));
    }

    // neon pylons flanking the lane
    for (const sgn of [-1, 1]) {
      const s = s0 + 8 + this.rng() * 30;
      const p = this.worldPos(s, sgn * 13.5);
      const pyl = new THREE.Mesh(this.pylonGeo, sgn > 0 ? this.pylonMatC : this.pylonMatP);
      pyl.position.copy(p); pyl.position.y += 2.4;
      g.add(pyl);
      const cap = new THREE.Mesh(this.capGeo, this.capMat);
      cap.position.copy(p); cap.position.y += 4.9;
      g.add(cap);
    }

    // horizontal light-streak walls beside the track
    const nWalls = 2 + Math.floor(this.rng() * 2);
    for (let i = 0; i < nWalls; i++) {
      const s = s0 + this.rng() * TRACK.chunk;
      const lat = (this.rng() < 0.5 ? -1 : 1) * (17 + this.rng() * 34);
      const wall = new THREE.Mesh(this.unitPlane, this.wallMats[Math.floor(this.rng() * this.wallMats.length)]);
      wall.scale.set(26 + this.rng() * 40, 0.5 + this.rng() * 6, 1);
      wall.position.copy(this.worldPos(s, lat));
      wall.position.y += 1 + this.rng() * 7;
      const f = this.frameAt(s);
      wall.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.tan, f.up, f.side));
      g.add(wall);
    }

    // distant dark towers with neon edges
    if (this.rng() < 0.4) {
      const count = 1 + Math.floor(this.rng() * 3);
      for (let i = 0; i < count; i++) {
        const s = s0 + this.rng() * TRACK.chunk;
        const lat = (this.rng() < 0.5 ? -1 : 1) * (34 + this.rng() * 46);
        const w = 6 + this.rng() * 8, h = 18 + this.rng() * 38, d = 6 + this.rng() * 8;
        const p = this.worldPos(s, lat);
        const tower = new THREE.Mesh(this.unitBox, this.towerMat);
        tower.scale.set(w, h, d);
        tower.position.set(p.x, p.y - 10 + h / 2, p.z);
        g.add(tower);
        const edges = new THREE.LineSegments(this.unitBoxEdges, this.towerEdgeMats[i % 2]);
        edges.scale.copy(tower.scale);
        edges.position.copy(tower.position);
        g.add(edges);
      }
    }

    this.scene.add(g);
    this.chunks.push({ mesh: g, s: s0 });
  }

  _gateQuaternion(s) {
    const f = this.frameAt(s);
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(f.side, f.up, f.tan)
    );
  }

  _spawnGate(s) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(this.gateOuterGeo, this.gateMatOuter);
    const inner = new THREE.Mesh(this.gateInnerGeo, this.gateMatInner);
    outer.rotation.z = Math.PI / 8;   // flat side down, like the art
    inner.rotation.z = Math.PI / 8;
    g.add(outer, inner);
    g.position.copy(this.centerAt(s));
    g.position.y += 5;
    g.quaternion.copy(this._gateQuaternion(s));
    this.scene.add(g);
    this.gates.push({ mesh: g, s, passed: false });
  }

  _spawnObstaclePattern(s) {
    const t = clamp((s - 150) / 2400, 0, 1);
    const li = Math.floor(this.rng() * 3);
    this._spawnObstacle(s, LANES[li]);
    if (this.rng() < t * 0.55) {
      const other = (li + 1 + Math.floor(this.rng() * 2)) % 3;
      this._spawnObstacle(s, LANES[other]);
    }
  }

  _spawnObstacle(s, lat) {
    const g = new THREE.Group();
    let halfW, spinMesh = null;
    if (this.rng() < 0.6) {
      const box = new THREE.Mesh(this.unitBox, this.blockMat);
      box.scale.set(4.6, 2.6, 1.4);
      const edges = new THREE.LineSegments(this.unitBoxEdges, this.blockEdgeMat);
      edges.scale.copy(box.scale);
      g.add(box, edges);
      g.position.copy(this.worldPos(s, lat));
      g.position.y += 1.3;
      halfW = 2.3;
    } else {
      spinMesh = new THREE.Mesh(this.spinnerGeo, this.spinnerMat);
      g.add(spinMesh);
      g.position.copy(this.worldPos(s, lat));
      g.position.y += 2.0;
      halfW = 2.4;
    }
    g.quaternion.copy(this._gateQuaternion(s));
    this.scene.add(g);
    this.obstacles.push({ mesh: g, s, lat, halfW, hit: false, spinMesh });
  }

  _spawnPickupChain(s0) {
    const lat0 = LANES[Math.floor(this.rng() * 3)];
    const drift = (this.rng() - 0.5) * 6;
    for (let i = 0; i < 5; i++) {
      const s = s0 + i * 7;
      const lat = clamp(lat0 + drift * (i / 4), -8, 8);
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this.pickupCoreGeo, this.pickupCoreMat));
      mesh.add(new THREE.Mesh(this.pickupHaloGeo, this.pickupHaloMat));
      mesh.position.copy(this.worldPos(s, lat));
      mesh.position.y += 1.4;
      this.scene.add(mesh);
      this.pickups.push({ mesh, s, lat, phase: this.rng() * 6.28, baseY: mesh.position.y });
    }
  }

  _spawnFinish() {
    const s = TRACK.finishS;
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.8, 8, 8), this.finishMatOuter);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(11.4, 0.3, 6, 8), this.finishMatInner);
    outer.rotation.z = Math.PI / 8;
    inner.rotation.z = Math.PI / 8;
    outer.userData.own = true;
    inner.userData.own = true;
    g.add(outer, inner);
    for (const sgn of [-1, 1]) {
      const beam = new THREE.Mesh(this.unitBox, this.finishMatInner);
      beam.scale.set(0.5, 40, 0.5);
      beam.position.x = sgn * 14;
      g.add(beam);
    }
    g.position.copy(this.centerAt(s));
    g.position.y += 5;
    g.quaternion.copy(this._gateQuaternion(s));
    this.scene.add(g);
    this.finishMesh = g;
  }

  _dispose(obj) {
    this.scene.remove(obj);
    obj.traverse((m) => {
      if (m.userData.own && m.geometry) m.geometry.dispose();
    });
  }

  // ---- backdrop -------------------------------------------------------------
  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(900, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        uniform float uTime;
        void main() {
          vec3 dir = normalize(vPos);
          float h = dir.y * 0.5 + 0.5;
          vec3 col = mix(vec3(0.01, 0.01, 0.06), vec3(0.06, 0.01, 0.12), h);
          col = mix(col, vec3(0.02, 0.05, 0.16), clamp(dir.y * 0.6 + 0.3, 0.0, 1.0));
          float n1 = sin(dir.x * 1.8 + uTime * 0.04) * 0.5 + 0.5;
          float n2 = sin(dir.z * 1.6 - uTime * 0.03 + dir.y * 3.0) * 0.5 + 0.5;
          col += vec3(0.18, 0.02, 0.28) * (n1 * n2) * (0.6 + 0.4 * dir.y);
          col += vec3(0.02, 0.12, 0.18) * (1.0 - n1) * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);
    this.skyMat = skyMat;
  }

  _buildStars() {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 620 + Math.random() * 220;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      pos[i * 3 + 2] = r * Math.cos(phi);
      const s = Math.random();
      col[i * 3] = 0.7 + s * 0.3;
      col[i * 3 + 1] = 0.85 + s * 0.15;
      col[i * 3 + 2] = 1.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.4, vertexColors: true, transparent: true,
      opacity: 0.95, depthWrite: false, sizeAttenuation: true,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }
}
