# Brokers documentation

This folder contains maintained engineering references for the Brokers package.

## Bitunix Spot

- [Mandatory Bitunix development and operator workflow](./BITUNIX_WORKFLOW.md) — required development process, LIVE investigation boundary and safety invariants.
- [External implementation reference audit](./BITUNIX_REFERENCE_AUDIT.md) — source-level review of official API contracts, .NET/TypeScript clients, fixtures, defects and implementation evidence.
- [LIVE order-probe evidence log](../BITUNIX_ORDER_PROBE_LOG.md) — operator-confirmed placement attempts, immutable report links, observed exchange rejections and unresolved protocol questions.
- [Order-fetch Phase 1](./BITUNIX_ORDER_FETCH_PHASE1.md) — pending-order fetch audit, healthcheck-driven order/detail scan, diagnostics and acceptance gate.
- [Private polling and reconciliation](./BITUNIX_SPOT_POLLING.md) — internal read-only observation helper, guarantees and limits.
- [Production-readiness gap matrix](./bitunix-production-readiness-gap-matrix.md) — capability-by-capability evidence and remaining blockers.
- [Bitunix Spot roadmap](./ROADMAP.md) — concise view of lifecycle blockers and next safe work.

## Package-wide documentation

The authoritative package entry points remain one level above:

- [Package README](../README.md)
- [Package ROADMAP](../ROADMAP.md)
- [Broker API contract](../BROKER_API.md)
- [Architecture](../ARCHITECTURE.md)
