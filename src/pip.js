// 画中画（设计文档 5.3）：起跑后在右上角用第二台镜头实时渲染滑雪站，看着它被雪崩淹没。
// 镜头固定在滑雪站侧前方；滑雪站完全被埋后再停留 1.5 秒，然后淡出。

import * as THREE from 'three';

const HOLD_AFTER_BURIED = 1.5;
const FADE = 0.45;

export class PictureInPicture {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 9000);
    this.frame = document.getElementById('pip');
    this.fadeEl = document.getElementById('pip-fade');
    this.active = false;
  }

  start(world) {
    const st = world.station;
    const y = world.rawHeight(st.x, st.z);
    // 从滑雪站右前方、略高的位置看过去，框住木屋和后面的山坡
    this.camera.position.set(st.x + 52, y + 17, st.z + 44);
    this.camera.lookAt(st.x - 6, y + 16, st.z - 55);
    this.stationZ = st.z;
    this.time = 0;
    this.endAt = null;
    this.active = true;
    this.frame.classList.remove('hidden');
    this.fadeEl.style.opacity = 0;
  }

  stop() {
    this.active = false;
    this.frame.classList.add('hidden');
  }

  // avalancheZ：雪崩前沿；木屋整个被埋后开始计时，然后淡出
  update(dt, avalancheZ) {
    if (!this.active) return;
    this.time += dt;
    if (this.endAt === null && avalancheZ > this.stationZ + 24) this.endAt = this.time + HOLD_AFTER_BURIED;
    if (this.endAt !== null) {
      const t = (this.time - this.endAt) / FADE;
      this.fadeEl.style.opacity = Math.max(0, Math.min(1, t));
      if (t >= 1) this.stop();
    }
  }

  render(env) {
    if (!this.active) return;
    const rect = this.frame.getBoundingClientRect();
    const r = this.renderer;
    const h = window.innerHeight;
    const x = rect.left;
    const y = h - rect.bottom; // WebGL 的视口原点在左下角
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    env.update(this.camera);
    r.setScissorTest(true);
    r.setScissor(x, y, rect.width, rect.height);
    r.setViewport(x, y, rect.width, rect.height);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, h);
  }
}
