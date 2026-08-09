import { build, context } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
const entryPoints = ['src/background.ts', 'src/popup.ts', 'src/dashboard.ts'];
const options = {
  absWorkingDir: root,
  entryPoints,
  outdir: out,
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  sourcemap: true,
  define: {
    'process.env.API_ORIGIN': JSON.stringify(process.env.API_ORIGIN || 'https://discord-server-leaver-production.up.railway.app'),
  },
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching extension');
} else {
  await build(options);
}
