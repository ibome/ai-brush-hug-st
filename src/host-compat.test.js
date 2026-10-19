import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment, resolveHostAccount, isWindowMessage, postWindowMessage, showExtensionSurface } from './host-compat.js';

test('TauriTavern waits for the host and uses its local account without an unsupported HTTP request', async () => {
  let ready = false;
  const environment = { __TAURI_RUNNING__: true, __TAURITAVERN_MAIN_READY__: Promise.resolve().then(() => { ready = true; }) };
  const account = await resolveHostAccount({ environment, request: () => { throw new Error('users/me must not be requested'); } });
  assert.equal(account, 'default-user');
  assert.equal(ready, true);
  assert.equal(await resolveHostAccount({ environment }), account);
  assert.equal(hostEnvironment(environment).serverPlugins, false);
  assert.equal(hostEnvironment({ parent: environment }).kind, 'tauritavern');
  assert.equal(hostEnvironment({ __LINGHUASHI_ENV__: { host: { kind: 'tauritavern' } } }).network, 'webview-direct');
});

test('ordinary SillyTavern still requires a verified account and never substitutes a shared account on failure', async () => {
  const request = async (url, options) => {
    assert.equal(url, '/api/users/me');
    assert.equal(options.credentials, 'same-origin');
    return Response.json({ handle: 'separate-user' });
  };
  assert.equal(await resolveHostAccount({ environment: {}, request }), 'separate-user');
  await assert.rejects(resolveHostAccount({ environment: {}, request: async () => new Response('', { status: 401 }) }), /账号无法读取/);
  await assert.rejects(resolveHostAccount({ environment: {}, request: async () => Response.json({}) }), /账号无效/);
  const inaccessibleParent = { get parent() { throw new DOMException('Denied', 'SecurityError'); } };
  assert.equal(hostEnvironment(inaccessibleParent).kind, 'sillytavern');
});

test('HTTP message communication remains restricted to the expected source and exact origin', () => {
  const source = { postMessage(value, origin) { this.last = { value, origin }; } };
  const environment = { location: { origin: 'https://tavern.test', protocol: 'https:' } };
  assert.equal(isWindowMessage({ source, origin: 'https://tavern.test' }, source, environment), true);
  assert.equal(isWindowMessage({ source: {}, origin: 'https://tavern.test' }, source, environment), false);
  assert.equal(isWindowMessage({ source, origin: 'https://untrusted.test' }, source, environment), false);
  assert.equal(isWindowMessage({ source, origin: 'null' }, source, environment), false);
  postWindowMessage(source, { type: 'fixture' }, environment);
  assert.deepEqual(source.last, { value: { type: 'fixture' }, origin: 'https://tavern.test' });
});

test('opaque native-scheme messaging verifies the expected window and rejects navigated foreign windows', () => {
  const environment = { __TAURI_RUNNING__: true, location: { origin: 'null', protocol: 'tauri:', host: 'localhost' } };
  const source = { location: environment.location, postMessage(value, origin) { this.last = { value, origin }; } };
  assert.equal(isWindowMessage({ source, origin: 'null' }, source, environment), true);
  assert.equal(isWindowMessage({ source: {}, origin: 'null' }, source, environment), false);
  assert.equal(isWindowMessage({ source, origin: 'https://foreign.test' }, source, environment), false);
  assert.equal(isWindowMessage({ source, origin: 'null' }, source, { location: environment.location }), false);
  postWindowMessage(source, { type: 'private-fixture' }, environment);
  assert.equal(source.last.origin, '*');
  delete source.last;
  source.location = { protocol: 'https:', host: 'foreign.test' };
  postWindowMessage(source, { type: 'private-fixture' }, environment);
  assert.equal(source.last, undefined);
  assert.equal(isWindowMessage({ source, origin: 'null' }, source, environment), false);
  Object.defineProperty(source, 'location', { get() { throw new DOMException('Denied', 'SecurityError'); } });
  assert.doesNotThrow(() => postWindowMessage(source, {}, environment));
});

test('old WebViews can open the extension surface without the Popover API', () => {
  const host = { style: {}, removeAttribute(name) { assert.equal(name, 'popover'); this.removed = true; } };
  showExtensionSurface(host);
  assert.equal(host.removed, true);
  assert.equal(host.style.display, 'block');
  assert.equal(host.style.zIndex, '2147483000');
  const supported = { showPopover() { this.opened = true; } };
  showExtensionSurface(supported);
  assert.equal(supported.opened, true);
  assert.equal(supported.popover, 'manual');
  host.showPopover = () => { throw new DOMException('Unavailable', 'NotSupportedError'); };
  assert.doesNotThrow(() => showExtensionSurface(host));
});
