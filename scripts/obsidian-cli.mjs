// Development helper: use the official Obsidian CLI, preserving code as one argument.
// Example: node scripts/obsidian-cli.mjs "My Vault" eval .test-build/probe.js
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const [vault, command, ...args] = process.argv.slice(2);
if (!vault || !command) throw Error('Specify vault and command.');
const executable =
  process.env.OBSIDIAN_CLI ||
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.com');
// The Windows launcher cannot safely forward large code arguments with nested quotes.
// Pass a short expression that reads our local QA script instead.
const scriptPath =
  command === 'eval' ? resolve(args[0]).replaceAll('\\', '/').replaceAll("'", "\\'") : '';
const parameters = [
  `vault=${vault}`,
  command,
  ...(command === 'eval'
    ? [`code=eval(require('fs').readFileSync('${scriptPath}','utf8'))`]
    : args),
];
try {
  process.stdout.write(
    execFileSync(executable, parameters, { encoding: 'utf8', timeout: 45000, windowsHide: true }),
  );
} catch (error) {
  console.error(error.message);
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  process.exitCode = 1;
}
