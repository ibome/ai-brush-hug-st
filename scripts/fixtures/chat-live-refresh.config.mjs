import { createReadStream } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';

export default mergeConfig(base, defineConfig({
  plugins: [{
    name: 'chat-live-refresh-fixture-image',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/user/images/linghuashi/lh-fixture-lake.jpg') return next();
        response.setHeader('Content-Type', 'image/jpeg');
        response.setHeader('Cache-Control', 'no-store');
        createReadStream(new URL('../../dist/assets/lake.jpg', import.meta.url)).pipe(response);
      });
    },
  }],
}));
