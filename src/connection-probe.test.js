import test from 'node:test';
import assert from 'node:assert/strict';
import { NOVELAI_SERVICES, NOVELAI_SUBSCRIPTION_URL, probeService } from './ui/connection.js';

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
