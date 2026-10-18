// 入口：游戏流程（新手引导 → 主菜单 → 起跑 → 雪崩倒计时 → 奔跑 → 结算）、雪崩推进、主循环。

import * as THREE from 'three';
import { params as P } from './config.js';
import { clamp, lerp, smoothstep } from './math.js';
import { World, HUT, hutToWorld } from './world.js';
import { TerrainManager } from './terrain.js';
import { Scenery } from './scenery.js';
import { AvalancheView } from './avalanche.js';
import { Snowfall, SpeedLines } from './snow.js';
import { PictureInPicture } from './pip.js';
import { ObstacleView } from './obstacles.js';
import { SnowTrail } from './trail.js';
import { LiftCabins } from './gondola.js';
import { HutView, SledDebris } from './sled.js';
import { AudioEngine } from './audio.js';
import { buryUniforms } from './bury.js';
import { Player } from './player.js';
import { PlayerView } from './playerView.js';
import { Input } from './input.js';
import { CameraRig } from './cameraRig.js';
import { Hud } from './hud.js';
import { createEnvironment } from './environment.js';
import { createDebugPanel } from './debug.js';
import { Tutorial, tutorialSeen } from './tutorial.js';

const STEP = 1 / 120; // 物理步长
const KEY_TURN_SPEED = 2.4; // 方向键转视角，弧度/秒
const ORBIT_TIME = 4; // 终点环绕镜头转一圈的时间（秒）
const ORBIT_DIST = 5.2;
// 分数（设计文档 7.1）
const SCORE_PER_SECOND = 10;
const SCORE = { perfect: 100, pose: 150, action: 400, finish: 1000, sled: 500, sledAction: 1500 };
const MULT_STEP = { pose: 1.5, action: 3 }; // 同一次腾空里每完成一个，后续的倍率乘上这么多
const MULT_MAX = 20;
const BEST_KEY = 'haste-proto-best-v1';
function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // 存不了就算了
  }
}
// 最短用时（设计文档 7.2）：只记冲过终点的局；0 表示还没有
const BEST_TIME_KEY = 'haste-proto-besttime-v1';
function loadBestTime() {
  try {
    return Number(localStorage.getItem(BEST_TIME_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBestTime(v) {
  try {
    localStorage.setItem(BEST_TIME_KEY, String(v));
  } catch {
    // 存不了就算了
  }
}

// 雪橇车（设计文档 3.8）
const SLED_ENTER = 1.0; // 进屋动画
const SLED_WALK = 0.7; // 进屋动画里跑到门口用的时间
const SLED_INSIDE = 2.0; // 在屋里准备雪橇
const SLED_WATCH = 0.35; // 冲出来后镜头在原地看着雪橇车冲过来多久
const SLED_CAM_BACK = 0.6; // 镜头回到身后用时
const SLED_TIME = 10; // 雪橇能用多久
const SLED_WARN = 2; // 最后几秒闪烁、滴滴响

const CAUGHT_HOLD = 2.5; // 被雪崩吞没后停留多久再显示结算（设计文档 5.5）
const CAUGHT_RISE = 0.8; // 镜头升空用时
const CAUGHT_CAM_UP = 85; // 镜头升到吞没点上方多高（要高过雪浪，雪浪最高约 50 米）
const CAUGHT_CAM_AHEAD = 65; // 镜头移到吞没点前方（下坡方向）多远
const CAUGHT_CAM_DRIFT = 12; // 升到位后继续往前飘的速度（m/s），让雪浪从镜头下方碾过

const $ = (id) => document.getElementById(id);

// ---------- 场景 ----------
const canvas = $('game');
// 远处的山脉有几千米远，用对数深度缓冲避免远近物体互相穿插
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(P.fovMin, window.innerWidth / window.innerHeight, 0.2, 9500);
const env = createEnvironment(scene);
const terrain = new TerrainManager(scene);
const scenery = new Scenery(scene);
const avalanche = new AvalancheView(scene);
const snow = new Snowfall(scene);
const speedLines = new SpeedLines();
const pip = new PictureInPicture(renderer, scene);
const obstacleView = new ObstacleView(scene);
const trail = new SnowTrail(scene);
const liftCabins = new LiftCabins(scene);
const hutView = new HutView(scene);
const sledDebris = new SledDebris(scene);
const audio = new AudioEngine();
const playerView = new PlayerView(scene);
const input = new Input(canvas);
const rig = new CameraRig(camera, P);
const hud = new Hud();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 游戏状态 ----------
const game = {
  state: 'menu', // menu | tutorial | playing | paused | finishing（终点环绕镜头）| caught（被雪崩追上后的停留）| over
  // playing 里的阶段：ready 等玩家起跑 → countdown 雪崩倒计时 → collapsing 雪崩推进中
  phase: 'ready',
  time: 0, // 从起跑开始计时
  countdown: 0,
  collapseTime: 0,
  collapseS: 0, // 雪崩前沿的位置（z）
  collapseSpeed: 0,
  stats: null,
};
let world;
let worldKey = '';
let player;
let acc = 0; // 物理步长的时间累积

// 地图参数没变就沿用上一张地图，重开一局是瞬间的
function ensureWorld() {
  const key = JSON.stringify([P.seed, P.mapWidth, P.mapLength, P.slopeDeg, P.featuresPerRow, P.featureScale, P.noiseScale]);
  if (key === worldKey) return;
  worldKey = key;
  world = new World(P);
  terrain.setWorld(world);
  scenery.setWorld(world);
  avalanche.setWorld(world);
  obstacleView.setWorld(world);
  liftCabins.setCables(scenery.cables);
  hutView.setWorld(world);
}

function buildRun() {
  ensureWorld();
  player = new Player(world, P);
  game.time = 0;
  game.collapseS = P.collapseStart;
  game.collapseSpeed = 0;
  game.collapseTime = 0;
  game.stats = { perfect: 0, hard: 0, maxSpeed: 0, speedSum: 0, poses: 0, actions: 0 };
  game.score = 0;
  game.mult = 1; // 这次腾空攒下的倍率，落地清零
  buryUniforms.uAvalanche.value = -1e9; // 雪崩出现之前什么都不埋
  buryUniforms.uStart.value = P.collapseStart;
  avalanche.setVisible(false);
  obstacleView.reset();
  hutView.reset();
  sledDebris.reset();
  game.seq = null; // 进小木屋换雪橇的过程（设计文档 3.8）
  game.sledTime = 0;
  game.boostFx = 0; // 切到第二档那一下的特效强度（1 → 0，约 0.9 秒）
  playerView.forceSled = false;
  trail.reset();
  game.finishAnim = 0;
  game.caughtTime = 0;
  showFinishOverlay(false);
  playerView.setVisible(true);
  pip.stop();
  rig.yaw = 0;
  rig.pitch = 0.28;
  rig.snap(player, world);
  playerView.yaw = rig.yaw + Math.PI; // 开局正面朝镜头
  terrain.prewarm(rig.pos.x, rig.pos.z, player.pos.z);
}

function showPanel(id) {
  for (const p of ['menu', 'paused', 'result']) $(p).classList.toggle('hidden', p !== id);
}

// 开局不倒数：直接能操作，等玩家起跑后才开始雪崩倒计时
function startRun() {
  buildRun();
  game.state = 'playing';
  game.phase = 'ready';
  acc = 0;
  showPanel(null);
  hud.show(true);
  hud.resetRun();
  input.lock();
  audio.setMode('ambient');
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  showPanel('paused');
  if (input.locked) document.exitPointerLock();
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  showPanel(null);
  input.lock();
}

const END_TITLES = {
  finish: '抵达终点',
  collapse: '被雪崩吞没',
  fall: '掉出了世界',
};

// reason: finish | collapse | fall
function endRun(reason) {
  const win = reason === 'finish';
  game.state = 'over';
  stopSledSeq();
  showFinishOverlay(false);
  hud.hideRunPrompts();
  pip.stop();
  if (input.locked) document.exitPointerLock();
  const s = game.stats;
  const progress = clamp((player.pos.z - world.startS) / (world.finishS - world.startS), 0, 1);
  const avg = game.time > 0 ? s.speedSum / game.time : 0;
  $('result-title').textContent = END_TITLES[reason];
  $('result-sub').textContent = win ? `用时 ${game.time.toFixed(1)} 秒` : `你跑完了 ${Math.round(progress * 100)}%`;
  const time = Math.round(game.time * 10) / 10;
  const bestTime = loadBestTime();
  const timeRecord = win && (bestTime === 0 || time < bestTime);
  if (timeRecord) saveBestTime(time);
  const shownBest = timeRecord ? time : bestTime;
  const bestCell = `<span class="best-time">最短 ${shownBest ? `${shownBest.toFixed(1)} s` : '—'}${
    timeRecord ? ' <span class="time-record">新纪录</span>' : ''
  }</span>`;
  const rows = [
    ['用时', `${time.toFixed(1)} s${bestCell}`],
    ['完成进度', `${Math.round(progress * 100)}%`],
    ['平均速度', `${Math.round(avg * 3.6)} km/h`],
    ['最高速度', `${Math.round(s.maxSpeed * 3.6)} km/h`],
    ['完美落地', s.perfect],
    ['硬着陆', s.hard],
  ];
  rows.push(['完成姿势', `${s.poses} 次`], ['完成动作', `${s.actions} 次`]);
  $('result-stats').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  // 本次分数和历史最高（设计文档 7.2）
  const score = Math.floor(game.score);
  const best = loadBest();
  const record = score > best;
  if (record) saveBest(score);
  $('result-score').textContent = score.toLocaleString('en-US');
  $('new-record').classList.toggle('hidden', !record);
  $('result-best').textContent = `历史最高 ${Math.max(best, score).toLocaleString('en-US')}`;
  showPanel('result');

  // 进度条：每次进入结算都从 0 涨到这局的进度；冲线时涨满后右端弹出一颗星星
  const fill = $('rp-fill');
  fill.classList.remove('animate');
  fill.style.width = '0%';
  void fill.offsetWidth; // 先让 0% 生效，下面改宽度时才会有过渡动画
  fill.classList.add('animate');
  fill.style.width = `${(win ? 1 : progress) * 100}%`;
  const star = $('rp-star');
  star.classList.remove('show');
  star.classList.toggle('hidden', !win);
  if (win) {
    void star.getBoundingClientRect();
    star.classList.add('show');
  }
}

function addScore(points, label, big = false) {
  game.score += points;
  hud.popScore(`+${Math.round(points).toLocaleString('en-US')} ${label}`, big);
}

function showFinishOverlay(on, text = '抵达终点！') {
  $('finish-banner').textContent = text;
  $('finish-banner').classList.toggle('hidden', !on);
  $('skip-hint').classList.toggle('hidden', !on);
}

// 冲过终点：胜利锁定、计时停止；角色自动刹车，镜头立刻开始绕角色转一圈（设计文档 5.4）
function startFinish() {
  game.state = 'finishing';
  game.finishAnim = 0;
  // 坐着雪橇冲线：雪橇留着，只是不再锁定速度，好让角色刹车停下
  if (player.sled) {
    playerView.forceSled = true;
    player.dropSled();
  }
  stopSledSeq();
  game.orbitStart = Math.atan2(camera.position.x - player.pos.x, camera.position.z - player.pos.z);
  game.orbitFrom = camera.position.clone();
  pip.stop();
  hud.hideRunPrompts();
  hud.show(false);
  showFinishOverlay(true);
  audio.finish();
  addScore(SCORE.finish, '冲过终点', true);
}

// 被雪崩吞没（设计文档 5.5）：角色消失、炸开一团雪粉，镜头迅速升空、回头看着吞没点，
// 雪崩继续往前推进 2.5 秒，然后显示结算；可以按任意键跳过
function startCaught() {
  game.state = 'caught';
  game.caughtTime = 0;
  stopSledSeq();
  hud.hideRunPrompts();
  hud.show(false);
  pip.stop();
  showFinishOverlay(true, '被雪崩吞没');
  const p = player.pos;
  game.caughtAt = p.clone();
  game.camFrom = camera.position.clone();
  const az = p.z + CAUGHT_CAM_AHEAD;
  game.camTo = new THREE.Vector3(p.x, world.rawHeight(p.x, az) + CAUGHT_CAM_UP, az);
  playerView.setVisible(false);
  trail.burst(p);
  audio.caught();
}

function updateCaughtCamera() {
  const k = clamp(game.caughtTime / CAUGHT_RISE, 0, 1);
  const e = 1 - (1 - k) ** 3; // 先快后慢
  camera.position.lerpVectors(game.camFrom, game.camTo, e);
  camera.position.z += CAUGHT_CAM_DRIFT * Math.max(0, game.caughtTime - CAUGHT_RISE);
  const shake = game.state === 'caught' ? 0.35 : 0; // 结算画面出来后镜头停稳
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake;
  camera.lookAt(game.caughtAt.x, game.caughtAt.y + 1, game.caughtAt.z);
  if (Math.abs(camera.fov - 60) > 0.01) {
    camera.fov = lerp(camera.fov, 60, 0.15);
    camera.updateProjectionMatrix();
  }
}

$('start-btn').addEventListener('click', startRun);
$('again-btn').addEventListener('click', startRun);
$('restart-btn').addEventListener('click', startRun);
$('resume-btn').addEventListener('click', resume);
canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !input.locked) input.lock();
});
document.addEventListener('pointerlockchange', () => {
  if (!input.locked) pause();
});

// ---------- 声音（设计文档 8.3） ----------
// 浏览器规定第一次点击或按键之后才能出声
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
document.addEventListener('click', (e) => {
  if (e.target.closest('button') && e.target.id !== 'mute-btn') audio.click();
});
function refreshMuteButton() {
  $('mute-btn').classList.toggle('muted', audio.muted);
  $('mute-btn').setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
}
$('mute-btn').addEventListener('click', () => {
  audio.toggleMute();
  refreshMuteButton();
});
refreshMuteButton();
$('music-vol').value = Math.round(audio.settings.music * 100);
$('sfx-vol').value = Math.round(audio.settings.sfx * 100);
$('music-vol').addEventListener('input', (e) => audio.setVolume('music', e.target.value / 100));
$('sfx-vol').addEventListener('input', (e) => audio.setVolume('sfx', e.target.value / 100));
let lastStepIndex = 0; // 踩雪声：按角色迈步的节奏
let lastCountdown = 0;

const gui = createDebugPanel({ onRestart: startRun });
let debugVisible = false;

const tutorial = new Tutorial({
  onClose() {
    game.state = 'menu';
    showPanel('menu');
    gui.show(debugVisible);
  },
});

function openTutorial() {
  game.state = 'tutorial';
  showPanel(null);
  hud.show(false);
  gui.hide();
  tutorial.open();
}
$('tutorial-btn').addEventListener('click', openTutorial);

// 主菜单镜头：站在滑雪站前方偏下坡的位置，回头看滑雪站和身后的山脉，缓慢平移
function updateMenuCamera(t) {
  const st = world.station;
  const y0 = world.rawHeight(0, 0);
  const a = Math.sin(t * 0.07) * 0.4;
  camera.position.set(8 + Math.sin(a) * 18, y0 + 5, 42 + Math.cos(a) * 4);
  // 略微往上看，让身后的山脉和云海进画面；木屋偏到画面右侧，避开左边的菜单
  camera.lookAt(st.x - 26, y0 + 22, st.z - 60);
  if (camera.fov !== 55) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}

// ---------- 雪橇车（设计文档 3.8） ----------
// 碰到小木屋门前的圆环：进屋（1 秒）→ 屋里准备雪橇（2 秒）→ 撞开后门冲出来，镜头回到身后

// 木屋局部坐标 → 世界坐标（ly 是离木屋地面的高度）
function hutPoint(hut, lx, ly, lz) {
  const w = hutToWorld(hut, lx, lz);
  return new THREE.Vector3(w.x, hut.y + ly, w.z);
}

function startSledSeq(i) {
  const hut = world.huts[i];
  hutView.setUsed(i);
  // 骑着雪橇车来到新木屋：旧车当场炸掉，换一辆新的
  if (player.sled) {
    player.dropSled();
    sledDebris.explode(player.pos, player.vel);
    trail.burst(player.pos, 60);
    audio.sledCrash();
    rig.addShake(0.5);
    game.sledTime = 0;
  }
  player.trick = null;
  player.trickPress = null;
  player.diving = false;
  game.seq = {
    hut: i,
    phase: 'enter', // enter 进屋 → inside 屋里 → burst 冲出来
    t: 0, // 这个阶段经过的真实时间
    control: false, // 玩家是否已经恢复操作
    from: player.pos.clone(),
    camFrom: camera.position.clone(),
    side: Math.sign(hut.x) || 1, // 镜头从靠近场地中间的那一侧绕过去
    curve: null,
  };
  audio.doorCreak();
}

function stopSledSeq() {
  if (game.seq) hutView.setProgress(game.seq.hut, null);
  game.seq = null;
}

// 每帧推进进屋、屋里、冲出来的过程
function updateSledSeq(dt) {
  const seq = game.seq;
  const hut = world.huts[seq.hut];
  seq.t += dt;
  if (seq.phase === 'enter') {
    // 小跑到门口，进门后消失；门先打开，进去后关上
    const door = hutPoint(hut, 0, 0, HUT.hz + 0.3);
    const k = smoothstep(0, SLED_WALK, seq.t);
    player.pos.lerpVectors(seq.from, door, k);
    player.pos.y = world.rawHeight(player.pos.x, player.pos.z);
    const dx = door.x - seq.from.x;
    const dz = door.z - seq.from.z;
    const d = Math.hypot(dx, dz) || 1;
    player.heading.set(dx / d, 0, dz / d);
    player.vel.set(0, 0, 0);
    player.speed = seq.t < SLED_WALK ? 7 : 0;
    player.grounded = true;
    if (seq.t >= SLED_WALK && !playerView.hidden) playerView.setVisible(false);
    hutView.setDoors(seq.hut, smoothstep(0, 0.25, seq.t) * (1 - smoothstep(0.75, 1, seq.t)), 0);
    if (seq.t >= SLED_ENTER) {
      seq.phase = 'inside';
      seq.t = 0;
      player.pos.set(hut.x, hut.y, hut.z); // 在屋里（雪崩追上来照样会被吞没）
      audio.sledHammer();
    }
  } else if (seq.phase === 'inside') {
    hutView.setProgress(seq.hut, clamp(seq.t / SLED_INSIDE, 0, 1), camera);
    if (seq.t >= SLED_INSIDE) sledBurst();
  } else {
    hutView.setDoors(seq.hut, 0, clamp(seq.t / 0.12, 0, 1));
    if (!seq.control && seq.t >= SLED_WATCH) {
      // 雪橇车冲过镜头：恢复操作，雪橇开始倒计时，镜头回到身后
      seq.control = true;
      game.sledTime = SLED_TIME;
      rig.yaw = Math.atan2(player.heading.x, player.heading.z);
      rig.pitch = 0.28;
      rig.snap(player, world);
    }
  }
  if (seq.phase === 'burst' && seq.t >= SLED_WATCH + SLED_CAM_BACK) stopSledSeq();
}

// 撞开后门，坐着雪橇冲出来
function sledBurst() {
  const seq = game.seq;
  const hut = world.huts[seq.hut];
  seq.phase = 'burst';
  seq.t = 0;
  hutView.setProgress(seq.hut, null);
  const exit = hutToWorld(hut, 0, -HUT.hz - 1.2);
  const ahead = hutToWorld(hut, 0, -HUT.hz - 2.2);
  player.pos.set(exit.x, world.rawHeight(exit.x, exit.z), exit.z);
  player.giveSled(ahead.x - exit.x, ahead.z - exit.z);
  playerView.setVisible(true);
  playerView.yaw = Math.atan2(player.heading.x, player.heading.z);
  trail.broken = true; // 雪印不要从入口连到出口
  trail.burst(player.pos, 90);
  addScore(SCORE.sled, '雪橇车', true);
  audio.sledBurst();
  rig.addShake(0.5);
}

// 雪橇撞毁（硬着陆、失误、撞上大障碍）：雪橇炸成碎片，角色保持速度继续跑
function sledCrash(cause) {
  sledDebris.explode(player.pos, player.vel);
  trail.burst(player.pos, 60);
  audio.sledCrash();
  rig.addShake(0.7);
  hud.showLanding({ type: 'sledCrash' });
  playerView.land('hard');
  if (cause === 'hard') game.stats.hard++;
  if (cause !== 'bump') game.mult = 1; // 落地了，倍率清零
  game.sledTime = 0;
}

// 雪橇车升档（420 / 500 / 600 / 700）：金光、视野猛地拉宽、镜头震动、金色速度线、加速音效（设计文档 3.8）
function sledBoost() {
  game.boostFx = 1;
  hud.boostPop(player.sledGear, Math.round(player.sledSpeed * 3.6));
  audio.sledBoost(player.sledGear);
  rig.addShake(0.5);
  trail.burst(player.pos, 50);
}

// 时间到：雪橇"砰"地散掉
function sledTimeout() {
  player.dropSled();
  sledDebris.explode(player.pos, player.vel);
  audio.sledCrash(0.6);
  game.sledTime = 0;
}

// 进屋、屋里、冲出来时的镜头；雪橇车冲过镜头后用 0.6 秒回到身后
const _rigPos = new THREE.Vector3();
const _rigQuat = new THREE.Quaternion();
function updateSledCamera(dt) {
  const seq = game.seq;
  const hut = world.huts[seq.hut];
  const sd = seq.side;
  const aboveGround = (v) => {
    const gh = world.heightAt(v.x, v.z);
    if (gh !== null) v.y = Math.max(v.y, gh + 1.5);
    return v;
  };
  // 下坡一侧、回头看着整间木屋（连同屋顶上的进度圈）的位置
  const view = hutPoint(hut, sd * 9, 0, -(HUT.hz + 30));
  view.y = world.rawHeight(view.x, view.z) + 4; // 下坡那边地面更低，按镜头脚下的地面算高度
  const frame = hutPoint(hut, 0, 8, -HUT.hz);
  let pos;
  let look;
  if (seq.phase === 'enter') {
    // 先往前推近门口，再从侧面绕过木屋，转到下坡一侧回头看
    seq.curve ||= new THREE.CatmullRomCurve3([
      seq.camFrom.clone(),
      aboveGround(hutPoint(hut, sd * 5, 8, HUT.hz + 16)),
      aboveGround(hutPoint(hut, sd * (HUT.hx + 20), 11, -4)),
      view.clone(),
    ]);
    const u = smoothstep(0, SLED_ENTER, seq.t);
    pos = aboveGround(seq.curve.getPoint(u));
    const door = hutPoint(hut, 0, 3, HUT.hz);
    look = player.pos.clone();
    look.y += 1;
    look.lerp(door, smoothstep(0, 0.45, u)).lerp(frame, smoothstep(0.45, 0.95, u));
  } else if (seq.phase === 'inside') {
    pos = view;
    pos.y += Math.sin(seq.t * 1.5) * 0.15;
    look = frame;
  } else {
    pos = view;
    look = frame.lerp(_rigPos.copy(player.pos).setY(player.pos.y + 1), smoothstep(0, 0.15, seq.t));
  }

  if (seq.control) {
    rig.update(dt, player, world);
    _rigPos.copy(camera.position);
    _rigQuat.copy(camera.quaternion);
    camera.position.copy(pos);
    camera.lookAt(look);
    const k = smoothstep(SLED_WATCH, SLED_WATCH + SLED_CAM_BACK, seq.t);
    camera.position.lerp(_rigPos, k);
    camera.quaternion.slerp(_rigQuat, k);
    return;
  }
  camera.position.copy(pos);
  camera.lookAt(look);
  if (Math.abs(camera.fov - 60) > 0.01) {
    camera.fov = lerp(camera.fov, 60, 0.1);
    camera.updateProjectionMatrix();
  }
}

// ---------- 每个物理步 ----------
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const wish = new THREE.Vector3();

function step(dt) {
  const axis = input.moveAxis();
  // 按下 W A S D 任意一个键算起跑：提示淡出，雪崩倒计时开始，右上角出现画中画
  if (game.phase === 'ready' && (axis.forward !== 0 || axis.right !== 0)) {
    game.phase = 'countdown';
    game.countdown = P.collapseGrace;
    hud.runStarted();
    pip.start(world);
    audio.setMode('run');
    lastCountdown = 0;
  }
  if (game.phase !== 'ready') {
    game.time += dt;
    game.score += SCORE_PER_SECOND * dt; // 分数随时间增长
  }

  // 进屋、屋里：角色由 updateSledSeq 控制；刚冲出来的一小会儿不能操作
  const seq = game.seq;
  if (!seq || seq.control) {
    rig.forward(_f);
    rig.right(_r);
    wish.set(_f.x * axis.forward + _r.x * axis.right, 0, _f.z * axis.forward + _r.z * axis.right);
    if (wish.lengthSq() > 0) wish.normalize();
    player.update(dt, { wish, dive: input.dive, spaceHeld: input.keys.has('Space') });
  } else if (seq.phase === 'burst') {
    player.update(dt, { wish: NO_WISH, dive: false, spaceHeld: false });
  }

  for (const e of player.events) {
    // 耍酷（设计文档 3.6、7.1）
    if (e.type === 'trickStart') {
      audio.trickStart();
      continue;
    }
    if (e.type === 'trickCancel') continue;
    if (e.type === 'sledCrash') {
      sledCrash(e.cause);
      continue;
    }
    if (e.type === 'trick') {
      const base = e.kind === 'action' && e.sled ? SCORE.sledAction : SCORE[e.kind]; // 骑雪橇车做完动作 1500
      const label = game.mult > 1 ? `${e.name} ×${+game.mult.toFixed(2)}` : e.name;
      addScore(base * game.mult, label, e.kind === 'action');
      game.mult = Math.min(MULT_MAX, game.mult * MULT_STEP[e.kind]);
      if (e.kind === 'pose') game.stats.poses++;
      else game.stats.actions++;
      audio.trickDone(e.kind);
      if (e.boost) sledBoost();
      continue;
    }
    if (e.type === 'bail') {
      hud.showLanding(e);
      playerView.land('hard');
      rig.addShake(0.7);
      audio.bail();
      game.mult = 1;
      continue;
    }
    if (e.type === 'perfect') {
      const label = game.mult > 1 ? `完美落地 ×${+game.mult.toFixed(2)}` : '完美落地';
      addScore(SCORE.perfect * game.mult, label);
    }
    if (e.type === 'perfect' || e.type === 'normal' || e.type === 'hard') game.mult = 1; // 落地后倍率清零
    hud.showLanding(e);
    if (e.type !== 'jump') playerView.land(e.type);
    if (e.type === 'perfect') {
      game.stats.perfect++;
      rig.addShake(0.35);
    } else if (e.type === 'hard') {
      game.stats.hard++;
      rig.addShake(0.6);
    } else if (e.type === 'bump') {
      rig.addShake(0.7); // 撞上大障碍：镜头震动，不显示文字
    } else if (e.type === 'knock') {
      obstacleView.knock(e.obstacle, e.dirX, e.dirZ, player.currentSpeed);
      if (e.obstacle.big) rig.addShake(0.4); // 无敌时撞飞大东西
    }
    if (e.type === 'jump') audio.jump();
    else if (e.type === 'bump') audio.bump();
    else if (e.type === 'knock') {
      if (e.obstacle.big) audio.bump();
      audio.knock();
    }
    else audio.land(e.type);
  }
  player.events.length = 0;

  // 碰到小木屋门前的圆环：进屋换雪橇（已经坐着雪橇车也照样进，旧车炸掉；被雪崩经过的圆环不算）
  if (!game.seq && game.phase !== 'ready') {
    for (let i = 0; i < world.huts.length; i++) {
      if (hutView.state[i].used) continue;
      const c = hutView.ringCenter(i);
      if (game.phase === 'collapsing' && game.collapseS > c.z - 6) continue;
      if (Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < HUT.ringR + 0.3 && player.pos.y - c.y < 3) {
        startSledSeq(i);
        break;
      }
    }
  }
  // 雪橇倒计时：最后 2 秒每半秒滴一声，时间到雪橇散掉
  if (player.sled && game.sledTime > 0 && !game.seq) {
    const before = game.sledTime;
    game.sledTime -= dt;
    if (game.sledTime > 0 && game.sledTime <= SLED_WARN && Math.ceil(before * 2) !== Math.ceil(game.sledTime * 2)) audio.sledBeep();
    if (game.sledTime <= 0) sledTimeout();
  }

  // 雪崩倒计时和推进（设计文档第 4 节）
  if (game.phase === 'countdown') {
    game.countdown -= dt;
    // 倒计时每跳一个数字「嘀」一声
    const n = Math.ceil(game.countdown);
    if (n !== lastCountdown && n > 0) {
      lastCountdown = n;
      audio.beep();
    }
    if (game.countdown <= 0) {
      audio.roar();
      game.phase = 'collapsing';
      game.collapseTime = 0;
      hud.collapseStarted();
      rig.addShake(0.5);
      avalanche.setVisible(true);
    }
  } else if (game.phase === 'collapsing') {
    advanceAvalanche(dt);
  }

  if (game.phase !== 'ready') {
    const speed = player.currentSpeed;
    game.stats.speedSum += speed * dt;
    game.stats.maxSpeed = Math.max(game.stats.maxSpeed, speed);
  }

  // 正常游玩中掉不出地图，这里只是保险（设计文档 3.3）
  if (player.fell) return endRun('fall');
  if (game.phase === 'collapsing' && player.pos.z < game.collapseS) return startCaught();
  if (player.pos.z >= world.finishS) return startFinish();
}

function advanceAvalanche(dt) {
  game.collapseTime += dt;
  const t = game.collapseTime;
  const early = lerp(P.collapseEarlyFactor, 1, clamp(t / Math.max(1, P.collapseEarlyTime), 0, 1));
  // 刚冲下来时带一股很快衰减的初始冲劲，几秒内吞没滑雪站
  game.collapseSpeed = P.collapseBaseSpeed * early + P.collapseAccel * t + P.collapseSurge * Math.exp(-t / P.collapseSurgeTime);
  game.collapseS += game.collapseSpeed * dt;
  buryUniforms.uAvalanche.value = game.collapseS;
}

// 终点后的物理步：不再响应移动操作，自动刹车，1～2 秒内停下
const NO_WISH = new THREE.Vector3();
function stepFinishing(dt) {
  player.update(dt, { wish: NO_WISH, dive: false, spaceHeld: false });
  if (player.grounded) player.speed = Math.max(0, player.speed - Math.max(player.speed * 1.8, 10) * dt);
  for (const e of player.events) {
    if (e.type === 'knock') {
      obstacleView.knock(e.obstacle, e.dirX, e.dirZ, player.currentSpeed);
      audio.knock();
    } else if (e.type === 'bump') audio.bump();
    else if (['normal', 'perfect', 'hard'].includes(e.type)) audio.land(e.type);
  }
  player.events.length = 0;
}

// 终点环绕镜头：从冲线时的镜头位置开始，绕角色转一圈
function updateOrbitCamera() {
  const k = clamp(game.finishAnim / ORBIT_TIME, 0, 1);
  const ang = game.orbitStart + (k - Math.sin(k * Math.PI * 2) / (Math.PI * 2) * 0.35) * Math.PI * 2;
  const p = player.pos;
  const desired = new THREE.Vector3(p.x + Math.sin(ang) * ORBIT_DIST, p.y + 2.0, p.z + Math.cos(ang) * ORBIT_DIST);
  const gh = world.heightAt(desired.x, desired.z);
  if (gh !== null) desired.y = Math.max(desired.y, gh + 1);
  const blend = clamp(game.finishAnim / 0.5, 0, 1);
  camera.position.lerpVectors(game.orbitFrom, desired, blend * blend * (3 - 2 * blend));
  camera.lookAt(p.x, p.y + 0.8, p.z);
  if (Math.abs(camera.fov - P.fovMin) > 0.01) {
    camera.fov = lerp(camera.fov, P.fovMin, 0.1);
    camera.updateProjectionMatrix();
  }
}

// ---------- 主循环 ----------
let last = performance.now();
let fps = 60;
let clock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = lerp(fps, 1 / Math.max(dt, 1e-4), 0.05);
  tick(dt);
}

function tick(dt) {
  if (game.state === 'playing' && game.seq) updateSledSeq(dt);
  clock += dt;
  if (input.wasPressed('Backquote')) {
    debugVisible = !debugVisible;
    gui.show(debugVisible);
  }
  if (input.wasPressed('KeyM')) {
    audio.toggleMute();
    refreshMuteButton();
  }
  const inRun = ['playing', 'paused', 'over', 'finishing', 'caught'].includes(game.state);
  const inMenu = game.state === 'menu' || game.state === 'tutorial';
  if (input.wasPressed('KeyR') && inRun) startRun();
  if (input.wasPressed('Escape') && !input.locked) {
    if (game.state === 'paused') resume();
    else pause();
  }

  const seqLocked = game.seq && !game.seq.control;
  if (game.state === 'playing' && !seqLocked) {
    const m = input.takeMouse();
    rig.look(m.dx, m.dy);
    rig.yaw -= input.keyTurn() * KEY_TURN_SPEED * dt;
  } else {
    input.takeMouse();
  }
  const jump = input.takeJump();

  if (game.state === 'playing') {
    if (jump && !seqLocked) player.pressSpace();
    acc += dt;
    while (acc >= STEP && game.state === 'playing') {
      step(STEP);
      acc -= STEP;
    }
    pip.update(dt, game.collapseS);
  } else if (game.state === 'finishing') {
    acc += dt;
    while (acc >= STEP) {
      stepFinishing(STEP);
      acc -= STEP;
    }
    game.finishAnim += dt;
    // 按任意键（冲线时一直按着的键不算）或点击鼠标跳过；转完一圈后显示结算
    if (input.anyPressed() || game.finishAnim >= ORBIT_TIME) endRun('finish');
  } else if (game.state === 'caught') {
    game.caughtTime += dt;
    advanceAvalanche(dt); // 雪崩继续往前推进，从吞没点碾过去
    if (input.anyPressed() || game.caughtTime >= CAUGHT_HOLD) endRun('collapse');
  }

  // 镜头：主菜单回看滑雪站；游戏中跟随主角
  let faceYaw = null;
  if (inMenu) {
    updateMenuCamera(clock);
    faceYaw = Math.atan2(camera.position.x - player.pos.x, camera.position.z - player.pos.z);
  } else if (game.phase === 'ready') {
    faceYaw = rig.yaw + Math.PI;
  }
  const cheer = game.state === 'finishing' && player.grounded && player.speed < 0.5;
  playerView.update(player, world, { dt, faceYaw, P, cheer });
  if (game.state === 'finishing') updateOrbitCamera();
  else if (game.state === 'caught' || (game.state === 'over' && game.caughtTime > 0)) updateCaughtCamera();
  else if (game.state === 'playing' && game.seq) updateSledCamera(dt);
  else if (!inMenu) rig.update(dt, player, world);

  const gap = game.phase === 'collapsing' ? player.pos.z - game.collapseS : -1;
  if (game.state === 'playing' && gap >= 0) rig.addShake(hud.danger(gap) * 0.22); // 雪崩越近镜头抖得越厉害

  terrain.update(camera.position.x, camera.position.z, player.pos.z);
  scenery.update(clock);
  // 雪崩出现时从小长大；冲过终点后停止推进并淡出
  let appear = clamp(game.collapseTime / 0.6, 0, 1);
  if (game.state === 'finishing' || (game.state === 'over' && game.finishAnim > 0)) appear *= clamp(1 - game.finishAnim / 1.0, 0, 1);
  if (appear <= 0) avalanche.setVisible(false);
  avalanche.update(dt, clock, game.collapseS, game.collapseSpeed, camera.position.x, appear);
  obstacleView.update(dt);
  hutView.update(dt, game.phase === 'collapsing' ? game.collapseS : -1e9);
  sledDebris.update(dt, world);
  liftCabins.update(dt);
  trail.update(dt, player, world, player.sled ? 1 : playerView.character.slideW, game.state === 'playing' || game.state === 'finishing', player.sled);

  // 声音：踩雪声跟着迈步的节奏；风声、滑行声、雪崩轰鸣、俯冲风啸每帧更新
  const ch = playerView.character;
  const stepIndex = Math.floor(ch.phase / Math.PI);
  if (stepIndex !== lastStepIndex) {
    lastStepIndex = stepIndex;
    if (game.state === 'playing' && player.grounded && !player.sled && ch.slideW < 0.5 && player.currentSpeed > 1) audio.footstep();
  }
  audio.update({
    speed: player.currentSpeed,
    grounded: player.grounded,
    slide: ch.slideW,
    diving: player.diving && !player.grounded,
    vy: player.vel.y,
    danger: gap >= 0 ? hud.danger(gap) : game.state === 'caught' ? 1 : 0,
    avalanche: avalanche.visible,
    active: game.state === 'playing',
    sled: player.sled && game.state === 'playing',
    boosted: game.state === 'playing' ? player.sledBoosted : 0,
  });
  snow.update(dt, camera);
  // 雪橇车第二档：一直多一点、带金色的速度线，视野更宽；刚切过去的那一下更猛
  game.boostFx = Math.max(0, game.boostFx - dt / 0.9);
  // boosted：0 = 第一档或没骑，1 = 第二档 …… 4 = 第五档；档位越高速度线越密、视野越宽
  const boosted = game.state === 'playing' ? player.sledBoosted : 0;
  const boostLines = Math.max([0, 0.35, 0.6, 0.8, 1][boosted], game.boostFx);
  rig.fovExtra = [0, 4, 6, 8, 10][boosted] + 9 * game.boostFx * game.boostFx; // 高速时视野本来就有 100°，不能再拉太宽
  speedLines.update(game.state === 'playing' ? clamp((player.currentSpeed - 32) / 30, 0, 1) : 0, game.state === 'playing' ? boostLines : 0);
  hud.setBoosted(boosted);

  if (inRun && game.state !== 'finishing' && game.state !== 'caught') {
    const span = world.finishS - world.startS;
    hud.update({
      time: game.time,
      speed: player.currentSpeed,
      perfects: game.stats.perfect,
      progress: (player.pos.z - world.startS) / span,
      collapseProgress: game.phase === 'collapsing' ? (game.collapseS - world.startS) / span : 0,
      gap,
      countdown: game.phase === 'countdown' ? game.countdown : null,
    });
    hud.setScore(game.score, game.mult);
    hud.setSledTimer(player.sled && game.sledTime > 0 && game.state === 'playing' ? game.sledTime / SLED_TIME : null, game.sledTime <= SLED_WARN);
  } else {
    hud.setSledTimer(null);
  }

  if (debugVisible && inRun) {
    const g = player.grad;
    const h = player.heading;
    const slope = Math.atan(-(g.gx * h.x + g.gz * h.z)) * (180 / Math.PI);
    const feature = world.featureAt(player.pos.x, player.pos.z);
    hud.setDebug(
      true,
      [
        `FPS    ${fps.toFixed(0)}`,
        `阶段   ${{ ready: '等待起跑', countdown: '雪崩倒计时', collapsing: '雪崩中' }[game.phase]}`,
        `状态   ${player.grounded ? '地面' : player.diving ? '俯冲' : '空中'}`,
        `路程   ${player.pos.z.toFixed(0)} / ${world.finishS.toFixed(0)} m`,
        `横向   ${player.pos.x.toFixed(0)} m`,
        `地形   ${feature ? feature.name : '雪坡'}`,
        `下坡角 ${player.grounded ? slope.toFixed(1) + '°' : '—'}`,
        `速度   ${player.currentSpeed.toFixed(1)} m/s`,
        `离雪崩 ${game.phase === 'collapsing' ? (player.pos.z - game.collapseS).toFixed(0) + ' m' : '—'}`,
      ].join('\n'),
    );
  } else {
    hud.setDebug(false);
  }

  input.endFrame();
  env.update(camera);
  renderer.render(scene, camera);
  pip.render(env);
}

buildRun();
// 第一次打开自动进入新手引导
if (tutorialSeen()) showPanel('menu');
else openTutorial();
updateMenuCamera(0);
terrain.prewarm(camera.position.x, camera.position.z, player.pos.z);
requestAnimationFrame(frame);

// 方便在浏览器控制台里调试；tick(dt) 可以在动画循环暂停时手动推进游戏
window.__game = { game, P, renderer, scene, camera, terrain, scenery, avalanche, pip, obstacleView, hutView, sledDebris, trail, input, audio, tick, tutorial, playerView, rig, get player() { return player; }, get world() { return world; } };
