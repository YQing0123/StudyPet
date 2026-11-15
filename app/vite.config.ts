import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: false,
    proxy: {
      '/api': { target: process.env.BANXUE_API_URL || 'http://127.0.0.1:7717', changeOrigin: true },
      '/media': { target: process.env.BANXUE_API_URL || 'http://127.0.0.1:7717', changeOrigin: true },
      '/mcp': { target: process.env.BANXUE_API_URL || 'http://127.0.0.1:7717', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
