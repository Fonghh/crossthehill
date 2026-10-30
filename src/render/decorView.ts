// Trees, rocks, water, grass tufts. Rocks render the exact convex hull the physics uses.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../world/noise';
import { heightAt, rockPoints, surfaceAt, type TerrainData } from '../world/terrainGen';

const CANOPY_COLORS = [
  ['#e8873a', '#f0a04b', '#d9702c'], // orange
  ['#c9473a', '#d85a45', '#b23a32'], // red
  ['#e9c44d', '#f2d466', '#dab23c'], // yellow
  ['#4f7f4f', '#5d8f58', '#46704a'], // conifer
  ['#f0cf5a', '#e6bd48', '#f5dc7a'], // birch
];

export class DecorView {
  group = new THREE.Group();
  private grass: THREE.InstancedMesh[] = [];

  constructor(private t: TerrainData) {
    this.buildRocks();
    this.buildTrees();
    this.buildWater();
  }

  private buildRocks() {
    // Merge per 128 m region so frustum culling still works.
    const regions = new Map<string, THREE.BufferGeometry[]>();
    const tint = new THREE.Color();
    this.t.rocks.forEach((r, i) => {
      const pts = rockPoints(r);
      const vs: THREE.Vector3[] = [];
      for (let k = 0; k < pts.length; k += 3) vs.push(new THREE.Vector3(pts[k] + r.x, pts[k + 1] + r.y, pts[k + 2] + r.z));
      const g: THREE.BufferGeometry = new ConvexGeometry(vs); // non-indexed, flat face normals
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const rnd = mulberry32(r.seed);
      const base = new THREE.Color().setHSL(0.63 + rnd() * 0.04, 0.08 + rnd() * 0.06, 0.52 + rnd() * 0.1);
      for (let k = 0; k < n; k += 3) {
        // Per-face shade + moss on upward faces.
        const ny = g.attributes.normal.getY(k);
        tint.copy(base).multiplyScalar(0.92 + rnd() * 0.16);
        if (ny > 0.75) tint.lerp(new THREE.Color('#8f9b5a'), 0.35);
        for (let v = 0; v < 3; v++) { col[(k + v) * 3] = tint.r; col[(k + v) * 3 + 1] = tint.g; col[(k + v) * 3 + 2] = tint.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (g.attributes.uv) g.deleteAttribute('uv');
      const key = `${Math.floor(r.x / 128)},${Math.floor(r.z / 128)}`;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key)!.push(g);
      void i;
    });
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const geos of regions.values()) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildTrees() {
    // Instanced per 256 m region so off-screen forests are culled.
    const regions = new Map<string, number[]>();
    this.t.trees.forEach((tr, i) => {
      const key = `${Math.floor(tr.x / 256)},${Math.floor(tr.z / 256)}`;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key)!.push(i);
    });
    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1, 1);
    const coneGeo = mergeGeometries([
      new THREE.ConeGeometry(1, 1.4, 7).translate(0, 0.7, 0),
      new THREE.ConeGeometry(0.78, 1.2, 7).translate(0, 1.35, 0),
      new THREE.ConeGeometry(0.52, 0.95, 7).translate(0, 1.95, 0),
    ])!;
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const rnd = mulberry32(99);
    for (const list of regions.values()) {
      const trunks = new THREE.InstancedMesh(trunkGeo, mat, list.length);
      const rounds = new THREE.InstancedMesh(roundGeo, mat, list.length);
      const cones = new THREE.InstancedMesh(coneGeo, mat, list.length);
      let nr = 0;
      let nc = 0;
      list.forEach((ti, k) => {
        const tr = this.t.trees[ti];
        q.setFromAxisAngle(up, tr.rot);
        p.set(tr.x, tr.y - 0.4, tr.z);
        s.set(tr.trunkR, tr.trunkH + 0.4, tr.trunkR);
        trunks.setMatrixAt(k, m.compose(p, q, s));
        trunks.setColorAt(k, col.set(tr.kind === 4 ? '#ece6d8' : '#6b4a35'));
        const palette = CANOPY_COLORS[tr.kind];
        col.set(palette[Math.floor(rnd() * palette.length)]);
        if (tr.kind === 3) {
          p.set(tr.x, tr.y + tr.trunkH * 0.45, tr.z);
          const w = 1.5 * tr.scale;
          s.set(w, 2.4 * tr.scale, w);
          cones.setMatrixAt(nc, m.compose(p, q, s));
          cones.setColorAt(nc++, col);
        } else {
          const r = (tr.kind === 4 ? 1.2 : 1.7) * tr.scale;
          p.set(tr.x, tr.y + tr.trunkH + r * 0.55, tr.z);
          s.set(r, r * (0.85 + rnd() * 0.3), r);
          rounds.setMatrixAt(nr, m.compose(p, q, s));
          rounds.setColorAt(nr++, col);
        }
      });
      rounds.count = nr;
      cones.count = nc;
      for (const im of [trunks, rounds, cones]) {
        if (!im.count) continue;
        im.castShadow = true;
        im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }
  }

  private buildWater() {
    const mat = new THREE.MeshLambertMaterial({ color: '#5fb3d6', transparent: true, opacity: 0.72, depthWrite: false });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#4e9cc4' }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    this.group.add(sea);
    // Creek water is built from the terrain grid itself: a cell gets water only where the
    // generator recorded a creek surface at all four corners — the same data physics uses.
    const t = this.t;
    const V = t.verts;
    const pos: number[] = [];
    const idx: number[] = [];
    const vid = new Int32Array(V * V).fill(-1);
    const vert = (i: number, j: number) => {
      const n = j * V + i;
      if (vid[n] < 0) {
        vid[n] = pos.length / 3;
        pos.push(t.origin + i * t.cell, t.creekSurf[n], t.origin + j * t.cell);
      }
      return vid[n];
    };
    for (let j = 0; j < V - 1; j++) {
      for (let i = 0; i < V - 1; i++) {
        const a = j * V + i;
        const cs = t.creekSurf;
        if (!(Number.isFinite(cs[a]) && Number.isFinite(cs[a + 1]) && Number.isFinite(cs[a + V]) && Number.isFinite(cs[a + V + 1]))) continue;
        // Skip cells that are dry everywhere (water fully under the levee).
        const hs = t.heights;
        if (hs[a] >= cs[a] && hs[a + 1] >= cs[a + 1] && hs[a + V] >= cs[a + V] && hs[a + V + 1] >= cs[a + V + 1]) continue;
        const va = vert(i, j), vb = vert(i + 1, j), vc = vert(i, j + 1), vd = vert(i + 1, j + 1);
        idx.push(va, vc, vb, vb, vc, vd);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      this.group.add(m);
    }
  }

  /** Decorative grass tufts (no collision). Split per 128 m region so culling works. */
  setGrassDensity(perCell: number) {
    for (const g of this.grass) {
      this.group.remove(g);
      g.dispose();
    }
    this.grass = [];
    if (perCell <= 0) return;
    const t = this.t;
    const max = Math.floor(60000 * perCell);
    const geo = new THREE.ConeGeometry(0.12, 0.45, 4);
    geo.translate(0, 0.2, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const rnd = mulberry32(7);
    const regions = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let k = 0; k < max * 3 && n < max; k++) {
      const x = (rnd() - 0.5) * t.size * 0.9;
      const z = (rnd() - 0.5) * t.size * 0.9;
      const sf = surfaceAt(t, x, z);
      if (sf.road > 0.3 || sf.mud > 0.4 || sf.rock > 0.5 || sf.sand > 0.5 || sf.waterDepth > 0) continue;
      const y = heightAt(t, x, z);
      if (y < 1) continue;
      q.setFromAxisAngle(up, rnd() * 6.28);
      const sc = 0.6 + rnd() * 0.8;
      s.set(sc, sc * (0.7 + rnd() * 0.8), sc);
      p.set(x, y - 0.05, z);
      const key = `${Math.floor(x / 128)},${Math.floor(z / 128)}`;
      if (!regions.has(key)) regions.set(key, []);
      const r = rnd();
      regions.get(key)!.push({ m: new THREE.Matrix4().compose(p, q, s), c: new THREE.Color(r < 0.5 ? '#a9b35c' : r < 0.75 ? '#d8b04e' : '#c97c3a') });
      n++;
    }
    for (const list of regions.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((e, i) => { im.setMatrixAt(i, e.m); im.setColorAt(i, e.c); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      this.grass.push(im);
      this.group.add(im);
    }
  }
}
