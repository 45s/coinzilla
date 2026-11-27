export interface DashboardMetric {
  readonly label: string;
  readonly value: string;
  readonly change: string;
  readonly detail: string;
  readonly tone: 'positive' | 'neutral';
}

export interface DemoPosition {
  readonly market: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: string;
  readonly averagePrice: string;
  readonly lastPrice: string;
  readonly unrealizedPnl: string;
  readonly change: string;
}

export const demoMetrics: readonly DashboardMetric[] = [
  {
    label: 'Portfolio value',
    value: '$12,480.52',
    change: '+2.34%',
    detail: 'vs. previous snapshot',
    tone: 'positive',
  },
  {
    label: 'Today’s P&L',
    value: '+$284.16',
    change: '+2.32%',
    detail: 'demo daily performance',
    tone: 'positive',
  },
  {
    label: 'Available balance',
    value: '$8,420.00',
    change: '67.5%',
    detail: 'of demo portfolio value',
    tone: 'neutral',
  },
  {
    label: 'Open positions',
    value: '04',
    change: '2 markets',
    detail: 'fictional position records',
    tone: 'neutral',
  },
];

export const demoPositions: readonly DemoPosition[] = [
  {
    market: 'BTC / USDT',
    side: 'LONG',
    quantity: '0.0842 BTC',
    averagePrice: '$64,280.00',
    lastPrice: '$65,142.80',
    unrealizedPnl: '+$72.80',
    change: '+1.34%',
  },
  {
    market: 'ETH / USDT',
    side: 'LONG',
    quantity: '1.2500 ETH',
    averagePrice: '$3,420.50',
    lastPrice: '$3,486.20',
    unrealizedPnl: '+$82.13',
    change: '+1.92%',
  },
  {
    market: 'SOL / USDT',
    side: 'LONG',
    quantity: '8.4000 SOL',
    averagePrice: '$142.80',
    lastPrice: '$145.16',
    unrealizedPnl: '+$19.82',
    change: '+1.65%',
  },
  {
    market: 'BNB / USDT',
    side: 'LONG',
    quantity: '0.7200 BNB',
    averagePrice: '$598.40',
    lastPrice: '$601.15',
    unrealizedPnl: '+$1.98',
    change: '+0.46%',
  },
];

