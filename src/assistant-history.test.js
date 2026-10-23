import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_HISTORY_BYTES, cleanAssistantDraft, normalizeAssistantHistory, rememberAssistantDraft,
  assistantWorkspaceRevision, compareAssistantDrafts, recoverAssistantDraft } from './assistant-history.js';

const plan = (positive = '1girl, reading') => ({
  shouldDraw: true, scene: '窗边', positive, negative: 'blurry', aspect: 'portrait',
});
const record = (index) => ({ id: `r-${index}`, createdAt: 1000 + index, plan: plan(`prompt-${index}`), input: `input-${index}` });

test('history schema excludes connection settings, raw credentials and live chat bindings', () => {
  const rows = normalizeAssistantHistory([{ ...record(1), key: 'PRIVATE_KEY', settings: { model: 'private' },
    binding: { id: 'chat-binding' }, plan: { ...plan(), key: 'PRIVATE_KEY', characterStates: [{ name: 'private', evidence: 'private quote' }] } }]);
  const text = JSON.stringify(rows);
  for (const value of ['PRIVATE_KEY', 'settings', 'binding', 'characterStates', 'private quote']) assert.ok(!text.includes(value));
  assert.equal(rows[0].plan.positive, '1girl, reading');
});
test('history keeps immutable complete multiscene plans and selected scene after normalization', () => {
  const source = { ...plan(), illustrations: [plan('first'), plan('second')] };
  const rows = rememberAssistantDraft([], { plan: source, input: '描述', index: 1, operation: 'illustrate' });
  source.illustrations[0].positive = 'changed';
  assert.equal(rows[0].plan.illustrations[0].positive, 'first');
  assert.equal(rows[0].index, 1);
  assert.deepEqual(normalizeAssistantHistory(JSON.parse(JSON.stringify(rows))), rows);
});
test('history count and byte budgets evict old snapshots while preserving newest', () => {
  let rows = [];
  for (let index = 0; index < 20; index++) rows = rememberAssistantDraft(rows, { plan: plan(`prompt-${index}`) }, { now: 1000 + index });
  assert.equal(rows.length, 12);
  assert.equal(rows[0].plan.positive, 'prompt-19');
  assert.equal(rows.at(-1).plan.positive, 'prompt-8');
  const singleSize = new TextEncoder().encode(JSON.stringify([rows[0]])).length;
  const bounded = normalizeAssistantHistory(rows, singleSize + 30);
  assert.equal(bounded.length, 1);
  assert.equal(bounded[0].id, rows[0].id);
  assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length < ASSISTANT_HISTORY_BYTES);
});
test('unchanged consecutive plans deduplicate while named snapshots remain distinct', () => {
  const first = rememberAssistantDraft([], { plan: plan(), input: 'input' });
  const same = rememberAssistantDraft(first, { plan: plan(), input: 'input', operation: 'checkpoint' });
  assert.equal(same.length, 1); assert.equal(same[0].id, first[0].id);
  const named = rememberAssistantDraft(same, { plan: plan(), input: 'input', label: '收藏的版本' });
  assert.equal(named.length, 2); assert.equal(named[0].label, '收藏的版本');
});
test('invalid history entries are isolated and duplicates and extra fields are discarded', () => {
  const rows = normalizeAssistantHistory([null, { ...record(0), plan: { shouldDraw: 'invalid' } }, record(1), record(1),
    { ...record(2), id: '../../private' }, { ...record(3), createdAt: -1 }, { ...record(4), index: 99 }]);
  assert.deepEqual(rows.map((row) => row.id), ['r-1', 'r-4']);
  assert.equal(rows[1].index, 0);
});
test('oversize checkpoint fails explicitly without mutating existing history or plan', () => {
  const existing = [record(1)], draft = { plan: plan('很'.repeat(32000)) };
  assert.throws(() => rememberAssistantDraft(existing, draft, { budget: 1000 }), /历史容量/);
  assert.deepEqual(existing, [record(1)]);
  assert.equal(draft.plan.positive.length, 32000);
});
test('history byte limit measures UTF-8 rather than character count', () => {
  const source = Array.from({ length: 12 }, (_, index) => ({ ...record(index), plan: plan('字'.repeat(25000)) }));
  const rows = normalizeAssistantHistory(source);
  assert.ok(rows.length < 12);
  assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length <= ASSISTANT_HISTORY_BYTES);
});
test('comparison includes changed fields, added scenes and changed character snapshots without mutating either side', () => {
  const before = plan('first'), after = { ...plan('first'), illustrations: [plan('changed'), plan('second')] };
  const original = JSON.stringify([before, after]);
  const changes = compareAssistantDrafts(before, after);
  assert.ok(changes.some((row) => row.index === 0 && row.field === '正向提示词' && row.before === 'first' && row.after === 'changed'));
  assert.ok(changes.some((row) => row.index === 1 && row.field === '画面状态'));
  assert.equal(JSON.stringify([before, after]), original);
  assert.deepEqual(compareAssistantDrafts(before, structuredClone(before)), []);
});
test('workspace revisions invalidate edits, scene selection and original chat association changes', () => {
  const current = { plan: plan(), input: 'first', index: 0, binding: { id: 'one' } };
  for (const patch of [{ plan: plan('changed') }, { input: 'changed' }, { index: 1 }, { binding: null }]) {
    assert.notEqual(assistantWorkspaceRevision(current), assistantWorkspaceRevision({ ...current, ...patch }));
  }
});
test('recovery parses valid wrapped JSON locally and rejects incomplete or ambiguous replies', () => {
  assert.equal(recoverAssistantDraft(`说明\n\`\`\`json\n${JSON.stringify(plan())}\n\`\`\``).positive, plan().positive);
  assert.throws(() => recoverAssistantDraft('{"shouldDraw":true,"positive":"unclosed'), /未闭合/);
  assert.throws(() => recoverAssistantDraft(`${JSON.stringify(plan())}\n${JSON.stringify(plan())}`), /多个/);
  assert.throws(() => recoverAssistantDraft('not json'), /未找到/);
});
test('recovery validates maximum scenes, anchors and prompt limits before producing a draft', () => {
  const shots = { ...plan(), illustrations: [{ ...plan(), anchor: '原句一' }, { ...plan(), anchor: '原句二' }] };
  assert.throws(() => recoverAssistantDraft(JSON.stringify(shots), { maxShots: 1 }), /画面数量/);
  delete shots.illustrations[1].anchor;
  assert.throws(() => recoverAssistantDraft(JSON.stringify(shots)), /定位句/);
  assert.throws(() => recoverAssistantDraft(JSON.stringify(plan('a'.repeat(32001)))), /过长/);
});
test('recovery discards forged model character snapshots, references, states and unknown IDs', () => {
  const raw = { ...plan(), characterScene: { entries: [{ profileId: 'forged',
    profile: { id: 'forged', name: '伪造角色', lockAppearance: false } }] },
  characters: [{ profileId: 'forged', appearance: 'bad' }], characterStates: [{ name: 'bad', evidence: 'quote' }] };
  const recovered = recoverAssistantDraft(JSON.stringify(raw));
  assert.equal(recovered.characterScene, undefined);
  assert.equal(recovered.characters, undefined);
  assert.equal(recovered.characterStates, undefined);
});
test('recovery trusts locally frozen characters and leaves the source context unchanged', () => {
  const scene = { version: 1, chatKey: 'private-chat', entries: [{ profileId: 'local', action: 'standing',
    profile: { id: 'local', name: '本机角色', tags: 'silver hair', lockAppearance: true, outfits: [] } }] };
  const raw = { ...plan(), characters: [{ profileId: 'local', action: 'walking', appearance: 'wrong red hair' }] };
  const original = JSON.stringify(scene), recovered = recoverAssistantDraft(JSON.stringify(raw), { scene });
  assert.equal(recovered.characters[0].profileId, 'local');
  assert.equal(recovered.characters[0].action, 'standing');
  assert.equal(recovered.characters[0].appearance, '');
  assert.equal(recovered.characterScene.entries[0].profile.tags, 'silver hair');
  assert.equal(recovered.characterScene.chatKey, '');
  assert.equal(JSON.stringify(scene), original);
});
test('clean draft snapshots retain prompt weights and groups without reparsing their syntax', () => {
  const positive = '{blue hair}, (blue eyes:1.2), <lora:style:0.8>, [white dress]';
  assert.equal(cleanAssistantDraft(plan(positive)).positive, positive);
});
test('temporarily empty edited prompts survive history normalization while live model output stays strict', () => {
  const empty = plan('');
  const history = rememberAssistantDraft([], { plan: empty });
  assert.equal(normalizeAssistantHistory(history)[0].plan.positive, '');
  assert.equal(history[0].plan.shouldDraw, true);
  assert.throws(() => recoverAssistantDraft(JSON.stringify(empty)), /没有给出正向提示词/);
});
