import { GAME } from '../config/game';
import type { PlayerInfo, Snapshot } from '../net/protocol';
import { terrainColors } from '../render/terrainView';
import type { TerrainData } from '../world/terrainGen';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Top-down map image of the island (shared by minimap and big map). */
export function buildMapImage(t: TerrainData, px = 512): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const img = g.createImageData(px, px);
  const cols = terrainColors(t);
  const V = t.verts;
  const step = (V - 1) / px;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = Math.min(V - 2, Math.floor(x * step));
      const j = Math.min(V - 2, Math.floor(y * step));
      const n = j * V + i;
      const h = t.heights[n];
      const dzdx = t.heights[n + 1] - h;
      const dzdz = t.heights[n + V] - h;
      const shade = Math.max(0.55, Math.min(1.25, 1 + (-dzdx - dzdz) * 0.35));
      const o = (y * px + x) * 4;
      if (h < 0) {
        img.data[o] = 78; img.data[o + 1] = 156; img.data[o + 2] = 196;
      } else if (t.waterSurf[n] - h > 0.05) {
        img.data[o] = 95; img.data[o + 1] = 179; img.data[o + 2] = 214;
      } else {
        // Vertex colours are linear; approximate sRGB with sqrt for the 2D map.
        img.data[o] = Math.min(255, Math.sqrt(cols[n * 3]) * 255 * shade);
        img.data[o + 1] = Math.min(255, Math.sqrt(cols[n * 3 + 1]) * 255 * shade);
        img.data[o + 2] = Math.min(255, Math.sqrt(cols[n * 3 + 2]) * 255 * shade);
      }
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export interface HudView {
  snap: Snapshot;
  selfId: string;
  players: PlayerInfo[];
  camYaw: number;
  roomCode: string | null;
  resetCooldown: number;
  attached: boolean;
}

export class Hud {
  private compass = $<HTMLCanvasElement>('compass');
  private mini = $<HTMLCanvasElement>('minimap');
  private mission = $('mission');
  private speedo = $('speedo');
  private toasts = $('toasts');
  private roomChip = $('room-chip');
  private gaugePitch = $('gauge-pitch');
  private gaugeRoll = $('gauge-roll');
  private lastMission = '';

  constructor(private t: TerrainData, public mapImage: HTMLCanvasElement) {}

  toast(text: string, big = false, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast' + (big ? ' big' : '');
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), ms);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
  }

  update(v: HudView) {
    const me = v.snap.cars.find((c) => c.id === v.selfId);
    const dests = this.t.destinations;
    const dest = dests[v.snap.game.destIndex % dests.length];
    const colorOf = (id: string) => v.players.find((p) => p.id === id)?.color ?? '#fff';

    this.roomChip.textContent = v.roomCode ? `房號 ${v.roomCode}・${v.players.length}/${GAME.maxPlayers}` : `單人・${v.players.length}`;

    if (me) {
      // Tilt gauges: pitch (side view) and roll (rear view).
      const [qx, qy, qz, qw] = me.q;
      const fy = 2 * (qy * qz - qw * qx); // forward.y
      const ry = 2 * (qx * qy + qw * qz); // right(+x).y
      const pitch = Math.asin(Math.max(-1, Math.min(1, fy))) * 57.3; // + nose up
      const roll = -Math.asin(Math.max(-1, Math.min(1, ry))) * 57.3; // + right side up
      this.setGauge(this.gaugePitch, pitch);
      this.setGauge(this.gaugeRoll, roll);

      const kmh = Math.round(Math.hypot(me.v[0], me.v[1], me.v[2]) * 3.6);
      const gear = me.gear === -1 ? 'R' : String(me.gear);
      this.speedo.innerHTML = `${kmh} <small>km/h・${gear} 檔</small>`;

      const dist = Math.round(Math.hypot(dest.x - me.p[0], dest.z - me.p[2]));
      const secs = Math.floor((v.snap.t - v.snap.game.tripStart) / 1000);
      const inZone = v.snap.game.inZone.length;
      const total = v.snap.cars.length;
      const html = `目的地 <b>${dest.name}</b>・${dist} m<br>` +
        (inZone ? `<span class="zone">抵達 ${inZone}/${total}</span>・` : '') +
        `已送達 ${v.snap.game.delivered} 趟・${fmtTime(secs)}`;
      if (html !== this.lastMission) { this.mission.innerHTML = html; this.lastMission = html; }

      this.drawCompass(v, me.p, dest, colorOf);
      this.drawMinimap(v, me.p, dest, colorOf);
    }

    const reset = document.getElementById('btn-reset');
    reset?.classList.toggle('cool', v.resetCooldown > 0);
    document.getElementById('btn-cut')?.classList.toggle('hidden', !v.attached);
    document.getElementById('btn-hook')?.classList.toggle('attached', v.attached);
    const hookLabel = document.querySelector('#btn-hook small');
    if (hookLabel) hookLabel.textContent = v.attached ? '收繩' : '勾繩';
  }

  private setGauge(el: HTMLElement, deg: number) {
    const g = el.querySelector('g') as SVGGElement;
    g.setAttribute('transform', `rotate(${(-deg).toFixed(1)})`);
    (el.querySelector('span') as HTMLElement).textContent = `${Math.round(Math.abs(deg))}°`;
    el.classList.toggle('warn', Math.abs(deg) > 25);
    el.classList.toggle('danger', Math.abs(deg) > 35);
  }

  private drawCompass(v: HudView, me: number[], dest: { x: number; z: number }, colorOf: (id: string) => string) {
    const c = this.compass;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const fov = Math.PI * 0.9; // visible bearing span
    // Bearing convention: 0 = north (-z), clockwise positive (east = +x).
    const camBearing = Math.atan2(Math.sin(v.camYaw), -Math.cos(v.camYaw));
    const toX = (bearing: number) => {
      let d = bearing - camBearing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return W / 2 + (d / fov) * W;
    };
    g.font = 'bold 20px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const labels = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    for (let k = 0; k < 8; k++) {
      const x = toX((k * Math.PI) / 4);
      if (x < -20 || x > W + 20) continue;
      g.fillStyle = k === 0 ? '#ff8a7a' : 'rgba(255,255,255,0.9)';
      g.font = k % 2 ? 'bold 15px system-ui' : 'bold 20px system-ui';
      g.fillText(labels[k], x, H / 2 + 1);
    }
    const bearingTo = (x: number, z: number) => Math.atan2(x - me[0], -(z - me[2]));
    const pip = (x: number, color: string, r: number) => {
      if (x < 0 || x > W) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, H - 6, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const car of v.snap.cars) if (car.id !== v.selfId) pip(toX(bearingTo(car.p[0], car.p[2])), colorOf(car.id), 6);
    for (const m of v.snap.game.markers) {
      const x = toX(bearingTo(m.x, m.z));
      if (x >= 0 && x <= W) { g.fillStyle = colorOf(m.id); g.fillRect(x - 3, 2, 6, H - 4); }
    }
    const dx = toX(bearingTo(dest.x, dest.z));
    if (dx >= 0 && dx <= W) {
      g.fillStyle = '#ffd166';
      g.beginPath();
      g.moveTo(dx, H - 2); g.lineTo(dx - 9, 4); g.lineTo(dx + 9, 4);
      g.fill();
    }
    g.fillStyle = '#fff';
    g.fillRect(W / 2 - 1.5, 0, 3, 7);
  }

  private drawMinimap(v: HudView, me: number[], dest: { x: number; z: number }, colorOf: (id: string) => string) {
    const c = this.mini;
    const g = c.getContext('2d')!;
    const W = c.width;
    const span = 260; // metres across
    const s = W / span;
    const img = this.mapImage;
    const ipm = img.width / this.t.size; // image px per metre
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#4e9cc4';
    g.fillRect(0, 0, W, W);
    // Rotate so the camera's forward points up.
    g.translate(W / 2, W / 2);
    g.rotate(Math.PI + v.camYaw);
    const toImg = (wx: number) => (wx - this.t.origin) * ipm;
    g.drawImage(img, toImg(me[0]) - (span / 2) * ipm, toImg(me[2]) - (span / 2) * ipm, span * ipm, span * ipm, -W / 2, -W / 2, W, W);
    const P = (x: number, z: number) => [(x - me[0]) * s, (z - me[2]) * s] as const;
    // Destination
    const [dx, dz] = P(dest.x, dest.z);
    const dl = Math.hypot(dx, dz);
    const lim = W / 2 - 14;
    const cdx = dl > lim ? (dx / dl) * lim : dx;
    const cdz = dl > lim ? (dz / dl) * lim : dz;
    g.fillStyle = '#ffd166';
    g.strokeStyle = '#7a4a00';
    g.lineWidth = 3;
    g.beginPath(); g.arc(cdx, cdz, 10, 0, Math.PI * 2); g.fill(); g.stroke();
    for (const m of v.snap.game.markers) {
      const [mx, mz] = P(m.x, m.z);
      g.fillStyle = colorOf(m.id);
      g.beginPath(); g.moveTo(mx, mz + 10); g.lineTo(mx - 7, mz - 6); g.lineTo(mx + 7, mz - 6); g.fill();
    }
    for (const car of v.snap.cars) {
      const [cx, cz] = P(car.p[0], car.p[2]);
      const [qx, qy, qz, qw] = car.q;
      const fx = 2 * (qx * qz + qw * qy);
      const fz = 1 - 2 * (qx * qx + qy * qy);
      g.save();
      g.translate(cx, cz);
      g.rotate(-Math.atan2(fx, fz));
      g.fillStyle = colorOf(car.id);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      const r = car.id === v.selfId ? 11 : 8;
      g.beginPath(); g.moveTo(0, r); g.lineTo(-r * 0.75, -r * 0.7); g.lineTo(r * 0.75, -r * 0.7); g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }
    g.restore();
  }
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
