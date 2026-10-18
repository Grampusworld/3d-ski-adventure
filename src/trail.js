// 雪印和雪粉（设计文档 8.2）。
// 雪印：主角在地面上经过时，每隔一小段记一个点，连成一条贴地的条带；中间深、两边浅，看起来像压出的凹痕。
// 跑步时窄、肚皮滑行时宽；在空中断开。点数用环形缓冲，最多保留最近约 2 公里，最老的一段慢慢淡出。
// 雪粉：肚皮滑行速度够快时，从身后扬起少量雪粉。

import * as THREE from 'three';
import { clamp, lerp, softDot } from './math.js';
import { buryUniforms, BURY_GLSL } from './bury.js';

const MAX = 3600; // 最多保留的点数（每 0.55 米一个，约 2 公里）
const SPACING = 0.55;
const FADE_POINTS = 400; // 最老的这么多个点慢慢淡出
const LIFT = 0.04; // 贴在地面上方一点点，避免和地面打架
const CENTER = new THREE.Color('#b4c3dc');
const EDGE = new THREE.Color('#e4eaf5');

const SPRAY = 640;

export class SnowTrail {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3 * 3);
    this.col = new Float32Array(MAX * 3 * 3);
    this.alpha = new Float32Array(MAX * 3);
    this.seq = new Float32Array(MAX * 3);
    const index = [];
    for (let i = 0; i < MAX; i++) {
      const j = (i + 1) % MAX;
      const [l0, c0, r0] = [i * 3, i * 3 + 1, i * 3 + 2];
      const [l1, c1, r1] = [j * 3, j * 3 + 1, j * 3 + 2];
      index.push(l0, l1, c0, c0, l1, c1, c0, c1, r0, r0, c1, r1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSeq', new THREE.BufferAttribute(this.seq, 1));
    g.setIndex(index);
    this.uHead = { value: 0 };
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uAvalanche = buryUniforms.uAvalanche;
      shader.uniforms.uStart = buryUniforms.uStart;
      shader.uniforms.uHead = this.uHead;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aAlpha;
          attribute float aSeq;
          uniform float uHead;
          varying float vTrailAlpha;
          ${BURY_GLSL}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.y -= buryAmount(position.z) * 1.0; // 雪崩经过后被厚雪盖住
          vTrailAlpha = aAlpha * smoothstep(uHead - ${MAX}.0 + 2.0, uHead - ${MAX - FADE_POINTS}.0, aSeq);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vTrailAlpha;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.a *= vTrailAlpha;`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 雪粉
    this.sprayPos = new Float32Array(SPRAY * 3);
    this.sprayVel = new Float32Array(SPRAY * 3);
    this.sprayLife = new Float32Array(SPRAY);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    this.spray = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: '#ffffff', size: 0.16, map: softDot(THREE), sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.spray.frustumCulled = false;
    scene.add(this.spray);
    this.sprayNext = 0;

    this.reset();
  }

  reset() {
    this.alpha.fill(0);
    this.head = -1; // 最新一个点在环形缓冲里的位置
    this.count = 0; // 一共记过多少个点（用作序号）
    this.last = null; // 上一个点 { x, z }
    this.broken = true; // 下一个点要另起一段
    this.uHead.value = 0;
    this.sprayLife.fill(0);
    for (let i = 0; i < SPRAY; i++) this.sprayPos[i * 3 + 1] = -1e5; // 没用上的雪粉藏起来
    this._flag();
  }

  _flag() {
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = true;
    a.color.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aSeq.needsUpdate = true;
  }

  // 往环形缓冲里写一个点：left/center/right 三个顶点
  _write(x, z, dirX, dirZ, width, alpha, world) {
    this.head = (this.head + 1) % MAX;
    const i = this.head;
    const px = -dirZ; // 垂直于前进方向
    const pz = dirX;
    const pts = [
      [x - px * width * 0.5, z - pz * width * 0.5, EDGE, 0.55],
      [x, z, CENTER, 0.9],
      [x + px * width * 0.5, z + pz * width * 0.5, EDGE, 0.55],
    ];
    pts.forEach(([vx, vz, c, a], k) => {
      const v = i * 3 + k;
      this.pos[v * 3] = vx;
      this.pos[v * 3 + 1] = world.rawHeight(vx, vz) + LIFT;
      this.pos[v * 3 + 2] = vz;
      this.col[v * 3] = c.r;
      this.col[v * 3 + 1] = c.g;
      this.col[v * 3 + 2] = c.b;
      this.alpha[v] = a * alpha;
      this.seq[v] = this.count;
    });
    this.count++;
    // 最新点后面的一格当作「隔断」：位置和最新点重合、完全透明，避免最新点和最老的点连成一片
    const n = (i + 1) % MAX;
    for (let k = 0; k < 3; k++) {
      const v = n * 3 + k;
      const src = i * 3 + k;
      this.pos[v * 3] = this.pos[src * 3];
      this.pos[v * 3 + 1] = this.pos[src * 3 + 1];
      this.pos[v * 3 + 2] = this.pos[src * 3 + 2];
      this.alpha[v] = 0;
    }
    this.uHead.value = this.count;
  }

  // 在某个位置炸开一团雪粉（被雪崩吞没时用）
  burst(pos, count = 160) {
    for (let k = 0; k < count; k++) {
      const i = this.sprayNext;
      this.sprayNext = (this.sprayNext + 1) % SPRAY;
      const a = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 9;
      this.sprayPos[i * 3] = pos.x;
      this.sprayPos[i * 3 + 1] = pos.y + 0.8;
      this.sprayPos[i * 3 + 2] = pos.z;
      this.sprayVel[i * 3] = Math.cos(a) * v;
      this.sprayVel[i * 3 + 1] = 3 + Math.random() * 8;
      this.sprayVel[i * 3 + 2] = Math.sin(a) * v;
      this.sprayLife[i] = 0.8 + Math.random() * 0.8;
    }
  }

  // slide：0～1，肚皮滑行的程度（决定雪印宽度和是否扬雪粉）；sled：坐雪橇时两侧扬起更多雪粉
  update(dt, player, world, slide, active, sled = false) {
    const p = player.pos;
    if (active && player.grounded) {
      const width = lerp(0.35, 0.75, slide);
      if (this.broken || !this.last) {
        // 另起一段：先写一个零宽度、透明的点，和上一段隔开
        const d = player.heading;
        this._write(p.x, p.z, d.x, d.z, 0, 0, world);
        this._write(p.x, p.z, d.x, d.z, width, 1, world);
        this.last = { x: p.x, z: p.z };
        this.broken = false;
        this._flag();
      } else {
        const dx = p.x - this.last.x;
        const dz = p.z - this.last.z;
        const d = Math.hypot(dx, dz);
        if (d >= SPACING) {
          this._write(p.x, p.z, dx / d, dz / d, width, 1, world);
          this.last = { x: p.x, z: p.z };
          this._flag();
        }
      }
    } else if (!player.grounded) {
      this.broken = true;
    }

    // 雪粉
    const speed = player.currentSpeed;
    if (active && player.grounded && slide > 0.5 && speed > 25) {
      const n = Math.round(clamp((speed - 25) / 15, 0.3, 1) * 5) * (sled ? 3 : 1);
      for (let k = 0; k < n; k++) {
        const i = this.sprayNext;
        this.sprayNext = (this.sprayNext + 1) % SPRAY;
        const h = player.heading;
        // 坐雪橇时雪粉从两根滑轨往两侧扬起
        const side = sled ? (k % 2 ? 1 : -1) * (0.45 + Math.random() * 0.3) : 0;
        this.sprayPos[i * 3] = p.x - h.z * side + (Math.random() - 0.5) * 0.6;
        this.sprayPos[i * 3 + 1] = p.y + 0.1;
        this.sprayPos[i * 3 + 2] = p.z + h.x * side + (Math.random() - 0.5) * 0.6;
        // 雪粉跟着角色往前飞、比角色稍慢一点，所以留在身后不远处，不会冲到镜头跟前
        this.sprayVel[i * 3] = h.x * speed * 0.82 - h.z * side * 8 + (Math.random() - 0.5) * 3;
        this.sprayVel[i * 3 + 1] = 1 + Math.random() * (sled ? 4 : 2.2);
        this.sprayVel[i * 3 + 2] = h.z * speed * 0.82 + h.x * side * 8 + (Math.random() - 0.5) * 3;
        this.sprayLife[i] = 0.25 + Math.random() * 0.2;
      }
    }
    for (let i = 0; i < SPRAY; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      const k = i * 3;
      this.sprayVel[k + 1] -= 6 * dt;
      this.sprayPos[k] += this.sprayVel[k] * dt;
      this.sprayPos[k + 1] += this.sprayVel[k + 1] * dt;
      this.sprayPos[k + 2] += this.sprayVel[k + 2] * dt;
      if (this.sprayLife[i] <= 0) this.sprayPos[k + 1] = -1e5; // 藏起来
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
  }
}
