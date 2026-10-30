import * as THREE from 'three';
import { Simplex2 } from '../world/noise';
import { buildChunk, chunkCount } from '../world/terrainChunks';
import type { TerrainData } from '../world/terrainGen';

// Autumn palette (sRGB hex; THREE.Color converts to linear for vertex colours).
export const PALETTE = {
  grassA: '#9aa85a',
  grassB: '#c9a64a',
  grassC: '#b97a3a',
  road: '#dcc095',
  roadEdge: '#c8a675',
  mud: '#6a4a33',
  rock: '#8e8f9e',
  rockDark: '#6f7183',
  sand: '#e8d6a6',
  bed: '#7d7a5c',
};

const C = (hex: string) => new THREE.Color(hex);

export function terrainColors(t: TerrainData): Float32Array {
  const V = t.verts;
  const out = new Float32Array(V * V * 3);
  const nz = new Simplex2(4242);
  const gA = C(PALETTE.grassA), gB = C(PALETTE.grassB), gC = C(PALETTE.grassC);
  const road = C(PALETTE.road), mud = C(PALETTE.mud), rock = C(PALETTE.rock), rockD = C(PALETTE.rockDark);
  const sand = C(PALETTE.sand), bed = C(PALETTE.bed);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const n = j * V + i;
      const x = t.origin + i * t.cell;
      const z = t.origin + j * t.cell;
      const f = nz.fbm(x / 90, z / 90, 3) * 0.5 + 0.5;
      const f2 = nz.noise(x / 23 + 9, z / 23) * 0.5 + 0.5;
      c.copy(gA).lerp(gB, f).lerp(gC, Math.max(0, f2 - 0.55) * 1.4);
      tmp.copy(rock).lerp(rockD, nz.noise(x / 8, z / 8) * 0.5 + 0.5);
      c.lerp(tmp, t.matRock[n]);
      c.lerp(sand, t.matSand[n]);
      const wet = Math.max(0, t.waterSurf[n] - t.heights[n]);
      if (wet > 0 && t.heights[n] > -1) c.lerp(bed, Math.min(1, wet * 3));
      c.lerp(road, t.matRoad[n]);
      c.lerp(mud, t.matMud[n]);
      const shade = 0.94 + f2 * 0.12;
      out[n * 3] = c.r * shade;
      out[n * 3 + 1] = c.g * shade;
      out[n * 3 + 2] = c.b * shade;
    }
  }
  return out;
}

/** Smooth normals from the whole grid so chunk seams shade identically. */
function gridNormals(t: TerrainData): Float32Array {
  const V = t.verts;
  const h = t.heights;
  const out = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const hl = h[j * V + Math.max(0, i - 1)];
      const hr = h[j * V + Math.min(V - 1, i + 1)];
      const hd = h[Math.max(0, j - 1) * V + i];
      const hu = h[Math.min(V - 1, j + 1) * V + i];
      const nx = hl - hr;
      const nz = hd - hu;
      const ny = 2 * t.cell;
      const l = Math.hypot(nx, ny, nz);
      const n = (j * V + i) * 3;
      out[n] = nx / l;
      out[n + 1] = ny / l;
      out[n + 2] = nz / l;
    }
  }
  return out;
}

export class TerrainView {
  group = new THREE.Group();
  colors: Float32Array;

  constructor(t: TerrainData) {
    const normals = gridNormals(t);
    this.colors = terrainColors(t);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const n = chunkCount(t);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const c = buildChunk(t, ci, cj);
        const W = c.n + 1;
        const nrm = new Float32Array(W * W * 3);
        const col = new Float32Array(W * W * 3);
        for (let j = 0; j <= c.n; j++) {
          for (let i = 0; i <= c.n; i++) {
            const src = ((c.j0 + j) * t.verts + (c.i0 + i)) * 3;
            const dst = (j * W + i) * 3;
            nrm[dst] = normals[src]; nrm[dst + 1] = normals[src + 1]; nrm[dst + 2] = normals[src + 2];
            col[dst] = this.colors[src]; col[dst + 1] = this.colors[src + 1]; col[dst + 2] = this.colors[src + 2];
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(new THREE.BufferAttribute(c.indices, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
  }
}
