import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPinned, isPublicAddress, resolvePublicAddresses } from './external-link-network.js';

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
      '<!-- [comment](https://comment.example/) -->',
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

test('preserves meaningful query delimiters and skips localhost with a trailing dot', () => {
  assert.equal(parseExternalUrl('https://query.example/path?').url, 'https://query.example/path?');
  assert.equal(parseExternalUrl('http://localhost./path').status, 'skipped');
});

test('marks malformed HTTP URLs and credential-bearing URLs invalid without exposing credentials', () => {
  assert.equal(parseExternalUrl('http://[').status, 'invalid');
  const credentialUrl = parseExternalUrl('https://user:secret@example.com/');
  assert.equal(credentialUrl.status, 'invalid');
  assert.equal(credentialUrl.url.includes('secret'), false);
});

test('rejects and redacts credential-like query parameters without requesting them', async () => {
  const secrets = [
    'https://docs.example/path?access_token=secret-access',
    'https://docs.example/path?api_key=secret-api',
    'https://docs.example/path?X-Amz-Signature=secret-signature',
  ];
  const links = secrets.map((url) => parseExternalUrl(url));

  assert.ok(links.every((link) => link.status === 'invalid'));
  assert.doesNotMatch(JSON.stringify(links), /secret-(?:access|api|signature)/);

  const extracted = extractExternalLinks(secrets.map((url, index) => ({
    path: 'docs/' + index + '.md',
    content: '[credential](<' + url + '>)',
  })));
  assert.ok(extracted.every((link) => link.status === 'invalid'));
  assert.doesNotMatch(JSON.stringify(extracted), /secret-(?:access|api|signature)/);

  let requests = 0;
  await checkExternalLinks(extracted, {
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });
  assert.equal(requests, 0);
});

test('keeps GET 404/410 unverifiable when HEAD first reports access control', async () => {
  for (const headStatus of [401, 403]) {
    const result = await checkExternalLink(candidate('https://access-controlled.example/'), {
      fetchImpl: async (_url, options) => response(options.method === 'HEAD' ? headStatus : 404),
      sleep: noDelay,
      minHostIntervalMs: 0,
    });

    assert.equal(result.status, 'unverifiable');
    assert.match(result.reason, /after HEAD returned an access-control response/);
  }
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
  const success = await checkExternalLink(candidate('https://redirect.example.com/start'), {
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
  assert.equal(blocked.status, 'skipped', 'A redirect to a local-only destination must be blocked before a second request.');
  assert.equal(blockedUrls.length, 1);
});

test('treats repeated rate limiting as unverifiable after bounded retries', async () => {
  let attempts = 0;
  const delays = [];
  const result = await checkExternalLink(candidate('https://always-limited.example/'), {
    fetchImpl: async () => {
      attempts += 1;
      return response(429);
    },
    sleep: async (ms) => delays.push(ms),
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'unverifiable');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('stops after the configured redirect limit', async () => {
  let attempts = 0;
  const result = await checkExternalLink(candidate('https://redirect-loop.example.com/'), {
    fetchImpl: async () => {
      attempts += 1;
      return response(302, { location: '/again' });
    },
    sleep: noDelay,
    minHostIntervalMs: 0,
    maxRedirects: 2,
  });

  assert.equal(result.status, 'unverifiable');
  assert.match(result.reason, /Redirect limit exceeded/);
  assert.equal(attempts, 3);
});

test('does not request invalid or local-only destinations', async () => {
  let requests = 0;
  const invalid = parseExternalUrl('https://user:secret@example.com/');
  const skipped = parseExternalUrl('http://localhost/');
  const results = await checkExternalLinks([invalid, skipped], {
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });

  assert.equal(requests, 0);
  assert.deepEqual(results.map((result) => result.status).sort(), ['invalid', 'skipped']);
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

test('classifies public IPv4 and rejects private, shared, reserved, and metadata IPv4 ranges', () => {
  assert.equal(typeof isPublicAddress, 'function', 'The checker must expose its deterministic IP-address policy for focused tests.');

  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.equal(isPublicAddress(address), true, address + ' is a globally routable IPv4 destination.');
  }
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '100.100.100.200',
    '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.1',
    '192.0.2.1', '192.168.1.1', '192.88.99.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '255.255.255.255', '168.63.129.16',
  ]) {
    assert.equal(isPublicAddress(address), false, address + ' is private, shared, reserved, multicast, link-local, or metadata-related and must never be requested.');
  }
});

test('classifies global IPv6 and rejects loopback, mapped, ULA, link-local, multicast, and reserved IPv6', () => {
  assert.equal(typeof isPublicAddress, 'function', 'The checker must expose IPv6 address classification for deterministic security tests.');

  assert.equal(isPublicAddress('2001:4860:4860::8888'), true, 'A globally routable Google IPv6 address is eligible.');
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true, 'A globally routable Cloudflare IPv6 address is eligible.');
  for (const address of [
    '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fd12:3456:789a::1',
    'fe80::1', 'ff02::1', '100::1', '2001:db8::1', '2001:2::1',
    '2002:0808:0808::1', '3fff::1', '64:ff9b::a9fe:a9fe',
  ]) {
    assert.equal(isPublicAddress(address), false, address + ' is not an eligible globally routable IPv6 destination.');
  }
});

test('validates every DNS answer and rejects mixed public/private answer sets', async () => {
  assert.equal(typeof resolvePublicAddresses, 'function', 'DNS validation must be independently testable with an injected resolver.');

  const resolved = await resolvePublicAddresses('docs.example.com', {
    resolveHost: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  });
  assert.deepEqual(resolved, [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ], 'Every vetted A/AAAA answer must be retained for connection pinning.');

  await assert.rejects(
    resolvePublicAddresses('mixed.example.com', {
      resolveHost: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.7', family: 4 },
      ],
    }),
    (error) => error.code === 'ERR_EXTERNAL_LINK_UNSAFE_ADDRESS',
    'A single private answer must reject the entire mixed DNS answer set before any connection is attempted.',
  );
});

test('pins socket lookup to vetted answers without resolving the hostname again', async () => {
  assert.equal(typeof fetchPinned, 'function', 'The checker must expose the pinned HTTP transport for deterministic connection tests.');

  let resolverCalls = 0;
  let connectedAddress;
  const result = await fetchPinned('https://rebind.example.com/path', {
    method: 'HEAD',
    headers: { 'user-agent': 'test' },
  }, {
    resolveHost: async () => {
      resolverCalls += 1;
      return [{
        address: resolverCalls === 1 ? '8.8.8.8' : '127.0.0.1',
        family: 4,
      }];
    },
    requestImpl: (url, options, onResponse) => {
      options.lookup(url.hostname, {}, (error, address) => {
        assert.equal(error, null, 'The vetted DNS answer must be supplied to the socket lookup.');
        connectedAddress = address;
      });
      queueMicrotask(() => onResponse({ statusCode: 200, headers: {}, resume() {} }));
      return { on() { return this; }, end() {} };
    },
  });

  assert.equal(result.status, 200, 'The pinned transport must preserve the HTTP response status.');
  assert.equal(resolverCalls, 1, 'A single request must not perform a second DNS lookup after validation.');
  assert.equal(connectedAddress, '8.8.8.8', 'The socket lookup must receive the exact public address that was validated.');
});

test('revalidates DNS for every redirect and blocks a redirect to a private address', async () => {
  assert.equal(typeof fetchPinned, 'function', 'Redirect tests require the same pinned transport used by production requests.');

  const requestedHosts = [];
  const result = await checkExternalLink(candidate('https://public.example.com/start'), {
    fetchImpl: (url, init) => fetchPinned(url, init, {
      resolveHost: async (hostname) => [{
        address: hostname === 'public.example.com' ? '8.8.8.8' : '127.0.0.1',
        family: 4,
      }],
      requestImpl: (requestUrl, options, onResponse) => {
        requestedHosts.push(requestUrl.hostname);
        options.lookup(requestUrl.hostname, {}, (error) => {
          assert.equal(error, null, 'Only the already-vetted public redirect source may reach the socket lookup.');
        });
        queueMicrotask(() => onResponse({
          statusCode: 302,
          headers: { location: 'https://private-redirect.example.com/metadata' },
          resume() {},
        }));
        return { on() { return this; }, end() {} };
      },
    }),
    sleep: noDelay,
    minHostIntervalMs: 0,
  });

  assert.equal(result.status, 'skipped', 'A redirect whose DNS answers include a private address must be classified as safely blocked.');
  assert.deepEqual(requestedHosts, ['public.example.com'], 'The private redirect destination must be rejected before opening an HTTP(S) connection.');
});
