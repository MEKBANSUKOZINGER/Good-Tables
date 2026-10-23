import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const target = `release/${manifest.id}`;
await mkdir(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, `${target}/${file}`);
await writeFile(
  'release/INSTALL.txt',
  `Copy the good-tables folder into your vault's .obsidian/plugins/ folder, reload Obsidian and enable Good Tables. Version ${manifest.version}.\n`,
);
console.log(`Packaged ${target}`);
