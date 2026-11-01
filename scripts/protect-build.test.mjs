import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { protectCode, protectBuild, protectionOptions, codeDigest } from './protect-build.mjs';
import { thirdPartyNotices } from './third-party-notices.mjs';
import { RELEASE } from '../src/release.js';

test('light protection preserves exported APIs, property names, async calls and text values', async () => {
  const input = `export const publicEvent = 'linghuashi:test';
    export function createFixture(initial) {
      let privateRunningTotal = initial;
      return { get value() { return privateRunningTotal; },
        async increment(amount) { privateRunningTotal += await Promise.resolve(amount); return { value: privateRunningTotal, message: 'image###test###' }; } };
    }`;
  const code = protectCode(input, 'fixture');
  assert.ok(!code.includes('privateRunningTotal'));
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.equal(mod.publicEvent, 'linghuashi:test');
  const object = mod.createFixture(4);
  assert.equal(object.value, 4);
  assert.deepEqual(await object.increment(3), { value: 7, message: 'image###test###' });
  assert.equal(object.value, 7);
});

test('protection is deterministic and does not enable runtime traps or string decoding', () => {
  const input = 'function sum(items) { return items.reduce((total, item) => total + item, 0); } console.info(sum([1, 2]));';
  assert.equal(protectCode(input, 'fixture'), protectCode(input, 'fixture'));
  for (const key of ['stringArray', 'controlFlowFlattening', 'deadCodeInjection', 'debugProtection', 'selfDefending', 'sourceMap', 'renameProperties']) {
    assert.equal(protectionOptions[key], false, key);
  }
  assert.ok(!/\b(?:eval|debugger)\b/.test(protectCode(input, 'fixture')));
});

test('bundle report covers protected app and unchanged vendor code with copyright headers', () => {
  const vendorCode = 'export const vendorValue = 3;';
  const bundle = {
    'index.js': { type: 'chunk', fileName: 'index.js', name: 'extension', code: 'console.info("fixture");', modules: { '/project/src/st-extension.js': {} } },
    'vendor.js': { type: 'chunk', fileName: 'vendor.js', name: 'vendor', code: vendorCode, modules: { '/project/node_modules/example/index.js': {} } },
  };
  let report;
  assert.equal(protectBuild().generateBundle.order, 'post');
  protectBuild().generateBundle.handler.call({ emitFile(file) { report = JSON.parse(file.source); }, error(message) { throw new Error(message); } }, {}, bundle);
  assert.equal(report.version, RELEASE.version);
  assert.equal(report.sourceMaps, false);
  assert.deepEqual(report.files.map((file) => file.protected), [true, false]);
  for (const file of report.files) {
    assert.ok(bundle[file.name].code.startsWith('/*! Linghuashi'));
    assert.equal(file.sha256, codeDigest(bundle[file.name].code));
  }
  assert.ok(bundle['vendor.js'].code.endsWith(vendorCode));
  bundle['vendor.js'].modules['/project/src/chat-link.js'] = {};
  assert.throws(() => protectBuild().generateBundle.handler.call({ error(message) { throw new Error(message); } }, {}, bundle), /First-party/);
});

test('distribution includes legacy permissions and actual dependency copyright notices', async () => {
  const notices = await thirdPartyNotices();
  for (const name of ['jszip', 'lucide', 'pako', 'lie', 'immediate', 'isarray', 'javascript-obfuscator', 'vite']) assert.ok(notices.includes(`${name} `), name);
  assert.match(notices, /Stuart Knightley/);
  assert.match(notices, /Cole Bemis/);
  assert.match(notices, /Copyright \(c\) 2013 Julian Gruber/);
  const license = await fs.readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  const legacy = await fs.readFile(new URL('../LICENSES/BSD-2-Clause-legacy.txt', import.meta.url), 'utf8');
  assert.match(license, /0\.23\.0/);
  assert.match(license, /0\.22\.2/);
  assert.match(legacy, /Redistribution and use in source and binary forms/);
});
