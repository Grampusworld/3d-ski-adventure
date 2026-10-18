// 新手引导（设计文档 5.2）：游戏目标 → 操作方式（按键图）→ 怎样跑得更快（2D 侧视动画）
// → 空中耍酷与得分 → 雪橇车（档位示意图）。
// 第一次打开游戏自动播放，看过的记录存在浏览器本地；主菜单里可以随时重看。

const SEEN_KEY = 'haste-proto-tutorial-seen';

export function tutorialSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 存不了就下次再看一遍
  }
}

// ---------- 第 1 步：按键图 ----------

function key(x, y, w, h, label, tone) {
  const fill = { move: '#ffe3d4', jump: '#d9f3f6', dive: '#ffd9d4' }[tone];
  const stroke = { move: '#ff7a45', jump: '#2fb6c9', dive: '#ff3b2a' }[tone];
  return `
    <rect x="${x}" y="${y + 4}" width="${w}" height="${h}" rx="9" fill="${stroke}" opacity="0.35"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 7}" text-anchor="middle" font-size="20" font-weight="800" fill="#3b2440">${label}</text>`;
}

const KEYMAP_SVG = `
<svg viewBox="0 0 760 262" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" role="img" aria-label="按键示意图">
  <rect width="760" height="262" rx="14" fill="#fbeee3"/>
  ${key(96, 22, 48, 46, 'W', 'move')}
  ${key(44, 76, 48, 46, 'A', 'move')}
  ${key(96, 76, 48, 46, 'S', 'move')}
  ${key(148, 76, 48, 46, 'D', 'move')}
  <text x="214" y="64" font-size="22" font-weight="800" fill="#3b2440">移动</text>
  <text x="214" y="90" font-size="15" fill="#6b5470">按住 W 往前跑，S 刹车</text>

  ${key(24, 134, 116, 46, 'Shift', 'dive')}
  <text x="154" y="156" font-size="22" font-weight="800" fill="#ff3b2a">俯冲</text>
  <text x="154" y="180" font-size="15" fill="#6b5470">空中按住快速下落 · 耍酷时按下取消</text>

  ${key(56, 192, 230, 46, '空格', 'jump')}
  <text x="300" y="214" font-size="22" font-weight="800" fill="#2fb6c9">跳 / 耍酷</text>
  <text x="300" y="238" font-size="14" fill="#6b5470">空中：点按摆姿势 · 长按做动作</text>

  <line x1="478" y1="26" x2="478" y2="196" stroke="#3b2440" stroke-opacity="0.12" stroke-width="2"/>
  <g transform="translate(66 0)">

  <rect x="470" y="42" width="110" height="170" rx="55" fill="#fff" stroke="#3b2440" stroke-opacity="0.5" stroke-width="2.5"/>
  <path d="M525 112 V42 A55 55 0 0 1 580 97 V112 Z" fill="#ffd9d4" stroke="#ff3b2a" stroke-width="2.5"/>
  <line x1="470" y1="112" x2="580" y2="112" stroke="#3b2440" stroke-opacity="0.5" stroke-width="2"/>
  <line x1="525" y1="42" x2="525" y2="112" stroke="#3b2440" stroke-opacity="0.5" stroke-width="2"/>
  <text x="594" y="74" font-size="16" font-weight="800" fill="#ff3b2a">右键</text>
  <text x="594" y="96" font-size="15" fill="#6b5470">也能俯冲</text>
  <path d="M446 128 l-14 0 m0 0 l7 -7 m-7 7 l7 7" stroke="#ff7a45" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M604 128 l14 0 m0 0 l-7 -7 m7 7 l-7 7" stroke="#ff7a45" stroke-width="3" fill="none" stroke-linecap="round"/>
  <text x="525" y="244" text-anchor="middle" font-size="22" font-weight="800" fill="#3b2440">移动鼠标 · 转向</text>
  </g>
</svg>`;

// ---------- 第 1 步：游戏目标示意图 ----------
// 从左上的滑雪站一路下坡到右下的终点线，身后追着雪崩

const GOAL_SVG = `
<svg viewBox="0 0 700 190" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" role="img" aria-label="游戏目标示意图">
  <defs>
    <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ea8cc"/><stop offset="1" stop-color="#edf2f8"/></linearGradient>
  </defs>
  <rect width="700" height="190" rx="14" fill="url(#g-sky)"/>
  <path d="M0 62 L120 70 L700 170 L700 190 L0 190 Z" fill="#ffe9dc"/>
  <path d="M0 62 L120 70 L700 170" fill="none" stroke="rgba(120,135,165,0.6)" stroke-width="2"/>
  <!-- 滑雪站 -->
  <rect x="36" y="38" width="40" height="26" fill="#8b5a3c"/>
  <path d="M30 40 L56 22 L82 40 Z" fill="#f3f6fb" stroke="#6b3a2e" stroke-width="2"/>
  <text x="56" y="88" text-anchor="middle" font-size="13" font-weight="700" fill="#3b2440">起点</text>
  <!-- 雪崩 -->
  <path d="M120 70 C150 20 185 30 200 52 C215 32 245 40 248 70 C262 60 280 72 282 98 L120 70 Z" fill="#ffffff" stroke="#bccdeb" stroke-width="2"/>
  <circle cx="160" cy="58" r="3" fill="#bccdeb"/><circle cx="222" cy="62" r="3" fill="#bccdeb"/>
  <text x="196" y="132" text-anchor="middle" font-size="15" font-weight="800" fill="#ff3b2a">雪崩越来越快</text>
  <!-- 玩家 -->
  <ellipse cx="350" cy="97" rx="9" ry="12" fill="#fbefd2" stroke="#3b2440" stroke-width="1.5"/>
  <circle cx="351" cy="80" r="7" fill="#62544b"/>
  <path d="M368 96 l40 7" stroke="#ff7a45" stroke-width="3" stroke-linecap="round"/>
  <path d="M402 96 l8 7 l-10 4" stroke="#ff7a45" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="350" y="64" text-anchor="middle" font-size="15" font-weight="800" fill="#3b2440">你</text>
  <!-- 终点线 -->
  <rect x="604" y="96" width="4" height="62" fill="#3b2440"/>
  <path d="M608 96 h42 v22 h-42 Z" fill="#fff" stroke="#3b2440" stroke-width="1.5"/>
  <path d="M608 96 h10.5 v11 h-10.5 Z M629 96 h10.5 v11 h-10.5 Z M618.5 107 h10.5 v11 h-10.5 Z M639.5 107 h10.5 v11 h-10.5 Z" fill="#3b2440"/>
  <text x="628" y="84" text-anchor="middle" font-size="15" font-weight="800" fill="#2fae6b">终点线</text>
</svg>`;

// ---------- 第 5 步：雪橇车档位示意图 ----------

const GEARS = [350, 420, 500, 600, 700];
const GEAR_NAMES = ['一档', '二档', '三档', '四档', '五档'];
const GEAR_COLORS = ['#d9483b', '#ef6a2e', '#f59a2b', '#f7bf33', '#ffd84d'];

const GEARS_SVG = (() => {
  const bars = GEARS.map((kmh, i) => {
    const x = 40 + i * 132;
    const h = 52 + i * 20;
    const y = 160 - h;
    const arrow = i < GEARS.length - 1
      ? `<path d="M${x + 92} ${y + h / 2 - 4} l26 -6" stroke="#ff7a45" stroke-width="2.5" stroke-linecap="round"/><path d="M${x + 112} ${y + h / 2 - 14} l7 3 l-5 6" stroke="#ff7a45" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
    return `
    <rect x="${x}" y="${y}" width="84" height="${h}" rx="10" fill="${GEAR_COLORS[i]}"/>
    <text x="${x + 42}" y="${y + h / 2 + 2}" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">${kmh}</text>
    <text x="${x + 42}" y="${y + h / 2 + 20}" text-anchor="middle" font-size="11" font-weight="700" fill="rgba(255,255,255,0.9)">km/h</text>
    <text x="${x + 42}" y="182" text-anchor="middle" font-size="15" font-weight="800" fill="#3b2440">${GEAR_NAMES[i]}</text>
    ${arrow}`;
  }).join('');
  return `
<svg viewBox="0 0 700 196" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" role="img" aria-label="雪橇车档位示意图">
  <rect width="700" height="196" rx="14" fill="#fbeee3"/>
  <text x="350" y="22" text-anchor="middle" font-size="14" font-weight="700" fill="#6b5470">新车从一档起步 · 空中每做完一个动作升一档</text>
  ${bars}
</svg>`;
})();

// ---------- 第 3 步：侧视玩法动画 ----------

const W = 640;
const H = 330;
const BASE_Y = 95; // 平台高度在画面上的位置
const EDGE = 210; // 崖边的位置
const GRAVITY = 380;
const DIVE = 700;
const RUN_SPEED = 120; // 画面上的速度，同时当作显示的 km/h

// 和游戏里的雪地一致：暖白 = 下坡，冷蓝 = 上坡
const COLORS = {
  flat: '#f3f6fb',
  down: '#ffd9c2',
  up: '#a9bbdc',
  wall: '#9aa5bb',
  ink: '#3b2440',
  dive: '#ff3b2a',
};

const SCENES = [
  {
    title: '正确示范',
    good: true,
    h: (x) => (x <= EDGE ? 0 : -70 - (x - EDGE) * 0.36),
  },
  {
    title: '错误示范',
    good: false,
    h: (x) => (x <= EDGE ? 0 : x < 400 ? -110 + (x - EDGE) * 0.55 : -110 + 190 * 0.55),
  },
];

const slopeAt = (h, x) => (h(x + 1) - h(x - 1)) / 2;

class DemoAnimation {
  constructor(canvas, caption) {
    this.canvas = canvas;
    this.caption = caption;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this._loop = this._loop.bind(this);
  }

  start() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sceneIndex = 0;
    this._reset();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  _reset() {
    this.scene = SCENES[this.sceneIndex];
    this.x = 24;
    this.y = 0;
    this.vx = RUN_SPEED;
    this.vy = 0;
    this.v = RUN_SPEED;
    this.mode = 'run'; // run | air | ground | hold
    this.diving = false;
    this.airT = 0;
    this.modeT = 0;
    this.speed = RUN_SPEED;
    this.shownSpeed = RUN_SPEED;
    this.trail = [];
    this.pop = null;
    this.runPhase = 0;
    this.squash = 0;
    this._setCaption('冲过崖边会飞起来');
  }

  _setCaption(text) {
    if (this.caption.textContent !== text) this.caption.textContent = text;
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this._update(dt);
    this._draw();
  }

  _update(dt) {
    const h = this.scene.h;
    this.modeT += dt;
    this.shownSpeed += (this.speed - this.shownSpeed) * Math.min(1, dt * 8);
    if (this.pop) this.pop.t += dt;
    this.squash *= Math.exp(-6 * dt);
    const walking = this.mode === 'run' || (this.mode === 'ground' && !this.scene.good && this.v > 5);
    if (walking) this.runPhase += dt * (this.mode === 'run' ? 16 : 9);

    if (this.mode === 'run') {
      this.x += this.vx * dt;
      if (this.x >= EDGE) this.mode = 'air';
    } else if (this.mode === 'air') {
      const sdt = dt * 0.5; // 空中放慢，看清俯冲的过程
      this.airT += sdt;
      if (this.airT > 0.15 && !this.diving) {
        this.diving = true;
        this._setCaption('在空中按住 Shift 俯冲');
      }
      this.vy -= (GRAVITY + (this.diving ? DIVE : 0)) * sdt;
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;
      this.trail.push([this.x, this.y]);
      if (this.y <= h(this.x)) {
        this.y = h(this.x);
        this._land();
      }
    } else if (this.mode === 'ground') {
      const slope = slopeAt(h, this.x);
      if (!this.scene.good) this.v = Math.max(0, this.v - 70 * dt);
      this.x += this.v * Math.cos(Math.atan(slope)) * dt;
      this.y = h(this.x);
      if (this.x > W + 20 || this.modeT > 2.4) {
        this.mode = 'hold';
        this.modeT = 0;
      }
    } else if (this.mode === 'hold' && this.modeT > 0.9) {
      this.sceneIndex = (this.sceneIndex + 1) % SCENES.length;
      this._reset();
    }
  }

  _land() {
    const slope = slopeAt(this.scene.h, this.x);
    const perfect = this.diving && slope < -0.08;
    this.mode = 'ground';
    this.squash = 1;
    this.modeT = 0;
    this.diving = false;
    if (perfect) {
      this.speed = 250;
      this.v = 250;
      this._setCaption('落在下坡上 → 完美落地，速度大增！');
      this.pop = { text: '完美落地 +130', color: '#ff7a45', x: this.x, y: this.y, t: 0 };
    } else {
      this.speed = 60;
      this.v = 60;
      this._setCaption('砸在上坡或平地上 → 硬着陆，掉速');
      this.pop = { text: '硬着陆 -60', color: COLORS.dive, x: this.x, y: this.y, t: 0 };
    }
  }

  _draw() {
    const ctx = this.ctx;
    const h = this.scene.h;
    const sy = (y) => BASE_Y - y;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8ea8cc');
    sky.addColorStop(1, '#edf2f8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 地形：按坡度上色，和游戏里一致
    const STEP = 4;
    for (let x = 0; x < W; x += STEP) {
      const h1 = h(x);
      const h2 = h(x + STEP);
      const slope = (h2 - h1) / STEP;
      ctx.fillStyle = Math.abs(slope) > 3 ? COLORS.wall : slope < -0.08 ? COLORS.down : slope > 0.08 ? COLORS.up : COLORS.flat;
      ctx.beginPath();
      ctx.moveTo(x, sy(h1));
      ctx.lineTo(x + STEP + 0.5, sy(h2));
      ctx.lineTo(x + STEP + 0.5, H);
      ctx.lineTo(x, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,135,165,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += STEP) {
      if (x === 0) ctx.moveTo(x, sy(h(x)));
      else ctx.lineTo(x, sy(h(x)));
    }
    ctx.stroke();

    // 空中轨迹
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    this.trail.forEach(([tx, ty], i) => {
      if (i % 3) return;
      ctx.beginPath();
      ctx.arc(tx, sy(ty) - 20, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 角色
    let angle;
    if (this.mode === 'air') angle = -Math.atan2(this.vy, this.vx) * 0.6;
    else angle = -Math.atan(slopeAt(h, this.x));
    ctx.save();
    ctx.translate(this.x, sy(this.y));
    ctx.rotate(angle);
    let pose = 'stand';
    if (this.mode === 'run' || (this.mode === 'ground' && !this.scene.good && this.v > 5)) pose = 'run';
    else if (this.mode === 'air') pose = this.diving ? 'dive' : 'air';
    else if (this.mode === 'ground' && this.scene.good) pose = 'slide';
    else if (this.mode === 'hold' && this.scene.good) pose = 'slide';
    drawPenguin(ctx, pose, this.runPhase, this.squash);
    ctx.restore();

    // 落地提示
    if (this.pop && this.pop.t < 1.4) {
      const a = Math.min(1, (1.4 - this.pop.t) * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = this.pop.color;
      ctx.font = '800 22px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.pop.text, Math.min(Math.max(this.pop.x, 90), W - 90), sy(this.pop.y) - 46 - this.pop.t * 20);
      ctx.globalAlpha = 1;
    }

    // 左上：示范类型
    const good = this.scene.good;
    ctx.fillStyle = good ? '#2fae6b' : COLORS.dive;
    ctx.beginPath();
    ctx.roundRect(14, 14, 92, 30, 15);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '800 16px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.scene.title, 60, 35);

    // 右上：速度
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '900 34px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(Math.round(this.shownSpeed), W - 62, 44);
    ctx.font = '600 14px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('km/h', W - 18, 44);

    // 左下：Shift 键，俯冲时亮起
    const lit = this.diving;
    ctx.fillStyle = lit ? COLORS.dive : 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = lit ? COLORS.dive : 'rgba(59,36,64,0.35)';
    ctx.beginPath();
    ctx.roundRect(16, H - 48, 78, 32, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = lit ? '#fff' : 'rgba(59,36,64,0.5)';
    ctx.font = '800 16px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Shift', 55, H - 26);
    if (lit) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText('按住俯冲', 104, H - 26);
    }
  }
}

// 企鹅少女的 2D 侧影，面朝右，原点在脚底
// pose: stand | run | air | dive | slide
function drawPenguin(ctx, pose, phase, squash) {
  const INK = 'rgba(59,36,64,0.85)';
  ctx.save();
  if (pose === 'slide') {
    // 肚皮贴地往前滑：整个身体往前扑倒，抬头看前方
    ctx.translate(0, -15);
    ctx.rotate(1.4);
  } else if (pose === 'dive') {
    ctx.rotate(0.6);
    ctx.scale(0.88, 1.14);
    ctx.shadowColor = 'rgba(255,122,58,0.9)';
    ctx.shadowBlur = 14;
  } else if (pose === 'run') {
    ctx.translate(0, -Math.abs(Math.sin(phase)) * 2.5);
    ctx.rotate(0.12);
  }
  ctx.scale(1 + 0.18 * squash, 1 - 0.25 * squash);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;

  // 脚
  ctx.fillStyle = '#ef7a32';
  const feet = pose === 'run' ? [Math.sin(phase) * 5, -Math.sin(phase) * 5] : [0, 3];
  for (const off of feet) {
    ctx.beginPath();
    ctx.ellipse(6 + off, pose === 'slide' ? -3 : -1.5 - Math.max(0, off) * 0.3, 7, 2.6, pose === 'slide' ? -0.9 : 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 身体：下宽上窄的蛋形
  ctx.fillStyle = '#fbefd2';
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.bezierCurveTo(-19, -2, -17, -30, 0, -32);
  ctx.bezierCurveTo(17, -30, 19, -2, 0, -2);
  ctx.fill();
  ctx.stroke();

  // 头：后面先画垂下的头发，再画脸，最后盖上头顶和刘海
  ctx.save();
  ctx.translate(2, -40);
  if (pose === 'slide') ctx.rotate(-1.25);
  ctx.fillStyle = '#62544b';
  ctx.beginPath();
  ctx.ellipse(-4, 3, 10, 10.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe6d8';
  ctx.beginPath();
  ctx.arc(1, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#62544b';
  ctx.beginPath();
  ctx.arc(1, 0, 12, Math.PI * 0.95, Math.PI * 1.95);
  ctx.lineTo(10, -2);
  ctx.lineTo(6, -5);
  ctx.lineTo(3, 0);
  ctx.lineTo(-2, -3);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  // 眼睛和腮红
  ctx.fillStyle = '#7a3328';
  ctx.beginPath();
  ctx.ellipse(7, 1.5, 1.8, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(6.6, 0.6, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,140,150,0.6)';
  ctx.beginPath();
  ctx.ellipse(6, 5.5, 2.5, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 鳍翅
  const flipperAngle = { stand: 0.25, run: 0.25 + Math.sin(phase) * 0.25, air: -1.1, dive: 0.5, slide: -0.4 }[pose];
  ctx.save();
  ctx.translate(-2, -27);
  ctx.rotate(flipperAngle);
  ctx.fillStyle = '#2b2523';
  ctx.beginPath();
  ctx.ellipse(0, 11, 4, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// ---------- 引导流程 ----------

export class Tutorial {
  constructor({ onClose }) {
    this.onClose = onClose;
    this.root = document.getElementById('tutorial');
    const ids = ['tut-step-goal', 'tut-step-keys', 'tut-step-demo', 'tut-step-tricks', 'tut-step-sled'];
    this.steps = ids.map((id) => document.getElementById(id));
    this.demoStep = ids.indexOf('tut-step-demo');
    // 顶部的小圆点：有几步就画几个
    const dotsBox = this.root.querySelector('.tut-steps');
    dotsBox.innerHTML = ids.map(() => '<span class="tut-dot"></span>').join('');
    this.dots = [...dotsBox.children];
    this.next = document.getElementById('tut-next');
    this.skip = document.getElementById('tut-skip');
    document.getElementById('tut-keymap').innerHTML = KEYMAP_SVG;
    document.getElementById('tut-goal').innerHTML = GOAL_SVG;
    document.getElementById('tut-gears').innerHTML = GEARS_SVG;
    this.demo = new DemoAnimation(document.getElementById('tut-canvas'), document.getElementById('tut-caption'));

    this.next.addEventListener('click', () => {
      if (this.step < this.steps.length - 1) this._setStep(this.step + 1);
      else this._finish();
    });
    this.skip.addEventListener('click', () => this._finish());
  }

  open() {
    this.root.classList.remove('hidden');
    this._setStep(0);
  }

  _setStep(i) {
    this.step = i;
    this.steps.forEach((el, k) => el.classList.toggle('hidden', k !== i));
    this.dots.forEach((el, k) => el.classList.toggle('on', k === i));
    const last = i === this.steps.length - 1;
    this.next.textContent = last ? '完成' : '下一步';
    if (i === this.demoStep) this.demo.start();
    else this.demo.stop();
  }

  _finish() {
    markSeen();
    this.demo.stop();
    this.root.classList.add('hidden');
    this.onClose();
  }
}
