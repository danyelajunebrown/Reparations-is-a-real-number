import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// loadEnv reads .env, .env.production etc. properly so VITE_BASE_PATH
// in .env.production is available at build time without CLI overrides.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/',
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'd3': ['d3'],
            'ethers': ['ethers'],
            'react-vendor': ['react', 'react-dom', 'react-router-dom']
          }
        }
      }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true
        }
      }
    }
  };
});
