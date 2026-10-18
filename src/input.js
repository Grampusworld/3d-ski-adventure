// 键盘和鼠标输入。鼠标视角依赖指针锁定（点击画面后锁定，Esc 解除）。
// 方向键左右也能转视角，方便在不能锁定鼠标的环境里测试。

const BLOCKED_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.rightDown = false;
    this.jumpQueued = false;
    this.pressed = new Set(); // 本帧按下的键（只触发一次的操作用）
    this.clicked = false; // 本帧点过鼠标

    window.addEventListener('keydown', (e) => {
      if (BLOCKED_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (e.code === 'Space') this.jumpQueued = true;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.rightDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      this.clicked = true;
      if (e.button === 2 && e.target === dom) this.rightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rightDown = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  lock() {
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch {
      // 不支持指针锁定时，仍然可以用方向键转视角
    }
  }

  // 前后（W/S）和左右（D/A），各为 -1、0、1
  moveAxis() {
    const k = this.keys;
    return {
      forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      right: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    };
  }

  keyTurn() {
    const k = this.keys;
    return (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
  }

  get dive() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.rightDown;
  }

  takeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  takeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  // 本帧有没有新按下任意键或点击鼠标（一直按着的键不算）
  anyPressed() {
    return this.pressed.size > 0 || this.clicked;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked = false;
  }
}
