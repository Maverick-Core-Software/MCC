import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const prometheusUrl = process.env.PROMETHEUS_URL || 'http://192.168.1.12:9090';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts']
        }
      }
    }
  },
  server: {
    proxy: {
      '/api/query': {
        target: prometheusUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/query/, '/api/v1/query')
      }
    }
  }
});
