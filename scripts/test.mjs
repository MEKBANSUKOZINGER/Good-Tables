import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.test-build', { recursive: true });
await build({
  entryPoints: ['tests/core.test.ts', 'tests/render.test.ts'],
  outdir: '.test-build',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const result = spawnSync(
  process.execPath,
  ['--test', '.test-build/core.test.js', '.test-build/render.test.js'],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
