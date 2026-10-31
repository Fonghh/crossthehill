// Custom wheel model on a Rapier rigid body. Each wheel sweeps a BALL (not a ray) down
// its suspension axis, so tyres roll over triangle seams and climb rock edges the way a
// round wheel would. All tunables come from VehicleSpec.

import RAPIER from '@dimforge/rapier3d-compat';
import { GAME } from '../config/game';
import { SURFACES, type VehicleSpec } from '../config/vehicles';
import { clamp } from '../world/noise';
import { heightAt, surfaceAt } from '../world/terrainGen';
import type { PhysicsWorld } from '../world/physicsWorld';

export interface DriveInput {
  steer: number; // -1 left .. 1 right
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, then reverse when stopped)
}

export interface WheelState {
  length: number; // current suspension length (mount → wheel centre)
  grounded: boolean;
  spin: number; // accumulated rotation angle, radians
  slip: number; // 0..1, for skid sounds / particles
  surface: 'grass' | 'road' | 'rock' | 'sand' | 'mud' | 'water' | 'car';
}

type V3 = { x: number; y: number; z: number };
const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: V3, s: number): V3 => v(a.x * s, a.y * s, a.z * s);
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3): V3 => { const l = len(a) || 1; return scale(a, 1 / l); };

export function rotate(q: { x: number; y: number; z: number; w: number }, p: V3): V3 {
  const ix = q.w * p.x + q.y * p.z - q.z * p.y;
  const iy = q.w * p.y + q.z * p.x - q.x * p.z;
  const iz = q.w * p.z + q.x * p.y - q.y * p.x;
  const iw = -q.x * p.x - q.y * p.y - q.z * p.z;
  return v(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  );
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export class VehiclePhysics {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  cabinCollider: RAPIER.Collider;
  wheels: WheelState[];
  steerAngle = 0;
  gear = 0;
  rpm = 0;
  reversing = false;
  speed = 0; // m/s along forward axis
  input: DriveInput = { steer: 0, throttle: 0, brake: 0 };
  submerged = 0; // metres the chassis centre is under water
  /** Pedal positions after ramping: a held pedal builds up power instead of jumping to full. */
  private gasPedal = 0;
  private reversePedal = 0;
  private brakePedal = 0;
  private ball: RAPIER.Ball;
  private mounts: V3[];
  private prevLen: number[];

  constructor(public phys: PhysicsWorld, public spec: VehicleSpec, carId: string, pos: V3, yaw: number) {
    const world = phys.world;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(q)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.3);
    this.body = world.createRigidBody(bodyDesc);
    const [hx, hy, hz] = spec.halfExtents;
    const br = 0.16;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(hx - br, hy - br, hz - br, br).setDensity(0).setFriction(0.5).setRestitution(0.1),
      this.body,
    );
    phys.tags.set(this.collider.handle, { kind: 'car', carId });
    // Cabin + roof cargo: so a rolled car rests on its roof instead of sinking into the ground.
    const [cx, cy, cz, coy, coz] = spec.cabin;
    this.cabinCollider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(cx - br, cy - br, cz - br, br).setTranslation(0, coy, coz).setDensity(0).setFriction(0.5).setRestitution(0.1),
      this.body,
    );
    phys.tags.set(this.cabinCollider.handle, { kind: 'car', carId });
    this.ball = new RAPIER.Ball(spec.wheelRadius);
    this.mounts = [
      v(-spec.trackHalf, spec.mountY, spec.frontZ),
      v(spec.trackHalf, spec.mountY, spec.frontZ),
      v(-spec.trackHalf, spec.mountY, spec.rearZ),
      v(spec.trackHalf, spec.mountY, spec.rearZ),
    ];
    this.wheels = this.mounts.map(() => ({ length: spec.suspensionTravel, grounded: false, spin: 0, slip: 0, surface: 'grass' as const }));
    this.prevLen = this.mounts.map(() => spec.suspensionTravel);
    this.applyMass();
  }

  get totalMass() {
    return this.spec.mass + GAME.cargoMass;
  }

  applyMass() {
    const s = this.spec;
    const m = this.totalMass;
    const [hx, hy, hz] = s.halfExtents;
    const w = hx * 2, h = hy * 2 + 0.6, d = hz * 2;
    const k = s.inertiaScale / 12;
    this.body.setAdditionalMassProperties(
      m,
      v(s.comOffset[0], s.comOffset[1], s.comOffset[2]),
      v(k * m * (h * h + d * d), k * m * (w * w + d * d), k * m * (w * w + h * h)),
      IDENTITY,
      true,
    );
  }

  /** Swap spec live (debug tuning) without recreating the body. */
  setSpec(spec: VehicleSpec) {
    this.spec = spec;
    this.ball = new RAPIER.Ball(spec.wheelRadius);
    this.mounts = [
      v(-spec.trackHalf, spec.mountY, spec.frontZ),
      v(spec.trackHalf, spec.mountY, spec.frontZ),
      v(-spec.trackHalf, spec.mountY, spec.rearZ),
      v(spec.trackHalf, spec.mountY, spec.rearZ),
    ];
    this.applyMass();
  }

  mountLocal(i: number): V3 {
    return this.mounts[i];
  }

  step(dt: number) {
    const s = this.spec;
    const body = this.body;
    const world = this.phys.world;
    const terrain = this.phys.terrain;
    const pos = body.translation();
    const q = body.rotation();
    const up = rotate(q, v(0, 1, 0));
    const fwd = rotate(q, v(0, 0, 1));
    const linvel = body.linvel();
    const angvel = body.angvel();
    const com = body.worldCom();
    const mass = this.totalMass;
    const inp = this.input;

    this.speed = dot(linvel, fwd);
    const speedAbs = Math.abs(this.speed);

    // Steering, softened with speed.
    const steerLimit = s.maxSteer + (s.highSpeedSteer - s.maxSteer) * clamp(speedAbs / 16.7, 0, 1);
    const target = clamp(inp.steer, -1, 1) * steerLimit;
    const ds = s.steerSpeed * dt;
    this.steerAngle += clamp(target - this.steerAngle, -ds, ds);

    // --- Suspension sweep -----------------------------------------------------
    const castDir = scale(up, -1);
    const hits: { p: V3; n: V3; col: RAPIER.Collider | null }[] = [];
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const mount = add(pos, rotate(q, this.mounts[i]));
      const hit = world.castShape(mount, IDENTITY, castDir, this.ball, 0, s.suspensionTravel, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
      const w = this.wheels[i];
      if (hit) {
        const l = hit.time_of_impact;
        const centre = add(mount, scale(castDir, l));
        const n2 = hit.normal2; // ball-local == world orientation (ball not rotated)
        let n = norm(v(-n2.x, -n2.y, -n2.z));
        if (dot(n, up) < 0.05) n = up; // degenerate side-hit
        const p = add(centre, scale(n, -s.wheelRadius));
        w.length = l;
        w.grounded = true;
        hits.push({ p, n, col: hit.collider });
        grounded++;
      } else {
        w.length = Math.min(s.suspensionTravel, w.length + dt * 6);
        w.grounded = false;
        hits.push({ p: v(), n: up, col: null });
      }
    }

    // --- Engine & gearbox -------------------------------------------------------
    const wantsForward = inp.throttle > 0.05;
    const wantsBack = inp.brake > 0.05;
    if (wantsBack && this.speed < 0.6) this.reversing = true;
    if (wantsForward && this.speed > -0.6) this.reversing = false;
    if (!wantsBack && !wantsForward && this.speed > 0.3) this.reversing = false;

    // Pedals ramp up while held and drop quickly when released.
    // Releasing any pedal lets go almost at once (fully off within ~0.1 s).
    const ramp = (cur: number, want: number, rise: number) => want > cur ? Math.min(want, cur + rise * dt) : Math.max(want, cur - 10 * dt);
    this.gasPedal = ramp(this.gasPedal, this.reversing ? 0 : inp.throttle, s.throttleRise);
    this.reversePedal = ramp(this.reversePedal, this.reversing ? inp.brake : 0, s.throttleRise);
    // Brake pedal: whichever pedal opposes the current direction of travel.
    this.brakePedal = ramp(this.brakePedal, this.reversing ? inp.throttle : inp.brake, s.brakeRise);

    const wheelOmega = speedAbs / s.wheelRadius;
    const ratio = this.reversing ? s.reverseGear : s.gears[this.gear];
    this.rpm = clamp((wheelOmega * ratio * s.finalDrive * 60) / (2 * Math.PI), s.idleRpm, s.redlineRpm);
    if (!this.reversing) {
      if (this.rpm > s.upshiftRpm && this.gear < s.gears.length - 1) this.gear++;
      else if (this.rpm < s.downshiftRpm && this.gear > 0) this.gear--;
    } else this.gear = 0;

    const rpmT = (this.rpm - s.idleRpm) / (s.redlineRpm - s.idleRpm);
    const torque = s.torqueNm * (0.72 + 0.28 * Math.sin(Math.PI * clamp(rpmT * 0.9 + 0.1, 0, 1)));
    let driveTotal = 0;
    let braking = false;
    if (this.reversing) {
      if (wantsBack && -this.speed < s.maxReverseKmh / 3.6) driveTotal = -(torque * ratio * s.finalDrive * 0.85 / s.wheelRadius) * this.reversePedal;
      if (wantsForward) braking = true;
    } else {
      if (wantsForward && this.speed < s.maxSpeedKmh / 3.6) driveTotal = (torque * ratio * s.finalDrive * 0.85 / s.wheelRadius) * this.gasPedal;
      if (this.rpm >= s.redlineRpm - 10 && this.gear === s.gears.length - 1) driveTotal *= 0.2;
      if (wantsBack) braking = true;
    }
    // Off both pedals: engine braking slows the car gradually; only near standstill
    // does the hill-hold lock it so it doesn't creep on slopes.
    const coasting = !wantsForward && !wantsBack;
    const holding = coasting && speedAbs < s.holdSpeed;

    // --- Per-wheel forces --------------------------------------------------------
    const mEff = grounded ? mass / grounded : mass;
    const leftRightComp = [0, 0];
    for (let i = 0; i < 4; i++) {
      const comp = s.suspensionTravel - this.wheels[i].length;
      if (i < 2) leftRightComp[0] += i === 0 ? comp : -comp;
      else leftRightComp[1] += i === 2 ? comp : -comp;
    }
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const front = i < 2;
      const h = hits[i];
      // Wheel spin for visuals.
      if (!w.grounded) {
        w.spin += (driveTotal !== 0 ? Math.sign(driveTotal) * 18 : this.speed / s.wheelRadius) * dt;
        w.slip = 0;
        this.prevLen[i] = w.length;
        continue;
      }
      const comp = s.suspensionTravel - w.length;
      const compVel = (this.prevLen[i] - w.length) / dt;
      this.prevLen[i] = w.length;
      let F = s.springK * comp + (compVel > 0 ? s.damperBump : s.damperRebound) * compVel;
      if (comp > s.suspensionTravel * 0.85) F += s.bumpStopK * (comp - s.suspensionTravel * 0.85);
      if (s.antiRoll) F += s.antiRoll * (i < 2 ? leftRightComp[0] : leftRightComp[1]) * (i % 2 === 0 ? 1 : -1);
      F = clamp(F, 0, mass * 9.81 * 3);
      body.applyImpulseAtPoint(scale(up, F * dt), h.p, true);

      // Surface under this tyre.
      const tag = this.phys.tagOf(h.col);
      let mu: number;
      let resist: number;
      if (tag?.kind === 'car') { mu = SURFACES.car.grip; resist = 0.02; w.surface = 'car'; }
      else if (tag?.kind === 'rock') { mu = SURFACES.rock.grip; resist = SURFACES.rock.resistance; w.surface = 'rock'; }
      else {
        const sf = surfaceAt(terrain, h.p.x, h.p.z);
        const grass = Math.max(0, 1 - sf.road - sf.mud - sf.rock - sf.sand);
        const tot = grass + sf.road + sf.mud + sf.rock + sf.sand || 1;
        mu = (grass * SURFACES.grass.grip + sf.road * SURFACES.road.grip + sf.mud * SURFACES.mud.grip + sf.rock * SURFACES.rock.grip + sf.sand * SURFACES.sand.grip) / tot;
        resist = (grass * SURFACES.grass.resistance + sf.road * SURFACES.road.resistance + sf.mud * SURFACES.mud.resistance + sf.rock * SURFACES.rock.resistance + sf.sand * SURFACES.sand.resistance) / tot;
        if (sf.waterDepth > 0.1) mu = Math.min(mu, SURFACES.water.grip);
        w.surface = sf.waterDepth > 0.15 ? 'water' : sf.mud > 0.5 ? 'mud' : sf.rock > 0.5 ? 'rock' : sf.sand > 0.5 ? 'sand' : sf.road > 0.5 ? 'road' : 'grass';
      }
      mu *= s.grip;

      // Tyre frame on the contact plane.
      const n = h.n;
      let wf = fwd;
      if (front) {
        const c = Math.cos(this.steerAngle);
        const sn = Math.sin(this.steerAngle);
        const right = rotate(q, v(1, 0, 0));
        wf = add(scale(fwd, c), scale(right, -sn));
      }
      const f = norm(sub(wf, scale(n, dot(wf, n))));
      const side = norm(cross(n, f));
      const r = sub(h.p, com);
      const vel = add(linvel, cross(angvel, r));
      const vf = dot(vel, f);
      const vs = dot(vel, side);
      const N = F;
      const maxImp = mu * N * dt;

      let Js = -vs * mEff * s.lateralStiffness;
      let Jf = (driveTotal / 4) * dt;
      if (braking) Jf = -Math.sign(vf) * Math.min(Math.abs(vf) * mEff, (s.brakeForce / 4) * dt * this.brakePedal);
      else if (holding) Jf = -vf * mEff * s.hillHold;
      else if (coasting) Jf = -Math.sign(vf) * Math.min(Math.abs(vf) * mEff, (s.engineBrake / 4) * dt);
      const rr = resist * s.rollingResistance * N * dt;
      Jf -= Math.sign(vf) * Math.min(Math.abs(vf) * mEff * 0.5, rr);
      const Jmag = Math.hypot(Jf, Js);
      w.slip = 0;
      if (Jmag > maxImp && Jmag > 0) {
        const k = maxImp / Jmag;
        w.slip = clamp(1 - k, 0, 1);
        Jf *= k;
        Js *= k;
      }
      const applyAt = add(h.p, scale(up, s.forceLift));
      body.applyImpulseAtPoint(add(scale(f, Jf), scale(side, Js)), applyAt, true);

      const spinRate = driveTotal !== 0 && w.slip > 0.3 ? Math.sign(driveTotal) * Math.max(Math.abs(vf / s.wheelRadius), 10) : vf / s.wheelRadius;
      w.spin += spinRate * dt;
    }

    // --- Water ---------------------------------------------------------------------
    const sfc = surfaceAt(terrain, pos.x, pos.z);
    const bottom = pos.y - s.halfExtents[1];
    const depth = sfc.waterSurface - bottom;
    this.submerged = sfc.waterSurface - pos.y;
    if (depth > 0) {
      const d = Math.min(depth, 1.5);
      const k = Math.min(1, (SURFACES.water.drag * d * dt) / mass * 4);
      body.applyImpulse(scale(v(linvel.x, linvel.y * 0.5, linvel.z), -mass * k * 0.25), true);
    }
  }

  /** Flip upright at the current spot. */
  resetUpright(lift = 1.6) {
    const p = this.body.translation();
    const fwd = rotate(this.body.rotation(), v(0, 0, 1));
    const yaw = Math.atan2(fwd.x, fwd.z);
    const ground = this.groundHeight(p.x, p.z);
    this.teleport(v(p.x, ground + lift, p.z), yaw);
  }

  groundHeight(x: number, z: number): number {
    const ray = new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 });
    const hit = this.phys.world.castRay(ray, 600, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    // Ray catches rocks/trees; the height map is the fallback before the query pipeline is built.
    return Math.max(heightAt(this.phys.terrain, x, z), hit ? 300 - hit.timeOfImpact : -Infinity);
  }

  teleport(p: V3, yaw: number) {
    this.body.setTranslation(p, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel(v(), true);
    this.body.setAngvel(v(), true);
    for (let i = 0; i < 4; i++) { this.wheels[i].length = this.spec.suspensionTravel; this.prevLen[i] = this.spec.suspensionTravel; }
  }

  destroy() {
    this.phys.tags.delete(this.collider.handle);
    this.phys.tags.delete(this.cabinCollider.handle);
    this.phys.world.removeRigidBody(this.body);
  }
}
