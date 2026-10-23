import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTaskPrompt, normalizeTaskPrompts, renderTaskRules, validateTaskPrompt } from './assistant-rules.js';
import { normalizeAssistant, buildAssistantMessages } from './prompt-assistant.js';
import { buildProfileMessages, manualProfileSource } from './profile-ai.js';
import { comicStoryboardMessages, newComicProject, comicAssistantOptions } from './comic.js';
import { comicPanelRewriteMessages } from './comic-editing.js';
import { normalizeAssistantSchemes, saveAssistantScheme, exportAssistantSchemes, importAssistantSchemes } from './assistant-schemes.js';
import { composeTaskMessages } from './assistant-workflow.js';
globalThis.window ||= { addEventListener() {} };
const { imageEditMessages } = await import('./image-edit.js');

test('task rule edits preserve dynamic counts, formats and nonrecursive custom text', () => {
  const settings = normalizeAssistant({ taskPrompts: {
    comic: { prefix: '偏重情绪特写', rules: defaultTaskPrompt('comic').replace('coherent comic storyboard', 'gentle comic storyboard') },
    generate: { prefix: '视觉风格 {{input}}', rules: `${defaultTaskPrompt('generate')}\nPrefer soft light.` },
  } });
  const project = newComicProject(); project.source = '她走到窗边。'; project.panelCount = 6;
  const message = comicStoryboardMessages(project, comicAssistantOptions(settings, project))[0].content;
  assert.match(message, /^偏重情绪特写/); assert.match(message, /gentle comic storyboard/); assert.match(message, /exactly 6 panels/);
  project.panelCount = 2;
  assert.match(comicStoryboardMessages(project, settings)[0].content, /exactly 2 panels/);
  const base = buildAssistantMessages({ settings, target: { provider: 'novelai' } });
  assert.match(base[0].content, /comma-separated visual tags/);
  assert.match(base[0].content, /Prefer soft light/);
  const composed = composeTaskMessages(base, 'generate', { ...settings, taskMessages: {
    generate: [{ role: 'system', content: 'Legacy prefix\n{{rules}}' }, { role: 'user', content: '{{input}}' }],
  } });
  assert.match(composed[0].content, /^Legacy prefix\n视觉风格 \{\{input\}\}/);
  assert.ok(!buildAssistantMessages({ settings, operation: 'translate' })[0].content.includes('Prefer soft light'));
});

test('required markers and size validation reject invalid edits without changing other tasks', () => {
  for (const rules of ['', defaultTaskPrompt('comic').replace('{{panelCount}}', '4'),
    `${defaultTaskPrompt('comic')} {{panelCount}}`, `${defaultTaskPrompt('comic')} {{unknown}}`, 'x'.repeat(16001)]) {
    assert.ok(validateTaskPrompt('comic', { rules }).length);
    assert.throws(() => renderTaskRules('comic', { taskPrompts: { comic: { rules } } }, { panelCount: 4 }));
  }
  assert.ok(validateTaskPrompt('comic', { prefix: 'x'.repeat(4001) }).length);
  assert.deepEqual(normalizeTaskPrompts({ comic: { rules: '' }, profile: { prefix: '只提取原文信息' }, unknown: {} }),
    { profile: { prefix: '只提取原文信息' } });
  assert.deepEqual(normalizeTaskPrompts({ comic: { rules: defaultTaskPrompt('comic'), prefix: '  ' } }), {});
  assert.throws(() => renderTaskRules('comic'), /panelCount/);
  assert.deepEqual(normalizeAssistant().taskPrompts, {});
});

test('profile, image edit and comic single panel revisions use their own saved rules', () => {
  const settings = normalizeAssistant({ taskPrompts: {
    profile: { rules: `${defaultTaskPrompt('profile')}\nPROFILE_CUSTOM` },
    edit: { prefix: 'EDIT_CUSTOM' }, comic: { prefix: 'COMIC_CUSTOM' }, polish: { prefix: 'POLISH_CUSTOM' },
  } });
  assert.match(buildProfileMessages([manualProfileSource('她', '黑发')], settings)[0].content, /PROFILE_CUSTOM/);
  const draft = { provider: 'novelai', params: { positive: '1girl', negative: '', model: 'nai-diffusion-4-full' } };
  const edit = imageEditMessages(draft, '改成夜景', settings)[0].content;
  assert.match(edit, /^EDIT_CUSTOM/); assert.match(edit, /single image revision/); assert.ok(!edit.includes('POLISH_CUSTOM'));
  const project = newComicProject(); project.source = '她看向窗外。';
  project.panels = [{ id: 'panel', scene: '窗边', positive: 'window', caption: '', bubbles: [] }];
  const comic = comicPanelRewriteMessages(project, 'panel', '改成近景', {}, settings)[0].content;
  assert.match(comic, /^COMIC_CUSTOM/); assert.match(comic, /exactly 1 panels/); assert.match(comic, /Revise ONLY/);
});

test('custom task rules survive assistant scheme export/import and invalid rules fail atomically', () => {
  const saved = saveAssistantScheme([], { name: '规则方案', settings: { taskPrompts: { comic: { prefix: '情绪优先' } } } });
  assert.deepEqual(normalizeAssistantSchemes(saved.library)[0].settings.taskPrompts, { comic: { prefix: '情绪优先' } });
  const result = importAssistantSchemes([], exportAssistantSchemes(saved.library));
  assert.deepEqual(result[0].settings.taskPrompts, { comic: { prefix: '情绪优先' } });
  assert.throws(() => saveAssistantScheme([], { name: '错误模板', settings: {
    taskPrompts: { comic: { rules: 'missing variables' } },
  } }), /底层提示词/);
});
