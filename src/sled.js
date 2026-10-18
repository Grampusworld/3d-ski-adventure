// 雪橇车增益（设计文档 3.8）：放大两倍的小木屋（门、门前发光圆环、光柱、屋顶上的进度圈）、
// 雪橇模型，以及雪橇撞毁时四散的碎木片。
// 木屋的局部坐标：入口门在 +Z 面（朝上坡，玩家跑来的方向），出口的双开大门在 -Z 面（朝下坡）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchBuryMaterial } from './bury.js';
import { HUT, hutToWorld } from './world.js';

function part(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

function merged(parts) {
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// ---------- 小木屋 ----------
const W = 15; // 宽（X）
const D = 12; // 深（Z）
const WALL_H = 9;
const RIDGE_H = 16;
const ENTRY = { w: 3.2, h: 4.6 }; // 入口门
const EXIT = { w: 7.2, h: 6 }; // 出口双开门
const WOOD = '#8b5a3c';
const LOG = '#74472e';
const DARK = '#2a1a14';

function hutGeometry() {
  const hw = W / 2;
  const hd = D / 2;
  const parts = [
    part(box(W + 0.6, 6, D + 0.6, 0, -2.4, 0), '#8a8f9c'), // 石头地基，往下埋进坡里
    part(box(W, WALL_H, D, 0, WALL_H / 2, 0), WOOD),
  ];
  // 一圈圈原木
  for (let y = 1.2; y < WALL_H; y += 1.5) parts.push(part(box(W + 0.25, 0.32, D + 0.25, 0, y, 0), LOG));
  // 四角的立柱
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(box(0.8, WALL_H, 0.8, sx * hw, WALL_H / 2, sz * hd), '#a06d4b'));
  // 前后两面的山墙
  const gable = new THREE.Shape();
  gable.moveTo(-hw, 0);
  gable.lineTo(hw, 0);
  gable.lineTo(0, RIDGE_H - WALL_H);
  gable.closePath();
  const g = new THREE.ExtrudeGeometry(gable, { depth: D - 0.2, bevelEnabled: false });
  g.translate(0, WALL_H, -(D - 0.2) / 2);
  parts.push(part(g, WOOD));
  // 屋顶：两块斜板，上面再盖一层雪
  const rise = RIDGE_H - WALL_H;
  const ang = Math.atan2(rise, hw);
  const len = Math.hypot(rise, hw) + 1.4;
  for (const sx of [-1, 1]) {
    for (const [thick, color, lift] of [[0.5, '#6b3a2e', 0], [0.35, '#f3f6fb', 0.4]]) {
      const slab = new THREE.BoxGeometry(len, thick, D + 2.2);
      slab.translate((sx * len) / 2, lift, 0);
      slab.rotateZ(sx * -ang);
      slab.translate(0, RIDGE_H + 0.3, 0);
      parts.push(part(slab, color));
    }
  }
  parts.push(part(box(1.5, 4.5, 1.5, 4, RIDGE_H - 1.5, -2), '#7d8290')); // 烟囱
  parts.push(part(box(1.8, 0.35, 1.8, 4, RIDGE_H + 0.8, -2), '#f3f6fb'));
  // 入口（+Z）：门框、门洞里的黑影、门上方的红色招牌
  parts.push(part(box(ENTRY.w + 0.8, ENTRY.h + 0.5, 0.3, 0, (ENTRY.h + 0.5) / 2, hd + 0.05), '#4a2e22'));
  parts.push(part(box(ENTRY.w, ENTRY.h, 0.1, 0, ENTRY.h / 2, hd + 0.22), DARK));
  parts.push(part(box(5, 1.3, 0.3, 0, ENTRY.h + 1.4, hd + 0.2), '#d0452f'));
  parts.push(part(box(3.6, 0.25, 0.32, 0, ENTRY.h + 1.4, hd + 0.22), '#f3f6fb'));
  // 出口（-Z）：大门框和门洞
  parts.push(part(box(EXIT.w + 1, EXIT.h + 0.6, 0.3, 0, (EXIT.h + 0.6) / 2, -hd - 0.05), '#4a2e22'));
  parts.push(part(box(EXIT.w, EXIT.h, 0.1, 0, EXIT.h / 2, -hd - 0.22), DARK));
  // 门前的台阶
  parts.push(part(box(ENTRY.w + 2, 0.5, 2, 0, 0.1, hd + 1), '#a06d4b'));
  return merged(parts);
}

// 发暖光的窗户（单独一个网格，用不受光照的材质）
function windowGeometry() {
  const hd = D / 2;
  const hw = W / 2;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(part(box(2.4, 2, 0.15, sx * 4.6, 4.6, hd + 0.12), '#ffd27a'));
    parts.push(part(box(0.15, 2, 2.6, sx * (hw + 0.12), 4.6, 0), '#ffd27a'));
  }
  return merged(parts);
}

// 门板：原点在门轴上，门板往 +X 伸出去
function leafGeometry(w, h) {
  return merged([
    part(box(w, h, 0.3, w / 2, h / 2, 0), '#6b4228'),
    part(box(w * 0.9, 0.3, 0.36, w / 2, h * 0.3, 0), '#4a2e22'),
    part(box(w * 0.9, 0.3, 0.36, w / 2, h * 0.75, 0), '#4a2e22'),
  ]);
}

// 圆环上方的光柱：越往上越淡
const beamMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ff9a2e') }, uAlpha: { value: 0.3 } },
    // 渲染器用的是对数深度缓冲，自定义着色器也要写对数深度，否则和其他物体比前后时会出错
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vY;
      void main() {
        vY = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform vec3 uColor; uniform float uAlpha; varying float vY;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(uColor, uAlpha * pow(1.0 - vY, 1.1));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

// 贴着地面起伏的圆环（每个顶点按自己那里的地面高度摆），避免平的圆环在坡上一半埋进雪里
function groundRing(world, cx, cy, cz, r0, r1, radial, lift) {
  const g = new THREE.RingGeometry(r0, r1, 56, radial).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, world.rawHeight(cx + pos.getX(i), cz + pos.getZ(i)) - cy + lift);
  }
  g.computeVertexNormals();
  return g;
}

// 远处也要看得见的圆环：
// 1. 离镜头越远，圆环整体抬得越高（60 米内贴地，300 米外约 1.7 米），从远处低角度看过去不会被小雪坡挡住；
//    远处还把圆环远离镜头的那一半往上翘，朝向镜头，否则几乎是贴着地面看过去的一条细线；
// 2. 沿视线往镜头方向拉近约 d × 2%（最多 12 米），只影响深度、不影响屏幕上的位置，远处较粗的地面网格盖不住它
function pullTowardCamera(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ringC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float liftD = distance(ringC, cameraPosition);
        float far = clamp((liftD - 60.0) / 300.0, 0.0, 1.0);
        vec2 away = normalize(ringC.xz - cameraPosition.xz + vec2(1e-4));
        transformed.y += far * 1.8 + max(dot(transformed.xz, away), 0.0) * far * 0.7;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        float pullD = length(mvPosition.xyz);
        mvPosition.xyz *= max(0.05, 1.0 - min(0.6 + pullD * 0.02, 12.0) / max(pullD, 1.0));
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  return mat;
}

// 屋顶上方的进度圈：一圈底色，按进度填上暖橙色
const progressMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uProgress; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float band = smoothstep(0.62, 0.66, r) * (1.0 - smoothstep(0.94, 0.98, r));
        float disc = 1.0 - smoothstep(0.6, 0.64, r);
        float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0); // 从正上方开始顺时针
        vec3 col = a < uProgress ? vec3(1.0, 0.62, 0.25) : vec3(1.0);
        float alpha = band * (a < uProgress ? 1.0 : 0.35) + disc * 0.25;
        gl_FragColor = vec4(mix(vec3(0.23, 0.14, 0.25), col, band), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class HutView {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.huts = [];
    this.time = 0;
  }

  setWorld(world) {
    for (const o of this.objects) {
      this.scene.remove(o);
      o.geometry.dispose();
    }
    for (const r of this.rings || []) this.scene.remove(r.group);
    this.objects = [];
    this.world = world;
    this.huts = world.huts;
    const n = this.huts.length;
    const anchor = new Float32Array(this.huts.map((h) => h.z));
    const inst = (geo, mat) => {
      geo.setAttribute('aAnchorZ', new THREE.InstancedBufferAttribute(anchor, 1));
      geo.setAttribute('aBury', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(24), 1));
      const m = new THREE.InstancedMesh(geo, patchBuryMaterial(mat), n);
      m.frustumCulled = false;
      this.scene.add(m);
      this.objects.push(m);
      return m;
    };
    const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.body = inst(hutGeometry(), lambert());
    this.windows = inst(windowGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.entry = inst(leafGeometry(ENTRY.w, ENTRY.h), lambert());
    this.exitL = inst(leafGeometry(EXIT.w / 2, EXIT.h), lambert());
    this.exitR = inst(leafGeometry(EXIT.w / 2, EXIT.h), lambert());

    this.rings = [];
    for (const h of this.huts) {
      _m.compose(_p.set(h.x, h.y, h.z), _q.setFromAxisAngle(UP, h.rot), _s);
      this.body.setMatrixAt(h.index, _m);
      this.windows.setMatrixAt(h.index, _m);

      // 门前的圆环：贴着地面起伏，稍微抬高一点；远处的地面网格更粗，会盖住圆环，
      // 所以在着色器里把圆环沿视线往镜头方向拉近一点（离得越远拉得越多），屏幕上的位置不变
      const c = hutToWorld(h, 0, HUT.ringDist);
      const gy = world.rawHeight(c.x, c.z);
      const group = new THREE.Group();
      group.position.set(c.x, gy, c.z);
      const glow = (color, opacity) => pullTowardCamera(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const ring = new THREE.Mesh(groundRing(world, c.x, gy, c.z, HUT.ringR - 0.6, HUT.ringR, 1, 0.3), glow('#ff9a2e', 0.9));
      const fill = new THREE.Mesh(groundRing(world, c.x, gy, c.z, 0.01, HUT.ringR - 0.6, 5, 0.28), glow('#ffb347', 0.2));
      ring.renderOrder = 2;
      fill.renderOrder = 1;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(HUT.ringR, HUT.ringR, 38, 32, 1, true).translate(0, 19, 0), beamMaterial());
      group.add(ring, fill, beam);
      this.scene.add(group);
      this.objects.push(ring, fill, beam);
      this.rings.push({ group, ring, fill, beam, center: { x: c.x, y: gy, z: c.z } });
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.windows.instanceMatrix.needsUpdate = true;

    this.progress = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), progressMaterial());
    this.progress.visible = false;
    this.progress.renderOrder = 10;
    this.scene.add(this.progress);
    this.objects.push(this.progress);
    this.reset();
  }

  // 每局开始：圆环全部亮起，门都关上
  reset() {
    this.state = this.huts.map(() => ({ used: false, entry: 0, exit: 0 }));
    this.progress.visible = false;
    this._updateDoors();
  }

  ringCenter(i) {
    return this.rings[i].center;
  }

  setUsed(i) {
    this.state[i].used = true;
  }

  // entry / exit：0 = 关着，1 = 完全打开
  setDoors(i, entry, exit) {
    this.state[i].entry = entry;
    this.state[i].exit = exit;
  }

  // 进度圈：progress 为 null 时隐藏
  setProgress(i, progress, camera) {
    if (progress === null) {
      this.progress.visible = false;
      return;
    }
    const h = this.huts[i];
    this.progress.visible = true;
    this.progress.position.set(h.x, h.y + RIDGE_H + 3.8, h.z);
    this.progress.quaternion.copy(camera.quaternion);
    this.progress.material.uniforms.uProgress.value = progress;
  }

  _updateDoors() {
    this.huts.forEach((h, i) => {
      const st = this.state[i];
      _m.compose(_p.set(h.x, h.y, h.z), _q.setFromAxisAngle(UP, h.rot), _s);
      const leaf = (mesh, hingeX, hingeZ, ang) => {
        _m2.makeRotationY(ang).setPosition(hingeX, 0, hingeZ);
        mesh.setMatrixAt(i, _m2.premultiply(_m));
      };
      // 入口门和出口的两扇门都往外开
      leaf(this.entry, -ENTRY.w / 2, D / 2 + 0.25, -st.entry * 1.7);
      leaf(this.exitL, -EXIT.w / 2, -D / 2 - 0.25, st.exit * 1.9);
      _m2.makeRotationY(Math.PI - st.exit * 1.9).setPosition(EXIT.w / 2, 0, -D / 2 - 0.25);
      this.exitR.setMatrixAt(i, _m2.premultiply(_m));
    });
    for (const m of [this.entry, this.exitL, this.exitR]) m.instanceMatrix.needsUpdate = true;
  }

  // collapseS：雪崩前沿，经过的圆环熄灭；activeHut：正在用的木屋（圆环也熄灭）
  update(dt, collapseS) {
    if (!this.huts.length) return;
    this.time += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    this.rings.forEach((r, i) => {
      const on = !this.state[i].used && collapseS < r.center.z - 6;
      r.group.visible = on;
      if (!on) return;
      r.ring.material.opacity = 0.55 + 0.4 * pulse;
      r.fill.material.opacity = 0.1 + 0.12 * pulse;
      r.beam.material.uniforms.uAlpha.value = 0.4 + 0.15 * pulse;
    });
    this._updateDoors();
  }
}

// ---------- 雪橇车：红色雪地摩托（按参考图） ----------
// 原点在地面上，往 +Z 前进；长约 2.9 米。车身用一个网格（顶点色），挡风玻璃单独一个半透明网格

const RED = '#c9202b';
const RED_DARK = '#9a1720';
const BLACK = '#24262b';
const SEAT = '#18191d';
const GREY = '#8e949e';
const SILVER = '#d4d7dc';

// 两点之间的一根杆子（摆臂、减震器、扶手）
function bar(a, b, thick, color) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const g = new THREE.BoxGeometry(thick, thick, d.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return part(g, color);
}

// 侧面轮廓（z, y）沿 X 方向拉伸成整流罩
function cowl(points, width, color) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // 轮廓的 x → 世界的 z
  return part(g, color);
}

function wheel(x, y, z, r) {
  return [
    part(new THREE.CylinderGeometry(r, r, 0.07, 10).rotateZ(Math.PI / 2).translate(x, y, z), SILVER),
    part(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.08, 8).rotateZ(Math.PI / 2).translate(x, y, z), BLACK),
  ];
}

function snowmobileGeometry() {
  const p = [];
  // 履带：黑色，底下一排红色履齿，侧面一条红边；前端往上斜
  p.push(part(box(0.52, 0.32, 1.45, 0, 0.24, -0.6), BLACK));
  const front = new THREE.BoxGeometry(0.52, 0.3, 0.5).rotateX(-0.55).translate(0, 0.36, 0.2);
  p.push(part(front, BLACK));
  for (let z = -1.24; z <= 0.06; z += 0.13) p.push(part(box(0.55, 0.05, 0.05, 0, 0.06, z), RED));
  for (const sx of [-1, 1]) p.push(part(box(0.04, 0.05, 1.4, sx * 0.265, 0.3, -0.6), RED));
  // 负重轮和导轨
  for (const sx of [-1, 1]) {
    for (const z of [-1.12, -0.72, -0.32]) p.push(...wheel(sx * 0.3, 0.15, z, 0.13));
    p.push(part(box(0.04, 0.05, 1.25, sx * 0.3, 0.24, -0.66), GREY));
    for (const z of [-0.92, -0.5]) p.push(bar([sx * 0.3, 0.2, z], [sx * 0.3, 0.45, z + 0.18], 0.04, GREY));
  }

  // 车身（盖在履带上）、黑色侧板、红色饰条、座椅
  p.push(part(box(0.66, 0.16, 1.55, 0, 0.5, -0.58), RED));
  p.push(part(box(0.7, 0.22, 0.95, 0, 0.66, -0.68), BLACK));
  p.push(part(box(0.71, 0.09, 0.35, 0, 0.64, -0.9), '#5b6068'));
  p.push(part(box(0.72, 0.045, 1.35, 0, 0.78, -0.5), RED));
  p.push(part(box(0.5, 0.17, 1.05, 0, 0.86, -0.6), SEAT));
  p.push(part(box(0.52, 0.22, 0.3, 0, 0.9, 0.05), RED)); // 油箱
  for (const sx of [-1, 1]) p.push(part(box(0.18, 0.04, 0.7, sx * 0.42, 0.44, -0.35), BLACK)); // 两侧踏板

  // 车尾：黑色挡泥板、尾灯、红色管状扶手
  p.push(part(new THREE.BoxGeometry(0.6, 0.42, 0.05).rotateX(0.5).translate(0, 0.46, -1.4), BLACK));
  p.push(part(box(0.66, 0.12, 0.2, 0, 0.62, -1.25), BLACK));
  p.push(part(box(0.4, 0.05, 0.04, 0, 0.63, -1.36), '#ff4a4a'));
  for (const sx of [-1, 1]) p.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8).rotateX(Math.PI / 2).translate(sx * 0.2, 0.74, -1.3), '#5b6068')); // 排气管
  for (const sx of [-1, 1]) p.push(bar([sx * 0.24, 0.85, -1.0], [sx * 0.24, 1.25, -1.2], 0.055, RED));
  p.push(bar([-0.27, 1.25, -1.2], [0.27, 1.25, -1.2], 0.055, RED));

  // 车头：红色楔形整流罩、下面黑色护板、V 字格栅、两盏车灯
  p.push(cowl([[0.15, 0.38], [1.08, 0.38], [1.24, 0.55], [1.12, 0.74], [0.75, 0.98], [0.4, 1.03], [0.2, 0.92]], 0.82, RED));
  p.push(part(box(0.86, 0.14, 0.75, 0, 0.36, 0.72), BLACK));
  p.push(part(new THREE.BoxGeometry(0.32, 0.3, 0.06).rotateX(0.75).translate(0, 0.62, 1.18), BLACK));
  p.push(part(new THREE.BoxGeometry(0.07, 0.3, 0.08).rotateX(0.75).translate(0, 0.62, 1.19), RED_DARK));
  for (const sx of [-1, 1]) p.push(part(new THREE.BoxGeometry(0.2, 0.08, 0.06).rotateX(0.6).translate(sx * 0.24, 0.75, 1.1), '#eaf6ff'));
  p.push(part(box(0.42, 0.05, 0.25, 0, 1.03, 0.33), BLACK)); // 仪表台
  p.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10).rotateX(-0.5).translate(0, 1.0, 0.7), '#f3f6fb')); // 车标

  // 车把
  p.push(part(box(0.06, 0.28, 0.06, 0, 1.16, 0.22), BLACK));
  p.push(bar([-0.4, 1.33, 0.2], [0.4, 1.33, 0.2], 0.05, BLACK));
  for (const sx of [-1, 1]) p.push(part(box(0.14, 0.07, 0.07, sx * 0.44, 1.35, 0.2), '#101114'));

  // 前面两条雪橇板：黑色板子、红色转向立柱、黑色摆臂、蓝色减震器
  for (const sx of [-1, 1]) {
    const x = sx * 0.55;
    p.push(part(box(0.14, 0.05, 1.05, x, 0.03, 0.82), BLACK));
    const tip = new THREE.BoxGeometry(0.14, 0.05, 0.32).translate(0, 0, 0.16);
    tip.rotateX(-0.65);
    tip.translate(x, 0.03, 1.32);
    p.push(part(tip, BLACK));
    p.push(part(box(0.16, 0.13, 0.62, x, 0.11, 0.88), RED));
    p.push(part(box(0.1, 0.36, 0.2, x, 0.32, 0.85), RED));
    p.push(bar([x, 0.42, 0.85], [sx * 0.24, 0.48, 0.62], 0.04, BLACK));
    p.push(bar([x, 0.3, 0.85], [sx * 0.24, 0.32, 1.0], 0.04, BLACK));
    p.push(bar([x * 0.9, 0.4, 0.85], [sx * 0.26, 0.82, 0.6], 0.075, '#2f6fa8'));
  }
  return merged(p);
}

// 整辆雪橇车：车身 + 半透明的蓝色挡风玻璃
export function createSledModel(gradientMap) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(snowmobileGeometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, flatShading: true })));
  const glass = new THREE.BoxGeometry(0.66, 0.42, 0.03).rotateX(-0.55).translate(0, 1.2, 0.52);
  group.add(new THREE.Mesh(glass, new THREE.MeshLambertMaterial({ color: '#7fb8d6', transparent: true, opacity: 0.55 })));

  // 第二档（420）时排气管喷出的火焰：外层橙色、内层黄白色，平时藏起来
  const flames = new THREE.Group();
  const flameMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  for (const sx of [-1, 1]) {
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.45), flameMat('#ff7a1a', 0.85));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.27), flameMat('#fff1a8', 0.95));
    const f = new THREE.Group();
    f.add(outer, inner);
    f.position.set(sx * 0.2, 0.74, -1.45);
    flames.add(f);
  }
  flames.visible = false;
  group.add(flames);
  group.userData.flames = flames;
  return group;
}

// ---------- 雪橇撞毁时的碎片 ----------
const PIECES = 34;
const DEBRIS_LIFE = 1.6;
const DEBRIS_COLORS = ['#c9202b', '#9a1720', '#24262b', '#8e949e', '#d4d7dc', '#7fb8d6'];

export class SledDebris {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), PIECES);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pieces = [];
    for (let i = 0; i < PIECES; i++) {
      this.mesh.setColorAt(i, new THREE.Color(DEBRIS_COLORS[i % DEBRIS_COLORS.length]));
      this.pieces.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        size: new THREE.Vector3(),
        life: 0,
      });
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.reset();
  }

  reset() {
    for (const p of this.pieces) p.life = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < PIECES; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.active = false;
  }

  // pos：雪橇位置；vel：角色当时的速度（碎片带一部分往前冲的速度）
  explode(pos, vel) {
    for (const p of this.pieces) {
      p.pos.set(pos.x + (Math.random() - 0.5) * 1, pos.y + 0.4 + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * 2);
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9;
      p.vel.set(vel.x * 0.6 + Math.cos(a) * v, Math.max(0, vel.y) * 0.3 + 4 + Math.random() * 9, vel.z * 0.6 + Math.sin(a) * v);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      p.size.set(0.08 + Math.random() * 0.35, 0.06 + Math.random() * 0.12, 0.2 + Math.random() * 0.7);
      p.life = DEBRIS_LIFE * (0.7 + Math.random() * 0.3);
    }
    this.active = true;
  }

  update(dt, world) {
    if (!this.active) return;
    let any = false;
    this.pieces.forEach((p, i) => {
      if (p.life <= 0) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        return;
      }
      any = true;
      p.life -= dt;
      p.vel.y -= 25 * dt;
      p.vel.x *= Math.exp(-1.2 * dt);
      p.vel.z *= Math.exp(-1.2 * dt);
      p.pos.addScaledVector(p.vel, dt);
      const gh = world.heightAt(p.pos.x, p.pos.z);
      if (gh !== null && p.pos.y < gh + 0.05) {
        p.pos.y = gh + 0.05;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const fade = Math.min(1, p.life / 0.3);
      _q.setFromEuler(p.rot);
      _m.compose(p.pos, _q, _p.copy(p.size).multiplyScalar(fade));
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) this.active = false;
  }
}
