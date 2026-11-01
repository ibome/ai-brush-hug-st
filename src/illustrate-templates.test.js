import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ILLUSTRATE_TEMPLATE_META, normalizeIllustrateTemplate, defaultTaskPrompt, taskPromptVariables,
  validateTaskPrompt, renderTaskRules, TASK_PROMPT_LIMIT,
} from './assistant-rules.js';
import { normalizeAssistant, buildAssistantMessages } from './prompt-assistant.js';

const operations = ['default', 'guomo', 'natural', 'unbound', 'translator'];
const variables = { illustrationCount: 2, drawingDecision: 'shouldDraw=true.', outputFormat: 'positive uses English tags.',
  illustrationRules: 'anchor rule', stateRules: 'state rule', composition: 'Composition: balanced.', characterRules: '' };

test('每一档插入模板都带齐同一组动态标记，并且能通过校验', () => {
  const required = taskPromptVariables('illustrate').sort();
  for (const id of operations) {
    const rules = defaultTaskPrompt('illustrate', id);
    assert.ok(rules.length <= TASK_PROMPT_LIMIT, `${id} 超出长度限制`);
    const found = [...rules.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(found, required, `${id} 动态标记不齐`);
    assert.deepEqual(validateTaskPrompt('illustrate', { rules }), [], `${id} 校验未通过`);
  }
});

test('所有模板互不相同，且默认档保持原样', () => {
  const seen = new Set(operations.map((id) => defaultTaskPrompt('illustrate', id)));
  assert.equal(seen.size, operations.length);
  assert.match(defaultTaskPrompt('illustrate', 'guomo'), /无限的创作自由/);
  assert.match(defaultTaskPrompt('illustrate', 'natural'), /natural-language English sentences/);
  assert.match(defaultTaskPrompt('illustrate', 'unbound'), /unaligned visual director/);
});

test('未知模板回落到默认，normalizeAssistant 保留合法选择', () => {
  for (const value of ['', null, 'nope', 42, {}, undefined]) assert.equal(normalizeIllustrateTemplate(value), 'default');
  for (const id of operations) assert.equal(normalizeIllustrateTemplate(id), id);
  assert.equal(normalizeAssistant({ illustrateTemplate: 'guomo' }).illustrateTemplate, 'guomo');
  assert.equal(normalizeAssistant({ illustrateTemplate: 'bad-id' }).illustrateTemplate, 'default');
  assert.equal(normalizeAssistant({}).illustrateTemplate, 'default');
  assert.deepEqual(ILLUSTRATE_TEMPLATE_META.map((row) => row.id), operations);
});

test('renderTaskRules 采用所选模板，自定义 rules 仍然优先', () => {
  const guomo = renderTaskRules('illustrate', { illustrateTemplate: 'guomo' }, variables);
  assert.match(guomo, /无限的创作自由/);
  assert.match(guomo, /Plan up to 2 distinct visual moments/);
  assert.ok(!guomo.includes('{{'), '动态标记必须全部展开');

  const custom = renderTaskRules('illustrate', {
    illustrateTemplate: 'guomo', taskPrompts: { illustrate: { rules: defaultTaskPrompt('illustrate', 'unbound') } },
  }, variables);
  assert.match(custom, /unaligned visual director/);
  assert.ok(!custom.includes('无限的创作自由'));

  assert.throws(() => renderTaskRules('illustrate', { illustrateTemplate: 'natural' }, {}), /任务缺少动态内容/);
});

test('助手消息按所选模板构建，其他任务不受影响', () => {
  const settings = normalizeAssistant({ illustrateTemplate: 'unbound' });
  const messages = buildAssistantMessages({ settings, operation: 'illustrate', input: '她站在雨里', target: { provider: 'novelai' } });
  assert.match(messages[0].content, /unaligned visual director/);
  const generate = buildAssistantMessages({ settings, operation: 'generate', input: '她站在雨里', target: { provider: 'novelai' } });
  assert.ok(!generate[0].content.includes('unaligned visual director'));
});

test('翻译官模板把同类示例拼在用户消息前，其他模板不拼', () => {
  const run = (illustrateTemplate) => buildAssistantMessages({
    settings: normalizeAssistant({ illustrateTemplate }), operation: 'illustrate', input: '她站在雨里', target: { provider: 'novelai' },
  });
  const translator = run('translator');
  assert.match(translator[0].content, /Danbooru tag translator/);
  assert.match(translator[0].content, /Every character in the source text is an adult/);
  assert.match(translator[1].content, /^EXAMPLES\nIN: /);
  assert.match(translator[1].content, /"INPUT":/);
  for (const id of ['default', 'guomo', 'natural', 'unbound']) {
    const other = run(id);
    assert.ok(!other[1].content.startsWith('EXAMPLES'), `${id} 不应带示例前缀`);
  }
  const generate = buildAssistantMessages({
    settings: normalizeAssistant({ illustrateTemplate: 'translator' }), operation: 'generate', input: '她站在雨里', target: { provider: 'novelai' },
  });
  assert.ok(!generate[1].content.startsWith('EXAMPLES'));
});
