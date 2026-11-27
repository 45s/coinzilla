import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewComponent } from './overview';

const STATUS_URL = 'http://127.0.0.1:4201/api/v1/trading/operator/status';

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.dispatchEvent(new Event('open'));
  }

  sendMessage(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}

function createRuntimeStatus() {
  return {
    observedAt: 120000,
    startedAt: 60000,
    runtimeState: 'RUNNING',
    broker: 'binance',
    tradingEnabled: true,
    tradingMode: 'testnet',
    strategyMode: 'conservative-testnet',
    stopping: false,
    readiness: { state: 'READY', blockers: [] },
    userData: { ready: true, status: 'READY', ageMs: 500 },
    markets: { configured: 3, enabled: 2, blocked: 1 },
  };
}

function createSnapshotMessage() {
  return {
    type: 'bots.snapshot',
    version: 1,
    revision: 1,
    observedAt: '2026-11-27T18:00:00.000Z',
    data: {
      status: { ok: true, data: createRuntimeStatus() },
      markets: {
        ok: true,
        data: {
          observedAt: 120000,
          tradingEnabled: true,
          userDataReady: true,
          userDataStatus: 'READY',
          markets: [],
        },
      },
      portfolio: {
        ok: true,
        data: { observedAt: 120000, positions: [] },
      },
    },
  };
}

async function createOverviewFixture(): Promise<{
  fixture: ComponentFixture<OverviewComponent>;
  http: HttpTestingController;
  socket: MockWebSocket;
}> {
  await TestBed.configureTestingModule({
    imports: [OverviewComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(OverviewComponent);
  fixture.detectChanges();
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error('Overview component did not create its event stream connection.');
  return { fixture, http, socket };
}

describe('OverviewComponent', () => {
  let http: HttpTestingController | undefined;

  afterEach(() => {
    http?.verify();
    http = undefined;
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps demo portfolio content explicitly labeled while rendering live system health', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createOverviewFixture();
    http = result.http;
    const request = http.expectOne(STATUS_URL);
    request.flush({ ok: true, data: createRuntimeStatus() });
    await result.fixture.whenStable();
    result.socket.open();
    result.socket.sendMessage(createSnapshotMessage());
    result.fixture.detectChanges();

    const renderedText = (result.fixture.nativeElement as HTMLElement).textContent as string;

    expect(renderedText, 'Overview must keep the portfolio summary visible.').toContain('Portfolio value');
    expect(renderedText, 'Fictional portfolio values must remain explicitly identified as demo data.').toContain('DEMO PORTFOLIO');
    expect(renderedText, 'The demo positions must remain labeled as fictional values.').toContain('fictional values');
    expect(renderedText, 'The real Harvester API must be reported as connected after a valid response.').toContain('Local Harvester API responding');
    expect(renderedText, 'The runtime label must come from the authoritative status response.').toContain('RUNNING');
    expect(renderedText, 'The event stream must be connected only after receiving a valid snapshot.').toContain('3 / 3 CONNECTED');
    expect(renderedText, 'The live panel must not display a permanent static-preview disclaimer.').not.toContain('This preview is not connected to Harvester');
    result.fixture.destroy();
  });

  it('reports unreachable API and waiting or reconnecting stream without fabricating runtime state', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createOverviewFixture();
    http = result.http;
    http.expectOne(STATUS_URL).error(new ProgressEvent('error'));
    await result.fixture.whenStable();
    result.socket.open();
    result.fixture.detectChanges();

    let renderedText = (result.fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'An unreachable Harvester API must be shown as offline.').toContain('Cannot reach Harvester');
    expect(renderedText, 'Missing authoritative runtime data must remain unavailable.').toContain('UNAVAILABLE');
    expect(renderedText, 'An open socket without a valid snapshot must not count as connected.').toContain('Connected · snapshot waiting');
    expect(renderedText, 'Socket connectivity alone must not imply all health checks are connected.').not.toContain('3 / 3 CONNECTED');

    result.socket.close();
    result.fixture.detectChanges();
    renderedText = (result.fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'A dropped stream with no prior snapshot must show reconnection, not live state.').toContain('RECONNECTING');
    result.fixture.destroy();
  });

  it('rejects malformed API and WebSocket status instead of displaying invented runtime values', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createOverviewFixture();
    http = result.http;
    http.expectOne(STATUS_URL).flush({ ok: true, data: { runtimeState: 'RUNNING' } });
    await result.fixture.whenStable();
    result.socket.open();
    result.socket.sendMessage({ type: 'bots.snapshot', version: 1, revision: 1 });
    result.fixture.detectChanges();

    const renderedText = (result.fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'A malformed API response must be reported as unavailable.').toContain('invalid runtime status response');
    expect(renderedText, 'Malformed runtime data must not be rendered as a real RUNNING process.').not.toContain('Runtime state: RUNNING');
    expect(renderedText, 'A malformed WebSocket envelope must not be treated as a fresh snapshot.').toContain('Connected · snapshot waiting');
    result.fixture.destroy();
  });

  it('closes the WebSocket and clears reconnect resources when the Overview is destroyed', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createOverviewFixture();
    http = result.http;
    http.expectOne(STATUS_URL).flush({ ok: true, data: createRuntimeStatus() });
    await result.fixture.whenStable();
    result.fixture.destroy();
    expect(result.socket.closed, 'Destroying Overview must close its owned event-stream socket.').toBe(true);
  });
});
