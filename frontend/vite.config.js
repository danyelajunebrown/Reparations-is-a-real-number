import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

// Build identity — baked into the bundle + emitted as dist/version.json so a running client can detect
// it is stale. GitHub Pages cannot set cache-control headers, so a cached index.html silently points at
// old bundles (this caused a "search shows nothing" misdiagnosis); surfacing the SHA + a runtime check
// is the fix. See memory-bank/reckoning-retrieval-epistemology-and-workaround-debt.md (item B).
const BUILD_SHA = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();
const BUILD_TIME = new Date().toISOString();

// loadEnv reads .env, .env.production etc. properly so VITE_BASE_PATH
// in .env.production is available at build time without CLI overrides.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      {
        // Emit dist/version.json (fetched with cache:'no-store' at runtime to detect stale clients).
        name: 'emit-version-json',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json',
            source: JSON.stringify({ sha: BUILD_SHA, buildTime: BUILD_TIME }) });
        },
      },
    ],
    define: {
      __BUILD_SHA__: JSON.stringify(BUILD_SHA),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
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
