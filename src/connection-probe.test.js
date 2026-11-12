import test from 'node:test';
import assert from 'node:assert/strict';
import { NOVELAI_SERVICES, NOVELAI_SUBSCRIPTION_URL, probeService, resolveNovelAIService, identifySkService } from './ui/connection.js';
import { encodeVibe } from './advanced-generation.js';

test('official connection checks subscription on the image service without depending on the legacy account domain', async () => {
  const requests = [];
  const result = await probeService(NOVELAI_SERVICES.official, 'pst-fixture', {
    fetcher: async (url, options) => {
      requests.push({ url, options });
      if (new URL(url).hostname === 'api.novelai.net') throw new TypeError('Fixture legacy domain unavailable');
      return new Response(JSON.stringify({ tier: 3 }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(NOVELAI_SUBSCRIPTION_URL, 'https://image.novelai.net/user/subscription');
  assert.equal(result.valid, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, NOVELAI_SUBSCRIPTION_URL);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer pst-fixture');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[0].options.redirect, 'error');
});

for (const serviceId of ['cake', 'sugar']) {
  test(`auto-identified ${serviceId} credentials remain resolved and can reach Vibe encoding`, async () => {
    const key = `sk-${'a'.repeat(43)}`, requests = [];
    const service = NOVELAI_SERVICES[serviceId];
    const fetcher = async (url, options) => {
      requests.push({ url, options });
      if (url === `${service.endpoint}/ai/encode-vibe`) {
        return new Response(new Uint8Array(128).fill(7), { headers: { 'Content-Type': 'application/octet-stream' } });
      }
      if (url === `${service.endpoint}/v1/models`) {
        return new Response(JSON.stringify({ object: 'list', data: [] }));
      }
      if (url === `${service.endpoint}/ai/generate-image`) {
        assert.equal(options.body, '{}');
        return new Response(JSON.stringify({ status: 'ok', message: 'Token valid' }), { status: 400 });
      }
      return new Response('{}', { status: 401 });
    };
    assert.equal(resolveNovelAIService(key).kind, 'identify');
    const identified = await identifySkService(key, { fetcher });
    assert.equal(identified.kind, 'resolved');
    assert.equal(identified.id, serviceId);
    assert.equal(identified.endpoint, service.endpoint);
    const encoded = await encodeVibe({ ...identified, key, model: 'nai-diffusion-4-5-full',
      image: 'fixture-image', information: 0.8, fetcher });
    assert.equal(encoded.size, 128);
    assert.equal(requests.length, 3);
    const request = requests.at(-1);
    assert.equal(request.url, `${service.endpoint}/ai/encode-vibe`);
    assert.equal(request.options.headers.Authorization, `Bearer ${key}`);
    assert.deepEqual(JSON.parse(request.options.body), {
      model: 'nai-diffusion-4-5-full', image: 'fixture-image', information_extracted: 0.8,
    });
  });
}

test('failed service identification stays actionable and does not call an encoding endpoint', async () => {
  const requests = [];
  await assert.rejects(identifySkService(`sk-${'a'.repeat(43)}`, {
    fetcher: async (url) => { requests.push(url); throw new TypeError('fixture network failure'); },
  }), /自动识别未完成.*填写第三方地址/);
  assert.equal(requests.length, 2);
  assert.equal(requests.some((url) => url.includes('encode-vibe')), false);
});
