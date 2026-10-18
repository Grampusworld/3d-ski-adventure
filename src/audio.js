// 音乐和音效（设计文档 8.3）：全部用 Web Audio 实时合成，不用音频文件。
//
// 结构：
//   主音量 ─┬─ 音乐总线 ─┬─ 氛围层（菜单、起跑前）
//           │            ├─ 奔跑层（随速度变密、变亮）
//           │            └─ 紧张层（雪崩逼近时淡入）
//           └─ 音效总线 ─┬─ 一次性音效（落地、碰撞、倒计时……）
//                        └─ 持续音（风声、滑行沙沙声、雪崩轰鸣、俯冲风啸）
// 音乐由一个按 16 分音符走的步进器实时安排；各层按游戏状态淡入淡出。
// 声音来源和游戏逻辑分开：以后想换成音频素材，只需要替换这里的乐器和音效函数。

import { clamp } from './math.js';

const SETTINGS_KEY = 'haste-proto-audio-v1';
const BPM = 128;
const STEP = 60 / BPM / 4; // 16 分音符的时长（秒）
const LOOKAHEAD = 0.12; // 提前安排多少秒的音符

const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
// A 小调的四和弦循环：Am - F - C - G
const PROG = [
  { chord: [57, 60, 64], bass: 45 },
  { chord: [53, 57, 60], bass: 41 },
  { chord: [52, 55, 60], bass: 48 },
  { chord: [50, 55, 59], bass: 43 },
];
const BELLS = [81, 84, 86, 88, 91, 93]; // A 小调五声音阶，高音区

function loadSettings() {
  try {
    return { music: 0.7, sfx: 0.7, muted: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { music: 0.7, sfx: 0.7, muted: false };
  }
}

export class AudioEngine {
  constructor() {
    this.settings = loadSettings();
    this.ctx = null;
    this.mode = 'ambient'; // ambient | run | none
    this.intensity = 0; // 0～1，奔跑层的强度（随速度）
    this.danger = 0; // 0～1，雪崩有多近
    this.targets = { ambient: 1, run: 0, tension: 0 };
    this._modeTimer = null;
  }

  // ---------- 开关和音量 ----------

  // 浏览器规定用户点击之前不能出声：第一次点击或按键时调用
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    this.master = this._gain(1, limiter);
    this.musicBus = this._gain(1, this.master);
    this.sfxBus = this._gain(1, this.master);
    this.layers = {
      ambient: this._gain(1, this.musicBus),
      run: this._gain(0, this.musicBus),
      tension: this._gain(0, this.musicBus),
    };
    this._makeNoise();
    this._makeLoops();
    this._applyVolumes();
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  get muted() {
    return this.settings.muted;
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this._save();
    this._applyVolumes();
    return this.settings.muted;
  }

  setVolume(kind, v) {
    this.settings[kind] = clamp(v, 0, 1);
    this._save();
    this._applyVolumes();
  }

  _save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // 存不了就算了
    }
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * s.music * 0.7, t, 0.05); // 平方：听感上更线性
    this.sfxBus.gain.setTargetAtTime(s.sfx * s.sfx, t, 0.05);
  }

  // ---------- 音乐 ----------

  // mode：ambient（氛围）、run（奔跑）、none（静音，等结局音效）；delay 秒后再切换
  setMode(mode, delay = 0) {
    clearTimeout(this._modeTimer);
    if (delay > 0) {
      this._modeTimer = setTimeout(() => this.setMode(mode), delay * 1000);
      return;
    }
    this.mode = mode;
  }

  _layerOn(name) {
    return this.targets[name] > 0.01 || this.layers[name].gain.value > 0.01;
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.02; // 掉帧后追上
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  _playStep(step, t) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const P = PROG[bar];
    const I = this.intensity;

    // 氛围层：两小节换一次长音和弦，偶尔几声风铃
    if (this._layerOn('ambient')) {
      if (s16 === 0 && bar % 2 === 0) for (const m of P.chord) this._pad(m2f(m), t, STEP * 32);
      if (s16 % 2 === 0 && Math.random() < 0.16) this._bell(m2f(BELLS[Math.floor(Math.random() * BELLS.length)]), t);
    }

    // 奔跑层：四拍底鼓、反拍拍手、踩镲随速度变密，贝斯跟和弦，速度够快时加琶音
    if (this._layerOn('run')) {
      if (s16 % 4 === 0) this._kick(t);
      if (s16 === 4 || s16 === 12) this._clap(t);
      if (s16 % 4 === 2 || (I > 0.45 && s16 % 2 === 1 && Math.random() < 0.75)) this._hat(t, s16 % 8 === 6 && I > 0.3);
      if ([0, 3, 6, 8, 11, 14].includes(s16)) this._bass(m2f(P.bass), t, STEP * 1.6, I);
      if (I > 0.2) {
        const note = P.chord[s16 % 3] + 12 + (s16 % 6 >= 3 ? 12 : 0);
        this._arp(m2f(note), t, I);
      }
    }

    // 紧张层：低沉的太鼓和低音长音
    if (this._layerOn('tension')) {
      if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 11) this._taiko(t, s16 === 0 ? 1 : 0.7);
      if (s16 === 0) this._drone(m2f(P.bass - 12), t, STEP * 16);
    }
  }

  // 冲过终点：一段胜利小旋律
  victory() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    [72, 76, 79, 84].forEach((m, i) => {
      this._osc('triangle', m2f(m), t + i * 0.11, 0.25, 0.16, this.musicBus);
      this._osc('square', m2f(m), t + i * 0.11, 0.2, 0.04, this.musicBus);
    });
    for (const m of [72, 76, 79, 84]) this._osc('sawtooth', m2f(m), t + 0.46, 1.6, 0.05, this.musicBus, { attack: 0.03, lowpass: 2600 });
  }

  // ---------- 乐器 ----------

  _pad(f, t, dur) {
    for (const d of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      const lp = this._filter('lowpass', 1100, 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 1.2);
      g.gain.setValueAtTime(0.03, t + dur - 1.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp).connect(g).connect(this.layers.ambient);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  _bell(f, t) {
    this._osc('sine', f, t, 1.8, 0.06, this.layers.ambient, { attack: 0.004 });
    this._osc('sine', f * 2.01, t, 0.9, 0.02, this.layers.ambient, { attack: 0.004 });
  }

  _kick(t) {
    this._osc('sine', 140, t, 0.28, 0.9, this.layers.run, { attack: 0.002, freqEnd: 42, freqTime: 0.12 });
  }

  _clap(t) {
    this._noise(t, 0.13, 0.32, this.layers.run, { type: 'bandpass', freq: 1600, q: 1 });
    this._noise(t + 0.012, 0.1, 0.2, this.layers.run, { type: 'bandpass', freq: 1900, q: 1 });
  }

  _hat(t, open) {
    this._noise(t, open ? 0.18 : 0.045, 0.14, this.layers.run, { type: 'highpass', freq: 7500, q: 0.7 });
  }

  _bass(f, t, dur, I) {
    this._osc('sawtooth', f, t, dur, 0.2, this.layers.run, { attack: 0.005, lowpass: 300 + I * 700, q: 4 });
  }

  _arp(f, t, I) {
    this._osc('square', f, t, 0.14, 0.05, this.layers.run, { attack: 0.003, lowpass: 900 + I * 3500 });
  }

  _taiko(t, v) {
    this._osc('sine', 90, t, 0.6, 0.7 * v, this.layers.tension, { attack: 0.003, freqEnd: 45, freqTime: 0.3 });
    this._noise(t, 0.15, 0.2 * v, this.layers.tension, { type: 'lowpass', freq: 300, q: 0.7 });
  }

  _drone(f, t, dur) {
    this._osc('sawtooth', f, t, dur, 0.12, this.layers.tension, { attack: 0.3, lowpass: 160 });
  }

  // ---------- 一次性音效 ----------

  click() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 900, t, 0.05, 0.12, this.sfxBus, { attack: 0.002 });
    this._osc('sine', 1350, t + 0.02, 0.05, 0.06, this.sfxBus, { attack: 0.002 });
  }

  // 倒计时 3、2、1
  beep() {
    if (!this._sfxReady()) return;
    this._osc('square', 880, this.ctx.currentTime, 0.14, 0.1, this.sfxBus, { attack: 0.003, lowpass: 3000 });
  }

  // 雪崩来了：一声低沉的轰鸣
  roar() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 1.8, 0.9, this.sfxBus, { type: 'lowpass', freq: 500, freqEnd: 90, q: 0.8, attack: 0.05, buffer: this.brown });
    this._osc('sine', 52, t, 1.4, 0.5, this.sfxBus, { attack: 0.05, freqEnd: 38, freqTime: 1.2 });
  }

  jump() {
    if (!this._sfxReady()) return;
    this._noise(this.ctx.currentTime, 0.25, 0.22, this.sfxBus, { type: 'bandpass', freq: 600, freqEnd: 2400, q: 1.2, attack: 0.01 });
  }

  land(type) {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    if (type === 'perfect') {
      // 清脆的「叮」加加速的「嗖」
      this._osc('sine', 1318, t, 0.7, 0.16, this.sfxBus, { attack: 0.002 });
      this._osc('sine', 1975, t + 0.03, 0.6, 0.1, this.sfxBus, { attack: 0.002 });
      this._noise(t, 0.4, 0.3, this.sfxBus, { type: 'bandpass', freq: 400, freqEnd: 3200, q: 1, attack: 0.05 });
    } else if (type === 'hard') {
      this._noise(t, 0.45, 0.8, this.sfxBus, { type: 'lowpass', freq: 1200, freqEnd: 300, q: 0.7 });
      this._osc('sine', 90, t, 0.4, 0.8, this.sfxBus, { attack: 0.002, freqEnd: 35, freqTime: 0.3 });
    } else {
      this._osc('sine', 130, t, 0.2, 0.45, this.sfxBus, { attack: 0.002, freqEnd: 55, freqTime: 0.15 });
      this._noise(t, 0.12, 0.22, this.sfxBus, { type: 'lowpass', freq: 800, q: 0.7 });
    }
  }

  // 撞上大障碍：一声闷闷的「咚」
  bump() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 180, t, 0.25, 0.7, this.sfxBus, { attack: 0.002, freqEnd: 75, freqTime: 0.18 });
    this._noise(t, 0.09, 0.3, this.sfxBus, { type: 'bandpass', freq: 500, q: 1.5 });
  }

  // 撞飞滑雪板：一阵「哐啷」
  knock() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this._osc('square', 1500 + Math.random() * 1500, t + i * 0.055, 0.04, 0.08, this.sfxBus, { attack: 0.001, lowpass: 5000 });
    this._noise(t, 0.18, 0.15, this.sfxBus, { type: 'highpass', freq: 3000, q: 0.7 });
  }

  // 开始耍酷：一声「呼」
  trickStart() {
    if (!this._sfxReady()) return;
    this._noise(this.ctx.currentTime, 0.35, 0.2, this.sfxBus, { type: 'bandpass', freq: 500, freqEnd: 2200, q: 1.4, attack: 0.03 });
  }

  // 完成姿势或动作：清脆的加分提示音（动作多一个音）
  trickDone(kind) {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const notes = kind === 'action' ? [84, 88, 91, 96] : [84, 91];
    notes.forEach((m, i) => this._osc('triangle', m2f(m), t + i * 0.07, 0.3, 0.13, this.sfxBus, { attack: 0.003 }));
  }

  // ---------- 雪橇车（设计文档 3.8） ----------

  // 推开木门：吱呀一声，进去后门"咚"地关上
  doorCreak() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._osc('sawtooth', 150, t, 0.45, 0.05, this.sfxBus, { attack: 0.03, freqEnd: 260, freqTime: 0.4, lowpass: 1400, q: 6 });
    this._osc('sawtooth', 210, t + 0.12, 0.3, 0.03, this.sfxBus, { attack: 0.02, freqEnd: 170, freqTime: 0.28, lowpass: 1800, q: 6 });
    this._osc('sine', 120, t + 0.85, 0.25, 0.5, this.sfxBus, { attack: 0.003, freqEnd: 60, freqTime: 0.2 });
    this._noise(t + 0.85, 0.12, 0.3, this.sfxBus, { type: 'lowpass', freq: 900, q: 0.7 });
  }

  // 屋里准备雪橇：2 秒叮叮当当的敲打声，最后"叮"一声准备好
  sledHammer() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const ti = t + 0.1 + i * 0.25 + Math.random() * 0.04;
      this._osc('square', 650 + Math.random() * 300, ti, 0.05, 0.05, this.sfxBus, { attack: 0.001, lowpass: 2600 });
      this._osc('sine', 230, ti, 0.12, 0.35, this.sfxBus, { attack: 0.002, freqEnd: 120, freqTime: 0.1 });
      this._noise(ti, 0.06, 0.2, this.sfxBus, { type: 'bandpass', freq: 1800, q: 2 });
    }
    this._osc('triangle', m2f(84), t + 1.85, 0.4, 0.12, this.sfxBus, { attack: 0.002 });
    this._osc('triangle', m2f(91), t + 1.92, 0.45, 0.1, this.sfxBus, { attack: 0.002 });
  }

  // 撞开后门冲出来：撞门声加一声呼啸
  sledBurst() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.5, 0.9, this.sfxBus, { type: 'lowpass', freq: 2500, freqEnd: 400, q: 0.7 });
    this._osc('sine', 110, t, 0.4, 0.7, this.sfxBus, { attack: 0.002, freqEnd: 45, freqTime: 0.35 });
    for (let i = 0; i < 5; i++) this._noise(t + Math.random() * 0.2, 0.05, 0.25, this.sfxBus, { type: 'highpass', freq: 2500, q: 0.7 });
    this._noise(t + 0.05, 1.2, 0.5, this.sfxBus, { type: 'bandpass', freq: 300, freqEnd: 3500, q: 1.2, attack: 0.25 });
  }

  // 雪橇车升档：引擎轰一下往上拉高、一阵呼啸、一声低沉的"嘭"，最后一声清亮的提示音。
  // gear：升到第几档（1 = 第二档，2 = 第三档），档位越高音调越高
  sledBoost(gear = 1) {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const up = 1 + 0.15 * (gear - 1); // 档位越高引擎声越尖
    this._osc('sawtooth', 90 * up, t, 0.7, 0.16, this.sfxBus, { attack: 0.02, freqEnd: 420 * up, freqTime: 0.45, lowpass: 2500 * up });
    this._osc('square', 180 * up, t + 0.02, 0.6, 0.06, this.sfxBus, { attack: 0.02, freqEnd: 840 * up, freqTime: 0.45, lowpass: 3000 * up });
    this._noise(t, 0.9, 0.7, this.sfxBus, { type: 'bandpass', freq: 300, freqEnd: 5200 * up, q: 1.1, attack: 0.12 });
    this._osc('sine', 75, t, 0.45, 0.8, this.sfxBus, { attack: 0.003, freqEnd: 38, freqTime: 0.35 });
    const n = [0, 0, 5, 9, 12][gear] ?? 12; // 提示音一档比一档高
    this._osc('triangle', m2f(88 + n), t + 0.3, 0.35, 0.1, this.sfxBus, { attack: 0.002 });
    this._osc('triangle', m2f(95 + n), t + 0.38, 0.45, 0.1, this.sfxBus, { attack: 0.002 });
  }

  // 雪橇倒计时最后 2 秒：滴滴
  sledBeep() {
    if (!this._sfxReady()) return;
    this._osc('square', 1320, this.ctx.currentTime, 0.08, 0.07, this.sfxBus, { attack: 0.002, lowpass: 4000 });
  }

  // 雪橇炸掉："砰"一声加碎木声；volume < 1 用于时间到时散掉
  sledCrash(volume = 1) {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 75, t, 0.6, 0.9 * volume, this.sfxBus, { attack: 0.002, freqEnd: 30, freqTime: 0.5 });
    this._noise(t, 0.7, 1.0 * volume, this.sfxBus, { type: 'lowpass', freq: 1800, freqEnd: 200, q: 0.7 });
    for (let i = 0; i < 8; i++) {
      this._noise(t + 0.03 + Math.random() * 0.35, 0.05, 0.3 * volume, this.sfxBus, { type: 'bandpass', freq: 1500 + Math.random() * 2500, q: 3 });
    }
  }

  // 失误落地：摔倒声
  bail() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this.land('hard');
    this._noise(t + 0.05, 0.5, 0.5, this.sfxBus, { type: 'bandpass', freq: 700, freqEnd: 200, q: 0.8 });
    this._osc('sawtooth', 300, t, 0.5, 0.08, this.sfxBus, { attack: 0.005, freqEnd: 90, freqTime: 0.45, lowpass: 1200 });
  }

  // 小碎步踩雪
  footstep() {
    if (!this._sfxReady()) return;
    this._noise(this.ctx.currentTime, 0.07, 0.16, this.sfxBus, { type: 'bandpass', freq: 1100 + Math.random() * 700, q: 1.2, attack: 0.003 });
  }

  // 冲过终点：号角加胜利旋律，音乐先停，然后回到氛围
  finish() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    for (const m of [55, 59, 62]) this._osc('sawtooth', m2f(m), t, 0.35, 0.06, this.sfxBus, { attack: 0.03, lowpass: 1800 });
    for (const m of [60, 64, 67]) this._osc('sawtooth', m2f(m), t + 0.3, 1.1, 0.07, this.sfxBus, { attack: 0.03, lowpass: 2000 });
    this.setMode('none');
    this.victory();
    this.setMode('ambient', 3);
  }

  // 被吞没：雪浪盖过来的「轰」，加一个低沉的下行音，音乐淡出
  caught() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 2.2, 1, this.sfxBus, { type: 'lowpass', freq: 900, freqEnd: 120, q: 0.7, attack: 0.03, buffer: this.brown });
    this._osc('sawtooth', 220, t, 1.8, 0.12, this.sfxBus, { attack: 0.02, freqEnd: 40, freqTime: 1.6, lowpass: 900 });
    this.setMode('none');
    this.setMode('ambient', 3.5);
  }

  _sfxReady() {
    return this.ctx && this.ctx.state === 'running';
  }

  // ---------- 持续音 ----------

  _makeLoops() {
    const ctx = this.ctx;
    const loop = (buffer, filter, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = this._filter(filter, freq, q);
      const g = this._gain(0, this.sfxBus);
      src.connect(f).connect(g);
      src.start();
      return { f, g };
    };
    this.wind = loop(this.white, 'lowpass', 400, 0.7);
    this.slide = loop(this.white, 'bandpass', 2600, 0.9);
    this.rumble = loop(this.brown, 'lowpass', 160, 0.7);
    const sub = ctx.createOscillator();
    sub.frequency.value = 42;
    this.subGain = this._gain(0, this.sfxBus);
    sub.connect(this.subGain);
    sub.start();
    const whistle = ctx.createOscillator();
    whistle.type = 'sine';
    whistle.frequency.value = 500;
    this.whistle = { osc: whistle, g: this._gain(0, this.sfxBus) };
    whistle.connect(this.whistle.g);
    whistle.start();
  }

  // 每帧调用：s = { speed, grounded, slide, diving, vy, danger, avalanche, active, sled, boosted }
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.08;
    const run = s.active ? 1 : 0;
    const sp = clamp(s.speed / 60, 0, 1);
    this.intensity = clamp((s.speed - 15) / 45, 0, 1);
    this.danger = s.danger;

    // 音乐各层的目标音量
    this.targets.ambient = this.mode === 'ambient' ? 1 : 0;
    this.targets.run = this.mode === 'run' ? 1 : 0;
    this.targets.tension = this.mode === 'run' ? s.danger : 0;
    for (const name of ['ambient', 'run', 'tension']) this.layers[name].gain.setTargetAtTime(this.targets[name], t, 0.6);

    // 风声：一直有一点，速度越快越大、越尖
    this.wind.g.gain.setTargetAtTime(0.03 + run * sp * 0.32, t, k);
    this.wind.f.frequency.setTargetAtTime(300 + run * s.speed * 45, t, k);
    // 肚皮滑行的沙沙声
    // 坐雪橇时滑行声更响、更尖（设计文档 3.8）
    // 第二档时更响、更尖
    const gear = s.boosted || 0; // 0 = 第一档，1 = 第二档 …… 4 = 第五档
    const slide = s.sled ? 1.6 + 0.35 * gear : s.slide;
    this.slide.g.gain.setTargetAtTime(run * (s.grounded ? slide : 0) * clamp(s.speed / 40, 0, 1) * 0.22, t, k);
    this.slide.f.frequency.setTargetAtTime(s.sled ? 4200 + 900 * gear : 2600, t, 0.2);
    // 雪崩轰鸣：越近越响
    const rumble = s.avalanche ? 0.1 + s.danger * 0.8 : 0;
    this.rumble.g.gain.setTargetAtTime(rumble, t, 0.2);
    this.subGain.gain.setTargetAtTime(rumble * 0.35, t, 0.2);
    // 俯冲风啸：下落越快音调越高
    this.whistle.g.gain.setTargetAtTime(run && s.diving ? 0.05 : 0, t, 0.06);
    this.whistle.osc.frequency.setTargetAtTime(500 + clamp(-s.vy / 70, 0, 1) * 900, t, 0.1);
  }

  // ---------- 底层工具 ----------

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    // 褐噪声：更低沉，用来做轰鸣
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
  }

  // 一个带包络的振荡器音
  _osc(type, freq, t, dur, peak, dest, { attack = 0.005, freqEnd, freqTime, lowpass, q = 0.7 } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + (freqTime ?? dur));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lowpass) node = node.connect(this._filter('lowpass', lowpass, q));
    node.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // 一段带包络和滤波的噪声
  _noise(t, dur, peak, dest, { type = 'bandpass', freq = 1000, freqEnd, q = 1, attack = 0.002, buffer } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer || this.white;
    const f = this._filter(type, freq, q);
    if (freqEnd) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, dur < 0.5 ? Math.random() * 1.4 : 0); // 短音效从噪声的随机位置开始，听起来不重复
    src.stop(t + dur + 0.05);
  }
}
