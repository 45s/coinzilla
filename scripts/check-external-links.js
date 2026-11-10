import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findMarkdownDocuments, removeCodeExamples } from './check-agent-policy.js';
import { isHistoricalPath } from './check-markdown-style.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const GET_FALLBACK_STATUSES = new Set([401, 403, 404, 405, 410, 501]);
const CREDENTIAL_QUERY_PARAMETERS = new Set([
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'id_token', 'idtoken',
  'token', 'api_key', 'apikey', 'client_secret', 'clientsecret', 'secret', 'password',
  'signature', 'sig', 'authorization', 'auth', 'credential', 'credentials', 'session',
  'session_id', 'sessionid', 'jwt', 'x-amz-signature', 'x-amz-credential',
  'x-amz-security-token', 'x-goog-signature', 'x-goog-credential',
  'x-goog-security-token', 'awsaccesskeyid', 'oauth_token', 'oauth_signature',
  'oauth_consumer_key', 'key', 'code',
]);
const USER_AGENT = 'Coinzilla-Documentation-Link-Checker/1.0';

function countCharacter(value, character) {
  return [...value].filter((item) => item === character).length;
}

function trimUrlPunctuation(value) {
  let result = value.trim().replace(/^<|>$/g, '');
  while (/[.,;:]$/.test(result)) result = result.slice(0, -1);
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [opening, closing] of pairs) {
    while (result.endsWith(closing) && countCharacter(result, closing) > countCharacter(result, opening)) {
      result = result.slice(0, -1);
    }
  }
  return result;
}

function isCredentialQueryParameter(name) {
  return CREDENTIAL_QUERY_PARAMETERS.has(String(name).toLowerCase());
}

function redactCredentials(value) {
  const userInfoRedacted = value.replace(/(https?:\/\/)[^/@\s]+@/i, '$1[redacted]@');

  try {
    const parsed = new URL(userInfoRedacted);
    for (const key of parsed.searchParams.keys()) {
      if (isCredentialQueryParameter(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return parsed.href;
  } catch {
    return userInfoRedacted.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, separator, name) => {
      let decodedName = name;
      try {
        decodedName = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // Keep malformed parameter names unchanged.
      }
      return isCredentialQueryParameter(decodedName)
        ? separator + name + '=[redacted]'
        : match;
    });
  }
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' ||
    hostname === 'localdomain' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.home.arpa') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.intranet') ||
    hostname.endsWith('.private');
}

/**
 * Parse an HTTP(S) destination and classify URLs that must not be requested.
 * IP-literal and local-only hosts are skipped. DNS answers are not pinned yet;
 * do not run this checker against untrusted Markdown until issue #901 is complete.
 * @param {string} raw
 * @returns {{status: 'candidate'|'skipped'|'invalid', url: string, host?: string, reason?: string}|null}
 */
export function parseExternalUrl(raw) {
  const value = String(raw).trim().replace(/^<([^>]+)>$/, '$1').replace(/&amp;/g, '&');
  if (!/^https?:\/\//i.test(value)) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { status: 'invalid', url: redactCredentials(value), reason: 'Malformed HTTP(S) URL' };
  }

  const credentialQueryParameters = [...parsed.searchParams.keys()].filter(isCredentialQueryParameter);
  if (parsed.username || parsed.password || credentialQueryParameters.length > 0) {
    return {
      status: 'invalid',
      url: redactCredentials(value),
      reason: 'URL embeds credentials or credential-like query parameters',
    };
  }

  parsed.hash = '';
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (isIP(hostname) || isLocalHostname(hostname)) {
    return { status: 'skipped', url: parsed.href, host: hostname, reason: 'Local-only or IP-literal host is not requested' };
  }

  parsed.hostname = hostname;
  return { status: 'candidate', url: parsed.href, host: hostname };
}

/**
 * Extract HTTP(S) destinations from Markdown inline links, reference definitions,
 * autolinks, and bare prose URLs. Code examples are excluded.
 * @param {{path: string, content: string}[]} documents
 * @returns {Array<{url: string, host?: string, status: string, reason?: string, paths: string[], originalUrls: string[]}>}
 */
export function extractExternalLinks(documents) {
  const links = new Map();

  function add(raw, path) {
    const parsed = parseExternalUrl(raw);
    if (!parsed) return;
    const key = parsed.status + ':' + parsed.url;
    let link = links.get(key);
    if (!link) {
      link = { ...parsed, paths: [], originalUrls: [] };
      links.set(key, link);
    }
    if (!link.paths.includes(path)) link.paths.push(path);
    const original = redactCredentials(String(raw).trim());
    if (!link.originalUrls.includes(original)) link.originalUrls.push(original);
  }

  for (const document of documents) {
    const content = removeCodeExamples(document.content).replace(/<!--[\s\S]*?-->/g, '');
    const inlineLinks = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
    const referenceDefinitions = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))/gm;
    const autolinks = /<(https?:\/\/[^>\s]+)>/gi;
    const bareUrls = /https?:\/\/[^\s<>"']+/gi;

    for (const match of content.matchAll(inlineLinks)) {
      add(match[1] || match[2], document.path);
    }
    for (const match of content.matchAll(referenceDefinitions)) {
      add(match[1] || trimUrlPunctuation(match[2]), document.path);
    }
    for (const match of content.matchAll(autolinks)) {
      add(match[1], document.path);
    }
    for (const match of content.matchAll(bareUrls)) {
      add(trimUrlPunctuation(match[0]), document.path);
    }
  }

  return [...links.values()]
    .map((link) => ({
      ...link,
      paths: link.paths.sort(),
      originalUrls: link.originalUrls.sort(),
    }))
    .sort((left, right) => left.url.localeCompare(right.url));
}

/**
 * Select changed maintained Markdown documents. Historical evidence remains
 * visible in full-tree reports but is excluded from the PR changed-document check.
 * @param {{path: string, content: string}[]} documents
 * @param {string[]} changedPaths
 * @returns {{path: string, content: string}[]}
 */
export function selectChangedMarkdownDocuments(documents, changedPaths) {
  const changed = new Set(changedPaths.filter((path) => /\.mdx?$/i.test(path)));
  return documents.filter((document) => changed.has(document.path) && !isHistoricalPath(document.path));
}

/**
 * Parse Retry-After as delta seconds or an HTTP date, capped to avoid unbounded waits.
 * @param {string|null} value
 * @param {number} nowMs
 * @param {number} maxWaitMs
 * @returns {number|null}
 */
export function parseRetryAfter(value, nowMs = Date.now(), maxWaitMs = 30_000) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxWaitMs, seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(maxWaitMs, Math.max(0, timestamp - nowMs));
}

/**
 * Serialize requests per host and enforce a minimum gap between request starts.
 * @param {{minIntervalMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} options
 */
export function createHostRateLimiter(options = {}) {
  const minIntervalMs = options.minIntervalMs ?? 500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const tails = new Map();
  const lastStarted = new Map();

  return async function run(host, task) {
    const previous = tails.get(host) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    const tail = previous.then(() => gate);
    tails.set(host, tail);
    await previous;

    const elapsed = now() - (lastStarted.get(host) ?? Number.NEGATIVE_INFINITY);
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
    lastStarted.set(host, now());

    try {
      return await task();
    } finally {
      release();
      if (tails.get(host) === tail) tails.delete(host);
    }
  };
}

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function cancelResponseBody(response, method) {
  if (method !== 'GET' || !response.body || typeof response.body.cancel !== 'function') return;
  try {
    await response.body.cancel();
  } catch {
    // A cancelled/consumed response body does not change the HTTP status result.
  }
}

async function fetchWithRetries(url, method, options) {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const hostLimiter = options.hostLimiter;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
      const response = await hostLimiter(new URL(url).hostname, () => fetchImpl(url, {
        method,
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...(method === 'GET' ? { range: 'bytes=0-0' } : {}),
        },
        signal,
      }));
      await cancelResponseBody(response, method);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return { response };
      }

      const retryAfter = parseRetryAfter(response.headers?.get?.('retry-after'), now(), maxRetryAfterMs);
      const backoff = Math.min(maxRetryAfterMs, baseDelayMs * (2 ** attempt));
      await sleep(retryAfter ?? backoff);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) return { error: lastError };
      await sleep(Math.min(maxRetryAfterMs, baseDelayMs * (2 ** attempt)));
    }
  }

  return { error: lastError ?? new Error('Request attempts exhausted') };
}

async function fetchFollowingRedirects(startUrl, method, options) {
  let currentUrl = startUrl;
  const maxRedirects = options.maxRedirects ?? 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const result = await fetchWithRetries(currentUrl, method, options);
    if (result.error) return { reason: 'Network request failed after retries: ' + result.error.message };

    const response = result.response;
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: currentUrl };

    const location = response.headers?.get?.('location');
    if (!location) return { reason: 'Redirect response did not include a Location header' };
    if (redirectCount === maxRedirects) return { reason: 'Redirect limit exceeded (' + maxRedirects + ')' };

    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return { reason: 'Redirect Location was not a valid URL' };
    }

    const parsed = parseExternalUrl(nextUrl.href);
    if (!parsed || parsed.status !== 'candidate') {
      return { reason: 'Redirect target is not an eligible public HTTP(S) hostname' };
    }
    currentUrl = parsed.url;
  }

  return { reason: 'Redirect limit exceeded (' + maxRedirects + ')' };
}

function isSuccessfulStatus(status) {
  return status >= 200 && status < 300;
}

function isBrokenStatus(status) {
  return status === 404 || status === 410;
}

/**
 * Check one external link. Only confirmed GET 404/410 responses are broken;
 * network and access-control failures remain unverifiable.
 * @param {object} link Extracted link record.
 * @param {object} options Injectable network/rate-limit options for tests.
 * @returns {Promise<object>}
 */
export async function checkExternalLink(link, options = {}) {
  if (link.status === 'invalid' || link.status === 'skipped') return link;

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const hostLimiter = options.hostLimiter ?? createHostRateLimiter({
    minIntervalMs: options.minHostIntervalMs ?? 500,
    now,
    sleep,
  });
  const requestOptions = { ...options, sleep, now, hostLimiter };
  const head = await fetchFollowingRedirects(link.url, 'HEAD', requestOptions);

  if (head.reason) {
    return { ...link, status: 'unverifiable', reason: head.reason };
  }
  if (isSuccessfulStatus(head.response.status)) {
    return { ...link, status: 'ok', checkedUrl: head.finalUrl };
  }
  if (!GET_FALLBACK_STATUSES.has(head.response.status)) {
    return { ...link, status: 'unverifiable', reason: 'HEAD returned HTTP ' + head.response.status };
  }

  const get = await fetchFollowingRedirects(link.url, 'GET', requestOptions);
  if (get.reason) {
    return { ...link, status: 'unverifiable', reason: get.reason };
  }
  if (isSuccessfulStatus(get.response.status)) {
    return { ...link, status: 'ok', checkedUrl: get.finalUrl };
  }
  if (isBrokenStatus(get.response.status)) {
    if (head.response.status === 401 || head.response.status === 403) {
      return {
        ...link,
        status: 'unverifiable',
        reason: 'GET returned HTTP ' + get.response.status + ' after HEAD returned an access-control response (HTTP ' + head.response.status + ')',
      };
    }
    return { ...link, status: 'broken', reason: 'GET confirmed HTTP ' + get.response.status };
  }
  return { ...link, status: 'unverifiable', reason: 'GET returned HTTP ' + get.response.status };
}

/**
 * Check unique links with bounded global concurrency and per-host serialization.
 * @param {object[]} links
 * @param {object} options
 * @returns {Promise<object[]>}
 */
export async function checkExternalLinks(links, options = {}) {
  const concurrency = options.concurrency ?? 4;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const hostLimiter = options.hostLimiter ?? createHostRateLimiter({
    minIntervalMs: options.minHostIntervalMs ?? 500,
    now,
    sleep,
  });
  const results = links.filter((link) => link.status !== 'candidate');
  const groups = new Map();

  for (const link of links) {
    if (link.status !== 'candidate') continue;
    const group = groups.get(link.host) ?? [];
    group.push(link);
    groups.set(link.host, group);
  }

  const hostGroups = [...groups.values()];
  let nextGroup = 0;
  const workerCount = Math.min(concurrency, hostGroups.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextGroup < hostGroups.length) {
      const group = hostGroups[nextGroup];
      nextGroup += 1;
      for (const link of group) {
        results.push(await checkExternalLink(link, { ...options, sleep, now, hostLimiter }));
      }
    }
  }));

  return results.sort((left, right) => left.url.localeCompare(right.url));
}

/**
 * Get the changed maintained Markdown documents from a base commit.
 * @param {string} baseSha
 * @param {string} root
 * @returns {{path: string, content: string}[]}
 */
export function getChangedMarkdownDocuments(baseSha, root = repositoryRoot) {
  if (typeof baseSha !== 'string' || !/^[a-f0-9]{40}$/i.test(baseSha)) {
    throw new TypeError('Changed-document mode requires a 40-character base commit SHA');
  }
  const changedText = execFileSync('git', ['diff', '--name-only', baseSha, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  const changedPaths = changedText.split(/\r?\n/).filter(Boolean);
  return selectChangedMarkdownDocuments(findMarkdownDocuments(root), changedPaths);
}

/**
 * Whether changed-document checking should return a failing exit code.
 * @param {object[]} results
 * @returns {boolean}
 */
export function shouldFailOnBroken(results) {
  return results.some((result) => result.status === 'broken' || result.status === 'invalid');
}

function parseArguments(argv) {
  const options = { mode: 'all', baseSha: null, failOnBroken: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      options.mode = 'all';
    } else if (argument === '--changed') {
      options.mode = 'changed';
      options.baseSha = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === '--fail-on-broken') {
      options.failOnBroken = true;
    } else if (argument === '--report-only') {
      options.failOnBroken = false;
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }
  if (options.mode === 'changed' && !options.baseSha) {
    throw new Error('--changed requires the exact PR base SHA');
  }
  return options;
}

function printResults(mode, links, results) {
  const counts = results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    return summary;
  }, {});
  console.log(
    'External Markdown links (' + mode + '): ' +
    links.length + ' unique URLs; ' +
    (counts.ok ?? 0) + ' OK; ' +
    (counts.broken ?? 0) + ' confirmed broken; ' +
    (counts.invalid ?? 0) + ' invalid; ' +
    (counts.unverifiable ?? 0) + ' unverifiable; ' +
    (counts.skipped ?? 0) + ' skipped.',
  );
  for (const result of results) {
    if (result.status === 'ok') continue;
    console.log(
      '- ' + result.status + ': ' + result.url +
      ' [' + result.paths.join(', ') + ']' +
      (result.reason ? ' — ' + result.reason : ''),
    );
  }
}

/**
 * Run the external link checker. Full-tree mode is report-only by default.
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const documents = options.mode === 'changed'
    ? getChangedMarkdownDocuments(options.baseSha)
    : findMarkdownDocuments(repositoryRoot);
  const links = extractExternalLinks(documents);
  const results = await checkExternalLinks(links);
  printResults(options.mode, links, results);
  if (options.failOnBroken && shouldFailOnBroken(results)) process.exitCode = 1;
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('External Markdown link check failed:', error);
    process.exitCode = 1;
  });
}
