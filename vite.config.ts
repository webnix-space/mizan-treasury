import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 20000,
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        if (
          log.code === 'IMPORT_IS_UNDEFINED' ||
          log.message?.includes('isomorphic-ws') ||
          log.message?.includes('WebSocket')
        ) {
          return;
        }
        defaultHandler(level, log);
      },
    },
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === 'IMPORT_IS_UNDEFINED' ||
          warning.message?.includes('isomorphic-ws') ||
          warning.message?.includes('WebSocket')
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
  define: {
    'global': 'globalThis',
  },
});
