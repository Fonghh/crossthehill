// Portrait touch controls: steering joystick (left), pedals + winch cluster (right).
// The winch button doubles as the aim stick: hold → auto-locks nearest anchor,
// drag → move the reticle, release → shoot. Once attached, hold = reel in.

import type { Input } from '../input/input';

export function bindTouch(input: Input, getAimStart: () => { x: number; y: number } | null, isAttached: () => boolean) {
  const joy = document.getElementById('joy')!;
  const knob = document.getElementById('joy-knob')!;
  let joyId: number | null = null;
  let joyCx = 0;
  const radius = 52;
  const setKnob = (dx: number) => { knob.style.transform = `translateX(${dx}px)`; };
  joy.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    const r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2;
    move(e);
  });
  const move = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    const dx = Math.max(-radius, Math.min(radius, e.clientX - joyCx));
    setKnob(dx);
    const v = dx / radius;
    input.touchSteer = Math.sign(v) * Math.min(1, Math.abs(v) * 1.15);
  };
  joy.addEventListener('pointermove', move);
  const end = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    setKnob(0);
    input.touchSteer = 0;
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);

  const hold = (id: string, on: (v: boolean) => void) => {
    const el = document.getElementById(id)!;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.classList.add('on'); on(true); e.preventDefault(); });
    const off = () => { el.classList.remove('on'); on(false); };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  };
  hold('btn-gas', (v) => (input.touchGas = v));
  hold('btn-brake', (v) => (input.touchBrake = v));

  const tap = (id: string, fn: () => void) => {
    document.getElementById(id)!.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  };
  tap('btn-horn', () => input.onHorn());
  tap('btn-reset', () => input.onReset());
  tap('btn-cut', () => input.onDetach());

  // Winch / aim button
  const hook = document.getElementById('btn-hook')!;
  let hookId: number | null = null;
  let sx = 0;
  let sy = 0;
  let base: { x: number; y: number } | null = null;
  hook.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hookId = e.pointerId;
    hook.setPointerCapture(e.pointerId);
    hook.classList.add('on');
    sx = e.clientX;
    sy = e.clientY;
    input.pressHook();
    base = isAttached() ? null : getAimStart();
  });
  hook.addEventListener('pointermove', (e) => {
    if (e.pointerId !== hookId || !input.hookHeld || isAttached()) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (input.aimMode !== 'drag' && Math.hypot(dx, dy) < 12) return;
    if (!base) base = getAimStart() ?? { x: 0.5, y: 0.45 };
    input.aimMode = 'drag';
    // Amplified so a thumb's travel on the button can reach most of the screen.
    input.aimScreen = {
      x: Math.max(0, Math.min(1, base.x + (dx * 2.4) / window.innerWidth)),
      y: Math.max(0, Math.min(1, base.y + (dy * 2.4) / window.innerHeight)),
    };
  });
  const hookEnd = (e: PointerEvent) => {
    if (e.pointerId !== hookId) return;
    hookId = null;
    hook.classList.remove('on');
    input.releaseHook();
  };
  hook.addEventListener('pointerup', hookEnd);
  hook.addEventListener('pointercancel', hookEnd);
}

/** Two-finger pinch on the game canvas → zoom. */
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
