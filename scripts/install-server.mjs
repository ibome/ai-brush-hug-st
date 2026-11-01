import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const argument = process.argv.indexOf('--st-root');
if (argument < 0 || !process.argv[argument + 1]) throw new Error('Usage: node scripts/install-server.mjs --st-root /path/to/SillyTavern');
const root = await fs.realpath(path.resolve(process.argv[argument + 1]));
await fs.access(path.join(root, 'config.yaml'));
const loaders = await Promise.all(['src/server-plugins.js', 'src/plugin-loader.js'].map((name) => fs.access(path.join(root, name)).then(() => true, () => false)));
if (!loaders.some(Boolean)) throw new Error('SillyTavern server plugin loader not found');
const plugins = path.join(root, 'plugins');
await fs.mkdir(plugins, { recursive: true });
if (await fs.realpath(plugins) !== plugins) throw new Error('Plugin directory must not be a symbolic link');
const target = path.join(plugins, 'linghuashi-storage'), source = fileURLToPath(new URL('../server/linghuashi-storage/', import.meta.url));
await fs.mkdir(target, { recursive: true });
if (await fs.realpath(target) !== target) throw new Error('Storage plugin directory must not be a symbolic link');
const files = ['index.mjs', 'task-ledger.mjs', 'image-versions.mjs', 'reference-assets.mjs', 'reference-actions.mjs', 'backup-records.mjs'];
const backup = path.join(root, 'backups', 'linghuashi', `server-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(backup, { recursive: true, mode: 0o700 });
for (const name of files) {
  const file = path.join(target, name);
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Plugin module must not be a symbolic link');
    await fs.copyFile(file, path.join(backup, name));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const name of files) {
  const temporary = path.join(target, `${name}.next`);
  await fs.copyFile(path.join(source, name), temporary);
  await fs.chmod(temporary, 0o644);
  await fs.rename(temporary, path.join(target, name));
}
console.log(`Installed Linghuashi server component. Backup: ${backup}`);
console.log('Enable enableServerPlugins in config.yaml, then restart SillyTavern.');
