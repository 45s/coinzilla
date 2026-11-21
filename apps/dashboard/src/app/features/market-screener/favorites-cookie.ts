import type { MarketSource } from './market-source';

const COOKIE_NAMES: Readonly<Record<MarketSource, string>> = Object.freeze({
  'bitunix-futures': 'coinzilla_market_favorites_bitunix_futures',
  'bitunix-spot': 'coinzilla_market_favorites_bitunix_spot',
  'binance-futures': 'coinzilla_market_favorites_binance_futures',
  'binance-spot': 'coinzilla_market_favorites_binance_spot',
});

const COOKIE_MAX_AGE_SECONDS = 31_536_000;
const VALID_SYMBOL = /^[A-Z0-9_-]{2,32}$/;

function parseCookieValue(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [...new Set(parsed.filter((symbol): symbol is string =>
      typeof symbol === 'string' && VALID_SYMBOL.test(symbol),
    ))];
  } catch {
    return [];
  }
}

export function readMarketFavorites(cookieHeader: string, source: MarketSource): readonly string[] {
  const prefix = `${COOKIE_NAMES[source]}=`;
  const entry = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? parseCookieValue(entry.slice(prefix.length)) : [];
}

export function createMarketFavoritesCookie(
  source: MarketSource,
  symbols: readonly string[],
  secure: boolean,
): string {
  const favorites = [...new Set(symbols.filter((symbol) => VALID_SYMBOL.test(symbol)))].sort();
  const secureAttribute = secure ? '; Secure' : '';
  return `${COOKIE_NAMES[source]}=${encodeURIComponent(JSON.stringify(favorites))}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secureAttribute}`;
}
