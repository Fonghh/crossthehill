// Authoritative simulation. Runs only on the host (the player who opened the room).

import { GAME } from '../config/game';
import { VEHICLES, type VehicleId, type VehicleSpec } from '../config/vehicles';
import type { CarSnap, ClientMsg, GameEvent, Marker, PlayerInfo, RopeTarget, Snapshot, Vec3T } from '../net/protocol';
import { VehiclePhysics, rotate } from '../vehicle/vehiclePhysics';
import { PhysicsWorld } from '../world/physicsWorld';
import type { TerrainData } from '../world/terrainGen';
import { AnchorIndex, dist, towPointToward, toWorld } from './anchors';
import { Rope } from './rope';

interface PlayerState {
  info: PlayerInfo;
  car: VehiclePhysics;
  winch: boolean;
  lastReset: number;
  drownT: number;
  slot: number;
}

export class HostSim {
  phys: PhysicsWorld;
  players = new Map<string, PlayerState>();
  cars = new Map<string, VehiclePhysics>();
  ropes = new Map<string, Rope>(); // keyed by owner
  anchors: AnchorIndex;
  events: GameEvent[] = [];
  delivered = 0;
  destIndex = 0;
  tripStart = performance.now();
  markers = new Map<string, Marker>();
  time = 0;
  /** Live-tunable copies of the specs (debug panel edits these). */
  specs: Record<VehicleId, VehicleSpec> = structuredClone(VEHICLES);
  private safe: { x: number; y: number; z: number; yaw: number };

  constructor(public terrain: TerrainData) {
    this.phys = new PhysicsWorld(terrain);
    this.anchors = new AnchorIndex(terrain);
    const s = terrain.spawn;
    this.safe = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  }

  get destination() {
    const d = this.terrain.destinations;
    return d[this.destIndex % d.length];
  }

  private freeSlot(): number {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  private spawnPoint(slot: number) {
    // Ring around the current safe pad, facing the next destination.
    const ang = this.safe.yaw + Math.PI / 2 + (slot % 8) * ((Math.PI * 2) / 8);
    const r = slot === 0 ? 0 : 7;
    const x = this.safe.x + Math.sin(ang) * r;
    const z = this.safe.z + Math.cos(ang) * r;
    const d = this.destination;
    return { x, z, yaw: Math.atan2(d.x - x, d.z - z) };
  }

  addPlayer(info: PlayerInfo) {
    const slot = this.freeSlot();
    const sp = this.spawnPoint(slot);
    const car = new VehiclePhysics(this.phys, this.specs[info.car], info.id, { x: sp.x, y: 0, z: sp.z }, sp.yaw);
    car.teleport({ x: sp.x, y: car.groundHeight(sp.x, sp.z) + 1.4, z: sp.z }, sp.yaw);
    this.players.set(info.id, { info, car, winch: false, lastReset: -99, drownT: 0, slot });
    this.cars.set(info.id, car);
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.dropRopesInvolving(id);
    p.car.destroy();
    this.players.delete(id);
    this.cars.delete(id);
    this.markers.delete(id);
  }

  private dropRopesInvolving(id: string) {
    for (const [owner, r] of this.ropes) {
      if (owner === id || (r.target.kind === 'car' && r.target.id === id)) this.ropes.delete(owner);
    }
  }

  playerList(): PlayerInfo[] {
    return [...this.players.values()].map((p) => p.info);
  }

  handle(id: string, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.type) {
      case 'input':
        p.car.input = { steer: clampN(msg.steer, -1, 1), throttle: clampN(msg.throttle, 0, 1), brake: clampN(msg.brake, 0, 1) };
        p.winch = !!msg.winch;
        break;
      case 'attach':
        this.attach(id, msg.target);
        break;
      case 'detach':
        if (this.ropes.delete(id)) this.events.push({ kind: 'detach', id });
        break;
      case 'reset':
        if (this.time - p.lastReset >= GAME.resetCooldownSec) {
          p.lastReset = this.time;
          this.dropRopesInvolving(id);
          p.car.resetUpright();
        }
        break;
      case 'respawn':
        this.respawn(p);
        break;
      case 'horn':
        this.events.push({ kind: 'horn', id });
        break;
      case 'mark':
        this.markers.set(id, { id, x: msg.x, z: msg.z, until: this.time + GAME.markerSeconds });
        break;
      case 'car': {
        const pos = p.car.body.translation();
        const fwd = rotate(p.car.body.rotation(), { x: 0, y: 0, z: 1 });
        this.dropRopesInvolving(id);
        p.car.destroy();
        p.info = { ...p.info, car: msg.car, color: msg.color };
        const car = new VehiclePhysics(this.phys, this.specs[msg.car], id, pos, Math.atan2(fwd.x, fwd.z));
        car.resetUpright(1.8);
        p.car = car;
        this.cars.set(id, car);
        break;
      }
    }
  }

  private respawn(p: PlayerState) {
    this.dropRopesInvolving(p.info.id);
    const sp = this.spawnPoint(p.slot);
    p.car.teleport({ x: sp.x, y: p.car.groundHeight(sp.x, sp.z) + 1.4, z: sp.z }, sp.yaw);
    p.drownT = 0;
  }

  private pose(id: string) {
    const car = this.cars.get(id)!;
    const t = car.body.translation();
    const q = car.body.rotation();
    return { id, car: this.players.get(id)!.info.car, p: [t.x, t.y, t.z] as Vec3T, q: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
  }

  private attach(id: string, target: RopeTarget) {
    const owner = this.cars.get(id);
    if (!owner) return;
    const ownerPose = this.pose(id);
    let aim: Vec3T;
    let tgt: RopeTarget;
    if (target.kind === 'car') {
      if (target.id === id || !this.cars.has(target.id)) return;
      const tp = this.pose(target.id);
      const local = towPointToward(tp, ownerPose.p);
      aim = toWorld(tp, local);
      tgt = { kind: 'car', id: target.id, local };
    } else {
      aim = target.p;
      tgt = target;
    }
    const ownerLocal = towPointToward(ownerPose, aim);
    const from = toWorld(ownerPose, ownerLocal);
    const d = dist(from, aim);
    if (d > GAME.ropeMaxLength + 3) return;
    this.ropes.set(id, new Rope(id, ownerLocal, tgt, d));
    this.events.push({ kind: 'attach', id });
  }

  step(dt: number) {
    this.time += dt;
    for (const [owner, rope] of this.ropes) {
      const p = this.players.get(owner);
      if (!rope.apply(dt, this.cars, !!p?.winch)) this.ropes.delete(owner);
    }
    for (const p of this.players.values()) p.car.step(dt);
    this.phys.step();

    for (const p of this.players.values()) {
      if (p.car.submerged > 0.35) {
        p.drownT += dt;
        if (p.drownT > GAME.drownSeconds) {
          this.respawn(p);
          this.events.push({ kind: 'toast', text: `${p.info.name} 的車泡水了，送回補給點`, id: p.info.id });
        }
      } else p.drownT = 0;
      const y = p.car.body.translation().y;
      if (y < -30) this.respawn(p);
    }
    for (const [id, m] of this.markers) if (m.until < this.time) this.markers.delete(id);
    this.checkDelivery();
  }

  inZone(): string[] {
    const d = this.destination;
    const out: string[] = [];
    for (const [id, car] of this.cars) {
      const t = car.body.translation();
      if (Math.hypot(t.x - d.x, t.z - d.z) < GAME.destinationRadius) out.push(id);
    }
    return out;
  }

  private checkDelivery() {
    if (!this.players.size) return;
    if (this.inZone().length !== this.players.size) return;
    const d = this.destination;
    const seconds = (performance.now() - this.tripStart) / 1000;
    this.delivered++;
    this.events.push({ kind: 'delivered', count: this.delivered, dest: d.name, seconds });
    this.safe = { x: d.x, y: d.y, z: d.z, yaw: 0 };
    this.destIndex++;
    this.tripStart = performance.now();
    const n = this.destination;
    this.safe.yaw = Math.atan2(n.x - d.x, n.z - d.z);
  }

  snapshot(): Snapshot {
    const cars: CarSnap[] = [];
    for (const p of this.players.values()) {
      const c = p.car;
      const t = c.body.translation();
      const q = c.body.rotation();
      const lv = c.body.linvel();
      cars.push({
        id: p.info.id,
        p: [r3(t.x), r3(t.y), r3(t.z)],
        q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)],
        v: [r2(lv.x), r2(lv.y), r2(lv.z)],
        st: r3(c.steerAngle),
        wl: c.wheels.map((w) => r3(w.length)),
        ws: c.wheels.map((w) => r2(w.spin % (Math.PI * 2))),
        rpm: Math.round(c.rpm),
        gear: c.reversing ? -1 : c.gear + 1,
        slip: r2(Math.max(...c.wheels.map((w) => w.slip))),
        surf: c.wheels[2].grounded ? c.wheels[2].surface : 'air',
        sub: r2(c.submerged),
      });
    }
    return {
      t: performance.now(),
      cars,
      ropes: [...this.ropes.values()].map((r) => r.snap()),
      game: {
        delivered: this.delivered,
        destIndex: this.destIndex,
        tripStart: this.tripStart,
        inZone: this.inZone(),
        markers: [...this.markers.values()],
      },
    };
  }

  /** Debug panel: push edited spec to every car of that type. */
  applySpec(id: VehicleId) {
    for (const p of this.players.values()) if (p.info.car === id) p.car.setSpec(this.specs[id]);
  }

  resetCooldownLeft(id: string): number {
    const p = this.players.get(id);
    return p ? Math.max(0, GAME.resetCooldownSec - (this.time - p.lastReset)) : 0;
  }
}

const clampN = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  return n < lo ? lo : n > hi ? hi : n;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
