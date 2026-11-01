# ADR-0002: Build Coin Farmer as an Independent Successor Application

- **Status:** Accepted direction
- **Date:** 2026-11-01
- **Owners:** Coinzilla architecture / Free-Roll successor
- **Related:** [ADR-0001](./ADR-0001-clean-hexagonal-architecture.md), [Coin Farmer architecture](../../../apps/bot-coin-farmer/docs/architecture/COIN_FARMER_ARCHITECTURE.md), [V1 behavior plan](../../../apps/bot-coin-farmer/docs/architecture/V1_TO_V2_BEHAVIOR_PLAN.md)

## Context

The existing application at apps/bot-free-roll is the current Free-Roll implementation. The desired successor needs substantial architectural freedom: it may reorganize responsibilities, redesign workflows and contracts, and improve state ownership and runtime lifecycle.

Refactoring the existing application in place would mix successor design work with the risk of destabilizing the current implementation. Renaming the existing app would also erase the clear coexistence boundary while the successor is being developed and validated.

The monorepo already supports sibling applications under apps/* and shared packages under packages/*. The successor can therefore be developed as a separate application while using stable public shared-package contracts where appropriate.

## Decision

Create the successor application at **apps/bot-coin-farmer**.

The application relationship is:

- **Free-Roll V1:** apps/bot-free-roll. Preserve as the reference implementation during successor development.
- **Coin Farmer:** apps/bot-coin-farmer. New independent application with its own implementation and architecture.

The following rules apply:

1. Do not refactor, rename, or otherwise modify V1 as part of Coin Farmer design or implementation tasks.
2. Coin Farmer must not import V1 source code, use V1 runtime objects, or depend on V1 persistence/state.
3. Coin Farmer owns its own source, tests, configuration, runtime lifecycle, diagnostics, persistence, and release gates.
4. Coin Farmer may reuse shared Coinzilla packages through their public APIs when those contracts meet its requirements.
5. Shared-package changes must be requested and implemented by the owning domain under AI_AGENT_WORKFLOW.md.
6. V1 strategy documentation, tests, source, and current-state audit are evidence for behavior discovery; they are not a reason to copy V1 implementation structure or known defects.
7. Strategy behavior changes and corrections to ambiguous/defective V1 behavior must be explicitly classified and approved before implementation.
8. V1 and Coin Farmer may coexist during development. Simultaneous live use against the same account is not assumed safe and requires a separate account-isolation/single-writer design.
9. Coin Farmer implementation, production enablement, cutover, V1 retirement, and directory renaming are separate decisions. This ADR authorizes none of those actions beyond the separate-app architecture direction.

## Consequences

### Positive

- V1 remains a stable behavioral and operational reference while successor work proceeds.
- The successor can redesign internal architecture without preserving accidental V1 coupling.
- Each application can have independent tests, config, persistence, runtime lifecycle, and release criteria.
- The transition can be validated before a production cutover decision.
- Shared concepts can still be reused through explicit package ownership and public contracts.

### Costs and risks

- Some strategy behavior may need to be independently reimplemented and tested.
- Two applications may temporarily coexist and require careful operational isolation.
- Shared contract gaps must be coordinated with package owners.
- Behavior parity and defect correction require an explicit mapping and review process.
- The successor adds workspace and maintenance surface while both apps exist.

## Alternatives considered

### Refactor apps/bot-free-roll in place

Rejected because successor architecture work would alter the existing reference while it is still needed for comparison and safe continuity.

### Rename apps/bot-free-roll to apps/bot-coin-farmer

Rejected because it would conflate the existing implementation with its successor and remove the clean coexistence boundary.

### Copy V1 wholesale and refactor the copy

Rejected as the default approach because it carries accidental coupling, legacy structure, and known defects into the new codebase. Reuse should be evidence-based: behavior, tests, and shared public contracts rather than runtime imports or blind file copying.

### Create a generic platform or microservice first

Rejected for now. The concrete need is a separate application, not a speculative platform or distributed-service decomposition.

## Implementation and validation guidance

Before implementing trading workflows:

1. Inventory V1 strategy rules, tests, modules, and known gaps.
2. Classify each behavior as preserve, preserve with a new implementation, correct after approval, review, or do not carry forward.
3. Audit shared entities and broker capabilities against successor requirements.
4. Agree Coin Farmer's domain model, use cases, ports, persistence/recovery contracts, and test acceptance criteria.
5. Implement in focused PRs under apps/bot-coin-farmer and the owning shared-package domains.
6. Prove deterministic behavior and safe-environment operation before proposing cutover.

This ADR establishes the application boundary. It does not freeze Coin Farmer's final folder structure, package dependencies, strategy extensions, persistence technology, or production-readiness criteria.
