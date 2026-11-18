import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiCharacterPrompt, matchCharacterProfile, prepareMultiCharacterPrompt, characterDynamics } from './multi-character-prompt.js';
import { normalizeProfile, normalizeCharacterScene, applyCharacterScene } from './character-profiles.js';
import { characterCenter, characterCaptionPayload, arrangeCharacters, POSITION_GRID } from './character-layout.js';
import { buildNovelAIRequest } from './generation.js';
import { buildAssistantMessages, parseAssistantResult, applyAssistantPlan } from './prompt-assistant.js';
import { freezeIllustrationCharacters, selectedIllustration, selectIllustrationCharacter } from './assistant-workflow.js';
import { previewCreation } from './creation-workflow.js';
globalThis.window ||= { addEventListener() {} };
const { buildOpenAIRequest } = await import('./ui/openai.js');
const { NOVELAI_DEFAULTS } = await import('./ui/novelai.js');

const profiles = [
  normalizeProfile({ id: 'blue', name: '小蓝', aliases: ['阿蓝', 'Blue'], hair: 'blue hair', eyes: 'blue eyes',
    tags: '1girl', negative: 'red hair', lockOutfit: true, outfits: [{ id: 'dress', prompt: 'white dress' }] }),
  normalizeProfile({ id: 'red', name: '小红', hair: 'red hair', tags: '1girl' }),
];
const snapshot = (model = 'nai-diffusion-4-5-full') => ({ provider: 'novelai',
  params: { ...NOVELAI_DEFAULTS, model, artist: '', positive: 'watercolor', negative: 'blurry' } });
const structured = `Scene Composition: 2girls, cafe;
Character 1 Prompt: 阿蓝, red hair, waving, smiling |centers:B3;
Character 1 UC: bad hands;
Character 2 Name: 旅人
Character 2 Prompt: green hair, holding a book |centers:D3
Negative prompt: lowres`;

test('structured chat accepts missing trailing separators, CRLF, Chinese fields and weighted comma groups', () => {
  const parsed = parseMultiCharacterPrompt(structured.replaceAll('\n', '\r\n'));
  assert.equal(parsed.positive, '2girls, cafe');
  assert.equal(parsed.negative, 'lowres');
  assert.equal(parsed.characters.length, 2);
  assert.equal(parsed.characters[0].negative, 'bad hands');
  assert.equal(parsed.characters[1].position, 'D3');
  const chinese = parseMultiCharacterPrompt('场景描述：garden\n角色1名字：小蓝\n角色1正向提示词：{blue hair, blue eyes}\n角色1动作：waving\n角色1表情：smiling\n角色1服装：cape\n角色1负面：red hair\n全局负面：lowres');
  assert.equal(chinese.characters[0].positive, '{blue hair, blue eyes}');
  assert.equal(chinese.characters[0].action, 'waving');
  assert.equal(chinese.characters[0].expression, 'smiling');
  assert.equal(chinese.characters[0].outfit, 'cape');
  assert.equal(parseMultiCharacterPrompt('garden, 1girl, text saying Character 1 Prompt: welcome'), null);
});

test('invalid structured blocks fail before submission, preserving an ordinary prompt path', () => {
  for (const raw of [
    'Character 0 Prompt: person', 'Character 23 Prompt: person',
    'Character 1 Prompt: a\nCharacter 1 Prompt: b', 'Character 1 UC: lowres',
    'Character 1 Prompt:\nCharacter 1 Prompt: b',
    `Character 1 Prompt: ${'x'.repeat(4001)}`, 'x'.repeat(32001),
  ]) assert.throws(() => parseMultiCharacterPrompt(raw));
  const invalid = parseMultiCharacterPrompt('Character 1 Prompt: person |centers:Z9');
  assert.equal(invalid.characters[0].position, 'auto');
  assert.equal(invalid.warnings.length, 1);
});

test('names and aliases match exact tags only and ambiguous names remain temporary', () => {
  assert.equal(matchCharacterProfile({ number: 1, name: 'blue' }, profiles).profile.id, 'blue');
  assert.equal(matchCharacterProfile({ number: 1, positive: 'Blue, waving' }, profiles).profile.id, 'blue');
  assert.equal(matchCharacterProfile({ number: 1, positive: 'blue sky, blue eyes' }, profiles).profile, undefined);
  const duplicate = [...profiles, normalizeProfile({ id: 'other', name: 'Blue' })];
  assert.match(matchCharacterProfile({ number: 1, name: 'Blue' }, duplicate).warning, /同名/);
  assert.equal(matchCharacterProfile({ number: 1, profileId: 'red', name: 'Blue' }, duplicate).profile.id, 'red');
  assert.match(matchCharacterProfile({ number: 1, profileId: 'missing' }, profiles).warning, /不存在/);
  assert.throws(() => prepareMultiCharacterPrompt(snapshot(),
    'Character 1 Prompt: 阿蓝\nCharacter 2 Prompt: Blue', { profiles }), /多个角色分段/);
});

test('locked profiles retain identity and outfit while legacy dynamic tags and explicit directions survive', () => {
  const before = structuredClone(profiles), input = snapshot();
  const result = prepareMultiCharacterPrompt(input, structured, { profiles, chatKey: 'chat-a' });
  const [blue, temporary] = result.characterScene.characterPrompts;
  assert.equal(blue.id, 'blue');
  assert.match(blue.positive, /blue hair.*white dress.*waving.*smiling/);
  assert.doesNotMatch(blue.positive, /red hair/);
  assert.equal(blue.negative, 'red hair, bad hands');
  assert.match(temporary.positive, /green hair.*holding a book/);
  assert.equal(result.characterScene.entries[1].profile.name, '旅人');
  assert.equal(result.params.positive, 'watercolor, 2girls, cafe');
  assert.equal(result.params.negative, 'blurry, lowres');
  assert.equal(result.chatPromptStyle.prefix, 'watercolor');
  assert.equal(result.chatPromptStyle.scene, '2girls, cafe');
  assert.equal(result.characterScene.chatKey, 'chat-a');
  assert.deepEqual(profiles, before);
  assert.equal(input.params.positive, 'watercolor');
  assert.equal(characterDynamics('red hair, 2::waving, smiling::, (looking at viewer:1.2), white clothing'),
    '2::waving, smiling::, (looking at viewer:1.2)');
  const explicit = prepareMultiCharacterPrompt(input,
    'Character 1 Prompt: Blue, red hair\nCharacter 1 Action: playing the flute\nCharacter 1 Expression: curious\nCharacter 1 Outfit: blue coat', { profiles });
  assert.match(explicit.characterScene.characterPrompts[0].positive, /playing the flute.*curious/);
  assert.doesNotMatch(explicit.characterScene.characterPrompts[0].positive, /blue coat|red hair/);
});

test('unmatched characters do not mutate the library and fixed participants join only the current image', () => {
  const scene = normalizeCharacterScene({ entries: profiles.map((profile) => ({ profileId: profile.id, profile,
    participation: profile.id === 'red' ? 'always' : 'story' })) });
  const result = prepareMultiCharacterPrompt(snapshot(), 'Character 1 Prompt: green hair, walking', { profiles, scene });
  assert.deepEqual(result.characterScene.entries.map((row) => row.profileId), ['temporary-role-1', 'red']);
  assert.equal(scene.entries.length, 2);
  const direct = prepareMultiCharacterPrompt({ ...snapshot(), params: { ...snapshot().params, positive: structured } }, structured, { profiles });
  assert.equal(direct.params.positive, '2girls, cafe');
});

test('grid coordinates keep distinct positions for large casts and count failures are explicit', () => {
  assert.deepEqual(characterCenter('b3'), { x: .3, y: .5 });
  assert.deepEqual(characterCenter('E5'), { x: .9, y: .9 });
  const entries = Array.from({ length: 22 }, (_, index) => ({ profileId: `p${index}`, position: 'auto' }));
  const arranged = arrangeCharacters(entries, 'row');
  assert.equal(new Set(arranged.map((row) => row.position)).size, 22);
  assert.ok(arranged.every((row) => POSITION_GRID.includes(row.position)));
  assert.equal(arrangeCharacters(arranged, 'reverse')[0].position, arranged.at(-1).position);
  assert.ok(arrangeCharacters(arranged, 'auto').every((row) => row.position === 'auto'));
  const seven = Array.from({ length: 7 }, (_, index) => `Character ${index + 1} Prompt: person ${index}`).join('\n');
  assert.throws(() => prepareMultiCharacterPrompt(snapshot(), seven), /6/);
  const v5 = prepareMultiCharacterPrompt(snapshot('nai-diffusion-5-full'), seven);
  assert.equal(buildNovelAIRequest(v5.params, v5.characterScene.characterPrompts).parameters.characterPrompts.length, 7);
  const mixed = characterCaptionPayload('garden', 'blur', [{ positive: 'a', position: 'B3' }, { positive: 'b', position: 'auto' }]);
  assert.equal(mixed.use_coords, true);
  assert.deepEqual(mixed.characterPrompts.map((row) => row.center), [{ x: .3, y: .5 }, { x: .5, y: .5 }]);
});

test('assistant per-image cast stays separate across multi-image plans and includes fixed profiles', () => {
  const scene = normalizeCharacterScene({ entries: profiles.map((profile) => ({ profileId: profile.id, profile,
    participation: profile.id === 'red' ? 'always' : 'story' })) });
  const plan = parseAssistantResult(JSON.stringify({ shouldDraw: true, illustrations: [
    { positive: 'cafe', anchor: '在咖啡厅', characterIds: ['blue'], characters: [{ profileId: 'blue', action: 'waving', position: 'A3' }] },
    { positive: 'garden', anchor: '到了花园', characterIds: [], characters: [] },
  ] }));
  freezeIllustrationCharacters(plan, scene);
  assert.deepEqual(plan.characterIds, ['blue', 'red']);
  assert.deepEqual(selectedIllustration(plan, 1).characterIds, ['red']);
  const first = applyAssistantPlan(snapshot(), selectedIllustration(plan, 0), {});
  const second = applyAssistantPlan(snapshot(), selectedIllustration(plan, 1), {});
  assert.deepEqual(first.characterScene.entries.map((row) => row.profileId), ['blue', 'red']);
  assert.deepEqual(second.characterScene.entries.map((row) => row.profileId), ['red']);
  assert.match(first.characterScene.characterPrompts[0].positive, /waving/);
  const toggled = selectIllustrationCharacter(plan, 0, 'blue', false);
  assert.deepEqual(toggled.characterIds, ['red']);
  assert.deepEqual(plan.characterIds, ['blue', 'red']);
  assert.throws(() => selectIllustrationCharacter(plan, 0, 'red', false), /固定出场/);
  assert.deepEqual(selectIllustrationCharacter(toggled, 0, 'blue', true).characterIds, ['red', 'blue']);
  assert.throws(() => freezeIllustrationCharacters({ positive: 'garden', characterIds: ['unknown'] }, scene), /不属于/);
  assert.throws(() => parseAssistantResult('{"shouldDraw":true,"positive":"cafe","characterIds":"blue"}'), /角色列表/);
  const noPeople = applyCharacterScene(snapshot(), { entries: scene.entries.map((row) => ({ ...row, participation: 'story' })) }, [], []);
  assert.equal(noPeople.characterScene.entries.length, 0);
  assert.equal(noPeople.params.positive, 'watercolor');
  assert.match(buildAssistantMessages({ context: { characterScene: scene } })[0].content, /visibly present/);
});

test('a new assistant plan filters even an applied image snapshot instead of reusing its old cast', () => {
  const frozen = applyCharacterScene(snapshot(), { entries: profiles.map((profile) => ({ profileId: profile.id, profile })) });
  const result = applyAssistantPlan(frozen, { shouldDraw: true, positive: 'library', negative: '', characterIds: ['red'],
    characterScene: frozen.characterScene, characters: [{ profileId: 'red', action: 'reading' }] }, {});
  assert.deepEqual(result.characterScene.entries.map((row) => row.profileId), ['red']);
  assert.match(result.characterScene.characterPrompts[0].positive, /reading/);
  assert.match(result.characterScene.basePositive, /library/);
});

test('interactions compile separately for native and generic providers and ignore missing targets', () => {
  const scene = normalizeCharacterScene({ entries: profiles.map((profile) => ({ profileId: profile.id, profile })) });
  const directions = [{ profileId: 'blue', interaction: { targetId: 'red', action: 'hugging', mode: 'source' } }];
  const native = applyCharacterScene(snapshot(), scene, directions);
  assert.match(native.characterScene.characterPrompts[0].positive, /source#hugging/);
  assert.match(native.characterScene.characterPrompts[1].positive, /target#hugging/);
  const flat = applyCharacterScene({ ...snapshot(), provider: 'openai', params: { model: 'gpt-image-1', positive: 'cafe', negative: '' } }, scene, directions);
  assert.match(flat.params.positive, /Interaction: 小蓝 toward 小红: hugging/);
  assert.doesNotMatch(flat.params.positive, /source#|target#/);
  assert.deepEqual(applyCharacterScene(flat, flat.characterScene), flat);
  assert.doesNotMatch(applyCharacterScene(snapshot(), scene, directions, ['blue']).characterScene.characterPrompts[0].positive, /hugging/);
});

test('OpenAI compatible independent roles require an explicit format choice and block conflicting JSON', () => {
  const value = { model: 'nai-diffusion-4-5-full', artist: 'watercolor', positive: 'garden', negative: 'blur' };
  const characters = [{ id: 'blue', positive: 'blue hair', negative: 'red hair', position: 'B3' }];
  const flat = buildOpenAIRequest(value, characters);
  assert.equal(flat.characterPrompts, undefined);
  assert.equal(flat.v4_prompt, undefined);
  for (const characterMode of ['novelai-v4', 'character-prompts']) {
    const params = { ...value, characterMode }, body = buildOpenAIRequest(params, characters);
    if (characterMode === 'novelai-v4') {
      assert.equal(body.v4_prompt.caption.char_captions[0].char_caption, 'blue hair');
      assert.equal(body.v4_negative_prompt.caption.char_captions[0].char_caption, 'red hair');
    } else assert.equal(body.characterPrompts[0].uc, 'red hair');
    assert.equal(body.use_coords, true);
    assert.throws(() => buildOpenAIRequest({ ...params, extra: '{"characterPrompts":[]}' }, characters), /角色参数/);
    const prepared = applyCharacterScene({ provider: 'openai', params }, { entries: [{ profileId: 'blue', profile: profiles[0] }] });
    assert.equal(prepared.params.positive, 'garden');
  }
  const nonNai = buildOpenAIRequest({ ...value, model: 'gpt-image-1', characterMode: 'novelai-v4' }, characters);
  assert.equal(nonNai.v4_prompt, undefined);
});

test('preview parses the same role structure and reports actual transport without sending requests', () => {
  const value = snapshot(); value.params.positive = structured;
  const preview = previewCreation(value, { profiles });
  assert.equal(preview.positive, '2girls, cafe');
  assert.equal(preview.characters[0].id, 'blue');
  assert.match(preview.roles[0].action, /waving.*smiling/);
  assert.equal(preview.characterTransport, '独立角色参数');
  assert.match(preview.characterWarnings.join('\n'), /锁定外貌/);
  const flat = previewCreation({ ...value, provider: 'openai', params: { ...value.params, characterMode: 'flat' } }, { profiles });
  assert.equal(flat.characterTransport, '合并描述');
  assert.match(flat.positive, /Character 1.*blue hair/);
});
