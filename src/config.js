// 所有可调数值。对应设计文档第 11 节「待原型验证的数值」。
// 单位：米、秒、米/秒。调试面板改动会自动存到浏览器本地。

export const DEFAULTS = {
  // 地面移动
  cruiseSpeed: 25, // 平地跑步能达到的速度
  maxSpeed: 80,
  runAccel: 14,
  brakeDecel: 20,
  slopeFactor: 0.7, // 坡度对速度的影响强度
  overspeedDrag: 0.25, // 超过巡航速度后的衰减
  groundTurnRate: 3.2, // 弧度/秒
  groundStick: 1.0, // 越大越不容易从坡顶飞起

  // 空中
  gravity: 30,
  jumpSpeed: 11,
  diveAccel: 50,
  airTurnRate: 0.9,

  // 落地判定
  perfectMinSlopeDeg: 6, // 下坡至少这么陡才算完美落地
  perfectMaxAngleDeg: 50, // 移动方向和下坡方向的最大夹角
  perfectConvert: 0.5, // 撞击速度转成前进速度的比例
  perfectBonus: 4, // 完美落地额外加速
  normalLoss: 0.08,
  hardImpactSpeed: 28, // 超过这个撞击速度、又没落在下坡上，算硬着陆
  hardLoss: 0.35,
  hardStun: 0.35,
  minAirTime: 0.2, // 空中时间短于这个不做落地判定

  // 雪崩
  collapseGrace: 3, // 起跑后多少秒雪崩冲下来
  collapseStart: -180, // 雪崩出现的位置（滑雪站后方的山坡上）
  collapseSurge: 110, // 刚冲下来时额外的速度，很快衰减
  collapseSurgeTime: 1.3, // 初始冲劲衰减的时间常数（秒）
  collapseBaseSpeed: 35.2, // 按其余雪崩参数算好：起跑后约 65 秒推进到终点线（设计文档第 4 节）
  collapseAccel: 0.5, // 每秒加快多少
  collapseEarlyFactor: 0.8, // 开局的速度倍率，逐渐升到 1
  collapseEarlyTime: 30,

  // 地图（下一局生效）
  seed: 1,
  mapWidth: 500,
  mapLength: 3000,
  slopeDeg: 10, // 平均下坡角度
  featuresPerRow: 3, // 每排地形特征的数量（会随机 ±1）
  featureScale: 1, // 地形特征的高度倍率
  noiseScale: 1, // 自然起伏的幅度倍率

  // 角色动作
  slideEnterSpeed: 25, // 超过这个速度扑倒用肚皮滑行（约 90 km/h）
  slideExitSpeed: 21, // 低于这个速度站起来（约 75 km/h）

  // 镜头
  fovMin: 70,
  fovMax: 100,
  fovSpeedRef: 60, // 达到这个速度时 FOV 拉满
  camDistance: 5.5,
  mouseSensitivity: 0.0022,
};

const STORAGE_KEY = 'haste-proto-params-v1';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const params = load();

// 只保存和默认值不同的参数，这样以后调整默认值时，没改过的参数会跟着更新
export function saveParams() {
  const changed = {};
  for (const k of Object.keys(DEFAULTS)) if (params[k] !== DEFAULTS[k]) changed[k] = params[k];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // 无痕模式等情况下存不了，忽略
  }
}

export function resetParams() {
  Object.assign(params, DEFAULTS);
  saveParams();
}
