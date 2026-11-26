import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';

import { OverviewComponent } from './features/overview/overview';
import { TradingHistoryComponent } from './features/trading-history/page';
import { OperatorComponent } from './features/operator/page';
import { MarketScreenerComponent } from './features/market-screener/page';
import { ExchangesComponent } from './features/exchanges/page';
import { OpenOrdersComponent } from './features/open-orders/page';
import { BotsComponent } from './features/bots/page';
import { GitHubPullRequestsComponent } from './features/github-prs/page';
import type { TradingHistoryResource } from './features/trading-history/api';
import { ScenarioRunnerComponent } from './features/scenario-runner/page';

type DashboardPage = 'overview' | 'operator' | 'bots' | 'markets' | 'exchanges' | 'open-orders' | 'github-prs' | 'scenario-runner' | TradingHistoryResource;
type DashboardTheme = 'staradmin' | 'current' | 'midnight' | 'light' | 'oled' | 'green' | 'arctic' | 'warm' | 'system';

const THEME_STORAGE_KEY = 'coinzilla.dashboard.theme';
const THEMES: readonly { value: DashboardTheme; label: string }[] = [
  { value: 'staradmin', label: 'StarAdmin · Warm Light' },
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
  if (!storage) return 'staradmin';
  try {
    const saved = storage.getItem(THEME_STORAGE_KEY);
    return THEMES.some((theme) => theme.value === saved)
      ? (saved as DashboardTheme)
      : 'staradmin';
  } catch {
    return 'staradmin';
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OverviewComponent, TradingHistoryComponent, OperatorComponent, BotsComponent, MarketScreenerComponent, ExchangesComponent, OpenOrdersComponent, GitHubPullRequestsComponent, ScenarioRunnerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly navigationItems = [
    { label: 'Overview', icon: '◫', section: 'overview' as const, page: 'overview' as const },
    { label: 'Bots', icon: '◉', section: 'bots' as const, page: 'bots' as const },
    { label: 'Brokers', icon: '⇄', section: 'brokers' as const, page: 'markets' as const },
    { label: 'GitHub', icon: '⑂', section: 'github' as const, page: 'github-prs' as const },
    { label: 'Scenario Runner', icon: '▶', section: 'scenario-runner' as const, page: 'scenario-runner' as const },
  ] as const;
  readonly sectionNavigationItems = computed(() => {
    const section = this.activeSection();
    if (section === 'brokers') {
      return [
        { label: 'Markets', page: 'markets' as const, enabled: true },
        { label: 'Orders', page: 'orders' as const, enabled: true },
        { label: 'Open Orders', page: 'open-orders' as const, enabled: true },
        { label: 'Exchanges', page: 'exchanges' as const, enabled: true },
        { label: 'History', page: null, enabled: false },
      ];
    }
    if (section === 'bots') {
      return [
        { label: 'Operators', page: 'operator' as const, enabled: true },
        { label: 'Orders', page: 'orders' as const, enabled: true },
        { label: 'Positions', page: null, enabled: false },
        { label: 'Portfolio', page: 'bots' as const, enabled: true },
      ];
    }
    return [];
  });

  readonly themeOptions = THEMES;
  readonly theme = signal<DashboardTheme>('current');
  readonly activePage = signal<DashboardPage>('overview');
  readonly activeSection = signal<'overview' | 'bots' | 'brokers' | 'github' | 'scenario-runner'>('overview');
  readonly activeLabel = computed(() =>
    this.navigationItems.find((item) => item.page === this.activePage())?.label ?? 'Overview',
  );
  readonly historyResource = computed<TradingHistoryResource>(() => {
    const page = this.activePage();
    return page === 'overview' || page === 'operator' || page === 'bots' || page === 'markets' || page === 'exchanges' || page === 'open-orders' || page === 'github-prs' || page === 'scenario-runner' ? 'orders' : page;
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

  selectSection(section: 'overview' | 'bots' | 'brokers' | 'github' | 'scenario-runner'): void {
    this.activeSection.set(section);
    const pageBySection = {
      overview: 'overview',
      bots: 'bots',
      brokers: 'markets',
      github: 'github-prs',
      'scenario-runner': 'scenario-runner',
    } as const;
    this.activePage.set(pageBySection[section]);
  }

  selectSubPage(page: DashboardPage): void {
    this.activePage.set(page);
  }
}
