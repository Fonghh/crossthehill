// Cute low-poly car meshes built from primitives. Wheel pivots follow the physics
// suspension lengths so what you see is where the tyres actually touch.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { VehicleSpec } from '../config/vehicles';
import type { CarSnap } from '../net/protocol';

const lam = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const DARK = lam('#2f2f36');
const TYRE = lam('#2a2a2e');
const HUB = lam('#d9d4c7');
const GLASS = lam('#33465a');
const LIGHT = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
const TAIL = new THREE.MeshBasicMaterial({ color: '#ff5a4a' });
const CRATE = lam('#b9824f');
const CRATE2 = lam('#d8a868');
const STRAP = lam('#3b6fb6');

function box(w: number, h: number, d: number, mat: THREE.Material, r = 0.08, seg = 2) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
  m.castShadow = true;
  return m;
}

export class CarModel {
  root = new THREE.Group();
  body = new THREE.Group();
  wheelPivots: THREE.Group[] = [];
  wheelSpinners: THREE.Group[] = [];
  bodyMat: THREE.MeshLambertMaterial;
  headlights: THREE.Mesh[] = [];

  constructor(public spec: VehicleSpec, color: string) {
    this.bodyMat = lam(color);
    this.root.add(this.body);
    if (spec.id === 'jeep') this.buildJeep();
    else this.buildBigfoot();
    this.buildWheels();
  }

  setColor(color: string) {
    this.bodyMat.color.set(color);
  }

  private buildJeep() {
    const s = this.spec;
    const [hx, hy, hz] = s.halfExtents;
    const b = this.body;
    const W = hx * 2;
    const L = hz * 2;
    // Lower tub
    const tub = box(W, hy * 1.5, L, this.bodyMat, 0.18, 3);
    tub.position.y = -hy * 0.15;
    b.add(tub);
    // Hood bump
    const hood = box(W * 0.86, 0.2, L * 0.34, this.bodyMat, 0.09);
    hood.position.set(0, hy * 0.62, hz * 0.6);
    b.add(hood);
    // Cabin with big round windows (cute proportions: tall, short)
    const cab = box(W * 0.9, 0.78, L * 0.42, this.bodyMat, 0.2, 3);
    cab.position.set(0, hy + 0.32, -hz * 0.12);
    b.add(cab);
    const ws = box(W * 0.78, 0.48, 0.06, GLASS, 0.03);
    ws.position.set(0, hy + 0.38, -hz * 0.12 + L * 0.21 + 0.01);
    ws.rotation.x = -0.12;
    b.add(ws);
    for (const sx of [-1, 1]) {
      const sw = box(0.06, 0.42, L * 0.3, GLASS, 0.03);
      sw.position.set(sx * (W * 0.45 + 0.005), hy + 0.38, -hz * 0.12);
      b.add(sw);
    }
    const rw = box(W * 0.7, 0.36, 0.06, GLASS, 0.03);
    rw.position.set(0, hy + 0.4, -hz * 0.12 - L * 0.21 - 0.01);
    b.add(rw);
    // Roof rack + cargo
    const rack = box(W * 0.84, 0.06, L * 0.4, DARK, 0.02);
    rack.position.set(0, hy + 0.76, -hz * 0.12);
    b.add(rack);
    this.addCargo(new THREE.Vector3(0, hy + 0.79, -hz * 0.12), W * 0.75, L * 0.36);
    // Bumpers, lights, winch, spare tyre
    const fb = box(W * 1.02, 0.22, 0.26, DARK, 0.06);
    fb.position.set(0, -hy * 0.55, hz + 0.05);
    b.add(fb);
    const rb = fb.clone();
    rb.position.z = -hz - 0.05;
    b.add(rb);
    const winch = box(0.42, 0.18, 0.16, lam('#585a63'), 0.04);
    winch.position.set(0, -hy * 0.55 + 0.02, hz + 0.2);
    b.add(winch);
    this.addHeadlights(W * 0.33, hy * 0.22, hz + 0.01);
    this.addTaillights(W * 0.4, 0, -hz - 0.01);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12), TYRE);
    spare.rotation.x = Math.PI / 2;
    spare.position.set(0, hy * 0.35, -hz - 0.16);
    spare.castShadow = true;
    b.add(spare);
    // Fender flares
    for (const z of [s.frontZ, s.rearZ]) for (const sx of [-1, 1]) {
      const f = box(0.28, 0.12, s.wheelRadius * 2.3, DARK, 0.05);
      f.position.set(sx * (hx + 0.02), hy * 0.25, z);
      b.add(f);
    }
  }

  private buildBigfoot() {
    const s = this.spec;
    const [hx, hy, hz] = s.halfExtents;
    const b = this.body;
    const W = hx * 2;
    const L = hz * 2;
    const frame = box(W * 0.7, 0.22, L * 0.95, DARK, 0.05);
    frame.position.y = -hy * 0.75;
    b.add(frame);
    const lower = box(W, hy * 1.1, L, this.bodyMat, 0.2, 3);
    lower.position.y = -hy * 0.05;
    b.add(lower);
    const cab = box(W * 0.92, 0.85, L * 0.34, this.bodyMat, 0.22, 3);
    cab.position.set(0, hy + 0.36, hz * 0.12);
    b.add(cab);
    const ws = box(W * 0.8, 0.5, 0.06, GLASS, 0.03);
    ws.position.set(0, hy + 0.42, hz * 0.12 + L * 0.17 + 0.01);
    ws.rotation.x = -0.18;
    b.add(ws);
    for (const sx of [-1, 1]) {
      const sw = box(0.06, 0.44, L * 0.22, GLASS, 0.03);
      sw.position.set(sx * (W * 0.46 + 0.005), hy + 0.42, hz * 0.12);
      b.add(sw);
    }
    // Pickup bed with cargo
    const bedFloor = box(W * 0.9, 0.08, L * 0.42, DARK, 0.02);
    bedFloor.position.set(0, hy * 0.5, -hz * 0.5);
    b.add(bedFloor);
    this.addCargo(new THREE.Vector3(0, hy * 0.54, -hz * 0.5), W * 0.8, L * 0.38);
    const roll = new THREE.Mesh(new THREE.TorusGeometry(W * 0.4, 0.06, 6, 12, Math.PI), DARK);
    roll.position.set(0, hy * 0.55, -hz * 0.08);
    roll.castShadow = true;
    b.add(roll);
    const fb = box(W * 1.05, 0.28, 0.3, DARK, 0.08);
    fb.position.set(0, -hy * 0.35, hz + 0.06);
    b.add(fb);
    const rb = fb.clone();
    rb.position.z = -hz - 0.06;
    b.add(rb);
    const winch = box(0.5, 0.22, 0.2, lam('#585a63'), 0.05);
    winch.position.set(0, -hy * 0.35, hz + 0.25);
    b.add(winch);
    this.addHeadlights(W * 0.34, hy * 0.25, hz + 0.01, 0.15);
    this.addTaillights(W * 0.42, hy * 0.1, -hz - 0.01);
    // Roof light bar (cute detail)
    const bar = box(W * 0.6, 0.1, 0.14, DARK, 0.03);
    bar.position.set(0, hy + 0.82, hz * 0.2);
    b.add(bar);
    for (let k = -2; k <= 2; k++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), LIGHT);
      l.position.set(k * 0.18, hy + 0.84, hz * 0.2 + 0.07);
      b.add(l);
    }
  }

  private addCargo(base: THREE.Vector3, w: number, d: number) {
    const c1 = box(w * 0.48, 0.36, d * 0.5, CRATE, 0.04);
    c1.position.set(base.x - w * 0.24, base.y + 0.18, base.z + d * 0.22);
    const c2 = box(w * 0.46, 0.3, d * 0.42, CRATE2, 0.04);
    c2.position.set(base.x + w * 0.25, base.y + 0.15, base.z + d * 0.2);
    const c3 = box(w * 0.9, 0.28, d * 0.4, CRATE2, 0.04);
    c3.position.set(base.x, base.y + 0.14, base.z - d * 0.27);
    const strap = box(0.06, 0.4, d * 1.02, STRAP, 0.02);
    strap.position.set(base.x, base.y + 0.18, base.z);
    this.body.add(c1, c2, c3, strap);
  }

  private addHeadlights(x: number, y: number, z: number, r = 0.12) {
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 10), LIGHT);
      h.rotation.x = Math.PI / 2;
      h.position.set(sx * x, y, z + 0.02);
      this.body.add(h);
      this.headlights.push(h);
    }
  }

  private addTaillights(x: number, y: number, z: number) {
    for (const sx of [-1, 1]) {
      const t = box(0.16, 0.1, 0.04, TAIL, 0.02);
      t.position.set(sx * x, y, z);
      this.body.add(t);
    }
  }

  private buildWheels() {
    const s = this.spec;
    const r = s.wheelRadius;
    const w = s.wheelWidth;
    const tyreGeo = new THREE.CylinderGeometry(r, r, w, 14);
    tyreGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(r * 0.48, r * 0.48, w + 0.02, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const treadGeo = new THREE.BoxGeometry(w * 1.02, r * 0.16, r * 0.3);
    const mounts = [
      [-s.trackHalf, s.frontZ], [s.trackHalf, s.frontZ],
      [-s.trackHalf, s.rearZ], [s.trackHalf, s.rearZ],
    ];
    for (const [x, z] of mounts) {
      const pivot = new THREE.Group();
      pivot.position.set(x, s.mountY - s.suspensionTravel, z);
      const spinner = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, TYRE);
      tyre.castShadow = true;
      spinner.add(tyre);
      spinner.add(new THREE.Mesh(hubGeo, HUB));
      // Chunky tread blocks make spin readable and look toy-like.
      for (let k = 0; k < 8; k++) {
        const t = new THREE.Mesh(treadGeo, TYRE);
        const a = (k / 8) * Math.PI * 2;
        t.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
        t.rotation.x = -a;
        spinner.add(t);
      }
      pivot.add(spinner);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpinners.push(spinner);
    }
  }

  /** Apply an (interpolated) snapshot. */
  apply(c: CarSnap) {
    this.root.position.set(c.p[0], c.p[1], c.p[2]);
    this.root.quaternion.set(c.q[0], c.q[1], c.q[2], c.q[3]);
    const s = this.spec;
    for (let i = 0; i < 4; i++) {
      const pv = this.wheelPivots[i];
      pv.position.y = s.mountY - c.wl[i];
      if (i < 2) pv.rotation.y = -c.st; // +steer turns toward local -x (driver's right)
      this.wheelSpinners[i].rotation.x = c.ws[i];
    }
  }
}
