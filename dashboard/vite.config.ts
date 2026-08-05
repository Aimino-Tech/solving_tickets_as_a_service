import path from 'node:path';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Live API port written by scripts/dev-api.sh wins over VITE_API_PORT.
  const portFile = path.resolve(__dirname, '.api-port');
  const livePort = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim() : '';
  const apiPort = livePort || env.VITE_API_PORT || '3001';

  return {
    base: '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api/v1/auth': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/mcp': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/discovery': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            recharts: ['recharts'],
          },
        },
      },
    },
  };
});
