// Runs Vite, rebuilds main/preload on change and starts Electron against the dev server.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
const esb = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });
setTimeout(() => {
  const electron = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
    shell: process.platform === 'win32',
  });
  electron.on('exit', () => {
    esb.kill();
    server.close();
    process.exit(0);
  });
}, 1500);
