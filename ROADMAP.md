# Coinzilla — develop engineering roadmap

**Scope:** cross-workspace engineering priorities for the active `develop` branch. Application- and package-specific backlogs remain in their owning roadmaps; this file is a concise priority index, not a duplicate task tracker.

**Goal:** prioritize demonstrated correctness, unattended-operation safety, operational confidence and maintainability. A task is complete only when its owning roadmap records the merged implementation and required verification.

**Last reviewed:** 2026-11-09 16:35 +02:00  
**Develop checkpoint:** `70dcbed12db1f04e48bc69b8ce6fbf3d60ad4a01`

## CRITICAL — Harvester readiness and recovery

1. **Harvester user-data recovery acceptance (#626) — implementation hardening substantially complete; final acceptance remains PAUSED / UNVERIFIED.**
   - **Why:** transport reconnection alone does not prove that account, orders and fills are reconciled or that readiness can safely reopen.
   - **Completed offline follow-up:** recovery failure classification #769 was implemented test-first and merged in [PR #794](https://github.com/45s/coinzilla/pull/794) on 2026-11-09; exact-head offline CI passed. See the [Harvester roadmap](apps/harvester/ROADMAP.md) and [closeout PR #807](https://github.com/45s/coinzilla/pull/807).
   - **Remaining:** keep #626 open for final acceptance traceability and a successful read-only TESTNET recovery run in an eligible, authorized environment. Preserve generation fencing, durable RECOVERY audit barriers and fail-closed readiness.
   - **Blocker:** the hosted Spot TESTNET API path returned HTTP 451 for regional eligibility. Do not repeat the same blocked attempt, change location, or claim exchange acceptance.
   - **Owner/evidence:** [Harvester roadmap](apps/harvester/ROADMAP.md) and [Brokers roadmap](packages/brokers/ROADMAP.md).

2. **Process-restart reconciliation (#654) — forensic phase; runtime implementation not started.**
   - **Why:** Portfolio, RecoveryLedger and order ownership are process-local. A restart can lose reservations and accounting context while exchange orders or fills still exist.
   - **Remaining:** establish complete historical market-universe evidence and a crash-consistent persistence/restore design before wiring startup restoration. Reconcile persisted state with balances, open orders and execution history before READY; fail closed on incomplete/conflicting evidence.
   - **Safety:** unattended restart readiness remains blocked. Do not re-enable the unproven replay path or change runtime source during the documented evidence-only phase.
   - **Owner:** [Harvester roadmap](apps/harvester/ROADMAP.md).

## IMPORTANT — active product and shared-package work

3. **Consolidated Harvester trading-session statistics (C).**
   - **Why:** operators need a trustworthy post-session accounting summary, not a reconstruction from logs and snapshots.
   - **Remaining:** build a read-only CLI report from confirmed, deduplicated fills and existing Portfolio/RecoveryLedger facts: BUY/SELL totals, commissions by asset, invested quote, recovered net proceeds, outstanding recovery, realized net profit, retained inventory/dust and open/partial orders.
   - **Owner:** [Harvester roadmap](apps/harvester/ROADMAP.md).

4. **Harvester Conservative architecture decomposition.**
   - **Why:** the trading engine and its tests are large orchestration hotspots; this increases review cost and regression risk.
   - **Remaining:** extract one behavior-protected workflow at a time, preserving domain decisions, accounting, reservations, event order and broker boundaries. Do not perform a broad rewrite.
   - **Owner:** [Harvester roadmap](apps/harvester/ROADMAP.md).

5. **Broker protocol and multi-market TESTNET acceptance.**
   - **Why:** offline fakes cannot prove endpoint compatibility, account reads, recovery acknowledgement, shared-asset reservations or real exchange filter behavior.
   - **Remaining:** complete the read-only protocol/recovery matrix in an eligible authorized environment; separately authorize any bounded order-mutation test. Keep all mutation flags disabled by default.
   - **Blocker:** current hosted Spot TESTNET regional eligibility restriction; acceptance is not established.
   - **Owners:** [Brokers roadmap](packages/brokers/ROADMAP.md) and [Harvester roadmap](apps/harvester/ROADMAP.md).

6. **Repository documentation consolidation (#795) — governance foundation and recursive inventory complete; content migration in progress.**
   - **Why:** contributors need one current source of truth per subject, clear ownership and reliable navigation without losing historical evidence.
   - **Completed:** baseline inventory of 97 Markdown files (42 Harvester, 55 other); governance/agent rules and indexes merged in PRs #796–#797; Harvester roadmap/README history separated in #798–#800; repository-wide Markdown relative-link validation merged in #801; root/domain freshness rules and live `develop-core` enforcement evidence recorded in #806/#799; one invalid TESTNET command example corrected in #808. The required `Check JavaScript syntax` context runs the agent-policy/link check; it is not a standalone documentation status.
   - **Remaining:** continue content-level source-of-truth/reference review and small evidence-preserving consolidations. All four initial Harvester REVIEW candidates now have evidence-based KEEP/SUPERSEDE dispositions. The two Brokers candidates have proposed KEEP outcomes in open PR #812; do not count those as merged until CI and merge complete. Do not claim migration completion from the governance foundation alone.
   - **Owner:** [Documentation Governance](docs/DOCUMENTATION_GOVERNANCE.md), [documentation index](docs/README.md), and [issue #795](https://github.com/45s/coinzilla/issues/795).

7. **Utilities build provenance and shared-helper reuse.**
   - **Why:** logs and Journal evidence need trustworthy process/build identity, while duplicated generic helpers can drift.
   - **Remaining:** finish the shared build-provenance/Logger context work and coordinated consumer rollout; complete the helper inventory with an explicit reuse/domain-local/intentional-duplication disposition. Avoid speculative utility APIs.
   - **Owner:** [Utils roadmap](packages/utils/ROADMAP.md).

8. **Entities package-owned quality and dependency boundaries.**
   - **Why:** workspace-wide coverage can hide weak package contracts, especially for exact financial values and unknown/incomplete states.
   - **Remaining:** close the scoped coverage and negative architecture/contract gaps recorded by the package owner.
   - **Owner:** [Entities roadmap](packages/entities/ROADMAP.md).

9. **First real database consumer and operational procedure.**
   - **Why:** SQLite lifecycle support is implemented, but no application-owned persistence workflow currently proves the end-to-end contract.
   - **Remaining:** select a real domain-owned repository use case before adding schema or generic repository abstractions; specify transactions, concurrency, migration, backup and restore as part of that consumer.
   - **Owner:** [Database roadmap](packages/db/ROADMAP.md).

## DEFERRED — evidence or consumer required

- **Market Simulator correctness and determinism:** intentionally lowest priority until a real application/workflow consumes it. Keep existing behavior/tests intact; do not schedule simulator work ahead of active Harvester or shared-package risks. [Owner roadmap](packages/market-simulator/ROADMAP.md).
- **Event Bus advanced delivery features:** sequential delivery, retries, dead-letter handling and cooperative cancellation remain demand-driven; preserve the existing bounded delivery and shutdown contract. [Owner roadmap](packages/event-bus/ROADMAP.md).
- **Additional notification transports/retries/outbox:** require a concrete consumer and explicit duplicate-delivery/storage ownership. The live Telegram smoke test remains operator-controlled. [Owner roadmap](packages/notifiers/ROADMAP.md).
- **Additional database providers:** reassess only when measured deployment, concurrency, scale or query requirements exceed SQLite.

## Recently completed — do not reopen without new evidence

- **Conservative trailing-BUY replacement safety:** PRs [#751](https://github.com/45s/coinzilla/pull/751) and [#753](https://github.com/45s/coinzilla/pull/753) merged. Candidate validation and refreshed exchange filters now precede cancellation; uncertain outcomes pause for reconciliation. See the [Harvester roadmap](apps/harvester/ROADMAP.md).
- **Journal persistence and lifecycle boundary (J-1 through J-5):** record contract, filesystem adapter, lifecycle ownership, durability/recovery documentation and cleanup/order hardening are complete. PR [#805](https://github.com/45s/coinzilla/pull/805) merged at `3eb5efd1966c1619ee98e62853ff624403555bbd`. Journal follow-up cleanup tests and docs are complete; do not list J-3/J-4/J-5 as open work. See the [Journal roadmap](packages/journal/ROADMAP.md).
- **Harvester process provenance:** PR #770 merged; the process-start Journal event and Logger correlation are implemented. The shared Utils build-provenance capability remains separately tracked by the Utils roadmap.

## Roadmap ownership map

- [Harvester](apps/harvester/ROADMAP.md) — trading safety, recovery, restart reconciliation and session statistics.
- [Brokers](packages/brokers/ROADMAP.md) — native WebSocket protocol, user-data lifecycle and exchange acceptance.
- [Entities](packages/entities/ROADMAP.md) — exact financial contracts and package-owned quality.
- [Journal](packages/journal/ROADMAP.md) — record contract, persistence lifecycle and durability.
- [Database](packages/db/ROADMAP.md) — embedded persistence infrastructure and first real consumer.
- [Event Bus](packages/event-bus/ROADMAP.md) — bounded delivery and lifecycle guarantees.
- [Notifiers](packages/notifiers/ROADMAP.md) — optional operational notifications.
- [Utils](packages/utils/ROADMAP.md) — shared exact arithmetic, Logger and generic helpers.
- [Market Simulator](packages/market-simulator/ROADMAP.md) — intentionally deferred unused package.

## Delivery and documentation synchronization rules

1. Work one meaningful behavior at a time; for behavior changes use RED → GREEN → REFACTOR.
2. Read repository and owning-domain instructions, roadmaps, contracts, implementation, consumers and tests before editing.
3. Keep implementation in its owning bounded context and preserve financial/recovery safety invariants.
4. Update every affected living document in the same PR. When an owner-roadmap status, priority or blocker changes, check this root roadmap and synchronize its cross-workspace summary if that item is represented here.
5. Keep the root roadmap concise: link to domain roadmaps rather than copying their detailed plans. Do not mark work complete before merge and required verification.
6. Preserve historical reports and provenance. Correct stale historical conclusions with a dated addendum or link to the current living source; never silently rewrite evidence.
7. Run focused checks, repository agent-policy/link checks and applicable CI on the exact PR head. A skipped integration check is not a pass.
8. Keep task branches short-lived and delete them after merge when repository permissions allow. Never bypass branch protection or release approval.

