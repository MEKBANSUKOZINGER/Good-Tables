import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const vaultPath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const folder = resolve(vaultPath ?? '.', 'qa-vault'),
  note = `${folder}/Good Tables QA.md`;
await mkdir(folder, { recursive: true });
try {
  await access(note);
  if (!process.argv.includes('--reset'))
    throw Error('QA note already exists. Use --reset only to replace the generated QA note.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(
  note,
  '# Good Tables QA\n\nGenerated test note. The live QA suite resets this note.\n\n| Item | Amount | Note |\n| --- | ---: | --- |\n| A | 1 | first |\n| B | 3 | second |\n| C | 0 | third |\n\nOutside text must remain intact.\n',
);
console.log(`Open this generated note in the target Obsidian vault: ${note}`);
