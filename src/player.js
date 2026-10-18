// 角色控制器（设计文档第 3 节）。
// 自己写的运动学控制器：地面上只记录「朝向 + 沿地面的速度」，空中按抛体运动。
// 物理以固定步长（1/120 秒）运行，保证高速下也稳定。

import * as THREE from 'three';
import { DEG, rotateToward } from './math.js';

const COYOTE_TIME = 0.12; // 离开地面后仍可起跳的宽限（这段时间里按空格是跳，之后才是耍酷）
const JUMP_PRESS = 0.02; // 按下空格后，在这么短的时间内完成起跳
const FALL_DEPTH = 20; // 离开地面后，掉到地面以下这么多米，算掉出世界
const BODY_RADIUS = 0.4; // 和障碍物碰撞时角色的半径
const SMALL_HIT_KEEP = 0.85; // 撞飞滑雪板后保留的速度
const BIG_HIT_KEEP = 0.3; // 撞上大障碍后保留的速度
const BIG_HIT_STUN = 0.5;

// 雪橇车（设计文档 3.8）：地面上速度锁定 350 km/h
// 雪橇车有五档速度：350 / 420 / 500 / 600 / 700 km/h。新车从第一档开始，骑着它在空中每做完一个动作就立即升一档
export const SLED_GEARS = [350, 420, 500, 600, 700].map((kmh) => kmh / 3.6);
export const SLED_SPEED = SLED_GEARS[0];
export const SLED_INVINCIBLE = 1.5; // 冲出小木屋后无敌多久（秒）

// 空中耍酷（设计文档 3.6）
const TRICK_HOLD = 0.25; // 按住超过这么久算长按（做动作），否则是短按（摆姿势）
const TRICK_TIME = { pose: 0.8, action: 1.25 };
const BAIL_KEEP = 0.3; // 没做完就落地：只剩 30% 的速度
const BAIL_STUN = 0.5;
export const TRICKS = {
  pose: [
    { id: 'star', name: '大字展翅' },
    { id: 'salute', name: '单翅敬礼' },
    { id: 'superman', name: '超人式' },
  ],
  action: [
    { id: 'frontflip', name: '前空翻两周' },
    { id: 'spin', name: '转体两周' },
    { id: 'backspin', name: '后空翻加转体' },
  ],
};

const _tmp = new THREE.Vector3();

export class Player {
  constructor(course, P) {
    this.course = course;
    this.P = P;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.grad = { gx: 0, gz: 0 };
    this.events = [];
    this.reset(course.startS);
  }

  reset(s) {
    const c = this.course.centerAt(s);
    this.pos.set(c.x, c.y, s);
    this.vel.set(0, 0, 0);
    this.heading.set(0, 0, 1);
    this.speed = 0; // 地面上沿地表的速度
    this.grounded = true;
    this.diving = false;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.stun = 0;
    this.fell = false;
    this.trick = null; // 正在做的姿势或动作 { kind, id, name, t, dur }
    this.trickPress = null; // 空中按下了空格，还在等判断是短按还是长按 { t }
    this.lastTrick = { pose: null, action: null };
    this.sled = false; // 是否坐着雪橇车
    this.sledGear = 0; // 这辆雪橇车的档位：0 = 第一档（每辆车独立）
    this.sledSpeed = SLED_SPEED; // 当前档位的速度
    this.invincible = 0; // 剩余的无敌时间：撞上障碍物直接撞飞，硬着陆不罚
    this.course.gradAt(this.pos.x, this.pos.z, this.grad);
  }

  // 坐上雪橇冲出小木屋：朝 (dirX, dirZ) 以 350 km/h 出发
  giveSled(dirX, dirZ) {
    this.sled = true;
    this.sledGear = 0; // 新车总是第一档 350
    this.sledSpeed = SLED_SPEED;
    this.heading.set(dirX, 0, dirZ).normalize();
    this.speed = SLED_SPEED;
    this.stun = 0;
    this.trick = null;
    this.trickPress = null;
    this.grounded = true;
    this.airTime = 0;
    this.invincible = SLED_INVINCIBLE;
    this.course.gradAt(this.pos.x, this.pos.z, this.grad);
    this._syncGroundVelocity();
  }

  // 雪橇时间到：雪橇散掉，速度不变
  dropSled() {
    this.sled = false;
  }

  // 雪橇撞毁（硬着陆、失误落地、撞上大障碍）：雪橇没了，角色不减速、不硬直
  _crashSled(cause) {
    this.sled = false;
    this.events.push({ type: 'sledCrash', cause });
  }

  // 按下空格：在地面上或刚离地时是跳，之后在空中是耍酷
  pressSpace() {
    if (this.grounded || this.coyote > 0) {
      this.jumpBuffer = JUMP_PRESS;
      return;
    }
    if (this.trick || this.trickPress || this.diving) return; // 正在耍酷或俯冲时不理会
    this.trickPress = { t: 0 };
  }

  _startTrick(kind) {
    const options = TRICKS[kind].filter((t) => t.id !== this.lastTrick[kind]); // 不和上一个重复
    const pick = options[Math.floor(Math.random() * options.length)];
    this.lastTrick[kind] = pick.id;
    this.trick = { kind, id: pick.id, name: pick.name, t: 0, dur: TRICK_TIME[kind] };
    this.trickPress = null;
    this.events.push({ type: 'trickStart', kind, name: pick.name });
  }

  _updateTrick(dt, input) {
    if (this.grounded) {
      this.trickPress = null;
      return;
    }
    // 耍酷时按 Shift：立刻取消（不给分），转为俯冲
    if (input.dive && (this.trick || this.trickPress)) {
      if (this.trick) this.events.push({ type: 'trickCancel', name: this.trick.name });
      this.trick = null;
      this.trickPress = null;
      return;
    }
    if (this.trickPress) {
      this.trickPress.t += dt;
      if (!input.spaceHeld) this._startTrick('pose');
      else if (this.trickPress.t >= TRICK_HOLD) this._startTrick('action');
    }
    if (this.trick) {
      this.trick.t += dt;
      if (this.trick.t >= this.trick.dur) {
        // 骑着雪橇车做完一个动作：这辆车立即升一档（最高第五档），空中的水平速度马上跟着变（设计文档 3.8）
        const boost = this.sled && this.trick.kind === 'action' && this.sledGear < SLED_GEARS.length - 1;
        if (boost) {
          this.sledGear++;
          this.sledSpeed = SLED_GEARS[this.sledGear];
          const hs = Math.hypot(this.vel.x, this.vel.z);
          if (hs > 0.5) {
            this.vel.x *= this.sledSpeed / hs;
            this.vel.z *= this.sledSpeed / hs;
          }
        }
        this.events.push({ type: 'trick', kind: this.trick.kind, name: this.trick.name, sled: this.sled, boost, gear: this.sledGear });
        this.trick = null;
      }
    }
  }

  // 骑着的雪橇车升了几档：0 = 没骑或第一档，1 = 第二档 …… 4 = 第五档
  get sledBoosted() {
    return this.sled ? this.sledGear : 0;
  }

  // 显示和镜头用的速度：地面上是沿地表的速度，空中只算水平速度，不让下落速度把数字带飞
  get currentSpeed() {
    return this.grounded ? this.speed : this.horizontalSpeed;
  }

  get horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  // input: { wish: 水平方向的期望移动（单位向量或零向量）, dive: 是否按住俯冲, spaceHeld: 空格是否按着 }
  update(dt, input) {
    this.stun = Math.max(0, this.stun - dt);
    this.invincible = Math.max(0, this.invincible - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && this.stun <= 0) this._jump();
    this._updateTrick(dt, input);

    if (this.grounded) this._groundStep(dt, input.wish);
    else this._airStep(dt, input.wish, input.dive);
    this._collide();

    // 脚下没有赛道，并且已经掉到赛道下方一段距离
    if (!this.grounded && this.course.heightAt(this.pos.x, this.pos.z) === null) {
      const c = this.course.centerAt(this.pos.z);
      if (this.pos.y < c.y - FALL_DEPTH) this.fell = true;
    }
  }

  _jump() {
    const P = this.P;
    this.jumpBuffer = 0;
    this.coyote = 0;
    if (this.grounded) this._syncGroundVelocity();
    this.vel.y = Math.max(this.vel.y, 0) + P.jumpSpeed;
    this.grounded = false;
    this.airTime = 0;
    this.events.push({ type: 'jump' });
  }

  _syncGroundVelocity() {
    const h = this.heading;
    const slope = this.grad.gx * h.x + this.grad.gz * h.z;
    const inv = 1 / Math.sqrt(1 + slope * slope);
    this.vel.set(h.x * inv, slope * inv, h.z * inv).multiplyScalar(this.speed);
  }

  _groundStep(dt, wish) {
    const P = this.P;
    const g = P.gravity;
    const h = this.heading;
    const { gx, gz } = this.grad;
    // 速度超过上限时（雪橇刚没了）不立即截掉，只是不再往上涨，靠超速衰减慢慢降下来
    const cap = Math.max(P.maxSpeed, this.speed);

    // 1. 操作：转向、加速、刹车（坐雪橇时只能转向，W、S 不起作用）
    const hasWish = wish.lengthSq() > 0.01 && this.stun <= 0;
    if (this.sled) {
      if (hasWish && h.x * wish.x + h.z * wish.z >= -0.5) rotateToward(h, wish, (P.groundTurnRate * dt) / (1 + this.speed / 40));
    } else if (hasWish) {
      const alignBefore = h.x * wish.x + h.z * wish.z;
      if (this.speed < 1) {
        h.set(wish.x, 0, wish.z);
      } else if (alignBefore < -0.5) {
        // 往身后按 = 刹车
        this.speed = Math.max(0, this.speed - P.brakeDecel * dt);
      } else {
        rotateToward(h, wish, (P.groundTurnRate * dt) / (1 + this.speed / 40));
      }
      if (alignBefore >= -0.5 && this.speed < P.cruiseSpeed) {
        const align = Math.max(0.3, h.x * wish.x + h.z * wish.z);
        this.speed = Math.min(P.cruiseSpeed, this.speed + P.runAccel * align * dt);
      }
    } else {
      this.speed = Math.max(0, this.speed - P.brakeDecel * 0.35 * dt);
    }

    // 2. 坡度：下坡加速，上坡减速（雪橇不受影响）
    const slopeAlong = gx * h.x + gz * h.z; // 负数 = 下坡
    if (!this.sled) this.speed += g * P.slopeFactor * (-slopeAlong / Math.sqrt(1 + slopeAlong * slopeAlong)) * dt;

    // 横向坡度（两侧护坡）会把方向往坡下带
    const px = -h.z;
    const pz = h.x;
    const slopePerp = gx * px + gz * pz;
    const latAcc = g * P.slopeFactor * (-slopePerp / Math.sqrt(1 + slopePerp * slopePerp));
    const turn = (latAcc * dt) / Math.max(this.speed, 4);
    h.x += px * turn;
    h.z += pz * turn;
    h.normalize();

    if (this.speed < 0) {
      // 上坡速度耗尽，开始往回滑
      this.speed = -this.speed;
      h.negate();
    }
    if (this.speed > P.cruiseSpeed) this.speed -= (this.speed - P.cruiseSpeed) * P.overspeedDrag * dt;
    this.speed = Math.min(this.speed, cap);
    if (this.sled) this.speed = this.sledSpeed;

    this._syncGroundVelocity();

    // 3. 移动，并判断是贴着地面走、从坡顶飞起，还是撞墙
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const expectY = this.pos.y + this.vel.y * dt;
    const gh = this.course.heightAt(nx, nz);

    if (gh === null) {
      // 跑出赛道边缘
      this.pos.set(nx, expectY, nz);
      this._leaveGround();
      return;
    }
    if (gh > expectY + 0.8) {
      // 迎面是陡壁（比如倒着跑回悬崖下面）
      if (this.invincible > 0) return; // 无敌：顶着陡壁也不撞毁，只是过不去
      if (this.sled) this._crashSled('bump');
      this.speed = 0;
      return;
    }
    // 地面下降得比自由落体还快：从坡顶飞起来
    const ballisticY = expectY - 0.5 * g * P.groundStick * dt * dt;
    if (ballisticY > gh + 1e-4) {
      this.pos.set(nx, expectY, nz);
      this._leaveGround();
      return;
    }
    this.pos.set(nx, gh, nz);
    this.course.gradAt(nx, nz, this.grad);
  }

  _leaveGround() {
    this.grounded = false;
    this.airTime = 0;
    this.coyote = COYOTE_TIME;
  }

  _airStep(dt, wish, dive) {
    const P = this.P;
    const v = this.vel;
    this.airTime += dt;
    this.coyote = Math.max(0, this.coyote - dt);
    this.diving = dive;

    v.y -= P.gravity * dt;
    if (dive) {
      if (v.y > 0) v.y *= Math.exp(-10 * dt); // 俯冲时先抵消上升
      v.y -= P.diveAccel * dt;
    }
    v.y = Math.max(v.y, -P.maxSpeed); // 下落速度上限

    // 空中只能小幅转向
    if (wish.lengthSq() > 0.01) {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.5) {
        _tmp.set(v.x / hs, 0, v.z / hs);
        rotateToward(_tmp, wish, P.airTurnRate * dt);
        v.x = _tmp.x * hs;
        v.z = _tmp.z * hs;
      } else {
        v.x += wish.x * 5 * dt;
        v.z += wish.z * 5 * dt;
      }
    }

    const nx = this.pos.x + v.x * dt;
    const ny = this.pos.y + v.y * dt;
    const nz = this.pos.z + v.z * dt;
    const gh = this.course.heightAt(nx, nz);

    if (gh !== null && ny <= gh) {
      if (gh - ny > 1.0 + Math.abs(v.y) * dt) {
        // 侧面撞上陡壁：水平速度被挡住
        v.x *= -0.1;
        v.z *= -0.1;
        this.pos.y = ny;
        return;
      }
      this.pos.set(nx, gh, nz);
      this._land();
      return;
    }
    this.pos.set(nx, ny, nz);
  }

  // 障碍物碰撞（设计文档 3.4）
  _collide() {
    const p = this.pos;
    for (const o of this.course.obstaclesNear(p.z)) {
      if (o.knocked || p.y > o.y + o.h) continue; // 撞飞过的、或者从上面跳过去的
      // 无敌时撞不飞的东西（缆车塔架、小木屋）直接穿过去
      if (this.invincible > 0 && o.noView) continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      let nx;
      let nz;
      let pen;
      if (o.hx) {
        // 小木屋：旋转的方块，先转到木屋自己的坐标里找最近点
        const c = Math.cos(o.rot);
        const sn = Math.sin(o.rot);
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        const qx = Math.max(-o.hx, Math.min(o.hx, lx));
        const qz = Math.max(-o.hz, Math.min(o.hz, lz));
        let ex = lx - qx;
        let ez = lz - qz;
        let d = Math.hypot(ex, ez);
        if (d >= BODY_RADIUS) continue;
        if (d < 1e-6) {
          // 已经在里面了：从最近的一面推出去
          const px = o.hx - Math.abs(lx);
          const pz = o.hz - Math.abs(lz);
          if (px < pz) [ex, ez, d] = [Math.sign(lx) || 1, 0, -px];
          else [ex, ez, d] = [0, Math.sign(lz) || 1, -pz];
        } else {
          ex /= d;
          ez /= d;
        }
        pen = BODY_RADIUS - d;
        nx = ex * c + ez * sn;
        nz = -ex * sn + ez * c;
      } else {
        const d = Math.hypot(dx, dz);
        const R = o.r + BODY_RADIUS;
        if (d >= R) continue;
        nx = d > 1e-6 ? dx / d : 1;
        nz = d > 1e-6 ? dz / d : 0;
        pen = R - d;
      }

      if (!o.big || this.invincible > 0) {
        // 滑雪板：撞飞，损失一点速度（雪橇直接撞飞，不减速）；无敌时什么都直接撞飞
        o.knocked = true;
        const keep = this.sled || this.invincible > 0 ? 1 : SMALL_HIT_KEEP;
        this.speed *= keep;
        this.vel.x *= keep;
        this.vel.z *= keep;
        this.events.push({ type: 'knock', obstacle: o, dirX: -nx, dirZ: -nz });
        continue;
      }

      // 大障碍：推出去，并顺着障碍物边缘绕过去
      p.x += nx * pen;
      p.z += nz * pen;
      if (this.grounded) {
        const gh = this.course.heightAt(p.x, p.z);
        if (gh !== null) p.y = gh;
      }
      this._deflect(nx, nz, o);
    }
  }

  _deflect(nx, nz, o) {
    const ground = this.grounded;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const hx = ground ? this.heading.x : hs > 0.01 ? this.vel.x / hs : 0;
    const hz = ground ? this.heading.z : hs > 0.01 ? this.vel.z / hs : 0;
    const dot = hx * nx + hz * nz;
    if (dot >= 0) return; // 已经在往外走了（贴着边缘滑过去），不再扣速度
    // 去掉朝向障碍物的分量，剩下沿边缘的方向；正面撞上时按左右偏移选一边
    let tx = hx - nx * dot;
    let tz = hz - nz * dot;
    let tl = Math.hypot(tx, tz);
    if (tl < 0.15) {
      const side = (this.pos.x - o.x) * -nz + (this.pos.z - o.z) * nx >= 0 ? 1 : -1;
      tx = -nz * side;
      tz = nx * side;
      tl = 1;
    }
    let ox = tx / tl + nx * 0.5;
    let oz = tz / tl + nz * 0.5;
    const ol = Math.hypot(ox, oz);
    ox /= ol;
    oz /= ol;
    // 坐雪橇时撞上：雪橇炸掉，角色顺着边缘绕过去，不减速、不硬直
    const saved = this.sled;
    const keepK = saved ? 1 : BIG_HIT_KEEP;
    if (ground) {
      this.heading.set(ox, 0, oz);
      this.speed *= keepK;
    } else {
      const keep = hs * keepK;
      this.vel.x = ox * keep;
      this.vel.z = oz * keep;
    }
    if (saved) {
      this._crashSled('bump');
      return;
    }
    this.stun = BIG_HIT_STUN;
    this.events.push({ type: 'bump', obstacle: o });
  }

  // 落地判定（设计文档 3.2）
  _land() {
    const P = this.P;
    const grad = this.course.gradAt(this.pos.x, this.pos.z, this.grad);
    const n = _tmp.set(-grad.gx, 1, -grad.gz).normalize();
    const v = this.vel;
    const vn = v.dot(n);
    const impact = Math.max(0, -vn);
    const before = Math.hypot(v.x, v.z);

    // 速度在地面上的分量
    const tx = v.x - n.x * vn;
    const ty = v.y - n.y * vn;
    const tz = v.z - n.z * vn;
    const tangentSpeed = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const ths = Math.hypot(tx, tz);
    if (ths > 0.01) this.heading.set(tx / ths, 0, tz / ths);

    const airTime = this.airTime;
    const wasDiving = this.diving;
    this.grounded = true;
    this.diving = false;
    this.airTime = 0;

    // 速度超过上限时不立即截掉（雪橇刚没了），只是不再往上涨
    const cap = Math.max(P.maxSpeed, before);

    // 坐雪橇时：失误或硬着陆只炸掉雪橇，角色保持速度（设计文档 3.8）
    if (this.sled && this.trick) {
      this.trick = null;
      this.trickPress = null;
      this.speed = Math.min(Math.max(tangentSpeed, this.sledSpeed), Math.max(cap, this.sledSpeed));
      this._crashSled('bail');
      return;
    }

    // 姿势或动作没做完就落地：失误，扣 70% 的速度，不算完美落地（设计文档 3.6）
    if (this.trick) {
      const name = this.trick.name;
      this.trick = null;
      this.trickPress = null;
      this.speed = Math.min(tangentSpeed * BAIL_KEEP, cap);
      this.stun = BAIL_STUN;
      this.events.push({ type: 'bail', gain: this.speed - before, name });
      return;
    }
    this.trickPress = null;

    if (airTime < P.minAirTime) {
      this.speed = this.sled ? this.sledSpeed : tangentSpeed;
      return;
    }

    // 是否落在顺着前进方向的下坡上
    const h = this.heading;
    const slopeAlong = grad.gx * h.x + grad.gz * h.z;
    const downDeg = Math.atan(-slopeAlong) / DEG;
    const gl = Math.hypot(grad.gx, grad.gz);
    const cosToDownhill = gl > 1e-4 ? -slopeAlong / gl : 0;
    const goodSlope = downDeg >= P.perfectMinSlopeDeg && cosToDownhill >= Math.cos(P.perfectMaxAngleDeg * DEG);

    let type;
    if (wasDiving && goodSlope) {
      type = 'perfect';
      this.speed = tangentSpeed + impact * P.perfectConvert + P.perfectBonus;
    } else if (impact > P.hardImpactSpeed && !goodSlope && this.invincible > 0) {
      // 无敌：硬着陆不算，没有减速惩罚，雪橇车也不坏
      type = 'normal';
      this.speed = this.sled ? this.sledSpeed : tangentSpeed;
    } else if (impact > P.hardImpactSpeed && !goodSlope && this.sled) {
      this.speed = this.sledSpeed;
      this._crashSled('hard');
      return;
    } else if (impact > P.hardImpactSpeed && !goodSlope) {
      type = 'hard';
      this.speed = tangentSpeed * (1 - P.hardLoss);
      this.stun = P.hardStun;
    } else {
      type = 'normal';
      this.speed = tangentSpeed * (1 - P.normalLoss);
    }
    this.speed = this.sled ? this.sledSpeed : Math.min(this.speed, cap);
    this.events.push({ type, gain: this.speed - before, impact, slopeDeg: downDeg });
  }
}
