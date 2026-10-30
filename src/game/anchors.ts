// Things a winch rope can hook onto: other cars, tree trunks, big rocks.
// Used by the aiming UI (client) and validated again by the host.

import { GAME } from '../config/game';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import type { RopeTarget, Vec3T } from '../net/protocol';
import type { TerrainData } from '../world/terrainGen';

export interface AnchorCandidate {
  target: RopeTarget;
  pos: Vec3T; // world position for the reticle
  label: string;
}

export interface CarPose { id: string; car: VehicleId; p: Vec3T; q: [number, number, number, number] }

const MIN_ROCK_RADIUS = 1.0;

export class AnchorIndex {
  private cell = 16;
  private grid = new Map<string, { kind: 'tree' | 'rock'; i: number }[]>();

  constructor(private t: TerrainData) {
    t.trees.forEach((tr, i) => this.add(tr.x, tr.z, { kind: 'tree', i }));
    t.rocks.forEach((r, i) => { if (r.r >= MIN_ROCK_RADIUS) this.add(r.x, r.z, { kind: 'rock', i }); });
  }

  private add(x: number, z: number, e: { kind: 'tree' | 'rock'; i: number }) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(e);
  }

  /** All anchor candidates within `range` of `from`, excluding the asking car. */
  query(from: Vec3T, range: number, cars: CarPose[], selfId: string): AnchorCandidate[] {
    const out: AnchorCandidate[] = [];
    const span = Math.ceil(range / this.cell);
    const ci = Math.floor(from[0] / this.cell);
    const cj = Math.floor(from[2] / this.cell);
    for (let dj = -span; dj <= span; dj++) {
      for (let di = -span; di <= span; di++) {
        const arr = this.grid.get(`${ci + di},${cj + dj}`);
        if (!arr) continue;
        for (const e of arr) {
          const c = e.kind === 'tree' ? this.treePoint(e.i) : this.rockPoint(e.i, from);
          if (dist(c, from) <= range) {
            out.push({ target: { kind: 'point', p: c, obj: e.kind }, pos: c, label: e.kind === 'tree' ? '樹' : '岩石' });
          }
        }
      }
    }
    for (const car of cars) {
      if (car.id === selfId) continue;
      const local = towPointToward(car, from);
      const w = toWorld(car, local);
      if (dist(w, from) <= range) out.push({ target: { kind: 'car', id: car.id, local }, pos: w, label: '隊友' });
    }
    return out;
  }

  treePoint(i: number): Vec3T {
    const tr = this.t.trees[i];
    return [tr.x, tr.y + Math.min(0.9, tr.trunkH * 0.5), tr.z];
  }

  rockPoint(i: number, from: Vec3T): Vec3T {
    const r = this.t.rocks[i];
    const dx = from[0] - r.x;
    const dz = from[2] - r.z;
    const l = Math.hypot(dx, dz) || 1;
    const rad = r.r * Math.min(r.sx, r.sz) * 0.8;
    return [r.x + (dx / l) * rad, r.y + r.r * r.sy * 0.25, r.z + (dz / l) * rad];
  }
}

/** Front winch or rear hitch, whichever faces `toward`. Local coords. */
export function towPointToward(car: CarPose, toward: Vec3T): Vec3T {
  const spec = VEHICLES[car.car];
  const hz = spec.halfExtents[2];
  const front: Vec3T = [0, -0.05, hz + 0.08];
  const rear: Vec3T = [0, -0.05, -hz - 0.08];
  return dist(toWorld(car, front), toward) <= dist(toWorld(car, rear), toward) ? front : rear;
}

export function toWorld(car: { p: Vec3T; q: [number, number, number, number] }, l: Vec3T): Vec3T {
  const [qx, qy, qz, qw] = car.q;
  const ix = qw * l[0] + qy * l[2] - qz * l[1];
  const iy = qw * l[1] + qz * l[0] - qx * l[2];
  const iz = qw * l[2] + qx * l[1] - qy * l[0];
  const iw = -qx * l[0] - qy * l[1] - qz * l[2];
  return [
    car.p[0] + ix * qw + iw * -qx + iy * -qz - iz * -qy,
    car.p[1] + iy * qw + iw * -qy + iz * -qx - ix * -qz,
    car.p[2] + iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export const dist = (a: Vec3T, b: Vec3T) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const ROPE_RANGE = GAME.ropeMaxLength;
