# Brokers roadmap

**Owner:** `packages/brokers/`  
**Purpose:** provide reliable exchange adapters and broker-facing contracts while keeping venue details out of applications.

Read [the broker agent instructions](./AGENTS.md), [the workspace package map](../../docs/workspace-package-map.md), and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Exchange-specific payloads, enums, filters, signatures, and quirks stay inside adapters.
- Expose normalized Coinzilla contracts; preserve exact decimal strings and source identifiers.
- Report unsupported, missing, incomplete, or ambiguous facts explicitly; never invent defaults.
- Keep default unit tests deterministic and offline. Live integration tests remain opt-in.
- Any test that places an order must use TESTNET only.

## Roadmap

- [ ] Complete and document the exchange-neutral broker capability and result contracts with the entities domain (FR-015–FR-016).
- [ ] Align legacy and SDK Binance adapters with canonical order, fill, commission, balance, market, and trading-rule contracts as those contracts become available.
- [ ] Harden order creation/cancellation outcomes, including timeout/unknown-result reconciliation and client order identifiers.
- [ ] Harden user-data and market-data stream lifecycle: reconnect, resubscription, duplicate events, gaps, and bounded cleanup.
- [ ] Verify pagination and completeness semantics for balances, open orders, order history, and trade history.
- [ ] Keep adapter contract tests reusable across future exchanges.
- [ ] Maintain clear separation between deterministic unit tests and TESTNET integration tests.

## Existing references

- `docs/brokers-websocket-migration-roadmap.md`
- `apps/bot-free-roll/DOMAIN_ENTITY_AUDIT.md` (broker contract audit)
- Broker package integration-test scripts in `package.json`

## Completion policy

A broker capability is complete only when its contract, adapter implementation, failure semantics, and tests are merged into `develop`. Link dependent consumer work; do not implement application strategy behavior in this package.
