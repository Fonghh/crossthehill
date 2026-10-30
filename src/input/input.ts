// Merges keyboard, gamepad and touch into one control state.
//   Keyboard: W/S or ↑/↓ gas & brake, A/D or ←/→ steer, E hold = winch aim (mouse picks),
//             Q detach, R reset, H horn, M map, Esc menu
//   Gamepad:  RT gas, LT brake, left stick steer, LB hold = aim (right stick), B detach,
//             Y reset, X horn, Back/View map
//   Touch:    see ui/touch.ts

export type AimMode = 'off' | 'auto' | 'drag';

export class Input {
  steer = 0;
  throttle = 0;
  brake = 0;
  hookHeld = false;
  aimMode: AimMode = 'off';
  /** Screen position (0..1) of the aim point in drag mode. */
  aimScreen = { x: 0.5, y: 0.5 };
  /** Gamepad right-stick aim offset, accumulated in metres relative to the car. */
  padAim = { x: 0, z: 0 };
  /** Set by touch / gamepad when they are the active scheme. */
  touchSteer = 0;
  touchGas = false;
  touchBrake = false;

  onHookRelease: () => void = () => {};
  onHookPress: () => void = () => {};
  onDetach: () => void = () => {};
  onReset: () => void = () => {};
  onHorn: () => void = () => {};
  onMap: () => void = () => {};
  onMenu: () => void = () => {};

  private keys = new Set<string>();
  private padPrev: boolean[] = [];
  private mouseMoved = false;
  enabled = true;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyE': this.pressHook(); break;
        case 'KeyQ': this.onDetach(); break;
        case 'KeyR': this.onReset(); break;
        case 'KeyH': this.onHorn(); break;
        case 'KeyM': this.onMap(); break;
        case 'Escape': this.onMenu(); break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.releaseHook();
    });
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => {
      if (this.hookHeld && this.keys.has('KeyE')) {
        const r = canvas.getBoundingClientRect();
        this.aimScreen = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
        if (!this.mouseMoved) { this.mouseMoved = true; this.aimMode = 'drag'; }
      }
    });
  }

  pressHook() {
    if (this.hookHeld) return;
    this.hookHeld = true;
    this.aimMode = 'auto';
    this.mouseMoved = false;
    this.padAim = { x: 0, z: 0 };
    this.onHookPress();
  }

  releaseHook() {
    if (!this.hookHeld) return;
    this.hookHeld = false;
    this.onHookRelease();
    this.aimMode = 'off';
  }

  /** Called each frame. */
  poll(dt: number) {
    const k = this.keys;
    let steer = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    let gas = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0;

    steer += this.touchSteer;
    if (this.touchGas) gas = 1;
    if (this.touchBrake) brake = 1;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      steer += dz(pad.axes[0] ?? 0);
      gas = Math.max(gas, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      const edge = (i: number) => {
        const now = !!pad.buttons[i]?.pressed;
        const was = !!this.padPrev[i];
        this.padPrev[i] = now;
        return now && !was ? 1 : !now && was ? -1 : 0;
      };
      const lb = edge(4);
      if (lb === 1) this.pressHook();
      if (lb === -1) this.releaseHook();
      if (edge(1) === 1) this.onDetach();
      if (edge(3) === 1) this.onReset();
      if (edge(2) === 1) this.onHorn();
      if (edge(8) === 1) this.onMap();
      if (edge(9) === 1) this.onMenu();
      if (this.hookHeld) {
        const ax = dz(pad.axes[2] ?? 0);
        const ay = dz(pad.axes[3] ?? 0);
        if (ax || ay) {
          this.aimMode = 'drag';
          this.padAim.x += ax * dt * 22;
          this.padAim.z += -ay * dt * 22;
        }
      }
    }

    // Smooth keyboard steering so taps don't jerk the wheel.
    const target = Math.max(-1, Math.min(1, steer));
    const rate = dt * 6;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    if (Math.abs(target) > Math.abs(this.steer) && (this.touchSteer || pad)) this.steer = target; // analog sources: direct
    this.throttle = this.enabled ? gas : 0;
    this.brake = this.enabled ? brake : 0;
    if (!this.enabled) this.steer = 0;
  }
}
