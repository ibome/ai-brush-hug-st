import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { localToolsPackagePlugin } from './scripts/local-tools-package.mjs';

export default defineConfig({
  plugins: [localToolsPackagePlugin()],
  base: process.env.DRAW_BASE_PATH || '/',
  server: {
    host: '127.0.0.1',
    strictPort: true,
    allowedHosts: (process.env.DRAW_ALLOWED_HOSTS || '').split(',').filter(Boolean),
  },
  build: {
    outDir: 'dist-preview',
    cssTarget: ['safari15', 'chrome90', 'firefox90'],
    rollupOptions: {
      input: {
        workbench: fileURLToPath(new URL('./index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
    },
  },
});
