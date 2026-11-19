# Bitunix Spot roadmap

This is a focused index of Bitunix Spot lifecycle work. The authoritative package-wide delivery record remains [../ROADMAP.md](../ROADMAP.md).

## Current position

- Spot REST read operations and the authenticated WebSocket request/response RPC client are implemented for the documented supported surface.
- The private polling helper is read-only and non-authoritative. It is not a continuous exchange event stream and is not exposed as a public observer API.
- Harvester user-data subscription and authoritative account snapshots remain unsupported.

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
- Do not emit synthetic Binance events, enable Harvester trading, or run live mutations without explicit authorization and the required evidence.

