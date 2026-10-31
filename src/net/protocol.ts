import type { VehicleId } from '../config/vehicles';

export type Vec3T = [number, number, number];

export interface PlayerInfo {
  id: string;
  name: string;
  car: VehicleId;
  color: string;
  host?: boolean; // currently running the simulation
  away?: boolean; // disconnected; car is kept for a while so they can come back
}

export interface CarSnap {
  id: string;
  p: Vec3T;
  q: [number, number, number, number];
  v: Vec3T;
  st: number; // steer angle
  wl: number[]; // suspension length per wheel
  ws: number[]; // wheel spin angle per wheel
  rpm: number;
  gear: number; // -1 reverse
  slip: number; // 0..1 max wheel slip
  surf: string; // surface under the rear-left wheel (for sounds)
  sub: number; // metres under water (chassis centre)
}

export type RopeTarget =
  | { kind: 'car'; id: string; local: Vec3T }
  | { kind: 'point'; p: Vec3T; obj: 'tree' | 'rock' };

export interface RopeSnap {
  owner: string;
  ownerLocal: Vec3T;
  target: RopeTarget;
  length: number;
  tension: number;
  reeling: boolean;
}

export interface Marker { id: string; x: number; z: number; until: number }

export interface GameSnap {
  simTime: number; // host sim clock (seconds); marker expiry is relative to it
  delivered: number;
  destIndex: number;
  tripStart: number;
  inZone: string[];
  markers: Marker[];
}

export interface Snapshot {
  t: number;
  cars: CarSnap[];
  ropes: RopeSnap[];
  game: GameSnap;
}

export type GameEvent =
  | { kind: 'horn'; id: string }
  | { kind: 'delivered'; count: number; dest: string; seconds: number }
  | { kind: 'toast'; text: string; id?: string }
  | { kind: 'attach'; id: string }
  | { kind: 'detach'; id: string };

export interface InputMsg { type: 'input'; steer: number; throttle: number; brake: number; winch: boolean }

export type ClientMsg =
  | { type: 'hello'; name: string; car: VehicleId; color: string; prevId?: string }
  | InputMsg
  | { type: 'attach'; target: RopeTarget }
  | { type: 'detach' }
  | { type: 'reset' }
  | { type: 'respawn' }
  | { type: 'horn' }
  | { type: 'mark'; x: number; z: number }
  | { type: 'car'; car: VehicleId; color: string }
  | { type: 'ping'; t: number };

export type HostMsg =
  | { type: 'welcome'; you: string; seed: number }
  | { type: 'players'; players: PlayerInfo[] }
  | { type: 'snap'; t: number; c: PackedCar[]; ropes: RopeSnap[]; game: GameSnap }
  | { type: 'event'; ev: GameEvent }
  | { type: 'reject'; reason: string }
  | { type: 'pong'; t: number; host: number };

// Snapshots go out 20×/s to every client, so cars are packed as flat arrays (no keys).
export type PackedCar = (number | string)[];
const SURF = ['grass', 'road', 'rock', 'sand', 'mud', 'water', 'car', 'air'];

export function packCar(c: CarSnap): PackedCar {
  return [c.id, ...c.p, ...c.q, ...c.v, c.st, ...c.wl, ...c.ws, c.rpm, c.gear, c.slip, Math.max(0, SURF.indexOf(c.surf)), c.sub];
}

export function unpackCar(a: PackedCar): CarSnap {
  const n = (i: number) => a[i] as number;
  return {
    id: a[0] as string,
    p: [n(1), n(2), n(3)],
    q: [n(4), n(5), n(6), n(7)],
    v: [n(8), n(9), n(10)],
    st: n(11),
    wl: [n(12), n(13), n(14), n(15)],
    ws: [n(16), n(17), n(18), n(19)],
    rpm: n(20),
    gear: n(21),
    slip: n(22),
    surf: SURF[n(23)] ?? 'grass',
    sub: n(24),
  };
}
