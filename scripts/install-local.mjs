import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const vault = process.argv[2];
if (!vault) throw Error('Usage: node scripts/install-local.mjs <vault-path> [--enable]');
const config = join(resolve(vault), '.obsidian'),
  target = join(config, 'plugins', 'good-tables');
await mkdir(target, { recursive: true });
for (const name of ['main.js', 'styles.css', 'manifest.json'])
  await copyFile(name, join(target, name));
if (process.argv.includes('--enable')) {
  const path = join(config, 'community-plugins.json');
  let ids = [];
  try {
    ids = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    throw Error('Invalid community-plugins.json; not overwritten.');
  if (!ids.includes('good-tables'))
    await writeFile(path, JSON.stringify([...ids, 'good-tables'], null, 2) + '\n');
}
console.log(`Installed Good Tables to ${target}. Reload Obsidian to load this build.`);
