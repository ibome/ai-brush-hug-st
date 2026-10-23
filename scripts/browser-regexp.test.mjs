import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserRegex } from './browser-regexp.mjs';
import { protectBuild } from './protect-build.mjs';

test('client build rejects lookbehind literals and static constructors before deployment', () => {
  for (const source of [
    'const pattern=/(?<!x)y/;',
    'const pattern=/(?<=x)y/;',
    'const pattern=new RegExp("(?<!x)y");',
    'const pattern=RegExp("(?<=x)y");',
  ]) assert.throws(() => assertBrowserRegex(source, 'fixture.js'), /fixture.js.*lookbehind/);
});
test('regex checks distinguish actual syntax from strings, comments, classes and escaped literals', () => {
  assert.equal(assertBrowserRegex(String.raw`
    const description="(?<! this is just documentation";
    // (?<= another documentation example
    const ordinary=/(?:^|[^\\])[|]/;
    const characters=/[(?<!=]+/;
    const escaped=/\(\?<=literal/;
    const quoted=/https?:\/\/example\.test/;
    const forward=/(?=x)y/;
    const named=/(?<value>x)/;
    const constructed=new RegExp("(?:^|x)y");
  `), 7);
});
test('the final build gate checks every client chunk including dependency chunks', () => {
  const context = { emitFile() {}, error(message) { throw new Error(message); } };
  for (const vendor of [false, true]) {
    const fileName = vendor ? 'vendor.js' : 'index.js';
    const bundle = { [fileName]: { type: 'chunk', fileName, name: vendor ? 'vendor' : 'extension',
      code: 'export const broken=/(?<!x)y/;', modules: { [vendor ? '/project/node_modules/fixture/index.js' : '/project/src/fixture.js']: {} } } };
    assert.throws(() => protectBuild().generateBundle.handler.call(context, {}, bundle), /lookbehind/);
  }
});
