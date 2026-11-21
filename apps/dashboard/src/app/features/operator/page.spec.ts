import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { OperatorComponent } from './page';

const BASE_URL = 'http://127.0.0.1:4201/api/v1/trading/operator';

function flushReadSnapshots({ http, paused = false }: { http: HttpTestingController; paused?: boolean }): void {
  http.expectOne(`${BASE_URL}/status`).flush({ ok: true, data: { tradingEnabled: true } });
  http.expectOne(`${BASE_URL}/markets`).flush({
    ok: true,
    data: {
      markets: [{
        symbol: 'BTCUSDT',
        enabled: true,
        operatorBuysPaused: paused,
        readiness: 'READY',
        blockers: [],
      }],
    },
  });
  http.expectOne(`${BASE_URL}/portfolio`).flush({ ok: true, data: { positions: [] } });
  http.expectOne(`${BASE_URL}/orders`).flush({ ok: true, data: { orders: [] } });
  http.expectOne(`${BASE_URL}/balances`).flush({ ok: true, data: { balances: [] } });
}

describe('OperatorComponent', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
  });

  it('shows per-market Pause and sends the confirmed action for that market', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(OperatorComponent);
    fixture.detectChanges();
    flushReadSnapshots({ http });
    await fixture.whenStable();
    fixture.detectChanges();

    const pauseButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause') as HTMLButtonElement;
    expect(pauseButton).toBeDefined();
    pauseButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Confirm: Pause BUYs for BTCUSDT');

    const confirmButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Confirm command')) as HTMLButtonElement;
    confirmButton.click();
    const command = http.expectOne(`${BASE_URL}/commands`);
    expect(command.request.method).toBe('POST');
    expect(command.request.body).toMatchObject({ command: 'pause', symbol: 'BTCUSDT' });
    expect(command.request.body.requestId).toEqual(expect.any(String));
    command.flush({ ok: true, data: { accepted: true } });
    flushReadSnapshots({ http, paused: true });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('BUYs paused');
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .some((button) => button.textContent?.trim() === 'Unpause')).toBe(true);
  });
});
