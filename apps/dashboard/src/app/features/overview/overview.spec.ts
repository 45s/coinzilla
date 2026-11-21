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

    expect(renderedText).toContain('Portfolio value');
    expect(renderedText).toContain('$12,480.52');
    expect(renderedText).toContain('DEMO SNAPSHOT');
    expect(renderedText).toContain('fictional values');
  });

  it('shows that the backend is not connected instead of implying live readiness', async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText).toContain('No backend endpoint configured');
    expect(renderedText).toContain('No event connection configured');
    expect(renderedText).toContain('not connected to Harvester');
  });
});
