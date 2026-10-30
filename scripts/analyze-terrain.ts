// Generates the world and writes a slope heat map + road report, so we can spot
// terrain that looks drivable but is not (or vice versa) before anyone plays it.
//   npm run analyze-terrain [-- out/terrain.png]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { generateTerrain, heightAt, surfaceAt } from '../src/world/terrainGen';

const outPath = process.argv[2] ?? 'out/terrain.png';
const t0 = performance.now();
const t = generateTerrain();
const genMs = performance.now() - t0;

const V = t.verts;
const px = V - 1;
const png = new PNG({ width: px, height: px });
const slopeDeg = (x: number, z: number) => {
  const e = t.cell;
  const dx = (heightAt(t, x + e, z) - heightAt(t, x - e, z)) / (2 * e);
  const dz = (heightAt(t, x, z + e) - heightAt(t, x, z - e)) / (2 * e);
  return Math.atan(Math.hypot(dx, dz)) * 57.2958;
};

const buckets = [0, 0, 0, 0, 0];
for (let j = 0; j < px; j++) {
  for (let i = 0; i < px; i++) {
    const x = t.origin + (i + 0.5) * t.cell;
    const z = t.origin + (j + 0.5) * t.cell;
    const h = heightAt(t, x, z);
    const s = surfaceAt(t, x, z);
    let c: [number, number, number];
    if (h < 0) c = [40, 70, 120];
    else if (s.waterDepth > 0.05) c = [70, 140, 200];
    else {
      const d = slopeDeg(x, z);
      // green <20, yellow <28, orange <35, red <42 (winch territory), purple beyond
      if (d < 20) { c = [90, 160, 90]; buckets[0]++; }
      else if (d < 28) { c = [220, 200, 70]; buckets[1]++; }
      else if (d < 35) { c = [235, 140, 50]; buckets[2]++; }
      else if (d < 42) { c = [210, 60, 50]; buckets[3]++; }
      else { c = [120, 50, 130]; buckets[4]++; }
      if (s.road > 0.5) c = [245, 235, 210];
      if (s.mud > 0.5) c = [100, 70, 40];
      const shade = 0.75 + 0.25 * Math.min(1, h / 60);
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    const o = (j * px + i) * 4;
    png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
  }
}
const dot = (x: number, z: number, r: number, c: [number, number, number]) => {
  const ci = Math.round((x - t.origin) / t.cell);
  const cj = Math.round((z - t.origin) / t.cell);
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    if (i * i + j * j > r * r) continue;
    const a = ci + i; const b = cj + j;
    if (a < 0 || b < 0 || a >= px || b >= px) continue;
    const o = (b * px + a) * 4;
    png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2];
  }
};
for (const tr of t.trees) dot(tr.x, tr.z, 0, [30, 90, 40]);
for (const r of t.rocks) dot(r.x, r.z, Math.max(1, Math.round(r.r / t.cell)), [80, 80, 90]);
dot(t.spawn.x, t.spawn.z, 6, [255, 255, 255]);
t.destinations.forEach((d) => dot(d.x, d.z, 6, [255, 60, 160]));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(png));

// Road drivability: longitudinal grade and cross slope sampled on the FINAL mesh.
let worstGrade = 0;
let worstCross = 0;
let steepSamples = 0;
let total = 0;
for (const road of t.roads) {
  for (let k = 1; k < road.length - 1; k++) {
    const a = road[k - 1];
    const b = road[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const g = Math.abs(heightAt(t, b.x, b.z) - heightAt(t, a.x, a.z)) / len;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const p = road[k];
    const cross = Math.abs(heightAt(t, p.x + nx * 2.5, p.z + nz * 2.5) - heightAt(t, p.x - nx * 2.5, p.z - nz * 2.5)) / 5;
    worstGrade = Math.max(worstGrade, g);
    worstCross = Math.max(worstCross, cross);
    if (g > 0.25 || cross > 0.15) steepSamples++;
    total++;
  }
}

// Water consistency: every wet vertex above sea level must belong to a creek mesh.
let phantom = 0;
let creekWet = 0;
for (let n = 0; n < t.verts * t.verts; n++) {
  const wet = t.waterSurf[n] - t.heights[n] > 0.01;
  if (!wet || t.heights[n] < 0) continue;
  if (Number.isFinite(t.creekSurf[n])) creekWet++;
  else phantom++;
}

const land = buckets.reduce((a, b) => a + b, 0);
const pct = (n: number) => ((n / land) * 100).toFixed(1) + '%';
console.log(`generated in ${genMs.toFixed(0)} ms`);
console.log(`roads: ${t.roads.length} (${total * 2} m), creeks: ${t.creeks.length}, rocks: ${t.rocks.length}, trees: ${t.trees.length}, destinations: ${t.destinations.length}`);
console.log(`slope on land  <20°: ${pct(buckets[0])}  20-28°: ${pct(buckets[1])}  28-35°: ${pct(buckets[2])}  35-42°: ${pct(buckets[3])}  >42°: ${pct(buckets[4])}`);
console.log(`road worst grade: ${(worstGrade * 100).toFixed(1)}%  worst cross slope: ${(worstCross * 100).toFixed(1)}%  samples over limit: ${steepSamples}/${total}`);
console.log(`water: ${creekWet} creek vertices wet, ${phantom} wet vertices without visible water (must be 0)`);
console.log(`destinations: ${t.destinations.map((d) => `${d.name}@${d.y.toFixed(0)}m`).join(', ')}`);
console.log(`wrote ${outPath}`);
