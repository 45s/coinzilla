# ADR-0002: Explicit Binance trading environment

- Status: Accepted
- Type: Architecture decision
- Owner: Brokers / Harvester
- Date: 2026-11-09
- Supersedes: None

## Context

The Binance WebSocket broker previously inferred production versus TESTNET endpoints from the generic Node.js `NODE_ENV`. That couples exchange destination to application runtime configuration. Harvester can select a trading environment independently, so the two settings can disagree and route requests to a different exchange environment than the application believes it selected.

The exchange destination is a safety-critical integration contract shared by the Brokers package and its consumers.

## Decision

Use one explicit `TRADING_MODE` contract across Binance broker consumers:

- `TRADING_MODE=testnet` selects Binance Spot TESTNET WebSocket API and Streams endpoints.
- `TRADING_MODE=live` selects Binance Spot LIVE WebSocket API and Streams endpoints.
- Missing or unsupported values fail closed during configuration; no implicit default is allowed.
- `NODE_ENV` MUST NOT select, infer, override, or otherwise influence Binance exchange endpoints.
- Harvester resolves its configured `TRADING_MODE` and passes that exact value to the broker adapter. The broker package receives an explicit `tradingMode` value.
- Explicit custom WebSocket URLs remain supported as deliberate endpoint overrides, while the selected mode remains required and validated.
- Selecting `live` is the explicit operator choice to use the LIVE exchange. No second confirmation or enable flag is required by this contract.

## Consequences

- Broker configuration and all callers, fixtures, and integration tests must provide an explicit mode.
- TESTNET and LIVE endpoint selection can be tested deterministically without depending on process environment.
- Deployment configuration must set `TRADING_MODE` deliberately and keep the matching Binance credentials.
- This decision does not implement Harvester process-restart recovery or make a restarted process safe to trade without reconciliation. That work remains tracked separately by issue #654 and the Harvester roadmap.
- Domain strategy logic remains independent of the broker's endpoint-selection mechanism.

## Verification

- Unit tests must prove exact TESTNET and LIVE API/Streams endpoint selection.
- Missing, empty, and unsupported modes must be rejected.
- Custom endpoint overrides and null fallback behavior must be covered.
- Harvester adapter tests and offline integration harnesses must pass an explicit mode.
- No test may rely on `NODE_ENV` to determine the exchange environment.

## Related implementation and documentation

- [Brokers README](../../../packages/brokers/README.md)
- [Brokers roadmap](../../../packages/brokers/ROADMAP.md)
- [Harvester trading configuration and operations](../../../apps/harvester/README.md)
- [Harvester roadmap](../../../apps/harvester/ROADMAP.md)
- [Issue #654: process-restart reconciliation](https://github.com/45s/coinzilla/issues/654)
