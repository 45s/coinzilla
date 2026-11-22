const FAVORITES_STORAGE_KEY = 'coinzilla.dashboard.exchange-favorites';

export function readFavoriteProviderIds(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): readonly string[] {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(FAVORITES_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((providerId): providerId is string =>
      typeof providerId === 'string' && providerId.length > 0,
    ))];
  } catch {
    return [];
  }
}

export function writeFavoriteProviderIds(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  providerIds: readonly string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...new Set(providerIds)]));
  } catch {
    // Favourites remain usable for the current page when browser storage is unavailable.
  }
}
