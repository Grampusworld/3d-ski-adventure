// 障碍物的外观（设计文档 6.4）：雪松、石头、插在雪里的滑雪板、鹿、狐狸、山羊（小木屋见 sled.js）。
// 每种用一个实例化网格；位置和碰撞数据来自 world.obstacles。被撞飞的滑雪板在这里做飞出去的动画。
// 雪崩经过时和其他物件一样沉到雪下面（bury.js）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchBuryMaterial } from './bury.js';
import { pineGeometry } from './scenery.js';

// 给一块几何体上色，并去掉合并时不需要的属性
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

// 一副插在雪里的滑雪板：两块交叉，颜色由实例颜色决定（这里用白色打底）
function skisGeometry() {
  const parts = [];
  for (const a of [-0.22, 0.22]) {
    const g = new THREE.BoxGeometry(0.12, 1.8, 0.035);
    g.translate(0, 0.6, 0);
    g.rotateZ(a);
    parts.push(part(g, '#ffffff'));
  }
  return merged(parts);
}

// 四条腿的小动物：body = [宽, 高, 长]，腿长 legH，脖子/头往 +Z
function quadruped({ body, legH, color, belly, head, neck, extras = [] }) {
  const [bw, bh, bl] = body;
  const y = legH + bh / 2;
  const parts = [part(box(bw, bh, bl, 0, y, 0), color)];
  if (belly) parts.push(part(box(bw * 0.9, bh * 0.3, bl * 0.8, 0, legH + bh * 0.15, 0), belly));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(box(bw * 0.24, legH, bw * 0.24, sx * bw * 0.32, legH / 2, sz * bl * 0.38), color));
  if (neck) parts.push(part(box(neck[0], neck[1], neck[0], 0, y + neck[1] / 2, bl / 2 - neck[0] / 2), color));
  const hy = y + (neck ? neck[1] : bh * 0.3);
  parts.push(part(box(head[0], head[1], head[2], 0, hy, bl / 2 + head[2] / 2 - (neck ? neck[0] : 0)), color));
  for (const [geo, c] of extras) parts.push(part(geo, c));
  return merged(parts);
}

function deerGeometry() {
  const antler = (side) => {
    const g = [];
    const a = new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(0, 0.22, 0);
    a.rotateZ(side * 0.4);
    a.translate(side * 0.08, 1.95, 0.6);
    g.push(a);
    const b = new THREE.BoxGeometry(0.04, 0.25, 0.04).translate(0, 0.12, 0);
    b.rotateZ(-side * 0.5);
    b.translate(side * 0.2, 2.1, 0.62);
    g.push(b);
    return g.map((x) => [x, '#5a4232']);
  };
  return quadruped({
    body: [0.42, 0.55, 1.25],
    legH: 0.85,
    color: '#9a6a45',
    belly: '#e8dcc8',
    neck: [0.22, 0.55],
    head: [0.24, 0.26, 0.42],
    extras: [...antler(-1), ...antler(1), [box(0.14, 0.14, 0.1, 0, 1.3, -0.66), '#f5efe6']],
  });
}

function goatGeometry() {
  const horn = (side) => {
    const g = new THREE.ConeGeometry(0.05, 0.3, 5).translate(0, 0.15, 0);
    g.rotateX(-0.9);
    g.translate(side * 0.08, 1.28, 0.45);
    return [g, '#7a6a58'];
  };
  return quadruped({
    body: [0.38, 0.42, 0.8],
    legH: 0.5,
    color: '#ece8df',
    neck: [0.18, 0.3],
    head: [0.2, 0.22, 0.32],
    extras: [horn(-1), horn(1), [box(0.06, 0.16, 0.06, 0, 0.96, 0.62), '#d8d2c6']],
  });
}

function foxGeometry() {
  const ear = (side) => [new THREE.ConeGeometry(0.06, 0.14, 4).translate(side * 0.08, 0.6, 0.42), '#c2621f'];
  const tail = new THREE.ConeGeometry(0.11, 0.55, 6);
  tail.rotateX(-Math.PI / 2 - 0.5);
  tail.translate(0, 0.42, -0.55);
  const tip = new THREE.ConeGeometry(0.06, 0.16, 6);
  tip.rotateX(-Math.PI / 2 - 0.5);
  tip.translate(0, 0.53, -0.78);
  const snout = new THREE.ConeGeometry(0.07, 0.2, 5);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, 0.47, 0.62);
  return quadruped({
    body: [0.24, 0.24, 0.62],
    legH: 0.24,
    color: '#d9772f',
    belly: '#f6efe6',
    head: [0.2, 0.18, 0.24],
    extras: [ear(-1), ear(1), [tail, '#d9772f'], [tip, '#f6efe6'], [snout, '#d9772f']],
  });
}

// 每种障碍物：几何体，以及被雪埋时往下沉多少（物件自己的坐标单位）
const KINDS = {
  tree: { geo: pineGeometry, bury: 7.5 },
  rock: { geo: () => new THREE.IcosahedronGeometry(1, 0), bury: 2.5, color: '#8f9ab0' },
  skis: { geo: skisGeometry, bury: 2.5 },
  deer: { geo: deerGeometry, bury: 3 },
  goat: { geo: goatGeometry, bury: 2 },
  fox: { geo: foxGeometry, bury: 1.2 },
};
const SKI_COLORS = ['#d9483b', '#2f7fc1', '#f2b134', '#3aa66b', '#7b4fc0'];
const KNOCK_TIME = 0.8;

export class ObstacleView {
  constructor(scene) {
    this.scene = scene;
    this.meshes = {};
    this.knocks = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  setWorld(world) {
    for (const m of Object.values(this.meshes)) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = {};
    this.world = world;
    const groups = {};
    for (const o of world.obstacles) if (!o.noView) (groups[o.kind] ||= []).push(o); // 缆车塔架由 scenery.js 画，小木屋由 sled.js 画
    for (const [kind, list] of Object.entries(groups)) {
      const def = KINDS[kind];
      const geo = def.geo();
      const mat = patchBuryMaterial(
        def.color ? new THREE.MeshLambertMaterial({ color: def.color, flatShading: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const anchor = new Float32Array(list.length);
      const bury = new Float32Array(list.length).fill(def.bury);
      list.forEach((o, i) => {
        o.view = { kind, index: i };
        anchor[i] = o.z;
        if (kind === 'skis') mesh.setColorAt(i, new THREE.Color(SKI_COLORS[o.id % SKI_COLORS.length]));
      });
      geo.setAttribute('aAnchorZ', new THREE.InstancedBufferAttribute(anchor, 1));
      geo.setAttribute('aBury', new THREE.InstancedBufferAttribute(bury, 1));
      this.meshes[kind] = mesh;
      this.scene.add(mesh);
    }
    this.reset();
  }

  // 新的一局：所有障碍物回到原位（被撞飞的滑雪板重新插好）
  reset() {
    this.knocks = [];
    for (const o of this.world.obstacles) {
      o.knocked = false;
      o.knockYaw = undefined;
      if (!o.noView) this._place(o, 0, 0, 0, 0);
    }
    for (const m of Object.values(this.meshes)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _place(o, offX, offY, offZ, tilt) {
    const mesh = this.meshes[o.kind];
    // 翻倒的方向：滑雪板绕自己的轴倒；大东西朝被撞飞的方向倒
    this._e.set(tilt, o.knockYaw ?? o.rot, 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(o.x + offX, o.y + offY - (o.kind === 'rock' ? o.s * o.sy * 0.3 : 0.05), o.z + offZ);
    this._s.set(o.s, o.s * o.sy, o.s);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(o.view.index, this._m);
  }

  // 被撞飞的障碍物：沿撞击方向飞出去、翻倒，落在雪地上。
  // 滑雪板飞得近；树和石头只有坐雪橇车无敌时才撞得飞（设计文档 3.8），飞得更远更高
  knock(o, dirX, dirZ, speed) {
    const big = o.big;
    if (big) o.knockYaw = Math.atan2(dirX, dirZ);
    this.knocks.push({ o, dirX, dirZ, v: big ? Math.min(40, 10 + speed * 0.3) : Math.min(18, 4 + speed * 0.3), up: big ? 5 : 1.2, t: 0 });
  }

  update(dt) {
    if (!this.knocks.length) return;
    for (const k of this.knocks) {
      k.t = Math.min(KNOCK_TIME, k.t + dt);
      const f = k.t / KNOCK_TIME;
      const dist = k.v * k.t * (1 - f * 0.5);
      const up = Math.sin(Math.PI * f) * k.up;
      this._place(k.o, k.dirX * dist, up, k.dirZ * dist, f * 1.45);
      this.meshes[k.o.kind].instanceMatrix.needsUpdate = true;
    }
    this.knocks = this.knocks.filter((k) => k.t < KNOCK_TIME);
  }
}
