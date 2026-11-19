# Bitunix Spot roadmap

This is a focused index of Bitunix Spot lifecycle work. The authoritative package-wide delivery record remains [../ROADMAP.md](../ROADMAP.md).

## Current position

- Spot REST read operations and the authenticated WebSocket request/response RPC client are implemented for the documented supported surface.
- The private polling helper is read-only and non-authoritative. The common Broker `subscribeForUserData()` method exposes its explicitly scoped snapshots through `onObservation` with `OBSERVE_USER_DATA: SUPPORTED`; this is not a native exchange event stream.
- Native `SUBSCRIBE_USER_DATA` / `onEvent` and authoritative account snapshots remain unsupported. Harvester keeps Bitunix outside provider registration; its generic observation handler is diagnostic-only and cannot satisfy readiness.

## Blocking evidence — [issue #1185](https://github.com/45s/coinzilla/issues/1185)

1. No documented continuous private Spot order/execution event stream or replay cursor.
2. No source-timestamped Spot account snapshot.
3. No proven complete per-execution history, stable execution identity or fill quantity semantics.
4. No account-wide open-order query or atomic account snapshot.
5. No documented TESTNET; live mutation tests remain unauthorized.

## Safe next steps

- Continue reference-first auditing of remaining Spot methods and exact response/error behavior.
- Improve read-side validation only where official contracts or independently verified fixtures support it.
- Preserve fail-closed capability declarations for canonical lifecycle methods.
- Do not emit synthetic Binance events, route observations into canonical fills/accounting, enable Harvester trading, or run live mutations without explicit authorization and the required evidence.
