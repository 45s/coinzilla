import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
  type OnChanges,
  type OnDestroy,
  type OnInit,
  type SimpleChanges,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  TradingHistoryApi,
  type CommissionRecord,
  type FillCommission,
  type TradingEnvironment,
  type TradingHistoryDetail,
  type TradingHistoryPage,
  type TradingHistoryRecord,
  type TradingHistoryResource,
} from './api';

interface DetailEntry {
  readonly label: string;
  readonly value: string;
}

@Component({
  selector: 'app-trading-history',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradingHistoryComponent implements OnInit, OnChanges, OnDestroy {
  @Input() resource: TradingHistoryResource = 'orders';

  private readonly api = inject(TradingHistoryApi);
  private readonly pageSize = 25;
  private readonly reconnectDelays = [1000, 2000, 4000, 8000, 16000, 30000];
  private eventSocket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private metadataRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyDisconnected = false;
  private refreshPromise: Promise<void> | null = null;
  private refreshPending = false;
  private activeQueryKey: string | null = null;

  readonly currentResource = signal<TradingHistoryResource>('orders');
  readonly connected = signal(false);
  readonly liveStatus = signal<'connecting' | 'live' | 'reconnecting' | 'offline'>('offline');
  readonly liveStatusLabel = computed(() => {
    const labels = {
      connecting: 'Opening live connection',
      live: 'Live updates',
      reconnecting: 'Reconnecting · snapshot sync on reconnect',
      offline: 'Live updates offline',
    };
    return labels[this.liveStatus()];
  });
  readonly connecting = signal(false);
  readonly loading = signal(false);
  readonly detailsLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly metadata = signal<{
    readonly environment: TradingEnvironment;
    readonly records: {
      readonly orders: number;
      readonly fills: number;
      readonly commissions: number;
    };
  } | null>(null);
  readonly page = signal<TradingHistoryPage<TradingHistoryRecord> | null>(null);
  readonly selectedRecord = signal<TradingHistoryDetail | null>(null);
  readonly symbolFilter = signal('');
  readonly sideFilter = signal('');
  readonly statusFilter = signal('');
  readonly assetFilter = signal('');
  readonly records = computed(() => this.page()?.items ?? []);
  readonly pageCount = computed(() => {
    const total = this.page()?.pagination.total ?? 0;
    return Math.max(1, Math.ceil(total / this.pageSize));
  });
  readonly currentPage = computed(() => Math.floor((this.page()?.pagination.offset ?? 0) / this.pageSize) + 1);
  readonly hasPreviousPage = computed(() => (this.page()?.pagination.offset ?? 0) > 0);
  readonly hasNextPage = computed(() => this.page()?.pagination.hasMore ?? false);
  readonly resourceTitle = computed(() => {
    const resource = this.currentResource();
    return resource[0].toUpperCase() + resource.slice(1);
  });
  readonly emptyMessage = computed(() => `No persisted ${this.currentResource()} found for these filters.`);
  readonly detailEntries = computed<readonly DetailEntry[]>(() => {
    const record = this.selectedRecord();
    if (!record) {
      return [];
    }
    return Object.entries(record)
      .filter(([key, value]) => key !== 'id' && key !== 'commissions' && (value === null || typeof value !== 'object'))
      .map(([key, value]) => ({
        label: this.labelFor(key),
        value: value === null ? 'Not recorded' : String(value),
      }));
  });
  readonly detailCommissions = computed<readonly FillCommission[]>(() => {
    const record = this.selectedRecord();
    return record && 'commissions' in record ? record.commissions : [];
  });

  ngOnInit(): void {
    this.currentResource.set(this.resource);
    void this.connect();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resource']) {
      this.currentResource.set(this.resource);
    }
    if (changes['resource'] && !changes['resource'].firstChange && this.connected()) {
      this.pageIndexReset();
      this.selectedRecord.set(null);
      void this.loadRecords();
    }
  }

  ngOnDestroy(): void {
    this.stopLiveUpdates();
  }

  updateSymbol(event: Event): void {
    this.symbolFilter.set((event.target as HTMLInputElement).value);
  }

  updateSide(event: Event): void {
    this.sideFilter.set((event.target as HTMLSelectElement).value);
  }

  updateStatus(event: Event): void {
    this.statusFilter.set((event.target as HTMLInputElement).value);
  }

  updateAsset(event: Event): void {
    this.assetFilter.set((event.target as HTMLInputElement).value);
  }

  async connect(event?: Event): Promise<void> {
    event?.preventDefault();
    await this.connect();
  }

  disconnect(): void {
    this.stopLiveUpdates();
    this.connected.set(false);
    this.metadata.set(null);
    this.page.set(null);
    this.selectedRecord.set(null);
    this.errorMessage.set(null);
  }

  async applyFilters(): Promise<void> {
    this.pageIndexReset();
    this.selectedRecord.set(null);
    await this.loadRecords();
  }

  async clearFilters(): Promise<void> {
    this.symbolFilter.set('');
    this.sideFilter.set('');
    this.statusFilter.set('');
    this.assetFilter.set('');
    this.pageIndexReset();
    this.selectedRecord.set(null);
    await this.loadRecords();
  }

  async previousPage(): Promise<void> {
    if (!this.hasPreviousPage()) {
      return;
    }
    this.pageIndexReset(Math.max(0, (this.page()?.pagination.offset ?? 0) - this.pageSize));
    await this.loadRecords();
  }

  async nextPage(): Promise<void> {
    if (!this.hasNextPage()) {
      return;
    }
    this.pageIndexReset((this.page()?.pagination.offset ?? 0) + this.pageSize);
    await this.loadRecords();
  }

  async selectRecord(record: TradingHistoryRecord): Promise<void> {
    this.selectedRecord.set(null);
    this.detailsLoading.set(true);
    try {
      let detail: TradingHistoryDetail = record as CommissionRecord;
      if (this.currentResource() === 'orders') {
        detail = await firstValueFrom(this.api.getOrder(record.id));
      } else if (this.currentResource() === 'fills') {
        detail = await firstValueFrom(this.api.getFill(record.id));
      }
      this.selectedRecord.set(detail);
    } catch (error) {
      this.handleRequestError(error);
    } finally {
      this.detailsLoading.set(false);
    }
  }

  recordReference(record: TradingHistoryRecord): string {
    if ('exchangeTradeId' in record && record.exchangeTradeId) {
      return `Trade ${record.exchangeTradeId}`;
    }
    if ('exchangeOrderId' in record && record.exchangeOrderId) {
      return `Order ${record.exchangeOrderId}`;
    }
    if ('clientOrderId' in record && record.clientOrderId) {
      return `Client ${record.clientOrderId}`;
    }
    const id = record.id;
    const shortenedId = id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
    return `Record ${shortenedId}`;
  }

  recordPriceLabel(): string {
    if (this.currentResource() === 'orders') {
      return 'Limit price';
    }
    if (this.currentResource() === 'fills') {
      return 'Execution price';
    }
    return 'Quote valuation';
  }

  recordStatusLabel(): string {
    if (this.currentResource() === 'orders') {
      return 'Order status';
    }
    if (this.currentResource() === 'fills') {
      return 'Commission status';
    }
    return 'Asset';
  }

  recordStatus(record: TradingHistoryRecord): string {
    if ('status' in record) {
      return record.status;
    }
    if ('commissionStatus' in record) {
      return record.commissionStatus;
    }
    return '—';
  }

  recordAmount(record: TradingHistoryRecord): string {
    if ('amount' in record) {
      return record.amount;
    }
    if ('executedBaseQuantity' in record) {
      return record.executedBaseQuantity;
    }
    const executed = record.executedQuantity ?? 'Not recorded';
    const original = record.originalQuantity ?? 'Not recorded';
    return `${executed} / ${original}`;
  }

  recordPrice(record: TradingHistoryRecord): string {
    if ('executionPrice' in record) {
      return record.executionPrice;
    }
    if ('limitPrice' in record) {
      return record.limitPrice ?? 'Not recorded';
    }
    return record.quoteValueAmount ?? 'Not recorded';
  }

  recordAsset(record: TradingHistoryRecord): string {
    return 'assetCode' in record ? record.assetCode ?? 'Not recorded' : 'Not recorded';
  }

  recordTimestamp(record: TradingHistoryRecord): string {
    if ('exchangeCreatedAt' in record) {
      return record.exchangeCreatedAt ?? record.localFirstObservedAt ?? 'Not recorded';
    }
    if ('exchangeExecutedAt' in record) {
      return record.exchangeExecutedAt ?? ('localObservedAt' in record ? record.localObservedAt : null) ?? 'Not recorded';
    }
    return 'Not recorded';
  }

  async connect(): Promise<void> {
    this.connecting.set(true);
    this.errorMessage.set(null);
    try {
      const metadata = await firstValueFrom(this.api.getMetadata());
      this.metadata.set(metadata);
      this.connected.set(true);
      this.pageIndexReset();
      await this.loadRecords();
      this.manuallyDisconnected = false;
      this.openEventSocket(false);
    } catch (error) {
      this.connected.set(false);
      this.handleRequestError(error);
    } finally {
      this.connecting.set(false);
    }
  }

  private loadRecords({ force = false }: { readonly force?: boolean } = {}): Promise<void> {
    if (!this.connected()) {
      return Promise.resolve();
    }
    const queryKey = this.currentQueryKey();
    if (this.refreshPromise) {
      if (force || queryKey !== this.activeQueryKey) {
        this.refreshPending = true;
      }
      return this.refreshPromise;
    }
    this.activeQueryKey = queryKey;
    this.refreshPromise = this.drainRecordRefreshes();
    return this.refreshPromise;
  }

  private currentQueryKey(): string {
    return JSON.stringify({
      resource: this.currentResource(),
      filters: this.filters(),
      offset: this.page()?.pagination.offset ?? 0,
    });
  }

  private async drainRecordRefreshes(): Promise<void> {
    this.loading.set(true);
    try {
      do {
        this.refreshPending = false;
        this.activeQueryKey = this.currentQueryKey();
        await this.loadCurrentRecords();
      } while (
        this.connected()
        && (this.refreshPending || this.currentQueryKey() !== this.activeQueryKey)
      );
    } finally {
      this.loading.set(false);
      this.refreshPromise = null;
      this.activeQueryKey = null;
    }
  }

  private async loadCurrentRecords(): Promise<void> {
    this.errorMessage.set(null);
    try {
      const query = {
        filters: this.filters(),
        limit: this.pageSize,
        offset: this.page()?.pagination.offset ?? 0,
      };
      let result: TradingHistoryPage<TradingHistoryRecord>;
      if (this.currentResource() === 'orders') {
        result = await firstValueFrom(this.api.listOrders(query));
      } else if (this.currentResource() === 'fills') {
        result = await firstValueFrom(this.api.listFills(query));
      } else {
        result = await firstValueFrom(this.api.listCommissions(query));
      }
      this.page.set(result);
    } catch (error) {
      this.handleRequestError(error);
    }
  }

  private openEventSocket(reconnecting: boolean): void {
    if (!this.connected() || this.manuallyDisconnected) {
      return;
    }
    this.liveStatus.set(reconnecting ? 'reconnecting' : 'connecting');
    let socket: WebSocket;
    try {
      socket = this.api.createEventSocket();
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.eventSocket = socket;
    socket.addEventListener('open', () => {
      if (this.eventSocket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.liveStatus.set('live');
      this.selectedRecord.set(null);
      void this.refreshMetadata();
      void this.loadRecords();
    });
    socket.addEventListener('message', (event) => this.handleEventSocketMessage(socket, event));
    socket.addEventListener('close', () => {
      if (this.eventSocket !== socket) {
        return;
      }
      this.eventSocket = null;
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }

  private handleEventSocketMessage(socket: WebSocket, event: MessageEvent): void {
    if (this.eventSocket !== socket || typeof event.data !== 'string') {
      return;
    }
    let message: {
      readonly type?: string;
      readonly resources?: readonly string[];
    };
    try {
      message = JSON.parse(event.data);
    } catch {
      socket.close();
      return;
    }
    if (message.type === 'trading-history.updated') {
      this.scheduleMetadataRefresh();
      if (message.resources?.includes(this.currentResource())) {
        this.selectedRecord.set(null);
        void this.loadRecords({ force: true });
      }
    }
  }

  private scheduleMetadataRefresh(): void {
    if (this.metadataRefreshTimer) {
      clearTimeout(this.metadataRefreshTimer);
    }
    this.metadataRefreshTimer = setTimeout(() => {
      this.metadataRefreshTimer = null;
      void this.refreshMetadata();
    }, 250);
  }

  private async refreshMetadata(): Promise<void> {
    if (this.metadataRefreshTimer) {
      clearTimeout(this.metadataRefreshTimer);
      this.metadataRefreshTimer = null;
    }
    if (!this.connected()) {
      return;
    }
    try {
      this.metadata.set(await firstValueFrom(this.api.getMetadata()));
    } catch (error) {
      this.handleRequestError(error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.connected() || this.manuallyDisconnected || this.reconnectTimer) {
      return;
    }
    this.liveStatus.set(
      this.reconnectAttempt >= this.reconnectDelays.length ? 'offline' : 'reconnecting',
    );
    const delayIndex = Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[delayIndex];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSocket(true);
    }, delay);
  }

  private stopLiveUpdates(): void {
    this.manuallyDisconnected = true;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.metadataRefreshTimer) {
      clearTimeout(this.metadataRefreshTimer);
      this.metadataRefreshTimer = null;
    }
    const socket = this.eventSocket;
    this.eventSocket = null;
    if (socket && socket.readyState < 2) {
      socket.close();
    }
    this.liveStatus.set('offline');
  }

  private filters(): Readonly<Record<string, string>> {
    const filters: Record<string, string> = {};
    const symbol = this.symbolFilter().trim();
    const side = this.sideFilter();
    if (symbol) {
      filters['symbol'] = symbol;
    }
    if (side) {
      filters['side'] = side;
    }
    if (this.currentResource() === 'orders' && this.statusFilter().trim()) {
      filters['status'] = this.statusFilter().trim();
    }
    if (this.currentResource() === 'fills' && this.statusFilter().trim()) {
      filters['commissionStatus'] = this.statusFilter().trim();
    }
    if (this.currentResource() === 'commissions' && this.assetFilter().trim()) {
      filters['assetCode'] = this.assetFilter().trim();
    }
    return filters;
  }

  private handleRequestError(error: unknown): void {
    if (error instanceof Error) {
      this.errorMessage.set('Harvester API is unavailable. Check that Harvester is running and the local API is enabled.');
      return;
    }
    const status = error instanceof HttpErrorResponse ? ` (HTTP ${error.status})` : '';
    this.errorMessage.set(`Harvester request failed${status}. Retry the request or check the API logs.`);
  }

  private pageIndexReset(offset = 0): void {
    this.page.update((current) => current
      ? {
          ...current,
          pagination: {
            ...current.pagination,
            offset,
          },
        }
      : null);
  }

  private labelFor(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (first) => first.toUpperCase());
  }
}
