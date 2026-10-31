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

- [x] **FR-008 — Asset and Market identity.** Stable Asset identity and explicit Market base/quote assets; symbol remains opaque. Implemented in `@coinzilla/entities` and integrated into `develop` via PR #295.
- [~] **FR-009 — Exact Money and Quantity.** Implement immutable `Money` and `Quantity` values using validated, canonical decimal strings and explicit `Asset` identity. Money supports signed values; Quantity is non-negative. Numeric JavaScript inputs and scientific notation are rejected to avoid precision loss. Acceptance: deterministic validation, precision bounds, independent snapshots, and safe serialization.
- [ ] **FR-010 — Canonical Order lifecycle.** Intent/acknowledgement identity, original/executed/remaining quantities, normalized lifecycle, timestamps, and unknown outcomes.
- [ ] **FR-011 — Fill.** Immutable, independently identifiable execution records with exact quantities/prices and stable deduplication identity.
- [ ] **FR-012 — Commission.** Zero, one, or multiple fee entries with exact amount, asset identity, and completeness/unknown semantics.
- [ ] **FR-013 — Balance.** Exact free, locked, and total quantities with canonical asset identity.
- [ ] **FR-014 — TradingRules.** Exchange-neutral price/quantity/notional increments and bounds, with explicit unsupported/dynamic constraints.
- [ ] **FR-015 — Broker capability contracts.** Shared capability vocabulary without exchange-specific assumptions.
- [ ] **FR-016 — Broker result contracts.** Normalized success, failure, incomplete, and unknown-outcome semantics.

### FR-009 contract boundary

- Both value types require an existing canonical `Asset` instance; ticker strings alone are not sufficient identity.
- Amounts are decimal strings only, trimmed and canonicalized without floating-point conversion. Leading integer zeros and trailing fractional zeros are removed; negative zero becomes `0`.
- Plain decimal notation is accepted. Exponent notation, non-finite values, malformed syntax, and unsupported precision are rejected.
- Maximum supported precision is 256 total digits and 100 fractional digits, matching the existing Free-Roll decimal arithmetic bounds.
- `Money` permits negative values for losses, adjustments, and deltas. `Quantity` represents a magnitude and rejects negative values.
- Both entities are immutable and expose independent `value` snapshots containing the canonical amount and an Asset snapshot. They intentionally provide no arithmetic methods.
- Existing `Coin`, `Order`, and `ExecutedOrder` behavior is unchanged.

## Completion policy

An item is complete only after its focused tests pass, its PR is merged into `develop`, and affected consumers are identified. Do not implement multiple FR contracts in one broad PR. Coordinate consumer migrations through cross-domain requests.
