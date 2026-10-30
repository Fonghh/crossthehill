import * as THREE from 'three';
import { GAME } from '../config/game';
import { VEHICLES } from '../config/vehicles';
import { toWorld } from '../game/anchors';
import type { CarSnap, PlayerInfo, RopeSnap, Snapshot, Vec3T } from '../net/protocol';
import { CarModel } from '../vehicle/vehicleModel';
import { heightAt, type TerrainData } from '../world/terrainGen';
import { DecorView } from './decorView';
import { TerrainView } from './terrainView';

export interface QualityLevel {
  name: string;
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  far: number;
  grass: number;
}

export const QUALITY: QualityLevel[] = [
  { name: '低', pixelRatio: 0.6, shadows: false, shadowSize: 512, far: 220, grass: 0 },
  { name: '中', pixelRatio: 0.85, shadows: true, shadowSize: 1024, far: 300, grass: 0.4 },
  { name: '高', pixelRatio: 1.25, shadows: true, shadowSize: 2048, far: 420, grass: 1 },
];

const SKY = new THREE.Color('#bcdbe8');

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  decor: DecorView;
  cars = new Map<string, { model: CarModel; info: PlayerInfo; tag: THREE.Sprite }>();
  ropes: THREE.Mesh[] = [];
  private ropeMat = new THREE.MeshLambertMaterial({ color: '#f2c14e' });
  private beacon: THREE.Group;
  private markers = new Map<string, THREE.Group>();
  private reticle: THREE.Group;
  private aimLine: THREE.Line;
  qualityIndex = 1;

  // Camera rig
  zoom = 24;
  camYaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;

  constructor(public canvas: HTMLCanvasElement, public terrain: TerrainData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY, 140, 300);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 450);

    const hemi = new THREE.HemisphereLight('#dceeff', '#8a6f4a', 1.5);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffe9c7', 2.6);
    this.sun.position.set(60, 110, 40);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 300;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(new TerrainView(terrain).group);
    this.decor = new DecorView(terrain);
    this.scene.add(this.decor.group);

    this.beacon = this.makeBeacon();
    this.scene.add(this.beacon);
    this.reticle = this.makeReticle();
    this.scene.add(this.reticle);
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.4 }));
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    this.setQuality(this.qualityIndex);
  }

  setQuality(i: number) {
    this.qualityIndex = Math.max(0, Math.min(QUALITY.length - 1, i));
    const q = QUALITY[this.qualityIndex];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.camera.far = q.far + 30;
    (this.scene.fog as THREE.Fog).near = q.far * 0.45;
    (this.scene.fog as THREE.Fog).far = q.far;
    this.camera.updateProjectionMatrix();
    this.decor.setGrassDensity(q.grass);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical FOV so you still see around the car.
    this.camera.fov = w < h ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  syncPlayers(players: PlayerInfo[]) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, c] of this.cars) {
      if (!ids.has(id)) {
        this.scene.remove(c.model.root, c.tag);
        this.cars.delete(id);
      }
    }
    for (const p of players) {
      const cur = this.cars.get(p.id);
      if (cur && cur.info.car === p.car) {
        if (cur.info.color !== p.color) cur.model.setColor(p.color);
        if (cur.info.name !== p.name) { this.scene.remove(cur.tag); cur.tag = nameTag(p.name, p.color); this.scene.add(cur.tag); }
        cur.info = p;
        continue;
      }
      if (cur) this.scene.remove(cur.model.root, cur.tag);
      const model = new CarModel(VEHICLES[p.car], p.color);
      const tag = nameTag(p.name, p.color);
      this.scene.add(model.root, tag);
      this.cars.set(p.id, { model, info: p, tag });
    }
  }

  applyState(s: Snapshot, selfId: string) {
    for (const c of s.cars) {
      const v = this.cars.get(c.id);
      if (!v) continue;
      v.model.apply(c);
      const top = VEHICLES[v.info.car].cabin[3] + VEHICLES[v.info.car].cabin[1] + 1.1;
      v.tag.position.set(c.p[0], c.p[1] + top, c.p[2]);
      v.tag.visible = c.id !== selfId;
    }
    this.updateRopes(s.ropes, s.cars);
    this.updateBeacon(s);
    this.updateMarkers(s);
  }

  private updateRopes(ropes: RopeSnap[], cars: CarSnap[]) {
    const byId = new Map(cars.map((c) => [c.id, c]));
    while (this.ropes.length > ropes.length) {
      const m = this.ropes.pop()!;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    ropes.forEach((r, i) => {
      const owner = byId.get(r.owner);
      if (!owner) return;
      const a = toWorld(owner, r.ownerLocal);
      let b: Vec3T;
      if (r.target.kind === 'car') {
        const t = byId.get(r.target.id);
        if (!t) return;
        b = toWorld(t, r.target.local);
      } else b = r.target.p;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const slack = Math.max(0, r.length - d);
      const sag = Math.min(3, Math.sqrt(slack * d) * 0.6) + (r.tension > 0 ? 0 : 0.05);
      const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...a), mid, new THREE.Vector3(...b));
      const geo = new THREE.TubeGeometry(curve, 14, 0.045, 5, false);
      let m = this.ropes[i];
      if (!m) {
        m = new THREE.Mesh(geo, this.ropeMat);
        m.castShadow = true;
        this.ropes[i] = m;
        this.scene.add(m);
      } else {
        m.geometry.dispose();
        m.geometry = geo;
      }
    });
  }

  private makeBeacon() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(GAME.destinationRadius, GAME.destinationRadius, 1.2, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.position.y = 0.6;
    g.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 120, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.22, depthWrite: false, fog: false }),
    );
    pillar.position.y = 60;
    g.add(pillar);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), new THREE.MeshLambertMaterial({ color: '#f4f1e6' }));
    pole.position.y = 2;
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 3), new THREE.MeshLambertMaterial({ color: '#ef476f', flatShading: true }));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.8, 3.4, 0);
    flag.name = 'flag';
    g.add(flag);
    return g;
  }

  private updateBeacon(s: Snapshot) {
    const d = this.terrain.destinations[s.game.destIndex % this.terrain.destinations.length];
    this.beacon.position.set(d.x, heightAt(this.terrain, d.x, d.z), d.z);
    const flag = this.beacon.getObjectByName('flag');
    if (flag) flag.rotation.x = Math.sin(performance.now() / 300) * 0.25;
  }

  private updateMarkers(s: Snapshot) {
    const live = new Set<string>();
    for (const m of s.game.markers) {
      live.add(m.id);
      let g = this.markers.get(m.id);
      const color = this.cars.get(m.id)?.info.color ?? '#ffffff';
      if (!g) {
        g = new THREE.Group();
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 4), new THREE.MeshBasicMaterial({ color }));
        pin.rotation.x = Math.PI;
        pin.position.y = 4;
        pin.name = 'pin';
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.2, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.3;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 60, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
        beam.position.y = 30;
        g.add(pin, ring, beam);
        this.scene.add(g);
        this.markers.set(m.id, g);
      }
      g.position.set(m.x, heightAt(this.terrain, m.x, m.z), m.z);
      const pin = g.getObjectByName('pin');
      if (pin) pin.position.y = 4 + Math.sin(performance.now() / 250) * 0.4;
    }
    for (const [id, g] of this.markers) if (!live.has(id)) { this.scene.remove(g); this.markers.delete(id); }
  }

  private makeReticle() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
    ring.name = 'ring';
    g.add(ring);
    for (let k = 0; k < 4; k++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
      const a = (k * Math.PI) / 2;
      tick.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0);
      tick.rotation.z = a;
      g.add(tick);
    }
    g.renderOrder = 10;
    g.visible = false;
    return g;
  }

  /** Show the winch reticle at `pos` (or the free aim point when nothing is locked). */
  setAim(from: Vec3T | null, pos: Vec3T | null, locked: boolean) {
    if (!from || !pos) {
      this.reticle.visible = false;
      this.aimLine.visible = false;
      return;
    }
    const color = locked ? '#7cf29c' : '#ffffff';
    this.reticle.visible = true;
    this.reticle.position.set(pos[0], pos[1], pos[2]);
    this.reticle.quaternion.copy(this.camera.quaternion);
    const s = locked ? 1 + Math.sin(performance.now() / 120) * 0.08 : 0.7;
    this.reticle.scale.setScalar(s);
    this.reticle.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; if (m?.color) m.color.set(color); });
    this.aimLine.visible = true;
    this.aimLine.geometry.setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...pos)]);
    this.aimLine.computeLineDistances();
    (this.aimLine.material as THREE.LineDashedMaterial).color.set(color);
  }

  updateCamera(target: CarSnap | undefined, dt: number) {
    if (!target) return;
    const p = new THREE.Vector3(...target.p);
    const q = new THREE.Quaternion(...target.q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const heading = Math.atan2(fwd.x, fwd.z);
    const speed = Math.hypot(target.v[0], target.v[2]);
    // Follow heading lazily; faster when driving, nearly still when crawling or stopped.
    let diff = heading - this.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (!this.camInit) { this.camYaw = heading; }
    const rate = Math.min(1, dt * (0.4 + Math.min(speed, 12) * 0.12));
    if (Math.abs(fwd.y) < 0.9) this.camYaw += diff * rate;
    const pitch = 0.95; // ~54° looking down
    const back = Math.cos(pitch) * this.zoom;
    const up = Math.sin(pitch) * this.zoom;
    const want = new THREE.Vector3(p.x - Math.sin(this.camYaw) * back, p.y + up, p.z - Math.cos(this.camYaw) * back);
    const look = new THREE.Vector3(p.x + Math.sin(this.camYaw) * 3, p.y, p.z + Math.cos(this.camYaw) * 3);
    // Keep the camera above the ground between it and the car.
    const gy = heightAt(this.terrain, want.x, want.z) + 3;
    if (want.y < gy) want.y = gy;
    if (!this.camInit) { this.camPos.copy(want); this.camLook.copy(look); this.camInit = true; }
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 10));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Shadow camera follows the car.
    this.sun.target.position.copy(p);
    this.sun.position.set(p.x + 50, p.y + 100, p.z + 35);
  }

  /** Ground point under a screen position (for aiming / map taps). */
  screenToGround(nx: number, ny: number): Vec3T | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    let prevT = 0;
    for (let t = 0.5; t < 400; t += 1) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y <= heightAt(this.terrain, x, z)) {
        // refine
        let lo = prevT, hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= heightAt(this.terrain, o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m;
        }
        return [o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi];
      }
      prevT = t;
    }
    return null;
  }

  worldToScreen(p: Vec3T): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(...p).project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, visible: v.z < 1 };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function nameTag(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(240, g.measureText(name).width + 36);
  g.fillStyle = 'rgba(30,30,40,0.6)';
  roundRect(g, (256 - w) / 2, 8, w, 46, 22);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc((256 - w) / 2 + 18, 31, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128 + 8, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 20;
  return s;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
