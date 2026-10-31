// ?debug → live tuning panel for vehicle feel (host only; the host runs the physics).
// "複製設定" copies the edited specs as JSON to paste back into src/config/vehicles.ts.

import GUI from 'lil-gui';
import { SURFACES, type VehicleId } from '../config/vehicles';
import type { HostSim } from '../game/sim';
import { ROPE } from '../game/rope';

export function createTuningPanel(sim: HostSim, onToggleColliders: (on: boolean) => void) {
  const gui = new GUI({ title: '手感調整（debug）' });
  gui.close();
  const state = { colliders: false };
  gui.add(state, 'colliders').name('顯示碰撞體').onChange(onToggleColliders);

  for (const id of Object.keys(sim.specs) as VehicleId[]) {
    const s = sim.specs[id];
    const f = gui.addFolder(s.name);
    f.close();
    const apply = () => sim.applySpec(id);
    const body = f.addFolder('車身');
    body.add(s, 'mass', 500, 5000, 10).name('質量 kg').onChange(apply);
    body.add(s.comOffset, '1', -0.8, 0.5, 0.01).name('重心高度').onChange(apply);
    body.add(s.comOffset, '2', -0.8, 0.8, 0.01).name('重心前後').onChange(apply);
    body.add(s, 'inertiaScale', 0.5, 3, 0.05).name('轉動慣量倍率').onChange(apply);
    const sus = f.addFolder('懸吊');
    sus.add(s, 'suspensionTravel', 0.2, 1.2, 0.01).name('行程 m').onChange(apply);
    sus.add(s, 'springK', 5000, 150000, 500).name('彈簧 N/m').onChange(apply);
    sus.add(s, 'damperBump', 0, 15000, 100).name('壓縮阻尼').onChange(apply);
    sus.add(s, 'damperRebound', 0, 15000, 100).name('回彈阻尼').onChange(apply);
    sus.add(s, 'antiRoll', 0, 60000, 500).name('防傾桿').onChange(apply);
    const tyre = f.addFolder('輪胎');
    tyre.add(s, 'grip', 0.3, 2, 0.01).name('抓地倍率').onChange(apply);
    tyre.add(s, 'lateralStiffness', 0.1, 1, 0.01).name('側向剛性').onChange(apply);
    tyre.add(s, 'forceLift', -0.3, 0.6, 0.01).name('施力點抬高').onChange(apply);
    tyre.add(s, 'rollingResistance', 0, 4, 0.05).name('滾阻倍率').onChange(apply);
    const eng = f.addFolder('引擎');
    eng.add(s, 'torqueNm', 100, 2000, 10).name('扭力 Nm').onChange(apply);
    eng.add(s, 'finalDrive', 2, 8, 0.05).name('終傳比').onChange(apply);
    eng.add(s, 'maxSpeedKmh', 20, 140, 1).name('極速').onChange(apply);
    eng.add(s, 'brakeForce', 2000, 60000, 500).name('煞車力').onChange(apply);
    eng.add(s, 'hillHold', 0, 1, 0.05).name('駐坡').onChange(apply);
    eng.add(s, 'holdSpeed', 0, 3, 0.1).name('駐坡啟動速度 m/s').onChange(apply);
    eng.add(s, 'engineBrake', 0, 15000, 100).name('放油門減速力 N').onChange(apply);
    eng.add(s, 'throttleRise', 0.3, 10, 0.1).name('油門加深速度').onChange(apply);
    eng.add(s, 'brakeRise', 0.3, 10, 0.1).name('煞車加深速度').onChange(apply);
    const st = f.addFolder('轉向／絞盤');
    st.add(s, 'maxSteer', 0.2, 0.9, 0.01).name('最大轉角').onChange(apply);
    st.add(s, 'highSpeedSteer', 0.05, 0.6, 0.01).name('高速轉角').onChange(apply);
    st.add(s, 'steerSpeed', 0.5, 6, 0.1).name('轉向速度').onChange(apply);
    st.add(s, 'winchForce', 5000, 80000, 500).name('絞盤力 N').onChange(apply);
    st.add(s, 'winchSpeed', 0.3, 4, 0.1).name('收繩速度').onChange(apply);
  }

  const surf = gui.addFolder('地面');
  surf.close();
  for (const k of ['grass', 'road', 'rock', 'sand', 'mud'] as const) {
    surf.add(SURFACES[k], 'grip', 0.1, 1.5, 0.01).name(`${k} 抓地`);
    surf.add(SURFACES[k], 'resistance', 0, 0.3, 0.005).name(`${k} 阻力`);
  }
  const rope = gui.addFolder('繩索');
  rope.close();
  rope.add(ROPE, 'stiffness', 10000, 300000, 1000).name('剛性');
  rope.add(ROPE, 'damping', 0, 40000, 500).name('阻尼');

  const tp = gui.addFolder('傳送（測試用）');
  tp.close();
  sim.terrain.destinations.forEach((d, i) => {
    tp.add({ go: () => sim.teleport('host', d.x + 16, d.z) }, 'go').name(`${i + 1}. ${d.name}`);
  });
  sim.terrain.creeks.forEach((c, i) => {
    const p = c.pts[Math.floor(c.pts.length / 2)];
    tp.add({ go: () => sim.teleport('host', p.x + 12, p.z) }, 'go').name(`溪流 ${i + 1}`);
  });

  gui.add({
    copy: () => {
      const json = JSON.stringify({ vehicles: sim.specs, surfaces: SURFACES, rope: ROPE }, null, 2);
      navigator.clipboard?.writeText(json).then(() => alert('已複製設定 JSON'), () => console.log(json));
      console.log(json);
    },
  }, 'copy').name('📋 複製設定');
  return gui;
}
