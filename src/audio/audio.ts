// Synthesised sounds (no audio files): engine, winch motor, rope creak, horn, thumps.

export class GameAudio {
  ctx?: AudioContext;
  private master?: GainNode;
  private engOsc?: OscillatorNode;
  private engOsc2?: OscillatorNode;
  private engGain?: GainNode;
  private engFilter?: BiquadFilterNode;
  private winchOsc?: OscillatorNode;
  private winchGain?: GainNode;
  private noise?: AudioBuffer;
  private lastCreak = 0;
  muted = false;

  /** Must be called from a user gesture (iOS). */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc.start();
    this.engOsc2.start();

    this.winchOsc = ctx.createOscillator();
    this.winchOsc.type = 'triangle';
    this.winchOsc.frequency.value = 180;
    this.winchGain = ctx.createGain();
    this.winchGain.gain.value = 0;
    this.winchOsc.connect(this.winchGain).connect(this.master);
    this.winchOsc.start();

    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  engine(rpm: number, throttle: number, active: boolean) {
    if (!this.ctx || !this.engOsc || !this.engOsc2 || !this.engGain || !this.engFilter) return;
    const t = this.ctx.currentTime;
    const f = 28 + rpm / 60; // firing-ish frequency
    this.engOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + throttle * 900 + rpm * 0.08, t, 0.08);
    this.engGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.12 : 0, t, 0.1);
  }

  winch(on: boolean, tension: number) {
    if (!this.ctx || !this.winchGain || !this.winchOsc) return;
    const t = this.ctx.currentTime;
    this.winchGain.gain.setTargetAtTime(on ? 0.08 : 0, t, 0.05);
    this.winchOsc.frequency.setTargetAtTime(220 - Math.min(120, tension / 300), t, 0.1);
    if (tension > 8000 && t - this.lastCreak > 0.6 + Math.random()) {
      this.lastCreak = t;
      this.creak();
    }
  }

  private creak() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(60, t + 0.25);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
  }

  horn(volume = 1) {
    if (!this.ctx || !this.master || volume <= 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * volume, t + 0.02);
    g.gain.setValueAtTime(0.16 * volume, t + 0.38);
    g.gain.linearRampToValueAtTime(0, t + 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    for (const freq of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.46);
    }
    f.connect(g).connect(this.master);
  }

  thump(strength: number) {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.6, strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  chime() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.5);
      o.connect(g).connect(this.master!);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.55);
    });
  }
}
