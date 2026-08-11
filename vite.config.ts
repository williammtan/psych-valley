import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
  },
});
