import type { VehicleId } from '../config/vehicles';

export type Vec3T = [number, number, number];

export interface PlayerInfo {
  id: string;
  name: string;
  car: VehicleId;
  color: string;
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
  | { type: 'hello'; name: string; car: VehicleId; color: string }
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
  | ({ type: 'snap' } & Snapshot)
  | { type: 'event'; ev: GameEvent }
  | { type: 'reject'; reason: string }
  | { type: 'pong'; t: number; host: number };
