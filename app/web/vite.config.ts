import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7717', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:7717', changeOrigin: true },
      '/mcp': { target: 'http://127.0.0.1:7717', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
