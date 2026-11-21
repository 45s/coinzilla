import { ChangeDetectionStrategy, Component } from '@angular/core';

import { OverviewComponent } from './features/overview/overview';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OverviewComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly navigationItems = [
    { label: 'Overview', icon: '◫', active: true },
    { label: 'Markets', icon: '⌁', active: false },
    { label: 'Positions', icon: '▤', active: false },
    { label: 'Orders', icon: '⇄', active: false },
    { label: 'Trade history', icon: '◷', active: false },
    { label: 'Diagnostics', icon: '⌘', active: false },
  ];
}
