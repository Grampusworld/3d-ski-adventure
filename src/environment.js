// 天空、雾和灯光：雪天的色调（设计文档 8.1）。
// 淡蓝灰的天空、地平线偏白、白色雪雾；一盏低角度的暖阳从前方照过来，
// 所以朝前的下坡被照成暖色，背光的上坡偏冷蓝。

import * as THREE from 'three';

const SKY_TOP = new THREE.Color('#8ea8cc');
const SKY_HORIZON = new THREE.Color('#edf2f8');
const SKY_BOTTOM = new THREE.Color('#dde5ef');
const FOG = new THREE.Color('#e8eef5');

export function createEnvironment(scene) {
  scene.fog = new THREE.Fog(FOG, 160, 1150);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP },
        horizon: { value: SKY_HORIZON },
        bottom: { value: SKY_BOTTOM },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 bottom;
        varying vec3 vDir;
        void main() {
          float h = normalize(vDir).y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.45));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#f4f8ff', '#8e9cba', 1.7));
  const sun = new THREE.DirectionalLight('#ffdcbc', 1.9);
  sun.position.set(-0.35, 0.45, 1);
  scene.add(sun);

  return {
    // 天空球跟着当前渲染的镜头走
    update(camera) {
      sky.position.copy(camera.position);
    },
  };
}
