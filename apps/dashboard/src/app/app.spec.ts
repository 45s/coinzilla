import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AppComponent } from './app';

describe('AppComponent', () => {
  it('renders the Coinzilla dashboard shell and keeps the Overview explicitly labeled as preview data', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText).toContain('coinzilla');
    expect(renderedText).toContain('Overview');
    expect(renderedText).toContain('MOCK DATA');
    expect(renderedText).toContain('Portfolio performance');
    expect(renderedText).toContain('fictional demo data');
  });

  it('navigates to real-record Orders, Fills and Commissions pages', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const ordersButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Orders')) as HTMLButtonElement;
    ordersButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Connecting to Harvester');
    expect(fixture.nativeElement.textContent).toContain('Orders');

    const fillsButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Fills')) as HTMLButtonElement;
    fillsButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Fills');

    const commissionsButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Commissions')) as HTMLButtonElement;
    commissionsButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Commissions');
  });

  it('offers the existing theme plus six palettes and persists the selected theme', async () => {
    window.localStorage.removeItem('coinzilla.dashboard.theme');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select[aria-label="Dashboard theme"]') as HTMLSelectElement;
    expect(select.options.length).toBe(8);
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'current', 'midnight', 'light', 'oled', 'green', 'arctic', 'warm', 'system',
    ]);

    select.value = 'light';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem('coinzilla.dashboard.theme')).toBe('light');

    const reloadedFixture = TestBed.createComponent(AppComponent);
    reloadedFixture.detectChanges();
    const reloadedSelect = reloadedFixture.nativeElement.querySelector('select[aria-label="Dashboard theme"]') as HTMLSelectElement;
    expect(reloadedSelect.value).toBe('light');
    reloadedFixture.destroy();

    select.value = 'current';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    window.localStorage.removeItem('coinzilla.dashboard.theme');
    fixture.destroy();
  });
});
