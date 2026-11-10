import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';

import { isLocalHostname, isPublicAddress } from './external-link-address-policy.js';
import { request as httpsRequest } from 'node:https';

/**
 * @typedef {(hostname: string, options: {all: boolean, verbatim: boolean}) => Promise<Array<{address: string, family: number}>>} DnsResolver
 */

/**
 * @typedef {(url: URL, options: object, onResponse: (response: {statusCode?: number, headers?: Record<string, string|string[]>, resume: () => void}) => void) => {on: (event: string, listener: (error: Error) => void) => object, end: () => void}} HttpRequestImplementation
 */

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function createUnsafeAddressError() {
  const error = new Error('DNS resolution returned a non-public or reserved address; request blocked');
  error.code = 'ERR_EXTERNAL_LINK_UNSAFE_ADDRESS';
  return error;
}


async function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    throw signal.reason ?? new Error('DNS resolution aborted before completion');
  }

  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(signal.reason ?? new Error('DNS resolution aborted before completion'));
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', abortListener);
  }
}

/**
 * Resolve and validate every A/AAAA answer before opening a socket.
 * A mixed public/private answer set is rejected in full.
 * @param {string} hostname
 * @param {object} options
 * @param {DnsResolver} [options.resolveHost] Injectable DNS resolver for deterministic tests.
 * @param {AbortSignal} [options.signal] Request timeout/cancellation signal.
 * @returns {Promise<Array<{address: string, family: number}>>}
 */
export async function resolvePublicAddresses(hostname, options = {}) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(normalizedHostname) || isLocalHostname(normalizedHostname)) {
    throw createUnsafeAddressError();
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error('DNS resolution aborted before completion');
  }
  const resolver = options.resolveHost ?? dnsLookup;
  const resolution = resolver(normalizedHostname, { all: true, verbatim: true });
  const answers = await awaitWithAbort(resolution, options.signal);
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('DNS resolution returned no addresses');
  }

  const addresses = new Map();
  for (const answer of answers) {
    const address = answer?.address;
    const family = typeof address === 'string' ? isIP(address) : 0;
    if (family === 0 || !isPublicAddress(address)) {
      throw createUnsafeAddressError();
    }
    addresses.set(address.toLowerCase(), { address, family });
  }

  return [...addresses.values()];
}

/**
 * Create a Node lookup callback that can return only the already-vetted DNS answers.
 * @param {string} hostname
 * @param {Array<{address: string, family: number}>} addresses
 * @returns {(hostname: string, options: object, callback: (error: Error|null, address: string|Array<{address: string, family: number}>, family?: number) => void) => void}
 */
function createPinnedLookup(hostname, addresses) {
  const expectedHostname = hostname.toLowerCase().replace(/\.$/, '');
  return (requestedHostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof lookupOptions === 'function') {
      done = lookupOptions;
      lookupOptions = {};
    }

    if (requestedHostname.toLowerCase().replace(/\.$/, '') !== expectedHostname) {
      const error = new Error('Socket lookup hostname does not match the validated destination');
      error.code = 'ENOTFOUND';
      done(error);
      return;
    }

    const family = lookupOptions?.family ?? 0;
    const eligible = addresses.filter((entry) => family === 0 || entry.family === family);
    if (eligible.length === 0) {
      const error = new Error('No vetted DNS answer is available for the requested address family');
      error.code = 'ENOTFOUND';
      done(error);
      return;
    }

    if (lookupOptions?.all === true) {
      done(null, eligible.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }

    done(null, eligible[0].address, eligible[0].family);
  };
}

/**
 * Perform one HTTP(S) request using a socket lookup pinned to validated DNS answers.
 * Redirects are handled by fetchFollowingRedirects and therefore resolved independently.
 * @param {string|URL} input
 * @param {object} init
 * @param {object} options
 * @param {DnsResolver} [options.resolveHost] Injectable DNS resolver for deterministic tests.
 * @param {HttpRequestImplementation} [options.requestImpl] Injectable HTTP(S) request implementation for deterministic tests.
 * @returns {Promise<{status: number, headers: {get: (name: string) => string|null}, body: null}>}
 */
export async function fetchPinned(input, init = {}, options = {}) {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Pinned transport only supports HTTP(S) URLs');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const addresses = await resolvePublicAddresses(hostname, {
    ...options,
    signal: init.signal ?? options.signal,
  });
  const transport = options.requestImpl ?? (url.protocol === 'https:' ? httpsRequest : httpRequest);
  const lookup = createPinnedLookup(hostname, addresses);

  return new Promise((resolveResponse, rejectRequest) => {
    let request;
    try {
      request = transport(url, {
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        signal: init.signal,
        lookup,
      }, (response) => {
        const headers = new Map(
          Object.entries(response.headers ?? {}).map(([name, value]) => [
            name.toLowerCase(),
            Array.isArray(value) ? value.join(', ') : String(value),
          ]),
        );
        response.resume();
        resolveResponse({
          status: response.statusCode ?? 0,
          headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
          body: null,
        });
      });
    } catch (error) {
      rejectRequest(error);
      return;
    }

    request.on('error', rejectRequest);
    request.end();
  });
}

