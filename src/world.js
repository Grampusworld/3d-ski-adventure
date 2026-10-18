// 开放雪原（设计文档第 6 节）。
// 坐标约定：前进方向是 +Z（整体下坡），X 是横向；起点在原点附近，滑雪站在起点后方（-Z，上坡方向）。
// 地面高度是解析函数：整体下坡 + 噪声起伏 + 两侧雪山 + 地形特征，起点和滑雪站附近压平。
// 物理和网格用的是同一个函数，所以看到的和踩到的一致。

import { mulberry32, smoothstep, clamp, lerp, DEG } from './math.js';
import { createNoise2D } from './noise.js';

export const FEATURE_NAMES = {
  kicker: '跳台',
  mesa: '悬崖落差',
  moguls: '雪包群',
  bowl: '大碗',
  ridge: '山脊',
};

const BUCKET = 50; // 按 z 方向每 50 米分桶，查询时只看附近的地形特征
const ROW_SPACING = 180;
const FIRST_ROW = 170;

export class World {
  constructor(P) {
    this.P = P;
    const rng = mulberry32(P.seed);
    this.noiseA = createNoise2D(rng);
    this.noiseB = createNoise2D(rng);

    this.halfWidth = P.mapWidth / 2;
    this.slope = Math.tan(P.slopeDeg * DEG);
    this.startS = 0;
    this.finishS = P.mapLength;
    this.zMin = -460; // 滑雪站后面的山坡一直延伸到这里
    this.zMax = this.finishS + 700; // 终点后面还有一片山谷（设计文档 6.1）
    this.totalLength = this.zMax;
    this.xLimit = this.halfWidth + 170;
    this.station = { x: 0, z: -34 }; // 起点滑雪站木屋的中心
    this.finishStation = { x: 0, z: this.finishS + 70 }; // 终点站木屋的中心
    this.finishFlatY = this.baseHeight(this.finishStation.z); // 终点站平地的高度

    // 先定雪橇车小木屋的位置（只避开缆车线），地形特征再避开小木屋（设计文档 3.8）
    this.liftWay = liftWaypoints(this);
    this.hutSpots = planHuts(this, mulberry32(P.seed * 17 + 3));
    this.features = buildFeatures(this, rng);
    this.buckets = [];
    for (const f of this.features) {
      const b0 = Math.floor((f.zMin - this.zMin) / BUCKET);
      const b1 = Math.floor((f.zMax - this.zMin) / BUCKET);
      for (let b = b0; b <= b1; b++) (this.buckets[b] ||= []).push(f);
    }

    this.liftPath = buildLiftPath(this);
    // 障碍物用单独的随机数，改障碍物不会影响地形
    this.huts = [];
    this.obstacles = buildObstacles(this, mulberry32(P.seed * 31 + 5));
    this.obBuckets = [];
    for (const o of this.obstacles) (this.obBuckets[Math.floor((o.z - this.zMin) / BUCKET)] ||= []).push(o);
  }

  // 附近的障碍物（前后各多看一个桶，障碍物都比桶小得多）
  obstaclesNear(z) {
    const b = Math.floor((z - this.zMin) / BUCKET);
    const out = [];
    for (let k = b - 1; k <= b + 1; k++) if (this.obBuckets[k]) out.push(...this.obBuckets[k]);
    return out;
  }

  // 是否离缆车线很近（到折线各段的最短距离）
  nearLift(x, z, margin) {
    const way = this.liftWay;
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i];
      const b = way[i + 1];
      if (z < Math.min(a.z, b.z) - margin || z > Math.max(a.z, b.z) + margin) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < margin) return true;
    }
    return false;
  }

  // 是否在某个地形特征的范围内（含外扩 margin）
  nearFeature(x, z, margin) {
    for (const f of this.features) {
      if (z > f.zMin - margin && z < f.zMax + margin && Math.abs(x - f.x) < f.rx + margin) return true;
    }
    return false;
  }

  // 整体坡度：起点往前一路下坡；起点往后是越来越陡的上坡，连到身后的山脉
  // （不能太高，否则会挡住后面高耸入云的远山）；过了终点 80 米内坡度逐渐放缓，变成平缓的山谷
  baseHeight(z) {
    const s = this.slope;
    if (z < 0) return -s * z + 0.0009 * z * z;
    const F = this.finishS;
    if (z <= F) return -s * z;
    const VALLEY = 0.03;
    const d = Math.min(z - F, 80);
    const h = -s * F - (s * d + ((VALLEY - s) * d * d) / 160);
    return z - F <= 80 ? h : h - VALLEY * (z - F - 80);
  }

  rolling(x, z) {
    const a = this.noiseA;
    return (7 * a(x / 170, z / 170) + 2.6 * a(x / 60 + 31.7, z / 60 - 12.3) + 0.7 * a(x / 19 - 7.1, z / 19 + 5.3)) * this.P.noiseScale;
  }

  // 两侧越来越高、最后变成爬不上去的雪山
  walls(x, z) {
    const u = Math.abs(x) - (this.halfWidth - 50);
    if (u <= 0) return 0;
    return 0.018 * u * u * (1 + 0.35 * this.noiseB(x / 45, z / 45));
  }

  // 起点滑雪站的平地（1 = 完全压平到高度 0）
  platform(x, z) {
    const mx = 1 - smoothstep(32, 58, Math.abs(x));
    const mz = smoothstep(-100, -78, z) * (1 - smoothstep(18, 40, z));
    return mx * mz;
  }

  // 终点站的平地（压平到 finishFlatY）
  finishPlatform(x, z) {
    const fz = this.finishStation.z;
    const mx = 1 - smoothstep(34, 60, Math.abs(x));
    const mz = smoothstep(fz - 45, fz - 25, z) * (1 - smoothstep(fz + 35, fz + 60, z));
    return mx * mz;
  }

  flatten(x, z, h) {
    const m = this.platform(x, z);
    if (m > 0) h = lerp(h, 0, m);
    const f = this.finishPlatform(x, z);
    if (f > 0) h = lerp(h, this.finishFlatY, f);
    return h;
  }

  featureHeight(x, z) {
    const list = this.buckets[Math.floor((z - this.zMin) / BUCKET)];
    if (!list) return 0;
    let h = 0;
    for (const f of list) {
      if (z < f.zMin || z > f.zMax || Math.abs(x - f.x) > f.rx) continue;
      h += f.height(x - f.x, z - f.z);
    }
    return h;
  }

  featureAt(x, z) {
    const list = this.buckets[Math.floor((z - this.zMin) / BUCKET)];
    if (!list) return null;
    for (const f of list) {
      if (z < f.zMin || z > f.zMax || Math.abs(x - f.x) > f.rx) continue;
      if (Math.abs(f.height(x - f.x, z - f.z)) > 0.05) return f;
    }
    return null;
  }

  // 地图范围内任何位置的地面高度（网格生成也用它，不做边界检查）
  rawHeight(x, z) {
    return this.flatten(x, z, this.baseHeight(z) + this.rolling(x, z) + this.walls(x, z) + this.featureHeight(x, z));
  }

  // 雪崩过后的厚雪表面：只保留大尺度的起伏，地形特征和小起伏都被抹平
  smoothHeight(x, z) {
    return this.flatten(x, z, this.baseHeight(z) + 7 * this.noiseA(x / 170, z / 170) * this.P.noiseScale + this.walls(x, z));
  }

  // 返回地面高度；超出地图范围返回 null
  heightAt(x, z) {
    if (z < this.zMin || z > this.zMax || Math.abs(x) > this.xLimit) return null;
    return this.rawHeight(x, z);
  }

  centerAt(s) {
    const z = clamp(s, this.zMin, this.zMax);
    return { x: 0, y: this.rawHeight(0, z) };
  }

  // 地面坡度：每水平前进 1 米，高度变化多少
  gradAt(x, z, out = { gx: 0, gz: 0 }) {
    const e = 0.25;
    if (this.heightAt(x, z) === null) {
      out.gx = 0;
      out.gz = 0;
      return out;
    }
    out.gx = (this.rawHeight(x + e, z) - this.rawHeight(x - e, z)) / (2 * e);
    out.gz = (this.rawHeight(x, z + e) - this.rawHeight(x, z - e)) / (2 * e);
    return out;
  }
}

// ---------- 地形特征（设计文档 6.3） ----------
// 每个特征的 height(dx, dz) 返回相对底层地形的高度差，dz 是前进方向，dx 是横向；
// 在特征范围的边缘平滑地回到 0。

function makeKicker(x, z, level, rng, fs) {
  const H = (3 + 5 * level + 2 * rng()) * fs; // 跳台高度
  const L1 = 14 + 8 * rng(); // 上坡长度
  const L2 = 45; // 落地用的下坡长度
  const B = 11 + 8 * rng(); // 半宽
  return {
    type: 'kicker',
    x,
    z,
    rx: B,
    zMin: z - L1,
    zMax: z + L2,
    height(dx, dz) {
      const lat = 1 - smoothstep(B - 6, B, Math.abs(dx));
      if (lat <= 0 || dz < -L1 || dz > L2) return 0;
      let p;
      if (dz < 0) p = H * Math.pow((dz + L1) / L1, 1.6); // 越往上越陡
      else if (dz < 2.5) p = H - 0.7 * H * smoothstep(0, 2.5, dz); // 坡顶突然截断
      else p = 0.3 * H * (1 - smoothstep(2.5, L2, dz)); // 后面接下坡
      return p * lat;
    },
  };
}

// 悬崖落差：一段几乎水平的台地（周围在下坡，所以它越往前越高出周围），前端突然下降，下面接下坡。
// 先定悬崖高度，再按坡度算台地要多长，这样坡度变陡时悬崖不会高得离谱
function makeMesa(x, z, level, rng, fs, slope) {
  const Hc = (12 + 15 * level + 3 * rng()) * fs;
  const rise = slope + 0.03;
  const Lm = Hc / rise;
  const L2 = 70;
  const B = 26 + 18 * rng();
  return {
    type: 'mesa',
    x,
    z,
    rx: B,
    zMin: z - Lm,
    zMax: z + L2,
    height(dx, dz) {
      const lat = 1 - smoothstep(B - 20, B, Math.abs(dx));
      if (lat <= 0 || dz < -Lm || dz > L2) return 0;
      let p;
      if (dz < 0) p = (dz + Lm) * rise * smoothstep(-Lm, -Lm + 20, dz);
      else if (dz < 3) p = Hc - 0.6 * Hc * smoothstep(0, 3, dz);
      else p = 0.4 * Hc * (1 - smoothstep(3, L2, dz));
      return p * lat;
    },
  };
}

function makeMoguls(x, z, level, rng, fs) {
  const A = (2 + 3 * level + rng()) * fs; // 雪包高度
  const lam = 24 + 10 * rng(); // 间距
  const n = 4 + Math.floor(rng() * 3);
  const len = n * lam;
  const B = 30 + 15 * rng();
  return {
    type: 'moguls',
    x,
    z,
    rx: B,
    zMin: z - len / 2 - 6,
    zMax: z + len / 2 + 6,
    height(dx, dz) {
      const lat = 1 - smoothstep(B - 10, B, Math.abs(dx));
      const a = dz + len / 2 + 4 * Math.sin(dx / 23);
      if (lat <= 0 || a < 0 || a > len) return 0;
      return (A * (1 - Math.cos((2 * Math.PI * a) / lam))) / 2 * lat;
    },
  };
}

// 大碗：一个凹坑，前方坑沿带一道小唇，冲出去能起飞
function makeBowl(x, z, level, rng, fs) {
  const R = 34 + 22 * level + 8 * rng();
  const D = (8 + 9 * level) * fs;
  const rim = 0.45 * D;
  const reach = 1.35 * R;
  return {
    type: 'bowl',
    x,
    z,
    rx: reach,
    zMin: z - reach,
    zMax: z + reach,
    height(dx, dz) {
      const r = Math.hypot(dx, dz) / R;
      if (r > 1.35) return 0;
      let p = r < 1 ? (-D * (1 + Math.cos(Math.PI * r))) / 2 : 0;
      if (dz > 0) p += rim * Math.exp(-(((r - 1) / 0.16) ** 2)) * smoothstep(0, R * 0.6, dz);
      return p;
    },
  };
}

// 山脊：一道横着或斜着的长脊，迎面缓、背面陡
function makeRidge(x, z, level, rng, fs) {
  const H = (5 + 7 * level + 2 * rng()) * fs;
  const ang = (rng() * 2 - 1) * 40 * DEG;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const Lr = 90 + 70 * rng();
  const W1 = 26;
  const reach = Lr / 2 + 45;
  return {
    type: 'ridge',
    x,
    z,
    rx: reach,
    zMin: z - reach,
    zMax: z + reach,
    height(dx, dz) {
      const along = dx * c + dz * s;
      const across = -dx * s + dz * c; // 正数 = 脊的前方（下坡方向）
      const lat = 1 - smoothstep(Lr / 2 - 18, Lr / 2, Math.abs(along));
      if (lat <= 0 || across < -W1 || across > 42) return 0;
      let p;
      if (across < 0) p = H * smoothstep(-W1, 0, across);
      else if (across < 4) p = H - 0.65 * H * smoothstep(0, 4, across);
      else p = 0.35 * H * (1 - smoothstep(4, 42, across));
      return p * lat;
    },
  };
}

// ---------- 障碍物（设计文档 3.4、6.4） ----------
// 每个障碍物记录位置、朝向、碰撞形状（圆或旋转的方块）和高度；big = 实心的大东西。

// 雪橇车小木屋（设计文档 3.8）：门（入口）在木屋自己的 +Z 面，朝上坡；出口在 -Z 面，朝下坡。
// hx/hz 是碰撞方块的半宽/半深，ring 是门前圆环中心离木屋中心多远、半径多大
export const HUT = { hx: 7.8, hz: 6.3, h: 16, ringDist: 11.5, ringR: 4, count: 4 };

// 木屋局部坐标 (lx, lz) → 世界坐标（和 three.js 绕 Y 轴旋转 rot 一致）
export function hutToWorld(hut, lx, lz) {
  const c = Math.cos(hut.rot);
  const s = Math.sin(hut.rot);
  return { x: hut.x + lx * c + lz * s, z: hut.z - lx * s + lz * c };
}

// 所有障碍物在原来的基础上放大到 1.5 倍（scale 里已经乘上），碰撞范围跟着放大
const OB_SCALE = 1.5;
const OBSTACLE_SHAPES = {
  tree: (s) => ({ r: 1.2 * s, h: 6.5 * s, big: true }),
  rock: (s, sy) => ({ r: 1.0 * s, h: 1.3 * s * sy, big: true }),
  // 小木屋改成雪橇车增益（设计文档 3.8）：两倍大，外观由 sled.js 画
  hut: () => ({ hx: HUT.hx, hz: HUT.hz, h: HUT.h, big: true, noView: true }),
  skis: (s) => ({ r: 0.5 * s, h: 1.8 * s, big: false }),
  // 动物暂时不放（设计文档 3.4），形状保留
  deer: (s) => ({ r: 0.9 * s, h: 1.9 * s, big: true }),
  goat: (s) => ({ r: 0.7 * s, h: 1.2 * s, big: true }),
  fox: (s) => ({ r: 0.45 * s, h: 0.6 * s, big: true }),
  tower: () => ({ r: 0.8, h: 12, big: true, noView: true }), // 缆车塔架，外观由 scenery.js 画
};

function buildObstacles(world, rng) {
  const list = [];
  const hw = world.halfWidth;
  const add = (kind, x, z, extra = {}) => {
    if (Math.abs(x) > hw - 40) return;
    const s = (extra.s ?? 1) * OB_SCALE;
    const sy = extra.sy ?? 1;
    list.push({
      id: list.length,
      kind,
      x,
      z,
      y: world.rawHeight(x, z),
      rot: extra.rot ?? rng() * Math.PI * 2,
      s,
      sy,
      knocked: false,
      ...OBSTACLE_SHAPES[kind](s, sy),
    });
  };
  const near = (cx, cz, r) => [cx + (rng() * 2 - 1) * r, cz + (rng() * 2 - 1) * r];

  // 雪橇车小木屋（位置在 planHuts 里定好了）
  world.hutSpots.forEach((spot, k) => {
    const hut = {
      id: list.length,
      kind: 'hut',
      x: spot.x,
      z: spot.z,
      y: world.rawHeight(spot.x, spot.z),
      rot: spot.rot,
      s: 1,
      sy: 1,
      knocked: false,
      index: k,
      ...OBSTACLE_SHAPES.hut(),
    };
    list.push(hut);
    world.huts.push(hut);
    // 两侧插几副滑雪板当装饰（不挡门前的圆环和屋后的跑道）
    for (const sd of [-1, 1]) {
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const w = hutToWorld(hut, sd * (HUT.hx + 2.5 + i * 1.6), (rng() * 2 - 1) * 4);
        add('skis', w.x, w.z);
      }
    }
  });
  // 小木屋前方 70 米留空，远远就能看到木屋和光柱；屋后留出冲出去的跑道
  const nearHut = (x, z) => world.huts.some((h) => Math.abs(x - h.x) < 32 && z > h.z - 75 && z < h.z + 90);

  const clusters = {
    // 5～10 棵树组成的小树林
    grove(cx, cz) {
      const n = 5 + Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) add('tree', ...near(cx, cz, 15), { s: 0.8 + rng() * 0.6 });
    },
    rocks(cx, cz) {
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) add('rock', ...near(cx, cz, 10), { s: 1.1 + rng() * 1.6, sy: 0.6 + rng() * 0.5 });
    },
    // 一排插在雪里的滑雪板
    skis(cx, cz) {
      const n = 4 + Math.floor(rng() * 4);
      const rot = rng() * Math.PI;
      for (let i = 0; i < n; i++) add('skis', cx + Math.cos(rot) * i * 3.2, cz - Math.sin(rot) * i * 3.2, { rot });
    },
    // 动物暂时不放（设计文档 3.4）
    animals(cx, cz) {
      const r = rng();
      if (r < 0.4) {
        const n = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) add('deer', ...near(cx, cz, 6));
      } else if (r < 0.75) {
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) add('goat', ...near(cx, cz, 6));
        add('rock', ...near(cx, cz, 5), { s: 1.2 + rng(), sy: 0.7 });
      } else {
        add('fox', cx, cz);
      }
    },
  };
  const weights = [
    ['grove', 0.42],
    ['rocks', 0.32],
    ['skis', 0.26],
  ];
  const pick = () => {
    let r = rng();
    for (const [k, w] of weights) if ((r -= w) <= 0) return k;
    return 'grove';
  };

  // 沿前进方向每 12 米一条，按期望数量放几小片，越往后越密；避开起点、地形特征、缆车线和终点
  for (let z = 120; z < world.finishS - 90; z += 12) {
    const level = z / world.finishS;
    const expected = 0.5 + 1.1 * level; // 每 12 米平均几片
    const n = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = (rng() * 2 - 1) * (hw - 60);
      const cz = z + rng() * 12;
      if (world.nearFeature(x, cz, 16) || world.nearLift(x, cz, 20) || nearHut(x, cz)) continue;
      clusters[pick()](x, cz);
    }
  }

  // 缆车塔架：可跑区域里的塔架有碰撞
  for (const t of world.liftPath) {
    if (t.terminal || t.z < 0 || t.z > world.finishS) continue;
    list.push({ id: list.length, kind: 'tower', x: t.x, z: t.z, y: t.y, rot: 0, s: 1, sy: 1, knocked: false, ...OBSTACLE_SHAPES.tower() });
  }
  return list;
}

// ---------- 缆车线（设计文档 6.1、8.6） ----------
// 从山顶经过起点站，然后在整个场地里左右来回折返（Z 字形），最后进到终点站。
// 返回按顺序排列的塔架点（含两端和起点站的站台），每个点带地面高度 y 和缆绳高度 top。

const TOWER_SPACING = 55;
const TOWER_H = 11;
const ZIGZAG_LEGS = 12; // 起点到终点之间折返几段
const ZIGZAG_X = 160; // 折返点离中线多远（左右各一）

function liftWaypoints(world) {
  const lx = 19; // 两个滑雪站的缆车站台都在木屋右侧 19 米
  const st = world.station;
  const fs = world.finishStation;
  const way = [
    { x: lx, z: world.zMin + 15 }, // 山顶
    { x: lx, z: st.z + 2, terminal: true }, // 起点站台
  ];
  const z0 = 140;
  const z1 = world.finishS - 120;
  const amp = Math.min(ZIGZAG_X, world.halfWidth - 70);
  for (let k = 0; k < ZIGZAG_LEGS; k++) {
    way.push({ x: k % 2 === 0 ? amp : -amp, z: z0 + ((z1 - z0) * k) / (ZIGZAG_LEGS - 1) });
  }
  way.push({ x: lx, z: fs.z - 2, terminal: true }); // 终点站台
  return way;
}

function buildLiftPath(world) {
  const way = world.liftWay;
  const pts = [];
  for (let i = 0; i < way.length - 1; i++) {
    const a = way[i];
    const b = way[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / TOWER_SPACING));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const p = { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), terminal: (k === 0 && a.terminal) || (k === n && b.terminal) };
      p.y = world.rawHeight(p.x, p.z);
      p.top = p.y + (p.terminal ? 7 : TOWER_H);
      pts.push(p);
    }
  }
  return pts;
}

// 雪橇车小木屋的位置：全图 4 间，均匀分布在 600、1200、1800、2400 米附近（前后最多挪 40 米），
// 左右交替，离中线 60～120 米；门前的圆环和屋后冲出去的跑道不能压到缆车线
function planHuts(world, rng) {
  const spots = [];
  for (let k = 0; k < HUT.count; k++) {
    const z0 = (world.finishS * (k + 1)) / (HUT.count + 1);
    const side = k % 2 === 0 ? -1 : 1;
    let spot = null;
    for (let tries = 0; tries < 400 && !spot; tries++) {
      const sd = tries < 200 ? side : -side; // 这一侧实在放不下就换另一侧
      const x = sd * (60 + rng() * 60);
      const z = z0 + (rng() * 2 - 1) * 40;
      if (![-24, -8, 10, 35, 70].some((dz) => world.nearLift(x, z + dz, 24))) spot = { x, z };
    }
    spot ||= { x: side * 90, z: z0 };
    spot.rot = Math.PI + (rng() * 2 - 1) * 0.15; // 门朝上坡，只做小幅随机转动
    spots.push(spot);
  }
  return spots;
}

// 地形特征是否压到小木屋的范围（门前圆环到屋后跑道）
function hitsHut(world, f) {
  return world.hutSpots.some((h) => f.zMax > h.z - 30 && f.zMin < h.z + 80 && Math.abs(f.x - h.x) < f.rx + 26);
}

const MAKERS = { kicker: makeKicker, mesa: makeMesa, moguls: makeMoguls, bowl: makeBowl, ridge: makeRidge };

// 每往前约 180 米放一排，每排 2～4 个特征，横向位置随机；越往后越大（设计文档 6.2）
function buildFeatures(world, rng) {
  const P = world.P;
  const hw = world.halfWidth;
  const features = [];
  const types = Object.keys(MAKERS);
  for (let rowZ = FIRST_ROW; rowZ < world.finishS - 120; rowZ += ROW_SPACING) {
    const level = clamp(rowZ / world.finishS, 0, 1);
    const count = clamp(Math.round(P.featuresPerRow + (rng() * 2 - 1)), 1, 5);
    const usable = (hw - 80) * 2;
    const slot = usable / count;
    const order = types.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < count; i++) {
      const x = -hw + 80 + slot * (i + 0.5) + (rng() - 0.5) * slot * 0.5;
      const z = rowZ + (rng() - 0.5) * 50;
      const type = order[i % order.length];
      const f = MAKERS[type](x, z, level, rng, P.featureScale, world.slope);
      f.name = FEATURE_NAMES[type];
      if (!hitsHut(world, f)) features.push(f); // 先生成再丢掉，后面的地形不受影响
    }
  }
  return features;
}
