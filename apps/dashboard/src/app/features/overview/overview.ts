import { ChangeDetectionStrategy, Component } from '@angular/core';

import {
  demoMetrics,
  demoPositions,
  demoServices,
} from './overview.data';

@Component({
  selector: 'app-overview',
  standalone: true,
  templateUrl: './overview.html',
  styleUrl: './overview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  readonly metrics = demoMetrics;
  readonly positions = demoPositions;
  readonly services = demoServices;
}
