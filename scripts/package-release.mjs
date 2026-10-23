import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { RELEASE } from '../src/release.js';
import { thirdPartyNotices } from './third-party-notices.mjs';
import { localToolsPackage } from './local-tools-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.release-artifacts');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension.manifest.json')));
if (manifest.version !== RELEASE.version || !manifest.js.includes(RELEASE.build)) throw new Error('Release manifest mismatch');
const buildModules = ['index.js', ...(await fs.readdir(path.join(root, 'extension-dist/assets'))).filter((name) => name.endsWith('.js')).map((name) => `assets/${name}`)];
const moduleText = await Promise.all(buildModules.map((name) => fs.readFile(path.join(root, 'extension-dist', name), 'utf8')));
if (!moduleText.some((text) => text.includes(RELEASE.build))) throw new Error('Build marker missing');
const protection = JSON.parse(await fs.readFile(path.join(root, 'extension-dist/build-protection.json'), 'utf8'));
if (protection.version !== RELEASE.version || protection.build !== RELEASE.build || protection.sourceMaps !== false
  || !protection.files.some((file) => file.name === 'index.js' && file.protected)) throw new Error('Protected build required');
if (protection.files.length !== buildModules.length) throw new Error('Incomplete protection report');
for (const name of buildModules) {
  const bytes = await fs.readFile(path.join(root, 'extension-dist', name));
  if (protection.files.filter((file) => file.name === name && file.sha256 === digest(bytes)).length !== 1
    || !bytes.toString('utf8').startsWith('/*! Linghuashi')) throw new Error(`Unverified release module: ${name}`);
}
const notices = await thirdPartyNotices();
await fs.writeFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), notices);
await fs.mkdir(output, { recursive: true });
const frontend = new JSZip(), backend = new JSZip(), repository = new JSZip();
const files = [], scans = [];
const privateName = /(?:^|\/)(?:allowed-accounts\.json|secrets\.json|settings\.json|\.env(?:\..*)?|.*\.pem|.*\.key)$/;
async function add(zip, name, bytes, scan = false) {
  if (privateName.test(name)) throw new Error(`Private file in release allowlist: ${name}`);
  if (scan && /\.(?:js|mjs|json|html|md|yml|yaml|sh|ps1|py|txt)$/.test(name)) {
    const text = bytes.toString('utf8');
    if (/\b(?:pst-|STD-)[A-Za-z0-9_-]{18,}|\bsk-[A-Za-z0-9_-]{30,}/.test(text)
      || /156\.239\.242\.3|45\.207\.199\.116|C:[/\\]Users[/\\]22678/.test(text)) {
      throw new Error(`Sensitive content detected in ${name}`);
    }
    scans.push(name);
  }
  zip.file(name, bytes, { createFolders: false });
}
async function walk(directory, prefix, zip, scan = false) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Release must not contain symbolic links');
    const name = `${prefix}${entry.name}`;
    if (name.endsWith('.map')) throw new Error(`Source maps must not be published: ${name}`);
    if (privateName.test(name) || ['.DS_Store', '__pycache__', '.venv'].includes(entry.name) || name.endsWith('.pyc')
      || name === 'server/linghuashi-local-tools/data') continue;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${name}/`, zip, scan);
    else if (entry.isFile()) await add(zip, name, await fs.readFile(path.join(directory, entry.name)), scan);
  }
}
await add(frontend, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'qq-group-1076122953.png']) {
  await add(frontend, name, await fs.readFile(path.join(root, name)), true);
}
await walk(path.join(root, 'docs'), 'docs/', frontend, true);
await walk(path.join(root, 'LICENSES'), 'LICENSES/', frontend, true);
await add(frontend, 'examples/linghuashi-client.js', await fs.readFile(path.join(root, 'examples/linghuashi-client.js')), true);
await walk(path.join(root, 'extension-dist'), 'dist/', frontend, true);
for (const name of ['index.mjs', 'task-ledger.mjs', 'image-versions.mjs', 'reference-assets.mjs', 'reference-actions.mjs', 'backup-records.mjs']) {
  await add(backend, `linghuashi-storage/${name}`, await fs.readFile(path.join(root, 'server/linghuashi-storage', name)), true);
}
await add(backend, 'linghuashi-storage/LICENSE', await fs.readFile(path.join(root, 'LICENSE')), true);
await add(backend, 'linghuashi-storage/THIRD-PARTY-NOTICES.txt', Buffer.from(notices), true);
await walk(path.join(root, 'LICENSES'), 'linghuashi-storage/LICENSES/', backend, true);
for (const [label, zip] of [['ai-brush-hug-st', frontend], ['linghuashi-storage', backend]]) {
  const name = `${label}-v${RELEASE.version}.zip`, bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fs.writeFile(path.join(output, name), bytes);
  files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
}
const localName = `linghuashi-local-tools-v${RELEASE.version}.zip`, localBytes = await localToolsPackage();
await fs.writeFile(path.join(output, localName), localBytes);
files.push({ name: localName, bytes: localBytes.length, sha256: digest(localBytes) });
const checksums = files.map((item) => `${item.sha256}  ${item.name}`).join('\n') + '\n';
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), checksums);
for (const directory of ['src', 'server', 'scripts', 'docs', 'examples', 'LICENSES']) await walk(path.join(root, directory), `${directory}/`, repository, true);
for (const name of ['package.json', 'package-lock.json', 'vite.config.js', 'vite.extension.config.js',
  'index.html', 'preview.html', 'extension-ui.html', 'extension.manifest.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt',
  'qq-group-1076122953.png', '.gitignore']) {
  await add(repository, name, await fs.readFile(path.join(root, name)), true);
}
await add(repository, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
await walk(path.join(root, 'extension-dist'), 'dist/', repository, true);
for (const file of files) await add(repository, `.release-artifacts/${file.name}`, await fs.readFile(path.join(output, file.name)));
await add(repository, '.release-artifacts/SHA256SUMS.txt', Buffer.from(checksums));
const bytes = await repository.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
await fs.writeFile(path.join(output, 'release-import.zip'), bytes);
const report = { version: RELEASE.version, build: RELEASE.build, repository: RELEASE.repository,
  files, importSha256: digest(bytes), importBytes: bytes.length, scannedFiles: new Set(scans).size,
  entrySha256: digest(await fs.readFile(path.join(root, 'extension-dist/index.js'))),
  accountDataExcluded: true, protectionProfile: protection.profile, protectedModules: protection.files.filter((file) => file.protected).length,
  sourceMapsExcluded: true, legacyLicenseIncluded: true, thirdPartyNoticesIncluded: true };
await fs.writeFile(path.join(output, 'release-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
