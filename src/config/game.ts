// Game-wide constants. Vehicle feel lives in vehicles.ts.

export const GAME = {
  title: 'Cross the Hill',
  maxPlayers: 8,
  worldSeed: 20261030,

  // Terrain grid. Render mesh and physics trimesh are built from the same vertices.
  mapSize: 1024, // meters, square
  cellSize: 2, // meters between vertices
  chunkCells: 32, // cells per render/physics chunk side
  seaLevel: 0,

  // Networking
  snapshotHz: 20,
  inputHz: 30,
  interpDelayMs: 110,
  migrationRetrySeconds: 25, // how long a client keeps trying each host candidate after the host drops
  roomCodeLength: 4,
  peerIdPrefix: 'cth-room-',

  // Gameplay
  physicsHz: 60,
  destinationRadius: 13,
  destinationCount: 8,
  resetCooldownSec: 5,
  drownSeconds: 3,
  awayKeepSeconds: 45, // a disconnected player's car waits this long for them to come back
  markerSeconds: 10,
  ropeMaxLength: 30,
  ropeMinLength: 2,
  cargoMass: 160,
};

export const CAR_COLORS = [
  '#e8473f', // tomato
  '#f2b134', // mustard
  '#3fa7d6', // sky
  '#5dbb63', // leaf
  '#f4f1e6', // cream
  '#9b6bd6', // lilac
  '#ff8fab', // peach pink
  '#4b5563', // slate
];
