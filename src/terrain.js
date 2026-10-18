// 地形网格：开放雪原按 64 米见方的区块加载，离镜头越远网格越粗，看不见的区块销毁。
// 雪崩掩埋在顶点着色器里做：雪崩线后面的地面被抬高到一层平整的厚雪表面，颜色变成纯白。

import * as THREE from 'three';
import { mulberry32 } from './math.js';
import { buryUniforms, BURY_GLSL } from './bury.js';

const CHUNK = 64;
// 按到镜头的水平距离选网格间距（米）
const LODS = [
  { dist: 230, step: 2 },
  { dist: 560, step: 4 },
  { dist: Infinity, step: 8 },
];
const AHEAD = 1100; // 前方加载多远
const BEHIND = 560; // 身后加载多远（起点时要能看到滑雪站和后面的山坡）
const SKIRT = 6; // 区块边缘往下垂的裙边，遮住不同精度区块之间的缝
const BUILDS_PER_FRAME = 4;
const DEPOSIT = 3; // 雪崩留下的厚雪比平滑地表高出多少

const SNOW = new THREE.Color('#f3f6fb');
const WARM = new THREE.Color('#ffe9dc'); // 朝阳的下坡
const COOL = new THREE.Color('#bccdeb'); // 背光的上坡
const ROCK = new THREE.Color('#9aa5bb'); // 很陡的雪山侧壁

function createSnowMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAvalanche = buryUniforms.uAvalanche;
    shader.uniforms.uStart = buryUniforms.uStart;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSmooth;
        varying float vBuried;
        ${BURY_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float k = buryAmount(position.z);
        transformed.y = mix(transformed.y, max(transformed.y, aSmooth + ${DEPOSIT.toFixed(1)}), k);
        vBuried = k;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vBuried;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.975, 1.0), vBuried);`);
  };
  return mat;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

function snowColor(a, b, c, rng, out) {
  _n.crossVectors(_b.subVectors(b, a), _c.subVectors(c, a)).normalize();
  if (_n.y < 0) _n.negate();
  // 法线朝 +Z 倾斜 = 往前是下坡
  const forward = Math.max(-1, Math.min(1, (_n.z / Math.max(_n.y, 0.05)) * 1.8));
  out.copy(SNOW);
  if (forward > 0) out.lerp(WARM, Math.min(forward, 0.7)); // 暖色只是淡淡的提示，不能盖过雪的白
  else out.lerp(COOL, -forward);
  const steep = Math.max(0, Math.min(1, (0.62 - _n.y) / 0.3));
  out.lerp(ROCK, steep * 0.85);
  out.multiplyScalar(0.97 + rng() * 0.05);
  return out;
}

function buildChunk(world, cx, cz, step) {
  const n = CHUNK / step;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ world.P.seed);

  const H = new Float32Array((n + 1) * (n + 1));
  const S = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      H[j * (n + 1) + i] = world.rawHeight(x, z);
      S[j * (n + 1) + i] = world.smoothHeight(x, z);
    }
  }
  const v = (i, j) => new THREE.Vector3(x0 + i * step, H[j * (n + 1) + i], z0 + j * step);
  const s = (i, j) => S[j * (n + 1) + i];

  const pos = [];
  const col = [];
  const smooth = [];
  const color = new THREE.Color();
  const tri = (a, b, c, sa, sb, sc, cl) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b);
    smooth.push(sa, sb, sc);
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p00 = v(i, j);
      const p10 = v(i + 1, j);
      const p01 = v(i, j + 1);
      const p11 = v(i + 1, j + 1);
      tri(p00, p01, p10, s(i, j), s(i, j + 1), s(i + 1, j), snowColor(p00, p01, p10, rng, color));
      tri(p10, p01, p11, s(i + 1, j), s(i, j + 1), s(i + 1, j + 1), snowColor(p10, p01, p11, rng, color));
    }
  }

  // 裙边：四条边各往下垂一圈
  const edge = [];
  for (let i = 0; i < n; i++) edge.push([i, 0, i + 1, 0], [i + 1, n, i, n], [0, i + 1, 0, i], [n, i, n, i + 1]);
  color.copy(SNOW).multiplyScalar(0.9);
  for (const [i0, j0, i1, j1] of edge) {
    const a = v(i0, j0);
    const b = v(i1, j1);
    const a2 = a.clone().setY(a.y - SKIRT);
    const b2 = b.clone().setY(b.y - SKIRT);
    tri(a, b, a2, s(i0, j0), s(i1, j1), s(i0, j0) - SKIRT, color);
    tri(b, b2, a2, s(i1, j1), s(i1, j1) - SKIRT, s(i0, j0) - SKIRT, color);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSmooth', new THREE.Float32BufferAttribute(smooth, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.boundingSphere.radius += 15; // 雪崩掩埋会在着色器里把地面抬高几米
  return g;
}

export class TerrainManager {
  constructor(scene) {
    this.scene = scene;
    this.material = createSnowMaterial();
    this.chunks = new Map(); // key → { mesh, step }
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  setWorld(world) {
    for (const c of this.chunks.values()) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.world = world;
  }

  // 一次性生成镜头附近的区块，避免开局时地面一块块冒出来
  prewarm(camX, camZ, focusZ) {
    this.update(camX, camZ, focusZ, Infinity, 320);
  }

  // camX/camZ：镜头位置（决定网格精度）；focusZ：玩家位置（决定加载范围）
  update(camX, camZ, focusZ, budget = BUILDS_PER_FRAME, maxDist = Infinity) {
    const w = this.world;
    const z0 = Math.max(w.zMin, Math.min(focusZ, camZ) - BEHIND);
    const z1 = Math.min(w.zMax, Math.max(focusZ, camZ) + AHEAD);
    const cz0 = Math.floor(z0 / CHUNK);
    const cz1 = Math.floor(z1 / CHUNK);
    const cx0 = Math.floor(-w.xLimit / CHUNK);
    const cx1 = Math.floor(w.xLimit / CHUNK);

    const wanted = new Set();
    const todo = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cz}`;
        wanted.add(key);
        const d = Math.hypot(cx * CHUNK + CHUNK / 2 - camX, cz * CHUNK + CHUNK / 2 - camZ);
        if (d > maxDist) continue;
        const step = LODS.find((l) => d < l.dist).step;
        const existing = this.chunks.get(key);
        if (!existing || existing.step !== step) todo.push({ key, cx, cz, step, d });
      }
    }
    // 先建离镜头近的
    todo.sort((a, b) => a.d - b.d);
    for (const t of todo) {
      if (budget-- <= 0) break;
      const old = this.chunks.get(t.key);
      if (old) {
        this.group.remove(old.mesh);
        old.mesh.geometry.dispose();
      }
      const mesh = new THREE.Mesh(buildChunk(w, t.cx, t.cz, t.step), this.material);
      this.group.add(mesh);
      this.chunks.set(t.key, { mesh, step: t.step });
    }
    for (const [key, c] of this.chunks) {
      if (wanted.has(key)) continue;
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      this.chunks.delete(key);
    }
  }
}
