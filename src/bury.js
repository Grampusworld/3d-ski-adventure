// 雪崩掩埋（设计文档 8.7）：所有会被埋掉的东西共用这组 uniform。
// uAvalanche 是雪崩前沿的位置（z）；uStart 是雪崩出现的位置，比它更靠后的东西不受影响
// （雪崩是从那里冲下来的，那之前的山坡保持原样，避免开始时一大片地面瞬间变平）。

export const buryUniforms = {
  uAvalanche: { value: -1e9 },
  uStart: { value: -1e9 },
};

// 着色器里算「这个点被埋了多少」（0～1）
export const BURY_GLSL = `
uniform float uAvalanche;
uniform float uStart;
float buryAmount(float z) {
  return smoothstep(-3.0, 20.0, uAvalanche - z) * smoothstep(uStart - 40.0, uStart + 5.0, z);
}`;

// 物件（木屋、缆车、树、石头）：每个顶点带 aAnchorZ（物件所在的 z）和 aBury（被埋时往下沉多少，
// 用物件自己的坐标单位），整个物件随雪崩经过一起沉到雪下面。
export function patchBuryMaterial(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAvalanche = buryUniforms.uAvalanche;
    shader.uniforms.uStart = buryUniforms.uStart;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aAnchorZ;\nattribute float aBury;\n${BURY_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.y -= buryAmount(aAnchorZ) * aBury;`);
  };
  return mat;
}
