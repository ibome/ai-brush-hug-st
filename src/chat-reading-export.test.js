import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportReading, readingHTML, readingFilename, readingPalette } from './chat-reading-export.js';

const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' });
const fixture = () => ({ chatKey: 'PRIVATE-binding', title: '故事<script>bad()</script>', start: 1, end: 2, revision: 'private-revision',
  warnings: [], messages: [
    { index: 0, name: '用户', role: 'user', parts: [{ type: 'text', text: '用户正文' }] },
    { index: 1, name: '<img src=x onerror=evil()>', role: 'assistant', parts: [
      { type: 'text', text: '<script>evil()</script>\n![remote](https://remote.test/x.png)' },
      { type: 'images', images: [{ key: 'browser:a', title: '配图一', index: 1, width: 64, height: 64, bytes: png.size, binding: { id: 'private-id' } }] },
      { type: 'text', text: '图片后的正文 *literal*' },
    ] },
  ] });
const make = (snapshot, options = {}) => exportReading(snapshot, { format: 'html', settings: {}, palette: {}, load: async () => png, validate: async () => {}, ...options });

test('HTML export embeds raster originals, escapes all source markup and excludes private descriptors', async () => {
  const result = await make(fixture()), html = await result.blob.text();
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=evil\(\)&gt;/);
  assert.ok(!/<script|<iframe|src="https?:|PRIVATE-binding|private-revision|private-id/.test(html));
  assert.match(html, /default-src 'none'/);
  assert.ok(html.indexOf('配图一') < html.indexOf('图片后的正文'));
  assert.equal(result.images, 1);
  assert.equal(result.missing.length, 0);
});
test('Markdown ZIP contains relative images and public manifest, without configuration or binding data', async () => {
  const result = await make(fixture(), { format: 'markdown', settings: { showUser: false } });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files).sort(), ['images/', 'images/001.png', '图文清单.json', '阅读.md'].sort());
  const md = await zip.file('阅读.md').async('string'), manifest = await zip.file('图文清单.json').async('string');
  assert.match(md, /!\[配图一\]\(images\/001.png\)/);
  assert.match(md, /\\!\\\[remote\\\]/);
  assert.ok(!md.includes('用户正文'));
  assert.ok(!/PRIVATE|private|keyRef|endpoint|chatKey/.test(manifest));
  assert.equal(JSON.parse(manifest).messages, 1);
  assert.deepEqual(new Uint8Array(await zip.file('images/001.png').async('uint8array')), new Uint8Array(await png.arrayBuffer()));
});
test('missing or unsupported files are explicit placeholders and do not abort valid text export', async () => {
  const s = fixture();
  s.messages[1].parts[1].images.push({ key: 'missing', title: '未生成', index: 1, missing: true });
  const result = await make(s, { load: async () => new Blob(['<svg onload="evil"/>'], { type: 'image/svg+xml' }) });
  assert.equal(result.images, 0);
  assert.deepEqual(result.missing, [{ title: '配图一', message: 2 }, { title: '未生成', message: 2 }]);
  const html = await result.blob.text();
  assert.match(html, /原图缺失或暂时无法读取/);
  assert.match(html, /未生成/);
  assert.ok(!html.includes('<svg'));
});
test('duplicate images load once and source is validated before and after fetching', async () => {
  const s = fixture(); let loaded = 0, validated = 0;
  s.messages[1].parts[1].images.push(s.messages[1].parts[1].images[0]);
  const result = await make(s, { load: async () => { loaded++; return png; }, validate: async () => { validated++; } });
  assert.equal(loaded, 1); assert.equal(validated, 2); assert.equal(result.images, 1);
  let count = 0;
  await assert.rejects(make(s, { validate: async () => { if (++count === 2) throw new Error('stale source'); } }), /stale source/);
});
test('preflight and actual bytes enforce size caps, cancellation prevents successful output', async () => {
  const s = fixture(); s.messages[1].parts[1].images[0].bytes = 65 * 1024 * 1024;
  let loaded = 0;
  await assert.rejects(make(s, { load: async () => { loaded++; return png; } }), /64 MB/);
  assert.equal(loaded, 0);
  const controller = new AbortController();
  await assert.rejects(make(fixture(), { signal: controller.signal, load: async () => { controller.abort(); return png; } }), { name: 'AbortError' });
});
test('unsafe theme values and filenames are rejected and empty visible range cannot export', async () => {
  assert.equal(readingPalette({ text: 'red;}</style><script>x</script>' }).text, '#2b374e');
  assert.equal(readingFilename('a/b:c?d*'), 'a_b_c_d_');
  const s = fixture(); s.messages = [s.messages[0]];
  await assert.rejects(make(s, { settings: { showUser: false } }), /没有可导出/);
  const html = readingHTML(fixture(), { fontSize: 99 }, new Map(), { bg: '#fff' });
  assert.match(html, /font-size:28px/);
  await assert.rejects(make(fixture(), { format: 'other' }), /不支持/);
});
