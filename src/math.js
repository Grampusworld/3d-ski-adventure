export const DEG = Math.PI / 180;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// e0 > e1 时得到下降的曲线，两端斜率都是 0
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 可复现的随机数（同一个种子生成同一张地图）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把水平单位向量 h（只用 x、z）绕 Y 轴转向 target，每次最多转 maxAngle 弧度
export function rotateToward(h, target, maxAngle) {
  const cross = h.z * target.x - h.x * target.z;
  const dot = h.x * target.x + h.z * target.z;
  const angle = clamp(Math.atan2(cross, dot), -maxAngle, maxAngle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = h.x * c + h.z * s;
  const z = -h.x * s + h.z * c;
  h.x = x;
  h.z = z;
  return h;
}

// 圆形的柔边粒子贴图（不然粒子是方块）
let dotTexture = null;
export function softDot(THREE) {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}
