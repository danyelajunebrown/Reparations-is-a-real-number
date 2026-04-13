import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages deploys to /Reparations-is-a-real-number-main/ or similar.
// Set VITE_BASE_PATH in env to override for custom domain.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
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
});
