import fs from 'node:fs/promises';
import JSZip from 'jszip';

export async function localToolsPackage() {
  const root = new URL('../server/linghuashi-local-tools/', import.meta.url);
  const zip = new JSZip();
  for (const name of ['service.py', 'worker.py', 'models.py', 'requirements.txt', 'install.ps1', 'start.ps1',
    'install.sh', 'start.sh', 'diagnostics.py', 'check-env.ps1', 'check-env.sh', 'README.md', 'THIRD-PARTY-NOTICES.txt']) {
    zip.file(`linghuashi-local-tools/${name}`, await fs.readFile(new URL(name, root)));
  }
  zip.file('linghuashi-local-tools/LICENSE', await fs.readFile(new URL('../LICENSE', import.meta.url)));
  zip.file('linghuashi-local-tools/LICENSES/Apache-2.0.txt',
    await fs.readFile(new URL('../LICENSES/Apache-2.0.txt', import.meta.url)));
  zip.file('linghuashi-local-tools/LICENSES/BSD-2-Clause-legacy.txt',
    await fs.readFile(new URL('../LICENSES/BSD-2-Clause-legacy.txt', import.meta.url)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function localToolsPackagePlugin() {
  const id = '\0linghuashi-local-tools-package';
  let dev = false;
  return {
    name: 'linghuashi-local-tools-package',
    configResolved(config) { dev = config.command === 'serve'; },
    resolveId(source) { if (source === 'virtual:linghuashi-local-tools-package') return id; },
    async load(source) {
      if (source !== id) return;
      if (dev) return 'export default "/linghuashi-local-tools.zip";';
      const bytes = await localToolsPackage();
      const ref = this.emitFile({ type: 'asset', name: 'linghuashi-local-tools.zip', source: bytes });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(server) {
      server.middlewares.use('/linghuashi-local-tools.zip', async (_request, response) => {
        response.setHeader('Content-Type', 'application/zip');
        response.end(await localToolsPackage());
      });
    },
  };
}
