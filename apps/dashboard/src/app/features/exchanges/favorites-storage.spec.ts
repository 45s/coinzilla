import { describe, expect, it } from 'vitest';

import { readFavoriteProviderIds, writeFavoriteProviderIds } from './favorites-storage';

describe('exchange favourites storage', () => {
  it('persists unique provider IDs and restores them after reload', () => {
    let serialized: string | null = null;
    const storage = {
      getItem: () => serialized,
      setItem: (_key: string, value: string) => { serialized = value; },
    };

    writeFavoriteProviderIds(storage, ['binance-primary', 'bitunix-live', 'binance-primary']);

    expect(readFavoriteProviderIds(storage)).toEqual(['binance-primary', 'bitunix-live']);
  });

  it('ignores malformed payloads and invalid entries', () => {
    expect(readFavoriteProviderIds({ getItem: () => '{broken' })).toEqual([]);
    expect(readFavoriteProviderIds({ getItem: () => JSON.stringify(['binance', '', 42, 'binance']) }))
      .toEqual(['binance']);
    expect(readFavoriteProviderIds(undefined)).toEqual([]);
  });

  it('keeps favourites usable when storage writes fail', () => {
    expect(() => writeFavoriteProviderIds({
      setItem: () => { throw new Error('storage unavailable'); },
    }, ['binance-primary'])).not.toThrow();
  });
});
