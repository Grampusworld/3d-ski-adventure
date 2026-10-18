// 飘雪和速度线（设计文档 8.2）。
// 镜头周围始终飘着一层小雪：站着时慢慢往下飘；跑起来以后雪花相对你往后飞，
// 速度越快被拉成越长的白色细线。高速时屏幕边缘再加一层风雪速度线。

import * as THREE from 'three';
import { clamp, softDot } from './math.js';

const COUNT = 1600;
const BOX = new THREE.Vector3(70, 36, 70); // 雪花分布在镜头周围这么大的盒子里
const STREAK_TIME = 0.05; // 拖尾长度 = 相对速度 × 这么多秒

export class Snowfall {
  constructor(scene) {
    this.pos = new Float32Array(COUNT * 3);
    this.vel = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * BOX.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.8;
      this.vel[i * 3 + 1] = -1.1 - Math.random() * 1.2;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, map: softDot(THREE), sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.points.frustumCulled = false;

    this.linePos = new Float32Array(COUNT * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    scene.add(this.points, this.lines);

    this.time = 0;
    this.lastCam = null;
    this.camVel = new THREE.Vector3();
  }

  update(dt, camera) {
    this.time += dt;
    const cam = camera.position;
    if (this.lastCam && dt > 0) {
      const v = cam.clone().sub(this.lastCam).divideScalar(dt);
      if (v.length() > 400) v.set(0, 0, 0); // 镜头瞬移（重开、切镜头）时不算速度
      this.camVel.lerp(v, 1 - Math.exp(-10 * dt));
    }
    this.lastCam = cam.clone();
    const speed = this.camVel.length();

    const p = this.pos;
    const v = this.vel;
    const lp = this.linePos;
    const sway = Math.sin(this.time * 0.7) * 0.4;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      p[k] += (v[k] + sway) * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      // 超出镜头周围的盒子就从另一边绕回来
      for (let a = 0; a < 3; a++) {
        const size = a === 0 ? BOX.x : a === 1 ? BOX.y : BOX.z;
        const c = a === 0 ? cam.x : a === 1 ? cam.y : cam.z;
        let rel = p[k + a] - c;
        rel = ((((rel + size / 2) % size) + size) % size) - size / 2;
        p[k + a] = c + rel;
      }
      // 拖尾：沿着「雪花相对镜头的速度」往回拉
      const j = i * 6;
      lp[j] = p[k];
      lp[j + 1] = p[k + 1];
      lp[j + 2] = p[k + 2];
      lp[j + 3] = p[k] - (v[k] - this.camVel.x) * STREAK_TIME;
      lp[j + 4] = p[k + 1] - (v[k + 1] - this.camVel.y) * STREAK_TIME;
      lp[j + 5] = p[k + 2] - (v[k + 2] - this.camVel.z) * STREAK_TIME;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lineMat.opacity = clamp((speed - 10) / 35, 0, 0.75);
    return speed;
  }
}

// 屏幕边缘的风雪速度线：画在一层全屏的 2D 画布上
export class SpeedLines {
  constructor() {
    this.canvas = document.getElementById('speedlines');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.shown = false;
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // strength：0～1，速度越快越强；boost：0～1，雪橇车第二档的加速感（线更多、更长、从更靠中间开始，夹着金色的线）
  update(strength, boost = 0) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (strength <= 0.01) {
      if (this.shown) ctx.clearRect(0, 0, w, h);
      this.shown = false;
      return;
    }
    this.shown = true;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(cx, cy);
    const n = Math.round(18 + 40 * strength + 70 * boost);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.62 - 0.3 * boost + Math.random() * 0.25);
      const len = R * (0.08 + Math.random() * 0.22) * strength * (1 + boost);
      const alpha = (0.25 + Math.random() * 0.45) * strength;
      ctx.strokeStyle = Math.random() < boost * 0.55 ? `rgba(255,200,70,${Math.min(1, alpha + 0.2)})` : `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 + Math.random() * (2.5 + 2 * boost);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
  }
}
