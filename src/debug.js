// 调试面板：实时调设计文档第 11 节里的数值。改动自动保存到浏览器本地。

import GUI from 'lil-gui';
import { params, saveParams, resetParams } from './config.js';

export function createDebugPanel({ onRestart }) {
  const gui = new GUI({ title: '调参面板（` 键显示/隐藏）' });
  gui.onChange(saveParams);

  const move = gui.addFolder('地面移动');
  move.add(params, 'cruiseSpeed', 5, 60, 0.5).name('巡航速度 m/s');
  move.add(params, 'maxSpeed', 30, 200, 1).name('最高速度 m/s');
  move.add(params, 'runAccel', 2, 60, 0.5).name('跑步加速');
  move.add(params, 'brakeDecel', 2, 60, 0.5).name('刹车减速');
  move.add(params, 'slopeFactor', 0, 3, 0.05).name('坡度影响');
  move.add(params, 'overspeedDrag', 0, 1, 0.01).name('超速衰减');
  move.add(params, 'groundTurnRate', 0.5, 8, 0.1).name('地面转向');
  move.add(params, 'groundStick', 0.2, 5, 0.05).name('抓地（越大越难飞起）');

  const air = gui.addFolder('空中');
  air.add(params, 'gravity', 5, 80, 0.5).name('重力');
  air.add(params, 'jumpSpeed', 2, 30, 0.5).name('起跳速度');
  air.add(params, 'diveAccel', 0, 250, 1).name('俯冲加速');
  air.add(params, 'airTurnRate', 0, 4, 0.05).name('空中转向');

  const land = gui.addFolder('落地判定');
  land.add(params, 'perfectMinSlopeDeg', 0, 40, 0.5).name('完美：最小下坡角°');
  land.add(params, 'perfectMaxAngleDeg', 5, 90, 1).name('完美：最大偏角°');
  land.add(params, 'perfectConvert', 0, 1.5, 0.05).name('完美：撞击转化比例');
  land.add(params, 'perfectBonus', 0, 30, 0.5).name('完美：额外加速');
  land.add(params, 'normalLoss', 0, 0.5, 0.01).name('普通落地损失');
  land.add(params, 'hardImpactSpeed', 5, 80, 1).name('硬着陆阈值');
  land.add(params, 'hardLoss', 0, 0.9, 0.01).name('硬着陆损失');
  land.add(params, 'hardStun', 0, 2, 0.05).name('硬着陆硬直 s');
  land.add(params, 'minAirTime', 0, 1, 0.05).name('最短判定滞空 s');

  const collapse = gui.addFolder('雪崩');
  collapse.add(params, 'collapseGrace', 0, 10, 0.5).name('雪崩倒计时 s');
  collapse.add(params, 'collapseStart', -400, -60, 5).name('出现位置 m');
  collapse.add(params, 'collapseSurge', 0, 250, 5).name('初始冲劲 m/s');
  collapse.add(params, 'collapseSurgeTime', 0.2, 5, 0.1).name('冲劲衰减 s');
  collapse.add(params, 'collapseBaseSpeed', 0, 60, 0.5).name('基准速度 m/s');
  collapse.add(params, 'collapseAccel', 0, 1, 0.01).name('每秒加快');
  collapse.add(params, 'collapseEarlyFactor', 0.2, 1, 0.05).name('开局倍率');
  collapse.add(params, 'collapseEarlyTime', 0, 180, 5).name('开局放慢时长 s');

  const level = gui.addFolder('地图（重新开始后生效）');
  level.add(params, 'seed', 1, 9999, 1).name('地图种子');
  level.add(params, 'mapWidth', 200, 1000, 10).name('地图宽度 m');
  level.add(params, 'mapLength', 500, 8000, 100).name('地图长度 m');
  level.add(params, 'slopeDeg', 0, 15, 0.5).name('平均坡度 °');
  level.add(params, 'featuresPerRow', 1, 5, 1).name('每排特征数');
  level.add(params, 'featureScale', 0.3, 2.5, 0.05).name('特征大小倍率');
  level.add(params, 'noiseScale', 0, 3, 0.05).name('起伏幅度倍率');

  const anim = gui.addFolder('角色动作');
  anim.add(params, 'slideEnterSpeed', 5, 60, 0.5).name('扑倒滑行速度 m/s');
  anim.add(params, 'slideExitSpeed', 5, 60, 0.5).name('站起速度 m/s');

  const cam = gui.addFolder('镜头');
  cam.add(params, 'fovMin', 40, 100, 1).name('FOV 最小');
  cam.add(params, 'fovMax', 60, 130, 1).name('FOV 最大');
  cam.add(params, 'fovSpeedRef', 20, 150, 1).name('FOV 拉满的速度');
  cam.add(params, 'camDistance', 3, 20, 0.5).name('镜头距离');
  cam.add(params, 'mouseSensitivity', 0.0005, 0.006, 0.0001).name('鼠标灵敏度');

  const actions = {
    restart: onRestart,
    randomSeed() {
      params.seed = 1 + Math.floor(Math.random() * 9999);
      saveParams();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      onRestart();
    },
    copy() {
      navigator.clipboard?.writeText(JSON.stringify(params, null, 2)).catch(() => {});
    },
    reset() {
      resetParams();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
  gui.add(actions, 'restart').name('重新开始（R）');
  gui.add(actions, 'randomSeed').name('换一张地图');
  gui.add(actions, 'copy').name('复制当前参数');
  gui.add(actions, 'reset').name('恢复默认参数');

  // 默认收起各分组，整个面板默认隐藏（按 ` 键显示）
  gui.folders.forEach((f) => f.close());
  gui.hide();
  return gui;
}
