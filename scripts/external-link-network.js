import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

/**
 * @typedef {(hostname: string, options: {all: boolean, verbatim: boolean}) => Promise<Array<{address: string, family: number}>>} DnsResolver
 */

/**
 * @typedef {(url: URL, options: object, onResponse: (response: {statusCode?: number, headers?: Record<string, string|string[]>, resume: () => void}) => void) => {on: (event: string, listener: (error: Error) => void) => object, end: () => void}} HttpRequestImplementation
 */

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


const IPV4_BLOCKED_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['168.63.129.16', 32],
];

const IPV6_GLOBAL_UNICAST = ['2000::', 3];
const IPV6_BLOCKED_CIDRS = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
];

function ipv4ToBigInt(address) {
  if (isIP(address) !== 4) return null;
  return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6ToBigInt(address) {
  if (isIP(address) !== 6 || address.includes('%')) return null;

  let normalized = address.toLowerCase();
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const ipv4 = ipv4ToBigInt(normalized.slice(separator + 1));
    if (ipv4 === null) return null;
    const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4 & 0xffffn).toString(16);
    normalized = normalized.slice(0, separator + 1) + high + ':' + low;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups;
  if (halves.length === 2) {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) return null;
    groups = [...left, ...Array(omitted).fill('0'), ...right];
  } else {
    groups = left;
  }

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt('0x' + group), 0n);
}

function parseCidrNetwork(address, family) {
  return family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
}

function isInCidr(addressValue, networkAddress, prefixLength, bitLength) {
  const mask = ((1n << BigInt(prefixLength)) - 1n) << BigInt(bitLength - prefixLength);
  return (addressValue & mask) === (networkAddress & mask);
}

const IPV4_BLOCKED_NETWORKS = IPV4_BLOCKED_CIDRS.map(([network, prefix]) => ({
  network: parseCidrNetwork(network, 4),
  prefix,
}));

const IPV6_GLOBAL_NETWORK = {
  network: parseCidrNetwork(IPV6_GLOBAL_UNICAST[0], 6),
  prefix: IPV6_GLOBAL_UNICAST[1],
};

const IPV6_BLOCKED_NETWORKS = IPV6_BLOCKED_CIDRS.map(([network, prefix]) => ({
  network: parseCidrNetwork(network, 6),
  prefix,
}));

/**
 * Return whether an address is globally routable and safe as an external-link destination.
 * The policy is intentionally conservative: unknown, special-purpose and transition ranges fail closed.
 * @param {string} address
 * @returns {boolean}
 */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    return !IPV4_BLOCKED_NETWORKS.some(({ network, prefix }) => isInCidr(value, network, prefix, 32));
  }
  if (family === 6) {
    const value = ipv6ToBigInt(address);
    if (value === null || !isInCidr(value, IPV6_GLOBAL_NETWORK.network, IPV6_GLOBAL_NETWORK.prefix, 128)) {
      return false;
    }
    return !IPV6_BLOCKED_NETWORKS.some(({ network, prefix }) => isInCidr(value, network, prefix, 128));
  }
  return false;
}

function createUnsafeAddressError() {
  const error = new Error('DNS resolution returned a non-public or reserved address; request blocked');
  error.code = 'ERR_EXTERNAL_LINK_UNSAFE_ADDRESS';
  return error;
}

/**
 * Resolve and validate every A/AAAA answer before opening a socket.
 * A mixed public/private answer set is rejected in full.
 * @param {string} hostname
 * @param {object} options
 * @param {DnsResolver} [options.resolveHost] Injectable DNS resolver for deterministic tests.
 * @returns {Promise<Array<{address: string, family: number}>>}
 */
export async function resolvePublicAddresses(hostname, options = {}) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(normalizedHostname) || isLocalHostname(normalizedHostname)) {
    throw createUnsafeAddressError();
  }
  const resolver = options.resolveHost ?? dnsLookup;
  const answers = await resolver(normalizedHostname, { all: true, verbatim: true });
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
export function createPinnedLookup(hostname, addresses) {
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
  const addresses = await resolvePublicAddresses(hostname, options);
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

