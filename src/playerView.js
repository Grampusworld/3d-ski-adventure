// 角色的外观：企鹅少女模型（见 character.js），脚下有圆形影子帮助判断落点。

import * as THREE from 'three';
import { Character } from './character.js';

const TURN_SPEED = Math.PI / 0.25; // 转身 180° 用 0.25 秒
const UP = new THREE.Vector3(0, 1, 0);

export class PlayerView {
  constructor(scene) {
    this.character = new Character();
    this.group = this.character.root;
    scene.add(this.group);
    this.yaw = Math.PI;

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 16),
      new THREE.MeshBasicMaterial({ color: '#3a2340', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    this._n = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 0, 1);
    this.surfaceUp = new THREE.Vector3(0, 1, 0); // 角色当前的「上」方向（平滑过）
    this._qTilt = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
  }

  land(type) {
    this.character.land(type);
  }

  // 被雪崩吞没时隐藏角色和影子
  setVisible(v) {
    this.hidden = !v;
    this.group.visible = v;
    if (!v) this.shadow.visible = false;
  }

  // opts: { dt, faceYaw（要面向镜头时传镜头所在的方向，否则传 null）, P }
  update(player, course, { dt, faceYaw, P, snap = false, cheer = false }) {
    const p = player.pos;
    this.group.position.copy(p);

    // 起跑前正面朝镜头，起跑后朝前进方向
    let target = this.yaw;
    if (faceYaw !== null && faceYaw !== undefined) target = faceYaw;
    else {
      const h = player.grounded ? player.heading : { x: player.vel.x, z: player.vel.z };
      if (Math.abs(h.x) + Math.abs(h.z) > 1e-3) target = Math.atan2(h.x, h.z);
    }
    let diff = target - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = TURN_SPEED * dt;
    this.yaw += snap ? diff : Math.max(-maxTurn, Math.min(maxTurn, diff));

    // 贴合地面：在地面上时让角色的「上」对齐地面法线，
    // 否则在两侧护坡这样的陡坡上，竖直的身体会有一半埋进坡里；离地后慢慢回到竖直
    const gh = course.heightAt(p.x, p.z);
    const g = course.gradAt(p.x, p.z);
    this._n.set(-g.gx, 1, -g.gz).normalize();
    const upTarget = player.grounded && gh !== null ? this._n : UP;
    const rate = player.grounded ? 15 : 4;
    if (snap) this.surfaceUp.copy(upTarget);
    else this.surfaceUp.lerp(upTarget, 1 - Math.exp(-rate * dt)).normalize();
    this._qTilt.setFromUnitVectors(UP, this.surfaceUp);
    this._qYaw.setFromAxisAngle(UP, this.yaw);
    this.group.quaternion.multiplyQuaternions(this._qTilt, this._qYaw);

    this.character.update(dt, {
      grounded: player.grounded,
      diving: player.diving,
      speed: player.currentSpeed,
      vy: player.vel.y,
      hspeed: player.horizontalSpeed,
      stun: player.stun,
      cheer,
      riding: player.sled || this.forceSled,
      boosted: player.sledBoosted,
      glow: player.invincible > 0 ? Math.min(1, player.invincible / 0.3) : 0, // 最后 0.3 秒渐渐褪去
      trick: player.trick ? { kind: player.trick.kind, id: player.trick.id, p: Math.min(1, player.trick.t / player.trick.dur) } : null,
      slideEnter: P.slideEnterSpeed,
      slideExit: P.slideExitSpeed,
    });

    if (gh === null || this.hidden) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    this.shadow.position.set(p.x, gh + 0.06, p.z);
    this.shadow.quaternion.setFromUnitVectors(this._up, this._n);
    const height = Math.max(0, p.y - gh);
    const s = 1 + height * 0.02;
    this.shadow.scale.set(s, s, s);
    this.shadow.material.opacity = Math.max(0.15, 0.5 - height * 0.006);
  }
}
