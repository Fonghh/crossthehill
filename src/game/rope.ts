// Winch rope: a one-sided spring (pulls only when stretched past its length). Reeling
// shortens the length while the tension stays under the owner's winch force, so a
// winch can stall against a heavy load just like a real one.

import { GAME } from '../config/game';
import type { RopeSnap, RopeTarget, Vec3T } from '../net/protocol';
import { rotate, type VehiclePhysics } from '../vehicle/vehiclePhysics';

export const ROPE = {
  stiffness: 90000, // N/m
  damping: 9000, // N·s/m
  maxForce: 160000, // cap so towing can't explode the solver
};

type V3 = { x: number; y: number; z: number };

export class Rope {
  length: number;
  tension = 0;
  reeling = false;

  constructor(
    public owner: string,
    public ownerLocal: Vec3T,
    public target: RopeTarget,
    initialLength: number,
  ) {
    this.length = Math.min(GAME.ropeMaxLength, Math.max(GAME.ropeMinLength, initialLength));
  }

  static worldPoint(car: VehiclePhysics, local: Vec3T): V3 {
    const p = car.body.translation();
    const r = rotate(car.body.rotation(), { x: local[0], y: local[1], z: local[2] });
    return { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z };
  }

  static pointVelocity(car: VehiclePhysics, p: V3): V3 {
    const lv = car.body.linvel();
    const av = car.body.angvel();
    const c = car.body.worldCom();
    const r = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    return {
      x: lv.x + av.y * r.z - av.z * r.y,
      y: lv.y + av.z * r.x - av.x * r.z,
      z: lv.z + av.x * r.y - av.y * r.x,
    };
  }

  /** Returns false if the target vanished. */
  apply(dt: number, cars: Map<string, VehiclePhysics>, winchHeld: boolean): boolean {
    const a = cars.get(this.owner);
    if (!a) return false;
    const b = this.target.kind === 'car' ? cars.get(this.target.id) : undefined;
    if (this.target.kind === 'car' && !b) return false;

    const pa = Rope.worldPoint(a, this.ownerLocal);
    const t = this.target;
    const pb = t.kind === 'car' ? Rope.worldPoint(b!, t.local) : { x: t.p[0], y: t.p[1], z: t.p[2] };
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dz = pb.z - pa.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const dir = { x: dx / d, y: dy / d, z: dz / d };

    let F = 0;
    if (d > this.length) {
      const va = Rope.pointVelocity(a, pa);
      const vb = b ? Rope.pointVelocity(b, pb) : { x: 0, y: 0, z: 0 };
      const vrel = (vb.x - va.x) * dir.x + (vb.y - va.y) * dir.y + (vb.z - va.z) * dir.z;
      F = ROPE.stiffness * (d - this.length) + ROPE.damping * vrel;
      F = Math.max(0, Math.min(ROPE.maxForce, F));
    }
    this.tension = F;

    if (F > 0) {
      const J = F * dt;
      a.body.applyImpulseAtPoint({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, pa, true);
      if (b) b.body.applyImpulseAtPoint({ x: -dir.x * J, y: -dir.y * J, z: -dir.z * J }, pb, true);
    }

    this.reeling = false;
    if (winchHeld) {
      // Take up slack quickly; under load, reel at winch speed until the winch stalls.
      if (d < this.length - 0.3) this.length = Math.max(GAME.ropeMinLength, d);
      else if (F < a.spec.winchForce) {
        this.length = Math.max(GAME.ropeMinLength, this.length - a.spec.winchSpeed * dt);
        this.reeling = true;
      }
    }
    return true;
  }

  snap(): RopeSnap {
    return {
      owner: this.owner,
      ownerLocal: this.ownerLocal,
      target: this.target,
      length: +this.length.toFixed(2),
      tension: Math.round(this.tension),
      reeling: this.reeling,
    };
  }
}
