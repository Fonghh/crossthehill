// Chunk vertex/index buffers shared by the render mesh and the physics trimesh.
// Both consume exactly these arrays, which is what keeps "what you see" == "what you hit".

import { GAME } from '../config/game';
import { buildTerrainIndices, type TerrainData } from './terrainGen';

export interface ChunkData {
  ci: number;
  cj: number;
  positions: Float32Array; // world-space xyz
  indices: Uint32Array;
  i0: number; // first grid vertex index along x
  j0: number;
  n: number; // cells per side
}

export function chunkCount(t: TerrainData): number {
  return (t.verts - 1) / GAME.chunkCells;
}

export function buildChunk(t: TerrainData, ci: number, cj: number): ChunkData {
  const n = GAME.chunkCells;
  const i0 = ci * n;
  const j0 = cj * n;
  const W = n + 1;
  const positions = new Float32Array(W * W * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const gi = i0 + i;
      const gj = j0 + j;
      positions[k++] = t.origin + gi * t.cell;
      positions[k++] = t.heights[gj * t.verts + gi];
      positions[k++] = t.origin + gj * t.cell;
    }
  }
  return { ci, cj, positions, indices: buildTerrainIndices(t.verts, i0, j0, n), i0, j0, n };
}
