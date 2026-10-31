# Entities roadmap

**Owner:** `packages/entities/`  
**Purpose:** maintain small, exchange-neutral domain contracts shared by applications and adapters.

Read [the entity agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Stable canonical identity; do not infer asset identity from exchange symbols.
- Exact decimal representations for financial amounts and increments.
- Immutable, explicit value contracts with validation at construction/boundaries.
- Preserve existing public behavior unless a migration is deliberately designed.
- No exchange SDK dependencies or venue-specific payload fields in shared entities.

## Roadmap

- [~] **FR-008 — Asset and Market identity.** Migrated the entity implementation from legacy PR #295 onto the short-lived `feature/entities/fr-008-asset-market` branch based on `develop`. `Asset` separates stable canonical `id` from normalized uppercase `code`; `Market` carries explicit `Asset` references and treats the venue symbol as opaque metadata. Deterministic package tests cover validation, venue-scoped identity, snapshots, and immutability. Pending package/CI verification and merge into `develop`. The consumer-owned Free-Roll audit and roadmap updates from legacy PR #295 remain outside this entities-domain change and must be coordinated with the Free-Roll owner.
- [ ] **FR-009 — Exact Money and Quantity.** Exact decimal values with explicit asset/unit semantics, validation, and safe serialization.
- [ ] **FR-010 — Canonical Order lifecycle.** Intent/acknowledgement identity, original/executed/remaining quantities, normalized lifecycle, timestamps, and unknown outcomes.
- [ ] **FR-011 — Fill.** Immutable, independently identifiable execution records with exact quantities/prices and stable deduplication identity.
- [ ] **FR-012 — Commission.** Zero, one, or multiple fee entries with exact amount, asset identity, and completeness/unknown semantics.
- [ ] **FR-013 — Balance.** Exact free, locked, and total quantities with canonical asset identity.
- [ ] **FR-014 — TradingRules.** Exchange-neutral price/quantity/notional increments and bounds, with explicit unsupported/dynamic constraints.
- [ ] **FR-015 — Broker capability contracts.** Shared capability vocabulary without exchange-specific assumptions.
- [ ] **FR-016 — Broker result contracts.** Normalized success, failure, incomplete, and unknown-outcome semantics.

## Completion policy

An item is complete only after its focused tests pass, its PR is merged into `develop`, and affected consumers are identified. Do not implement multiple FR contracts in one broad PR. Coordinate consumer migrations through cross-domain requests.
