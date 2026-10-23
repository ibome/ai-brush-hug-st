import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, parseComicStoryboard } from './comic.js';
import { previewComicRepair } from './comic-repair.js';

function fixture() {
  const project = newComicProject(); project.panelCount = 1; project.source = '她看见门上的纸条。';
  const data = { title: '纸条', panels: [{ title: '门前', scene: '纸条写着“请进”', positive: 'reading a note',
    negative: '', characterIds: [], characters: [], caption: '她说“你好”，推门而入。',
    bubbles: [{ speaker: '她', text: '你好。', type: 'speech' }] }] };
  const valid = JSON.stringify(data, null, 2), invalid = valid.replaceAll('“', '"').replaceAll('”', '"');
  return { project, data, valid, invalid };
}
test('comic repair previews only string quote escaping and validates the whole storyboard', () => {
  const { project, data, invalid } = fixture(), before = JSON.stringify(project);
  assert.throws(() => parseComicStoryboard(invalid, project), /JSON 格式有误/);
  const preview = previewComicRepair(`\`\`\`json\n${invalid}\n\`\`\``, project);
  assert.equal(preview.quotes, 4); assert.equal(preview.panels, 1);
  assert.deepEqual(preview.changes.map((row) => row.field), ['scene', 'caption']);
  const parsed = JSON.parse(preview.source);
  assert.equal(parsed.panels[0].scene, data.panels[0].scene.replaceAll('“', '"').replaceAll('”', '"'));
  assert.equal(parsed.panels[0].caption, data.panels[0].caption.replaceAll('“', '"').replaceAll('”', '"'));
  assert.equal(parsed.panels[0].positive, data.panels[0].positive);
  assert.equal(JSON.stringify(project), before);
  assert.equal(parseComicStoryboard(preview.source, project).panels.length, 1);
});
test('repair preserves valid escapes, literal backslashes, code-like content and CRLF', () => {
  const { project, data } = fixture();
  data.panels[0].positive = 'path C:\\folder, "quoted", \\n, </textarea><script>bad()</script>';
  data.panels[0].bubbles[0].text = '他说“别急”。';
  const invalid = JSON.stringify(data, null, 2).replaceAll('“', '"').replaceAll('”', '"').replaceAll('\n', '\r\n');
  const preview = previewComicRepair(invalid, project), result = JSON.parse(preview.source);
  assert.equal(preview.quotes, 6);
  assert.equal(result.panels[0].positive, data.panels[0].positive);
  assert.equal(result.panels[0].bubbles[0].text, '他说"别急"。');
});
test('repair rejects missing data, multiple objects, ambiguous inline properties and non-quote syntax errors', () => {
  const { project, invalid, valid } = fixture();
  for (const raw of [valid, invalid.slice(0, -3), `${invalid}\n${invalid}`, '<think>unfinished',
    invalid.replace('"negative": "",', '"negative": "",,'),
    '{"panels": [{"scene": "a"b", "positive": "garden", "characterIds": []}]}',
    invalid.replace('"scene": "纸条写着"请进"",', '"scene": "word", "added": "another"field",'),
    invalid.replace('"characterIds": []', '"characterIds": ["invented"]'),
    'x'.repeat(100001)]) {
    assert.throws(() => previewComicRepair(raw, project));
  }
  assert.throws(() => previewComicRepair(invalid, { ...project, panelCount: 4 }), /分镜字段检查/);
});
