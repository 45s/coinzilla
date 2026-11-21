import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { OverviewComponent } from './features/overview/overview';
import { TradingHistoryComponent } from './features/trading-history/trading-history';
import type { TradingHistoryResource } from './features/trading-history/trading-history-api';

type DashboardPage = 'overview' | TradingHistoryResource;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OverviewComponent, TradingHistoryComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly navigationItems = [
    { label: 'Overview', icon: '◫', page: 'overview' as const, enabled: true },
    { label: 'Orders', icon: '⇄', page: 'orders' as const, enabled: true },
    { label: 'Fills', icon: '⌁', page: 'fills' as const, enabled: true },
    { label: 'Commissions', icon: '◷', page: 'commissions' as const, enabled: true },
    { label: 'Markets', icon: '⌖', page: null, enabled: false },
    { label: 'Positions', icon: '▤', page: null, enabled: false },
    { label: 'Diagnostics', icon: '⌘', page: null, enabled: false },
  ] as const;

  readonly activePage = signal<DashboardPage>('overview');
  readonly activeLabel = computed(() =>
    this.navigationItems.find((item) => item.page === this.activePage())?.label ?? 'Overview',
  );
  readonly historyResource = computed<TradingHistoryResource>(() => {
    const page = this.activePage();
    return page === 'overview' ? 'orders' : page;
  });

  selectPage(page: DashboardPage | null): void {
    if (page) {
      this.activePage.set(page);
    }
  }
}
