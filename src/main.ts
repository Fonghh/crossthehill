import './style.css';
import * as THREE from 'three';
import { GAME } from './config/game';
import type { VehicleId } from './config/vehicles';
import { AnchorIndex, ROPE_RANGE, dist, toWorld, towPointToward, type AnchorCandidate } from './game/anchors';
import { HostSim } from './game/sim';
import { Input } from './input/input';
import { ClientNet, HostNet, normalizeRoomCode } from './net/net';
import { packCar, unpackCar, type CarSnap, type ClientMsg, type GameEvent, type HostMsg, type PlayerInfo, type Snapshot, type Vec3T } from './net/protocol';
import { GameRenderer, QUALITY } from './render/gameRenderer';
import { GameAudio } from './audio/audio';
import { BigMap } from './ui/bigmap';
import { Hud, buildMapImage } from './ui/hud';
import { CarPicker, setLoading, showScreen } from './ui/menu';
import { bindPinch, bindTouch, preventPageZoom } from './ui/touch';
import { PhysicsWorld, RAPIER } from './world/physicsWorld';
import { generateTerrain, type TerrainData } from './world/terrainGen';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
if (params.has('touch')) document.body.classList.add('force-touch');
preventPageZoom();

const audio = new GameAudio();
const picker = new CarPicker();

// ------------------------------------------------------------------------------
// Menu flow

const nameInput = $<HTMLInputElement>('name');
const roomInput = $<HTMLInputElement>('room');
nameInput.value = safeGet('cth-name') ?? '';
roomInput.value = normalizeRoomCode(params.get('room') ?? '');
picker.set((safeGet('cth-car') as VehicleId) ?? 'jeep', safeGet('cth-color') ?? '#e8473f');

let pendingMode: { kind: 'host' } | { kind: 'join'; code: string } | null = null;
let game: Game | null = null;

function playerName() {
  const n = nameInput.value.trim().slice(0, 12);
  return n || '駕駛' + Math.floor(Math.random() * 90 + 10);
}

$('btn-host').addEventListener('click', () => {
  audio.unlock();
  pendingMode = { kind: 'host' };
  showScreen('car');
  picker.refresh();
});
$('btn-join').addEventListener('click', () => {
  audio.unlock();
  const code = normalizeRoomCode(roomInput.value);
  if (code.length !== GAME.roomCodeLength) { $('home-error').textContent = '請輸入 4 碼房號'; return; }
  pendingMode = { kind: 'join', code };
  showScreen('car');
  picker.refresh();
});
roomInput.addEventListener('input', () => { roomInput.value = normalizeRoomCode(roomInput.value); });
$('btn-car-back').addEventListener('click', () => {
  if (game) { showScreen('none'); return; }
  showScreen('home');
});
$('btn-go').addEventListener('click', async () => {
  audio.unlock();
  safeSet('cth-name', nameInput.value.trim());
  safeSet('cth-car', picker.car);
  safeSet('cth-color', picker.color);
  if (game) {
    game.changeCar(picker.car, picker.color);
    showScreen('none');
    return;
  }
  const mode = pendingMode;
  if (!mode) return;
  showScreen('loading');
  try {
    game = mode.kind === 'host' ? await Game.host(playerName(), picker.car, picker.color) : await Game.join(mode.code, playerName(), picker.car, picker.color);
    showScreen('none');
  } catch (e) {
    console.error(e);
    $('home-error').textContent = mode.kind === 'join' ? `連不上房間 ${mode.code}：${errText(e)}` : `開房失敗：${errText(e)}`;
    showScreen('home');
  }
});
showScreen('home');

function errText(e: unknown) {
  const t = (e as { type?: string; message?: string })?.type ?? (e as Error)?.message ?? String(e);
  if (t === 'peer-unavailable') return '找不到這個房號';
  if (t === 'timeout') return '連線逾時';
  if (t === 'full') return '房間已滿';
  return t;
}

// ------------------------------------------------------------------------------

class Game {
  renderer: GameRenderer;
  hud: Hud;
  bigmap: BigMap;
  input: Input;
  anchors: AnchorIndex;
  players: PlayerInfo[] = [];
  view: Snapshot | null = null;
  private snaps: Snapshot[] = [];
  private clockOffset: number | null = null;
  private lastTime = performance.now();
  private acc = 0;
  private sendTimer = 0;
  private aim: AnchorCandidate | null = null;
  private lastReset = -99;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private autoQuality = true;
  private goodStreak = 0;
  private colliderLines?: THREE.LineSegments;
  private showColliders = false;
  private prevVel: number[] | null = null;

  private constructor(
    public terrain: TerrainData,
    public selfId: string,
    public sim: HostSim | null,
    public hostNet: HostNet | null,
    public clientNet: ClientNet | null,
  ) {
    const canvas = $<HTMLCanvasElement>('game');
    this.renderer = new GameRenderer(canvas, terrain);
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer.setQuality(coarse ? 1 : 2);
    const mapImg = buildMapImage(terrain);
    this.hud = new Hud(terrain, mapImg);
    this.bigmap = new BigMap(terrain, mapImg);
    this.anchors = sim?.anchors ?? new AnchorIndex(terrain);
    this.input = new Input(canvas);
    this.bindControls();
    window.addEventListener('resize', () => this.renderer.resize());
    this.renderer.resize();
    $('hud').classList.remove('hidden');
    if (DEBUG) {
      (window as unknown as { __info: () => object }).__info = () => ({
        calls: this.renderer.renderer.info.render.calls,
        triangles: this.renderer.renderer.info.render.triangles,
        quality: this.renderer.qualityIndex,
      });
    }
    requestAnimationFrame(this.frame);
  }

  static async host(name: string, car: VehicleId, color: string): Promise<Game> {
    setLoading('正在生成地形…');
    await nextFrame();
    const terrain = generateTerrain(GAME.worldSeed);
    setLoading('正在建立物理世界…');
    await nextFrame();
    await PhysicsWorld.init();
    const sim = new HostSim(terrain);
    setLoading('正在開房…');
    let net: HostNet | null = null;
    try {
      net = await HostNet.create();
    } catch (e) {
      console.warn('signalling unavailable → offline solo', e);
    }
    sim.addPlayer({ id: 'host', name, car, color });
    const g = new Game(terrain, 'host', sim, net, null);
    g.players = sim.playerList();
    g.renderer.syncPlayers(g.players);
    if (net) g.wireHost(net);
    else g.hud.toast('連線伺服器無法使用，目前是單人模式', false, 4000);
    if (DEBUG) {
      const { createTuningPanel } = await import('./debug/tuning');
      createTuningPanel(sim, (on) => { g.showColliders = on; });
      const tp = params.get('tp');
      if (tp) {
        const [kind, n] = [tp[0], Number(tp.slice(1))];
        const p = kind === 'c' ? terrain.creeks[n]?.pts[Math.floor(terrain.creeks[n].pts.length / 2)] : terrain.destinations[n];
        if (p) sim.teleport('host', p.x + 12, p.z, Number(params.get('yaw') ?? 0));
      }
    }
    if (net) g.hud.toast(`房號 ${net.code}，從選單複製邀請連結`, false, 5000);
    return g;
  }

  static async join(code: string, name: string, car: VehicleId, color: string): Promise<Game> {
    setLoading(`正在連線房間 ${code}…`);
    const net = await ClientNet.join(code);
    // Messages that arrive while the terrain is generating are queued and replayed.
    const early: HostMsg[] = [];
    const welcome = await new Promise<{ you: string; seed: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      net.onMessage = (m) => {
        if (m.type === 'welcome') { clearTimeout(timer); resolve(m); }
        else if (m.type === 'reject') { clearTimeout(timer); reject(new Error(m.reason)); }
        else early.push(m);
      };
      net.send({ type: 'hello', name, car, color });
    });
    setLoading('正在生成地形…');
    await nextFrame();
    const terrain = generateTerrain(welcome.seed);
    const g = new Game(terrain, welcome.you, null, null, net);
    g.roomCode = code;
    net.onMessage = (m) => g.onHostMsg(m);
    for (const m of early) g.onHostMsg(m);
    net.onClose = () => {
      g.hud.toast('主機已離開，房間結束', true, 4000);
      setTimeout(() => location.assign(location.pathname), 3000);
    };
    return g;
  }

  roomCode: string | null = null;

  private wireHost(net: HostNet) {
    this.roomCode = net.code;
    const sim = this.sim!;
    net.onMessage = (id, msg) => {
      if (msg.type === 'hello') {
        if (sim.players.has(id)) return;
        if (sim.players.size >= GAME.maxPlayers) {
          net.send(id, { type: 'reject', reason: 'full' });
          setTimeout(() => net.kick(id), 500);
          return;
        }
        const name = String(msg.name ?? '').slice(0, 12) || '駕駛';
        sim.addPlayer({ id, name, car: msg.car === 'bigfoot' ? 'bigfoot' : 'jeep', color: String(msg.color).slice(0, 9) });
        net.send(id, { type: 'welcome', you: id, seed: GAME.worldSeed });
        this.playersChanged();
        this.pushEvent({ kind: 'toast', text: `${name} 加入了` });
        return;
      }
      if (msg.type === 'ping') { net.send(id, { type: 'pong', t: msg.t, host: performance.now() }); return; }
      sim.handle(id, msg);
      if (msg.type === 'car') this.playersChanged();
    };
    net.onLeave = (id) => {
      const name = sim.players.get(id)?.info.name;
      sim.removePlayer(id);
      this.playersChanged();
      if (name) this.pushEvent({ kind: 'toast', text: `${name} 離開了` });
    };
  }

  private playersChanged() {
    if (!this.sim) return;
    this.players = this.sim.playerList();
    this.renderer.syncPlayers(this.players);
    this.hostNet?.broadcast({ type: 'players', players: this.players });
  }

  private pushEvent(ev: GameEvent) {
    this.sim?.events.push(ev);
  }

  private onHostMsg(m: HostMsg) {
    switch (m.type) {
      case 'snap': {
        const snap: Snapshot = { t: m.t, cars: m.c.map(unpackCar), ropes: m.ropes, game: m.game };
        const sample = snap.t - performance.now();
        this.clockOffset = this.clockOffset === null ? sample : Math.max(sample, this.clockOffset * 0.98 + sample * 0.02);
        this.snaps.push(snap);
        if (this.snaps.length > 30) this.snaps.shift();
        break;
      }
      case 'players':
        this.players = m.players;
        this.renderer.syncPlayers(m.players);
        break;
      case 'event':
        this.handleEvent(m.ev);
        break;
    }
  }

  private handleEvent(ev: GameEvent) {
    const me = this.view?.cars.find((c) => c.id === this.selfId);
    switch (ev.kind) {
      case 'horn': {
        const car = this.view?.cars.find((c) => c.id === ev.id);
        const d = me && car ? dist(me.p, car.p) : 0;
        audio.horn(Math.max(0, 1 - d / 120));
        break;
      }
      case 'delivered':
        this.hud.toast(`🎉 送達「${ev.dest}」！第 ${ev.count} 趟・${Math.round(ev.seconds)} 秒`, true, 4000);
        audio.chime();
        break;
      case 'toast':
        this.hud.toast(ev.text);
        break;
      case 'attach':
      case 'detach':
        if (ev.id === this.selfId) audio.thump(0.15);
        break;
    }
  }

  private send(msg: ClientMsg) {
    if (this.sim) this.sim.handle(this.selfId, msg);
    else this.clientNet?.send(msg);
  }

  private get attached() {
    return !!this.view?.ropes.some((r) => r.owner === this.selfId);
  }

  private bindControls() {
    const inp = this.input;
    inp.onHookRelease = () => {
      if (this.attached) return;
      if (this.aim) this.send({ type: 'attach', target: this.aim.target });
      this.aim = null;
      this.renderer.setAim(null, null, false);
    };
    inp.onDetach = () => this.send({ type: 'detach' });
    inp.onReset = () => {
      const now = performance.now() / 1000;
      if (now - this.lastReset < GAME.resetCooldownSec) return;
      this.lastReset = now;
      this.send({ type: 'reset' });
    };
    inp.onHorn = () => this.send({ type: 'horn' });
    inp.onMap = () => this.toggleMap();
    inp.onMenu = () => this.togglePause();
    bindTouch(inp, () => (this.aim ? this.renderer.worldToScreen(this.aim.pos) : null), () => this.attached);
    bindPinch(this.renderer.canvas, (f) => { this.renderer.zoom = Math.max(10, Math.min(70, this.renderer.zoom * f)); });
    $('minimap').addEventListener('click', () => this.toggleMap());
    this.bigmap.onMark = (x, z) => {
      this.send({ type: 'mark', x, z });
      this.bigmap.hide();
    };
    $('btn-menu').addEventListener('click', () => this.togglePause());
    $('btn-resume').addEventListener('click', () => this.togglePause(false));
    $('btn-respawn').addEventListener('click', () => { this.send({ type: 'respawn' }); this.togglePause(false); });
    $('btn-change-car').addEventListener('click', () => { this.togglePause(false); showScreen('car'); picker.refresh(); });
    $('btn-leave').addEventListener('click', () => {
      if (this.sim && this.players.length > 1 && !confirm('你是主機，離開會結束整個房間。確定？')) return;
      location.assign(location.pathname);
    });
    $('btn-share').addEventListener('click', async () => {
      if (!this.roomCode) { this.hud.toast('單人模式沒有房號'); return; }
      const url = `${location.origin}${location.pathname}?room=${this.roomCode}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Cross the Hill', text: `一起越野！房號 ${this.roomCode}`, url });
        else { await navigator.clipboard.writeText(url); this.hud.toast('已複製邀請連結'); }
      } catch { /* user cancelled */ }
    });
    const q = $<HTMLSelectElement>('quality');
    q.addEventListener('change', () => {
      this.autoQuality = q.value === 'auto';
      if (!this.autoQuality) this.renderer.setQuality(Number(q.value));
    });
  }

  changeCar(car: VehicleId, color: string) {
    this.send({ type: 'car', car, color });
    if (this.sim) this.playersChanged();
  }

  private toggleMap() {
    const me = this.view?.cars.find((c) => c.id === this.selfId);
    this.bigmap.toggle(me ? [me.p[0], me.p[2]] : [0, 0]);
  }

  private togglePause(force?: boolean) {
    const el = $('pause');
    const show = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
  }

  // ----------------------------------------------------------------------------

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const inp = this.input;
    inp.enabled = !this.bigmap.open && $('pause').classList.contains('hidden') && $('menu').classList.contains('hidden');
    inp.poll(dt);
    const input: ClientMsg = { type: 'input', steer: inp.steer, throttle: inp.throttle, brake: inp.brake, winch: inp.hookHeld && this.attached };

    if (this.sim) {
      this.sim.handle(this.selfId, input);
      this.acc += dt;
      const h = 1 / GAME.physicsHz;
      let steps = 0;
      while (this.acc >= h && steps < 4) { this.sim.step(h); this.acc -= h; steps++; }
      if (steps === 4) this.acc = 0;
      this.view = this.sim.snapshot();
      for (const ev of this.sim.events.splice(0)) {
        this.handleEvent(ev);
        this.hostNet?.broadcast({ type: 'event', ev });
      }
      this.sendTimer += dt;
      if (this.hostNet && this.sendTimer >= 1 / GAME.snapshotHz) {
        this.sendTimer = 0;
        const v = this.view;
        this.hostNet.broadcast({ type: 'snap', t: v.t, c: v.cars.map(packCar), ropes: v.ropes, game: v.game });
      }
      if (this.showColliders) this.drawColliders();
      else if (this.colliderLines) this.colliderLines.visible = false;
    } else {
      this.sendTimer += dt;
      if (this.sendTimer >= 1 / GAME.inputHz) { this.sendTimer = 0; this.clientNet?.send(input); }
      this.view = this.interpolated(now);
    }

    const view = this.view;
    if (!view) { this.renderer.render(); return; }
    const me = view.cars.find((c) => c.id === this.selfId);
    this.renderer.applyState(view, this.selfId);
    this.renderer.updateCamera(me, dt);
    this.updateAim(me);
    this.hud.update({
      snap: view, selfId: this.selfId, players: this.players, camYaw: this.renderer.camYaw, roomCode: this.roomCode,
      resetCooldown: Math.max(0, GAME.resetCooldownSec - (performance.now() / 1000 - this.lastReset)), attached: this.attached,
    });
    this.bigmap.draw(view, this.players, this.selfId);
    this.updateAudio(me, view);
    this.renderer.render();
    this.trackFps(dt);
  };

  private interpolated(now: number): Snapshot | null {
    if (!this.snaps.length || this.clockOffset === null) return this.view;
    const t = now + this.clockOffset - GAME.interpDelayMs;
    const s = this.snaps;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const b = s[i];
    const a = s[Math.max(0, i - 1)];
    if (a === b || t >= b.t) {
      // Extrapolate briefly past the newest snapshot.
      const ex = Math.min(0.15, Math.max(0, (t - b.t) / 1000));
      return { ...b, cars: b.cars.map((c) => ({ ...c, p: [c.p[0] + c.v[0] * ex, c.p[1] + c.v[1] * ex, c.p[2] + c.v[2] * ex] as Vec3T })) };
    }
    const k = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const byId = new Map(a.cars.map((c) => [c.id, c]));
    const cars = b.cars.map((cb) => {
      const ca = byId.get(cb.id);
      return ca ? lerpCar(ca, cb, k) : cb;
    });
    return { ...b, t, cars };
  }

  private updateAim(me: CarSnap | undefined) {
    const inp = this.input;
    if (!me || !inp.hookHeld || this.attached) {
      if (!inp.hookHeld) this.renderer.setAim(null, null, false);
      if (this.attached) this.renderer.setAim(null, null, false);
      this.aim = inp.hookHeld && !this.attached ? this.aim : null;
      return;
    }
    const myCar = this.players.find((p) => p.id === this.selfId)?.car ?? 'jeep';
    const poses = (this.view?.cars ?? []).map((c) => ({ id: c.id, car: this.players.find((p) => p.id === c.id)?.car ?? 'jeep', p: c.p, q: c.q }));
    const cands = this.anchors.query(me.p, ROPE_RANGE + 2, poses, this.selfId);
    const towFrom = (to: Vec3T) => toWorld(me, towPointToward({ id: me.id, car: myCar, p: me.p, q: me.q }, to));
    let point: Vec3T | null = null;
    let best: AnchorCandidate | null = null;
    if (inp.aimMode === 'auto') {
      // Prefer teammates, then anything roughly ahead of the camera, then nearest.
      const yaw = this.renderer.camYaw;
      let bestScore = Infinity;
      for (const c of cands) {
        const d = dist(towFrom(c.pos), c.pos);
        if (d > ROPE_RANGE) continue;
        const ang = Math.atan2(c.pos[0] - me.p[0], c.pos[2] - me.p[2]) - yaw;
        const facing = 1 - Math.cos(ang);
        const score = d * (1 + facing * 0.6) * (c.target.kind === 'car' ? 0.6 : 1);
        if (score < bestScore) { bestScore = score; best = c; }
      }
    } else {
      if (this.input.padAim.x || this.input.padAim.z) {
        const yaw = this.renderer.camYaw;
        const { x, z } = this.input.padAim;
        const wx = me.p[0] + Math.sin(yaw) * z - Math.cos(yaw) * x;
        const wz = me.p[2] + Math.cos(yaw) * z + Math.sin(yaw) * x;
        point = [wx, me.p[1], wz];
      } else {
        point = this.renderer.screenToGround(inp.aimScreen.x * 2 - 1, -(inp.aimScreen.y * 2 - 1));
      }
      if (point) {
        let bd = 6;
        for (const c of cands) {
          const d = Math.hypot(c.pos[0] - point[0], c.pos[2] - point[2]);
          if (d < bd && dist(towFrom(c.pos), c.pos) <= ROPE_RANGE) { bd = d; best = c; }
        }
      }
    }
    this.aim = best;
    if (best) this.renderer.setAim(towFrom(best.pos), best.pos, true);
    else if (point) this.renderer.setAim(towFrom(point), [point[0], point[1] + 0.5, point[2]], false);
    else this.renderer.setAim(null, null, false);
  }

  private updateAudio(me: CarSnap | undefined, view: Snapshot) {
    if (!me) return;
    audio.engine(me.rpm, this.input.throttle || this.input.brake, true);
    const rope = view.ropes.find((r) => r.owner === this.selfId || (r.target.kind === 'car' && r.target.id === this.selfId));
    audio.winch(!!rope?.reeling && rope.owner === this.selfId, rope?.tension ?? 0);
    // Hard landings / impacts.
    if (this.prevVel) {
      const dv = Math.hypot(me.v[0] - this.prevVel[0], me.v[1] - this.prevVel[1], me.v[2] - this.prevVel[2]);
      if (dv > 4) audio.thump(Math.min(0.6, dv / 15));
    }
    this.prevVel = me.v;
  }

  private trackFps(dt: number) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc < 3) return;
    const avg = this.fpsAcc / this.fpsFrames;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    if (!this.autoQuality) return;
    const q = this.renderer.qualityIndex;
    if (avg > 1 / 27 && q > 0) {
      this.renderer.setQuality(q - 1);
      this.hud.toast(`畫質自動調為「${QUALITY[q - 1].name}」`, false, 1800);
      this.goodStreak = 0;
    } else if (avg < 1 / 55) {
      if (++this.goodStreak >= 4 && q < QUALITY.length - 1) { this.renderer.setQuality(q + 1); this.goodStreak = 0; }
    } else this.goodStreak = 0;
  }

  private drawColliders() {
    const sim = this.sim!;
    const me = sim.cars.get(this.selfId)?.body.translation();
    if (!me) return;
    const buffers = sim.phys.world.debugRender(undefined, (col: RAPIER.Collider) => {
      const tag = sim.phys.tags.get(col.handle);
      if (tag?.kind === 'terrain') return Math.hypot(tag.cx - me.x, tag.cz - me.z) < 50;
      const t = col.translation();
      return tag?.kind === 'car' || Math.hypot(t.x - me.x, t.z - me.z) < 60;
    });
    if (!this.colliderLines) {
      this.colliderLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.6 }));
      this.colliderLines.renderOrder = 30;
      this.colliderLines.frustumCulled = false;
      this.renderer.scene.add(this.colliderLines);
    }
    this.colliderLines.visible = true;
    const g = this.colliderLines.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    g.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
  }
}

function lerpCar(a: CarSnap, b: CarSnap, k: number): CarSnap {
  const qa = new THREE.Quaternion(...a.q);
  const qb = new THREE.Quaternion(...b.q);
  qa.slerp(qb, k);
  const L = (x: number, y: number) => x + (y - x) * k;
  const A = (x: number, y: number) => {
    let d = y - x;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return x + d * k;
  };
  return {
    ...b,
    p: [L(a.p[0], b.p[0]), L(a.p[1], b.p[1]), L(a.p[2], b.p[2])],
    q: [qa.x, qa.y, qa.z, qa.w],
    v: [L(a.v[0], b.v[0]), L(a.v[1], b.v[1]), L(a.v[2], b.v[2])],
    st: L(a.st, b.st),
    wl: b.wl.map((w, i) => L(a.wl[i], w)),
    ws: b.ws.map((w, i) => A(a.ws[i], w)),
    rpm: L(a.rpm, b.rpm),
  };
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}
