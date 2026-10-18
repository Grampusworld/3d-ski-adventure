// 缆车厢（设计文档 8.6）：封闭的小缆车厢挂在缆绳上，沿环线慢慢循环：
// 一侧缆绳从山顶经过起点站往终点走，另一侧从终点往回走。雪崩经过的地方，缆车厢沉到雪下面。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchBuryMaterial } from './bury.js';

const SPEED = 6; // m/s
const SPACING = 80; // 每隔多少米一个厢
const COLORS = ['#d9483b', '#2f7fc1', '#f2b134', '#3aa66b', '#7b4fc0', '#ef7a32'];

function part(geo, color) {
  const g = geo.toNonIndexed();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

// 原点在缆绳上的挂点，车厢往下吊
function bodyGeometry() {
  return part(new THREE.BoxGeometry(2, 1.9, 2.4).translate(0, -2.6, 0), '#ffffff');
}

function trimGeometry() {
  const g = mergeGeometries([
    part(new THREE.BoxGeometry(0.12, 1.5, 0.12).translate(0, -0.75, 0), '#59606e'), // 吊杆
    part(new THREE.BoxGeometry(0.45, 0.22, 0.35).translate(0, 0, 0), '#3a3f4a'), // 抱索器
    part(new THREE.BoxGeometry(2.06, 0.7, 2.46).translate(0, -2.3, 0), '#2e3a52'), // 一圈窗户
    part(new THREE.BoxGeometry(2.25, 0.25, 2.65).translate(0, -1.55, 0), '#f3f6fb'), // 白色车顶
    part(new THREE.BoxGeometry(2.06, 0.15, 2.46).translate(0, -3.55, 0), '#7f8796'), // 底板
  ]);
  g.computeVertexNormals();
  return g;
}

export class LiftCabins {
  constructor(scene) {
    this.scene = scene;
    this.bodyMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.trimMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.body = null;
    this.trim = null;
    this.offset = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // cables: { down: [...], up: [...] }，两条折线首尾相接成一个环
  setCables(cables) {
    for (const m of [this.body, this.trim]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.loop = [...cables.down, ...cables.up];
    this.cum = [0];
    for (let i = 1; i <= this.loop.length; i++) {
      const a = this.loop[i - 1];
      const b = this.loop[i % this.loop.length];
      this.cum.push(this.cum[i - 1] + a.distanceTo(b));
    }
    this.length = this.cum[this.cum.length - 1];
    this.count = Math.floor(this.length / SPACING);

    const make = (geo, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, this.count);
      mesh.frustumCulled = false;
      this.anchor = this.anchor && this.anchor.length === this.count ? this.anchor : new Float32Array(this.count);
      geo.setAttribute('aAnchorZ', new THREE.InstancedBufferAttribute(this.anchor, 1));
      geo.setAttribute('aBury', new THREE.InstancedBufferAttribute(new Float32Array(this.count).fill(16), 1));
      this.scene.add(mesh);
      return mesh;
    };
    this.anchor = new Float32Array(this.count);
    this.body = make(bodyGeometry(), this.bodyMat);
    this.trim = make(trimGeometry(), this.trimMat);
    for (let i = 0; i < this.count; i++) this.body.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length]));
    this.body.instanceColor.needsUpdate = true;
    this.update(0);
  }

  // 环线上距离 s 处的位置和前进方向
  _sample(s, outP) {
    const cum = this.cum;
    let lo = 0;
    let hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const a = this.loop[lo];
    const b = this.loop[(lo + 1) % this.loop.length];
    const t = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
    outP.lerpVectors(a, b, t);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  update(dt) {
    if (!this.body) return;
    this.offset = (this.offset + SPEED * dt) % this.length;
    for (let i = 0; i < this.count; i++) {
      const s = (i * SPACING + this.offset) % this.length;
      const yaw = this._sample(s, this._p);
      this._q.setFromAxisAngle(this._up, yaw);
      this._m.compose(this._p, this._q, this._s);
      this.body.setMatrixAt(i, this._m);
      this.trim.setMatrixAt(i, this._m);
      this.anchor[i] = this._p.z;
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.trim.instanceMatrix.needsUpdate = true;
    this.body.geometry.attributes.aAnchorZ.needsUpdate = true;
    this.trim.geometry.attributes.aAnchorZ.needsUpdate = true;
  }
}
