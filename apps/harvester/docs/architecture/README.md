# Harvester architecture documentation

- [Application architecture](../architecture.md) — current application boundaries, dependency direction, use cases and composition.
- [Operator control](../operator-control/README.md) — transport-independent operator pause contract and current implementation status.
- [ADR-0002 — Transport-independent operator control](decisions/0002-transport-independent-operator-control.md) — accepted application, engine and Telegram-adapter ownership/safety contract.
- [ADR-0003 — Process-lifetime operator pause](decisions/0003-process-lifetime-operator-pause.md) — initial pause scope; restart restoration is explicitly deferred to ADR-0001 / issue #654.
- [Volatility Protection](../volatility-protection.md) — market-data collection, per-market protection policy and central order gate are implemented in merged PR #1041; historical threshold calibration remains open.
- [ADR-0001 — Application-owned durable facts for process-restart recovery](decisions/0001-application-owned-recovery-facts.md) — accepted contract, durable fact producers/barriers and offline candidate Portfolio/RecoveryLedger/OrderRegistry projection are merged in PR #1055; candidate restoration remains disabled pending projection/invariant parity, account-wide reconciliation readiness and Step 9 crash/restart proof.
- [Broker–Harvester trading flow](BROKER_HARVESTER_TRADING_FLOW.md) — visual interaction and startup paths.
- [Broker–Harvester trading flow (text)](BROKER_HARVESTER_TRADING_FLOW_TEXT.md) — accessible text representation and detailed sequence.

Historical assessment:

- [DDD and Clean Architecture audit](../DDD_CLEAN_ARCHITECTURE_AUDIT.md) — dated architecture assessment; not the current architecture authority.

Use [the Harvester documentation index](../README.md) as the overall entry point. Current implementation must be verified against source and tests; diagrams complement authoritative prose and code.
