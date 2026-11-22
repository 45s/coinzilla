import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';

import { OverviewComponent } from './features/overview/overview';
import { TradingHistoryComponent } from './features/trading-history/page';
import { OperatorComponent } from './features/operator/page';
import { MarketScreenerComponent } from './features/market-screener/page';
import type { TradingHistoryResource } from './features/trading-history/api';

type DashboardPage = 'overview' | 'operator' | 'markets' | TradingHistoryResource;
type DashboardTheme = 'current' | 'midnight' | 'light' | 'oled' | 'green' | 'arctic' | 'warm' | 'system';

const THEME_STORAGE_KEY = 'coinzilla.dashboard.theme';
const THEMES: readonly { value: DashboardTheme; label: string }[] = [
  { value: 'current', label: 'Current · Emerald' },
  { value: 'midnight', label: 'Midnight Terminal' },
  { value: 'light', label: 'Clean Light' },
  { value: 'oled', label: 'OLED / Neon' },
  { value: 'green', label: 'Green Terminal' },
  { value: 'arctic', label: 'Arctic' },
  { value: 'warm', label: 'Warm Graphite' },
  { value: 'system', label: 'System' },
];

export function readSavedDashboardTheme(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): DashboardTheme {
  if (!storage) return 'current';
  try {
    const saved = storage.getItem(THEME_STORAGE_KEY);
    return THEMES.some((theme) => theme.value === saved)
      ? (saved as DashboardTheme)
      : 'current';
  } catch {
    return 'current';
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OverviewComponent, TradingHistoryComponent, OperatorComponent, MarketScreenerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly navigationItems = [
    { label: 'Overview', icon: '◫', page: 'overview' as const, enabled: true },
    { label: 'Operator', icon: '⌘', page: 'operator' as const, enabled: true },
    { label: 'Orders', icon: '⇄', page: 'orders' as const, enabled: true },
    { label: 'Fills', icon: '⌁', page: 'fills' as const, enabled: true },
    { label: 'Commissions', icon: '◷', page: 'commissions' as const, enabled: true },
    { label: 'Markets', icon: '⌖', page: 'markets' as const, enabled: true },
    { label: 'Positions', icon: '▤', page: null, enabled: false },
    { label: 'Diagnostics', icon: '⌘', page: null, enabled: false },
  ] as const;

  readonly themeOptions = THEMES;
  readonly theme = signal<DashboardTheme>('current');
  readonly activePage = signal<DashboardPage>('overview');
  readonly activeLabel = computed(() =>
    this.navigationItems.find((item) => item.page === this.activePage())?.label ?? 'Overview',
  );
  readonly historyResource = computed<TradingHistoryResource>(() => {
    const page = this.activePage();
    return page === 'overview' || page === 'operator' || page === 'markets' ? 'orders' : page;
  });

  constructor() {
    this.theme.set(readSavedDashboardTheme(
      typeof window === 'undefined' ? undefined : window.localStorage,
    ));

    effect(() => {
      const selectedTheme = this.theme();
      if (typeof document !== 'undefined') {
        document.documentElement.dataset['theme'] = selectedTheme;
      }
    });
  }

  setTheme(value: string): void {
    if (!THEMES.some((theme) => theme.value === value)) return;

    const selectedTheme = value as DashboardTheme;
    this.theme.set(selectedTheme);

    // Apply and persist immediately; Angular effects may flush after the change event.
    if (typeof document !== 'undefined') {
      document.documentElement.dataset['theme'] = selectedTheme;
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
      } catch {
        // Keep the selected theme usable when browser storage is unavailable.
      }
    }
  }

  selectPage(page: DashboardPage | null): void {
    if (page) this.activePage.set(page);
  }
}
