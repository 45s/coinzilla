# Four-market shutdown failure acceptance (offline)

## Scope

This acceptance fixture covers the four-market recovery-input failure shape associated with Harvester shutdown. It is deterministic and uses fake engine/broker ports only; it does not query an exchange or reproduce unknown historical account state.

## Required failure behavior

- Each configured market is attempted independently: BTCUSDT, ETHUSDT, BNBUSDT, ADAUSDT.
- A market recovery input failure remains attributed to that market as `SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE:MARKET_PRICE_UNAVAILABLE`.
- A recovery-input failure is not mislabeled as incomplete owned-order/fill reconciliation when those stages succeeded.
- The Conservative participant remains unsafe if any configured market cannot prove recovery SELL safety.
- The strategy shutdown coordinator preserves all four market blockers.
- The shutdown handler remains `SHUTDOWN_INCOMPLETE`; market intake, user-data intake, broker disconnect, and operator-control shutdown do not advance after safety proof fails.

## Regression mapping

- `CON-SAFETY-001`
- `retains recovery-input blockers independently for all four configured markets`
- `retains shared services when four-market shutdown proof is blocked`

Existing process lifecycle tests continue to cover durable `PROCESS_STOPPED` and lock release only after clean shutdown. These tests do not establish the historical 2026-11-19 second-attempt outcome, final exchange order/trade state, or actual process termination; those facts remain UNKNOWN until independently authorized evidence is available.

No LIVE/TESTNET operations, account queries, order mutations, process control, or original evidence mutation were performed.
