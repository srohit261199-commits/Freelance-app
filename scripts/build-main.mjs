// Bundles the Electron main and preload scripts; the window UI is built by Vite.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: { 'main/index': 'src/main/index.ts', 'preload/index': 'src/preload/index.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'exceljs'],
  sourcemap: true,
  logLevel: 'info',
};

// The window and taskbar icon; the .exe icon itself comes from electron-builder.
mkdirSync('dist', { recursive: true });
copyFileSync('build/icon.png', 'dist/icon.png');

if (watch) await (await context(options)).watch();
else await build(options);
