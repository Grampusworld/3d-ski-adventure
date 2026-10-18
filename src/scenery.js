// 场景物件（设计文档 6.4、8.5、8.6）：起点和终点两座滑雪站、贯穿全程的缆车线、雪松、岩石、
// 远处的山脉和云海、终点线。
// 会被雪崩埋掉的东西都用 bury.js 的着色器：经过雪崩线后整体沉到雪下面。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './math.js';
import { patchBuryMaterial } from './bury.js';

// ---------- 静态物件合并 ----------

const _box3 = new THREE.Box3();
const _center = new THREE.Vector3();

// 收集一堆带颜色的几何体，最后合并成一个网格；每个物件记录自己的 z 和被埋时下沉的深度。
// 可以设一个局部坐标系（frame），addLocal 加进来的几何体先从局部坐标变换到世界坐标。
class PropBuilder {
  constructor() {
    this.parts = [];
    this.frame = new THREE.Matrix4();
  }

  setFrame(m) {
    this.frame.copy(m);
  }

  add(geo, color, { anchorZ, bury }) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('aAnchorZ', new THREE.BufferAttribute(new Float32Array(n).fill(anchorZ), 1));
    g.setAttribute('aBury', new THREE.BufferAttribute(new Float32Array(n).fill(bury), 1));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    this.parts.push(g);
  }

  // 局部坐标的几何体：变换到世界坐标，anchorZ 取变换后的中心
  addLocal(geo, color, bury) {
    geo.applyMatrix4(this.frame);
    _box3.setFromBufferAttribute(geo.getAttribute('position')).getCenter(_center);
    this.add(geo, color, { anchorZ: _center.z, bury });
  }

  build(material) {
    const g = mergeGeometries(this.parts);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    this.parts = [];
    return mesh;
  }
}

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// ---------- 雪松（实例化） ----------

export function pineGeometry() {
  const parts = [];
  const tint = (g, color) => {
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    return g;
  };
  parts.push(tint(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5).translate(0, 0.8, 0).toNonIndexed(), '#5a4232'));
  const tiers = [
    [2.2, 2.8, 1.2],
    [1.7, 2.4, 2.7],
    [1.15, 2.1, 4.1],
  ];
  for (const [r, h, y] of tiers) {
    parts.push(tint(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0).toNonIndexed(), '#2f4c44'));
    parts.push(tint(new THREE.ConeGeometry(r * 0.55, h * 0.4, 7).translate(0, y + h * 0.8, 0).toNonIndexed(), '#f1f5fb')); // 积雪
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

function makeInstanced(geo, material, items) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const anchor = new Float32Array(items.length);
  const bury = new Float32Array(items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, it.s * (it.sy ?? 1), it.s));
    mesh.setMatrixAt(i, m);
    anchor[i] = it.z;
    bury[i] = it.bury; // 物件自身坐标里的下沉深度
  });
  geo.setAttribute('aAnchorZ', new THREE.InstancedBufferAttribute(anchor, 1));
  geo.setAttribute('aBury', new THREE.InstancedBufferAttribute(bury, 1));
  return mesh;
}

// ---------- 背景：山脉和云海 ----------

const HORIZON = new THREE.Color('#e6edf6');

function mountainGeometry(rng, radius, height, distance) {
  const g = new THREE.ConeGeometry(radius, height, 8, 4, true).toNonIndexed(); // 不要底面：从下面看不到
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > height / 2 - 1) continue; // 山尖不动
    const k = 1 + (rng() - 0.5) * 0.18;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.translate(0, height / 2, 0);
  // 雪线以上白、以下岩石灰蓝，越远越淡（自己做的空气透视，不受雾影响）
  const fade = Math.min(0.7, distance / 4500);
  const snow = new THREE.Color('#f2f6fc').lerp(HORIZON, fade);
  const rock = new THREE.Color('#7f8ba3').lerp(HORIZON, fade);
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    c.copy(cy > height * 0.42 + (rng() - 0.5) * height * 0.15 ? snow : rock);
    c.multiplyScalar(0.94 + rng() * 0.08);
    for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- 整个场景 ----------

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.propMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.treeMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.rockMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ color: '#8f9ab0', flatShading: true }));
    this.windowMat = patchBuryMaterial(new THREE.MeshLambertMaterial({ color: '#3b4a6b', emissive: '#ffc477', emissiveIntensity: 0.55 }));
    this.bgMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
    this.cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#dfe7f2', emissiveIntensity: 0.55, flatShading: true, fog: false, transparent: true, opacity: 0.93 });
    this.portal = null;
    this.cables = null; // 缆绳的两条折线（给缆车厢用）
  }

  setWorld(world) {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse((c) => c.geometry?.dispose());
    }
    this.world = world;
    const rng = mulberry32(world.P.seed + 7);
    const pb = new PropBuilder();
    const wins = new PropBuilder();
    // 起点：正面朝下坡；终点：转 180°，正面朝上坡，冲下来时迎面就能看到（缆车站台转完后都在右侧）
    this._buildStation(pb, wins, w0(world, world.station), 1, world, { fenceFront: 48 });
    this._buildStation(pb, wins, w0(world, world.finishStation, world.finishFlatY), -1, world, { fenceFront: 26 });
    this._buildLift(pb, world);
    this.group.add(pb.build(this.propMat));
    this.group.add(wins.build(this.windowMat));
    this._buildTrees(world, rng);
    this._buildBackground(world, rng);
    this._buildFinishLine(world);
  }

  // 一座滑雪站：木屋、门、窗、烟囱、缆车站台、栅栏、彩旗、雪人（不挂招牌）。
  // 在局部坐标里建（正面朝 +Z），facing = -1 时整体转 180°。
  _buildStation(pb, wins, at, facing, w, { fenceFront }) {
    const frame = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationY(facing > 0 ? 0 : Math.PI));
    pb.setFrame(frame);
    wins.setFrame(frame);
    const LODGE = 16;

    // 木屋
    const W = 16;
    const Hh = 7;
    const D = 11;
    const front = D / 2;
    pb.addLocal(box(W + 0.6, 1, D + 0.6, 0, 0.5, 0), '#8d8f99', LODGE); // 石头地基
    pb.addLocal(box(W, Hh, D, 0, Hh / 2, 0), '#8b5a3c', LODGE);
    for (let i = 0; i < 6; i++) pb.addLocal(box(W + 0.05, 0.12, D + 0.05, 0, 1.4 + i * 1.0, 0), '#7a4c32', LODGE); // 木板缝
    // 屋顶：三棱柱，盖一层雪
    const roof = (scale, color, lift) => {
      const g = new THREE.CylinderGeometry(1, 1, W + 2.4, 3);
      g.rotateZ(Math.PI / 2);
      g.rotateX(-Math.PI / 2);
      g.scale(1, 3.4 * scale, 7.6 * scale);
      g.translate(0, Hh + 1.7 + lift, 0);
      pb.addLocal(g, color, LODGE);
    };
    roof(1, '#6b3a2e', 0);
    roof(1.03, '#f3f6fb', 0.28);
    pb.addLocal(box(2.4, 3.4, 0.3, 0, 1.7, front + 0.1), '#4a2e22', LODGE); // 门
    pb.addLocal(box(3.6, 0.3, 1.8, 0, 3.6, front + 0.9), '#f3f6fb', LODGE); // 门廊雪檐
    pb.addLocal(box(1.2, 3.2, 1.2, 4.5, Hh + 3.5, -1.5), '#8d8f99', LODGE); // 烟囱
    pb.addLocal(box(1.4, 0.3, 1.4, 4.5, Hh + 5.2, -1.5), '#f3f6fb', LODGE);
    for (const wx of [-5.2, 5.2]) wins.addLocal(box(2.4, 1.7, 0.2, wx, 3.4, front + 0.05), '#ffffff', LODGE);
    wins.addLocal(box(2.4, 1.4, 0.2, 0, 5.6, front + 0.05), '#ffffff', LODGE);

    // 缆车站台：在木屋右侧（转 180° 的那座在局部左侧，转完后同样在世界坐标的右侧）
    const lx = 19 * facing;
    const TERM = 14;
    pb.addLocal(box(6, 4, 6, lx, 2, 2), '#7a4c32', TERM);
    pb.addLocal(box(6.6, 0.4, 6.6, lx, 4.2, 2), '#f3f6fb', TERM);
    pb.addLocal(box(0.8, 7, 0.8, lx, 3.5, 2), '#59606e', TERM);
    const wheel = new THREE.TorusGeometry(2.8, 0.25, 6, 18);
    wheel.rotateX(Math.PI / 2);
    wheel.translate(lx, 7, 2);
    pb.addLocal(wheel, '#59606e', TERM);

    // 栅栏：围着平地两侧
    for (const side of [-1, 1]) {
      for (let z = -26; z <= fenceFront; z += 3) {
        pb.addLocal(box(0.25, 1.4, 0.25, side * 30, 0.7, z), '#7a4c32', 3);
        pb.addLocal(box(0.12, 0.14, 3, side * 30, 1.1, z + 1.5), '#7a4c32', 3);
        pb.addLocal(box(0.12, 0.14, 3, side * 30, 0.6, z + 1.5), '#7a4c32', 3);
      }
    }

    // 彩旗：木屋前面一排
    const flagColors = ['#d9483b', '#f2b134', '#2f7fc1', '#3aa66b', '#d9483b', '#f2b134'];
    flagColors.forEach((color, i) => {
      const fx = -13 + i * 5.2;
      const fz = front + 6;
      pb.addLocal(box(0.15, 6, 0.15, fx, 3, fz), '#d9dde6', 8);
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0, 2.2, -0.7, 0, 0, 0, 0, 2.2, -0.7, 0, 0, -1.4, 0], 3));
      tri.translate(fx + 0.08, 6, fz);
      pb.addLocal(tri, color, 8);
    });

    // 雪人
    pb.addLocal(new THREE.IcosahedronGeometry(0.9, 1).translate(-12, 0.8, front + 12), '#f6f8fc', 4);
    pb.addLocal(new THREE.IcosahedronGeometry(0.6, 1).translate(-12, 2.1, front + 12), '#f6f8fc', 4);
    pb.addLocal(new THREE.ConeGeometry(0.1, 0.5, 5).rotateX(Math.PI / 2).translate(-12, 2.1, front + 12.75), '#ef7a32', 4);
    pb.setFrame(new THREE.Matrix4());
    wins.setFrame(new THREE.Matrix4());
  }

  // 缆车线：塔架、缆绳（设计文档 8.6）；缆绳的两条折线留给缆车厢用
  _buildLift(pb, w) {
    const pts = w.liftPath;
    const yAxis = new THREE.Vector3(0, 1, 0);
    const sideA = [];
    const sideB = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      // 横担和两条缆绳垂直于线路方向
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const dl = Math.hypot(dx, dz) || 1;
      const px = -dz / dl;
      const pz = dx / dl;
      if (!p.terminal) {
        const rot = Math.atan2(-pz, px); // 让横担（局部 x 轴）对齐垂直方向 (px, pz)
        pb.add(box(0.7, 11, 0.7, p.x, p.y + 5.5, p.z), '#59606e', { anchorZ: p.z, bury: 13 });
        pb.add(box(6.2, 0.5, 0.5, p.x, p.y + 11, p.z, rot), '#59606e', { anchorZ: p.z, bury: 13 });
      }
      sideA.push(new THREE.Vector3(p.x + px * 2.8, p.top - 0.2, p.z + pz * 2.8));
      sideB.push(new THREE.Vector3(p.x - px * 2.8, p.top - 0.2, p.z - pz * 2.8));
    }
    for (const line of [sideA, sideB]) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        const dir = b.clone().sub(a);
        const cable = new THREE.CylinderGeometry(0.07, 0.07, dir.length(), 4);
        cable.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(yAxis, dir.clone().normalize()));
        cable.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        pb.add(cable, '#3a3f4a', { anchorZ: Math.min(a.z, b.z) + 10, bury: 16 });
      }
    }
    // 环线：A 侧从山顶往终点走，B 侧从终点往回走
    this.cables = { down: sideA, up: sideB.slice().reverse() };
  }

  _buildTrees(w, rng) {
    const trees = [];
    const hw = w.halfWidth;
    const add = (x, z) => {
      const s = 0.85 + rng() * 0.75;
      trees.push({ x, y: w.rawHeight(x, z) - 0.2, z, s, rot: rng() * 6.28, bury: 7.5 });
    };
    const lift = (x) => Math.abs(x - 19) < 10; // 避开缆车线
    // 两侧雪山上不放树（设计文档 6.4），只放在起点站后面的山坡上
    for (let i = 0; i < 260; i++) {
      const x = (rng() * 2 - 1) * (hw - 40);
      const z = w.zMin + 10 + rng() * (w.station.z - 60 - w.zMin);
      if (lift(x)) continue;
      add(x, z);
    }
    // 两座滑雪站周围（前方留出空地）
    for (const [st, facing] of [
      [w.station, 1],
      [w.finishStation, -1],
    ]) {
      for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        const r = 34 + rng() * 22;
        const x = st.x + Math.cos(a) * r;
        const z = st.z + Math.sin(a) * r * 0.8;
        if ((z - st.z) * facing > 12 && Math.abs(x) < 40) continue;
        if (lift(x)) continue;
        add(x, z);
      }
    }
    // 终点后面的山谷
    const fz = w.finishStation.z;
    for (let i = 0; i < 180; i++) {
      const x = (rng() * 2 - 1) * (hw - 40);
      const z = fz + 40 + rng() * (w.zMax - fz - 60);
      if (Math.abs(x) < 60 && z < fz + 70) continue;
      add(x, z);
    }
    this.group.add(makeInstanced(pineGeometry(), this.treeMat, trees));

    const rocks = [];
    for (let z = w.zMin; z < w.zMax; z += 18 + rng() * 20) {
      for (const side of [-1, 1]) {
        const x = side * (hw - 30 + rng() * 120);
        const s = 1.5 + rng() * rng() * 6;
        rocks.push({ x, y: w.rawHeight(x, z) - s * 0.3, z, s, sy: 0.6 + rng() * 0.6, rot: rng() * 6.28, bury: 2.5 });
      }
    }
    this.group.add(makeInstanced(new THREE.IcosahedronGeometry(1, 0), this.rockMat, rocks));
  }

  _buildBackground(w, rng) {
    // 山的范围不能盖到可跑区域和滑雪站上方，否则从下面会看到山体
    const parts = [];
    const place = (x, z, height, radius, baseY, refZ) => {
      const dist = Math.abs(z - refZ);
      const g = mountainGeometry(rng, radius, height, dist);
      g.rotateY(rng() * 6.28);
      g.translate(x, baseY, z);
      parts.push(g);
    };
    // 起点站身后：一整排越远越高的雪山，山顶伸进云海
    for (let i = 0; i < 26; i++) {
      const height = 1500 + rng() * 1300;
      const radius = height * (0.38 + rng() * 0.1);
      const z = w.zMin - 250 - radius - rng() * 1800;
      const x = (rng() * 2 - 1) * (1800 + -z * 0.5);
      place(x, z, height, radius, 200, w.station.z);
    }
    // 终点后面：一排矮一些的雪山，挡住地平线
    const endY = w.baseHeight(w.zMax);
    for (let i = 0; i < 18; i++) {
      const height = 700 + rng() * 700;
      const radius = height * (0.45 + rng() * 0.1);
      const z = w.zMax + 250 + radius + rng() * 1400;
      const x = (rng() * 2 - 1) * (1600 + (z - w.zMax) * 0.5);
      place(x, z, height, radius, endY - 80, w.finishStation.z);
    }
    // 两侧远处也有山，让整片雪原看起来是在山谷里
    for (let z = -200; z < w.zMax + 800; z += 520) {
      for (const side of [-1, 1]) {
        const height = 900 + rng() * 700;
        const radius = height * 0.42;
        place(side * (w.xLimit + 150 + radius + rng() * 500), z + rng() * 200, height, radius, w.baseHeight(Math.max(z, 0)) + 150, z);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(parts), this.bgMat));

    // 云：起点身后的云海遮住山顶；终点远处也有一层
    const clouds = [];
    for (let i = 0; i < 46; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(260 + rng() * 260, 45 + rng() * 40, 160 + rng() * 160);
      g.translate((rng() * 2 - 1) * 3200, 1150 + rng() * 380, -650 - rng() * 2600);
      clouds.push(g);
    }
    for (let i = 0; i < 24; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(240 + rng() * 240, 40 + rng() * 35, 150 + rng() * 150);
      g.translate((rng() * 2 - 1) * 2800, endY + 620 + rng() * 260, w.zMax + 700 + rng() * 2000);
      clouds.push(g);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(clouds), this.cloudMat));
  }

  _buildFinishLine(w) {
    const z = w.finishS;
    const y = w.rawHeight(0, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.9, 6, 24),
      new THREE.MeshStandardMaterial({ color: '#7ff0ff', emissive: '#3fd8ff', emissiveIntensity: 1.5, flatShading: true }),
    );
    ring.position.set(0, y + 11, z);
    this.portal = ring;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(10.2, 24),
      new THREE.MeshBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.position.copy(ring.position);
    // 光柱：从很远就能看到
    const beam = new THREE.Mesh(
      // 细一点、淡一点，不挡住后面的终点站
      new THREE.CylinderGeometry(2.2, 2.2, 900, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#bff3ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.set(0, y + 450, z);
    this.group.add(ring, disc, beam);

    // 终点线：横跨整个宽度的一排旗杆
    const pb = new PropBuilder();
    for (let x = -w.halfWidth + 40; x <= w.halfWidth - 40; x += 18) {
      const gy = w.rawHeight(x, z);
      const red = Math.round(x / 18) % 2 === 0;
      pb.add(box(0.25, 5, 0.25, x, gy + 2.5, z), '#d9dde6', { anchorZ: z, bury: 6 });
      pb.add(box(2, 1.2, 0.1, x + 1, gy + 4.4, z), red ? '#d9483b' : '#ffffff', { anchorZ: z, bury: 6 });
    }
    this.group.add(pb.build(this.propMat));
  }

  update(time) {
    if (this.portal) this.portal.rotation.z = time * 0.6;
  }
}

// 滑雪站的位置和地面高度
function w0(world, st, y) {
  return { x: st.x, z: st.z, y: y ?? world.rawHeight(st.x, st.z) };
}
