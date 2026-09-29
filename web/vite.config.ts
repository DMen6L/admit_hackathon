import { defineConfig } from 'vite';

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
});
