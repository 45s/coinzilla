# Brokers documentation

This folder contains maintained engineering references for the Brokers package.

## Bitunix Spot

- [Mandatory Bitunix development workflow](./BITUNIX_WORKFLOW.md) — discovery-to-regression process, safety boundaries, and operator-only LIVE investigation rules.
- [External implementation reference audit](./BITUNIX_REFERENCE_AUDIT.md) — source-level review of official API contracts, .NET/TypeScript clients, fixtures, defects and implementation evidence.
- [Private polling and reconciliation](./BITUNIX_SPOT_POLLING.md) — internal read-only observation helper, guarantees and limits.
- [Production-readiness gap matrix](./bitunix-production-readiness-gap-matrix.md) — capability-by-capability evidence and remaining blockers.
- [Bitunix Spot roadmap](./ROADMAP.md) — concise view of lifecycle blockers and next safe work.

## Package-wide documentation

The authoritative package entry points remain one level above:

- [Package README](../README.md)
- [Package ROADMAP](../ROADMAP.md)
- [Broker API contract](../BROKER_API.md)
- [Architecture](../ARCHITECTURE.md)
