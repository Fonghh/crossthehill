// All driving feel lives here. Tweak live with ?debug (lil-gui), then copy the exported
// JSON back into this file.

export type VehicleId = 'jeep' | 'bigfoot';

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  blurb: string;
  traits: { label: string; value: number }[]; // 1..5, shown on the car select screen

  // Body
  mass: number; // kg, without cargo
  halfExtents: [number, number, number]; // chassis collider half size (x, y, z)
  cabin: [number, number, number, number, number]; // cabin+cargo collider: half x, half y, half z, centre y, centre z
  comOffset: [number, number, number]; // centre of mass relative to chassis centre; lower y = harder to roll
  inertiaScale: number; // >1 resists rotation (pitch/roll/yaw) more

  // Wheels: mounts are relative to chassis centre; x is half track width
  wheelRadius: number;
  wheelWidth: number;
  trackHalf: number;
  frontZ: number;
  rearZ: number;
  mountY: number; // suspension top attachment height

  // Suspension
  suspensionTravel: number; // how far the wheel centre can drop below the mount
  springK: number; // N/m per wheel
  damperBump: number; // N·s/m compressing
  damperRebound: number; // N·s/m extending
  bumpStopK: number; // extra spring in the last 15% of travel
  antiRoll: number; // N/m difference between left/right compression (0 = off)

  // Tyres
  grip: number; // friction coefficient multiplier on top of surface grip
  lateralStiffness: number; // 0..1 share of side slip removed per step
  forceLift: number; // m, applies tyre forces above contact patch (reduces roll torque)
  rollingResistance: number;

  // Engine / gearbox (gear ratios so manual / low-range can be added later)
  torqueNm: number;
  idleRpm: number;
  redlineRpm: number;
  gears: number[];
  reverseGear: number;
  finalDrive: number;
  lowRange: number; // multiplier for future 4L mode
  upshiftRpm: number;
  downshiftRpm: number;
  maxSpeedKmh: number;
  maxReverseKmh: number;
  brakeForce: number; // N total
  hillHold: number; // 0..1 auto brake when no input at low speed
  holdSpeed: number; // m/s below which hill-hold engages (off both pedals)
  engineBrake: number; // N total deceleration force when coasting (off both pedals)
  throttleRise: number; // pedal travel per second while held (1 = full power after 1 s)
  brakeRise: number; // brake pedal travel per second while held

  // Steering
  maxSteer: number; // rad at standstill
  highSpeedSteer: number; // rad at 60 km/h
  steerSpeed: number; // rad/s

  // Winch
  winchForce: number; // N max pull while reeling
  winchSpeed: number; // m/s reel-in rate
}

export const SURFACES = {
  grass: { grip: 0.85, resistance: 0.015 },
  road: { grip: 1.0, resistance: 0.01 },
  rock: { grip: 1.05, resistance: 0.01 },
  sand: { grip: 0.7, resistance: 0.05 },
  mud: { grip: 0.42, resistance: 0.09 },
  water: { grip: 0.6, drag: 900 }, // drag N per (m/s) per m of depth
  car: { grip: 0.9 },
};

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  jeep: {
    id: 'jeep',
    name: '小吉普',
    blurb: '平衡好開、重心低、不容易翻。新手首選。',
    traits: [
      { label: '馬力', value: 3 },
      { label: '速度', value: 4 },
      { label: '穩定', value: 4 },
      { label: '越障', value: 3 },
      { label: '絞盤', value: 3 },
    ],
    mass: 1350,
    halfExtents: [0.88, 0.42, 1.85],
    cabin: [0.78, 0.58, 0.8, 0.99, -0.22],
    comOffset: [0, -0.32, 0.05],
    inertiaScale: 1.25,
    wheelRadius: 0.44,
    wheelWidth: 0.34,
    trackHalf: 0.92,
    frontZ: 1.28,
    rearZ: -1.22,
    mountY: -0.1,
    suspensionTravel: 0.55,
    springK: 36000,
    damperBump: 2600,
    damperRebound: 3600,
    bumpStopK: 140000,
    antiRoll: 0,
    grip: 1.0,
    lateralStiffness: 0.85,
    forceLift: 0.15,
    rollingResistance: 1,
    torqueNm: 420,
    idleRpm: 900,
    redlineRpm: 5600,
    gears: [3.8, 2.3, 1.55, 1.1, 0.85],
    reverseGear: 3.6,
    finalDrive: 4.1,
    lowRange: 2.6,
    upshiftRpm: 4700,
    downshiftRpm: 2200,
    maxSpeedKmh: 85,
    maxReverseKmh: 22,
    brakeForce: 16000,
    hillHold: 1,
    holdSpeed: 0.5,
    engineBrake: 2400,
    throttleRise: 1.4,
    brakeRise: 3,
    maxSteer: 0.62,
    highSpeedSteer: 0.2,
    steerSpeed: 2.6,
    winchForce: 26000,
    winchSpeed: 1.4,
  },
  bigfoot: {
    id: 'bigfoot',
    name: '大腳卡車',
    blurb: '大輪子、大馬力、絞盤最強。重心高，急彎和斜坡要小心翻車。',
    traits: [
      { label: '馬力', value: 5 },
      { label: '速度', value: 2 },
      { label: '穩定', value: 2 },
      { label: '越障', value: 5 },
      { label: '絞盤', value: 5 },
    ],
    mass: 2300,
    halfExtents: [1.0, 0.55, 2.15],
    cabin: [0.9, 0.45, 0.75, 0.95, 0.26],
    comOffset: [0, -0.3, 0],
    inertiaScale: 1.1,
    wheelRadius: 0.72,
    wheelWidth: 0.52,
    trackHalf: 1.12,
    frontZ: 1.5,
    rearZ: -1.45,
    mountY: -0.05,
    suspensionTravel: 0.8,
    springK: 52000,
    damperBump: 4200,
    damperRebound: 5600,
    bumpStopK: 220000,
    antiRoll: 0,
    grip: 1.05,
    lateralStiffness: 0.8,
    forceLift: 0.1,
    rollingResistance: 1,
    torqueNm: 980,
    idleRpm: 800,
    redlineRpm: 4600,
    gears: [4.2, 2.5, 1.6, 1.1],
    reverseGear: 4.0,
    finalDrive: 4.3,
    lowRange: 2.7,
    upshiftRpm: 3900,
    downshiftRpm: 1800,
    maxSpeedKmh: 62,
    maxReverseKmh: 18,
    brakeForce: 26000,
    hillHold: 1,
    holdSpeed: 0.5,
    engineBrake: 4200,
    throttleRise: 1.1,
    brakeRise: 2.5,
    maxSteer: 0.55,
    highSpeedSteer: 0.18,
    steerSpeed: 2.0,
    winchForce: 42000,
    winchSpeed: 1.2,
  },
};
