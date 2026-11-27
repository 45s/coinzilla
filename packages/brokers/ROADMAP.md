# Brokers package roadmap

**Owner:** `@coinzilla/brokers`
**Last reviewed:** 2026-11-27

> Detailed delivery history and implementation evidence from the previous roadmap are preserved in [Brokers roadmap history](../../docs/archive/roadmap-history-2026-11-26.md#brokers-roadmap). This page is the active priority index only.

## Active priorities

1. **Common exchange-neutral Broker API — [#1446](https://github.com/45s/coinzilla/issues/1446).** Maintain the capability/contract boundary; provider-specific unsupported operations must remain explicit.
2. **Bitunix Futures production exclusion.** Provider implementation merged in [PR #1806](https://github.com/45s/coinzilla/pull/1806); implementation issue [#1805](https://github.com/45s/coinzilla/issues/1805) is closed and is historical delivery evidence, not an active task. Keep Futures excluded from Harvester routing until authoritative recovery, private-channel acceptance, complete account-wide fill/fee semantics, and distributed pacing are verified. Track cross-provider routing/readiness through open [#1339](https://github.com/45s/coinzilla/issues/1339); do not infer production readiness from the merged provider.
3. **Bitunix Spot LIVE probe matrix — [#1690](https://github.com/45s/coinzilla/issues/1690).** Live mutation probes remain explicit operator-controlled, separately approved work; no unattended live trading tests.

## Canonical contracts and references

- Public broker contract: [BROKER_API.md](./BROKER_API.md)
- Provider implementation and acceptance: source/tests plus the linked provider audit documents
- Cross-workspace package ownership: [Domain Ownership](../../docs/engineering/DOMAIN_OWNERSHIP.md)
- Work status and acceptance evidence: linked GitHub issues and PRs

## Maintenance rule

Keep this file to open broker-owned priorities and blockers. Move completed task narratives to the dated history/audit record; do not copy API contracts, test matrices, or implementation logs into the roadmap.
