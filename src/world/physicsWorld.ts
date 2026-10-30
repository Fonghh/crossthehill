import RAPIER from '@dimforge/rapier3d-compat';
import { GAME } from '../config/game';
import { rockPoints, type TerrainData } from './terrainGen';
import { buildChunk, chunkCount } from './terrainChunks';

export type ColliderTag =
  | { kind: 'terrain'; cx: number; cz: number }
  | { kind: 'rock'; index: number }
  | { kind: 'tree'; index: number }
  | { kind: 'car'; carId: string };

export class PhysicsWorld {
  world: RAPIER.World;
  tags = new Map<number, ColliderTag>();
  staticBody: RAPIER.RigidBody;

  constructor(public terrain: TerrainData) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / GAME.physicsHz;
    this.world.numSolverIterations = 6;
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.buildStatic();
    this.world.step(); // builds the scene-query structures so ray casts work before the first frame
  }

  static async init() {
    await (RAPIER.init as unknown as (o: object) => Promise<void>)({}); // object form avoids a deprecation warning
  }

  private buildStatic() {
    const t = this.terrain;
    const n = chunkCount(t);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const c = buildChunk(t, ci, cj);
        const desc = RAPIER.ColliderDesc.trimesh(c.positions, c.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(0.8)
          .setRestitution(0);
        const col = this.world.createCollider(desc, this.staticBody);
        const half = (GAME.chunkCells * t.cell) / 2;
        this.tags.set(col.handle, { kind: 'terrain', cx: t.origin + ci * half * 2 + half, cz: t.origin + cj * half * 2 + half });
      }
    }
    t.rocks.forEach((r, index) => {
      const desc = RAPIER.ColliderDesc.convexHull(rockPoints(r));
      if (!desc) return;
      desc.setTranslation(r.x, r.y, r.z).setFriction(0.9).setRestitution(0.05);
      const col = this.world.createCollider(desc, this.staticBody);
      this.tags.set(col.handle, { kind: 'rock', index });
    });
    t.trees.forEach((tr, index) => {
      // Only the trunk collides; the canopy is visual. Trunk is sunk 0.4 m into the ground.
      const hh = (tr.trunkH + 0.4) / 2;
      const desc = RAPIER.ColliderDesc.cylinder(hh, tr.trunkR + 0.03)
        .setTranslation(tr.x, tr.y - 0.4 + hh, tr.z)
        .setFriction(0.6);
      const col = this.world.createCollider(desc, this.staticBody);
      this.tags.set(col.handle, { kind: 'tree', index });
    });
  }

  tagOf(col: RAPIER.Collider | null | undefined): ColliderTag | undefined {
    return col ? this.tags.get(col.handle) : undefined;
  }

  step() {
    this.world.step();
  }
}

export { RAPIER };
