// Headless driving checks on the real generated world.
//   npm run test-physics
// 1. settle at spawn (suspension sag sane, no bouncing)
// 2. follow the first road with a simple steering bot and report progress
// 3. drive into the nearest boulder and check we climb/stop instead of tunnelling

import { generateTerrain, heightAt } from '../src/world/terrainGen';
import { PhysicsWorld } from '../src/world/physicsWorld';
import { VehiclePhysics, rotate } from '../src/vehicle/vehiclePhysics';
import { VEHICLES, type VehicleId } from '../src/config/vehicles';

await PhysicsWorld.init();
const t0 = performance.now();
const terrain = generateTerrain();
const phys = new PhysicsWorld(terrain);
console.log(`world built in ${(performance.now() - t0).toFixed(0)} ms`);

const dt = 1 / 60;
const tilt = (car: VehiclePhysics) => {
  const up = rotate(car.body.rotation(), { x: 0, y: 1, z: 0 });
  return Math.acos(Math.min(1, up.y)) * 57.3;
};

function run(id: VehicleId) {
  const spec = VEHICLES[id];
  const road = terrain.roads[0];
  const start = road[3];
  const yaw = Math.atan2(road[6].x - start.x, road[6].z - start.z);
  const car = new VehiclePhysics(phys, spec, id, { x: start.x, y: heightAt(terrain, start.x, start.z) + 1.5, z: start.z }, yaw);

  for (let k = 0; k < 120; k++) { car.step(dt); phys.step(); }
  const p0 = car.body.translation();
  const sag = car.wheels.map((w) => (spec.suspensionTravel - w.length).toFixed(3)).join(',');
  console.log(`[${id}] settled y-ground=${(p0.y - heightAt(terrain, p0.x, p0.z)).toFixed(2)} compression=${sag} tilt=${tilt(car).toFixed(1)}° grounded=${car.wheels.filter((w) => w.grounded).length}`);

  // Pure-pursuit along the road for 40 s.
  let idx = 3;
  let maxTilt = 0;
  let maxSpeed = 0;
  for (let k = 0; k < 60 * 40; k++) {
    const p = car.body.translation();
    while (idx < road.length - 1 && Math.hypot(road[idx].x - p.x, road[idx].z - p.z) < 9) idx++;
    if (idx >= road.length - 1) break; // end of road: don't U-turn at speed
    const tgt = road[idx];
    const fwd = rotate(car.body.rotation(), { x: 0, y: 0, z: 1 });
    const want = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    const have = Math.atan2(fwd.x, fwd.z);
    let err = want - have;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    car.input = { steer: Math.max(-1, Math.min(1, -err * 2)), throttle: car.speed < 9 ? 0.8 : 0.2, brake: 0 };
    car.step(dt);
    phys.step();
    maxTilt = Math.max(maxTilt, tilt(car));
    maxSpeed = Math.max(maxSpeed, car.speed);
  }
  console.log(`[${id}] road follow: reached sample ${idx}/${road.length} maxSpeed=${(maxSpeed * 3.6).toFixed(0)}km/h maxTilt=${maxTilt.toFixed(1)}° gear=${car.gear + 1}`);

  // Boulder approach.
  const p = car.body.translation();
  let rock = terrain.rocks[0];
  let best = Infinity;
  for (const r of terrain.rocks) {
    const d = Math.hypot(r.x - p.x, r.z - p.z);
    if (r.r > 1.2 && r.r < 1.8 && d < best) { best = d; rock = r; }
  }
  const ang = Math.atan2(rock.x - p.x, rock.z - p.z);
  const sx = rock.x - Math.sin(ang) * 14;
  const sz = rock.z - Math.cos(ang) * 14;
  car.teleport({ x: sx, y: heightAt(terrain, sx, sz) + 1.4, z: sz }, ang);
  for (let k = 0; k < 60; k++) { car.input = { steer: 0, throttle: 0, brake: 0 }; car.step(dt); phys.step(); }
  let minDist = Infinity;
  let peak = -Infinity;
  for (let k = 0; k < 60 * 8; k++) {
    car.input = { steer: 0, throttle: 0.6, brake: 0 };
    car.step(dt);
    phys.step();
    const q = car.body.translation();
    minDist = Math.min(minDist, Math.hypot(q.x - rock.x, q.z - rock.z));
    peak = Math.max(peak, q.y - heightAt(terrain, q.x, q.z));
  }
  console.log(`[${id}] boulder r=${rock.r.toFixed(2)}: closest centre distance ${minDist.toFixed(2)}m (rock radius ${(rock.r * Math.max(rock.sx, rock.sz)).toFixed(2)}), max height above ground ${peak.toFixed(2)}m, final tilt ${tilt(car).toFixed(0)}°`);
  car.destroy();
}

run('jeep');
run('bigfoot');

// 4. Winch: jeep A tows bigfoot B by reeling in; then A winches itself to a tree.
{
  const { HostSim } = await import('../src/game/sim');
  const sim = new HostSim(terrain);
  sim.addPlayer({ id: 'a', name: 'A', car: 'jeep', color: '#f00' });
  sim.addPlayer({ id: 'b', name: 'B', car: 'bigfoot', color: '#0f0' });
  for (let k = 0; k < 90; k++) sim.step(dt);
  const pa = sim.cars.get('a')!.body.translation();
  const pb0 = sim.cars.get('b')!.body.translation();
  const d0 = Math.hypot(pa.x - pb0.x, pa.z - pb0.z);
  sim.handle('a', { type: 'attach', target: { kind: 'car', id: 'b', local: [0, 0, 0] } });
  console.log(`[winch] attached: ${sim.ropes.has('a')} start distance ${d0.toFixed(2)} rope ${sim.ropes.get('a')?.length.toFixed(2)}`);
  sim.handle('a', { type: 'input', steer: 0, throttle: 0, brake: 0, winch: true });
  let maxT = 0;
  for (let k = 0; k < 60 * 4; k++) { sim.step(dt); maxT = Math.max(maxT, sim.ropes.get('a')?.tension ?? 0); }
  const pa1 = sim.cars.get('a')!.body.translation();
  const pb1 = sim.cars.get('b')!.body.translation();
  console.log(`[winch] after 4s reel: distance ${Math.hypot(pa1.x - pb1.x, pa1.z - pb1.z).toFixed(2)} rope ${sim.ropes.get('a')?.length.toFixed(2)} maxTension ${maxT.toFixed(0)}N, B moved ${Math.hypot(pb1.x - pb0.x, pb1.z - pb0.z).toFixed(2)}m`);
  sim.handle('a', { type: 'detach' });

  const cands = sim.anchors.query([pa1.x, pa1.y, pa1.z], 30, [], 'a').filter((c) => c.target.kind === 'point');
  if (cands.length) {
    const c = cands[0];
    sim.handle('a', { type: 'attach', target: c.target });
    const before = Math.hypot(pa1.x - c.pos[0], pa1.z - c.pos[2]);
    for (let k = 0; k < 60 * 6; k++) sim.step(dt);
    const p = sim.cars.get('a')!.body.translation();
    console.log(`[winch] self-recovery to ${c.label}: ${before.toFixed(1)}m -> ${Math.hypot(p.x - c.pos[0], p.z - c.pos[2]).toFixed(1)}m`);
  } else console.log('[winch] no static anchor nearby');
}

// 5. Pedal feel: throttle ramps in; releasing coasts down gradually (no sudden stop).
{
  const road = terrain.roads[0];
  const s0 = road[20];
  const yaw = Math.atan2(road[23].x - s0.x, road[23].z - s0.z);
  for (const id of ['jeep', 'bigfoot'] as VehicleId[]) {
    const car = new VehiclePhysics(phys, VEHICLES[id], id + '-pedal', { x: s0.x, y: heightAt(terrain, s0.x, s0.z) + 1.5, z: s0.z }, yaw);
    for (let k = 0; k < 90; k++) { car.step(dt); phys.step(); }
    const speeds: number[] = [];
    for (let k = 0; k < 60 * 3; k++) {
      car.input = { steer: 0, throttle: 1, brake: 0 };
      car.step(dt); phys.step();
      if (k % 30 === 29) speeds.push(car.speed * 3.6);
    }
    const coast: number[] = [];
    let stopAt = -1;
    for (let k = 0; k < 60 * 8; k++) {
      car.input = { steer: 0, throttle: 0, brake: 0 };
      car.step(dt); phys.step();
      if (k % 60 === 59) coast.push(car.speed * 3.6);
      if (stopAt < 0 && Math.abs(car.speed) < 0.3) stopAt = k / 60;
    }
    console.log(`[${id}] accel km/h every 0.5s: ${speeds.map((v) => v.toFixed(0)).join(' ')} | coast every 1s: ${coast.map((v) => v.toFixed(0)).join(' ')} | stopped after ${stopAt < 0 ? '>8' : stopAt.toFixed(1)}s`);
    car.destroy();
  }
}
