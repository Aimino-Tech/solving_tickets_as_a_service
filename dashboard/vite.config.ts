import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.VITE_API_PORT || '3001';

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
