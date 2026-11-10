import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkExternalLink,
  checkExternalLinks,
  createHostRateLimiter,
  extractExternalLinks,
  parseExternalUrl,
  parseRetryAfter,
  selectChangedMarkdownDocuments,
  shouldFailOnBroken,
} from './check-external-links.js';

function response(status, headers = {}) {
  const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name) => values.get(name.toLowerCase()) ?? null },
    body: null,
  };
}

function candidate(url, path = 'README.md') {
  return {
    status: 'candidate',
    url: new URL(url).href,
    host: new URL(url).hostname,
    paths: [path],
    originalUrls: [url],
  };
}

const noDelay = async () => {};

test('extracts inline, reference, autolink and bare HTTP(S) destinations outside code examples', () => {
  const tick = String.fromCharCode(96);
  const documents = [{
    path: 'README.md',
    content: [
      '[inline](https://inline.example/path#section)',
      '[reference]: <https://reference.example/guide>',
      '<https://auto.example/path>',
      'Plain URL: https://bare.example/path.',
      tick.repeat(3) + 'md',
      '[fenced](https://fenced.example/)',
      tick.repeat(3),
      tick + '[inline code](https://inline-code.example/)' + tick,
    ].join('\n'),
  }];

  const links = extractExternalLinks(documents);
  assert.equal(links.length, 4);
  assert.deepEqual(links.map((link) => link.host), [
    'auto.example',
    'bare.example',
    'inline.example',
    'reference.example',
  ]);
  assert.equal(links.find((link) => link.host === 'inline.example').url, 'https://inline.example/path');
});

test('deduplicates URL fragments and retains every source path', () => {
  const links = extractExternalLinks([
    { path: 'README.md', content: '[one](https://same.example/path#one)' },
    { path: 'docs/guide.md', content: '[two](https://same.example/path#two)' },
  ]);

  assert.equal(links.length, 1);
  assert.deepEqual(links[0].paths, ['README.md', 'docs/guide.md']);
  assert.equal(links[0].url, 'https://same.example/path');
});

test('ignores non-HTTP protocols and skips local or IP-literal hosts', () => {
  assert.equal(parseExternalUrl('mailto:docs@example.com'), null);
  assert.equal(parseExternalUrl('https://localhost/path').status, 'skipped');
  assert.equal(parseExternalUrl('http://service.internal/').status, 'skipped');
  assert.equal(parseExternalUrl('http://127.0.0.1/').status, 'skipped');
  assert.equal(parseExternalUrl('http://[::1]/').status, 'skipped');
});

test('marks malformed HTTP URLs and credential-bearing URLs invalid without exposing credentials', () => {
  assert.equal(parseExternalUrl('http://[').status, 'invalid');
  const credentialUrl = parseExternalUrl('https://user:secret@example.com/');
  assert.equal(credentialUrl.status, 'invalid');
  assert.equal(credentialUrl.url.includes('secret'), false);
});

test('HEAD success is sufficient and avoids a GET request', async () => {
  const methods = [];
  const result = await checkExternalLink(candidate('https://ok.example/'), {
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      return response(200);
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(methods, ['HEAD']);
});

test('falls back to a ranged GET when HEAD is unsupported', async () => {
  const calls = [];
  const result = await checkExternalLink(candidate('https://head-blocked.example/'), {
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, range: options.headers.range });
      return response(options.method === 'HEAD' ? 405 : 200);
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET']);
  assert.equal(calls[1].range, 'bytes=0-0');
});

test('requires GET confirmation before classifying HEAD 404/410 as broken', async () => {
  const broken = await checkExternalLink(candidate('https://gone.example/'), {
    fetchImpl: async (_url, options) => response(options.method === 'HEAD' ? 404 : 410),
    sleep: noDelay,
    minHostIntervalMs: 0,
  });
  const recovered = await checkExternalLink(candidate('https://head-false-positive.example/'), {
    fetchImpl: async (_url, options) => response(options.method === 'HEAD' ? 404 : 200),
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(broken.status, 'broken');
  assert.equal(recovered.status, 'ok');
});

test('treats authentication and anti-bot responses as unverifiable, not broken', async () => {
  const result = await checkExternalLink(candidate('https://blocked.example/'), {
    fetchImpl: async () => response(403),
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'unverifiable');
});

test('retries transient server failures with bounded exponential backoff', async () => {
  let attempts = 0;
  const delays = [];
  const result = await checkExternalLink(candidate('https://retry.example/'), {
    fetchImpl: async () => {
      attempts += 1;
      return response(attempts === 1 ? 503 : 200);
    },
    sleep: async (ms) => delays.push(ms),
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'ok');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [500]);
});

test('honors Retry-After seconds while capping the requested wait', async () => {
  let attempts = 0;
  const delays = [];
  const result = await checkExternalLink(candidate('https://rate-limited.example/'), {
    fetchImpl: async () => {
      attempts += 1;
      return response(attempts === 1 ? 429 : 200, attempts === 1 ? { 'retry-after': '2' } : {});
    },
    sleep: async (ms) => delays.push(ms),
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(delays, [2000]);
  assert.equal(parseRetryAfter('120', 0, 30_000), 30_000);
});

test('parses HTTP-date Retry-After values', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:03 GMT', now), 3000);
});

test('classifies repeated network errors as unverifiable after the configured retries', async () => {
  let attempts = 0;
  const delays = [];
  const result = await checkExternalLink(candidate('https://offline.example/'), {
    fetchImpl: async () => {
      attempts += 1;
      throw new Error('connection reset');
    },
    sleep: async (ms) => delays.push(ms),
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'unverifiable');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('follows bounded redirects and refuses redirects to local-only hosts', async () => {
  const urls = [];
  const success = await checkExternalLink(candidate('https://redirect.example/start'), {
    fetchImpl: async (url) => {
      urls.push(url);
      return urls.length === 1 ? response(302, { location: '/final' }) : response(200);
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
  });
  const blockedUrls = [];
  const blocked = await checkExternalLink(candidate('https://redirect-local.example/'), {
    fetchImpl: async (url) => {
      blockedUrls.push(url);
      return response(302, { location: 'http://localhost/private' });
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(success.status, 'ok');
  assert.equal(urls.length, 2);
  assert.equal(blocked.status, 'unverifiable');
  assert.equal(blockedUrls.length, 1);
});

test('serializes requests per host and enforces the configured minimum gap', async () => {
  let now = 0;
  const delays = [];
  const limiter = createHostRateLimiter({
    minIntervalMs: 500,
    now: () => now,
    sleep: async (ms) => {
      delays.push(ms);
      now += ms;
    },
  });

  await limiter('same.example', async () => { now += 100; });
  await limiter('same.example', async () => { now += 100; });
  assert.deepEqual(delays, [400]);
});

test('checks host groups and returns stable results', async () => {
  const calls = [];
  const links = [
    candidate('https://same.example/a'),
    candidate('https://same.example/b'),
    candidate('https://other.example/c'),
  ];
  const results = await checkExternalLinks(links, {
    fetchImpl: async (url, options) => {
      calls.push(new URL(url).hostname + ':' + options.method);
      return response(200);
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
    concurrency: 2,
  });

  assert.deepEqual(results.map((result) => result.url), links.map((link) => link.url).sort());
  assert.equal(calls.filter((call) => call.startsWith('same.example:')).length, 2);
});

test('changed-document selection excludes historical evidence paths', () => {
  const documents = [
    { path: 'README.md', content: '[a](https://a.example)' },
    { path: 'docs/guide.md', content: '[b](https://b.example)' },
    { path: 'docs/audits/old.md', content: '[c](https://c.example)' },
  ];
  const selected = selectChangedMarkdownDocuments(documents, [
    'README.md',
    'docs/guide.md',
    'docs/audits/old.md',
    'package.json',
  ]);

  assert.deepEqual(selected.map((document) => document.path), ['README.md', 'docs/guide.md']);
});

test('only confirmed broken or invalid destinations trigger the advisory PR failure', () => {
  assert.equal(shouldFailOnBroken([{ status: 'ok' }, { status: 'unverifiable' }, { status: 'skipped' }]), false);
  assert.equal(shouldFailOnBroken([{ status: 'broken' }]), true);
  assert.equal(shouldFailOnBroken([{ status: 'invalid' }]), true);
});
