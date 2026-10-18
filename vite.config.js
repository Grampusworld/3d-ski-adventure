import { defineConfig } from 'vite';

// 打包时 base 设为 GitHub Pages 的仓库子路径；开发服务器仍在根路径 /
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/3d-ski-adventure/' : '/',
  server: { port: 5173 },
}));
