import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'vite';
import extensionConfig from '../vite.extension.config.js';
import previewConfig from '../vite.config.js';

test('extension and preview CSS builds preserve media queries understood by older mobile browsers', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-css-target-'));
  try {
    const input = path.join(temporary, 'fixture.css');
    await fs.writeFile(input, '@media(max-width:720px){.nav{display:flex}}@media(min-width:721px) and (max-width:1000px){.content{padding:20px}}');
    for (const config of [extensionConfig, previewConfig]) {
      assert.ok(config.build.cssTarget?.includes('safari15'));
      const result = await build({
        configFile: false, logLevel: 'silent', root: temporary,
        build: { cssTarget: config.build.cssTarget, write: false, rollupOptions: { input } },
      });
      const css = result.output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
        .map((file) => String(file.source)).join('\n');
      assert.match(css, /max-width:\s*720px/);
      assert.match(css, /min-width:\s*721px/);
      assert.match(css, /max-width:\s*1000px/);
      assert.doesNotMatch(css, /@media[^{]*[<>]=?/);
    }
  } finally {
    if (!temporary.startsWith(path.join(os.tmpdir(), 'linghuashi-css-target-'))) throw new Error('Invalid fixture cleanup path');
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
