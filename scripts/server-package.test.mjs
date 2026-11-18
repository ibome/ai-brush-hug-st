import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { storageModules } from './server-package.mjs';

const source = fileURLToPath(new URL('../server/linghuashi-storage/', import.meta.url));
const execute = promisify(execFile);
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-component-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the server package starts from an extracted archive without repository dependencies', async (t) => {
  const directory = await temporary(t), zip = new JSZip();
  for (const name of storageModules) zip.file(name, await fs.readFile(path.join(source, name)));
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }), { checkCRC32: true });
  for (const entry of Object.values(archive.files)) {
    await fs.writeFile(path.join(directory, entry.name), await entry.async('nodebuffer'));
  }
  const installed = await import(pathToFileURL(path.join(directory, 'index.mjs')));
  assert.equal(typeof installed.createStorageService, 'function');
  const service = installed.createStorageService();
  const accountRoot = path.join(directory, 'account');
  await fs.mkdir(accountRoot);
  const user = { profile: { handle: 'fixture' }, directories: { root: accountRoot, userImages: path.join(accountRoot, 'user/images') } };
  assert.equal((await service.dispatch(user, 'backup/status')).version, '0.21.3');
  await service.drain();
});

test('the installer preserves account restrictions and backs up every replaced dependency', async (t) => {
  const directory = await temporary(t), target = path.join(directory, 'plugins/linghuashi-storage');
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(directory, 'config.yaml'), 'enableServerPlugins: true\n');
  await fs.writeFile(path.join(directory, 'src/server-plugins.js'), '');
  await fs.writeFile(path.join(target, 'allowed-accounts.json'), '["fixture"]\n');
  await fs.writeFile(path.join(target, 'assistant-plan.mjs'), 'previous assistant dependency\n');
  await execute(process.execPath, [fileURLToPath(new URL('./install-server.mjs', import.meta.url)), '--st-root', directory]);
  assert.equal(await fs.readFile(path.join(target, 'allowed-accounts.json'), 'utf8'), '["fixture"]\n');
  const backups = await fs.readdir(path.join(directory, 'backups/linghuashi'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(directory, 'backups/linghuashi', backups[0], 'assistant-plan.mjs'), 'utf8'),
    'previous assistant dependency\n');
  const installed = await import(pathToFileURL(path.join(target, 'index.mjs')));
  assert.equal(typeof installed.createStorageService, 'function');
});
