import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async (name) => JSON.parse(await fs.readFile(name, 'utf8'));

async function findPackage(directory, name) {
  for (let current = directory; ; current = path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', name);
    try {
      if ((await readJSON(path.join(candidate, 'package.json'))).name === name) return candidate;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) throw new Error(`Missing dependency license: ${name}`);
  }
}

export async function thirdPartyNotices() {
  const project = await readJSON(path.join(root, 'package.json'));
  const packages = new Map();
  async function visit(name, from, recursive = true) {
    const directory = await findPackage(from, name);
    if (packages.has(directory)) return;
    const metadata = await readJSON(path.join(directory, 'package.json'));
    const entries = await fs.readdir(directory);
    const names = entries.filter((entry) => /^licen[sc]e(?:\.|$)/i.test(entry)).sort();
    const texts = await Promise.all(names.map((entry) => fs.readFile(path.join(directory, entry), 'utf8')));
    if (!texts.length) {
      for (const entry of entries.filter((name) => /^readme(?:\.md|\.markdown|\.txt)?$/i.test(name)).sort()) {
        const text = await fs.readFile(path.join(directory, entry), 'utf8');
        if (/^#{1,6}\s+Licen[sc]e\b/im.test(text) && /Permission is hereby granted|Redistribution and use/.test(text)) texts.push(text);
      }
    }
    if (!texts.length) throw new Error(`No license text found for ${metadata.name}`);
    packages.set(directory, { name: metadata.name, version: metadata.version, license: metadata.license, texts });
    if (recursive) for (const dependency of Object.keys(metadata.dependencies || {}).sort()) await visit(dependency, directory);
  }
  for (const name of Object.keys(project.dependencies).sort()) await visit(name, root);
  for (const name of ['javascript-obfuscator', 'vite']) await visit(name, root, false);
  const sections = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return 'Linghuashi third-party notices\n\n'
    + 'Third-party components retain their own licenses. The project license does not restrict their independent use.\n'
    + 'JSZip is used under its MIT option. Build tools are listed for attribution.\n'
    + 'Historical project code remains subject to LICENSES/BSD-2-Clause-legacy.txt where applicable.\n\n'
    + sections.map((entry) => `${'='.repeat(72)}\n${entry.name} ${entry.version} (${entry.license})\n\n${entry.texts.join('\n\n')}`).join('\n\n') + '\n';
}
