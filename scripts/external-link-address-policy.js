import { isIP } from 'node:net';

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

