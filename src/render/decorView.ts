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
    const trees = this.t.trees;
    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1, 1);
    const coneGeo = mergeGeometries([
      new THREE.ConeGeometry(1, 1.4, 7).translate(0, 0.7, 0),
      new THREE.ConeGeometry(0.78, 1.2, 7).translate(0, 1.35, 0),
      new THREE.ConeGeometry(0.52, 0.95, 7).translate(0, 1.95, 0),
    ])!;
    const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ flatShading: true, ...o });
    const trunks = new THREE.InstancedMesh(trunkGeo, lam({}), trees.length);
    const rounds = new THREE.InstancedMesh(roundGeo, lam({}), trees.length);
    const cones = new THREE.InstancedMesh(coneGeo, lam({}), trees.length);
    let nr = 0;
    let nc = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const rnd = mulberry32(99);
    trees.forEach((tr, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.rot);
      const trunkTop = tr.trunkH;
      p.set(tr.x, tr.y - 0.4, tr.z);
      s.set(tr.trunkR, trunkTop + 0.4, tr.trunkR);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      trunks.setColorAt(i, col.set(tr.kind === 4 ? '#ece6d8' : '#6b4a35'));
      const palette = CANOPY_COLORS[tr.kind];
      col.set(palette[Math.floor(rnd() * palette.length)]);
      if (tr.kind === 3) {
        p.set(tr.x, tr.y + trunkTop * 0.45, tr.z);
        const w = 1.5 * tr.scale;
        s.set(w, 2.4 * tr.scale, w);
        m.compose(p, q, s);
        cones.setMatrixAt(nc, m);
        cones.setColorAt(nc++, col);
      } else {
        const r = (tr.kind === 4 ? 1.2 : 1.7) * tr.scale;
        p.set(tr.x, tr.y + trunkTop + r * 0.55, tr.z);
        s.set(r, r * (0.85 + rnd() * 0.3), r);
        m.compose(p, q, s);
        rounds.setMatrixAt(nr, m);
        rounds.setColorAt(nr++, col);
      }
    });
    rounds.count = nr;
    cones.count = nc;
    for (const im of [trunks, rounds, cones]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  private buildWater() {
    const mat = new THREE.MeshLambertMaterial({ color: '#5fb3d6', transparent: true, opacity: 0.72, depthWrite: false });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#4e9cc4' }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    this.group.add(sea);
    for (const c of this.t.creeks) {
      const pos: number[] = [];
      const idx: number[] = [];
      for (let k = 0; k < c.pts.length; k++) {
        const a = c.pts[Math.max(0, k - 1)];
        const b = c.pts[Math.min(c.pts.length - 1, k + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l;
        const nz = dx / l;
        const w = c.halfWidth + 2.5;
        const y = c.surf[k];
        pos.push(c.pts[k].x + nx * w, y, c.pts[k].z + nz * w, c.pts[k].x - nx * w, y, c.pts[k].z - nz * w);
        if (k > 0) {
          const o = (k - 1) * 2;
          idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
        }
      }
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
