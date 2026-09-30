import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const apiProxy = {
  target: 'http://127.0.0.1:8000',
  changeOrigin: true,
};

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': apiProxy,
      '/health': apiProxy,
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/api': apiProxy,
      '/health': apiProxy,
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lobby: fileURLToPath(new URL('./lobby.html', import.meta.url)),
        battle: fileURLToPath(new URL('./battle.html', import.meta.url)),
        assets: fileURLToPath(new URL('./asset-preview.html', import.meta.url)),
      },
    },
  },
});
