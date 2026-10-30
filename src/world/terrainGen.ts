// Procedural island terrain. Pure data, no three/rapier, so the analysis script can
// run exactly the same generator in node. Everything the player can collide with is
// described here once; render and physics both build from these arrays.

import { GAME } from '../config/game';
import { Simplex2, mulberry32, clamp, lerp, smoothstep } from './noise';

export interface Vec2 { x: number; z: number }

export interface Rock {
  x: number; y: number; z: number;
  r: number;
  sx: number; sy: number; sz: number;
  rot: number;
  detail: number;
  seed: number;
}

export interface Tree {
  x: number; y: number; z: number;
  scale: number;
  kind: number; // 0 orange, 1 red, 2 yellow, 3 conifer, 4 birch
  rot: number;
  trunkR: number;
  trunkH: number;
}

export interface Creek {
  pts: Vec2[];
  surf: number[]; // water surface height per point
  halfWidth: number;
}

export interface Destination { x: number; z: number; y: number; name: string }

export interface TerrainData {
  size: number;
  cell: number;
  verts: number; // vertices per side
  origin: number; // world coord of vertex 0
  heights: Float32Array;
  matRoad: Float32Array;
  matMud: Float32Array;
  matRock: Float32Array;
  matSand: Float32Array;
  waterSurf: Float32Array; // water surface height per vertex (sea = seaLevel)
  roads: Vec2[][];
  creeks: Creek[];
  rocks: Rock[];
  trees: Tree[];
  spawn: { x: number; z: number; y: number; yaw: number };
  destinations: Destination[];
}

const DEST_NAMES = [
  '松果小屋', '楓葉營地', '老橡木橋', '雲端瞭望台',
  '溪谷工坊', '紅岩礦場', '風車山丘', '山頂氣象站',
];

export function generateTerrain(seed = GAME.worldSeed): TerrainData {
  const size = GAME.mapSize;
  const cell = GAME.cellSize;
  const cells = size / cell;
  const V = cells + 1;
  const origin = -size / 2;
  const rnd = mulberry32(seed);
  const nz = new Simplex2(seed);
  const nz2 = new Simplex2(seed + 77);

  const heights = new Float32Array(V * V);
  const idx = (i: number, j: number) => j * V + i;
  const wx = (i: number) => origin + i * cell;

  // ---- 1. Base landform -------------------------------------------------
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = wx(i);
      const z = wx(j);
      const r = Math.hypot(x, z) / (size / 2);
      const coast = r + 0.09 * nz.noise(x / 220, z / 220);
      const island = smoothstep(0.98, 0.74, coast);
      const hills = nz.fbm(x / 260, z / 260, 5);
      const ridge = nz2.ridged(x / 430, z / 430, 3);
      const mountain = smoothstep(0.05, 0.55, nz2.noise(x / 620 + 13.1, z / 620 - 4.2));
      const bumps = nz.fbm(x / 45 + 50, z / 45 - 20, 3);
      let h = 13 + hills * 18 + mountain * ridge * 58 + bumps * 1.3;
      h = h * island - (1 - island) * 9;
      heights[idx(i, j)] = h;
    }
  }
  // Soften sub-10m spikes: the noise can produce faces steeper than any car (or eye) expects.
  boxBlur(heights, V, 2);
  boxBlur(heights, V, 2);

  const sampleRaw = (x: number, z: number) => heightAtArray(heights, V, origin, cell, x, z);

  const slopeAtRaw = (x: number, z: number, d = 4) => {
    const dx = (sampleRaw(x + d, z) - sampleRaw(x - d, z)) / (2 * d);
    const dz = (sampleRaw(x, z + d) - sampleRaw(x, z - d)) / (2 * d);
    return Math.hypot(dx, dz);
  };

  // ---- 2. Spawn + destinations -----------------------------------------
  const flatCandidates: Destination[] = [];
  for (let k = 0; k < 6000; k++) {
    const x = (rnd() - 0.5) * size * 0.78;
    const z = (rnd() - 0.5) * size * 0.78;
    if (Math.hypot(x, z) > size * 0.38) continue;
    const y = sampleRaw(x, z);
    if (y < 3) continue;
    if (slopeAtRaw(x, z, 8) > 0.32) continue;
    flatCandidates.push({ x, z, y, name: '' });
  }

  let spawn = flatCandidates[0];
  let best = Infinity;
  for (const c of flatCandidates) {
    const score = Math.abs(c.y - 9) * 3 + Math.hypot(c.x, c.z - 180) * 0.2 + slopeAtRaw(c.x, c.z, 10) * 200;
    if (score < best) { best = score; spawn = c; }
  }

  const maxCandH = flatCandidates.reduce((m, c) => Math.max(m, c.y), 0);
  const destinations: Destination[] = [];
  let prev: Vec2 = spawn;
  for (let k = 0; k < GAME.destinationCount; k++) {
    const targetH = lerp(10, maxCandH * 0.85, k / (GAME.destinationCount - 1));
    let pick: Destination | null = null;
    let pickScore = Infinity;
    for (const c of flatCandidates) {
      const d = Math.hypot(c.x - prev.x, c.z - prev.z);
      if (d < 150 || d > 400) continue;
      let tooClose = Math.hypot(c.x - spawn.x, c.z - spawn.z) < 140;
      for (const o of destinations) if (Math.hypot(c.x - o.x, c.z - o.z) < 150) tooClose = true;
      if (tooClose) continue;
      const score = Math.abs(c.y - targetH) + Math.abs(d - 260) * 0.05 + slopeAtRaw(c.x, c.z, 10) * 60;
      if (score < pickScore) { pickScore = score; pick = c; }
    }
    if (!pick) break;
    destinations.push({ ...pick, name: DEST_NAMES[k % DEST_NAMES.length] });
    prev = pick;
  }

  // Flatten pads (spawn + destinations) so parking areas are level.
  const pads = [spawn, ...destinations];
  for (const p of pads) {
    const padH = sampleRaw(p.x, p.z);
    p.y = padH;
    flattenDisc(heights, V, origin, cell, p.x, p.z, padH, 13, 14);
  }

  // ---- 3. Roads (A* on a coarse grid, then grade-limited carve) ------------
  const roads: Vec2[][] = [];
  const roadDist = new Float32Array(V * V).fill(1e9);
  const roadHalf = 3.2;
  const chain = [spawn, ...destinations];
  // Roads are carved one by one; later roads see (and prefer) earlier ones and never
  // overwrite an existing road surface, so shared corridors stay level across.
  for (let k = 0; k + 1 < chain.length; k++) {
    const path = findRoute(chain[k], chain[k + 1], sampleRaw, size, roadDist, V, origin, cell);
    const all = resample(chaikin(chaikin(chaikin(path))), 2);
    const prof = roadProfile(all, sampleRaw, chain[k].y, chain[k + 1].y);
    // Where this road runs beside or onto an earlier one, match that road's surface height,
    // and skip the stretches that already ride on an existing road (no parallel twin roads).
    const segs: { pts: Vec2[]; prof: number[] }[] = [{ pts: [], prof: [] }];
    for (let q = 0; q < all.length; q++) {
      const dExisting = sampleArray(roadDist, V, origin, cell, all[q].x, all[q].z);
      if (dExisting < 16) prof[q] = lerp(prof[q], sampleRaw(all[q].x, all[q].z), 1 - smoothstep(6, 16, dExisting));
      if (dExisting < 5.5) {
        if (segs[segs.length - 1].pts.length) segs.push({ pts: [], prof: [] });
        continue;
      }
      segs[segs.length - 1].pts.push(all[q]);
      segs[segs.length - 1].prof.push(prof[q]);
    }
    const dist = new Float32Array(V * V).fill(1e9);
    const rh = new Float32Array(V * V);
    for (const seg of segs) {
      if (seg.pts.length < 10) continue; // short connector stubs between existing roads only add kinks
      roads.push(seg.pts);
      rasterizeRoad(seg.pts, seg.prof, dist, rh, V, origin, cell);
    }
    for (let n = 0; n < V * V; n++) {
      const d = dist[n];
      if (d > 40) continue;
      if (roadDist[n] < roadHalf + 0.8) continue;
      const h0 = heights[n];
      const blend = clamp(Math.abs(h0 - rh[n]) * 1.6, 6, 26);
      let w = 1 - smoothstep(roadHalf, roadHalf + blend, d);
      // Fade the carve near earlier roads so the junction shoulder stays smooth.
      if (roadDist[n] < roadHalf + 8) w *= smoothstep(roadHalf + 0.8, roadHalf + 8, roadDist[n]);
      heights[n] = lerp(h0, rh[n], w);
    }
    for (let n = 0; n < V * V; n++) roadDist[n] = Math.min(roadDist[n], dist[n]);
  }

  // Relax the road band a little: smooths junction kinks without touching open terrain.
  for (let pass = 0; pass < 4; pass++) {
    const src = heights.slice();
    for (let j = 1; j < V - 1; j++) {
      for (let i = 1; i < V - 1; i++) {
        const n = j * V + i;
        if (roadDist[n] > roadHalf + 4) continue;
        const avg = (src[n - 1] + src[n + 1] + src[n - V] + src[n + V] + src[n] * 2) / 6;
        heights[n] = lerp(src[n], avg, 1 - smoothstep(roadHalf, roadHalf + 4, roadDist[n]) * 0.5);
      }
    }
  }

  // ---- 4. Creeks ------------------------------------------------------------
  const creeks: Creek[] = [];
  const waterSurf = new Float32Array(V * V).fill(GAME.seaLevel);
  const creekStarts = 4;
  for (let c = 0; c < creekStarts * 60 && creeks.length < creekStarts; c++) {
    const sx = (rnd() - 0.5) * size * 0.6;
    const sz = (rnd() - 0.5) * size * 0.6;
    const sh = sampleRaw(sx, sz);
    if (sh < 18 || sh > 60) continue;
    let tooClose = false;
    for (const o of creeks) if (Math.hypot(o.pts[0].x - sx, o.pts[0].z - sz) < 200) tooClose = true;
    if (tooClose) continue;
    const pts = traceCreek(sx, sz, sampleRaw, pads, rnd);
    if (pts.length < 30) continue;
    const creek = carveCreek(pts, heights, waterSurf, roadDist, V, origin, cell);
    creeks.push(creek);
  }

  // ---- 5. Materials ---------------------------------------------------------
  const matRoad = new Float32Array(V * V);
  const matMud = new Float32Array(V * V);
  const matRock = new Float32Array(V * V);
  const matSand = new Float32Array(V * V);

  // Mud blobs on roads at local low points (forces teamwork), plus lowland bogs.
  const mudBlobs: { x: number; z: number; r: number }[] = [];
  for (const pts of roads) {
    for (let k = 20; k < pts.length - 20; k += 6) {
      const h = sampleRaw(pts[k].x, pts[k].z);
      const hb = sampleRaw(pts[k - 15].x, pts[k - 15].z);
      const ha = sampleRaw(pts[k + 15].x, pts[k + 15].z);
      if (h < hb - 0.6 && h < ha - 0.6 && rnd() < 0.55) {
        if (!mudBlobs.some((m) => Math.hypot(m.x - pts[k].x, m.z - pts[k].z) < 60)) {
          mudBlobs.push({ x: pts[k].x, z: pts[k].z, r: 7 + rnd() * 5 });
        }
      }
    }
  }

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const n = idx(i, j);
      const x = wx(i);
      const z = wx(j);
      const h = heights[n];
      const d = roadDist[n];
      matRoad[n] = 1 - smoothstep(roadHalf - 0.6, roadHalf + 1.6, d);

      // Slope from neighbouring vertices of the final mesh.
      const hx = heights[idx(Math.min(i + 1, V - 1), j)] - heights[idx(Math.max(i - 1, 0), j)];
      const hz = heights[idx(i, Math.min(j + 1, V - 1))] - heights[idx(i, Math.max(j - 1, 0))];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      const slopeDeg = Math.atan(slope) * 57.3;
      matRock[n] = smoothstep(29, 37, slopeDeg + nz.noise(x / 18, z / 18) * 3) * (1 - matRoad[n]);

      let mud = 0;
      const bog = nz2.fbm(x / 70 + 3, z / 70 + 9, 3);
      if (h > 1.5 && h < 16 && slope < 0.12) mud = smoothstep(0.35, 0.5, bog) * (1 - matRoad[n] * 0.7);
      for (const m of mudBlobs) {
        const dm = Math.hypot(x - m.x, z - m.z) / m.r;
        if (dm < 1.4) mud = Math.max(mud, 1 - smoothstep(0.7, 1.15, dm + nz.noise(x / 5, z / 5) * 0.15));
      }
      matMud[n] = mud * (1 - matRock[n]);
      matSand[n] = smoothstep(2.4, 0.9, h) * (1 - matRoad[n]);
    }
  }
  // Mud sits in a gentle dip so it reads as wet ground. Applied to geometry, so physics sees it too.
  for (let n = 0; n < V * V; n++) heights[n] -= matMud[n] * 0.18;

  // ---- 6. Boulders -----------------------------------------------------------
  const rocks: Rock[] = [];
  const blocked = new SpatialHash(8);
  for (const p of pads) blocked.add(p.x, p.z, 16);

  const sampleFinal = (x: number, z: number) => heightAtArray(heights, V, origin, cell, x, z);
  const sampleGrid = (arr: Float32Array, x: number, z: number) => sampleArray(arr, V, origin, cell, x, z);

  const tryRock = (x: number, z: number, r: number) => {
    if (Math.abs(x) > size / 2 - 20 || Math.abs(z) > size / 2 - 20) return;
    const h = sampleFinal(x, z);
    if (h < 0.8) return;
    if (sampleGrid(roadDist, x, z) < roadHalf + r + 1.5) return;
    if (sampleGrid(waterSurf, x, z) - h > 0.05) return;
    if (blocked.hits(x, z, r)) return;
    const detail = r > 1.6 ? 2 : 1;
    const sy = 0.55 + rnd() * 0.35;
    // Seat the flat underside below the lowest ground point under the rock so no edge floats.
    let hmin = h;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      hmin = Math.min(hmin, sampleFinal(x + Math.cos(ang) * r, z + Math.sin(ang) * r));
    }
    rocks.push({
      x, z, y: hmin + r * sy * 0.55 - r * sy * 0.22, r,
      sx: 0.85 + rnd() * 0.35, sy, sz: 0.85 + rnd() * 0.35,
      rot: rnd() * Math.PI * 2, detail, seed: Math.floor(rnd() * 1e9),
    });
    blocked.add(x, z, r);
  };

  for (let k = 0; k < 9000 && rocks.length < 650; k++) {
    const x = (rnd() - 0.5) * size * 0.92;
    const z = (rnd() - 0.5) * size * 0.92;
    const rockiness = sampleGrid(matRock, x, z);
    const mountain = smoothstep(25, 45, sampleFinal(x, z));
    const p = 0.04 + rockiness * 0.5 + mountain * 0.15;
    if (rnd() > p) continue;
    const r = 0.8 + Math.pow(rnd(), 2) * 3.0;
    tryRock(x, z, r);
    // Small clusters look more natural than lone stones.
    if (rnd() < 0.4) {
      for (let c = 0; c < 2; c++) {
        const a = rnd() * Math.PI * 2;
        tryRock(x + Math.cos(a) * r * 2.2, z + Math.sin(a) * r * 2.2, 0.7 + rnd() * r * 0.6);
      }
    }
  }
  // Roadside boulders: obstacles that frame the road and serve as winch anchors.
  for (const pts of roads) {
    for (let k = 10; k < pts.length - 10; k += 14) {
      if (rnd() > 0.35) continue;
      const a = pts[k];
      const b = pts[k + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const side = rnd() < 0.5 ? -1 : 1;
      const r = 1.0 + rnd() * 1.6;
      const off = roadHalf + r + 2 + rnd() * 3;
      tryRock(a.x + (-dz / l) * off * side, a.z + (dx / l) * off * side, r);
    }
  }

  // ---- 7. Trees -----------------------------------------------------------------
  const trees: Tree[] = [];
  for (let k = 0; k < 40000 && trees.length < 2600; k++) {
    const x = (rnd() - 0.5) * size * 0.95;
    const z = (rnd() - 0.5) * size * 0.95;
    const forest = smoothstep(-0.05, 0.35, nz2.fbm(x / 170 - 7, z / 170 + 2, 3));
    if (rnd() > 0.06 + forest * 0.9) continue;
    const h = sampleFinal(x, z);
    if (h < 2.2) continue;
    if (sampleGrid(matRock, x, z) > 0.5) continue;
    if (sampleGrid(roadDist, x, z) < roadHalf + 2.6) continue;
    if (sampleGrid(waterSurf, x, z) - h > -0.2) continue;
    if (blocked.hits(x, z, 1.2)) continue;
    const scale = 0.75 + rnd() * 0.65;
    const alt = h > 38 ? 1 : 0;
    const roll = rnd();
    const kind = alt ? (roll < 0.7 ? 3 : 4) : roll < 0.32 ? 0 : roll < 0.55 ? 1 : roll < 0.75 ? 2 : roll < 0.9 ? 3 : 4;
    const trunkR = 0.2 * scale;
    trees.push({ x, z, y: h, scale, kind, rot: rnd() * Math.PI * 2, trunkR, trunkH: 2.4 * scale });
    blocked.add(x, z, 0.9);
  }

  return {
    size, cell, verts: V, origin, heights,
    matRoad, matMud, matRock, matSand, waterSurf,
    roads, creeks, rocks, trees,
    spawn: { x: spawn.x, z: spawn.z, y: spawn.y, yaw: Math.atan2(destinations[0].x - spawn.x, destinations[0].z - spawn.z) },
    destinations,
  };
}

// ---------------------------------------------------------------------------------
// Sampling. Triangulation MUST match buildTerrainIndices(): each cell (a=i,j  b=i+1,j
// c=i,j+1  d=i+1,j+1) is split along the b–c diagonal into (a,c,b) and (b,c,d).

export function sampleArray(arr: Float32Array, V: number, origin: number, cell: number, x: number, z: number): number {
  const fx = clamp((x - origin) / cell, 0, V - 1.0001);
  const fz = clamp((z - origin) / cell, 0, V - 1.0001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const a = arr[j * V + i];
  const b = arr[j * V + i + 1];
  const c = arr[(j + 1) * V + i];
  const d = arr[(j + 1) * V + i + 1];
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function heightAtArray(h: Float32Array, V: number, origin: number, cell: number, x: number, z: number): number {
  return sampleArray(h, V, origin, cell, x, z);
}

export function heightAt(t: TerrainData, x: number, z: number): number {
  return sampleArray(t.heights, t.verts, t.origin, t.cell, x, z);
}

export function surfaceAt(t: TerrainData, x: number, z: number) {
  const s = (a: Float32Array) => sampleArray(a, t.verts, t.origin, t.cell, x, z);
  const h = heightAt(t, x, z);
  return {
    road: s(t.matRoad),
    mud: s(t.matMud),
    rock: s(t.matRock),
    sand: s(t.matSand),
    waterDepth: Math.max(0, s(t.waterSurf) - h),
    waterSurface: s(t.waterSurf),
  };
}

export function buildTerrainIndices(V: number, i0: number, j0: number, n: number): Uint32Array {
  // Indices for a chunk of n×n cells whose local vertex grid is (n+1)×(n+1).
  const out = new Uint32Array(n * n * 6);
  let k = 0;
  const W = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      out[k++] = a; out[k++] = c; out[k++] = b;
      out[k++] = b; out[k++] = c; out[k++] = d;
    }
  }
  void V; void i0; void j0;
  return out;
}

/** Deterministic rock hull points (local, unrotated); render & physics both use these. */
export function rockPoints(rock: Rock): Float32Array {
  const rnd = mulberry32(rock.seed);
  const base = icosphere(rock.detail);
  const out = new Float32Array(base.length);
  const c = Math.cos(rock.rot);
  const s = Math.sin(rock.rot);
  for (let k = 0; k < base.length; k += 3) {
    const jitter = 1 + (rnd() - 0.5) * 0.22;
    const x = base[k] * rock.r * rock.sx * jitter;
    const y = base[k + 1] * rock.r * rock.sy * jitter;
    const z = base[k + 2] * rock.r * rock.sz * jitter;
    out[k] = x * c - z * s;
    out[k + 1] = y;
    out[k + 2] = x * s + z * c;
  }
  return out;
}

function icosphere(detail: number): number[] {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a];
      const vb = verts[b];
      const m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
      const l = Math.hypot(m[0], m[1], m[2]);
      verts.push([m[0] / l, m[1] / l, m[2] / l]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  // Flatten the underside so rocks sit on the ground instead of balancing on a point.
  verts = verts.map((v) => [v[0], Math.max(v[1], -0.55), v[2]]);
  return verts.flat();
}

// ---------------------------------------------------------------------------------

function boxBlur(h: Float32Array, V: number, r: number) {
  const tmp = new Float32Array(h.length);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      let s = 0;
      let n = 0;
      for (let o = -r; o <= r; o++) {
        const q = i + o;
        if (q >= 0 && q < V) { s += h[j * V + q]; n++; }
      }
      tmp[j * V + i] = s / n;
    }
  }
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      let s = 0;
      let n = 0;
      for (let o = -r; o <= r; o++) {
        const q = j + o;
        if (q >= 0 && q < V) { s += tmp[q * V + i]; n++; }
      }
      h[j * V + i] = s / n;
    }
  }
}

function flattenDisc(h: Float32Array, V: number, origin: number, cell: number, cx: number, cz: number, target: number, r: number, blend: number) {
  const R = r + blend;
  const i0 = Math.max(0, Math.floor((cx - R - origin) / cell));
  const i1 = Math.min(V - 1, Math.ceil((cx + R - origin) / cell));
  const j0 = Math.max(0, Math.floor((cz - R - origin) / cell));
  const j1 = Math.min(V - 1, Math.ceil((cz + R - origin) / cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(origin + i * cell - cx, origin + j * cell - cz);
      const w = 1 - smoothstep(r, R, d);
      const n = j * V + i;
      h[n] = lerp(h[n], target, w);
    }
  }
}

function findRoute(a: Vec2, b: Vec2, sample: (x: number, z: number) => number, size: number, roadDist: Float32Array, V: number, origin: number, cell: number): Vec2[] {
  const step = 8;
  const G = Math.floor(size / step);
  const org = -size / 2;
  const toG = (v: number) => clamp(Math.round((v - org) / step), 0, G - 1);
  const hgrid = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) hgrid[j * G + i] = sample(org + i * step, org + j * step);

  const start = toG(a.z) * G + toG(a.x);
  const goal = toG(b.z) * G + toG(b.x);
  const gx = goal % G;
  const gz = Math.floor(goal / G);
  const dirs: [number, number][] = [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1], [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]];
  const ang = dirs.map(([x, z]) => Math.atan2(z, x));
  const D = dirs.length;
  // State = cell × heading, so sharp turns (switchback hairpins) can be penalised.
  const cost = new Float32Array(G * G * D).fill(Infinity);
  const from = new Int32Array(G * G * D).fill(-1);
  const heap = new MinHeap();
  for (let d = 0; d < D; d++) { cost[start * D + d] = 0; heap.push(start * D + d, 0); }
  let endState = -1;
  while (heap.size) {
    const st = heap.pop();
    const cur = Math.floor(st / D);
    const cd = st % D;
    if (cur === goal) { endState = st; break; }
    const ci = cur % G;
    const cj = Math.floor(cur / G);
    for (let nd = 0; nd < D; nd++) {
      let turn = Math.abs(ang[nd] - ang[cd]);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (cur !== start && turn > Math.PI / 2 + 0.01) continue;
      const [di, dj] = dirs[nd];
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 1 || nj < 1 || ni >= G - 1 || nj >= G - 1) continue;
      const nn = nj * G + ni;
      const len = Math.hypot(di, dj) * step;
      const h0 = hgrid[cur];
      const h1 = hgrid[nn];
      if (h1 < 1.5) continue;
      const grade = Math.abs(h1 - h0) / len;
      let c = len * (1 + 60 * grade * grade);
      if (grade > 0.3) c *= 6;
      if (cur !== start) c += len * turn * 1.5;
      // Reuse existing roads instead of running a parallel one beside them.
      const vi = Math.round((org + ni * step - origin) / cell);
      const vj = Math.round((org + nj * step - origin) / cell);
      if (roadDist[vj * V + vi] < 10) c *= 0.3;
      const ns = nn * D + nd;
      const nc = cost[st] + c;
      if (nc < cost[ns]) {
        cost[ns] = nc;
        from[ns] = st;
        heap.push(ns, nc + Math.hypot(ni - gx, nj - gz) * step);
      }
    }
  }
  const out: Vec2[] = [{ x: b.x, z: b.z }];
  let c = endState >= 0 ? from[endState] : -1;
  while (c >= 0 && Math.floor(c / D) !== start) {
    const cc = Math.floor(c / D);
    out.push({ x: org + (cc % G) * step, z: org + Math.floor(cc / G) * step });
    c = from[c];
  }
  out.push({ x: a.x, z: a.z });
  out.reverse();
  // Grid nodes right next to the endpoints make hairpins; let the pads connect directly.
  return out.filter((p, i) => i === 0 || i === out.length - 1 ||
    (Math.hypot(p.x - a.x, p.z - a.z) > 14 && Math.hypot(p.x - b.x, p.z - b.z) > 14));
}

function chaikin(p: Vec2[]): Vec2[] {
  if (p.length < 3) return p;
  const out: Vec2[] = [p[0]];
  for (let k = 0; k < p.length - 1; k++) {
    const a = p[k];
    const b = p[k + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  out.push(p[p.length - 1]);
  return out;
}

function resample(p: Vec2[], spacing: number): Vec2[] {
  const out: Vec2[] = [p[0]];
  let carry = 0;
  for (let k = 0; k < p.length - 1; k++) {
    const a = p[k];
    const b = p[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = spacing - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  out.push(p[p.length - 1]);
  return out;
}

const MAX_ROAD_GRADE = 0.18;

function roadProfile(pts: Vec2[], sample: (x: number, z: number) => number, h0: number, h1: number): number[] {
  let prof = pts.map((p) => sample(p.x, p.z));
  for (let pass = 0; pass < 3; pass++) {
    const w = 8;
    const next = prof.slice();
    for (let k = 0; k < prof.length; k++) {
      let s = 0;
      let n = 0;
      for (let o = -w; o <= w; o++) {
        const q = k + o;
        if (q >= 0 && q < prof.length) { s += prof[q]; n++; }
      }
      next[k] = s / n;
    }
    prof = next;
  }
  prof[0] = h0;
  prof[prof.length - 1] = h1;
  const ds = 2;
  for (let k = 1; k < prof.length; k++) prof[k] = clamp(prof[k], prof[k - 1] - MAX_ROAD_GRADE * ds, prof[k - 1] + MAX_ROAD_GRADE * ds);
  for (let k = prof.length - 2; k >= 0; k--) prof[k] = clamp(prof[k], prof[k + 1] - MAX_ROAD_GRADE * ds, prof[k + 1] + MAX_ROAD_GRADE * ds);
  return prof;
}

function rasterizeRoad(pts: Vec2[], prof: number[], dist: Float32Array, rh: Float32Array, V: number, origin: number, cell: number) {
  const R = 32;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const i0 = Math.max(0, Math.floor((p.x - R - origin) / cell));
    const i1 = Math.min(V - 1, Math.ceil((p.x + R - origin) / cell));
    const j0 = Math.max(0, Math.floor((p.z - R - origin) / cell));
    const j1 = Math.min(V - 1, Math.ceil((p.z + R - origin) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(origin + i * cell - p.x, origin + j * cell - p.z);
        const n = j * V + i;
        if (d < dist[n]) { dist[n] = d; rh[n] = prof[k]; }
      }
    }
  }
}

function traceCreek(x: number, z: number, sample: (x: number, z: number) => number, pads: Vec2[], rnd: () => number): Vec2[] {
  const pts: Vec2[] = [{ x, z }];
  let minH = sample(x, z);
  let dx = 0;
  let dz = 0;
  for (let k = 0; k < 500; k++) {
    const e = 6;
    const gx = (sample(x + e, z) - sample(x - e, z)) / (2 * e);
    const gz = (sample(x, z + e) - sample(x, z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz) || 1;
    dx = dx * 0.75 - (gx / gl) * 0.25 + (rnd() - 0.5) * 0.12;
    dz = dz * 0.75 - (gz / gl) * 0.25 + (rnd() - 0.5) * 0.12;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    x += dx * 4;
    z += dz * 4;
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 30)) break;
    // Only follow real downhill; climbing out of a basin would carve a canyon.
    const h = sample(x, z);
    if (h > minH + 0.6) break;
    minH = Math.min(minH, h);
    pts.push({ x, z });
    if (h < -0.5) break;
  }
  return resample(pts, 2);
}

function carveCreek(pts: Vec2[], h: Float32Array, waterSurf: Float32Array, roadDist: Float32Array, V: number, origin: number, cell: number): Creek {
  const sample = (x: number, z: number) => heightAtArray(h, V, origin, cell, x, z);
  let prof = pts.map((p) => sample(p.x, p.z));
  for (let pass = 0; pass < 2; pass++) {
    const next = prof.slice();
    for (let k = 0; k < prof.length; k++) {
      let s = 0;
      let n = 0;
      for (let o = -5; o <= 5; o++) {
        const q = k + o;
        if (q >= 0 && q < prof.length) { s += prof[q]; n++; }
      }
      next[k] = s / n;
    }
    prof = next;
  }
  for (let k = 1; k < prof.length; k++) prof[k] = Math.min(prof[k], prof[k - 1] - 0.01);
  const depth = 1.05;
  const waterD = 0.5;
  const bed = prof.map((p) => p - depth);
  const surf = bed.map((b) => b + waterD);
  const halfBed = 2.6;

  const best = new Float32Array(V * V).fill(1e9);
  const bestK = new Int32Array(V * V).fill(-1);
  const R = 26;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const i0 = Math.max(0, Math.floor((p.x - R - origin) / cell));
    const i1 = Math.min(V - 1, Math.ceil((p.x + R - origin) / cell));
    const j0 = Math.max(0, Math.floor((p.z - R - origin) / cell));
    const j1 = Math.min(V - 1, Math.ceil((p.z + R - origin) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(origin + i * cell - p.x, origin + j * cell - p.z);
        const n = j * V + i;
        if (d < best[n]) { best[n] = d; bestK[n] = k; }
      }
    }
  }
  for (let n = 0; n < V * V; n++) {
    const k = bestK[n];
    if (k < 0) continue;
    const d = best[n];
    const b = bed[k];
    const above = h[n] - b;
    if (above <= 0) continue;
    const bank = clamp(above * 4.5, 5.5, 16);
    const w = smoothstep(halfBed, halfBed + bank, d);
    let carved = lerp(b, h[n], w);
    // Where a road crosses, keep it a shallow ford instead of a ditch.
    const nearRoad = 1 - smoothstep(6, 20, roadDist[n]);
    if (nearRoad > 0) carved = Math.max(carved, h[n] - lerp(1.05, 0.7, nearRoad) * (1 - w));
    if (carved < h[n]) h[n] = carved;
    if (d < halfBed + bank) waterSurf[n] = Math.max(waterSurf[n], surf[k]);
  }
  return { pts, surf, halfWidth: halfBed + 1.6 };
}

class MinHeap {
  private ids: number[] = [];
  private ks: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, k: number) {
    this.ids.push(id);
    this.ks.push(k);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.ks[p] <= this.ks[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastK = this.ks.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.ks[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.ks[l] < this.ks[m]) m = l;
        if (r < this.ids.length && this.ks[r] < this.ks[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.ks[a], this.ks[b]] = [this.ks[b], this.ks[a]];
  }
}

class SpatialHash {
  private map = new Map<string, { x: number; z: number; r: number }[]>();
  constructor(private cellSize: number) {}
  add(x: number, z: number, r: number) {
    const k = `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push({ x, z, r });
  }
  hits(x: number, z: number, r: number): boolean {
    const ci = Math.floor(x / this.cellSize);
    const cj = Math.floor(z / this.cellSize);
    const span = 3;
    for (let dj = -span; dj <= span; dj++) {
      for (let di = -span; di <= span; di++) {
        const arr = this.map.get(`${ci + di},${cj + dj}`);
        if (!arr) continue;
        for (const o of arr) if (Math.hypot(o.x - x, o.z - z) < o.r + r + 0.6) return true;
      }
    }
    return false;
  }
}
