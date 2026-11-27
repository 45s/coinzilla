import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { OverviewComponent } from './overview';

describe('OverviewComponent', () => {
  it('renders the portfolio summary and marks the content as demo data', async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText, 'Overview must keep the portfolio summary visible.').toContain('Portfolio value');
    expect(renderedText, 'Fictional portfolio values must remain explicitly identified as demo data.').toContain('DEMO SNAPSHOT');
    expect(renderedText, 'The demo positions must remain labeled as fictional values.').toContain('fictional values');
  });

  it('does not render hard-coded offline states as the live system-health result', async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText, 'System health must not claim that no backend endpoint is configured without checking the runtime endpoint.').not.toContain('No backend endpoint configured');
    expect(renderedText, 'System health must not claim that no event connection is configured when the event stream is actually probed.').not.toContain('No event connection configured');
    expect(renderedText, 'The permanent preview disclaimer must be replaced by observed connection state.').not.toContain('This preview is not connected to Harvester');
  });
});
