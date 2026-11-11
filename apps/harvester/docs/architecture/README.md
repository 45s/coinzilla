# Harvester architecture documentation

- [Application architecture](../architecture.md) — current application boundaries, dependency direction, use cases and composition.
- [Operator control interface — design proposal](OPERATOR_CONTROL_DESIGN.md) — discussion draft for transport-independent market commands; no runtime implementation or accepted pause contract yet.
- [ADR-0001 — Application-owned durable facts for process-restart recovery](decisions/0001-application-owned-recovery-facts.md) — accepted recovery contract; not yet implemented.
- [ADR-0002 — Transport-independent operator control](decisions/0002-transport-independent-operator-control.md) — accepted application boundary, actor authorization, pause/resume ownership and transport rules.
- [Operator-control implementation contract](OPERATOR_CONTROL_DESIGN.md) — current code layout, request/fact schemas and delivery sequence.
- [Broker–Harvester trading flow](BROKER_HARVESTER_TRADING_FLOW.md) — visual interaction and startup paths.
- [Broker–Harvester trading flow (text)](BROKER_HARVESTER_TRADING_FLOW_TEXT.md) — accessible text representation and detailed sequence.

Historical assessment:

- [DDD and Clean Architecture audit](../DDD_CLEAN_ARCHITECTURE_AUDIT.md) — dated architecture assessment; not the current architecture authority.

Use [the Harvester documentation index](../README.md) as the overall entry point. Current implementation must be verified against source and tests; diagrams complement authoritative prose and code.
