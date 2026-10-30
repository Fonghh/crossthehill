import * as THREE from 'three';
import { CAR_COLORS } from '../config/game';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import { CarModel } from '../vehicle/vehicleModel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'home' | 'car' | 'loading' | 'none';

export function showScreen(s: Screen) {
  $('menu').classList.toggle('hidden', s === 'none');
  for (const k of ['home', 'car', 'loading']) $(`screen-${k}`).classList.toggle('hidden', k !== s);
}

export function setLoading(text: string) {
  $('loading-text').textContent = text;
}

export class CarPicker {
  car: VehicleId = 'jeep';
  color = CAR_COLORS[0];
  private previews = new Map<VehicleId, { canvas: HTMLCanvasElement; model: CarModel }>();
  private renderer?: THREE.WebGLRenderer;

  constructor() {
    const cards = $('car-cards');
    for (const spec of Object.values(VEHICLES)) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = spec.id;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      card.appendChild(canvas);
      const h = document.createElement('h3');
      h.textContent = spec.name;
      const p = document.createElement('p');
      p.textContent = spec.blurb;
      card.append(h, p);
      for (const t of spec.traits) {
        const row = document.createElement('div');
        row.className = 'trait';
        const lab = document.createElement('span');
        lab.textContent = t.label;
        const bar = document.createElement('div');
        bar.className = 'bar';
        for (let i = 1; i <= 5; i++) {
          const pip = document.createElement('i');
          if (i <= t.value) pip.className = 'on';
          bar.appendChild(pip);
        }
        row.append(lab, bar);
        card.appendChild(row);
      }
      card.addEventListener('click', () => { this.car = spec.id; this.refresh(); });
      cards.appendChild(card);
      this.previews.set(spec.id, { canvas, model: new CarModel(spec, this.color) });
    }
    const colors = $('colors');
    for (const c of CAR_COLORS) {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = c;
      sw.setAttribute('aria-label', c);
      sw.addEventListener('click', () => { this.color = c; this.refresh(); });
      colors.appendChild(sw);
    }
  }

  set(car: VehicleId, color: string) {
    this.car = car;
    this.color = color;
    this.refresh();
  }

  refresh() {
    document.querySelectorAll<HTMLElement>('.card').forEach((el) => el.classList.toggle('sel', el.dataset.id === this.car));
    document.querySelectorAll<HTMLElement>('.swatch').forEach((el) => el.classList.toggle('sel', el.style.background === hexToRgb(this.color)));
    this.renderPreviews();
  }

  private renderPreviews() {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(320, 240, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const r = this.renderer;
    for (const [, pv] of this.previews) {
      pv.model.setColor(this.color);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#b08a5a', 2));
      const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
      sun.position.set(4, 8, 5);
      scene.add(sun);
      scene.add(pv.model.root);
      pv.model.root.rotation.y = -0.7;
      const size = pv.model.spec.halfExtents[2] * 2;
      const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);
      cam.position.set(size * 1.7, size * 1.2, size * 2.1);
      cam.lookAt(0, 0.1, 0);
      r.render(scene, cam);
      const g = pv.canvas.getContext('2d')!;
      g.clearRect(0, 0, 320, 240);
      g.drawImage(r.domElement, 0, 0);
      scene.remove(pv.model.root);
    }
  }
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
