// Full-screen north-up map. Tap to drop a marker, pinch / wheel to zoom, drag to pan.

import type { PlayerInfo, Snapshot } from '../net/protocol';
import type { TerrainData } from '../world/terrainGen';

export class BigMap {
  private root = document.getElementById('bigmap')!;
  private canvas = document.getElementById('bigmap-canvas') as HTMLCanvasElement;
  private scale = 1; // screen px per metre (set on open)
  private cx = 0;
  private cz = 0;
  open = false;
  onMark: (x: number, z: number) => void = () => {};

  constructor(private t: TerrainData, private img: HTMLCanvasElement) {
    document.getElementById('btn-map-close')!.addEventListener('click', () => this.hide());
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number }>();
    let lastD = 0;
    let moved = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      moved = false;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) moved = true;
        if (moved) {
          this.cx -= (e.clientX - p.x) / this.scale;
          this.cz -= (e.clientY - p.y) / this.scale;
        }
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        moved = true;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastD) this.zoom(d / lastD);
        lastD = d;
      }
    });
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) lastD = 0;
      if (p && !moved && pts.size === 0) {
        const r = this.canvas.getBoundingClientRect();
        const x = this.cx + (e.clientX - r.left - r.width / 2) / this.scale;
        const z = this.cz + (e.clientY - r.top - r.height / 2) / this.scale;
        this.onMark(x, z);
      }
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); lastD = 0; });
    this.canvas.addEventListener('wheel', (e) => { this.zoom(Math.exp(-e.deltaY * 0.0015)); e.preventDefault(); }, { passive: false });
  }

  private zoom(f: number) {
    const r = this.canvas.getBoundingClientRect();
    const min = Math.min(r.width, r.height) / this.t.size;
    this.scale = Math.max(min * 0.9, Math.min(min * 8, this.scale * f));
  }

  show(center: [number, number]) {
    this.root.classList.remove('hidden');
    this.open = true;
    const r = this.canvas.getBoundingClientRect();
    this.scale = (Math.min(r.width, r.height) / this.t.size) * 2;
    this.cx = center[0];
    this.cz = center[1];
  }

  hide() {
    this.root.classList.add('hidden');
    this.open = false;
  }

  toggle(center: [number, number]) {
    if (this.open) this.hide();
    else this.show(center);
  }

  draw(s: Snapshot, players: PlayerInfo[], selfId: string) {
    if (!this.open) return;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = c.clientWidth * dpr;
    const H = c.clientHeight * dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = c.clientWidth;
    const h = c.clientHeight;
    g.fillStyle = '#4e9cc4';
    g.fillRect(0, 0, w, h);
    const sx = (x: number) => w / 2 + (x - this.cx) * this.scale;
    const sz = (z: number) => h / 2 + (z - this.cz) * this.scale;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.img, sx(this.t.origin), sz(this.t.origin), this.t.size * this.scale, this.t.size * this.scale);
    const colorOf = (id: string) => players.find((p) => p.id === id)?.color ?? '#fff';

    // Destinations: current highlighted, others small.
    this.t.destinations.forEach((d, i) => {
      const cur = i === s.game.destIndex % this.t.destinations.length;
      g.fillStyle = cur ? '#ffd166' : 'rgba(255,255,255,0.55)';
      g.strokeStyle = '#5a3a00';
      g.lineWidth = cur ? 3 : 1;
      g.beginPath();
      g.arc(sx(d.x), sz(d.z), cur ? 11 : 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (cur) {
        g.font = 'bold 14px system-ui';
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.fillText(d.name, sx(d.x), sz(d.z) - 16);
      }
    });
    for (const m of s.game.markers) {
      const x = sx(m.x);
      const y = sz(m.z);
      g.fillStyle = colorOf(m.id);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 9, y - 18); g.lineTo(x + 9, y - 18); g.fill();
    }
    for (const car of s.cars) {
      const [qx, qy, qz, qw] = car.q;
      const fx = 2 * (qx * qz + qw * qy);
      const fz = 1 - 2 * (qx * qx + qy * qy);
      g.save();
      g.translate(sx(car.p[0]), sz(car.p[2]));
      g.rotate(-Math.atan2(fx, fz));
      g.fillStyle = colorOf(car.id);
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5;
      const r = car.id === selfId ? 11 : 8;
      g.beginPath(); g.moveTo(0, r); g.lineTo(-r * 0.75, -r * 0.7); g.lineTo(r * 0.75, -r * 0.7); g.closePath();
      g.fill(); g.stroke();
      g.restore();
      const name = players.find((p) => p.id === car.id)?.name;
      if (name) {
        g.font = 'bold 12px system-ui';
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.fillText(name, sx(car.p[0]), sz(car.p[2]) + 22);
      }
    }
    // North arrow
    g.fillStyle = '#fff';
    g.font = 'bold 16px system-ui';
    g.textAlign = 'center';
    g.fillText('▲ 北', w - 34, 26);
  }
}
