// Builds the preview and folds it into one HTML file for publishing as a claude.ai artifact.
// The artifact host adds <!doctype>, <head> and <body>, so the file starts with <title> and <style>.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Optional output folder, so several builds can run side by side: node scripts/make-preview.mjs /tmp/pv-a
const dir = path.resolve(process.argv[2] ?? 'dist-preview');
execSync(`npx vite build --config vite.preview.mts --outDir "${dir}" --emptyOutDir`, { stdio: 'inherit' });
const assets = path.join(dir, 'assets');
const files = readdirSync(assets);
const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(assets, f), 'utf8')).join('\n');
const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(path.join(assets, f), 'utf8')).join('\n');
const html = [
  '<title>Freelance Hub</title>',
  `<style>${css}</style>`,
  '<div id="root"></div>',
  // Libraries contain a literal U+FFFD; the escape means the same inside JS strings and regexes and keeps the file clean.
  `<script type="module">${js.replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD')}</script>`,
  '',
].join('\n');
const out = path.join(dir, 'freelance-hub-preview.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB) from ${files.join(', ')}`);
