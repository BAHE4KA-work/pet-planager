import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: 'localhost',
    hmr: process.env.TAURI_DEV_HOST
      ? { host: process.env.TAURI_DEV_HOST, protocol: 'ws', port: 3001 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
});
