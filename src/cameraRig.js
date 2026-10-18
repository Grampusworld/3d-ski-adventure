// 第三人称镜头：鼠标控制朝向，速度越快 FOV 越大、镜头越远（设计文档 8.2）。

import * as THREE from 'three';
import { clamp, lerp } from './math.js';

export class CameraRig {
  constructor(camera, P) {
    this.camera = camera;
    this.P = P;
    this.yaw = 0; // 0 = 朝 +Z
    this.pitch = 0.28; // 正数 = 从上往下看
    this.shake = 0;
    this.diveTilt = 0; // 俯冲时额外往下看的角度
    this.pos = new THREE.Vector3();
    this.fov = P.fovMin;
    this.fovExtra = 0; // 额外加宽的视野（度）：雪橇车第二档时用
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  look(dx, dy) {
    const s = this.P.mouseSensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch + dy * s, -0.35, 1.2);
  }

  addShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  // 让镜头直接跳到目标位置（开局、重生时用）
  snap(player, course) {
    this.update(1, player, course, true);
  }

  update(dt, player, course, snap = false) {
    const P = this.P;
    const speed = player.currentSpeed;
    const t = clamp((speed - P.cruiseSpeed * 0.5) / Math.max(1, P.fovSpeedRef - P.cruiseSpeed * 0.5), 0, 1);

    // 俯冲时镜头逐渐往下多看约 12°，方便看清落点（设计文档 3.5）
    const diveTarget = player.diving && !player.grounded ? 0.21 : 0;
    this.diveTilt += (diveTarget - this.diveTilt) * (1 - Math.exp(-4 * dt));
    const pitch = Math.min(1.35, this.pitch + this.diveTilt);

    const f = this.forward();
    const dist = P.camDistance * (1 + 0.3 * t);
    const target = player.pos;
    this._desired.set(
      target.x - f.x * dist * Math.cos(pitch),
      target.y + 0.95 + dist * Math.sin(pitch) + 0.6, // 角色高 1.4 米
      target.z - f.z * dist * Math.cos(pitch),
    );

    const k = snap ? 1 : 1 - Math.exp(-14 * dt);
    this.pos.lerp(this._desired, k);
    // 镜头不能钻到地面下面
    const gh = course.heightAt(this.pos.x, this.pos.z);
    if (gh !== null && this.pos.y < gh + 1) this.pos.y = gh + 1;

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-7 * dt);
    }

    this._look.set(target.x + f.x * 4, target.y + 1.05, target.z + f.z * 4);
    this.camera.lookAt(this._look);

    const fovTarget = lerp(P.fovMin, P.fovMax, t) + this.fovExtra;
    // 视野变宽时跟得快一点（加速那一下要有冲击感），变窄时慢慢收回
    this.fov = snap ? fovTarget : lerp(this.fov, fovTarget, 1 - Math.exp(-(fovTarget > this.fov ? 14 : 4) * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
