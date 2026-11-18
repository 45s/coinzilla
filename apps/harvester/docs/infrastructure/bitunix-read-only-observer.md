# Bitunix Spot read-only observer

- **Status:** Implementation in progress under [issue #1422](https://github.com/45s/coinzilla/issues/1422).
- **Owner:** Harvester.
- **Parent architecture:** [multi-provider workstream #1339](https://github.com/45s/coinzilla/issues/1339).
- **Trading-readiness blockers:** [Bitunix capability issue #1185](https://github.com/45s/coinzilla/issues/1185).

## Purpose

Harvester will expose the existing Bitunix Spot read capabilities through a separate, opt-in read-only observer. This is not a Harvester BrokerPort, a provider-registry entry, an execution provider, or a strategy market-data source.

Until issue #1422 is implemented and merged, the current runtime does not expose this observer.

## Configuration

The observer is disabled by default. Credentials alone must never enable it.

```dotenv
BITUNIX_READ_ONLY_ENABLED=true
BITUNIX_API_KEY=your-read-only-api-key
BITUNIX_API_SECRET=your-read-only-api-secret
# Optional stable, non-secret identity overrides:
BITUNIX_PROVIDER_INSTANCE_ID=bitunixSpotPrimary
BITUNIX_ACCOUNT_ID=bitunix-primary
```

Use a Bitunix API key with read permissions only. Disable trading and withdrawal permissions at the exchange. Never commit credentials or include them in logs, events, fingerprints, or error context.

Bitunix Spot currently uses its documented production REST endpoint. The broker configuration value `tradingMode: "live"` selects that endpoint; it does not authorize trading and must not be reused as Harvester's `TRADING_MODE`. Harvester's Binance `TRADING_MODE` remains unchanged.

## Runtime boundary

The planned interface is `runtime.readOnlyProviders.bitunix`. It is constructed only when `BITUNIX_READ_ONLY_ENABLED=true` and both credentials are present. No Bitunix request is made during Harvester startup; calls are explicit and on-demand.

The observer must not be passed to:

- Harvester's `BrokerPort` or provider execution registry;
- execution routes or strategy market-data routes;
- the Trading Engine, strategy evaluation, market-price subscriptions, or book-ticker subscriptions;
- Portfolio, account-snapshot/recovery, reservations, Journal, or process locks.

## Supported read-only surface

The facade will expose the existing broker methods for:

- exact Spot balances;
- Spot market catalog and symbol filters, plus the existing Harvester canonical metadata mapping;
- one-shot latest prices, depth snapshots, and K-line reads/history;
- exchange rates;
- symbol-scoped open orders, order history, and order detail;
- deposit history, withdrawal history, and explicit coin/network deposit-address lookup;
- raw matching-order detail.

The facade must not expose order creation/cancellation, canonical fills, account snapshots, private user-data streams, continuous price/depth/candle subscriptions, or unsupported OHLCV candles.

## Source limitations that remain

- Bitunix balances do not establish a timestamped Harvester account snapshot; do not fabricate one.
- Canonical fill identity/completeness and user-data/recovery guarantees remain unresolved under #1185.
- Open-order reads are symbol-scoped; do not claim account-wide completeness.
- Matching-order detail is raw read-only data, not a canonical Fill.
- K-lines are not promoted to OHLCV candles.
- No pagination/completeness guarantee may be added beyond the existing broker method contract.
- No TESTNET environment is currently supported by this Spot adapter.

## Verification

Default tests remain offline and credential-free. Tests must prove the disabled-by-default behavior, strict configuration validation, read-method allowlist, absence of mutation/stream/fill/snapshot methods, metadata mapping, and separation from every Binance trading path. No live/TESTNET exchange operation is part of this task.
