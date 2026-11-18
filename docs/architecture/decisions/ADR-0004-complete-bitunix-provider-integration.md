# ADR-0004: Complete Bitunix provider integration

- Status: Accepted
- Date: 2026-11-18
- Owner: Harvester and Brokers
- Supersedes: The Bitunix observer-only integration exception described in ADR-0003's historical context and implemented under #1422
- Superseded by: None

## Context

The multi-provider architecture in ADR-0003 defines provider instances, account isolation, explicit execution routes, independent market-data routes, immutable provenance, and fail-closed capability checks. Bitunix has a partial Spot broker surface in `@coinzilla/brokers`, but it does not yet satisfy the complete order, fill, account-lifecycle, private-event/reconciliation, market-constraint, and environment-safety contract tracked by [issue #1185](https://github.com/45s/coinzilla/issues/1185).

A separate Harvester observer runtime was introduced as an interim integration. It created an additional Bitunix-specific runtime/configuration boundary that would have to be replaced or substantially reworked when the complete broker capabilities were ready. The project owner has explicitly rejected that temporary architecture and requires Bitunix to be completed without a partial query staging facade or a second Harvester integration.

## Decision

1. **Do not create or retain a partial Bitunix Harvester runtime.** Bitunix must not be registered as a provider, selected by execution routes, or used as a strategy market-data source until #1185's complete broker and lifecycle acceptance criteria are met.
2. **Complete the existing Bitunix broker implementation in `@coinzilla/brokers`.** Add the missing supported broker operations and canonical lifecycle behavior to the existing exchange-owned contract; do not build a parallel Harvester-specific Bitunix client or competing capability model.
3. **Integrate Bitunix through the standard provider contract only.** Once #1185 is complete, the Harvester adapter must implement the same application-owned BrokerPort, provider-instance identity, capability declaration, account isolation, execution routing, independent market-data routing, provenance, and startup/shutdown lifecycle as every other provider.
4. **Keep exchange-specific normalization in the Brokers domain.** Harvester owns application routing and orchestration, not Bitunix protocol parsing or a duplicate exchange-specific market-metadata model.
5. **Fail closed until the complete integration is verified.** The existence of partial query methods, credentials, a WebSocket connection, or a configured route is not evidence that Bitunix is execution-ready. No exchange operations are performed by the Phase 6 offline routing tests.

This decision supersedes only the Bitunix observer-only exception. ADR-0003 remains the authority for the general multi-provider routing architecture.

## Alternatives considered

- **Keep the separate observer runtime until trading is implemented.** Rejected because it creates a second integration surface and a guaranteed migration/refactor when full broker capabilities arrive.
- **Register a partial Bitunix provider with unsupported methods stubbed.** Rejected because it weakens the provider capability contract and risks treating unavailable lifecycle guarantees as supported.
- **Defer all Harvester Bitunix registration until the existing broker is complete.** Selected because it preserves one provider contract and allows the eventual implementation to be complete at first integration.

## Consequences

### Positive

- No temporary Bitunix-only runtime, configuration, metadata adapter, or duplicate capability boundary remains in Harvester.
- Future Bitunix support is an extension of the existing Brokers implementation followed by one standard Harvester adapter integration.
- Strategy and routing code remain exchange-neutral; account identity and order provenance are consistent across providers.
- Unsupported or unverified Bitunix capabilities cannot be selected accidentally.

### Trade-offs and risks

- Bitunix is not available as a Harvester execution or strategy market-data provider until #1185 is complete.
- The remaining Bitunix broker work is larger than a partial adapter, but it avoids building an interim API that would later be replaced.
- Historical PRs #1423 and #1424 remain part of repository history; they no longer describe the current Harvester runtime contract.

## Verification and follow-up

- **Implementation:** PR #1455 removes the interim observer runtime, configuration, adapter, metadata helper, and related documentation/tests. It does not claim Bitunix broker completion.
- **Tests:** Harvester provider-routing tests remain offline and prove the Binance execution path, account isolation, independent market-data routing, provenance, and lifecycle behavior.
- **Issues/PRs:** Complete the source-backed Bitunix broker and lifecycle acceptance in [#1185](https://github.com/45s/coinzilla/issues/1185) before adding a Bitunix provider factory or route.
- **Documentation updated:** ADR-0003 remains authoritative for general routing; this ADR is authoritative for Bitunix admission and sequencing. Harvester and Brokers roadmaps must reflect this boundary.
