// 游戏中的界面：速度、计时、进度条、雪崩距离、落地提示、雪雾暗角。

import { clamp } from './math.js';

const $ = (id) => document.getElementById(id);

function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const LANDING_TEXT = {
  perfect: '完美落地',
  normal: '',
  hard: '硬着陆',
  bail: '失误！',
  sledCrash: '雪橇撞毁！',
};

export class Hud {
  constructor() {
    this.root = $('hud');
    this.time = $('time');
    this.gap = $('gap');
    this.speed = $('speed');
    this.perfects = $('perfects');
    this.landing = $('landing');
    this.vignette = $('vignette');
    this.progressPlayer = $('progress-player');
    this.progressCollapse = $('progress-collapse');
    this.debug = $('debug-info');
    this.runPrompt = $('run-prompt');
    this.countdown = $('collapse-countdown');
    this.countdownNum = $('cd-num');
    this.collapseStart = $('collapse-start');
    this.flash = $('flash');
    this.score = $('score');
    this.multiplier = $('multiplier');
    this.scorePops = $('score-pops');
    this.sledTimer = $('sled-timer');
    this.sledFill = $('st-fill');
    this.boostFlash = $('boost-flash');
    this._boosted = false;
    this._shownScore = -1;
    this._lastCount = null;
  }

  // 新的一局：显示起跑提示，收起倒计时
  resetRun() {
    this.runPrompt.classList.remove('hidden', 'fade');
    this.countdown.classList.add('hidden');
    this.collapseStart.classList.add('hidden');
    this._lastCount = null;
  }

  // 玩家起跑：提示用 1 秒淡出
  runStarted() {
    this.runPrompt.classList.add('fade');
  }

  collapseStarted() {
    this.countdown.classList.add('hidden');
    restartAnimation(this.collapseStart, 'show');
    this.collapseStart.classList.remove('hidden');
    restartAnimation(this.flash, 'show');
  }

  hideRunPrompts() {
    this.runPrompt.classList.add('hidden');
    this.countdown.classList.add('hidden');
    this.collapseStart.classList.add('hidden');
  }

  show(visible) {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.vignette.style.opacity = 0;
  }

  update({ time, speed, perfects, progress, collapseProgress, gap, countdown }) {
    this.time.textContent = time.toFixed(1);
    this.speed.textContent = Math.round(speed * 3.6);
    this.perfects.textContent = `完美落地 ${perfects}`;
    this.progressPlayer.style.left = `${clamp(progress, 0, 1) * 100}%`;
    this.progressCollapse.style.width = `${clamp(collapseProgress, 0, 1) * 100}%`;
    this.gap.textContent = gap < 0 ? '雪崩 —' : `雪崩 ${Math.round(gap)} m`;
    // 雪崩在 80 米内开始出现白色雪雾，越近越浓
    const danger = this.danger(gap);
    this.vignette.style.opacity = (danger * danger * 0.9).toFixed(3);

    if (countdown !== null) {
      const n = Math.max(1, Math.ceil(countdown));
      this.countdown.classList.remove('hidden');
      if (n !== this._lastCount) {
        this._lastCount = n;
        this.countdownNum.textContent = n;
        restartAnimation(this.countdownNum, 'pulse');
      }
    }
  }

  // 分数和当前倍率（倍率大于 1 时才显示）
  setScore(score, mult) {
    const n = Math.floor(score);
    if (n !== this._shownScore) {
      this._shownScore = n;
      this.score.textContent = n.toLocaleString('en-US');
    }
    this.multiplier.classList.toggle('hidden', mult <= 1);
    if (mult > 1) this.multiplier.textContent = `×${+mult.toFixed(2)}`;
  }

  // 加分提示：往上飘并淡出
  popScore(text, big = false) {
    const el = document.createElement('div');
    el.className = big ? 'score-pop big' : 'score-pop';
    el.textContent = text;
    el.style.top = `${-this.scorePops.childElementCount * 34}px`; // 同时有几条时往上错开
    this.scorePops.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // 雪橇车倒计时：frac 是剩余比例（null = 不显示）；warn = 最后 2 秒闪烁
  setSledTimer(frac, warn = false) {
    const show = frac !== null;
    this.sledTimer.classList.toggle('hidden', !show);
    if (!show) return;
    this.sledFill.style.width = `${(clamp(frac, 0, 1) * 100).toFixed(1)}%`;
    this.sledTimer.classList.toggle('warn', warn);
  }

  // 雪橇车升档的那一下：金色大字（"二档加速！420"）、屏幕边缘闪金光、速度数字弹一下
  boostPop(gear, kmh) {
    this.showLanding({ type: 'boost', text: `${['一', '二', '三', '四', '五'][gear]}档加速！${kmh}` });
    restartAnimation(this.boostFlash, 'show');
    restartAnimation(this.speed, 'boost-pop');
  }

  // 第二、三档期间速度数字一直发金光
  setBoosted(on) {
    on = !!on;
    if (on === this._boosted) return;
    this._boosted = on;
    this.speed.classList.toggle('boost', on);
  }

  // 0～1：雪崩有多近
  danger(gap) {
    return gap < 0 ? 0 : clamp(1 - (gap - 12) / 70, 0, 1);
  }

  showLanding(event) {
    const text = event.text ?? LANDING_TEXT[event.type];
    if (!text) return;
    if (event.gain === undefined) {
      this.landing.textContent = text;
    } else {
      const gain = Math.round(event.gain * 3.6);
      this.landing.textContent = gain > 0 ? `${text} +${gain}` : `${text} ${gain}`;
    }
    this.landing.className = '';
    void this.landing.offsetWidth; // 重新触发动画
    this.landing.className = `show ${event.type}`;
  }

  setDebug(visible, text = '') {
    this.debug.classList.toggle('hidden', !visible);
    if (visible) this.debug.textContent = text;
  }
}
