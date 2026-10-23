import { readBrowserCache, writeBrowserCache } from './browser-cache.js';
import { defaultTaskPrompt, TASK_PROMPT_LIMIT, TASK_PREFIX_LIMIT } from './assistant-rules.js';
import { createCoalescedSave } from './coalesced-save.js';

const tasks = ['generate', 'translate', 'polish', 'illustrate', 'profile', 'edit', 'comic'];
const cleanValue = (value, task) => ({
  prefix: typeof value?.prefix === 'string' ? value.prefix.slice(0, TASK_PREFIX_LIMIT) : '',
  rules: typeof value?.rules === 'string' ? value.rules.slice(0, TASK_PROMPT_LIMIT) : defaultTaskPrompt(task),
});
export function normalizeTaskDrafts(value) {
  const entries = {};
  if (value?.version !== 1) return { version: 1, entries };
  for (const task of tasks) {
    const row = value.entries?.[task];
    if (!row || typeof row !== 'object') continue;
    const draft = cleanValue(row.draft, task), baseline = cleanValue(row.baseline, task);
    if (JSON.stringify(draft) === JSON.stringify(baseline)) continue;
    entries[task] = { draft, baseline, updatedAt: Number.isSafeInteger(row.updatedAt) ? row.updatedAt : 0 };
  }
  return { version: 1, entries };
}

export class TaskPromptDrafts {
  constructor({ key, read = readBrowserCache, write = writeBrowserCache, changed = () => {} }) {
    Object.assign(this, { key, write, changed });
    try { this.value = normalizeTaskDrafts(JSON.parse(read(key))); }
    catch { this.value = normalizeTaskDrafts(null); }
    this.status = Object.keys(this.value.entries).length ? 'restored' : 'saved';
    this.saver = createCoalescedSave(() => {
      try { this.status = this.write(this.key, JSON.stringify(this.value)) ? 'saved' : 'error'; }
      catch { this.status = 'error'; }
      this.changed(this.status);
    }, { delay: 250 });
  }
  get(task) { return this.value.entries[task] ? structuredClone(this.value.entries[task]) : null; }
  set(task, draft, baseline) {
    if (!tasks.includes(task)) return;
    if (JSON.stringify(draft) === JSON.stringify(baseline)) delete this.value.entries[task];
    else this.value.entries[task] = { draft: cleanValue(draft, task), baseline: cleanValue(baseline, task), updatedAt: Date.now() };
    this.status = 'pending'; this.saver.schedule(); this.changed(this.status);
  }
  remove(task) { delete this.value.entries[task]; this.status = 'pending'; this.saver.schedule(); this.flush(); }
  flush() { this.saver.flush(); }
}
