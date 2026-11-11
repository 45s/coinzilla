# Harvester architecture documentation

- [Application architecture](../architecture.md) — current application boundaries, dependency direction, use cases and composition.
- [Volatility Protection](../volatility-protection.md) — market-data collection and per-market protection policy/order gate are implemented in merged PRs #1037 and #1041; historical threshold validation remains pending.
- [Operator control](../operator-control/README.md) — transport-independent operator pause contract and current implementation status.
- [ADR-0001 — Application-owned durable facts for process-restart recovery](decisions/0001-application-owned-recovery-facts.md) — accepted contract and file store are implemented; reconciliation, startup projection and restart readiness remain pending.
- [ADR-0002 — Transport-independent operator control](decisions/0002-transport-independent-operator-control.md) — accepted application, engine and Telegram-adapter ownership/safety contract.
- [Broker–Harvester trading flow](BROKER_HARVESTER_TRADING_FLOW.md) — visual interaction and startup paths.
- [Broker–Harvester trading flow (text)](BROKER_HARVESTER_TRADING_FLOW_TEXT.md) — accessible text representation and detailed sequence.

Historical assessment:

- [DDD and Clean Architecture audit](../DDD_CLEAN_ARCHITECTURE_AUDIT.md) — dated architecture assessment; not the current architecture authority.

Use [the Harvester documentation index](../README.md) as the overall entry point. Current implementation must be verified against source and tests; diagrams complement authoritative prose and code.
