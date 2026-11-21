import { describe, expect, it } from 'vitest';

import { createMarketFavoritesCookie, readMarketFavorites } from './favorites-cookie';

describe('market screener favourites cookies', () => {
  it('stores a one-year SameSite=Lax cookie scoped to the browser path', () => {
    const cookie = createMarketFavoritesCookie('bitunix-futures', ['ETHUSDT', 'BTCUSDT'], false);

    expect(cookie).toContain('coinzilla_market_favorites_bitunix_futures=');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure on HTTPS and reads only the selected market source cookie', () => {
    const futures = createMarketFavoritesCookie('bitunix-futures', ['BTCUSDT'], true);
    const spot = createMarketFavoritesCookie('bitunix-spot', ['ETHUSDT'], true);

    expect(futures).toContain('; Secure');
    expect(readMarketFavorites(`${futures}; ${spot}`, 'bitunix-futures')).toEqual(['BTCUSDT']);
    expect(readMarketFavorites(`${futures}; ${spot}`, 'bitunix-spot')).toEqual(['ETHUSDT']);
  });

  it('ignores malformed cookie payloads and invalid symbols', () => {
    const cookie = 'coinzilla_market_favorites_bitunix_futures=%7Bbad-json';

    expect(readMarketFavorites(cookie, 'bitunix-futures')).toEqual([]);
    expect(readMarketFavorites('coinzilla_market_favorites_bitunix_futures=%5B%22BTCUSDT%22%2C%22%3Cscript%3E%22%5D', 'bitunix-futures')).toEqual(['BTCUSDT']);
  });
});
