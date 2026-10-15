import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：React SPA，开发时把 /api 代理到本地 wrangler pages dev（8788）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
