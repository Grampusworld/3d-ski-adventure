import { defineConfig } from 'vite';

// base 用相对路径，打包产物放到任何静态托管的任意子路径下都能直接打开
export default defineConfig({
  base: './',
  server: { port: 5173 },
});
