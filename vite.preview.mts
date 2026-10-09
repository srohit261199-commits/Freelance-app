// Builds the browser preview: the real app screens with src/preview/mockHub.ts standing in for Electron.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/preview',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist-preview',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
