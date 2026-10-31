// Portrait touch controls: steering joystick (left), pedals + winch cluster (right).
// The winch button doubles as the aim stick: hold → auto-locks nearest anchor,
// drag → move the reticle, release → shoot. Once attached, hold = reel in.
//
// Touches are tracked by identifier and re-checked against TouchEvent.touches on every
// event, so a control can never stay "held" after its finger has left the screen
// (iOS sometimes drops touchend/pointerup when a system gesture interrupts).

import type { Input } from '../input/input';

type Ctl = 'joy' | 'gas' | 'brake' | 'hook' | 'horn' | 'reset' | 'cut';
interface Active { ctl: Ctl; id: number; sx: number; sy: number }

const IDS: Record<string, Ctl> = {
  'joy': 'joy', 'btn-gas': 'gas', 'btn-brake': 'brake', 'btn-hook': 'hook',
  'btn-horn': 'horn', 'btn-reset': 'reset', 'btn-cut': 'cut',
};
const SELECTOR = Object.keys(IDS).map((id) => `#${id}`).join(',');
const MOUSE_ID = -1;

export function bindTouch(input: Input, getAimStart: () => { x: number; y: number } | null, isAttached: () => boolean) {
  const $ = (id: string) => document.getElementById(id)!;
  const knob = $('joy-knob');
  const radius = 52;
  const active = new Map<number, Active>();
  let joyCx = 0;
  let hookBase: { x: number; y: number } | null = null;

  const setOn = (id: string, on: boolean) => $(id).classList.toggle('on', on);

  const press = (a: Active) => {
    switch (a.ctl) {
      case 'joy': {
        const r = $('joy').getBoundingClientRect();
        joyCx = r.left + r.width / 2;
        drag(a, a.sx, a.sy);
        break;
      }
      case 'gas': input.touchGas = true; setOn('btn-gas', true); break;
      case 'brake': input.touchBrake = true; setOn('btn-brake', true); break;
      case 'hook':
        setOn('btn-hook', true);
        input.pressHook();
        hookBase = isAttached() ? null : getAimStart();
        break;
      case 'horn': input.onHorn(); break;
      case 'reset': input.onReset(); break;
      case 'cut': input.onDetach(); break;
    }
  };

  const drag = (a: Active, x: number, y: number) => {
    if (a.ctl === 'joy') {
      const dx = Math.max(-radius, Math.min(radius, x - joyCx));
      knob.style.transform = `translateX(${dx}px)`;
      const v = dx / radius;
      input.touchSteer = Math.sign(v) * Math.min(1, Math.abs(v) * 1.15);
    } else if (a.ctl === 'hook') {
      if (!input.hookHeld || isAttached()) return;
      const dx = x - a.sx;
      const dy = y - a.sy;
      if (input.aimMode !== 'drag' && Math.hypot(dx, dy) < 12) return;
      if (!hookBase) hookBase = getAimStart() ?? { x: 0.5, y: 0.45 };
      input.aimMode = 'drag';
      // Amplified so a thumb's travel on the button can reach most of the screen.
      input.aimScreen = {
        x: Math.max(0, Math.min(1, hookBase.x + (dx * 2.4) / window.innerWidth)),
        y: Math.max(0, Math.min(1, hookBase.y + (dy * 2.4) / window.innerHeight)),
      };
    }
  };

  const release = (a: Active) => {
    switch (a.ctl) {
      case 'joy': knob.style.transform = ''; input.touchSteer = 0; break;
      case 'gas': input.touchGas = false; setOn('btn-gas', false); break;
      case 'brake': input.touchBrake = false; setOn('btn-brake', false); break;
      case 'hook': setOn('btn-hook', false); input.releaseHook(); break;
    }
  };

  const begin = (id: number, target: EventTarget | null, x: number, y: number): boolean => {
    const el = (target as Element | null)?.closest?.(SELECTOR);
    if (!el) return false;
    const ctl = IDS[el.id];
    for (const a of active.values()) if (a.ctl === ctl) return true; // one finger per control
    const a = { ctl, id, sx: x, sy: y };
    active.set(id, a);
    press(a);
    return true;
  };

  const end = (id: number) => {
    const a = active.get(id);
    if (!a) return;
    active.delete(id);
    release(a);
  };

  const releaseAll = () => { for (const id of [...active.keys()]) end(id); };

  /** Drop any control whose finger is no longer on the screen. */
  const sync = (e: TouchEvent) => {
    const live = new Set<number>();
    for (const t of Array.from(e.touches)) live.add(t.identifier);
    for (const id of [...active.keys()]) if (id !== MOUSE_ID && !live.has(id)) end(id);
  };

  document.addEventListener('touchstart', (e) => {
    sync(e);
    let used = false;
    for (const t of Array.from(e.changedTouches)) used = begin(t.identifier, t.target, t.clientX, t.clientY) || used;
    if (used) e.preventDefault(); // no synthetic clicks / double-tap zoom on controls
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    sync(e);
    let used = false;
    for (const t of Array.from(e.changedTouches)) {
      const a = active.get(t.identifier);
      if (a) { drag(a, t.clientX, t.clientY); used = true; }
    }
    if (used) e.preventDefault();
  }, { passive: false });

  const touchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) end(t.identifier);
    sync(e);
  };
  document.addEventListener('touchend', touchEnd);
  document.addEventListener('touchcancel', touchEnd);

  // Mouse (desktop with ?touch) uses pointer events; real touches are handled above.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && begin(MOUSE_ID, e.target, e.clientX, e.clientY)) e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    const a = active.get(MOUSE_ID);
    if (e.pointerType === 'mouse' && a) drag(a, e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(MOUSE_ID); });

  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
}

/** Two-finger pinch on the game canvas → camera zoom (not page zoom). */
export function bindPinch(canvas: HTMLElement, onZoom: (factor: number) => void) {
  const pts = new Map<number, { x: number; y: number }>();
  let lastD = 0;
  canvas.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastD) onZoom(lastD / d);
      lastD = d;
    }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); lastD = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { onZoom(Math.exp(e.deltaY * 0.0012)); e.preventDefault(); }, { passive: false });
}

/**
 * iOS Safari ignores user-scalable=no, so a double tap or stray pinch zooms the whole
 * page (HUD gets huge and cut off). Block those gestures, and if the page still ends
 * up zoomed, nudge the viewport back to scale 1.
 */
export function preventPageZoom() {
  const block = (e: Event) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, block, { passive: false });
  document.addEventListener('dblclick', block, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault(); // pinch: our canvases zoom via pointer events instead
  }, { passive: false });
  // Double tap on non-interactive areas. Buttons/inputs rely on CSS touch-action:
  // manipulation instead, so quick taps on two different buttons still both register.
  let last = { t: 0, x: 0, y: 0 };
  document.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!t) return;
    const interactive = (e.target as Element)?.closest?.('button, input, select, textarea, a, label, .card, .swatch');
    const near = Math.hypot(t.clientX - last.x, t.clientY - last.y) < 40;
    if (!interactive && near && e.timeStamp - last.t < 320) e.preventDefault();
    last = { t: e.timeStamp, x: t.clientX, y: t.clientY };
  }, { passive: false });

  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  const vv = window.visualViewport;
  if (meta && vv) {
    const base = meta.content;
    vv.addEventListener('resize', () => {
      if (vv.scale <= 1.01) return;
      // Re-applying the viewport tag makes iOS snap back to scale 1.
      meta.content = base + ', minimum-scale=1';
      setTimeout(() => { meta.content = base; }, 300);
    });
  }
}
