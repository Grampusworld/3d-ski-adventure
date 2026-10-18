// 雪崩的外观（设计文档 8.7）：横跨整个地图的翻滚雪浪，由一团团低多边形雪球和飞溅的雪粉组成。
// 前沿位置就是游戏里的雪崩线 frontZ。

import * as THREE from 'three';
import { mulberry32, softDot } from './math.js';

const ROWS = 3;
const SPACING = 13; // 每排雪球的横向间距（米）
const POWDER = 1400;

export class AvalancheView {
  constructor(scene) {
    this.scene = scene;
    this.mat = new THREE.MeshLambertMaterial({ color: '#f6f9fd', emissive: '#a9b9d2', emissiveIntensity: 0.35, flatShading: true });
    this.geo = new THREE.IcosahedronGeometry(1, 1);
    this.mesh = null;

    const pg = new THREE.BufferGeometry();
    this.powderPos = new Float32Array(POWDER * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.powderPos, 3));
    this.powder = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ color: '#ffffff', size: 2, map: softDot(THREE), sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.powder.frustumCulled = false;
    this.powderLife = new Float32Array(POWDER);
    this.powderVel = new Float32Array(POWDER * 3);
    scene.add(this.powder);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.setVisible(false);
  }

  setWorld(world) {
    this.world = world;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    const rng = mulberry32(world.P.seed + 99);
    const x0 = -world.xLimit + 20;
    const perRow = Math.ceil((world.xLimit * 2 - 40) / SPACING);
    this.puffs = [];
    for (let row = 0; row < ROWS; row++) {
      for (let i = 0; i < perRow; i++) {
        this.puffs.push({
          x: x0 + (i + rng() * 0.6 + row * 0.33) * SPACING,
          back: row * 15 + rng() * 6, // 越靠后的排越大、越高，形成一堵墙
          r: 9 + row * 7 + rng() * 7,
          phase: rng() * Math.PI * 2,
          spin: 0.5 + rng() * 0.6,
        });
      }
    }
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.puffs.length);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.powderLife.fill(0);
    this.setVisible(false);
  }

  setVisible(v) {
    this.visible = v;
    if (this.mesh) this.mesh.visible = v;
    this.powder.visible = v;
  }

  // frontZ：雪崩前沿；speed：雪崩速度（m/s）；focusX：镜头附近的横向位置，雪粉集中在那里
  update(dt, time, frontZ, speed, focusX, appear = 1) {
    if (!this.visible || !this.mesh) return;
    const w = this.world;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      const r = p.r * appear * (1 + 0.08 * Math.sin(time * 1.3 + p.phase));
      const z = frontZ - p.back - p.r * 0.85;
      const y = w.rawHeight(p.x, z) + r * (0.35 + 0.12 * (p.back / 15)) + Math.sin(time * 2 + p.phase) * 1.2;
      this._e.set(time * p.spin + p.phase, p.phase, 0); // 往前翻滚
      this._q.setFromEuler(this._e);
      this._p.set(p.x, y, z);
      this._s.set(r, r * 0.85, r);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // 雪粉：从雪浪前沿和顶上喷出来，往前飞、往上飘，然后消失再重新生成
    const pos = this.powderPos;
    const vel = this.powderVel;
    for (let i = 0; i < POWDER; i++) {
      this.powderLife[i] -= dt;
      const k = i * 3;
      if (this.powderLife[i] <= 0) {
        const x = Math.random() < 0.7 ? focusX + (Math.random() - 0.5) * 300 : (Math.random() * 2 - 1) * w.xLimit;
        const z = frontZ - Math.random() * 25;
        pos[k] = x;
        pos[k + 1] = w.rawHeight(x, z) + Math.random() * 45 * appear;
        pos[k + 2] = z;
        vel[k] = (Math.random() - 0.5) * 6;
        vel[k + 1] = 2 + Math.random() * 6;
        vel[k + 2] = speed + 4 + Math.random() * 10;
        this.powderLife[i] = 0.8 + Math.random() * 1.6;
      }
      pos[k] += vel[k] * dt;
      pos[k + 1] += vel[k + 1] * dt;
      pos[k + 2] += vel[k + 2] * dt;
    }
    this.powder.geometry.attributes.position.needsUpdate = true;
  }
}
