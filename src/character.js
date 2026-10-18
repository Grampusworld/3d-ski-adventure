// 主角：企鹅少女（设计文档 8.4）。全部用代码拼出来，严格按三视图的比例复刻。
// 身体、鳍翅、脚是低多边形平面着色；头和脸是平滑的卡通渲染；头发是带发束棱线的波波头外壳。
// 模型朝向 +Z，脚底在原点，总高约 1.4 米。
// 下面的尺寸都是从三视图上量出来、按总高 1.4 米换算的（单位：米）。

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './math.js';
import { createSledModel } from './sled.js';

// 头骨：上宽下尖的动漫脸，半宽、半高、半深
const HW = 0.19;
const HH = 0.27; // 头心到下巴
const HH_TOP = 0.235; // 头心到头顶（头顶不能太高，否则头发像蘑菇）
const HD = 0.2; // 头心到脸前方，侧面能看到脸往前突出
const HEAD_Y = 1.085; // 头心高度：下巴约在 0.81 米，头发顶端约 1.39 米

const COLORS = {
  body: '#f6ead0',
  flipper: '#2b2523',
  foot: '#ef7a32',
  skin: '#ffe7da',
  hair: '#786f65', // 灰棕色（按三视图取色；场景暖光下渲染后接近参考图）
  glow: '#ff7a3a',
};

// 卡通渲染的明暗分阶
function toonGradient(steps = [110, 190, 255]) {
  const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------- 头型 ----------

// 单位球上的点 → 头骨表面：上半部是圆的，脸颊圆鼓鼓地保持宽度，只在最下面收成一个小圆下巴
// （三视图的脸几乎不收窄：下巴宽度约为脸颊的 60%，是个圆润的小下巴，不是尖锥）
function headShape(x, y, z) {
  const t = Math.max(0, -y);
  const jaw = 1 - 0.4 * smoothstep(0.38, 1, t); // 中段基本不收，最底才收到 60%
  const jawDepth = 1 - 0.2 * smoothstep(0.35, 1, t);
  return new THREE.Vector3(x * HW * jaw, y * (y > 0 ? HH_TOP : HH), z * HD * jawDepth + HD * 0.22 * t * t);
}

function headGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 30);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const v = headShape(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- 脸：画在画布上的贴图 ----------

// 贴图覆盖头部正面 x∈[-HW, HW]、y∈[FACE_Y0, FACE_Y1]（相对头心，米）
const FACE_Y0 = -0.29;
const FACE_Y1 = 0.06;
const PX_PER_M = 3000;

// 五官的位置和大小（相对头心，米），按三视图量出：
// 眼睛大而圆，中心在半张脸宽的约 54% 处，眼宽约为半张脸宽的 60%
const EYE = { x: 0.102, y: -0.128, w: 0.104, h: 0.115 };

function faceCanvas(eyesClosed) {
  const c = document.createElement('canvas');
  c.width = Math.round(2 * HW * PX_PER_M);
  c.height = Math.round((FACE_Y1 - FACE_Y0) * PX_PER_M);
  const ctx = c.getContext('2d');
  const px = (x) => (x + HW) * PX_PER_M;
  const py = (y) => (FACE_Y1 - y) * PX_PER_M;
  const m = (v) => v * PX_PER_M;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 刘海投在额头上的淡淡阴影
  const shade = ctx.createLinearGradient(0, py(-0.02), 0, py(-0.09));
  shade.addColorStop(0, 'rgba(214,150,140,0.55)');
  shade.addColorStop(1, 'rgba(214,150,140,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, c.width, py(-0.09));

  // 腮红：眼睛外下方的柔和椭圆（外淡内浓两层）
  for (const s of [-1, 1]) {
    const cx = px(s * 0.115);
    const cy = py(-0.185);
    for (const [r, a] of [[0.036, 0.42], [0.022, 0.4]]) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, m(r));
      g.addColorStop(0, `rgba(255,122,132,${a})`);
      g.addColorStop(1, 'rgba(255,122,132,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, m(r * 1.05), m(r * 0.55), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const s of [-1, 1]) drawEye(ctx, px(s * EYE.x), py(EYE.y), m(EYE.w), m(EYE.h), s, eyesClosed, m);

  // 鼻子：鼻尖下一小笔阴影
  ctx.strokeStyle = 'rgba(200,130,110,0.7)';
  ctx.lineWidth = m(0.0028);
  ctx.beginPath();
  ctx.moveTo(px(-0.002), py(-0.186));
  ctx.lineTo(px(0.005), py(-0.19));
  ctx.stroke();

  // 小小的微笑
  ctx.strokeStyle = '#a0504c';
  ctx.lineWidth = m(0.0035);
  ctx.beginPath();
  ctx.moveTo(px(-0.014), py(-0.223));
  ctx.quadraticCurveTo(px(0), py(-0.231), px(0.014), py(-0.223));
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 动漫眼（按三视图）：又大又圆，外眼角微微下垂；虹膜几乎占满眼眶、上深下亮的红棕色；
// 上睫毛粗黑、比眼睛宽，外眼角带一个小翅膀；两眼的月光高光都在左上（同侧）。
// s = 1 是画面右边那只眼（外眼角朝右），s = -1 是左边那只。
function drawEye(ctx, cx, cy, ew, eh, s, closed, m) {
  const inner = cx - s * ew * 0.5;
  const outer = cx + s * ew * 0.5;
  const LASH = '#301b16';

  // 眉毛：淡棕细弧线，大部分藏在刘海下面
  ctx.strokeStyle = 'rgba(140,116,100,0.85)';
  ctx.lineWidth = m(0.0032);
  ctx.beginPath();
  ctx.moveTo(cx - s * ew * 0.4, cy - eh * 0.9);
  ctx.quadraticCurveTo(cx + s * ew * 0.02, cy - eh * 1.12, cx + s * ew * 0.5, cy - eh * 0.85);
  ctx.stroke();

  if (closed) {
    // 闭眼：一条往下弯的睫毛线
    ctx.strokeStyle = LASH;
    ctx.lineWidth = eh * 0.09;
    ctx.beginPath();
    ctx.moveTo(inner, cy + eh * 0.02);
    ctx.quadraticCurveTo(cx, cy + eh * 0.3, outer + s * ew * 0.06, cy + eh * 0.05);
    ctx.stroke();
    return;
  }

  // 眼眶形状：上缘近乎水平微拱，下缘圆润，外眼角比内眼角低（下垂感）
  const eyePath = () => {
    ctx.beginPath();
    ctx.moveTo(inner, cy - eh * 0.22);
    ctx.bezierCurveTo(cx - s * ew * 0.28, cy - eh * 0.64, cx + s * ew * 0.3, cy - eh * 0.64, outer, cy - eh * 0.1);
    ctx.bezierCurveTo(outer + s * ew * 0.05, cy + eh * 0.38, cx - s * ew * 0.18, cy + eh * 0.58, inner, cy - eh * 0.22);
    ctx.closePath();
  };

  // 眼白
  eyePath();
  ctx.fillStyle = '#fffdfb';
  ctx.fill();

  ctx.save();
  eyePath();
  ctx.clip();
  // 上眼睑在眼白上压出的阴影
  const shade = ctx.createLinearGradient(0, cy - eh * 0.64, 0, cy - eh * 0.1);
  shade.addColorStop(0, 'rgba(130,95,105,0.4)');
  shade.addColorStop(1, 'rgba(130,95,105,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - ew, cy - eh, ew * 2, eh);
  // 虹膜：高而大，上深下亮的红棕色
  const ix = cx + s * ew * 0.02;
  const iy = cy + eh * 0.08;
  const ir = ctx.createLinearGradient(0, iy - eh * 0.56, 0, iy + eh * 0.56);
  ir.addColorStop(0, '#38120e');
  ir.addColorStop(0.42, '#8a3a28');
  ir.addColorStop(0.75, '#cd7a52');
  ir.addColorStop(1, '#f4bd90');
  ctx.fillStyle = ir;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ew * 0.4, eh * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(45,14,10,0.85)';
  ctx.lineWidth = eh * 0.035;
  ctx.stroke();
  // 瞳孔
  ctx.fillStyle = '#260b09';
  ctx.beginPath();
  ctx.ellipse(ix, iy - eh * 0.03, ew * 0.16, eh * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  // 虹膜下半部的反光弧
  ctx.strokeStyle = 'rgba(255,214,184,0.8)';
  ctx.lineWidth = eh * 0.05;
  ctx.beginPath();
  ctx.ellipse(ix, iy + eh * 0.06, ew * 0.26, eh * 0.38, 0, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  // 高光：左上一大（两眼同侧）+ 右下一点
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ix - ew * 0.18, iy - eh * 0.28, ew * 0.11, eh * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + ew * 0.12, iy + eh * 0.2, ew * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 上睫毛：粗黑带，比眼睛宽，外眼角往外带一个下垂的小翅膀
  ctx.fillStyle = LASH;
  ctx.beginPath();
  ctx.moveTo(inner - s * ew * 0.02, cy - eh * 0.16);
  ctx.bezierCurveTo(cx - s * ew * 0.3, cy - eh * 0.72, cx + s * ew * 0.32, cy - eh * 0.72, outer + s * ew * 0.08, cy - eh * 0.24);
  ctx.lineTo(outer + s * ew * 0.18, cy - eh * 0.02); // 下垂的小翅膀
  ctx.lineTo(outer + s * ew * 0.02, cy - eh * 0.1);
  ctx.bezierCurveTo(cx + s * ew * 0.32, cy - eh * 0.54, cx - s * ew * 0.3, cy - eh * 0.52, inner - s * ew * 0.02, cy - eh * 0.16);
  ctx.closePath();
  ctx.fill();

  // 双眼皮
  ctx.strokeStyle = 'rgba(120,70,60,0.5)';
  ctx.lineWidth = m(0.0022);
  ctx.beginPath();
  ctx.moveTo(cx - s * ew * 0.15, cy - eh * 0.72);
  ctx.quadraticCurveTo(cx + s * ew * 0.2, cy - eh * 0.8, cx + s * ew * 0.48, cy - eh * 0.48);
  ctx.stroke();

  // 下睫毛：外眼角下方短短一笔
  ctx.strokeStyle = 'rgba(90,50,40,0.65)';
  ctx.lineWidth = m(0.0028);
  ctx.beginPath();
  ctx.moveTo(cx + s * ew * 0.15, cy + eh * 0.52);
  ctx.quadraticCurveTo(cx + s * ew * 0.38, cy + eh * 0.44, cx + s * ew * 0.5, cy + eh * 0.18);
  ctx.stroke();
}

// 从头骨网格里取出朝前的三角形，用正面平面投影的 UV 贴脸，从正面看五官不变形
function faceGeometry(head) {
  const src = head.toNonIndexed();
  const p = src.getAttribute('position');
  const n = src.getAttribute('normal');
  const pos = [];
  const uv = [];
  for (let i = 0; i < p.count; i += 3) {
    let front = true;
    for (let k = 0; k < 3; k++) if (p.getZ(i + k) < HD * 0.25) front = false;
    if (!front) continue;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k) + n.getX(i + k) * 0.0008;
      const y = p.getY(i + k) + n.getY(i + k) * 0.0008;
      const z = p.getZ(i + k) + n.getZ(i + k) * 0.0008;
      pos.push(x, y, z);
      uv.push((p.getX(i + k) + HW) / (2 * HW), (p.getY(i + k) - FACE_Y0) / (FACE_Y1 - FACE_Y0));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// 头皮：头骨上除了脸以外的部分，用头发的颜色盖住，
// 这样从发梢下沿往里看时看到的是头发而不是皮肤
function scalpGeometry(head) {
  const src = head.toNonIndexed();
  const p = src.getAttribute('position');
  const pos = [];
  for (let i = 0; i < p.count; i += 3) {
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (cz > HD * 0.3 && cy < 0.0) continue; // 脸
    for (let k = 0; k < 3; k++) pos.push(p.getX(i + k) * 1.01, p.getY(i + k) * 1.01, p.getZ(i + k) * 1.01);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- 头发：银色波波头 ----------

// 一片头发外壳。phi = 0 是正前方，沿经度从头顶往下长：先贴着头骨鼓出来（puff 倍），
// 到头心高度后垂直往下，直到 yEnd（相对头心，米）。
// 每束头发中间往外鼓一点（棱线），发梢中间更长（尖尖的发尾）。
function hairPiece({ phi0, phi1, puff, yEnd, strands = 26, ridge = 0.04, jag = 0.2 }) {
  const V = 18;
  const V_EQ = 0.55;
  const segs = Math.max(4, Math.round(((phi1 - phi0) / (2 * Math.PI)) * strands * 4));
  const pos = [];
  for (let i = 0; i <= segs; i++) {
    const phi = lerp(phi0, phi1, i / segs);
    const k = (phi * strands) / (2 * Math.PI);
    const tri = 1 - Math.abs((k - Math.floor(k)) * 2 - 1); // 每束头发中间为 1，两边为 0
    const p = puff(phi) * (1 + ridge * tri);
    const end = yEnd(phi) * (1 + jag * tri);
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      if (v <= V_EQ) {
        const th = (v / V_EQ) * (Math.PI / 2);
        // 从头顶开始就往外鼓，头顶是圆的
        const r = lerp(1.15, p, smoothstep(0, 0.75, th / (Math.PI / 2)));
        pos.push(HW * r * Math.sin(th) * Math.sin(phi), HH_TOP * 1.15 * Math.cos(th), HD * r * Math.sin(th) * Math.cos(phi));
      } else {
        const w = (v - V_EQ) / (1 - V_EQ);
        const r = p * (1 + 0.04 * Math.sin(Math.PI * w) - 0.1 * w * w * w); // 发尾往里收
        pos.push(HW * r * Math.sin(phi), end * w, HD * r * Math.cos(phi));
      }
    }
  }
  const index = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = (i + 1) * (V + 1) + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const DEG = Math.PI / 180;

function hairGeometries() {
  return [
    // 刘海：一缕缕分开，发梢尖尖、长短不一，到眉毛和眼睛上沿，个别发梢碰到睫毛
    hairPiece({
      phi0: -72 * DEG,
      phi1: 72 * DEG,
      puff: () => 1.1,
      yEnd: () => -0.024,
      strands: 16,
      ridge: 0.08,
      jag: 1.5,
    }),
    // 脸两侧：耳朵前面一缕细发束垂在脸颊外侧到下巴；再往后的头发只盖住耳朵上沿，侧面能看到脸颊和耳朵
    ...[1, -1].map((s) =>
      hairPiece({
        phi0: s > 0 ? 70 * DEG : -100 * DEG,
        phi1: s > 0 ? 100 * DEG : -70 * DEG,
        puff: (phi) => (Math.abs(phi) < 86 * DEG ? 1.25 : 1.15),
        yEnd: (phi) => (Math.abs(phi) < 86 * DEG ? -0.24 : -0.03),
        jag: 0.15,
      }),
    ),
    // 后脑到两侧：蓬松的波波头，两侧最宽，后颈中间最长
    hairPiece({
      phi0: 95 * DEG,
      phi1: 265 * DEG,
      puff: (phi) => 1.4 + 0.2 * Math.abs(Math.sin(phi)),
      yEnd: (phi) => -0.26 - 0.1 * Math.cos(phi) ** 2, // 后发垂到身体上
      jag: 0.15,
    }),
  ];
}

// ---------- 身体 ----------

// 把二十面体捏成圆润的蛋形（肩部也有一定宽度）、前后略扁，得到大块不规则的三角切面
function eggGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + 1) / 2; // 0 底部 → 1 顶部
    const k = 1 - 0.3 * t * t;
    // 顶部前后更薄，让下巴完整露在身体前方
    pos.setXYZ(i, x * 0.33 * k, 0.03 + t * 0.84, z * 0.27 * k * k);
  }
  g.computeVertexNormals();
  return g;
}

// 鳍翅：细长、尖头，中段往外弯，贴着身体侧面垂下
function flipperGeometry(side) {
  const g = new THREE.SphereGeometry(1, 6, 6);
  g.scale(0.035, 0.33, 0.065);
  g.translate(0, -0.32, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(-pos.getY(i) / 0.65, 0, 1);
    pos.setX(i, pos.getX(i) + side * 0.11 * Math.sin(Math.PI * t));
  }
  g.computeVertexNormals();
  return g;
}

const _c = new THREE.Vector3();
const _v = new THREE.Vector3();

const GOLD = new THREE.Color('#ffc93a');

// 金色光晕：中间亮、往外渐渐透明的圆
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,170,0.9)');
  grad.addColorStop(0.45, 'rgba(255,205,70,0.45)');
  grad.addColorStop(1, 'rgba(255,190,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 整个角色 ----------

export class Character {
  constructor() {
    const gradientMap = toonGradient();
    // 身体、鳍翅、脚：卡通明暗加平面着色，切面分明
    this.bodyMat = new THREE.MeshToonMaterial({ color: COLORS.body, gradientMap, flatShading: true, emissive: COLORS.glow, emissiveIntensity: 0 });
    const flipperMat = new THREE.MeshToonMaterial({ color: COLORS.flipper, gradientMap, flatShading: true });
    const footMat = new THREE.MeshToonMaterial({ color: COLORS.foot, gradientMap, flatShading: true });
    // 皮肤几乎均匀受光，避免脸上出现一道明暗分界（三视图的脸就是这样）
    const skinMat = new THREE.MeshToonMaterial({ color: COLORS.skin, gradientMap: toonGradient([238, 250, 255]) });
    const hairMat = new THREE.MeshToonMaterial({ color: COLORS.hair, gradientMap: toonGradient([130, 200, 255]), flatShading: true, side: THREE.DoubleSide });

    // 层级：root（朝向）→ ride（坐雪橇时连同雪橇一起翻转、俯冲）→ tilt（前倾、左右摇摆、趴下）
    // → squash（压扁拉长）→ 各部件
    this.root = new THREE.Group();
    this.ride = new THREE.Group();
    this.tilt = new THREE.Group();
    this.squash = new THREE.Group();
    this.root.add(this.ride);
    this.ride.add(this.tilt);
    this.tilt.add(this.squash);

    // 雪橇车（设计文档 3.8）：平时藏起来
    this.sled = createSledModel(gradientMap);
    this.sled.visible = false;
    this.ride.add(this.sled);

    // 冲出小木屋后无敌时的金光：身上和雪橇车泛金光，周围一圈金色光晕
    this.glowMats = [this.bodyMat, flipperMat, footMat, skinMat, hairMat];
    this.sled.traverse((o) => o.material && this.glowMats.push(o.material)); // 火焰是不受光的材质，没有自发光，会被跳过
    this.flames = this.sled.userData.flames;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: GOLD, transparent: true, depthWrite: false, opacity: 0 }));
    this.halo.position.set(0, 0.95, 0);
    this.halo.scale.set(4.6, 4.6, 1);
    this.halo.visible = false;
    this.root.add(this.halo);
    this.glowW = 0;

    this.body = new THREE.Mesh(eggGeometry(), this.bodyMat);
    this.squash.add(this.body);

    // 鳍翅：枢轴在脖子下方的肩部
    this.flippers = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.15, 0.77, -0.03);
      pivot.add(new THREE.Mesh(flipperGeometry(side), flipperMat));
      pivot.userData.side = side;
      this.squash.add(pivot);
      return pivot;
    });

    // 脚：橙色蹼足，从身体下方往前伸出，枢轴在脚跟
    this.feet = [-1, 1].map((side) => {
      const geo = new THREE.SphereGeometry(1, 6, 3);
      geo.scale(0.1, 0.04, 0.16);
      geo.translate(0, 0, 0.11);
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.15, 0.04, 0.06);
      pivot.rotation.y = side * 0.25;
      pivot.add(new THREE.Mesh(geo, footMat));
      pivot.userData.side = side;
      pivot.userData.baseZ = 0.06;
      pivot.userData.baseX = side * 0.15;
      this.squash.add(pivot);
      return pivot;
    });

    // 头
    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;
    this.squash.add(this.head);
    const skull = headGeometry();
    this.head.add(new THREE.Mesh(skull, skinMat));

    this.faceOpen = faceCanvas(false);
    this.faceClosed = faceCanvas(true);
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.faceOpen, transparent: true, depthWrite: false });
    const face = new THREE.Mesh(faceGeometry(skull), this.faceMat);
    face.renderOrder = 2;
    this.head.add(face);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skinMat);
      ear.scale.set(0.5, 1, 0.75);
      ear.position.set(side * 0.178, -0.075, -0.005);
      this.head.add(ear);
    }

    this.head.add(new THREE.Mesh(scalpGeometry(skull), hairMat));
    for (const g of hairGeometries()) this.head.add(new THREE.Mesh(g, hairMat));

    // 动画状态
    this.phase = 0;
    this.time = 0;
    this.slideW = 0;
    this.airW = 0;
    this.diveW = 0;
    this.sliding = false;
    this.squashAmt = 0;
    this.divePitch = 0; // 俯冲时身体朝下转的角度（平滑跟随运动方向）
    this.cheerT = 0; // 冲过终点停下后蹦跳的计时
    this.blinkTimer = 2 + Math.random() * 2;
  }

  // 空中耍酷的姿势和动作（设计文档 3.6）。在基础姿态之上叠加，绕身体中心转。
  // 坐雪橇时：动作让雪橇和角色一起翻转（转 ride），姿势只有角色动（转 tilt）
  _trickPose({ kind, id, p }, riding) {
    const t = kind === 'action' && riding ? this.ride : this.tilt;
    if (kind === 'pose') {
      // 姿势：前 15% 摆出来，最后 15% 收回去
      const w = smoothstep(0, 0.15, p) * (1 - smoothstep(0.85, 1, p));
      if (id === 'star') {
        // 大字展翅：鳍翅和双脚张开成星形
        t.rotation.x = lerp(t.rotation.x, -0.1, w);
        for (const f of this.flippers) {
          f.rotation.z = lerp(f.rotation.z, f.userData.side * 2.3, w);
          f.rotation.x = lerp(f.rotation.x, 0, w);
        }
        for (const f of this.feet) {
          f.rotation.z = f.userData.side * 0.9 * w;
          f.position.x = f.userData.baseX * (1 + 1.2 * w);
        }
      } else if (id === 'salute') {
        // 单翅敬礼：转身回头看向玩家（镜头在身后），一只鳍翅举到额头
        t.rotation.y = Math.PI * w;
        t.rotation.x = lerp(t.rotation.x, 0, w);
        const f = this.flippers[0];
        f.rotation.z = lerp(f.rotation.z, f.userData.side * 2.75, w);
        f.rotation.x = lerp(f.rotation.x, -0.55, w);
        this.head.rotation.x = lerp(this.head.rotation.x, 0.15, w);
      } else if (id === 'superman') {
        // 超人式：身体放平，鳍翅往前伸
        t.rotation.x = lerp(t.rotation.x, 1.5, w);
        this.head.rotation.x = lerp(this.head.rotation.x, -1.2, w);
        for (const f of this.flippers) {
          f.rotation.x = lerp(f.rotation.x, -2.9, w);
          f.rotation.z = lerp(f.rotation.z, f.userData.side * 0.15, w);
        }
        for (const f of this.feet) f.rotation.x = lerp(f.rotation.x, -0.7, w);
      }
    } else {
      // 动作：整个身体翻转，鳍翅收紧
      const e = p * p * (3 - 2 * p);
      if (id === 'frontflip') t.rotation.x += e * Math.PI * 4;
      else if (id === 'spin') t.rotation.y += e * Math.PI * 4;
      else if (id === 'backspin') {
        t.rotation.x -= e * Math.PI * 2;
        t.rotation.y += e * Math.PI * 2;
      }
      const tuck = Math.sin(Math.PI * p);
      for (const f of this.flippers) f.rotation.z = lerp(f.rotation.z, f.userData.side * 0.05, tuck);
      for (const f of this.feet) f.rotation.x = lerp(f.rotation.x, 0.6, tuck);
    }
    if (t === this.ride) t.position.set(0, 0, 0); // 俯冲时已经算过一次，按总的转动重新算
    this._pivot(t);
  }

  // 绕身体中心（离脚底约 0.7 米）转，而不是绕脚底：把转动带来的位移抵消掉
  _pivot(t) {
    _c.set(0, 0.7, 0);
    _v.copy(_c).applyEuler(t.rotation);
    t.position.x += _c.x - _v.x;
    t.position.y += _c.y - _v.y;
    t.position.z += _c.z - _v.z;
  }

  // 落地时压扁一下：完美落地轻一点、硬着陆重一点
  land(type) {
    this.squashAmt = Math.max(this.squashAmt, type === 'hard' ? 1 : type === 'perfect' ? 0.6 : 0.3);
  }

  // s: { grounded, diving, speed, vy, hspeed, stun, slideEnter, slideExit, cheer,
  //      trick: 正在做的姿势或动作 { kind, id, p（0～1 的进度） } 或 null }
  update(dt, s) {
    this.time += dt;

    // 站立和肚皮滑行之间留一段速度差，避免在临界值附近来回切换
    if (!s.grounded || s.riding) this.sliding = false;
    else if (this.sliding) this.sliding = s.speed > s.slideExit;
    else this.sliding = s.speed > s.slideEnter;

    const approach = (w, target, seconds) => (target > w ? Math.min(target, w + dt / seconds) : Math.max(target, w - dt / seconds));
    this.slideW = approach(this.slideW, this.sliding ? 1 : 0, 0.2);
    this.airW = approach(this.airW, !s.grounded && !s.diving ? 1 : 0, 0.15);
    this.diveW = approach(this.diveW, s.diving ? 1 : 0, 0.12);
    const ease = (w) => w * w * (3 - 2 * w);
    const slide = ease(this.slideW);
    const air = ease(this.airW);
    const dive = ease(this.diveW);
    const upright = (1 - slide) * (1 - air) * (1 - dive);

    // 小碎步：速度越快步频越快（坐雪橇时不迈步）
    const runAmp = s.grounded && !s.riding ? clamp(s.speed / 6, 0, 1) : 0;
    this.phase += dt * Math.PI * 2 * Math.min(9, 2.2 + s.speed * 0.3) * (runAmp > 0 ? 1 : 0);
    const step = Math.sin(this.phase);
    const idle = 1 - runAmp;

    // 俯冲：身体慢慢转向运动方向，下落越快越朝下，最多约 80°（设计文档 3.5）
    const diveTarget = s.diving ? clamp(Math.atan2(-s.vy, Math.max(1, s.hspeed)), 0.25, 1.4) : 0;
    this.divePitch += (diveTarget - this.divePitch) * (1 - Math.exp(-dt / 0.15));

    // 姿态
    let pitch = 0.06 + 0.22 * clamp(s.speed / 25, 0, 1);
    pitch = lerp(pitch, 1.42, slide);
    pitch = lerp(pitch, 0.22, air);
    pitch = lerp(pitch, Math.max(0.22, this.divePitch), dive);
    this.tilt.rotation.x = pitch;
    this.tilt.rotation.y = 0;
    this.tilt.rotation.z = step * 0.16 * runAmp * upright;
    // 趴下时用肚皮着地：抬高身体前后半径那么多
    this.tilt.position.set(0, 0.3 * slide + Math.abs(step) * 0.05 * runAmp * upright, 0);

    // 趴下时抬头看前方
    this.head.rotation.x = -1.15 * slide - 0.35 * dive;

    // 压扁和拉长
    if (s.stun <= 0) this.squashAmt *= Math.exp(-9 * dt);
    const breathe = Math.sin(this.time * 2.2) * 0.012 * idle * upright;
    const sq = this.squashAmt;
    const sy = (1 - 0.24 * sq + breathe) * (1 + 0.14 * dive);
    const sxz = (1 + 0.14 * sq) * (1 - 0.1 * dive);
    this.squash.scale.set(sxz, sy, sxz);

    // 鳍翅：待机轻摆、跑步前后摆、空中张开；
    // 滑行时向两侧张开保持平衡，俯冲时往后贴
    for (const f of this.flippers) {
      const side = f.userData.side;
      const swing = Math.sin(this.time * 1.8 + side) * 0.05 * idle + step * side * 0.25 * runAmp;
      f.rotation.z = side * (0.2 + 1.0 * air + 0.95 * slide - 0.08 * dive) + swing * upright;
      f.rotation.x = 0.15 * slide + 0.45 * dive + step * side * 0.3 * runAmp * upright;
    }

    // 脚：交替迈步；滑行时翘起来；空中自然下垂
    for (const f of this.feet) {
      const side = f.userData.side;
      const ph = step * side;
      f.position.x = f.userData.baseX;
      f.rotation.z = 0;
      f.position.z = f.userData.baseZ + ph * 0.1 * runAmp * upright;
      f.position.y = 0.04 + Math.max(0, ph) * 0.07 * runAmp * upright;
      f.rotation.x = -0.9 * slide + 0.35 * air + 0.2 * dive;
    }

    // 俯冲时身体发出淡淡的暖光
    this.bodyMat.emissiveIntensity = 0.35 * dive;

    // 骑雪橇车：跨坐在座椅上，身体前倾，双翅往前握住车把，脚收在座椅前面；俯冲时连人带车一起低头
    this.sled.visible = !!s.riding;
    this.ride.rotation.set(0, 0, 0);
    this.ride.position.set(0, 0, 0);
    if (s.riding) {
      this.tilt.rotation.set(0.35, 0, 0);
      this.tilt.position.set(0, 0.86, -0.3);
      this.head.rotation.x = -0.3;
      this.squash.scale.set(1 + 0.14 * sq, 1 - 0.24 * sq, 1 + 0.14 * sq);
      for (const f of this.flippers) {
        const side = f.userData.side;
        f.rotation.x = -0.75 + Math.sin(this.time * 9 + side) * 0.03;
        f.rotation.z = side * 0.55;
      }
      for (const f of this.feet) {
        f.position.set(f.userData.baseX * 1.4, 0.05, f.userData.baseZ + 0.2);
        f.rotation.set(-0.5, 0, 0);
      }
      this.bodyMat.emissiveIntensity = 0;
      this.ride.rotation.x = Math.max(0, this.divePitch) * dive * 0.8;
      this._pivot(this.ride);
    }

    if (s.trick) this._trickPose(s.trick, s.riding);

    // 雪橇车第二档以上（s.boosted = 1～4）：排气管一直喷火，火焰忽长忽短，档位越高越长越粗
    this.flames.visible = !!(s.riding && s.boosted);
    if (this.flames.visible) {
      const big = 1 + 0.3 * (s.boosted - 1);
      for (const [i, f] of this.flames.children.entries()) {
        const k = 0.75 + 0.35 * Math.abs(Math.sin(this.time * 31 + i * 1.7)) + Math.random() * 0.15;
        const w = 1 + 0.15 * (s.boosted - 1);
        f.scale.set(w, w, k * big);
      }
    }

    // 无敌时的金光（s.glow：0～1），轻轻闪动；没有金光时恢复俯冲用的暖光
    const glow = s.glow || 0;
    if (glow > 0 || this.glowW > 0) {
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 24);
      for (const m of this.glowMats) {
        if (!m.emissive) continue;
        if (glow > 0) {
          m.emissive.copy(GOLD);
          m.emissiveIntensity = 0.75 * glow * flicker;
        } else {
          m.emissive.set(m === this.bodyMat ? COLORS.glow : '#000000');
          m.emissiveIntensity = m === this.bodyMat ? 0.35 * dive : 0;
        }
      }
      this.halo.visible = glow > 0;
      this.halo.material.opacity = glow * flicker;
      const hs = 4.6 * (0.92 + 0.08 * flicker);
      this.halo.scale.set(hs, hs, 1);
    }
    this.glowW = glow;

    // 冲过终点停下后：原地蹦两下、拍拍鳍翅
    if (s.cheer) {
      this.cheerT += dt;
      const hop = Math.max(0, Math.sin(this.cheerT * 9));
      const hops = this.cheerT < (Math.PI * 2 * 2) / 9 ? 1 : 0; // 只蹦两下
      this.tilt.position.y += hop * 0.3 * hops;
      for (const f of this.flippers) f.rotation.z = f.userData.side * (1.1 + Math.sin(this.cheerT * 14) * 0.5);
    } else {
      this.cheerT = 0;
    }

    // 眨眼
    this.blinkTimer -= dt;
    const closed = this.blinkTimer < 0;
    if (this.blinkTimer < -0.12) this.blinkTimer = 2.5 + Math.random() * 2.5;
    const map = closed ? this.faceClosed : this.faceOpen;
    if (this.faceMat.map !== map) this.faceMat.map = map;
  }
}
