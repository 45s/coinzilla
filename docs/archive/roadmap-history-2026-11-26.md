# Roadmap and inventory history — 2026-11-26

Historical snapshots retained for provenance. Active roadmap and inventory pages are current sources of truth; this archive is not current task status.


---

## root-roadmap

Archived source path: `ROADMAP_HISTORY_2026-11-26.md`

# Repository — develop engineering roadmap

**Scope:** cross-workspace engineering priorities for the active `develop` branch. Application- and package-specific backlogs remain in their owning roadmaps; this file is a concise priority index, not a duplicate task tracker.

**Goal:** prioritize demonstrated correctness, unattended-operation safety, operational confidence and maintainability. A task is complete only when its owning roadmap records the merged implementation and required verification.

**Last reviewed:** 2026-11-26
**Latest `develop` head inspected for this roadmap update:** `ef5f5e25b0994f244eb6b29b62f5d48235df4544` (2026-11-26). The most recent recorded recursive inventory is the historical baseline `0f827ba7551be61a1be58f8dced191fb0a090870`: 1,298 tracked files, including 179 Markdown/MDX files and 1,091 `.js` files (540 `.test.js` files); 579 JavaScript files were under Harvester (268 tests) at that baseline. These counts are not a current-tree inventory. The S-7 naming/tree baseline and later S-8 additions are recorded in [the engineering standards matrix](docs/engineering/ENGINEERING_STANDARDS_MATRIX.md).

## Repository engineering standards initiative — [#1568](https://github.com/45s/coinzilla/issues/1568)

- **S-0 through S-10:** completed/merged. S-8 practical templates merged in [PR #1610](https://github.com/45s/coinzilla/pull/1610) as `f2dd1f23fa842c8bac140f7da10ef86cf4cfc9f9`.
- **S-9:** first consolidated implementation **merged** in [PR #1618](https://github.com/45s/coinzilla/pull/1618) on 2026-11-21. It combines the AST relative-import graph and workspace-package dependency guard from #1612/#1615; overlapping draft #1617 was superseded. The AST graph scans production JavaScript under `apps/`, `packages/`, and `scripts/`, including Harvester; verified baseline: 523 modules, 864 resolved relative edges, 0 cycle components (report-only). The blocking manifest checker scans all 9 workspace packages and all four dependency sections against the canonical [Domain Ownership](docs/engineering/DOMAIN_OWNERSHIP.md) allowlist, enforces `workspace:` protocol/allowed edges/package existence, and blocks package dependency cycles. Combined follow-up [PR #1624](https://github.com/45s/coinzilla/pull/1624) adds the AST-backed public-import boundary and synchronizes the roadmap/standards checkpoint in the same review: 257 static `@coinzilla/*` production imports were checked; package roots and declared exact/single-wildcard `exports` subpaths pass, while unknown workspace packages and unexported subpaths fail. The checker reuses the existing AST extractor and production-module discovery; no new dependency, workflow, or required status context is added. The combined [PR #1624](https://github.com/45s/coinzilla/pull/1624) merged into `develop` at `0f827ba7551be61a1be58f8dced191fb0a090870`; all six PR workflows passed on exact head `77b02a4e0108f6dc5943adb59e6acda8141d5f3e`. Remaining S-9 dispositions and limitations are recorded in issue #1568: cross-workspace relative-import direction and semantic internal-layer ownership remain package-owned/review responsibilities; direct tests for every production module, universal config-test presence and common API-contract checks are not reliable generic gates. No active approved temporary exception requiring an expiry registry was found. No runtime/trading behavior changed.
- **S-10:** COMPLETE — [PR #1628](https://github.com/45s/coinzilla/pull/1628) merged into `develop` at `bb8c7128edb583f04dc2898b9ec3e1d6370dad54`. The audit reconciled all 179 Markdown/MDX paths (150 maintained, 29 historical), updated 26 Markdown files, and recorded explicit evidence for additions/removals. Documents without a distinct source-review record remain explicitly not independently revalidated; KEEP was not treated as factual verification. Issues [#1401](https://github.com/45s/coinzilla/issues/1401) and [#1403](https://github.com/45s/coinzilla/issues/1403) are closed.

### Remaining repository-governance follow-ups beyond S-0–S-10

- **Live review controls:** both active repository rulesets were read back on 2026-11-21. `core` targets `main` and `develop-core` targets `develop`; both require strict, up-to-date status checks (`Run package tests`, `Workspace test coverage`, `Check JavaScript syntax`, `packages/utils tests`, `Audit production dependencies`, and `actionlint`), pull requests, and review-thread resolution. Both require zero approving reviews, have no bypass actors, and preserve solo-maintainer compatibility. Classic branch-protection readback returned HTTP 403 (Resource not accessible by integration); do not claim those settings were independently verified.
- **Security/static analysis — upstream CodeQL investigation; release blocker PR #1662.** Production dependency auditing is active. The repository-local CodeQL replacement query, custom configuration, SARIF verifier, and query-regression workflow were removed; the built-in `js/insufficient-password-hash` rule remains enabled and no alerts were suppressed or dismissed. The two High signer findings remain tracked in [#1674](https://github.com/45s/coinzilla/issues/1674); upstream query-classification investigation, official references, attempted variants, and negative evidence are preserved there. The separate High `js/incomplete-multi-character-sanitization` finding in `scripts/task-preflight.js` remains tracked in [#1765](https://github.com/45s/coinzilla/issues/1765); its parser correction and local CodeQL evidence are documented in that issue, while active Code Scanning confirmation remains outstanding. The repository property `github-codeql-config-file` and active Code Scanning endpoint could not be read through the integration; the owner must verify there is no stale reference to the removed custom configuration and inspect the live alerts. Do not change the Bitunix-required SHA-256 signing protocol or dismiss alerts. Keep release PR [#1662](https://github.com/45s/coinzilla/pull/1662) blocked until the signer findings receive an evidence-based disposition on the exact release commit.
- **JSDoc static checking:** the pilot is deferred, not enforced. The root package pins pnpm 12.11.2; the lockfile contains TypeScript 6.0.3 as an Angular-dashboard toolchain dependency, not as an independently owned compiler for a representative JavaScript package. Reusing that transitive dependency would create an unsupported package contract, and no measured package diagnostic baseline has been established. Do not add a floating compiler, fabricate lockfile entries, or enable global `checkJs`.
- **Periodic governance review:** [PR #1633](https://github.com/45s/coinzilla/pull/1633) merged at `3073df8e26fd91e425e2f6f8f363850c85235e9e`. The workflow has monthly `15 8 1 * *` scheduling, manual dispatch, `issues: write` only, non-cancelling concurrency, and duplicate detection across open and closed issues. The repository default branch is `main`; the workflow file is not yet present there, so the monthly schedule will not activate until the next permitted release PR carries it to `main`. Manual dispatch remains available from the branch containing the workflow.
- **Helper purity audit — #1565:** the current tree contains 54 production modules under `helpers/`; each has a colocated `.test.js`, and direct-import checks confirmed all 54 tests import their corresponding helper. The required helper-policy workflow passed on the exact #1633 PR head. The scanner remains heuristic and does not prove transitive purity. The remaining concrete regression was that unknown Binance user-data events were forwarded without a warning; this close-out change adds a sanitized warning at the broker boundary while preserving event delivery and keeping the adapter pure. The focused regression test asserts that payload contents are not logged.

## Domain Scenario Testing methodology — [#1779](https://github.com/45s/coinzilla/issues/1779)

- **COMPLETE — shared strategy-neutral methodology.** The canonical guide at [`docs/testing/DOMAIN_SCENARIO_TESTING.md`](docs/testing/DOMAIN_SCENARIO_TESTING.md) merged in [PR #1795](https://github.com/45s/coinzilla/pull/1795). It owns reusable scenario design, test-layer boundaries, lifecycle/accounting proof, fixtures, adversarial coverage, evidence status and adoption guidance. Strategy-specific specifications and scenario matrices remain owned by their respective domains; the repository-wide [scenario catalog](docs/testing/SCENARIO_CATALOG.md) is the shared navigation/evidence index.
- The initial extraction preserves Conservative business examples and its conceptual lifecycle model in the Harvester-owned [Conservative scenario supplement](apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SCENARIO_TESTS.md). Recovery Seller adopts the shared method through [#1780](https://github.com/45s/coinzilla/issues/1780). [PR #1793](https://github.com/45s/coinzilla/pull/1793) is merged and provides the initial four-file scenario suite; RS-003 through RS-007 remain PARTIAL because the suite does not cover every application, exchange, accounting and persistence boundary.
- **RS scenario playbook and matrix:** the canonical authoring contract is `apps/harvester/docs/domain/recovery-seller-scenario-testing.md`; issue [#1780](https://github.com/45s/coinzilla/issues/1780) owns the detailed RS-001…RS-010 matrix and evidence. Consolidated [PR #1852](https://github.com/45s/coinzilla/pull/1852) is merged into `develop` at `ef5f5e25b0994f244eb6b29b62f5d48235df4544`; it supplies the test-only RS registry and mapped records, not an executable production catalogue. Former Draft [PR #1823](https://github.com/45s/coinzilla/pull/1823) was closed unmerged after confirming all 40 of its changed paths were transferred; its unique docs/tests, including RS-002-006-B and RS-002-020-B, are carried in #1852. The suite remains test-only and PARTIAL.
- **RS-003 workflow integration:** production defect #1809 is fixed in merged [PR #1815](https://github.com/45s/coinzilla/pull/1815), merge `cbf07da54fd2e14fbeb3f96d4d9f8efe48d597c2`. The real accounting workflow snapshot feeds the default SELL evaluator with canonical cycle state. All six required workflows passed on exact merged head `20963617c9d9d73c31b47865e0aa34c4a966cc8e`.
- **Coverage remains PARTIAL:** RS-001/002 retain freshness, authorization and BUY-lifecycle gaps; RS-003 through RS-007 remain partial; RS-008 lacks concurrent newly-created SELL/base-intent and cross-asset atomicity proof; RS-009 has an owner-approved investment-only STOP contract but implementation/scenario proof is missing; RS-010 restart/replay is unsupported and third-asset fee valuation remains blocked. No mapped case is automatically VERIFIED.
- The shared methodology and scenario-playbook work does not authorize exchange operations or runtime activation. PR #1815 was a separate narrow application bug fix; it performs no broker network calls or exchange-state changes.

## Executable CLI source identity — [#1631](https://github.com/45s/coinzilla/issues/1631)

- **PARTIAL — issue #1631 remains OPEN.** Merged [PR #1632](https://github.com/45s/coinzilla/pull/1632) establishes the source-identity requirement and migrates the Bitunix healthcheck as the first entrypoint. It does not complete the repository-wide executable CLI inventory or remaining migrations. The issue was reopened on 2026-11-25 after a premature closure; continue the inventory before marking this initiative complete.

## Multi-provider Harvester execution and market-data routing — #1339

- **Routing foundation — Phases 1–6 COMPLETE; overall issue #1339 remains active.** The merged delivery covers capability declarations ([PR #1366](https://github.com/45s/coinzilla/pull/1366)), provider identity/registry ([PR #1383](https://github.com/45s/coinzilla/pull/1383)), durable order/fill provenance ([PR #1416](https://github.com/45s/coinzilla/pull/1416)), in-process account isolation ([PRs #1440](https://github.com/45s/coinzilla/pull/1440) and [#1445](https://github.com/45s/coinzilla/pull/1445)), independent market-data routing ([PR #1452](https://github.com/45s/coinzilla/pull/1452)), and explicit execution routing ([PR #1455](https://github.com/45s/coinzilla/pull/1455), merge `fdc951468648efa1fa17c93dd8c3f6ea78a23d84`). PR #1455's exact-head workspace tests, coverage, Harvester targeted tests, lint/syntax, actionlint, policy, Markdown/anchor, dependency audit and external documentation-link checks passed. This completes the routing/account-isolation foundation, **not a second-exchange rollout**: the production adapter map still registers Binance only. Bitunix remains blocked by [#1185](https://github.com/45s/coinzilla/issues/1185); Recovery Seller RS-4 runtime composition and scoped RS-5 offline lifecycle/failure/concurrency acceptance are complete in PR #1515. The runtime acceptance gate is open; RS is enabled by owner-approved configuration and remains restricted by per-market `enabled` and `tradingEnvironment` filters. Restart/replay and third-asset commission valuation are deferred; STOP blocks additional BUY spending only; eligible recovery SELL and existing-order reconciliation/accounting continue. Authorized resolution requires cause correction, authoritative reconciliation, verified accounting/reservations and durable acknowledgement; no automatic clear or self-resume; process-restart recovery [#654](https://github.com/45s/coinzilla/issues/654) remains lowest priority. See the [migration plan](docs/architecture/multi-provider-migration-plan.md), [ADR-0003](docs/architecture/decisions/ADR-0003-multi-provider-routing.md), and the [Harvester](apps/harvester/ROADMAP.md) / [Brokers](packages/brokers/ROADMAP.md) roadmaps.

## Exchange-neutral Broker API consistency — [#1446](https://github.com/45s/coinzilla/issues/1446)

- **COMPLETE — merged** [PR #1451](https://github.com/45s/coinzilla/pull/1451) into `develop` as `e6d3e60aaaa26ad23705564ffc17f786c995b3dd`.
- **Canonical capability owner:** `@coinzilla/brokers`. The previous Entities three-state value and Binance four-state declaration were competing representations, not distinct concepts. The canonical vocabulary is `SUPPORTED`, `UNSUPPORTED`, and `UNKNOWN`; `environment-dependent` is represented as `SUPPORTED` with explicit conditions. Unknown means insufficient evidence.
- **Compatibility:** the immutable declaration preserves Harvester's `contractVersion`, `provider`, `environment.selectedMode`, and `environment.supportedModes` registry contract. No Harvester application port, adapter, registry, routing, or orchestration was moved into Brokers.
- **Entities coordination remains separate:** [issue #1450](https://github.com/45s/coinzilla/issues/1450) tracks the owner-coordinated disposition of the legacy public Entities export. Brokers does not import it, and it was not silently deleted or changed.
- **Public contract:** Brokers now defines the structural method catalog, compatibility methods, stable unsupported-operation errors, mutation outcomes, normalized result guarantees, and a shared offline conformance suite run against Binance and Bitunix. The method matrix and decimal/timestamp/pagination/lifecycle guarantees are in [BROKER_API.md](packages/brokers/BROKER_API.md).
- **Verification on final PR head:** 688 Brokers tests passed; workspace unit tests and coverage passed; JavaScript Syntax/workspace quality, strict changed-file ESLint, actionlint, Harvester targeted tests, Utils tests, and dependency audit passed. Read-only Binance TESTNET integration was skipped by workflow policy. The advisory External Documentation Links workflow also completed successfully on the exact PR #1593 head.
- **Safety:** Bitunix Spot order placement, cancellation, and canonical fills remain blocked by [#1185](https://github.com/45s/coinzilla/issues/1185). This task does not authorize live mutations.
- This is independent of [#1339](https://github.com/45s/coinzilla/issues/1339), which remains the Harvester-owned multi-provider runtime, account isolation, and routing workstream. See the [Brokers roadmap](packages/brokers/ROADMAP.md).

## Repository-wide agent workflow continuity

- **Incremental commits and resumable handoffs — COMPLETE** in merged [PR #1200](https://github.com/45s/coinzilla/pull/1200) (`65cec77b9f0c182c5f506654a7e33df2909b6a67`); tracking issue [#1199](https://github.com/45s/coinzilla/issues/1199) is closed. Task issues remain the live contract, commits form small meaningful checkpoints, and every pause/ownership transfer leaves a complete GitHub handoff. Canonical rules live in [AI_AGENT_WORKFLOW.md](AI_AGENT_WORKFLOW.md); root [AGENTS.md](AGENTS.md), [task checklists](docs/engineering/TASK_WORKFLOWS.md) and the [PR template](.github/PULL_REQUEST_TEMPLATE.md) point contributors to the same contract. Documentation-only scope; no runtime or exchange operations.
- **AI engineering workflow and refactoring policy — IN PROGRESS** under [issue #1500](https://github.com/45s/coinzilla/issues/1500). The commit-level checkpoint loop was delivered in [PR #1501](https://github.com/45s/coinzilla/pull/1501). This follow-up makes the task boundary explicit (**one task = one branch = one PR**, with implementation, tests and affected docs together) and strengthens generic evidence-led audit/refactoring guidance, including measured performance claims and actionable finding dispositions. See [AI Agent Workflow](AI_AGENT_WORKFLOW.md), the [AI Refactoring and Code Audit Standard](docs/engineering/AI_REFACTORING_AUDIT_STANDARD.md), and [Task Workflows](docs/engineering/TASK_WORKFLOWS.md).
- **Issue context maintenance — policy refined.** [PR #1752](https://github.com/45s/coinzilla/pull/1752) introduced continuous issue knowledge capture. Follow-up [PR #1782](https://github.com/45s/coinzilla/pull/1782) retires the mandatory capture/comment ceremony while keeping issues and PRs accurate when scope, decisions, blockers, or verification materially change; handoff checkpoints remain useful when work pauses or ownership transfers.
- **Task Preflight — RETIRED as a mandatory development step (2026-11-23).** PR [#1769](https://github.com/45s/coinzilla/pull/1769) removed CI enforcement; this follow-up removes the remaining task-start command/report/attestation and issue-evidence requirements. The validator and tests from [PR #1756](https://github.com/45s/coinzilla/pull/1756) are retained as explicitly optional developer tooling, not a gate. All six required ruleset contexts and normal engineering/security checks remain unchanged. Issue [#1754](https://github.com/45s/coinzilla/issues/1754) was closed as not planned. The independent parser/security correction remains tracked in [#1765](https://github.com/45s/coinzilla/issues/1765) until active Code Scanning confirmation.

## 2026-11-14 repository status audit

- **Merged since the previous checkpoint:** [PR #1091](https://github.com/45s/coinzilla/pull/1091) and [PR #1094](https://github.com/45s/coinzilla/pull/1094) complete the Harvester source/domain-correctness audit; [PR #1099](https://github.com/45s/coinzilla/pull/1099) completes Telegram notification icon selection; [PR #1100](https://github.com/45s/coinzilla/pull/1100) wires the shared Operational State Store for Telegram control; [PR #1108](https://github.com/45s/coinzilla/pull/1108) consolidates Operational State Store terminology; [PR #1121](https://github.com/45s/coinzilla/pull/1121) suppresses market-data feeds for strategy-blocked symbols; and [PR #1123](https://github.com/45s/coinzilla/pull/1123) makes PR draft/ready lifecycle gates mandatory for agents; [PR #1120](https://github.com/45s/coinzilla/pull/1120) merges Harvester shutdown BUY-fill recovery and shutdown phase observability. [PR #1118](https://github.com/45s/coinzilla/pull/1118) adds strategy-owned Portfolio Positions; [PR #1124](https://github.com/45s/coinzilla/pull/1124) reconciles the roadmap; [PR #1134](https://github.com/45s/coinzilla/pull/1134) completes effective runtime configuration integrity (#1101); and [PR #1137](https://github.com/45s/coinzilla/pull/1137) adds the RS verified mixed-sell allocation boundary; [PR #1144](https://github.com/45s/coinzilla/pull/1144) adds immutable Harvester order ownership; [PR #1148](https://github.com/45s/coinzilla/pull/1148) preserves shutdown replacement failure diagnostics; [PR #1139](https://github.com/45s/coinzilla/pull/1139) records durable local submission deferrals; and [PR #1150](https://github.com/45s/coinzilla/pull/1150) closes out the F-055 diagnostic remediation; [PR #1166](https://github.com/45s/coinzilla/pull/1166) makes all unmatched startup-snapshot orders external to the new process and applies the configured per-market policy uniformly. This closeout records [PR #1135](https://github.com/45s/coinzilla/pull/1135); [PR #1163](https://github.com/45s/coinzilla/pull/1163) adds the Harvester shutdown logging redesign reference. [PR #1262](https://github.com/45s/coinzilla/pull/1262) adds the shared SystemCustomError base; [PR #1212](https://github.com/45s/coinzilla/pull/1212) completes RS exact-once mixed SELL accounting and snapshot-relative shared-custody baselines. Issues [#1073](https://github.com/45s/coinzilla/issues/1073), [#1093](https://github.com/45s/coinzilla/issues/1093) and [#1101](https://github.com/45s/coinzilla/issues/1101) are closed against their merged implementations.
- **RS-2b complete:** PR #1276 merged the isolated application accounting workflow as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`. It commits terminal recovery/legacy projections atomically, returns separate accounting diagnostics plus one combined cycle-level profitability result, and releases the unfilled SELL reservation only after successful reconciliation/commit. RS-3 foundations include the fee-aware mixed-SELL planner, independent recovery/legacy/combined profitability gates and allocation-precision guards, merged in PR #1379. The owner has confirmed the existing per-pair `minProfit` only, Conservative-compatible order-type/fee-reserve selection and STOP on exchange-filter violations; the pure pre-submission SELL evaluator is implemented and verified on exact PR head `96315757e74a4851770716b04d8dae5cf9580ece`. Post-fill adverse outcomes, terminal partial/canceled outcomes, third-asset valuation source and STOP reset/resume remain fail-closed. See the [CG-to-RS policy blocker audit](apps/harvester/docs/domain/RECOVERY_SELLER_POLICY_BLOCKERS.md). At the time of PR #1276, RS was non-executable and the full Harvester suite reported 1,847/1,847; no exchange operations were performed. PR #1515 later completed RS-4 runtime composition and scoped RS-5 offline lifecycle acceptance. The runtime gate is open, while RS remains disabled by default in configuration. The BUY cadence and tranche sizing reuse the approved Conservative behavior.
- **Open issue inventory:** GitHub's live issue state is authoritative; this roadmap is a priority index, not a count of open issues. Repository-wide ESLint cleanup (#1092 and its child issues) is complete and closed. Harvester Telegram delivery diagnostics (#1103) are complete in merged [PR #1298](https://github.com/45s/coinzilla/pull/1298). Keep remaining evidence, acceptance and implementation work tracked in the owning issues and roadmaps.

## Completed — Harvester Telegram Command Center

- **Command Center (#1077) — COMPLETE.** The Telegram interface is a thin authorized command/query adapter over Harvester application use cases; it does not own trading policy, persistence, or startup policy. Delivered: slash commands and read-only queries (PRs #1079, #1081, #1086), inline navigation and confirmation (PR #1088), persistent six-button keyboard (PR #1194), emergency global/per-market BUY controls (PR #1267), correlated interaction diagnostics plus callback acknowledgement handling (PR #1215), and the unified market Pause/Resume behavior (merged PR #1436). The normal `/pause SYMBOL` and confirmed Pause button now use the existing owned-BUY cancellation/reconciliation workflow. The stale tracking issues [#1201](https://github.com/45s/coinzilla/issues/1201) and [#1214](https://github.com/45s/coinzilla/issues/1214) are closed as completed. Outbound Telegram notifications are a separate capability. See the [Harvester roadmap](apps/harvester/ROADMAP.md), [operator-control contract](apps/harvester/docs/operator-control/README.md), and [operator runbook](apps/harvester/docs/operations/telegram-command-center.md). No live exchange operation was part of CC.

## CRITICAL — Harvester readiness and recovery

1. **Harvester user-data recovery acceptance (#626) — implementation hardening substantially complete; final acceptance remains PAUSED / UNVERIFIED.**
   - **Why:** transport reconnection alone does not prove that account, orders and fills are reconciled or that readiness can safely reopen.
   - **Completed offline follow-up:** recovery failure classification #769 was implemented test-first and merged in [PR #794](https://github.com/45s/coinzilla/pull/794) on 2026-11-09; exact-head offline CI passed. See the [Harvester roadmap](apps/harvester/ROADMAP.md) and [closeout PR #807](https://github.com/45s/coinzilla/pull/807).
   - **Offline follow-up implemented and verified in PR #906:** Harvester F-033 classifies permanent Journal write failures as terminal, preserves explicitly retryable healthy-writer flush failures, and fails closed when Journal health is unclassified. Exact implementation head `9d6283de604ddcaefe9cd9faabce29489fb896ea` passed all unit-test and coverage workflows; no Journal package API or TESTNET scope change.
   - **Offline follow-up merged in [PR #909](https://github.com/45s/coinzilla/pull/909) as `dc17f1f2c1fa6e45c08035ae6ae736eb821b90a5` (reconciled exact head `46de0a6f891deb9dc7d3960c7b36d1de0fe72eee`):** stale asynchronous recovery-stage failures are logged with their original error and captured/current generations, then discarded before they can mutate newer-generation failure state or the terminal accounting latch. Harvester unit tests passed (871/871); exact-head Harvester coverage was 75.98% lines, 79.32% branches, 74.85% functions; workspace unit tests and coverage, targeted regression tests, JavaScript syntax/policy/Markdown, external documentation links, dependency audit, actionlint and Utils tests also passed. TESTNET remains PAUSED / UNVERIFIED; the read-only integration job and Harvester endpoint probe were skipped.
   - **Remaining:** keep #626 open for final acceptance traceability and a successful read-only TESTNET recovery run in an eligible, authorized environment. Preserve generation fencing, durable RECOVERY audit barriers and fail-closed readiness.
   - **Reliability initiative [#1639](https://github.com/45s/coinzilla/issues/1639), user-data recovery child [#1714](https://github.com/45s/coinzilla/issues/1714) — IN PROGRESS:** offline source review confirms existing Harvester runtime coverage for queued-fill draining, repeated recovery reminders, second-disconnect generation fencing, and canonical REST/stream reconciliation. The current increment adds explicit disposal of a failed broker reconnect client, prevents replacement sockets while disposal remains unresolved, and corrects Harvester critical-behavior test mappings. It does not claim Binance event replay or TESTNET acceptance.
   - **Blocker:** the hosted Spot TESTNET API path returned HTTP 451 for regional eligibility. Do not repeat the same blocked attempt, change location, or claim exchange acceptance.
   - **Owner/evidence:** [Harvester roadmap](apps/harvester/ROADMAP.md) and [Brokers roadmap](packages/brokers/ROADMAP.md).
   - **Offline reliability fixes (2026-11-10):** broker canonical placement requests Binance `RESULT` for complete `LIMIT_MAKER` acknowledgements; [PR #961](https://github.com/45s/coinzilla/pull/961) merged at `8e2f795223a4d594947a6577a09bd183f9b48328`. Harvester identity recovery (`UNKNOWN → OPEN`) and accurate `TRADING_MODE` startup messages merged in [PR #964](https://github.com/45s/coinzilla/pull/964) at `ce7b5dfeddaaeed68f67ab8213520427b3777280`, closing [issues #962](https://github.com/45s/coinzilla/issues/962) and [#963](https://github.com/45s/coinzilla/issues/963). All six required workflows passed on synchronized PR head `91d7d34f1b6c11e5a3b0513c91d974ffb93f977c`; the external documentation-links workflow was advisory and still running at merge. No Binance exchange operations were performed.

- **Conservative ADA recovery lifecycle ([#1359](https://github.com/45s/coinzilla/issues/1359)) — P0 safety work; focused implementation increment in review.** Historical session evidence remains in [PR #1358](https://github.com/45s/coinzilla/pull/1358); the dust-classification fix is in [PR #1363](https://github.com/45s/coinzilla/pull/1363), and deterministic ADA replay/configuration evidence is in [PR #1411](https://github.com/45s/coinzilla/pull/1411). Recovery SELL filter freshness, durable submission intent/outcome, and current-process-owned BUY cancellation are fixed in merged [PR #1670](https://github.com/45s/coinzilla/pull/1670), [PR #1750](https://github.com/45s/coinzilla/pull/1750), and [PR #1755](https://github.com/45s/coinzilla/pull/1755). Current [PR #1761](https://github.com/45s/coinzilla/pull/1761) reconstructs the sanitized 2026-11-22 ZRO/DOGE/ADA archive through production accounting/runtime components, proves late-SELL exact-once accounting, and fixes the serialized Conservative shutdown deferred-evaluation race. PR review and final CI are intentionally deferred to the review checkpoint; no TESTNET/LIVE writes or account mutations. Historical decision-time filters and the archived session's clean shutdown remain unproven. The separate 28 order-history projection failures are tracked in [#1789](https://github.com/45s/coinzilla/issues/1789), not bundled into #1362. Parent issue #1359 remains open.
- **Harvester ZRO user-data order-event integrity and shutdown recovery ([#1132](https://github.com/45s/coinzilla/issues/1132)) — NEW P0 blocker.** The 2026-11-14/15 TESTNET session audit confirms a late zero-cumulative Binance NEW report after a FILLED ZROUSDT order caused the canonical registry's monotonic executed-quantity check to fail and latched EXECUTION_ACCOUNTING_FAILED; the one BUY fill itself reconciles exactly to PREFLIGHT/CLOSING balances. Shutdown then failed to confirm recovery SELL replacement and found 0 of 4.98 ZRO committed; the CLOSING audit remained INCOMPLETE and STOPPED was not reached. The order-event stale-classification gap is confirmed. [PR #1148](https://github.com/45s/coinzilla/pull/1148) merged into `develop` as `a04aef010576e459896c2319ab4d1a8e02cfe761`, correcting shutdown diagnostics that omitted replacement error messages, stacks and causes; this is observability-only, and the replacement failure's root cause and exchange-side outcome remain UNKNOWN. See [Harvester session audit](apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-14_23-41-12Z.md), [F-054/F-055](apps/harvester/docs/audits/reports/AUDIT_FINDINGS.md), and the [Harvester roadmap](apps/harvester/ROADMAP.md). Keep existing fail-closed behavior; no TESTNET/LIVE operation is authorized.

- **Shutdown diagnostics — merged in [PR #977](https://github.com/45s/coinzilla/pull/977), commit `597b01d3836d74d1c4a409005c844d76102e4a34`.** The shutdown handler distinguishes `SHUTDOWN_INCOMPLETE` from confirmed `STOPPED`, preserves the pre-shutdown readiness state, and exposes stage-specific recovery/cleanup failures plus exact safe summaries of unresolved owned orders. Existing process-lock retention is unchanged. Exact-head verification: 935/935 Harvester tests; 75.83% line / 78.98% branch / 75.32% function coverage; all seven configured workflows passed.
  - **Historical incident cause remains unresolved:** the original event-level Journal/session records and complete shutdown diagnostic snapshot for the earlier incomplete shutdown are not present in the evidence reviewed for this follow-up. PR #977 improves future diagnosis but does not retroactively identify that occurrence's failed stage. Do not infer a cause from the aggregate incomplete-shutdown status; preserve the full session JSONL and shutdown summary if the scenario is reproduced.

- **Conservative shutdown safety (#1186) — corrective implementation merged in [PR #1326](https://github.com/45s/coinzilla/pull/1326).** The drain now checks both rejected tasks and fulfilled callbacks returning `{ ok: false }`; failed pre-unsubscribe drains reopen callbacks, block CLOSING/unsubscription, and retain user-data/operator/broker services. The implementation is merged, but [issue #1186](https://github.com/45s/coinzilla/issues/1186) remains open for the remaining end-to-end acceptance criteria and operator evidence. No exchange operation is authorized.

- **Broker-connected startup PREFLIGHT Journal serialization — implemented and verified in [PR #1084](https://github.com/45s/coinzilla/pull/1084), exact head `d61f7cce52bf5a46a89ad47019d18edf1b02805a`.** BLOCKED account-wide open-orders alerts without one unique symbol and user-data subscription-failure alerts without a market now omit the optional `symbol` property. The real EventBus + Journal regression passes; Harvester tests passed 1,444/1,444 and all required workflows passed. The account audit, safety alerts, Journal barrier, and fail-closed startup behavior remain required; no exchange operation is involved. Merged into `develop`; this startup serialization regression is complete.

- **Harvester Telegram Command Center diagnostics (#1214) — COMPLETE.** Correlated per-interaction lifecycle logs, original/nested error preservation, callback acknowledgement retry and separation between application-operation completion and Telegram response delivery are merged in [PR #1215](https://github.com/45s/coinzilla/pull/1215). The account-wide `/orders` query argument fix is merged in [PR #1261](https://github.com/45s/coinzilla/pull/1261). Tracking issue [#1214](https://github.com/45s/coinzilla/issues/1214) is closed. Live Telegram verification remains operator-controlled; no exchange operation was authorized.

- **Harvester external-order ownership and same-symbol isolation — IMPLEMENTED.** [PR #1062](https://github.com/45s/coinzilla/pull/1062) merged default-ignore/manual-order isolation and explicit per-pair block opt-in; [PR #1069](https://github.com/45s/coinzilla/pull/1069) centralizes policy identifiers and composes named configuration modules. [PR #1138](https://github.com/45s/coinzilla/pull/1138) completed issue [#1102](https://github.com/45s/coinzilla/issues/1102): newly observed external orders under `externalOrdersPolicy: "block"` install a provisional symbol guard and trigger a fresh account-wide open-order snapshot; the guard is replaced or cleared only after the snapshot crosses the durable Journal barrier. External orders remain unowned and untouched, and unrelated markets retain user-data readiness. Unmatched Harvester-generated `h-` orders remain fail-closed under the current ownership policy. Process-restart restoration and the F-041 recovery SELL cycle-completion proof are deferred to lowest-priority [#654](https://github.com/45s/coinzilla/issues/654); they are not Phase 4 dependencies. See the [Harvester roadmap](apps/harvester/ROADMAP.md).

- **Harvester high-volatility protection (#1016) — IMPLEMENTED; HISTORICAL CALIBRATION OPEN.** Brokers candle history/live Kline support ([PR #1017](https://github.com/45s/coinzilla/pull/1017)), the Indicators ATR/NATR/ratio package ([PR #1018](https://github.com/45s/coinzilla/pull/1018)), Harvester's BrokerPort/adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)), candle-history lifecycle ([PR #1037](https://github.com/45s/coinzilla/pull/1037)) and the per-market protection state machine, central order gate, owned-BUY cancellation and recovery-SELL exception ([PR #1041](https://github.com/45s/coinzilla/pull/1041)) are merged. The candle-stream freshness correction was merged in [PR #1049](https://github.com/45s/coinzilla/pull/1049). The seven required workflows passed on PR #1041's exact head. The local-only historical calibration analyzer was merged in [PR #1046](https://github.com/45s/coinzilla/pull/1046) at `6d103fb044939f9bab9cde766a548957f3948f4e`; exact-head CI/merge are complete. Actual representative multi-symbol data analysis and threshold acceptance remain open. No unattended production or exchange operations are authorized by this engineering work. See [Harvester Volatility Protection](apps/harvester/docs/volatility-protection.md) and the owner roadmaps.

- **Conservative shutdown priority ([#1186](https://github.com/45s/coinzilla/issues/1186)) — P0 implementation merged; acceptance audit remains open.** PR #1190 implements the owner-approved BUY-first, owned-order-only, reconcile-before-teardown contract and was merged as `a6269c07c62097093f9b7bc5897a62b86490a69e`. The post-merge audit identified a market-task drain-result gap: fulfilled callbacks returning `{ ok: false }` could be treated as successful. Corrective implementation merged in [PR #1326](https://github.com/45s/coinzilla/pull/1326). Keep #1186 open for the remaining acceptance criteria and end-to-end evidence; the merge alone does not establish operational acceptance. See the [canonical specification](apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md#10-conservative-graceful-shutdown--protect-trading-before-stopping-services) and [Harvester roadmap](apps/harvester/ROADMAP.md).

## IMPORTANT — active product and shared-package work

3. **Consolidated Harvester trading-session statistics (C).**
   - **Why:** operators need a trustworthy post-session accounting summary, not a reconstruction from logs and snapshots.
   - **Remaining:** build a read-only CLI report from confirmed, deduplicated fills and existing Portfolio/RecoveryLedger facts: BUY/SELL totals, commissions by asset, invested quote, recovered net proceeds, outstanding recovery, realized net profit, retained inventory/dust and open/partial orders.
   - **Owner:** [Harvester roadmap](apps/harvester/ROADMAP.md).

4. **Harvester Conservative architecture decomposition and documentation reconciliation (P3 — H7/H8) — COMPLETE, merged in [PR #1075](https://github.com/45s/coinzilla/pull/1075); completed; [issue #1073](https://github.com/45s/coinzilla/issues/1073) was closed after merge.**
   - **Delivered:** cohesive workflows now own read-only owned-order snapshot collection, per-market volatility-protection coordination, normalized user-data/order-event handling and terminal fill reconciliation. The engine remains the single serialized composition boundary and retains strategy evaluation/commitment allocation, execution totals/recovery markers, owned-order cancellation/replacement and the central submission gate.
   - **Outcome:** the engine was reduced from 3,335 lines at the verified pre-P3 baseline to 2,266 lines. Further extraction is not required solely to reduce line count; any future decomposition must establish a clearer ownership boundary without weakening serialized ordering, durability, accounting or broker identity.
   - **H8 documentation:** runtime composition, account-snapshot scope and audit phases, Journal operations, Trading First, TESTNET runbook and affected indexes were reconciled against source; historical evidence was preserved.
   - **Verification:** exact PR head `f8add4c783ae58e3d5808cfbbd438e76139e5f6a` passed all six required workflows; 1,440 Harvester tests passed and coverage measured 83.59% lines, 81.21% branches and 80.12% functions. Optional read-only TESTNET integration was skipped; no exchange operations were performed.

5. **Broker protocol and multi-market TESTNET acceptance.**
   - **Why:** offline fakes cannot prove endpoint compatibility, account reads, recovery acknowledgement, shared-asset reservations or real exchange filter behavior.
   - **Remaining:** complete the read-only protocol/recovery matrix in an eligible authorized environment; separately authorize any bounded order-mutation test. Keep all mutation flags disabled by default.
   - **Blockers:** current hosted Spot TESTNET regional eligibility restriction; acceptance is not established. The Harvester runbook's last documented two-pair DOGEUSDT/ZROUSDT scope omits two currently enabled TESTNET markets (LINKUSDT and ADAUSDT); the committed CG map also has three enabled LIVE markets (LINKFDUSD, ZROFDUSD and WLDFDUSD). No replacement session scope is recorded. Keep execution paused until an eligible environment and an explicitly reconciled pair scope exist (see [Harvester roadmap](apps/harvester/ROADMAP.md) and [TESTNET runbook](apps/harvester/docs/TESTNET_VALIDATION_RUNBOOK.md)).
   - **Owners:** [Brokers roadmap](packages/brokers/ROADMAP.md) and [Harvester roadmap](apps/harvester/ROADMAP.md).

6. **Repository documentation governance and quality (#795) — foundation complete; remaining finite work split into focused issues.**
   - **Why:** keep maintained documentation accurate against executable truth, discoverable, consistently styled, and safe to migrate without losing historical evidence.
   - **Completed foundation:** canonical governance, ownership and agent preflight; repository/domain indexes; recursive local-path checks; balanced-fence validation; full-tree maintained Markdown style and maintained-source local-anchor enforcement (PR #1434); report-only historical baselines; changed-maintained-file style enforcement; external-link checker with DNS/SSRF protections; initial 97-file baseline/disposition and subsequent complete recursive inventory. Source-verified documentation corrections and migrations are recorded in the linked PR history in [#795](https://github.com/45s/coinzilla/issues/795).
   - **Last complete recursive inventory:** 179 tracked Markdown/MDX files at `0f827ba7551be61a1be58f8dced191fb0a090870` (94 Harvester, 85 elsewhere; complete recursive tree). The current path policy classifies 150 maintained paths and 29 historical evidence paths.
   - **Completed enforcement work:** full-tree maintained Markdown style and maintained-source local-anchor enforcement for [#1402](https://github.com/45s/coinzilla/issues/1402) are implemented in [PR #1434](https://github.com/45s/coinzilla/pull/1434). The current 179-file inventory is classified into 150 maintained and 29 historical paths; historical evidence remains preserved.
   - **Remaining finite work:** maintained-document factual/source audit [#1401](https://github.com/45s/coinzilla/issues/1401) and inbound/outbound reference tracing with evidence-preserving consolidation [#1403](https://github.com/45s/coinzilla/issues/1403). These are the remaining explicit child workstreams of #795.
   - **Permanent maintenance:** documentation impact notes, factual freshness sweeps, source-of-truth ownership, historical evidence preservation, and roadmap/index synchronization remain mandatory for every meaningful PR under [Documentation Governance](docs/DOCUMENTATION_GOVERNANCE.md) and [Engineering Standards](ENGINEERING_STANDARDS.md#documentation-impact); they are not one-time checklist items.
   - **Owner:** repository engineering, coordinating domain owners; [Documentation Governance](docs/DOCUMENTATION_GOVERNANCE.md).

   **Separate engineering standards and architecture governance — [#1568](https://github.com/45s/coinzilla/issues/1568).** S-0 matrix [PR #1570](https://github.com/45s/coinzilla/pull/1570), S-1 architecture/dependency boundaries [PR #1574](https://github.com/45s/coinzilla/pull/1574), S-2 testing standard [PR #1575](https://github.com/45s/coinzilla/pull/1575), S-2 CI/test-settings [PR #1578](https://github.com/45s/coinzilla/pull/1578), S-3 configuration [PR #1576](https://github.com/45s/coinzilla/pull/1576), and S-4 error handling [PR #1579](https://github.com/45s/coinzilla/pull/1579) are merged. S-1's broad internal-layer source-import checker remains deferred; S-9 adds the narrow package-root/declared-export import guard in merged PR #1624, while semantic layer direction remains package-owned. S-4 merged at `659493ca23792e1ac339de7102e3cebb4d377cba`; it adds failure classification, retry ownership, unknown-outcome reconciliation and fail-closed guidance. **S-5 logging and observability** merged in [PR #1581](https://github.com/45s/coinzilla/pull/1581) at `3ff076f62e9930789efa6ec224dd32e4020efd8a`; it adds the canonical logging standard and fixes the shared Logger's raw transport-error fallback disclosure with test-first regression coverage. **S-6 AI-agent workflow reconciliation** merged in [PR #1584](https://github.com/45s/coinzilla/pull/1584) at `a935533e34dd55a42c3b4ceee4633d10d969eff0`; its changed-helper naming CI follow-up [PR #1587](https://github.com/45s/coinzilla/pull/1587) merged at `8c95537a766c65ef050fbe272c671b2050f137cb`. **S-7 file-tree, module responsibility and naming — MERGED.** [PR #1593](https://github.com/45s/coinzilla/pull/1593) merged on 2026-11-20 at `1574ed5c755ee9e7e47c9acbab2610d178cb4e29`; the consolidated source naming remediation [PR #1599](https://github.com/45s/coinzilla/pull/1599) and repository-wide module filename policy [PR #1605](https://github.com/45s/coinzilla/pull/1605) (merge commit `c6a16b0eca8a2d2700cb3924b56c859a0849cec2`) are also merged. **S-8 templates and practical examples — COMPLETE** under this issue. The first two increments add optional pure-module/direct-test and domain-policy/decision-matrix templates grounded in the Utilities percentage and Brokers user-data recovery implementations; the stateful lifecycle template is now also grounded in the DB lifecycle aggregate and its transition tests. The application-handler template is now also grounded in the DB provider-neutral composition use case and its interaction tests. The infrastructure-adapter template is now also grounded in the DB provider port, SQLite implementation and reusable conformance tests. Configuration is covered by the canonical Configuration Standard and does not need a duplicate template. Harvester strategy onboarding remains deferred until its own source-audit S-1 and contract-design S-2 prerequisites are complete. No new architecture checker is added in S-8; S-9 owns enforcement and should coordinate with existing checks to avoid duplication. Scope includes all applications and packages, including Harvester. No runtime or trading behavior and no exchange operations are part of S-8.

   **Pure-helper policy and AI standards discovery guidance — implemented in merged [PR #1569](https://github.com/45s/coinzilla/pull/1569), tracked by [#1565](https://github.com/45s/coinzilla/issues/1565).** The canonical [AI Task Compliance Standard](docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md) is linked from root AGENTS, the AI workflow, task workflows, the engineering docs index and PR template. `pnpm run check:helper-policy` recursively checks helper discovery, heuristic purity rules and directly colocated unit tests in the quality workflow. All seven PR-triggered workflows passed on exact head `89b0551333d95e18262333df26470f3828fae080`. The scanner is a guardrail, not proof of purity; manual source/dependency review remains tracked by #1565.
7. **Shared utility reuse inventory and logging guard.**
   - **Why:** duplicated generic helpers can drift, and routine direct-console diagnostics bypass the shared structured Logger contract. The build-provenance/Logger context capability and Harvester consumer rollout are already complete in PRs #767/#770; issue #763 is closed.
   - **S-5 logging/observability — MERGED:** [PR #1581](https://github.com/45s/coinzilla/pull/1581) merged at `3ff076f62e9930789efa6ec224dd32e4020efd8a`. The shared Logger's emergency transport-error fallbacks no longer expose raw Error messages/stacks; the canonical [Logging and Observability Standard](docs/engineering/LOGGING_OBSERVABILITY_STANDARD.md) defines severity, process context versus event correlation, operational versus diagnostic records, redaction limits and transport ownership. The separate fatal `process.stderr.write` audit remains open.
   - **Remaining:** complete candidate-by-candidate reuse/domain-local/intentional-duplication dispositions; finish the fatal `process.stderr.write` audit; continue verifying the exact CLI/fatal-diagnostic allowlist; and complete consumer migration/dependency-direction requirements. The production-source no-console guard merged in [PR #942](https://github.com/45s/coinzilla/pull/942) and is enforced by the required agent-policy workflow. The Harvester TESTNET sell helper decimal duplication was removed in merged [PR #946](https://github.com/45s/coinzilla/pull/946); exchange filter selection and min/max policy remain local. Avoid speculative utility APIs.
   - **Owner:** [Utils roadmap](packages/utils/ROADMAP.md).
   - **Validation modernization — complete (PRs #1505, #1509, #1512):** PRs #1505 and #1509 delivered the public `ensure` API, optional `errMsg`, and removed `Validator`/`VR`. PR #1512 corrected the Entities migration by using shared `ensure` for generic Coin/Order validation while keeping domain invariants local and preserving existing domain error contracts. See the [Utils roadmap](packages/utils/ROADMAP.md) and [Entities roadmap](packages/entities/ROADMAP.md).

8. **Entities package-owned quality and dependency boundaries.**
   - **Why:** workspace-wide coverage can hide weak package contracts, especially for exact financial values and unknown/incomplete states.
   - **Remaining:** close the scoped coverage and negative architecture/contract gaps recorded by the package owner.
   - **Owner:** [Entities roadmap](packages/entities/ROADMAP.md).

9. **Provider-neutral database CRUD infrastructure and Harvester filled-order history — generic core complete; consumer migration remains phased.**
   - **Database infrastructure delivered:** [PR #1353](https://github.com/45s/coinzilla/pull/1353) merged the provider-neutral CRUD/query, lifecycle and transaction contract, built-in SQLite provider, and reusable conformance suite. [PR #1364](https://github.com/45s/coinzilla/pull/1364) merged CREATE snapshot consistency; [PR #1365](https://github.com/45s/coinzilla/pull/1365) merged synchronous transaction rollback isolation; [PR #1382](https://github.com/45s/coinzilla/pull/1382) added native online backup and no-overwrite restore primitives; [PR #1396](https://github.com/45s/coinzilla/pull/1396) completed the SQLite reliability audit/hardening. Package-specific DB ESLint cleanup is complete.
   - **Current Harvester consumer — COMPLETE:** [PR #1469](https://github.com/45s/coinzilla/pull/1469) merged into `develop` as `39f098000d6c20cb596a9e6700250faa00bbd80e` (exact validated PR head `6d11d883e2d8250c2b3fab9f6d5a40d6178996bb`). It replaces the previously merged trading-session-ID projection from [PR #1369](https://github.com/45s/coinzilla/pull/1369) with best-effort filled-order history. The earlier session/process-ID persistence and temporary process-ID smoke-test write are removed as explicitly requested. Orders are keyed by environment, provider instance/type, account and client order ID; only orders with positive cumulative executed quantity are stored. The projection is non-authoritative and does not replace Journal or Harvester ADR-0001.
   - **Ownership:** `packages/db` owns generic provider-neutral infrastructure and provider adapters only. Harvester owns business schemas, repositories, mappings, persistence policy and application lifecycle. No Harvester-specific repository/model belongs in the DB package.
   - **Current consumer work — PHASES 1–3 COMPLETE:** Harvester relational orders/fills and live applied-fill persistence are complete in merged [PR #1555](https://github.com/45s/coinzilla/pull/1555), tracked by closed [#1554](https://github.com/45s/coinzilla/issues/1554), following generic SQLite migration hardening in [PR #1489](https://github.com/45s/coinzilla/pull/1489). Binance startup order/trade-history synchronization is complete in merged [PR #1557](https://github.com/45s/coinzilla/pull/1557), merge commit `c2b0eba34ea2778be8d70212fd5e2e3144067aa5`, tracked by [#1556](https://github.com/45s/coinzilla/issues/1556). Its required backwards-compatible read-only order-pagination contract is delivered by merged Brokers [#1558](https://github.com/45s/coinzilla/issues/1558) / [PR #1559](https://github.com/45s/coinzilla/pull/1559), merge commit `b06f034daecbd2b6dee9ad68b8426ca3bab106cb`: exact-order lookup remains the default and Harvester opts into inclusive lower-bound pages. Coverage is limited to configured execution markets and exchange-available history; it does not certify delisted/unconfigured markets or provider retention. Startup history remains observational: orders are not adopted and no restart restoration is enabled. Routine relational-history backups, restore verification, bounded retention and backup-file permissions are complete in merged Harvester [#1564](https://github.com/45s/coinzilla/issues/1564) / [PR #1567](https://github.com/45s/coinzilla/pull/1567), merge commit `5f1d4a035941db8a7e0d6cd3c401299ab3c6ef21`. Host scheduling remains operator-owned; off-host replication and disk/WAL monitoring remain deferred. Do not duplicate Journal or restore process/session-ID smoke-test persistence. The [SQLite integration blueprint](apps/harvester/docs/persistence/sqlite-integration-blueprint.md) is a historical design/audit snapshot; current behavior is documented in the [Harvester persistence README](apps/harvester/docs/persistence/README.md). Operational State Store migration remains separately gated by [#654](https://github.com/45s/coinzilla/issues/654); no recovery cutover is authorized by #1327.
   - **Owner/status:** [Database roadmap](packages/db/ROADMAP.md) tracks generic infrastructure; [Harvester roadmap](apps/harvester/ROADMAP.md) tracks consumer integration. The [Harvester trading-history roadmap](apps/harvester/docs/persistence/trading-history-roadmap.md) tracks follow-on attribution, analytics and remaining operations. Implementation issue [#1340](https://github.com/45s/coinzilla/issues/1340) and SQLite audit issue [#1395](https://github.com/45s/coinzilla/issues/1395) are closed after their merged PRs.
10. **Structured, package-owned errors with a shared `SystemCustomError` base ([#1028](https://github.com/45s/coinzilla/issues/1028)) — IN PROGRESS; the Utilities-owned base is implemented in merged [PR #1262](https://github.com/45s/coinzilla/pull/1262); gradual adoption remains with consuming domains.**
    - **Why:** generic errors and inconsistent wrapping make it difficult to identify the failing component/operation and preserve the underlying cause.
    - **Standard:** one shared `SystemCustomError` base; specific subclasses and stable domain-scoped codes owned by the package/application/feature that owns the failure. Preserve native `cause` and attach bounded, safe diagnostic context; classify retryability only where meaningful.
    - **Plan:** (1) audit existing errors, consumers and dependency directions; select one shared base owner; (2) implement and test the minimal base contract; (3) add package-owned error types/codes at high-value boundaries; (4) adopt them in new features and bug fixes as relevant paths are touched; (5) standardize safe structured reporting; (6) add compatibility/regression tests and update affected local docs/AGENTS/roadmaps.
    - **Adoption:** new functionality follows the standard immediately; bug fixes migrate the touched error path where relevant and safe. Migrate untouched legacy code only through focused tasks with a concrete diagnostic benefit.
    - **Safety:** no duplicate base implementations, dependency cycles, message-based classification, blanket native-Error conversion or one-shot rewrite. Do not let logging/reporting failures mask the original failure.
    - **Canonical guidance:** [Structured Error Handling Standard](docs/engineering/structured-error-handling.md).
    - **S-4 policy extension — MERGED:** [PR #1579](https://github.com/45s/coinzilla/pull/1579) adds failure classification, retry ownership, unknown-outcome reconciliation and fail-closed guidance; merged into `develop` at `659493ca23792e1ac339de7102e3cebb4d377cba`.
    - **Owner:** [Utils roadmap](packages/utils/ROADMAP.md) for the shared base; each consuming domain owns its subclasses and gradual migrations.

11. **Workspace JavaScript linting — COMPLETE.** The full workspace has zero ESLint errors and warnings, and changed JavaScript files receive an additional strict policy on PRs targeting `develop`. Delivered through [PR #1288](https://github.com/45s/coinzilla/pull/1288) (zero-warning full-workspace gate), [PR #1311](https://github.com/45s/coinzilla/pull/1311) (evidence-based rule hardening), [PR #1322](https://github.com/45s/coinzilla/pull/1322) (function-quality policy), [PR #1346](https://github.com/45s/coinzilla/pull/1346) (progressive strict changed-file enforcement), and [PR #1352](https://github.com/45s/coinzilla/pull/1352) (roadmap closeout). No repository-wide or package-specific ESLint cleanup remains outstanding; fix any future finding in the PR that introduces it.

    - The canonical configuration remains `eslint.config.js`; `pnpm lint` runs `eslint . --max-warnings 0` and is enforced inside the required `Check JavaScript syntax` status context.
    - The changed-file runner inherits the canonical configuration and overlays the approved strict thresholds for every added, modified, copied, or renamed `.js`, `.mjs`, and `.cjs` file in PRs targeting `develop`: complexity 15, max-params 1, max-lines-per-function 60 (error), max-statements 30 (error), max-depth 3, and max-nested-callbacks 2. It lints the complete destination file, not changed lines; deleted files are excluded. Untouched legacy files retain workspace thresholds.
    - Both workspace lint and the independent changed-file job are aggregated by the existing required `Check JavaScript syntax` context. This intentionally preserves the existing required-context set; there is no separate standalone required `ESLint` context.
    - The function-quality decisions remain evidence-based: workspace complexity stays at 20; `max-lines-per-function` remains a warning at 80; `max-statements` remains a warning at 50; `max-depth` is an error at 4. Do not revive old candidate-threshold counts as outstanding cleanup.
    - The separate async lifecycle race audit remains tracked by [issue #1313](https://github.com/45s/coinzilla/issues/1313); it is not an ESLint cleanup task.
    - **Owner:** shared infrastructure.

### Cross-workspace Binance environment contract — PR #841 merged; LIVE mode is enabled; exchange acceptance remains unverified

- **Decision:** Binance endpoint selection uses only explicit `TRADING_MODE=testnet|live`; `NODE_ENV` must never influence exchange routing. Missing/invalid mode fails closed. See [ADR-0002](docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md).
- **Why:** Harvester and the shared Brokers package must never disagree about which exchange environment receives requests.
- **Completed:** all broker consumers, Harvester adapter/startup, offline replay harnesses, and test fixtures pass the explicit mode. Exact-head offline CI is green on PR #841 head `10587c19fb0475a109bff331608b5c35ddb039d5`: workspace unit tests, workspace coverage, Harvester targeted tests, process-lock tests on Ubuntu/Windows, JavaScript syntax/agent policy, actionlint, Utils tests, and production dependency audit.
- **Merged:** PR #841 merged on 2026-11-09 at `ec13d3b30b901b809cb20839b02da2f25b161c97`; all required CI workflows passed on exact head `eb3d55557fb5af5155bf487eb7284fe0f5e7126c`. `TRADING_MODE=live` explicitly selects Binance LIVE and enables real order execution; this is a runtime capability, not a claim that production deployment or live trading was performed during the PR. The read-only Binance TESTNET integration was skipped, so exchange protocol acceptance remains unverified. This does not close Harvester restart-reconciliation issue #654.
- **Owners:** [Brokers](packages/brokers/ROADMAP.md) and [Harvester](apps/harvester/ROADMAP.md).

## DEFERRED — evidence or consumer required

- **Event Bus advanced delivery features:** sequential delivery, retries, dead-letter handling and cooperative cancellation remain demand-driven; preserve the existing bounded delivery and shutdown contract. [Owner roadmap](packages/event-bus/ROADMAP.md).
- **Additional notification transports/retries/outbox:** require a concrete consumer and explicit duplicate-delivery/storage ownership. The live Telegram smoke test remains operator-controlled. [Owner roadmap](packages/notifiers/ROADMAP.md).
- **Additional database providers:** reassess only when measured deployment, concurrency, scale or query requirements exceed SQLite.

## Recently completed — do not reopen without new evidence

- **Harvester process-lifetime operator control:** the engine/application/Telegram adapter foundation merged in [PR #1045](https://github.com/45s/coinzilla/pull/1045), process-lifetime scope/docs in [PR #1065](https://github.com/45s/coinzilla/pull/1065), and runtime/config/lifecycle integration in [PR #1067](https://github.com/45s/coinzilla/pull/1067). The Command Center's commands, read-only queries, inline controls, persistent keyboard, emergency BUY controls and correlated interaction diagnostics are complete in PRs #1079, #1081, #1086, #1088, #1194, #1267 and #1215. Operator pauses remain process-lifetime only. Tracking issues #1066, #1201 and #1214 are closed. Outbound notification delivery is tracked separately under #1103.
- **Conservative trailing-BUY replacement safety:** PRs [#751](https://github.com/45s/coinzilla/pull/751) and [#753](https://github.com/45s/coinzilla/pull/753) merged. Candidate validation and refreshed exchange filters now precede cancellation; uncertain outcomes pause for reconciliation. See the [Harvester roadmap](apps/harvester/ROADMAP.md).
- **Journal persistence and lifecycle boundary (J-1 through J-6):** record contract, filesystem adapter, lifecycle ownership, cleanup/order hardening, recursive lossless JSONL validation and durability failure propagation are complete in the Journal package. PR [#920](https://github.com/45s/coinzilla/pull/920) implemented the Journal-owned boundary; Harvester DTO compatibility and mapper-failure diagnostics merged in [PR #925](https://github.com/45s/coinzilla/pull/925), closing issue [#923](https://github.com/45s/coinzilla/issues/923). Issue [#889](https://github.com/45s/coinzilla/issues/889) is closed after PR #934 reconciled the Journal README and roadmap. Do not treat EventBus delivery success as Journal durability acknowledgement. See the [Journal roadmap](packages/journal/ROADMAP.md).
- **Harvester process provenance:** PR #770 merged; the process-start Journal event and Logger correlation are implemented. The shared Utils build-provenance capability remains separately tracked by the Utils roadmap.
- **Harvester per-process log layout and Journal filename compatibility:** PRs [#874](https://github.com/45s/coinzilla/pull/874) and [#880](https://github.com/45s/coinzilla/pull/880) merged. New process logs and Journal JSONL sessions share `logs/sessions/<UTC timestamp>-<runtime session ID>/`; append-only diagnostic histories live under `logs/cumulative/`, and Harvester process locks live outside logs under `~/.coinzilla/harvester/process-locks/`. Legacy flat Journal sessions remain readable; no Journal record schema or trading behavior changed. See [Harvester logging](apps/harvester/docs/LOGGING.md) and [Journal operations](apps/harvester/docs/JOURNAL_OPERATIONS.md).

## Roadmap ownership map

- [Harvester](apps/harvester/ROADMAP.md) — trading safety, recovery, restart reconciliation and session statistics.
- [Dashboard](apps/dashboard/ROADMAP.md) — Angular web-client foundation and future operational UI; initial scaffold tracked in [#1623](https://github.com/45s/coinzilla/issues/1623).
- [Brokers](packages/brokers/ROADMAP.md) — native WebSocket protocol, user-data lifecycle and exchange acceptance.
- [Entities](packages/entities/ROADMAP.md) — exact financial contracts and package-owned quality.
- [Journal](packages/journal/ROADMAP.md) — record contract, persistence lifecycle and durability.
- [Database](packages/db/ROADMAP.md) — embedded provider-neutral persistence infrastructure; first Harvester session-history consumer merged in PR #1369.
- [Event Bus](packages/event-bus/ROADMAP.md) — bounded delivery and lifecycle guarantees.
- [Notifiers](packages/notifiers/ROADMAP.md) — optional operational notifications.
- [Utils](packages/utils/ROADMAP.md) — shared exact arithmetic, Logger and generic helpers.

## Delivery and documentation synchronization rules

1. Work one meaningful behavior at a time; for behavior changes use RED → GREEN → REFACTOR.
2. Read repository and owning-domain instructions, roadmaps, contracts, implementation, consumers and tests before editing.
3. Keep implementation in its owning bounded context and preserve financial/recovery safety invariants.
4. Update every affected living document in the same PR. When an owner-roadmap status, priority or blocker changes, check this root roadmap and synchronize its cross-workspace summary if that item is represented here.
5. Keep the root roadmap concise: link to domain roadmaps rather than copying their detailed plans. Do not mark work complete before merge and required verification.
6. Preserve historical reports and provenance. Correct stale historical conclusions with a dated addendum or link to the current living source; never silently rewrite evidence.
7. Run focused checks, repository agent-policy/link checks and applicable CI on the exact PR head. A skipped integration check is not a pass.
8. Keep task branches short-lived and delete them after merge when repository permissions allow. Never bypass branch protection or release approval.

**Intended end state:** Bitunix is to become a complete broker and Harvester provider integration, not a temporary partial provider facade. The current Spot implementation is incomplete; order lifecycle, execution identity/quantity, fill completeness, account freshness, market constraints, private-event/recovery and environment-safety requirements in [issue #1185](https://github.com/45s/coinzilla/issues/1185) must be resolved with authoritative evidence and tests before it is registered for Harvester execution. [Issue #1426](https://github.com/45s/coinzilla/issues/1426) and [PR #1427](https://github.com/45s/coinzilla/pull/1427) add an explicitly invoked, REST/Spot WebSocket RPC diagnostic runner; [PR #1439](https://github.com/45s/coinzilla/pull/1439) adds credential-free public REST diagnostics, documented market-data reads and a current-open-orders query, with authenticated checks skipped when credentials are absent, plus the authenticated WebSocket ping and one controlled reconnect probe. The one-command local publisher, merged in [PR #1484](https://github.com/45s/coinzilla/pull/1484) at `ee821a7f2d013879a430ccdaa80f3f59df0cca9c`, adds the unified `pnpm --filter @coinzilla/brokers bitunix:healthcheck` entry point: it reads credentials from the root `.env.development`, runs the same read-only checks, pushes only a strict-allowlist sanitized report on a timestamped report branch, and returns the local checkout to `develop`.  The read-only diagnostic tools and publisher do not change Harvester routing or enable order mutations. The fixed HYPEUSDT one-shot local LIVE operator attempt from [#1608](https://github.com/45s/coinzilla/issues/1608) / [PR #1609](https://github.com/45s/coinzilla/pull/1609) is consolidated under the single `scripts/bitunix/run-healthcheck.js` entry point by [follow-up #1614](https://github.com/45s/coinzilla/issues/1614) / [PR #1616](https://github.com/45s/coinzilla/pull/1616). `--place-order` remains human-only: it runs read-only health checks first, skips the order if they are unhealthy, and otherwise executes the existing guarded one-shot attempt inside the same sanitized report-branch workflow, pushes the allowlisted outcome and returns the local checkout to `develop`. Tests, CI, AI agents, scheduled jobs and Harvester must never invoke it. It does not change the default mutation gate, Harvester routing, or the production-readiness blockers in #1185; see the [operator instructions](packages/brokers/README.md#one-shot-bitunix-hypeusdt-operator-order-attempt). PR [#1545](https://github.com/45s/coinzilla/pull/1545) extends the same read-only runner with authenticated one-record deposit and withdrawal history probes; reports retain schema structure only, not private record values. See the [Brokers roadmap](packages/brokers/ROADMAP.md) and [diagnostic instructions](packages/brokers/README.md#bitunix-spot-local-diagnostics).

## Bitunix Spot broker development

Bitunix Spot exposes partial query operations and a limited, explicitly gated legacy order-placement/cancellation surface; canonical order identity, complete execution history and account/event guarantees required for trading remain incomplete; the remaining exchange-contract blockers are tracked in [issue #1185](https://github.com/45s/coinzilla/issues/1185) and the [Brokers roadmap](packages/brokers/ROADMAP.md). Its REST boundary now preserves transport/parse causes, distinguishes transport, HTTP, exchange, and malformed-response failures, and validates the documented success envelope ([PR #1315](https://github.com/45s/coinzilla/pull/1315), merged as `47250f3ec97cff141f939abe9683a975698840a6`); merged [PR #1548](https://github.com/45s/coinzilla/pull/1548) as `3321880f2eb5358341cde4a1f2451efd5ed0a07e` aligns the REST error's `outcomeUnknown` flag with the common Broker contract for dispatched HTTP 408, 409, and 5xx mutation responses, without enabling retries or changing read-only behavior; merged [PR #1550](https://github.com/45s/coinzilla/pull/1550) as `1f2a4a6c58d843ce7be11b8503635d582cea1b21` corrects Bitunix Spot LIMIT base-volume / MARKET quote-volume sizing and adds the cross-provider `quoteQuantity` mapping to Binance `quoteOrderQty` (817 Brokers tests passed; all required CI checks passed); unknown Spot error codes remain opaque pending authoritative documentation. Order adapters also require non-empty string `ctime` and `utime` values while preserving the exchange strings unchanged ([PR #1318](https://github.com/45s/coinzilla/pull/1318), merged as `dbf4bbe9af46e300e7ac4369e941299e2fed54ad`); unknown non-empty Bitunix order status codes are now retained as exchangeStatus and normalized to UNKNOWN ([PR #1375](https://github.com/45s/coinzilla/pull/1375), merged as `7a2d95caa7a78a8656d339d5d83c830ad74a605b`); this does not resolve fill semantics or make the broker Harvester-ready. Future Bitunix Spot implementation tasks must follow the mandatory reference-first audit in [Brokers AGENTS.md](packages/brokers/AGENTS.md#bitunix-spot-development--mandatory-reference-audit): inspect [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net) as the primary C# Spot implementation and its tests, cross-check [bitunix-mcp](https://github.com/samanzamani/bitunix-mcp) for TypeScript examples, then verify against official Bitunix documentation. Reimplement the audited behavior in Coinzilla's JavaScript architecture; do not copy unverified assumptions or enable mutations while issue #1185 guarantees remain unresolved. The expanded [external implementation reference audit](packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md) records additional C#, Python and Ruby references, known third-party defects, the full Binance method parity inventory, and remaining Bitunix-only query extension candidates. Search wider GitHub implementations when the primary .NET/TypeScript references are incomplete or disagree; official Spot documentation remains authoritative. The public depth/K-line query expansion is merged in [PR #1324](https://github.com/45s/coinzilla/pull/1324). The separate Bitunix-only exchange-rate extension for [issue #1331](https://github.com/45s/coinzilla/issues/1331) is merged in [PR #1370](https://github.com/45s/coinzilla/pull/1370) as `55694b837c869878d22346dfd6b0f12c9b0f3269`; it does not add Binance parity or relax the #1185 mutation/lifecycle blockers. Token/network metadata is exposed through the Spot WebSocket RPC client. The deposit-history query extension is implemented in [PR #1385](https://github.com/45s/coinzilla/pull/1385) as a Bitunix-specific capability, not Binance parity. Withdrawal and internal-transfer-out history queries is implemented in [PR #1387](https://github.com/45s/coinzilla/pull/1387) as a Bitunix-specific capability. The raw per-order matching-detail read is merged as a Bitunix-only, signed extension in [PR #1389](https://github.com/45s/coinzilla/pull/1389) at `696a743d4285025083370a4ac495dd8a537edd01`; tracking issue [#1388](https://github.com/45s/coinzilla/issues/1388) is complete. It does not implement canonical fills or resolve issue #1185. Explicit coin/network deposit-address lookup is merged as a Bitunix-only signed extension in [PR #1399](https://github.com/45s/coinzilla/pull/1399) at `5c517f677232ea3aa2ec72053087307693f97919`; [issue #1398](https://github.com/45s/coinzilla/issues/1398) is complete. It does not generate addresses or move funds. Issue #1185's client-order identity/idempotency, fill-history quantity semantics/completeness, source-timestamped account freshness, continuous private events, TESTNET and unknown-outcome recovery blockers remain. Request-volume denomination is now documented and implemented; actual exchange execution remains unverified. The interim Harvester observer-only runtime surface from [#1422](https://github.com/45s/coinzilla/issues/1422) has been removed in [PR #1455](https://github.com/45s/coinzilla/pull/1455); Bitunix remains outside Harvester provider registration and routing until #1185 is complete.

## LOWEST PRIORITY — deferred process-restart recovery (#654)

- **Deferred; not a dependency for basic multi-provider functionality.** Keep the existing ADR-0001 facts, offline tools and fail-closed safety behavior intact. Do not implement process-restart restoration, Journal replay, crash recovery or unattended restart readiness as part of #1339 Phase 4. Resume #654 only after the basic in-process multi-account runtime is working and the user explicitly reprioritizes recovery. See [issue #654](https://github.com/45s/coinzilla/issues/654) and the [Harvester roadmap](apps/harvester/ROADMAP.md).

- **Harvester reliability initiative (#1639) — IN PROGRESS.** The original critical-behavior inventory and 39 module coverage floors across 15 behaviors were completed in merged [PR #1697](https://github.com/45s/coinzilla/pull/1697); the current inventory has 16 critical behaviors and 41 production-module coverage floors after the CLOSING audit addition; a exact-head coverage passed on [run #45012989393](https://github.com/45s/coinzilla/actions/runs/45012989393). Partial BUY/SELL runtime replay merged in [PR #1702](https://github.com/45s/coinzilla/pull/1702), and duplicate/out-of-order execution handling merged in [PR #1708](https://github.com/45s/coinzilla/pull/1708). User-data reconnect cleanup merged in [PR #1716](https://github.com/45s/coinzilla/pull/1716), closing [#1714](https://github.com/45s/coinzilla/issues/1714): failed replacement clients are disposed before retry, and no competing socket opens while cleanup remains unsuccessful. Current increment [#764](https://github.com/45s/coinzilla/issues/764) adds durable account-wide CLOSING open-order evidence alongside the CLOSING balance audit; failed, partial, or malformed reads are durably recorded as BLOCKED and make the paired balance audit INCOMPLETE. Next: broader cancellation-failure and shutdown durability paths with targeted failure coverage. Restart restoration remains disabled under #654; TESTNET remains CLOSED / PAUSED. No exchange writes or LIVE operation.

## Strategy-neutral production-flow Scenario Runner — issue #1836

Open Draft [PR #1837](https://github.com/45s/coinzilla/pull/1837) is the active implementation branch and is synchronized with current `develop` head `ef5f5e25b0994f244eb6b29b62f5d48235df4544` after the RS scenario suite and Conservative registry merged. Merged [PR #1852](https://github.com/45s/coinzilla/pull/1852) provides the authoritative **test-only** RS scenario registry and mapped records; merged [PR #1798](https://github.com/45s/coinzilla/pull/1798) provides the Conservative registry/runner and reports. Neither is a production runtime execution adapter.

PR #1837 has an initial same-revision replay path (full source SHA, original run relationship, original validated input and explicit blocked outcome on unknown/mismatched revision) and Node-level worker defense-in-depth/child-worker acceptance. The production RS adapter remains helper-only and preliminary; it does not execute the full RS use-case lifecycle. No trusted OS-level sandbox launcher is registered, and the Node guards are not an OS security boundary. In-memory history is accepted for this MVP and is not a blocker.

Keep PR #1837 Draft and unmerged until the real production RS adapter is composed from current production use cases, the merged registry is consumed without duplicating its test-only authority, the end-to-end simulation isolation path is proven, and exact-head CI passes. The adapter must not be composed around the independent terminal-SELL/STOP accounting defect tracked in [issue #1842](https://github.com/45s/coinzilla); that production contract must be fixed and regression-tested first. In-memory run history is accepted for this MVP; durable persistence is deferred. No real broker/exchange access, credentials, live account state or production persistence are authorized.

## Release readiness — develop to main

Open Draft [PR #1662](https://github.com/45s/coinzilla/pull/1662) promotes current `develop` (`b69b32ce438a56de84bb51eaa16cce87be253c95`) to `main` (`043943051582a8d7bceb5a3a2f642bd886470cc8`). The current comparison is 4,957 commits ahead / 1 behind (merge base `72aed890fbe50f05b9e6608e6e755e900898d0e7`). The PR body records 7 new high-severity CodeQL alerts on the earlier promotion head `1f55d5989e8122421f4d9e37693f68f32e0c29ed` (2026-11-25); that observation is specific to that commit and does not establish the alert count or CodeQL result on current `develop` head `b69b32ce438a56de84bb51eaa16cce87be253c95`. Recheck exact-head CodeQL and classify any current alerts before promotion. Issues [#1674](https://github.com/45s/coinzilla/issues/1674) and [#1765](https://github.com/45s/coinzilla/issues/1765) remain open. Keep the release Draft and do not bypass or suppress the security gate; reconcile the main/develop divergence before promotion.



---

## inventory

Archived source path: `docs/REPOSITORY_DOCUMENTATION_INVENTORY_HISTORY_2026-11-26.md`

# Repository documentation inventory

- Status: Initial recursive inventory complete; all 6 initial REVIEW candidates have evidence-based dispositions; current package/app entry-point audit is complete; source-level review and full-tree enforcement are tracked by [#1401](https://github.com/45s/coinzilla/issues/1401) and [#1402](https://github.com/45s/coinzilla/issues/1402); reference/consolidation work is tracked by [#1403](https://github.com/45s/coinzilla/issues/1403)
- Type: Repository documentation inventory
- Owner: Repository engineering
- Baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Date: 2026-11-09 (baseline); latest verification: 2026-11-18 (160-file checkpoint below)
- Tracking: [#795](https://github.com/45s/coinzilla/issues/795)
- Policy: [Documentation Governance](DOCUMENTATION_GOVERNANCE.md)
- Harvester detail: [Harvester documentation inventory](../apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md)

## Scope and method

A complete recursive Git tree was retrieved for the baseline commit (`truncated: false`). It contains **97 tracked Markdown files**:

- 42 under `apps/harvester/` — individually listed with initial dispositions in the Harvester inventory.
- 55 elsewhere — listed below (repository root policy/entry files, `docs/`, `.github/` and package documentation).

The table records path, byte size, category and a conservative first-pass disposition. It is not a claim that every statement in every file has been revalidated against source code. All KEEP files remain at their current paths; REVIEW files must not be moved or rewritten until content and inbound references are checked.

## Post-baseline additions — 110-file checkpoint

The 97-file inventory above is a frozen baseline at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`, not a live file count. A complete recursive tree comparison against `develop` at `ae5c61abbee8e48162989c470f690221bd9ec712` found **13 added Markdown/MDX files and no removed paths**. The current tree therefore contains **110 tracked Markdown/MDX files** at that checkpoint. The original 97-file baseline table remains unchanged; the additions are recorded separately:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/README.md` | Local index for Harvester architecture documentation. |
| `apps/harvester/docs/audits/README_HISTORY.md` | Preserved historical README material and its navigation. |
| `apps/harvester/docs/audits/ROADMAP_HISTORY.md` | Preserved historical Harvester roadmap material, provenance and compatibility anchors. |
| `apps/harvester/docs/domain/README.md` | Local index for Harvester domain documentation. |
| `apps/harvester/docs/incidents/README.md` | Local index for Harvester incident records. |
| `apps/harvester/docs/infrastructure/README.md` | Local index for Harvester infrastructure documentation. |
| `apps/harvester/docs/operations/README.md` | Local index for Harvester operating procedures; surfaces the current LINKFDUSD/ZROFDUSD config versus historical runbook scope mismatch, CLOSED / PAUSED status, and legacy ZROUSDT market-sell/account-wide-cancel write boundaries and the interactive menu wrapper, its audit links, and the no-confirmation account-wide cancel boundary. |
| `apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md` | Detailed file-by-file Harvester documentation inventory. |
| `apps/harvester/docs/plans/README.md` | Local index for Harvester plans and migration tracking. |
| `apps/harvester/docs/tasks/README.md` | Local index for Harvester task records. |
| `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md` | This repository-wide baseline and post-baseline inventory. |
| `docs/ai-agent/README.md` | Entry point for AI-agent policy and workflow references. |
| `packages/entities/README.md` | Entities package public-contract and development entry point. |

These files were added deliberately as indexes, historical evidence, inventories or package guidance. Their addition does not alter the original baseline dispositions above.

## Subsequent recursive tree checkpoints

The original 110-file checkpoint above remains a historical snapshot. Complete recursive tree comparisons found these later additions, with no removals:

| Develop checkpoint | Added Markdown/MDX path | Total files |
| --- | --- | ---: |
| `ec13d3b30b901b809cb20839b02da2f25b161c97` | `docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md` | 111 |
| `dd18f2280fdc885211e678bf8218f59c3362a2ea` | `docs/MARKDOWN_STYLE.md` (merged in [PR #853](https://github.com/45s/coinzilla/pull/853)) | 112 |
| `2bc9f6f2593e12626ff8c01358a2ea792b63b631` | `apps/harvester/docs/error-vocabulary.md` (added in [PR #866](https://github.com/45s/coinzilla/pull/866)); current develop checkpoint | 113 |
| `96065e86851aac1c99314d0aa7fb0b2f2a5ca19c` | Historical checkpoint after [PR #879](https://github.com/45s/coinzilla/pull/879); 113 tracked Markdown/MDX files | 113 |
| `97b6a503d3392a6aba019553de6698d267d4c81f` | Historical checkpoint after [PR #903](https://github.com/45s/coinzilla/pull/903); complete recursive tree comparison confirmed 113 tracked Markdown/MDX files | 113 |
| `9fd14d12408586467bb50127845b16f0d2600ca6` | Historical develop checkpoint after [PR #904](https://github.com/45s/coinzilla/pull/904); complete recursive tree comparison confirms 113 tracked Markdown/MDX files | 113 |
| `9a9653789880573f1f1c7ba39bc9e50b581fd733` | Historical develop checkpoint after [PR #910](https://github.com/45s/coinzilla/pull/910); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `9fd14d1` | 113 |
| `661c06412bd1548ef8fb92342522745efac804b3` | Historical checkpoint after [PR #911](https://github.com/45s/coinzilla/pull/911); complete recursive tree comparison confirms 113 tracked Markdown/MDX files | 113 |
| `40cb4c89b7d71d331e07957d6f53fa7177dfcdb0` | Historical checkpoint after [PR #912](https://github.com/45s/coinzilla/pull/912); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `661c064` | 113 |
| `dc17f1f2c1fa6e45c08035ae6ae736eb821b90a5` | Historical checkpoint after [PR #909](https://github.com/45s/coinzilla/pull/909); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `40cb4c8` | 113 |
| `6dc664fe48a635a0db757aec116c950e751ef30f` | Historical checkpoint after [PR #914](https://github.com/45s/coinzilla/pull/914); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `dc17f1f` | 113 |
| `631e82c4630f7b57d47fd6fd43adfdbb8656bd95` | Last source-verified develop checkpoint after [PR #915](https://github.com/45s/coinzilla/pull/915); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `6dc664f` | 113 |
| `c2742b8343c99dfdfab40078809ead189d668fa7` | Historical checkpoint after [PR #916](https://github.com/45s/coinzilla/pull/916); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `631e82c` | 113 |
| `467031c3101ca7e77ceb8e4e06f94aa7721cbefe` | Current source-verified develop checkpoint after [PR #918](https://github.com/45s/coinzilla/pull/918); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `c2742b` | 113 |
| `f4fd2ab8f2cd40b497aa3b931c12f0bb9513f015` | Current develop checkpoint after [PR #924](https://github.com/45s/coinzilla/pull/924); the only new path since the 113-file checkpoint is `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md`, created in [PR #917](https://github.com/45s/coinzilla/pull/917) | 114 |
| `31754f7f207ae42556f9c0032e8e5b25cddeb02d` | Current develop checkpoint after [PR #925](https://github.com/45s/coinzilla/pull/925); 114 tracked Markdown/MDX files remain unchanged from the prior checkpoint (zero path additions/removals) | 114 |
| `186ac3066ba515ead2eae8dbfcc4dc25d6e594bb` | Current develop checkpoint after [PR #934](https://github.com/45s/coinzilla/pull/934); 114 tracked Markdown/MDX files remain unchanged (zero path additions/removals) | 114 |
| `f98c4e02be5707c550bde5c63e223b0f160bb406` | Current develop checkpoint after [PR #938](https://github.com/45s/coinzilla/pull/938); 114 tracked Markdown/MDX files remain unchanged (zero path additions/removals) | 114 |
| `752f0a7a6f2f4acaa0be461980f4853220805f3b` | Current source-verified develop checkpoint after [PR #951](https://github.com/45s/coinzilla/pull/951); three new audit indexes and nine evidence-path relocations; 117 tracked Markdown/MDX files | 117 |
| `86f9c1d4d7a012e628dcd1b7b68b2354e4073045` | Current source-verified develop checkpoint after [PR #950](https://github.com/45s/coinzilla/pull/950); 117 tracked Markdown/MDX files remain unchanged after the audit archive relocation | 117 |
| `210648d62026bb212f9ed88b6d2257e2d1b3fc72` | Current source-verified develop checkpoint after [PR #964](https://github.com/45s/coinzilla/pull/964); complete recursive tree confirms 117 tracked Markdown/MDX paths with no additions/removals since PR #951 | 117 |
| `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d` | Historical source-verified develop checkpoint after [PR #968](https://github.com/45s/coinzilla/pull/968); complete recursive tree contained 117 tracked Markdown/MDX paths (57 Harvester, 60 elsewhere) | 117 |
| `515324a6b1cb872b99593bdf448d1914b005bfcb` | Current source-verified develop checkpoint after PR #1002; complete recursive tree contains 118 tracked Markdown/MDX paths (58 Harvester, 60 elsewhere), including the 2026-11-10 restart-recovery audit report | 118 |
| `bbd80b93cc0b8ab09172119c0d2d87617257a159` | Current source-verified develop checkpoint after merged PR #1003; complete recursive tree contains 119 tracked Markdown/MDX paths (59 Harvester, 60 elsewhere) | 119 |
| `e753f9f07a201802814f4019ec2222fc7df7d798` | Current source-verified develop checkpoint after merged PR #1017; complete recursive tree contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `452b19bbb13ee4bbe86df23c3d1da6f4566039d6` | Historical source-verified develop checkpoint after merged PR #1018; complete recursive tree still contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `b5fc236987833da4374258da876b412be3c48759` | Current source-verified develop checkpoint after merged PR #1012; complete recursive tree still contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `7590d332a307c7ef7bea37f0ba8721b399bd96e8` | Historical source-verified develop checkpoint before merged PR #1269; complete recursive tree contains 147 tracked Markdown/MDX paths (81 Harvester, 66 elsewhere) | 147 |
| `0a51d6034a6ff6473d9a9005b74744fd048c9135` | Historical source-verified develop checkpoint after merged PR #1269; no Markdown/MDX path additions or removals since `7590d33`; 147 tracked Markdown/MDX paths (81 Harvester, 66 elsewhere) | 147 |
| `37aa07ec4c6421bd6c8b10084d734dc4ad9ed47c` | Historical source-verified develop checkpoint after merged PRs #1267, #1353 and #1383; nine Markdown/MDX additions and no removals since `0a51d60`; 156 tracked paths (85 Harvester, 71 elsewhere) | 156 |
| `80f1fe6551e8f08ea791fc7860a1274825a924e5` | Historical source-verified develop checkpoint after merged PR #1397; complete recursive tree remained 156 Markdown/MDX paths (85 Harvester, 71 elsewhere), with zero path additions/removals since `37aa07e` | 156 |
| `8843bd1e42dea7b47a7af5c464b921e54dd16c0d` | Historical source-verified develop checkpoint after merged PR #1407; complete recursive tree remains 156 Markdown/MDX paths (85 Harvester, 71 elsewhere), with zero path additions/removals since `80f1fe` | 156 |
| `81669ce2be6794b9bd03067f89b57f8fdb55f957` | Historical source-verified develop checkpoint after merged PR #1396; complete recursive tree contains 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), one Harvester audit document added and zero removals since `8843bd1` | 157 |
| `c3337a5d7a716334e2751b83bcf121ae1ebaa508` | Source-verified develop checkpoint after merged PR #1412; complete recursive tree remained at 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `81669ce` | 157 |
| `ea6110fb39c1c86acfbf9673910965e7f698d511` | Historical source-verified develop checkpoint after merged PR #1419; complete recursive tree remains at 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `c3337a5` | 157 |
| `007f631a3db04b1a2d1ca3d21bb9af65123bd014` | Last complete recursive inventory checkpoint after merged PR #1415; 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `ea6110f` | 157 |

The previous source-verified develop checkpoint `b5fc236987833da4374258da876b412be3c48759` (after merged PR #1012) contained 124 tracked Markdown/MDX files: 61 under Harvester and 63 elsewhere. The complete recursive tree at `7590d332a307c7ef7bea37f0ba8721b399bd96e8` contained **147 tracked Markdown/MDX files**: 81 under Harvester and 66 elsewhere (97 frozen baseline files plus 50 additions, zero net removals). The subsequent checkpoint `0a51d6034a6ff6473d9a9005b74744fd048c9135`, after merged PR #1269, remained at 147 paths. The previous source-verified `develop` checkpoint `8843bd1e42dea7b47a7af5c464b921e54dd16c0d` contained **156 tracked Markdown/MDX files**: 85 under Harvester and 71 elsewhere. The checkpoint `81669ce2be6794b9bd03067f89b57f8fdb55f957` increased this to **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere, by adding `apps/harvester/docs/domain/RECOVERY_SELLER_POLICY_BLOCKERS.md` with no removals. The checkpoint `ea6110fb39c1c86acfbf9673910965e7f698d511` remained at **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. The last complete recursive inventory checkpoint `007f631a3db04b1a2d1ca3d21bb9af65123bd014` contained **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. Complete recursive comparison at that checkpoint confirmed zero path changes since `ea6110f` (PR #1415 modified existing documents only). This paragraph describes the historical 157-file checkpoint only. It is superseded by the complete 160-file checkpoint at `543753da5938eba2d95ad19d74c3f98a991e6461` and the current 179-file checkpoint recorded below. Earlier counts remain valid historical snapshots.

## Historical recursive additions — develop checkpoint 0a51d603

A complete recursive tree comparison from the 124-file checkpoint `b5fc236987833da4374258da876b412be3c48759` to historical `develop` checkpoint `7590d332a307c7ef7bea37f0ba8721b399bd96e8` found 23 added Markdown/MDX paths and no removed paths:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/SHUTDOWN_LOGGING_REDESIGN.md` | Accepted shutdown phase logging design and implementation contract. |
| `apps/harvester/docs/architecture/OPERATOR_CONTROL_DESIGN.md` | Current transport-independent operator-control architecture and Command Center contract. |
| `apps/harvester/docs/architecture/decisions/0002-transport-independent-operator-control.md` | Accepted application/engine/Telegram ownership and market-pause ADR. |
| `apps/harvester/docs/architecture/decisions/0003-process-lifetime-operator-pause.md` | Accepted process-lifetime operator-pause scope. |
| `apps/harvester/docs/architecture/decisions/0004-startup-open-orders-are-external.md` | Accepted startup open-order ownership boundary. |
| `apps/harvester/docs/audits/reports/2026-11-13_source-domain-correctness-audit.md` | Dated source/domain correctness audit evidence. |
| `apps/harvester/docs/audits/reports/2026-11-15_f055-shutdown-recovery.md` | Dated shutdown recovery finding evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z_ORDER_FILL_LEDGER.md` | Matching session order/fill ledger evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z_ORDER_FILL_LEDGER.md` | Matching session order/fill ledger evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-14_23-41-12Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/domain/recovery-seller-domain-specification.md` | Proposed Recovery Seller domain contract. |
| `apps/harvester/docs/domain/recovery-seller-implementation-roadmap.md` | Proposed Recovery Seller implementation roadmap. |
| `apps/harvester/docs/operations/submission-deferrals.md` | Operational explanation of order-submission deferral evidence. |
| `apps/harvester/docs/operations/telegram-command-center.md` | Telegram Command Center operator runbook. |
| `apps/harvester/docs/operator-control/README.md` | Operator-control capability index and implementation status. |
| `apps/harvester/docs/plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md` | Design and implementation record for startup order ownership. |
| `apps/harvester/docs/plans/WORKFLOW_PIPELINE_MIGRATION.md` | Harvester workflow-pipeline migration plan. |
| `apps/harvester/docs/recovery/README.md` | Recovery documentation entry point. |
| `docs/engineering/AI_REFACTORING_AUDIT_STANDARD.md` | Repository AI refactoring audit standard. |
| `docs/engineering/ESLINT_STANDARD.md` | Repository ESLint policy and verification standard. |
| `docs/engineering/structured-error-handling.md` | Repository structured error-handling standard. |

## Historical recursive additions — develop checkpoint 37aa07ec

A complete recursive tree comparison from `0a51d6034a6ff6473d9a9005b74744fd048c9135` to current `develop` `37aa07ec4c6421bd6c8b10084d734dc4ad9ed47c` found nine added Markdown/MDX paths and no removals:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/decisions/0005-emergency-buy-pause.md` | Accepted global/per-market emergency BUY pause, current-process-owned cancellation and recovery SELL continuity decision (merged PR #1267). |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-17_08-48-56Z.md` | Preserved 2026-11-17 Harvester session audit evidence. |
| `apps/harvester/docs/infrastructure/provider-instance-registry.md` | Harvester-owned provider identity/registry architecture and lifecycle contract (merged PR #1383). |
| `apps/harvester/docs/persistence/README.md` | Harvester-owned persistence architecture and database integration boundary. |
| `docs/architecture/decisions/ADR-0003-multi-provider-routing.md` | Accepted provider-neutral execution and independent market-data routing architecture. |
| `docs/architecture/multi-provider-migration-plan.md` | Source-based migration audit, phases, blockers and delivery sequence. |
| `packages/brokers/BITUNIX_REFERENCE_AUDIT.md` (historical path) | Source/reference audit; the current living document is `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md`, linked by the Brokers docs index. The old path is retained here only as historical inventory provenance. |
| `packages/db/docs/README.md` | Database package architecture and decision index. |
| `packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md` | Accepted provider-neutral record CRUD API decision. |

## Merged documentation additions — PR #1013 and follow-up work

[PR #1013](https://github.com/45s/coinzilla/pull/1013) merged the five maintained design/proposal documents below. They are included in the current 124-file recursive inventory.

| Added path | Purpose |
| --- | --- |
| `packages/indicators/README.md` | Defines the exchange-neutral indicator package boundary and public API; records Harvester as its first runtime consumer of ATR/NATR measurements in merged PR #1037 (data collection only). |
| `packages/indicators/AGENTS.md` | Defines Indicators domain ownership and implementation constraints. |
| `packages/indicators/ROADMAP.md` | Tracks the delivered ATR/NATR/ratio capability, Harvester candle-data consumer and remaining protection/adaptive-price-step work. |
| `apps/harvester/docs/volatility-protection.md` | Defines per-market protection, candle data, the recovery-SELL exception and Harvester implementation/test plan; PR #1037 delivers candle data and merged PR #1041 delivers the runtime protection gate and owned-BUY cancellation. Historical threshold calibration remains open. |
| `apps/harvester/docs/exchange-trading-constraints.md` | Records exchange trading constraints and their application-level handling. |

The subsequent Brokers candle contract documentation is an update to an existing file and does not change the Markdown/MDX path count. PR #1018 added runtime JavaScript and package metadata without adding new Markdown paths. PR #1019 updates existing Harvester port, architecture, roadmap and safety documents without adding new Markdown paths. PR #1037 updates existing Harvester/Indicators documentation and test support without adding Markdown/MDX paths; the 124-file count remained unchanged at that historical checkpoint.

## Source-verified content reviews (post-baseline)

The original 97-file inventory table above is a frozen baseline: its recorded byte sizes and first-pass dispositions are not current file metadata. Source-review findings and later document changes are recorded separately here rather than rewriting baseline rows.

| Document(s) | Source-verified review | Delivery |
| --- | --- | --- |
| `apps/harvester/docs/audits/README.md`; `reports/`, `sessions/`, and `evidence/` archive indexes; Harvester entry points and inventory | Moved nine historical records out of the application root, preserved their contents/provenance, repaired internal links, and retained only README/AGENTS/ROADMAP at the Harvester root. Exact-head required checks and advisory external documentation links passed. | [PR #951](https://github.com/45s/coinzilla/pull/951) |
| `packages/notifiers/AGENTS.md`; `packages/notifiers/README.md` | Verified the formatter's caller-owned free-form `message`/`reason` boundary, EventBus error-reporter fallback, delivery-queue recovery and smoke-test confirmation output against source and tests. | [PR #873](https://github.com/45s/coinzilla/pull/873) |
| `packages/utils/README.md` | At the #876 checkpoint, verified the exported per-key serialized queue and non-null/non-array object assertion against implementation, tests, public exports and consumers; the Validator configuration limitation was then tracked in #892, hardened in #918, and the deprecated facade was subsequently removed in #1509. | [PR #876](https://github.com/45s/coinzilla/pull/876), [PR #918](https://github.com/45s/coinzilla/pull/918), [PR #1509](https://github.com/45s/coinzilla/pull/1509) |
| `apps/harvester/docs/TRADING_FIRST.md` | Verified current WebSocket API/Streams and CLOSING-audit transport terminology against the broker adapter, source-verified Architecture and Journal Operations; dated November 4 incident terminology remains historical and unchanged. | [PR #883](https://github.com/45s/coinzilla/pull/883) |
| `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` | Added the source-driven behavior-to-test inventory and maintained its evidence through the Portfolio/RecoveryLedger commission-conflict and Conservative investment-cap regression additions. | [PR #917](https://github.com/45s/coinzilla/pull/917), [PR #921](https://github.com/45s/coinzilla/pull/921), [PR #922](https://github.com/45s/coinzilla/pull/922) |
| `apps/harvester/docs/JOURNAL_EVIDENCE_CONTRACT.md`; Harvester Journal architecture/domain/operations indexes | Reconciled the Harvester consumer contract with Journal JSONL serialization: persisted payloads must be JSON-safe, while the broader EventBus payload type is not a promise of durable representability. Updated navigation and roadmap evidence without changing runtime behavior. | [PR #895](https://github.com/45s/coinzilla/pull/895) |
| `packages/brokers/ARCHITECTURE.md`; `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Reconciled architecture completion claims with current implementation and tests; retained the target-architecture versus current-source boundary and corrected the active roadmap status. | [PR #896](https://github.com/45s/coinzilla/pull/896) |
| `packages/db/AGENTS.md`; `packages/db/README.md` | Corrected public API guidance to match factory-based runtime exports and clarified that `DatabaseProvider` is a JSDoc-only port rather than a runtime export. | [PR #897](https://github.com/45s/coinzilla/pull/897) |
| `packages/journal/README.md`; `packages/journal/ROADMAP.md`; Journal record/serialization JSDoc | Documented JSONL serialization and durability limitations, the temporary JSON-safe consumer constraint, and the still-open Journal-owned defect in #889. | [PR #898](https://github.com/45s/coinzilla/pull/898) |
| `packages/market-simulator/README.md` | Corrected both broker examples to provide caller-owned market history and documented optional custom repository injection and precedence. The package was later retired in PR #1482. | [PR #900](https://github.com/45s/coinzilla/pull/900) |
| `packages/brokers/AGENTS.md`; `packages/journal/AGENTS.md`; `packages/utils/AGENTS.md`; `packages/market-simulator/AGENTS.md` | Aligned package agent instructions with actual coverage scripts and thresholds; the Market Simulator package was later retired in PR #1482. | [PR #911](https://github.com/45s/coinzilla/pull/911) |
| `docs/MARKDOWN_STYLE.md`; `docs/DOCUMENTATION_GOVERNANCE.md`; `docs/ci-workflows.md`; external-link checker and tests | Added a dependency-free external-link checker, retry/rate-limit/redirect handling, conservative classifications, query-credential rejection/redaction, and DNS-pinned HTTP(S) transport with redirect revalidation. The suite now has 31 deterministic DNS-injected tests; External Documentation Links is active as a non-required advisory workflow, #901 is resolved, and required CI remains network-free. | [PR #899](https://github.com/45s/coinzilla/pull/899), [PR #902](https://github.com/45s/coinzilla/pull/902), [PR #903](https://github.com/45s/coinzilla/pull/903), [PR #908](https://github.com/45s/coinzilla/pull/908) |
| `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `ROADMAP.md` | Synchronized the frozen 97-file baseline, post-baseline additions, 113-file recursive checkpoint, source-review evidence and remaining-work status after the latest audit. | [PR #904](https://github.com/45s/coinzilla/pull/904) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/JOURNAL_OPERATIONS.md`; Harvester entrypoint/tests | Verified PR #906's same-process Journal flush-failure classification and conservative process-ownership lock retention; this does not claim process-restart recovery. | [PR #906](https://github.com/45s/coinzilla/pull/906) |
| `apps/harvester/docs/architecture.md`; recovery handler and tests | Verified same-process generation fencing: stale asynchronous recovery-stage failures retain their original error/generation context and cannot mutate a replacement generation or terminal accounting latch. This does not implement process-restart reconciliation; #654 remains open. | [PR #909](https://github.com/45s/coinzilla/pull/909) |
| `apps/harvester/docs/audits/reports/2026-11-10_18-44-49_restart-recovery-audit.md` | Preserved the source-based restart-recovery findings and implementation gates at their stated develop baseline; no runtime changes or exchange operations. | Develop checkpoint `515324a6b1cb872b99593bdf448d1914b005bfcb` |
| `apps/harvester/docs/architecture/decisions/0001-application-owned-recovery-facts.md`; Harvester/root roadmaps; Journal and CI workflow docs; `.github/workflows/unit-tests.yml` | Froze the target process-restart recovery contract: a separate application-owned append-only fact stream with a committed-head integrity manifest, explicit durability acknowledgement, Journal observer separation, derived accounting projections, and a closed startup reconciliation gate. Also removed the unconditional PR-only TESTNET endpoint probe so package-test workflows remain offline; manual TESTNET integration stays opt-in. No runtime recovery behavior changed. | PR #1003 |
| `apps/harvester/README.md`; `apps/harvester/docs/architecture.md`; `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW.md`; `apps/harvester/docs/error-vocabulary.md` | Corrected Journal flush scope, verification-only final reconciliation, market-metadata cache ownership/scope, and per-session Journal lock recovery paths against source and tests. | [PR #910](https://github.com/45s/coinzilla/pull/910) |
| `README.md`; `ROADMAP.md`; `docs/README.md`; `docs/ci-workflows.md`; inventory | Reconciled the root navigation, 113-file checkpoint, and live `core`/`develop-core` ruleset evidence while preserving the frozen 97-file baseline. | [PR #912](https://github.com/45s/coinzilla/pull/912) |
| `ROADMAP.md`; `apps/harvester/ROADMAP.md` | Reconciled recovery roadmap closeout and kept process-restart reconciliation explicitly open under #654. | [PR #914](https://github.com/45s/coinzilla/pull/914) |
| `docs/MARKDOWN_STYLE.md`; Markdown baseline/checker scripts and tests | Added six report-only list/table metrics, objective conventions, and positive/negative/fenced-code/historical test coverage; changed-file enforcement remains unchanged. The 113-file baseline reports 41 files / 156 list-spacing findings and one table-column mismatch. | [PR #915](https://github.com/45s/coinzilla/pull/915) |
| `packages/brokers/ROADMAP.md`; `ROADMAP.md`; inventory | Corrected the Brokers roadmap table-column mismatch and synchronized the 113-file recursive checkpoint, inventory, and root roadmap without adding or removing Markdown/MDX paths. | [PR #916](https://github.com/45s/coinzilla/pull/916) |
| `packages/utils/src/validation.js`; `packages/utils/src/validator.js`; `packages/utils/README.md`; `packages/utils/ROADMAP.md`; root `README.md`/`ROADMAP.md`; `.github/workflows/utils-unit-tests.yml` | Source-verified and hardened the public Validator rule/mode contract; corrected required test discovery; 198/198 Utils tests passed with 98.53% line and 96.33% branch coverage. | [PR #918](https://github.com/45s/coinzilla/pull/918) |
| `packages/utils/src/validator.js`; `packages/utils/src/validation.js`; `validator.test.js`; `validation.test.js`; `packages/utils/src/index.js`; `packages/utils/src/ensure/`; `packages/entities/src/coins/coin.js`; `packages/entities/src/orders/order.js`; focused tests; Utils/Entities roadmaps; shared-utilities policy; root README/ROADMAP; CI workflow/docs | Removed the Validator/VR facade, declarative rule implementation/tests and public exports; migrated Coin ticker and Order price/ID checks with domain Error/message preservation; added custom `ensure.errMsg` coverage; fixed recursive Utils test discovery; synchronized maintained documentation. Exact-head verification passed: Utils 225 (223 passed, 0 failed, 2 skipped), Entities 145/145, workspace tests/coverage, JS syntax/strict lint/Markdown, dependency audit, Harvester targeted tests and external links. Merged as `ab77568acfcd286560270aaac325bf65301efb0c`. | [PR #1509](https://github.com/45s/coinzilla/pull/1509) |
| `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Verified canonical order placement explicitly requests Binance `RESULT` rather than relying on the minimal default `ACK` for `LIMIT_MAKER`; the compatibility `createOrder()` contract is unchanged and uncertain placement is not retried. | [PR #961](https://github.com/45s/coinzilla/pull/961) |
| `apps/harvester/docs/JOURNAL_OPERATIONS.md`; `apps/harvester/docs/TRADING_FIRST.md`; Harvester/root roadmaps | Verified authoritative `NEW` user-data identity recovery (`UNKNOWN → OPEN`), duplicate/conflicting identity handling, shutdown cancellation boundaries, and propagation of validated `TRADING_MODE` into startup status against source/tests. | [PR #964](https://github.com/45s/coinzilla/pull/964) |
| `apps/harvester/docs/README.md`; `docs/README.md`; `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `packages/brokers/ROADMAP.md`; `ROADMAP.md` | Removed duplicate Harvester archive navigation, reconciled the 117-file count/checkpoints, and closed the stale Brokers `RESULT` acknowledgement roadmap item against merged PR #961 and issue #960. | [PR #967](https://github.com/45s/coinzilla/pull/967) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md`; `DOMAIN_TEST_INVENTORY.md`; `portfolio.md` | Recorded the merged snapshot-relative account balance/commitment baseline, its eight scenario families, fail-closed invalid-order handling, and exact-head offline verification. | [PR #968](https://github.com/45s/coinzilla/pull/968) |
| `apps/harvester/docs/volatility-protection.md`; Harvester architecture/flow and BrokerPort guidance; `packages/indicators/README.md` and `ROADMAP.md` | Verified the per-market candle-history service, ATR/NATR measurements, freshness/gap behavior, and unsubscribe drain guarantees; the runtime protection state machine, central order gate, recovery-SELL exception and owned-BUY cancellation were subsequently merged in PR #1041. Historical threshold calibration remains open. | [PR #1037](https://github.com/45s/coinzilla/pull/1037), [PR #1041](https://github.com/45s/coinzilla/pull/1041) |

## Disposition vocabulary

- **KEEP** — preserve at the current path; maintain authority boundaries and index links.
- **REVIEW** — investigate content, status and references before deciding whether to keep, merge, split, supersede or archive.
- No deletion or bulk move is authorized by this inventory.

## File-by-file inventory outside Harvester

| Path | Size (bytes) | Category | Current disposition | Rationale / next review |
| --- | ---: | --- | --- | --- |
| `.github/ISSUE_TEMPLATE/cross-domain-request.md` | 816 | GitHub workflow/template | **KEEP** | KEEP; field set matches CROSS_DOMAIN_REQUESTS (owner, consumer, current/expected behavior, acceptance, impact, compatibility/safety and links); no process mismatch. |
| `.github/PULL_REQUEST_TEMPLATE.md` | 2773 | GitHub workflow/template | **KEEP** | KEEP; verification, exact-head CI, documentation impact, provenance, handoff and target-branch fields match ENGINEERING_STANDARDS and AI_AGENT_WORKFLOW. One extra blank line is tracked for normalization in #1432. |
| `.github/copilot-instructions.md` | 265 | GitHub workflow/template | **KEEP** | KEEP; intentionally delegates to root AGENTS.md and does not duplicate or override repository policy. |
| `AGENTS.md` | 10703 | Repository governance | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `AI_AGENT_WORKFLOW.md` | 22580 | Repository governance | **KEEP** | KEEP; canonical branch, freshness, test-first, exact-head CI, merge/release and resumable-handoff policy; checked against current develop-only task-PR rules and required workflow contexts. |
| `ENGINEERING_STANDARDS.md` | 29505 | Repository governance | **KEEP** | KEEP; canonical engineering/testing/security/reliability/DoD standard; reviewed with root scripts, ESLint policy and current required CI model; no confirmed defect. |
| `README.md` | 4326 | Repository entry point | **KEEP** | Source-checked against the Brokers package manifest and README; removes obsolete Binance SDK/`test:sdk` instructions, documents native-WebSocket integration scripts and safety gates, and points to the active `core`/`develop-core` six-context rulesets. |
| `ROADMAP.md` | 8232 | Repository roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `docs/DOCUMENTATION_GOVERNANCE.md` | 16440 | Operational/reference guide | **KEEP** | Canonical repository-wide documentation policy; source review corrected the Section 11 freshness-sweep reference, records deterministic Markdown checks, and now documents the DNS-pinned external-link policy and active non-required advisory workflow after #901 was resolved. |
| `docs/README.md` | 2223 | Operational/reference guide | **KEEP** | Repository-wide documentation entry point. |
| `docs/ai-agent/repository-engineering-audit.md` | 15755 | Historical task brief | **KEEP** | Historical audit task brief; separate from the actual audit report in docs/audits/ and not current agent policy. |
| `docs/architecture/README.md` | 1595 | Architecture/ADR | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md` | 5629 | Architecture/ADR | **KEEP** | Cross-reference audit found a reference to nonexistent ADR-0002; the application-specific architecture reference now points to the existing Harvester architecture guide. |
| `docs/architecture/decisions/ADR_TEMPLATE.md` | 631 | Architecture/ADR | **KEEP** | KEEP; template-only structure with status, owner, supersession, decision, alternatives, consequences and verification; no current implementation claim. |
| `docs/audits/README.md` | 649 | Repository audit archive index | **KEEP** | Maintained navigation index for historical audit records; the index itself is not historical evidence and remains subject to normal style/link enforcement. |
| `docs/audits/repository-engineering-audit.md` | 16323 | Historical audit | **KEEP** | Historical repository assessment; preserve baseline, date and limitations. |
| `docs/brokers-websocket-contract.md` | 30152 | Operational/reference guide | **KEEP** | KEEP; source-verified against packages/brokers/src/index.js, README and index.contract.test.js. Stale four-export claim corrected to the exact eight-name public allow-list in #1431. |
| `docs/ci-workflows.md` | 3292 | Operational/reference guide | **KEEP** | Source-checked against root `package.json` and `.github/workflows/`; documents the six required contexts on both active rulesets, the 31-test DNS-pinned external-link checker, and the non-required network advisory workflow. PR #1431 removes the stale claim that Test Coverage writes a custom Actions step summary. |
| `docs/contributing.md` | 2622 | Operational/reference guide | **KEEP** | Source-checked against root/package manifests and workflows; removes a nonexistent Brokers `test:sdk` command and lists the three scripts actually defined by `packages/brokers/package.json`. |
| `docs/dependency-audit-playbook.md` | 2931 | Operational/reference guide | **KEEP** | KEEP; triggers, pnpm audit command, Dependabot cadence/target and security-update exception match .github/workflows/dependency-audit.yml and .github/dependabot.yml. |
| `docs/engineering/BRANCH_AND_RELEASE_POLICY.md` | 349 | Engineering policy | **KEEP** | KEEP; intentionally a stable pointer to AI_AGENT_WORKFLOW.md, avoiding a second branch/release policy. |
| `docs/engineering/CROSS_DOMAIN_REQUESTS.md` | 2462 | Engineering policy | **KEEP** | KEEP; request types, required evidence, owner decision and implementation sequence match the GitHub cross-domain issue template. |
| `docs/engineering/DEFINITION_OF_DONE.md` | 554 | Engineering policy | **KEEP** | KEEP; intentionally links ENGINEERING_STANDARDS.md, TASK_WORKFLOWS.md and AI_AGENT_WORKFLOW.md instead of duplicating checklists. |
| `docs/engineering/DOMAIN_OWNERSHIP.md` | 2648 | Engineering policy | **KEEP** | KEEP; owned paths and responsibilities match current workspace packages and local AGENTS.md ownership declarations; shared infrastructure boundary is explicit. |
| `docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md` | 6385 | Engineering policy | **KEEP** | KEEP; source-verified against effective root eslint.config.js and the ESLint Standard; no conflicting rule found. |
| `docs/engineering/MODULARITY_STANDARD.md` | 2727 | Engineering policy | **KEEP** | KEEP; source-verified against current package layouts and effective ESLint architecture rules; no conflicting boundary rule found. |
| `docs/engineering/SHARED_UTILITIES_POLICY.md` | 19699 | Engineering policy | **KEEP** | Current shared-utility ownership and reuse policy; source review verified current package paths and keeps the removed Coin Farmer application explicitly historical. |
| `docs/engineering/README.md` | 852 | Engineering policy | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/engineering/TASK_WORKFLOWS.md` | 3268 | Engineering policy | **KEEP** | KEEP; task checklists and required evidence align with root AGENTS.md and AI_AGENT_WORKFLOW.md; no conflicting completion rule found. |
| `docs/MARKDOWN_STYLE.md` | 13921 | Markdown style standard | **KEEP** | Canonical maintained-document authoring standard; documents changed-file enforcement, report-only full-tree metrics, tested exclusions and the historical migration boundary. |
| `docs/release-and-rollback.md` | 2504 | Operational/reference guide | **KEEP** | KEEP; accurately states that no automated deployment workflow exists; current workflow tree contains CI/test/audit workflows only. |
| `docs/workspace-package-map.md` | 4790 | Operational/reference guide | **KEEP** | KEEP; package paths match pnpm-workspace.yaml and manifests. Harvester DB/Indicators dependencies and the read-only Bitunix broker boundary are corrected in #1431. |
| `packages/brokers/AGENTS.md` | 8605 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 requires `test:coverage` and documents the 90% line / 80% branch / 80% function thresholds. |
| `packages/brokers/ARCHITECTURE.md` | 35221 | Package architecture | **KEEP** | Explicitly labels itself as target architecture/migration contract, distinguishes its dated implementation snapshot from current source, and documents verified consumer boundaries and enforced dependency direction. Linked by the package README and roadmap; no move/split is warranted. |
| `packages/brokers/README.md` | 19671 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; records the standalone Node floor separately from the exact patched Undici major-version floors enforced by `runtime.js`. |
| `packages/brokers/ROADMAP.md` | 109813 | Package roadmap | **KEEP** | Active priority execution plan and Section 2 current status are authoritative; later phases and dated investigation notes are explicitly historical evidence. The 2026-11-08 #702 note records the pre-approval state, while the current section records the accepted contract and merged PRs #732/#735/#740. PR #896 reconciled the architecture completion status against current implementation/tests. The package AGENTS/README designate this detailed roadmap as the primary work entry point; keep its current/history boundary and do not rewrite dated notes. |
| `packages/db/AGENTS.md` | 2897 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy; PR #897 aligns factory-based runtime API guidance with exports and tests. |
| `packages/db/README.md` | 5933 | Package entry point | **KEEP** | Source-checked against package exports and runtime constraints; the earlier unmatched closing Markdown fence in Development was corrected, and PR #897 clarifies factory-based public APIs and the JSDoc-only `DatabaseProvider` port. |
| `packages/db/ROADMAP.md` | 7652 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/entities/AGENTS.md` | 2139 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/entities/ROADMAP.md` | 14256 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/event-bus/AGENTS.md` | 2072 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/event-bus/README.md` | 6406 | Package entry point | **KEEP** | Source-checked against package engine, root workspace engine and Node 24 CI workflows; removes the stale claim that repository CI runs Node 22. |
| `packages/event-bus/ROADMAP.md` | 25883 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; source review corrected an outdated constructor-options summary that omitted `maxPending`; the implementation and README agree on `logger`, `onError`, and `maxPending` (default 1,000). |
| `packages/journal/AGENTS.md` | 1668 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 aligns the required `test:coverage` command and its 85% line / 80% branch thresholds with the package manifest. |
| `packages/journal/README.md` | 19624 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; PR #898 documents JSONL serialization/durability limits and the temporary JSON-safe consumer contract tracked by #889. |
| `packages/journal/ROADMAP.md` | 39476 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/notifiers/AGENTS.md` | 4694 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/notifiers/README.md` | 12254 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/notifiers/ROADMAP.md` | 15672 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/utils/AGENTS.md` | 2271 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 requires `test:coverage` and documents the 90% line / 85% branch thresholds. |
| `packages/utils/README.md` | 19711 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; public helper/queue contracts were source-verified in PR #876, and the Validator configuration contract was hardened in merged PR #918. |
| `packages/utils/ROADMAP.md` | 11241 | Package roadmap | **KEEP** | Current work/status authority; PRs #767/#770 and closed issue #763 establish build-provenance/Logger rollout as complete, while the repository-wide helper inventory, direct console/stderr audit, and guard remain open. Historical PR #383 closeout wording is explicitly labeled as a dated snapshot. |

## Initial findings

1. `docs/ai-agent/repository-engineering-audit.md` is an AI-agent task brief, while `docs/audits/repository-engineering-audit.md` is an actual historical repository assessment. They are distinct documents, not duplicate copies.
2. Repository policy is now centralized in `docs/DOCUMENTATION_GOVERNANCE.md`; root `AGENTS.md`, `AI_AGENT_WORKFLOW.md` and `ENGINEERING_STANDARDS.md` are mandatory entry points that link to the canonical policy.
3. `packages/brokers/ARCHITECTURE.md` explicitly describes a target architecture, not a claim that the current source tree already matches it. Its former Market Simulator consumer example was removed when that unused package was retired in PR #1482; the current document no longer lists a simulator consumer. KEEP the architecture/target distinction.
4. `packages/brokers/ROADMAP.md` is intentionally detailed, as stated by its package instructions. Its current priority plan and Section 2 status govern active work; later phases and dated investigation notes are explicitly historical implementation evidence. The 2026-11-08 #702 note records the pre-approval snapshot, not current status. Keep the file in place; do not split its history without a demonstrated navigation/maintenance benefit.
5. `packages/entities` previously had agent instructions and a roadmap but no README entry point; a package README has now been added.
6. Package README/AGENTS/ROADMAP files are domain-owned. Root policy should define common standards; package instructions should add only genuinely local constraints.
7. `docs/ci-workflows.md` had drifted from `.github/workflows/quality-gate.yml`: it incorrectly described the workflow as running `pnpm run quality` and omitted the `develop` push trigger. PR #816 aligns the guide with the actual actionlint, JavaScript syntax, and agent-policy steps.
8. `docs/contributing.md` advertised a nonexistent `@coinzilla/brokers` `test:sdk` script. The package currently defines `test:integration`, `test:websocket`, and `test:user-data-integration`; the contributor guide now lists the actual commands.
9. `docs/DOCUMENTATION_GOVERNANCE.md` pointed agents to Section 9 for the living-document freshness sweep, but Section 9 is roadmap discipline. This cross-reference now points to the explicit freshness-sweep requirement below in Section 11.
10. `ADR-0001-clean-hexagonal-architecture.md` referred to ADR-0002 for the application architecture transition, but a recursive tree and code search found no ADR-0002 in the repository. The text now links to the existing Harvester architecture guide and states that application-specific architecture is owned by each application.

## Remaining work

- [x] Complete first-pass dispositions for all 42 Harvester files and resolve all four initial Harvester REVIEW candidates (see the Harvester inventory for evidence).
- [ ] Continue source/behavior/reference review of KEEP documents; KEEP is a preservation disposition, not proof that every statement in every historical document has been revalidated.
- [x] Review current package/app README, AGENTS and ROADMAP entry points for the maintained workspace areas; source-level review findings and open defects are recorded above and in their owning package roadmaps.
- [x] Verify local indexes for substantial documentation subdirectories in root docs and Harvester; preserve any historical index/navigation distinctions.
- [x] Traced the removed/relocated documentation paths through current Markdown indexes, relevant migration PR diffs, GitHub issue/PR records and package/workflow changes. The GitHub code-search index still returns an older commit (`0439430`), so it is not treated as current evidence; no migration decision relies on those stale search results.
- [x] Implement safe external-link checking: dependency-free CLI, DNS-pinned HTTP(S) transport, validation of every A/AAAA answer, redirect revalidation, credential redaction, conservative authentication classification, 31 deterministic DNS-injected tests, and a documented reliability policy. External Documentation Links is active as a non-required advisory workflow; #901 is resolved and required CI remains network-free.
- [x] Full-tree maintained Markdown style enforcement and local-anchor enforcement are implemented in merged PR #1434; all 14 style metrics and maintained local anchors are blocking, while historical evidence remains excluded/preserved.
- [x] Required agent-policy, maintained Markdown style and maintained local-anchor gates run in the existing required CI workflow; historical-source anchor findings remain report-only.
- [x] Record evidence-based dispositions and rationale for all six initial REVIEW entries; no initial Harvester or Brokers REVIEW candidates remain.
- [x] Recorded and corrected new S-10 findings (configuration scope, stale source paths/statuses, malformed index entries, ADR index, and inventory counts); updated affected indexes and roadmaps in the same review branch.

## Post-baseline additions — startup open-order boundary

PR #1166 added two maintained Harvester documents outside the frozen 97-file baseline. They must be included in the next complete recursive tree verification.

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/decisions/0004-startup-open-orders-are-external.md` | Accepted and implemented startup order ownership decision. |
| `apps/harvester/docs/plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md` | Completed design and implementation record for #1157. |

## Latest recursive inventory checkpoint — develop `543753da5938eba2d95ad19d74c3f98a991e6461`

The complete recursive Git tree at this checkpoint returned `truncated: false` and contains **160 tracked Markdown/MDX files**: **89 under `apps/harvester/` and 71 elsewhere**. A direct path comparison against the previous 159-file checkpoint `88b89995a4f9e62a6fe4b0451ea675ce0495b539` found exactly one addition and zero removals. The frozen 97-file baseline and all intervening historical checkpoints above remain unchanged.

The current checker classifies **132 paths as maintained** and **28 as historical evidence/archive records**. GitHub templates and maintained README indexes remain in the maintained set; exclusions are limited to explicit historical audit, evidence, incident, session, task and dated-audit path families. PR #1429 adds regression tests proving that adjacent living indexes and reusable templates are not swept into historical exclusions.

| Added path | Purpose and disposition |
| --- | --- |
| `apps/harvester/docs/persistence/sqlite-integration-blueprint.md` | Source-verified Harvester persistence inventory, ownership boundaries, Production/Testnet isolation, operational constraints and phased migration plan; KEEP as the design/audit authority, with current implementation status delegated to the persistence README and #1327. |

The Harvester documentation index and persistence index link the new blueprint. This is a path-completeness update only; it does not claim that all 160 documents have passed the maintained-document factual audit tracked by #1401, the full-tree Markdown classification/enforcement work tracked by #1402, or the reference-tracing work tracked by #1403.

## User-data delivery architecture addition (2026-11-19)

| Added path | Purpose |
| --- | --- |
| `docs/architecture/decisions/ADR-0005-generic-user-data-observation-channel.md` | Defines the provider-neutral distinction between native user-data events and non-authoritative polling observations, while preserving Bitunix provider-admission and trading-readiness barriers. |

## Current recursive inventory checkpoint — develop `0f827ba7551be61a1be58f8dced191fb0a090870` (2026-11-21)

A fresh recursive Git tree request returned `truncated: false` and contains **179 tracked Markdown/MDX files**: **94 under `apps/harvester/` and 85 elsewhere**. This is 19 more paths than the prior 160-file checkpoint at `543753da5938eba2d95ad19d74c3f98a991e6461`. A direct path-set comparison found 24 additions and 5 removals (net +19); no file-content or factual-accuracy claim is implied by this inventory update.

### Added paths since the 160-file checkpoint

The following 24 path additions have been classified and source-checked. One is historical evidence, one is a superseded decision record, and the remaining current documents are retained with the source evidence below. The relocated Brokers audit is a path move, not a duplicate document.

| Path | Disposition | Source / status evidence |
| --- | --- | --- |
| `apps/harvester/docs/architecture/decisions/0006-market-pause-cancels-owned-buys.md` | **KEEP — accepted decision** | Matches the owned-BUY pause/cancel contract delivered by merged [PR #1436](https://github.com/45s/coinzilla/pull/1436); exact-head tests and required CI passed. |
| `apps/harvester/docs/architecture/strategy-extensibility-audit-roadmap.md` | **KEEP — draft architecture discussion, not a runtime contract** | Owner-approved direction and RS-4/RS-5 completion state match merged [PR #1515](https://github.com/45s/coinzilla/pull/1515); referenced source paths exist. Last verified 2026-11-20. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-19_02-16-31Z.md` | **HISTORICAL — preserve unchanged** | Timestamped audit-session evidence; no current behavior authority is assigned to it. |
| `apps/harvester/docs/infrastructure/execution-routing.md` | **KEEP — current infrastructure contract** | Routing/account-isolation boundary matches merged [PR #1455](https://github.com/45s/coinzilla/pull/1455), source and targeted tests; Binance remains the only registered Harvester execution provider. |
| `apps/harvester/docs/operations/trading-history-backups.md` | **KEEP — current operational runbook** | Commands, environment selection, online/WAL-safe backup, restore-check, manifest, retention and permissions match merged [PR #1567](https://github.com/45s/coinzilla/pull/1567), implementation and exact-head CI. No exchange operation is involved. |
| `apps/harvester/docs/persistence/trading-history-roadmap.md` | **KEEP — current persistence roadmap** | Phases 1–3 match merged [PR #1555](https://github.com/45s/coinzilla/pull/1555), [#1557](https://github.com/45s/coinzilla/pull/1557) and [#1559](https://github.com/45s/coinzilla/pull/1559); Phase 6 correctly marks only the backup slice complete in [#1567](https://github.com/45s/coinzilla/pull/1567). |
| `docs/architecture/decisions/ADR-0004-complete-bitunix-provider-integration.md` | **SUPERSEDED — preserve decision history** | Its own status metadata marks it superseded; PR #1455 removed the interim observer-only runtime. Do not treat it as current admission authorization. |
| `docs/architecture/decisions/ADR-0005-generic-user-data-observation-channel.md` | **KEEP — accepted delivery contract** | Native event delivery and non-authoritative polling are distinct in current Brokers Application session and Bitunix polling source/tests; does not relax #1185. |
| `docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md` | **KEEP — canonical mandatory policy** | Cross-linked by root agent instructions, AI workflow, task workflows, engineering index and PR template; used as the S-10 implementation preflight. |
| `docs/engineering/APPLICATION_HANDLER_TEMPLATE.md` | **KEEP — optional reusable template** | Its DB provider-neutral composition example and source/test paths exist; it is guidance, not a required abstraction. |
| `docs/engineering/CONFIGURATION_STANDARD.md` | **KEEP — canonical configuration policy** | Matches Harvester's named `appConfig`, bootstrap resolver, explicit `TRADING_MODE` and colocated validation tests; no speculative environment scanner is claimed. |
| `docs/engineering/DOMAIN_POLICY_TEMPLATE.md` | **KEEP — optional reusable template** | Source-backed domain-policy/decision-matrix example; no runtime behavior is asserted by the template. |
| `docs/engineering/ENGINEERING_STANDARDS_MATRIX.md` | **KEEP — governance inventory** | S-9 merged state and S-10 current checkpoint corrected; current tree/classifier counts recorded. |
| `docs/engineering/INFRASTRUCTURE_ADAPTER_TEMPLATE.md` | **KEEP — optional reusable template** | DB provider-port, SQLite adapter and conformance-test examples exist in the current tree. |
| `docs/engineering/LOGGING_OBSERVABILITY_STANDARD.md` | **KEEP — canonical logging policy** | Shared Logger implementation and tests exist at `packages/utils/src/logger.js` and colocated test files; policy remains transport- and application-neutral. |
| `docs/engineering/PURE_MODULE_TEMPLATE.md` | **KEEP — optional reusable template** | Source-backed pure-module/direct-test example; no generator or new dependency is introduced. |
| `docs/engineering/STATEFUL_LIFECYCLE_TEMPLATE.md` | **KEEP — optional reusable template** | DB lifecycle aggregate and transition-test example paths exist; template remains optional. |
| `packages/brokers/BROKER_API.md` | **KEEP — canonical public Broker contract** | Structural method catalog and mutation outcomes match `src/broker/broker-contract.js`, its contract tests, and Binance/Bitunix implementations. |
| `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md` | **KEEP — current external/source audit** | Current Brokers index and cross-repository Broker contract link to this relocated path; section numbering corrected. It remains evidence, not official specification or production-readiness approval. |
| `packages/brokers/docs/BITUNIX_SPOT_POLLING.md` | **KEEP — current private read-only contract** | Source path corrected to `src/infrastructure/bitunix/spot/reconciler.js`; implementation/tests and merged [PR #1516](https://github.com/45s/coinzilla/pull/1516) verify failure recovery. Polling remains non-authoritative and cannot synthesize fills. |
| `packages/brokers/docs/BITUNIX_WORKFLOW.md` | **KEEP — mandatory operator/developer workflow** | One CLI entry point and package command match merged [PR #1616](https://github.com/45s/coinzilla/pull/1616); exact-head required and advisory workflows passed. Default/local modes are read-only; the LIVE mode is human-only and was not invoked. |
| `packages/brokers/docs/README.md` | **KEEP — current package documentation index** | Links to the current Bitunix audit, polling contract, workflow, readiness matrix, roadmap and package-wide references. |
| `packages/brokers/docs/ROADMAP.md` | **KEEP — current Bitunix subdomain roadmap** | Current implementation status and issue/PR references are reconciled against merged #1516/#1616; #1185 remains the production-readiness blocker. |
| `packages/brokers/docs/bitunix-production-readiness-gap-matrix.md` | **KEEP — current evidence/gap matrix** | Distinguishes implemented offline behavior from unverified exchange guarantees; polling recovery does not satisfy authoritative event/fill or Harvester readiness requirements. |

### Removed paths since the 160-file checkpoint

These paths are absent from the current recursive tree. The dispositions below are based on the relevant migration PR diffs, current indexes/workspace manifests and GitHub issue/PR history; historical inventory rows are retained as provenance.

- `apps/harvester/docs/infrastructure/bitunix-read-only-observer.md` — **RETIRED** with the interim observer runtime/configuration/adapter in merged [PR #1455](https://github.com/45s/coinzilla/pull/1455); Bitunix remains unregistered until #1185 and the complete-provider gate in ADR-0004. Current Harvester infrastructure indexes point to the general execution-routing contract, not a replacement observer surface.
- `packages/brokers/BITUNIX_REFERENCE_AUDIT.md` — **MOVED** to `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md`; the current Brokers docs index and `docs/brokers-websocket-contract.md` link to the new location. The old path remains here only as historical inventory provenance.
- `packages/market-simulator/AGENTS.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.
- `packages/market-simulator/README.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.
- `packages/market-simulator/ROADMAP.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.

### Audit boundary

- The current path count and Harvester/non-Harvester split are verified against the complete recursive Git tree at the exact commit above.
- The prior 160-path checkpoint and its historical evidence remain unchanged.
- This checkpoint records path additions/removals only. It does **not** mark the 179 documents as factually verified. #1401 owns the complete maintained-document source audit; #1403 owns reference tracing and migration decisions.
- Historical session/audit/evidence records remain preserved. No historical conclusion or timestamp was rewritten.

### Current maintained/historical classification — develop `0f827ba7551be61a1be58f8dced191fb0a090870`

The complete recursive tree contains 179 Markdown/MDX files. Applying the current `scripts/markdown-path-policy.js` classification yields **150 maintained paths and 29 historical paths**. This supersedes the prior 160-file / 132-maintained / 28-historical checkpoint for current counts only; all older checkpoint rows remain historical evidence. The classification is a path policy, not a claim that every maintained document has passed factual source review.

## S-10 factual-review coverage and known unknowns — 2026-11-21

The complete recursive path inventory and dispositions are now recorded for all 179 Markdown/MDX files. The source-verified review table above preserves prior merged audit evidence; the 24 additions since the 160-file checkpoint have individual current dispositions and source/status evidence. The five removed paths have explicit retired/moved dispositions and migration provenance.

**Do not interpret KEEP as factual verification.** Maintained documents without a distinct source-verification record in the source-review table or the S-10 additions table remain **not independently revalidated in this pass**. They are retained pending owner/source review; no full-coverage claim is made for those statements. Historical paths are preserved as evidence, not revalidated as current behavior contracts.

The reference audit verified the relevant Markdown indexes and migration PR diffs for the retired observer guide, retired Market Simulator package, and relocated Brokers audit. Additional current-roadmap corrections reconcile merged S-5 Utils PR #1581, S-6 Entities coverage PR #1578 and S-7 Brokers PR #1593; all exact-head required and advisory workflow runs passed. The Harvester RS implementation roadmap now reflects merged PR #1515 and its successful exact-head workflows. The Conservative Domain Specification's duplicate section number was corrected and its three inbound anchors were updated. Current local link/anchor enforcement is required CI. A full source-comment sweep across unchanged files remains an explicit limitation because repository code-search results are pinned to stale commit `043943051582a8d7bceb5a3a2f642bd886470cc8`; that index cannot prove current absence/presence. No document migration or consolidation is based on stale search results.

## Pending addition — PR #1718 (2026-11-22)

| Path | Disposition | Source / status evidence |
| --- | --- | --- |
| `apps/harvester/docs/architecture/decisions/0007-initialize-empty-operational-state-ledger.md` | **KEEP — accepted Harvester decision, pending merge** | Defines automatic genesis creation only for a missing/empty Operational State Store directory; existing partial, unexpected, or corrupt data remains fail-closed. Indexed from the Harvester architecture guide and supersedes only the genesis-initialization clause of ADR-0001. |

The recursive counts above remain the 2026-11-21 `develop` checkpoint; PR #1718 is listed separately until merged.

## AI task issue knowledge capture — PR #1752 (2026-11-23)

| Path | Disposition | Purpose / evidence |
| --- | --- | --- |
| `.github/ISSUE_TEMPLATE/bug-report.md` | **KEEP — current general bug template** | Adds the mandatory repository/domain standards preflight before request fields and the agreed problem, expected behavior, impact, investigation, proposed approach, acceptance, dependencies, verification and resolution sections. Delivered with issue [#1751](https://github.com/45s/coinzilla/issues/1751) / PR [#1752](https://github.com/45s/coinzilla/pull/1752). |

The existing `.github/ISSUE_TEMPLATE/cross-domain-request.md` receives the same preflight block; its established cross-domain request fields remain intact. The canonical continuous issue knowledge-capture rule is in [AI_AGENT_WORKFLOW.md](../AI_AGENT_WORKFLOW.md). This pending addition does not change the historical recursive-count checkpoint above.



---

## dashboard-roadmap

Archived source path: `apps/dashboard/ROADMAP_HISTORY_2026-11-26.md`

<!-- Preserved verbatim from apps/dashboard/ROADMAP.md during documentation consolidation on 2026-11-26. Historical record; not current status authority. -->

# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

- **Next — full record inspection and operator-console hardening:** show every persisted key/value (including nested data) for Orders, Fills, and Commissions; harden the existing local Operator workspace and its backend integration. Do not implement UI-only pause state or call exchange APIs from the browser.

## Current milestone

- **Complete in merged Dashboard PR [#1822](https://github.com/45s/coinzilla/pull/1822), tracked by [Issue #1821](https://github.com/45s/coinzilla/issues/1821):** the read-only GitHub PRs page lists every open `45s/coinzilla` pull request, current head-commit committer timestamps and browser-local work labels. The behavior contract and scenarios live in [the GitHub PR Dashboard feature folder](docs/features/github-pr-dashboard/SPEC.md); the documentation-only specification was completed in [Issue #1816](https://github.com/45s/coinzilla/issues/1816) and merged [PR #1817](https://github.com/45s/coinzilla/pull/1817). All six required workflows passed on exact PR head `90b54db54f926ac5197d3984ac043645b693b57e`. The page uses public read-only GitHub REST, with no GitHub mutations or credentials; custom labels remain in browser localStorage.

- **Complete in merged Dashboard PR [#1812](https://github.com/45s/coinzilla/pull/1812), tracked by [#1811](https://github.com/45s/coinzilla/issues/1811) and [#1813](https://github.com/45s/coinzilla/issues/1813), both closed.** The live Bots workspace provides Harvester runtime/strategy-mode visibility, market enablement/readiness, Portfolio positions and confirmation-gated BUY pause controls. Runtime/market/Portfolio snapshots use the versioned local WebSocket stream with monotonic revisions, race-safe initial synchronization, explicit unavailable/stale states and bounded reconnect backoff. Confirmed BUY commands use the existing HTTP operator facade. Per-strategy registration state and per-Position strategy attribution remain unavailable and are not inferred.

- **Complete in merged Dashboard PR [#1737](https://github.com/45s/coinzilla/pull/1737), tracked by [#1736](https://github.com/45s/coinzilla/issues/1736):** make Exchanges searchable/filterable with persistent favourites pinned first; add a separate live Open Orders page grouped by connected CEX/provider; stream initial and refreshed account/order snapshots from Harvester over WebSocket only. The two pages make no HTTP requests. Existing persisted trading-history and Operator workflows remain unchanged.

- **Selectable dashboard themes complete in merged [PR #1686](https://github.com/45s/coinzilla/pull/1686), tracked by [#1685](https://github.com/45s/coinzilla/issues/1685):** preserve the existing Emerald appearance as default; add Midnight Terminal, Clean Light, OLED / Neon, Green Terminal, Arctic, and Warm Graphite palettes plus System mode, with browser-local preference persistence. No operator or trading behavior changes.

- **Market Screener complete in merged [PR #1661](https://github.com/45s/coinzilla/pull/1661), tracked by [#1660](https://github.com/45s/coinzilla/issues/1660):** Bitunix Futures is the default working source; Bitunix Spot, Binance Futures, and Binance Spot remain unavailable placeholders. The backend reads public Bitunix contract/ticker REST resources and the Dashboard displays native fields only, passes through Bitunix's native rolling 24h ticker percentage, keeps absent 5m/1h/4h windows N/A, and stores per-source favourites in browser cookies. No local movement calculations, exchange credentials, or trading-provider admission.
- **Read-only trading-history pages complete in merged [PR #1636](https://github.com/45s/coinzilla/pull/1636), tracked by [#1634](https://github.com/45s/coinzilla/issues/1634):** Orders, Fills, and Commissions pages backed by Harvester's unauthenticated loopback-only versioned API, backend-selected environment, filters, bounded pagination, record details, readable exchange references, distinct limit/execution/fee-valuation labels, nullable fill-order links, explicit connection/error/empty states, and frontend regression tests.
- **Complete in merged [PR #1641](https://github.com/45s/coinzilla/pull/1641), tracked by [#1643](https://github.com/45s/coinzilla/issues/1643):** local WebSocket invalidation notifications for persisted order, fill, and commission changes; live/reconnecting/offline UI status; bounded reconnect backoff; and REST snapshot reconciliation after every successful socket connection. REST remains the source of truth. Notifications are best-effort and are not durable replay.
- **Operator workspace runtime integration complete in merged [PR #1654](https://github.com/45s/coinzilla/pull/1654):** the Dashboard Operator page and typed client already exist; this PR wires the running Harvester's composed operator facade into the loopback API. The API remains unauthenticated and loopback-only under the explicitly approved local-development exception.
- [x] Initialize the Angular + TypeScript workspace, responsive shell, Overview screen, demo-only view models, tests and repository ownership/CI registration.
- [x] Generate and commit the pnpm lockfile after local dependency installation.
- [x] Verify the Angular production build and tests through GitHub Actions on the exact task PR head.

## Future capability areas

These are planning areas, not commitments to bypass backend ownership or existing trading safety requirements:

- Authenticated, typed, read-only integration for positions and service diagnostics.
- Environment-aware TESTNET/LIVE presentation with explicit backend-reported state and readiness.
- Searchable diagnostics views backed by server APIs.
- Order-entry and operator-control workflows only after the backend exposes authorized endpoints that use existing Harvester application use cases.
- Optional desktop packaging with Tauri after the web application and its API contracts are stable.

## Constraints

- Keep the browser a presentation/client layer; no direct database, broker or exchange integration.
- Keep feature modules independently testable and avoid introducing a global state framework before multiple features need shared state.
- Keep mock/demo fixtures clearly separated from production API models.
- Update this roadmap when the issue scope or delivered milestone changes. Do not use it as a chronological task log.

## Strategy-neutral Scenario Runner — issue #1836

Open Draft [PR #1837](https://github.com/45s/coinzilla/pull/1837) carries the Dashboard presentation and Harvester execution foundation. The PR branch is synchronized with current `develop` after merged PRs #1852 and #1798. The merged RS registry (#1852) is a test-only source of scenario definitions and evidence; the production runner must not misrepresent it as an executable runtime catalogue.

Implemented on the task branch: generic run lifecycle/API, process worker adapter and cooperative cancellation/cleanup, Dashboard trace/debug UI, source-revision provenance, same-revision replay with explicit blocking when provenance is unknown/mismatched, and Node-level worker API guards. The worker guards are defense-in-depth, not OS isolation. Run history remains in-memory by accepted MVP decision.

Still required: production RS use-case adapter and faithful simulation ports; safe integration of merged scenario definitions/mappings; a trusted OS-level sandbox for production execution; complete execution-produced trace/assertions/effective configuration/events; and exact-head verification after synchronization. Do not enable any scenario until the adapter and isolation gates are genuinely satisfied.

## Approved Scenario Runner lifecycle decision — 2026-11-25

Scenario execution uses explicit server-owned states: Accepted/Queued → Starting → Running, with Cancelling as a non-terminal shutdown state and terminal outcomes Completed, Failed, Cancelled, Timed out or Blocked. Cancellation is cooperative first, followed by forced worker termination after a configurable grace period. Repeated cancellation is idempotent; a cancelled run is never reported as passed/completed. Timeouts remain distinct from user cancellation. Preserve partial trace/diagnostics when safely available, fail closed if worker initialization/isolation cannot be verified, and release resources on every terminal path. WebSocket publishes state changes; REST remains authoritative after reconnect. Numeric timeouts/grace periods and OS-level termination/cleanup details require implementation audit.

## Approved Scenario Runner result retention and AI-debug report — 2026-11-25

Harvester persists bounded server-side run history with configurable retention/size limits. The persisted simulation-only evidence includes run identity/status/lifecycle, strategy/scenario and code versions, effective configuration and inputs, ordered events, outputs, steps/decisions/trace, assertions and diagnostics. Scenario-definition storage is separate. Secrets, credentials, live account data and production state are excluded.

Dashboard provides **Copy AI Debug Package** for an inspectable run: one self-contained, versioned JSON document with complete available inputs, outputs, statuses, events, steps, decisions, assertions, diagnostics and provenance, suitable for AI agents. It identifies the executed production revision (not merely the target branch), strategy/adapter, scenario/scenarioId and runId. Never silently truncate; offer a complete export or segmented-copy fallback if clipboard constraints prevent full copy. Report generation remains framework-independent; Angular is presentation only.

## Approved Scenario Runner AI-debug and access decisions — 2026-11-25

The AI Debug Report is self-contained as complete execution evidence, not as a copy of the source repository/docs. It must stand alone without the original server run. Repository access is explicitly permitted for faster, deeper debugging: use the report's executed revision and scenario provenance to audit matching production source, architecture/specification docs, scenario definitions and mapped tests; establish why/how the scenario should behave; compare that intended behavior with captured trace/results; and cite exact source files/lines/tests. Do not confuse expected behavior with observed execution.

The initial runner is unauthenticated and **strictly loopback-only for local development**. Do not expose it on LAN, public or remote interfaces. Remote/shared access is blocked until authentication and server-side authorization are designed and implemented. Actual bind enforcement and existing local API integration require implementation audit.

## Scenario Runner — RS configuration unit and replay clarification (2026-11-25)

Documentation must use actual RS config fields/values and explicit units. For every RS market, `minProfit: 0.01` means **0.01 units of that market's quote asset as absolute net profit, never 1%**. For the LINEAUSDT TESTNET example this is 0.01 USDT (one USDT cent); `priceStepPercent: 0.5` is a 0.5% price-step setting. Distinguish base quantities (LINEA), quote amounts (USDT), percentages and derived values. Do not invent standalone average-entry inputs; derive legacy average cost from configured legacy basis and label it as derived. Market prices and simulated broker outcomes are ordered scenario events, sourced from existing scenario/test evidence or explicitly authored and validated—not fabricated as configuration.

Approved replay scope is original-version replay only: execute the original scenario against its exact recorded production revision and original inputs/configuration. Newer-revision regression comparison is not currently in scope.

**Universal RS rule:** `minProfit` is an absolute net-profit amount in the selected market's quote asset for every RS market. `0.01` always means 0.01 quote-asset units, never 1%; the LINEAUSDT/USDT-cent example above is illustrative only.

## Approved Scenario Runner Playground decisions (2026-11-25)

Original scenario replay uses the exact recorded production revision and original scenario/configuration/inputs. The Playground creates a temporary run-local copy where users can change market and strategy configuration; edits never modify or save over the original scenario.

Configuration loaded from a file and configuration entered in the client Playground must pass through the same production parsing, validation, normalization and market-metadata resolution. Strategy code receives validated effective configuration and cannot distinguish its source. Invalid configuration blocks execution before strategy evaluation.

The UI action is **Copy AI Debug Package** and copies complete versioned JSON only, including original scenario, temporary overrides, validated effective configuration, executed revision, ordered events, results, trace and diagnostics. Repository access at the recorded revision is expected for deeper AI-agent debugging.

## Scenario Runner roadmap
See [the phased implementation roadmap](docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Within the approved Scenario Runner task, trading logic and services may be refactored as required for faithful production-flow reuse on the task branch. Preserve real trading behavior and safety invariants, add regression tests, document changed paths and inspect affected consumers. This does not authorize unrelated trading changes or real exchange operations.

### Strategy Scenario Runner agent rules

Before exploration or edits, agents MUST read root `AGENTS.md` and all applicable nested `AGENTS.md`. This requirement is stated in Issue #1836, PR #1837 and the Runner roadmap. Trading logic/services may be refactored as needed to faithfully reuse production flows; preserve trading safety and behavior, add regression tests, and stay exclusively on the task branch/PR. Never commit directly to `develop`/`main` or merge/auto-merge.

### Scenario Runner CI correction — 2026-11-25

The exact-head Dashboard build exposed two integration defects in the framework-independent input validator: the Dashboard workspace did not declare its direct `@coinzilla/utils` dependency, and a local TypeScript cast omitted the optional `exclusiveMinimum` schema field used by decimal validation. The package dependency, lockfile importer and precise field type are now aligned. Validation remains in the core/application layer and Angular remains a presentation adapter. Exact-head build/test/coverage reruns are required before claiming the correction is green.

The Dashboard validator now consumes the dedicated browser-safe decimal subpath rather than the Node-oriented Utils root. This preserves exact comparison while avoiding bundling Node-only filesystem, child-process, event and crypto exports.

### Dependency-boundary correction — 2026-11-25

The initial attempt to reuse `@coinzilla/utils` from Dashboard was rejected by the canonical workspace dependency allowlist. Rather than broaden the approved dependency graph, the Scenario Runner now uses a narrowly scoped pure decimal-string comparator in the Dashboard core, with exact BigInt-based tests. This is framework-independent business/application logic, not Angular component logic; the UI remains a presentation adapter.



---

## database-roadmap

Archived source path: `packages/db/ROADMAP_HISTORY_2026-11-26.md`

<!-- Preserved verbatim from packages/db/ROADMAP.md during documentation consolidation on 2026-11-26. Historical record; not current status authority. -->

# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Purpose

The accepted architecture is recorded in [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md); see the [local documentation index](./docs/README.md).

`@coinzilla/db` provides a provider-neutral record CRUD and transaction API. Node.js built-in `node:sqlite` is the first concrete provider. The package owns generic persistence infrastructure contracts only; application domains own their business entities, schemas and repository interfaces.

## Application-owned relational schema infrastructure — #1486

**Status: Done.** [PR #1489](https://github.com/45s/coinzilla/pull/1489) merged into `develop` on 2026-11-19 as `ee38250521d6386ce53b080b4fb6414812cf9e91`. All required checks passed on the exact final PR head before merge.

The audit confirmed that the low-level SQL, prepared-statement, transaction, migration, backup and restore APIs already exist. The demonstrated gaps are migration callback mutation detection and rejection of a pending lower version after a higher version has already been applied.

The scoped implementation adds source fingerprints to newly applied migration history, safely upgrades legacy `schema_migrations` tables while preserving their existing rows, rejects modified checksummed migrations and out-of-order pending versions, and adds regression coverage for legacy upgrades, reconnect persistence and migrated-schema backup/restore. Legacy rows retain an explicit `legacy-unverified` marker and continue to use version/name validation because their original callback source cannot be reconstructed.

The accepted boundary remains unchanged: applications own physical relational schemas, migrations, repositories and business rules; this package owns generic SQLite infrastructure. No Harvester tables or persistence changes belong in this task. Mark complete only after the PR is merged and all required checks pass on its exact final head.

## SQLite infrastructure audit and hardening — #1395

**Status: Done.** [PR #1396](https://github.com/45s/coinzilla/pull/1396) merged into `develop` on 2026-11-18 as `81669ce2be6794b9bd03067f89b57f8fdb55f957`. The audit hardened SQLite connection lifecycle and cleanup, concurrent WAL initialization, transaction-handle lifetime, backup/restore failure preservation, and filesystem error classification. All implementation remains within this package's infrastructure boundary.

**Verification on exact PR validation head `75df31e7fcb8e123f86996dbf1876c4fc6073b6e`:**

- `@coinzilla/db`: 198 tests — 185 passed, 13 capability-specific skips, 0 failures.
- Production-source coverage: 100% lines / 99.64% branches / 100% functions; package thresholds (98% / 95% / 100%) passed.
- Required PR workflows passed: workspace unit tests and coverage, JavaScript syntax (including full-workspace and changed-file ESLint, agent-policy and actionlint), dependency audit, Utils tests, Harvester targeted tests, and external documentation links.
- Read-only Binance TESTNET integration was skipped by workflow policy and is outside this database-only task.

The merged commit retains the validated source tree. Detailed defect evidence and exact workflow history remain in [issue #1395](https://github.com/45s/coinzilla/issues/1395) and [PR #1396](https://github.com/45s/coinzilla/pull/1396), rather than being duplicated as a roadmap log.

**Operational limits remain:** SQLite serializes writers; WAL is same-host only (not NFS/SMB); synchronous `DatabaseSync` calls block the Node.js event loop; restore publication requires hard-link support. Disk-full, power-loss and hardware I/O behavior cannot be fully reproduced in shared CI. Backup schedules, retention, encryption, off-site storage, deployment paths, restore drills and runbooks remain application-owned.

**Next work is evidence-driven, not another speculative DB feature.** Consumer repository/schema integration belongs to the consumer domain and remains tracked by [umbrella issue #1327](https://github.com/45s/coinzilla/issues/1327). Add generic DB capabilities only when a concrete consumer requirement demonstrates a provider-neutral contract gap.

## Provider-neutral CRUD API — core implementation and hardening merged

**Core implementation:** [PR #1353](https://github.com/45s/coinzilla/pull/1353) merged into `develop` as `70f1345054bf619dca01896817967eeba6ad1141`; it delivered the provider-neutral CRUD facade, built-in SQLite provider, reusable conformance suite, and public documentation.

**Post-merge hardening — COMPLETE:** [PR #1364](https://github.com/45s/coinzilla/pull/1364) merged the validated CREATE snapshot consistency fix. [PR #1365](https://github.com/45s/coinzilla/pull/1365) merged synchronous transaction rollback isolation. Both fixes preserve the public API and existing SQLite lifecycle.

**ESLint cleanup — COMPLETE:** the package-specific `packages/db` ESLint cleanup is complete (validated commit `85ad08be61342d8f543d970f102fafeae367eb78`). It is not an active roadmap item. Continue to enforce the repository's strict `pnpm lint` gate and fix only new violations introduced by future changes.

The approved design is:

```text
Consumer / composition root
          |
          v
   createDatabase({ provider })
          |
          v
 Provider-neutral CRUD facade
          |
          v
   Database provider port
          |
          v
 Concrete infrastructure adapter
       (SQLite first)
```

The package defines what database operations mean. Each provider implements how those operations work. Provider-specific configuration is supplied only at composition. Consumers use the same CRUD and transaction methods regardless of provider.

### Delivered implementation

The following core delivery steps were completed by merged PR #1353:

1. **Provider-neutral contract and composition**
   - Define JSON record identity/shape, collection names, exact-match filters, sorting, pagination, operation results, error classes, transaction context and capability declarations.
   - Preserve the existing `createDatabase({ adapter })` lifecycle facade and `createSqliteDatabase(...)` low-level SQL/migration API.
   - Keep the new `createDatabase({ provider })` facade provider-neutral.
   - Verify invalid input, duplicate identifiers, missing records and capability snapshots.

2. **SQLite provider**
   - Use only built-in `node:sqlite`, prepared statements and bound parameters.
   - Support file-backed and in-memory storage.
   - Store generic JSON records by collection and string identifier; do not introduce application schemas.
   - Preserve current WAL, foreign-key, timeout, synchronous transaction and resource lifecycle behavior.

3. **Provider conformance suite**
   - Reusable tests cover CREATE/READ/UPDATE/DELETE, collection isolation, filtering, sorting, pagination, identifiers, duplicates, error semantics, transaction commit/rollback, lifecycle, reconnect persistence and cleanup.
   - Run the contract against every storage mode declared by the provider, using isolated test keys. Verify file/server persistence by reconnecting with the same key; explicitly skip reconnect persistence for ephemeral memory storage.
   - The suite verifies nested-transaction declarations, portable scalar sort ordering, close-time draining of active asynchronous transactions, and the optional provider-owned cleanup hook for server-backed test stores. Synchronous providers receive an explicit skip for the inapplicable async-drain case.
   - The SQLite provider must pass the complete applicable suite for both in-memory and file-backed modes.
   - Future providers must run the same suite; provider-specific capability differences must be declared rather than silently emulated.

4. **Documentation and hardening**
   - Publish copy-paste examples for provider composition, CRUD, query, transaction and error handling.
   - Verify public exports contain no driver objects, SQL statements or provider-native errors.
   - Run package tests/coverage, workspace tests, full lint, agent-policy checks and required CI on the exact PR head.

### Explicit boundaries

- No ORM, query builder, schema generator or universal SQL abstraction.
- No trading, Harvester, Journal, Operational State Store, order, fill, execution or portfolio entities/repositories/schemas.
- No speculative PostgreSQL or MongoDB adapter implementation.
- No consumer integration in this task. A real application's repository contract remains owned by that application's bounded context and its roadmap.

## Provider-neutral API contract

The intended public composition is:

```js
const database = createDatabase({
  provider: createSqliteProvider({
    filename: "./data/app.db",
  }),
})

await database.connect()
await database.create({
  collection: "users",
  record: { id: "user-1", name: "John" },
})
const user = await database.readOne({
  collection: "users",
  id: "user-1",
})
await database.update({
  collection: "users",
  id: "user-1",
  changes: { name: "Peter" },
})
await database.delete({
  collection: "users",
  id: "user-1",
})
await database.close()
```

- Records are JSON-safe plain objects with non-empty string identifiers.
- Identifiers are unique within a collection.
- READ ONE returns a record or `null`; UPDATE returns the updated record or `null`; DELETE returns a boolean.
- Duplicate identifiers raise a provider-neutral conflict error.
- READ MANY supports exact equality filters, ordered sorting and offset/limit pagination.
- Transactions expose the same CRUD methods, never provider-native transaction objects.
- Provider capabilities are exposed as a frozen, provider-neutral snapshot.

See the [README](./README.md) for the current detailed contract, examples and SQLite runtime constraints. Implementation status remains in the issue/PR; do not mark roadmap steps complete until the PR is merged and required checks pass.

## Generic SQLite backup and restore primitives — merged

**Implementation:** [PR #1382](https://github.com/45s/coinzilla/pull/1382) merged into `develop`; tracking issue [#1381](https://github.com/45s/coinzilla/issues/1381). The package provides native online backup, integrity/foreign-key validation, temporary-file staging, atomic backup publication, and no-overwrite restore publication. These are SQLite infrastructure primitives only; retention, encryption, off-site storage, scheduling, compatibility policy and restore runbooks remain application-owned.

**Follow-up reliability audit — COMPLETE:** [Issue #1395](https://github.com/45s/coinzilla/issues/1395) closed after [PR #1396](https://github.com/45s/coinzilla/pull/1396) merged. Exact-head tests, coverage and required CI passed; the audit included the merged backup/restore primitives. See the completed audit status above and the linked issue/PR for detailed evidence.

## Existing SQLite functionality — preserved

The package already provides and must retain:

- Node.js built-in `node:sqlite`, with no external driver or ORM.
- File-backed and explicit `:memory:` databases.
- Foreign-key enforcement, WAL for file-backed databases and configurable lock timeout.
- Explicit connection lifecycle and close-time transaction draining.
- Synchronous SQLite transactions with commit/rollback and nested/async callback rejection; transaction handles and prepared statements are invalidated after commit or rollback.
- Ordered, atomic, versioned schema migrations with source checksums for newly applied migrations, legacy-history compatibility, identity validation and out-of-order protection.
- WAL-aware native online backups, integrity and foreign-key validation, atomic backup publication, and atomic no-overwrite restore.
- Deterministic tests using real in-memory and temporary file-backed SQLite databases.

The low-level public API remains available:

- `createSqliteDatabase({ filename, timeout })`
- `connect()` / `close()`
- `exec(sql)` / `prepare(sql)`
- `transaction(work)`
- `readTransaction(work)` for deferred-lock read workloads
- `migrate(migrations)`
- `state`
- Legacy `createDatabase({ adapter })` lifecycle composition

## Consumer ownership boundary

Application domains own their business entities, schemas, repository interfaces, persistence workflows, and operational policies. This package supplies generic database APIs and concrete provider infrastructure only. No application-specific repositories, schemas, or operational workflows belong here.

## Deferred — evidence-driven

1. **Further application-owned repository integrations**
   - Each consumer owns its repository contract, business schema and migrations.
   - Keep consumer integrations outside `packages/db`; add generic database capabilities here only when a concrete consumer requirement exposes a provider-neutral contract gap.
   - Verify restart persistence, transaction behavior, concurrency, migration compatibility and deterministic cleanup in the owning consumer's tests.

2. **Application-owned backup and restore policy**
   - Generic SQLite backup/restore primitives were implemented by merged PR #1382.
   - Applications decide schedules, retention/rotation, encryption, off-site storage, deployment paths, version compatibility, permissions, restore drills, and operational runbooks. Do not move those policies into this package.

3. **Additional providers**
   - Reassess PostgreSQL or MongoDB only when measured deployment topology, concurrent writers, availability, dataset size or query requirements justify them.
   - A new adapter must pass the provider conformance suite and declare any capability differences.
   - Do not claim portability for guarantees a provider cannot provide.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop`, relevant tests and coverage pass, required CI passes on the exact final PR head, and affected living documentation is current.



---

## entities-roadmap

Archived source path: `packages/entities/ROADMAP_HISTORY_2026-11-26.md`

<!-- Preserved verbatim from packages/entities/ROADMAP.md during documentation consolidation on 2026-11-26. Historical record; not current status authority. -->

# Entities roadmap

---
status: active
type: roadmap
owner: entities
---

## Priority execution plan — current develop direction (2026-11-21)

### IMPORTANT — preserve canonical financial and broker contracts

1. **Strengthen cross-package contract conformance for financial values and execution facts.**
   - **Why:** Entities is the shared language for Money, Quantity, Balance, Fill, Commission, Order, Market and broker outcomes. A subtle contract mismatch can corrupt accounting or reconciliation in every consumer.
   - **Do:** maintain exact decimal-string invariants, immutable values, explicit fee asset identity and COMPLETE/PARTIAL/UNKNOWN fee semantics. Add consumer contract cases for partial fills, duplicate/conflicting trade IDs, unknown order outcomes, locked/free balances and missing commission data.
   - **Verify:** test values at precision/scale boundaries, negative Money versus non-negative Quantity, malformed IDs, unsupported values and serialization round trips. Never convert financial values through JavaScript Number.

2. **Keep Entities independent of infrastructure and application packages.**
   - **Why:** importing logging, file-system or event infrastructure into shared value objects would make every consumer inherit unrelated dependencies and weaken dependency direction.
   - **Do:** review imports and public exports; replace broad utility imports with narrowly scoped pure decimal/result helpers where practical. Keep exchange-specific parsing and strategy policy outside Entities.
   - **Verify:** add an architecture test that rejects imports from Brokers, Harvester, Journal, Event Bus, DB and infrastructure modules. Run package and workspace tests after each import change.

3. **Establish package-owned coverage and contract-test gates — COMPLETE in merged PR #1578.**
   - **Why:** the workspace aggregate can hide a weak shared package behind the coverage of other packages. Entities contracts are high leverage and need their own regression signal.
   - **Do:** measure production-source coverage by package and enforce a package-scoped threshold without counting imported Utils implementation files. [PR #1578](https://github.com/45s/coinzilla/pull/1578) adds `test:coverage` with 90% lines, 85% branches and 85% functions, based on the observed Entities source coverage report.
   - **Verify:** the required Workspace test coverage matrix must run this package command and prove it passes on the exact PR head. Node's test runner exits non-zero when a configured threshold is missed. Mark complete only after exact-head CI is green and the PR is merged.

### Coverage command

- `pnpm --filter @coinzilla/entities run test:coverage` measures only Entities production source (`src/**/*.js`, excluding tests and imported packages) and enforces 90% lines, 85% branches and 85% functions.
- The required workspace coverage matrix invokes this command once. The matrix-completeness guard verifies the package remains included and retains both `test` and `test:coverage` scripts.
- **Measured on PR #1578 exact head `32dc8a094691d08754a3874b0719135b0c441bc5`:** 156 tests passed; production-source coverage was 96.33% lines, 94.33% branches and 95.40% functions. The configured gate is therefore below the measured baseline and passed without adding tests solely to inflate coverage.
- This gate is complete: [PR #1578](https://github.com/45s/coinzilla/pull/1578) merged as `2979bcde1556103c351760281c375010e3655b51`; exact-head Unit Tests, Test Coverage, JavaScript Syntax, Dependency Audit, Harvester Targeted Tests and External Documentation Links all passed.

### DEFERRED — only with a demonstrated contract need

4. **Add new domain entities or expand existing contracts only for a real consumer.**
   - **Why:** speculative abstractions increase coupling and make canonical contracts harder to evolve.
   - **Do:** document the owning bounded context, invariants, compatibility and migration path before adding a public value/entity.
   - **Verify:** add focused domain tests and consumer migration tests; preserve backward compatibility unless a deliberate versioned change is approved.

**Owner:** `packages/entities/`
**Purpose:** maintain small, exchange-neutral domain contracts shared by applications and adapters.

Read [the entity agent instructions](./AGENTS.md) and [the domain ownership guide](../engineering/DOMAIN_OWNERSHIP.md).

### Completed maintenance — ESLint compliance

- [x] **Package ESLint cleanup — COMPLETE / superseded by the workspace gate.** [Issue #1228](https://github.com/45s/coinzilla/issues/1228) is closed. The required full-workspace `pnpm lint` gate checks every in-scope JavaScript file and fails on errors or warnings; progressive strict changed-file enforcement adds tighter thresholds for new and modified files. No package ESLint cleanup remains outstanding. Fix future findings in the PR that introduces them.

## Principles

- Stable canonical identity; do not infer asset identity from exchange symbols.
- Exact decimal representations for financial amounts and increments.
- Immutable, explicit value contracts with validation at construction/boundaries.
- Preserve existing public behavior unless a migration is deliberately designed.
- No exchange SDK dependencies or venue-specific payload fields in shared entities.

## Roadmap

- [x] **FR-008 — Asset and Market identity.** Stable Asset identity and explicit Market base/quote assets; symbol remains opaque. Implemented in `@coinzilla/entities` and integrated into `develop` via PR #295; delimiter-containing venue symbols are preserved as opaque metadata (PR #303).
- [x] **FR-009 — Exact Money and Quantity.** Implemented immutable `Money` and `Quantity` values using validated, canonical decimal strings and explicit `Asset` identity. Money supports signed values; Quantity is non-negative. Numeric JavaScript inputs and scientific notation are rejected. Integrated into `develop` via PR #299.
- [x] **FR-010 — Canonical Order lifecycle.** Implemented immutable `CanonicalOrder` with client/broker identity, canonical Market, exact limit price and quantities, derived remaining quantity, normalized lifecycle including `UNKNOWN`, and optional timestamps. Integrated into `develop` via PR #300.
- [x] **FR-011 — Fill.** Implemented immutable, independently identifiable execution records with stable market-scoped trade identity, canonical order identity, exact base/quote quantities and execution price, optional maker/taker role, and optional execution timestamp. Integrated into `develop` via PR #301.
- [x] **FR-012 — Commission.** Implemented immutable Commission values backed by exact non-negative `Money`, with explicit fee asset identity and zero/one/multiple fee entries on Fill. `COMPLETE`, `PARTIAL`, and `UNKNOWN` collection semantics prevent unknown or incomplete fees from being interpreted as zero. Integrated into `develop` via PR #302.
- [x] **FR-013 — Balance.** Implemented immutable Balance values with exact free and locked quantities, canonical asset identity, and total derived using decimal-string arithmetic. Integrated into `develop` via PR #306.
- [x] **FR-014 — TradingRules.** Implemented immutable, exchange-neutral Market-scoped price/quantity/notional constraints with explicit supported, unsupported, dynamic, and unknown states. Integrated into `develop` via PR #307.
- [x] **FR-015 — Broker capability contracts.** Implemented immutable exchange-neutral capability snapshots with explicit supported, unsupported, and unknown states. Extended in PR #1455 to serve as the sole shared contract for evidence-backed provider declarations (provider/product/environment identity and generic method/guarantee/limitation/reason/condition metadata, including separate native `SUBSCRIBE_USER_DATA` and polling `OBSERVE_USER_DATA` delivery capabilities) while preserving the original capability-only value shape. Brokers re-exports and populates this Entities contract; no parallel capability model remains.
- [x] **FR-016 — Broker result contracts.** Implemented immutable normalized success, failure, incomplete, and unknown-outcome envelopes. Integrated into `develop` via PR #309.

### FR-009 contract boundary

- Both value types require an existing canonical `Asset` instance; ticker strings alone are not sufficient identity.
- Amounts are decimal strings only, trimmed and canonicalized without floating-point conversion. Leading integer zeros and trailing fractional zeros are removed; negative zero becomes `0`.
- Plain decimal notation is accepted. Exponent notation, non-finite values, malformed syntax, and unsupported precision are rejected.
- Maximum supported precision is 256 total digits and 100 fractional digits, matching the supported decimal arithmetic bounds.
- `Money` permits negative values for losses, adjustments, and deltas. `Quantity` represents a magnitude and rejects negative values.
- Both entities are immutable and expose independent `value` snapshots containing the canonical amount and an Asset snapshot. They intentionally provide no arithmetic methods.
- Existing `Coin`, `Order`, and `ExecutedOrder` behavior is unchanged.

### FR-010 contract boundary

- `CanonicalOrder` is the new exchange-neutral order snapshot; the existing Number-based `Order` and `ExecutedOrder` remain unchanged for compatibility and are not used as the canonical strategy contract.
- `clientOrderId` is the stable client-side identity and is required for an order intent. `brokerOrderId` is absent until acknowledged by the broker.
- The order references a canonical `Market`, `Quantity` values in its base Asset, and an optional `Money` limit price in its quote Asset.
- Original and executed quantities are exact, non-negative quantities. Remaining quantity is derived exactly as original minus executed; executed quantity cannot exceed original quantity.
- Lifecycle statuses are exchange-neutral: `PENDING`, `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED`, and `UNKNOWN`. `UNKNOWN` is unresolved, not a terminal success/failure state.
- `OPEN` has no execution; `PARTIALLY_FILLED` has both executed and remaining quantity; `FILLED` has no remaining quantity. `PENDING` has no broker ID and no execution.
- Optional timestamps are non-negative safe-integer Unix epoch milliseconds. Missing timestamps remain absent; they are never fabricated.
- Value snapshots contain only canonical Coinzilla contracts and no exchange-specific fields. Lifecycle changes produce a new immutable snapshot.

### FR-011 contract boundary

- A Fill is an immutable execution fact, not an order or order-status snapshot.
- `tradeId` is the broker-provided stable execution identifier; canonical `id` is scoped by the canonical `Market` identity so trade IDs from different markets cannot collide.
- `brokerOrderId` is required; `clientOrderId` is optional when the source does not provide it.
- `Market`, base-asset `Quantity`, quote-asset `Money` price, and quote-asset `Money` quote quantity are explicit contracts. No exchange symbol parsing or asset inference occurs.
- Quantity, price, and quote quantity must be strictly positive. The actual quote quantity is preserved independently; it is not recomputed from price and base quantity.
- Liquidity role is `MAKER`, `TAKER`, or `UNKNOWN`; missing information defaults to `UNKNOWN`, never an inferred value.
- Execution time is an optional non-negative safe-integer Unix epoch millisecond timestamp. Missing time remains absent.
- Commission facts are deliberately excluded and belong to FR-012.

### FR-012 contract boundary

- `Commission` is an immutable fee value containing an exact `Money` amount; the Money asset identifies the fee denomination explicitly.
- Commission amounts are non-negative. Zero is valid, although a confirmed zero-fee fill is represented by an empty commission list with `COMPLETE` status.
- A Fill's `commissions` is an immutable array of Commission values and may contain entries denominated in different assets.
- `COMPLETE` means the collection is authoritative; an empty list explicitly means no commission was charged.
- `PARTIAL` means one or more commission entries are known, but the collection is incomplete.
- `UNKNOWN` means commission information is unavailable; its collection must be empty. Missing status defaults to `UNKNOWN`.
- Consumers must not treat `PARTIAL` or `UNKNOWN` commission information as zero when calculating realized profitability.

### FR-013 contract boundary

- `Balance` represents one canonical Asset and requires explicit free and locked `Quantity` values.
- Free and locked quantities must use the same canonical Asset ID; matching display codes are not sufficient.
- Total is derived exactly as free plus locked using decimal-string integer arithmetic, never JavaScript floating-point arithmetic. It cannot be supplied inconsistently by a caller.
- All three quantities are immutable `Quantity` values in the same Asset. Zero free, locked, or total balances are valid.
- The value snapshot includes the canonical Asset identity and independent free, locked, and total quantity snapshots.

### FR-014 contract boundary

- `TradingRules` is scoped to one canonical `Market`; it contains exchange-neutral constraints and no venue-specific filter names or payloads.
- Each constraint has a stable type and an explicit `SUPPORTED`, `UNSUPPORTED`, `DYNAMIC`, or `UNKNOWN` status. A missing constraint is not evidence that the venue does not enforce it.
- Supported price and notional constraints use exact quote-asset `Money`; supported quantity constraints use exact base-asset `Quantity`.
- Supported constraints require a value. Unsupported, dynamic, and unknown constraints must not carry a fabricated static value.
- Increment constraints must be greater than zero; all supported values must be non-negative. When both minimum and maximum bounds are supported, minimum cannot exceed maximum.
- Constraint types are unique within a snapshot. Constraint arrays and records are immutable; value snapshots are independent.

### FR-015 contract boundary

- `BrokerCapabilities` is the single immutable exchange-neutral capability value used by Entities and Brokers. It owns the capability vocabulary, three statuses, validation, lookup and serialization. Optional provider-declaration metadata identifies the provider/product/environment and documents implementation evidence; it contains no exchange wire payloads or protocol-specific DTOs.
- The shared vocabulary covers account/market reads, order and trade reads, limit/market placement, cancellation, market-price subscriptions, user-data subscriptions, and trading-rule reads.
- Each reported capability has an explicit `SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN` status. An omitted capability is `UNKNOWN`, never assumed unsupported or supported.
- Capability types are unique within a snapshot. The status lookup validates the requested vocabulary and returns `UNKNOWN` for unreported capabilities.
- Capability discovery is descriptive only; it does not imply that an operation is currently authorized, healthy, or safe to execute. Runtime permission and recovery state remain separate concerns.

### FR-016 contract boundary

- `BrokerResult` is a venue-neutral result envelope with `SUCCESS`, `FAILURE`, `INCOMPLETE`, and `UNKNOWN` statuses.
- `SUCCESS` contains no errors and may optionally carry data, including successful operations with no payload.
- `FAILURE` is a definitive unsuccessful result: it requires one or more errors and carries no data.
- `INCOMPLETE` carries partial data and one or more errors describing what is missing or incomplete.
- `UNKNOWN` represents an unresolved operation outcome, requires one or more errors, and carries no data. It must not be treated as a definitive failure or blindly retried, especially for state-changing operations.
- `ok` is true only for `SUCCESS`; incomplete and unknown outcomes are not successes.
- The result envelope and error collection are immutable. The generic data payload is opaque and remains owned by the caller; its own immutability is defined by its payload contract.

## Completion policy

An item is complete only after its focused tests pass, its PR is merged into `develop`, and affected consumers are identified. Do not implement multiple FR contracts in one broad PR. Coordinate consumer migrations through cross-domain requests.

## Completed — coordinated Utils validation API removal ([#1508](https://github.com/45s/coinzilla/issues/1508), [PR #1509](https://github.com/45s/coinzilla/pull/1509))

- The legacy `Validator` facade was removed and `Coin`/`Order` no longer import it.
- **Correction completed:** PR #1509 replaced those calls with handwritten checks rather than using the shared `ensure` API, contrary to the shared-utilities policy. This was corrected in [#1511](https://github.com/45s/coinzilla/issues/1511) and merged as [PR #1512](https://github.com/45s/coinzilla/pull/1512).
- PR #1512 uses `ensure` for generic checks while keeping domain constraints in Entities and preserving accepted values and existing domain `Error` classes/messages.
- **Verification:** PR #1512 merged as `38204fa5cb90bd3ce9f838d5f0c525aacf2a5695`; exact PR head `3ca2a9721421404c109bc2153cfa32c10645a76b` passed Entities tests (153/153), strict changed-file ESLint, workspace ESLint, the six required `develop-core` CI contexts, and Harvester Targeted Tests. The original API-removal verification from PR #1509 (`ab77568acfcd286560270aaac325bf65301efb0c`) remains historical.

## Shared utility reuse

- [x] Delegate exact decimal canonicalization to `normalizeDecimalString` in `@coinzilla/utils`.
- [x] Delegate decimal subtraction to `subtractDecimal` in `@coinzilla/utils`.
- [x] Preserve the Entities package's structured `toResult` API and field-specific validation messages.



---

## notifiers-roadmap

Archived source path: `packages/notifiers/ROADMAP_HISTORY_2026-11-26.md`

<!-- Preserved verbatim from packages/notifiers/ROADMAP.md during documentation consolidation on 2026-11-26. Historical record; not current status authority. -->

# Notifiers roadmap

---
status: active
type: roadmap
owner: notifiers
---

## Priority execution plan — current develop direction (2026-11-08)

> Current assessment: no critical defect was established in the audited notifier package. Telegram transport, bounded serialized delivery, credential redaction, failure isolation and Harvester integration are already implemented.

### IMPORTANT — preserve safe best-effort notification behavior

- [x] **Consumer-selectable Telegram event subscriptions — [#996](https://github.com/45s/coinzilla/issues/996).** Keep profile resolution in consuming applications. The Notifiers package exposes a validated per-subscriber event-name subset and bounded formatters for additional operational messages; omitting the selection preserves the existing full-allowlist behavior.

1. **Keep Harvester's Telegram integration aligned with the notifier contract.**
   - **Why:** operational alerts are useful only if they remain high-signal and cannot affect order processing, accounting, recovery or shutdown.
   - **Do:** mark the Harvester integration complete (PR #734); maintain the fixed supported-event allowlist, validated per-subscriber event selection, bounded queue, Harvester-owned policy/credential configuration, and isolated setup/delivery failures. Keep formatting and transport code inside this package.
   - **Verify:** retain offline integration tests for startup with notifications disabled, partial credentials, setup failure, malformed events, queue saturation, transport failure and orderly shutdown.

2. **Perform the operator-controlled Telegram smoke test when a dedicated test chat is available.**
   - **Why:** fake-fetch tests prove request handling but do not prove the operator's bot token/chat configuration or real Telegram API acceptance.
   - **Do:** use the existing one-message, credential-gated smoke-test command with a dedicated test chat. Do not put credentials in source, logs or PR output and do not add the smoke test to default CI.
   - **Verify:** record only timestamp, command exit/result and redacted API acceptance; do not retry ambiguous delivery automatically.

### DEFERRED — only when a real consumer requires it

3. **Do not add automatic retries, email/Discord providers or a persistent outbox by default.**
   - **Why:** ambiguous network outcomes can duplicate messages; extra transports/outbox infrastructure create new operational ownership and dependencies.
   - **Do:** require a concrete consumer, duplicate-send/idempotency policy, rate-limit contract and storage owner before implementation.
   - **Verify:** each future provider receives isolated tests, coverage and explicit shutdown/error guarantees. Keep the package dependency-free where practical.

**Owner:** packages/notifiers/
**Status:** Telegram transport, provider-oriented source layout, reliability hardening, real EventBus integration coverage, delivery diagnostics, Node 22/24 CI, and operator-controlled smoke-test tooling are merged into develop (PRs #346, #348, #356, #360, and Harvester integration PR #734). The validation-hardening audit was completed in PR #379; the live Telegram smoke test remains an operator-only action.
**Purpose:** provide small, dependency-free notification transports for operational alerts from Coinzilla applications.

Read AGENTS.md, README.md, and the repository's mandatory AI_AGENT_WORKFLOW.md.

## Product goals

1. Deliver high-signal operational events without coupling notification I/O to trading execution.
2. Keep the package dependency-free by preferring Node.js built-ins and injected side-effect boundaries.
3. Keep each transport isolated under its own folder, with a thin package entry point.
4. Make outbound content safe through explicit event allowlists and curated formatters.
5. Make delivery ordering, admission limits, failure handling, timeouts, and shutdown behavior explicit and testable.
6. Add transports only when a concrete consumer needs them; avoid speculative frameworks and empty provider scaffolding.

## Target architecture

    packages/notifiers/
      src/
        index.js                 # stable package exports only
        telegram/                # implemented feature module
          event-subscriber.js     # event-bus subscription and delivery lifecycle
          notifier.js             # Telegram HTTP transport
          index.js                 # provider-local public exports
          notifier.test.js
          event-subscriber.test.js
          helpers/                 # pure supporting functions only
            validate-telegram-inputs.js
            validate-telegram-api-response.js
            sanitize-error-message.js
        email/                    # future; create when implemented
        discord/                  # future; create when implemented

Each provider owns its transport client, provider-specific formatter, event integration where applicable, and tests. Keep cross-provider abstractions out until at least two implemented providers demonstrate a real shared contract.

## Phase 0 — Package foundation

- [x] Create the private pnpm workspace package @coinzilla/notifiers.
- [x] Define a thin public entry point and package-local AI-agent instructions.
- [x] Keep the initial scope Telegram-only and dependency-free.
- [x] Document setup, usage, security, and operational limitations.
- [x] Verify frozen lockfile installation in CI.

**Acceptance:** package is discoverable in the workspace and adds no runtime dependencies.

## Phase 1 — Telegram transport and event integration

- [x] Implement Telegram Bot API sendMessage using native fetch().
- [x] Validate token, chat ID, injected fetch, timeout, message length, HTTP response, and Telegram API response.
- [x] Deliver application-formatted plain-text messages through the injected formatter boundary; application-specific event vocabulary and presentation remain with the consumer.
- [x] Exclude raw exchange payloads and high-volume execution reports.
- [x] Serialize sends and expose explicit subscriber cleanup.
- [x] Integrate optional Telegram notifications into Harvester through the composition boundary (PR #734); delivery remains isolated from trading execution.
- [x] Keep notifications disabled when both credentials are absent; reject partial configuration.

**Acceptance:** Telegram is optional, isolated from trading behavior, and usable without adding a runtime dependency.

## Phase 2 — Provider-oriented source layout

- [x] Move all Telegram-specific code and tests under src/telegram/.
- [x] Keep src/index.js limited to stable public re-exports.
- [x] Add src/telegram/index.js as the provider-local export surface.
- [x] Preserve the original formatNotification export as a compatibility alias.
- [x] Keep email/ and discord/ absent until those transports are actually implemented.

**Acceptance:** adding a provider does not scatter provider-specific code across the package root.

## Phase 3 — Reliability hardening and regression coverage

- [x] Ignore callbacks that begin after subscriber shutdown starts.
- [x] Make subscriber close idempotent and attempt every unsubscription even if one fails.
- [x] Attempt cleanup of all successful subscriptions when partial setup fails; preserve the original setup failure.
- [x] Add a configurable maxPending limit to bound the subscriber's local queue.
- [x] Recover the internal send queue after transport or logger failures.
- [x] Avoid duplicate delivery-error logging when a subscriber logger is configured; preserve event-bus reporting when it is not.
- [x] Keep transport validation and bounded delivery inside the package; consuming applications sanitize and bound message content before delivery.
- [x] Redact Telegram credentials from transport and API error messages.
- [x] Reject malformed successful Telegram API responses instead of reporting false success.
- [x] Add deterministic regression tests for shutdown races, partial cleanup, queue overflow, malformed responses, secret redaction, and error recovery.
- [x] Pass package tests and the enforced 90% line / 85% branch coverage gate on the final merged commit.
- [x] Pass workspace tests, syntax, dependency audit, and all required CI checks on the final merged commit.

**Acceptance:** all resource cleanup paths are attempted, local pending work is bounded, failures remain observable, and no test requires real Telegram credentials or network access.

## Phase 4 — Future transports (demand-driven)

- [ ] **Email:** choose a provider/transport only after a consumer defines delivery, authentication, templates, and retry requirements. Keep implementation under src/email/.
- [ ] **Discord:** implement a webhook or bot adapter only after a consumer defines channel routing, payload format, and rate-limit requirements. Keep implementation under src/discord/.
- [ ] Define a shared provider contract only after at least two implemented transports demonstrate common behavior worth standardizing.
- [ ] Add transport-specific tests and coverage gates for every new provider.

**Acceptance:** each provider is independently testable, has clear operational guarantees, and does not introduce unnecessary dependencies into other transports.

## Phase 5 — Delivery guarantees (only when required)

- [ ] Define idempotency and duplicate-send semantics before implementing automatic retries.
- [ ] Add bounded retry/backoff and rate-limit handling if a consumer requires it.
- [ ] Add a persistent outbox only when crash-safe delivery is a product requirement and an appropriate storage owner exists.
- [ ] Add metrics/diagnostics only when their public contract is justified by production usage.

## Decision log

- Telegram is the first adapter because it satisfies the initial operator-alert use case.
- Node.js built-in fetch() is sufficient for Telegram's sendMessage; no SDK is needed.
- No Redis, worker, database, or external queue is included. The subscriber applies a local admission limit and serializes requests.
- No automatic retries: ambiguous network outcomes can produce duplicate messages.
- No subscribeAll(): explicit event allowlists reduce noise and prevent accidental sensitive-data disclosure.
- The package does not read environment variables; consuming applications own configuration and secret loading.
- The package does not promise durable or exactly-once delivery.
- Future provider folders remain absent until implementation begins.

## Completion policy

A roadmap item is complete only after its task PR is merged into develop and required CI checks pass. Never mark a task complete merely because code has been committed or a PR has been opened.

## Validation record

The refactor was merged to develop in PR #348. All required post-merge checks passed on commit 620818cb3ff3624c9869ab1d13fa181784dbbcbb:

- Unit tests: passed.
- Workspace test coverage: passed, including the notifiers 90% line / 85% branch gate.
- JavaScript syntax and actionlint: passed.
- Production dependency audit: passed.
- Utilities unit tests: passed.

CI run links: [Unit Tests](https://github.com/45s/coinzilla/actions/runs/41240703343), [Test Coverage](https://github.com/45s/coinzilla/actions/runs/41240703334), [JavaScript Syntax](https://github.com/45s/coinzilla/actions/runs/41240703427), [Dependency Audit](https://github.com/45s/coinzilla/actions/runs/41240703340), [Utils Unit Tests](https://github.com/45s/coinzilla/actions/runs/41240703355).

## Phase 4 — Integration confidence and operational diagnostics

- [x] Exercise the subscriber against the real EventBus implementation, including allowlisting, ordering, flush/close lifecycle, and failure reporting (PR #356).
- [x] Expose immutable, process-local delivery counters for admitted, successful, failed, overflowed, and pending notifications (PR #356).
- [x] Include the failed event name, safe failure category, and immutable delivery-counter snapshot in each structured delivery-failure/queue-overflow log record — completed in merged [PR #1298](https://github.com/45s/coinzilla/pull/1298), closing [issue #1103](https://github.com/45s/coinzilla/issues/1103).
- [x] Test the package through its public self-reference export, not only relative source imports (PR #356).
- [x] Validate all integration and diagnostic behavior with package and workspace CI on the synchronized PR head (PR #356; Node 22 and Node 24, workspace coverage, actionlint, syntax, and dependency audit passed).

**Acceptance:** the adapter is verified against the real event-bus contract, and operators can distinguish admitted work, successful API sends, failures, and overload without inspecting mutable internals.

## Phase 5 — CI compatibility and documentation quality

- [x] Run the full unit suite on the pinned Node 22 baseline and the current Node 24 line (PR #356; all matrix and aggregate checks passed).
- [x] Document diagnostics semantics, overload behavior, shutdown order, secret rotation, and common Telegram setup failures.
- [x] Evaluate branch-coverage improvements using the resulting coverage report; retain the existing 90% line / 85% branch notifier thresholds because the new paths are covered and no evidence justified an arbitrary percentage increase.
- [x] Evaluate mutation testing; defer adding a mutation runner until notifier complexity or defect history justifies its ongoing dependency, CI, and maintenance cost.
- [x] Record PR-head CI evidence and merge only after branch freshness and all required checks are verified (PRs #356 and #360).

**Acceptance:** supported Node lines are continuously exercised, operational guidance matches implementation, and any stronger quality gate is evidence-based rather than cosmetic.

## Phase 6 — Operator-controlled live verification

- [x] Add an explicit, credential-gated smoke-test command that sends one labeled message, validates the API result, and never retries (PR #360).
- [x] Keep live delivery outside default CI and unit tests; document secure secret injection and the meaning of API acceptance (PR #360).
- [x] Evaluate mutation testing. Deferred for now: the package has no established mutation-test infrastructure, the current test/coverage gates are stable and fast, and adding a separate mutation runner would add maintenance and CI cost without a demonstrated defect signal. Revisit if notifier complexity or regression history grows.
- [ ] Run the smoke test manually with a dedicated Telegram test chat after an operator supplies credentials.

**Acceptance:** live delivery can be verified deliberately without exposing secrets or making ordinary CI depend on external Telegram availability.

## Phase 7 — Validation modularity and malformed-boundary hardening

- [x] Extract Telegram configuration validation, message validation, and credential-safe error sanitization from the transport class into focused pure modules.
- [x] Reject array-shaped HTTP responses, Bot API payloads, and success result objects rather than accepting structurally invalid objects.
- [x] Add direct unit coverage for pure validation and error-sanitization helpers, including hostile coercion and encoded-token redaction.
- [x] Extend the package coverage gate to include the extracted modules and pass the package coverage threshold.
- [x] Verify package, workspace, syntax, and required GitHub Actions checks on the final PR head before merge.
- [x] Review final public documentation and update this roadmap with verified CI evidence after merge.

**Acceptance:** the transport class coordinates network I/O only; all pure input/error transformations are independently testable; malformed provider responses fail closed; existing public exports and delivery behavior remain compatible.

## Validation record — PR #379

Validation modularity and malformed-boundary hardening was merged into `develop` in [PR #379](https://github.com/45s/coinzilla/pull/379), merge commit `1c4e459b3c971789941d84a48de90cbd6086c232`.

All five workflow runs completed successfully on the exact PR head `79725255e3fc787f3d72236ca2b447240006dc2b`:

- Unit tests, Node 22 and Node 24: [passed](https://github.com/45s/coinzilla/actions/runs/41288057684).
- Workspace test coverage, including the notifiers 90% line / 85% branch thresholds and the newly extracted modules: [passed](https://github.com/45s/coinzilla/actions/runs/41288057705).
- JavaScript syntax and actionlint: [passed](https://github.com/45s/coinzilla/actions/runs/41288057674).
- Production dependency audit: [passed](https://github.com/45s/coinzilla/actions/runs/41288057679).
- Utilities unit tests: [passed](https://github.com/45s/coinzilla/actions/runs/41288057694).

The task branch was automatically deleted after merge. The live Telegram smoke test was not run because it requires operator-provided credentials and a dedicated test chat.



---

## harvester-journal-integration

Archived source path: `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP_HISTORY_2026-11-26.md`

<!-- Preserved verbatim from apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md during documentation consolidation on 2026-11-26. Historical record; not current status authority. -->

# Harvester Journal Integration Roadmap

---
status: active
type: implementation-roadmap
owner: harvester
---

> **Current-state authority:** this file tracks the staged Journal integration and its remaining Step 8 closeout. Current runtime behavior, event payloads and operational requirements are defined in [Journal Operations](./JOURNAL_OPERATIONS.md), [Trading First](./TRADING_FIRST.md), and the current [Harvester roadmap](../ROADMAP.md). Milestone notes below are historical delivery records where a later PR changed the original scope.

> **Current runtime configuration — 2026-11-09:** The application no longer reads `HARVESTER_JOURNAL_ENABLED` or `HARVESTER_JOURNAL_DIRECTORY`. The default application composition always enables Journal and writes to `apps/harvester/logs/`. The PR #473 entry below records the historical environment wiring at that time; it is not current deployment guidance. See [Journal Operations](./JOURNAL_OPERATIONS.md#configuration) for the current contract.

## Purpose and priority

This roadmap records the Harvester integration of the existing `@coinzilla/event-bus` and `@coinzilla/journal` packages. The current evidence contract and coverage matrix live in [JOURNAL_EVIDENCE_CONTRACT.md](./JOURNAL_EVIDENCE_CONTRACT.md).

**This work does not depend on trading or TESTNET acceptance.** EventBus and Journal record operational lifecycle facts and the selected trading-investigation evidence in issue [#650](https://github.com/45s/coinzilla).

The Journal is an operational observer, not trading-state authority or part of order execution, strategy evaluation, or fill accounting. Its persistence is optional only in configuration-only/no-broker mode. PR #545 added a mandatory account PREFLIGHT gate for every broker-connected startup, including read-only mode: the full account snapshot and account-wide open-order snapshot must be published and durably flushed before market subscriptions or trading-engine activation. After that gate passes, ordinary Journal event delivery remains asynchronous. The separate trading-safety contract requires order-submission and cancellation intent records to be durably flushed before the corresponding broker write; no other Journal I/O is awaited by market, strategy, or fill-accounting workflows. Trading-enabled graceful shutdown also requires a durable CLOSING account snapshot; failure is reported as incomplete shutdown.

Step 1 introduced one EventBus and the best-effort application publisher boundary; it merged into `develop` in [PR #453](https://github.com/45s/coinzilla/pull/453). Journal composition and lifecycle publication were added by later milestones: event DTO contracts in [PR #455](https://github.com/45s/coinzilla/pull/455), Journal composition in [PR #456](https://github.com/45s/coinzilla/pull/456), and process/configuration/broker lifecycle events in [PR #458](https://github.com/45s/coinzilla/pull/458). The original Step 1 scope must not be read as the current runtime state; see [Journal Operations](./JOURNAL_OPERATIONS.md) for the current event inventory and behavior.

## Audit conclusions

- `@coinzilla/event-bus` already provides in-memory asynchronous fan-out, subscriber isolation, bounded pending deliveries, diagnostics, `flush()`, and `close()`.
- `@coinzilla/journal` already subscribes to EventBus, writes JSONL records through a serialized write queue, reports write failures, and drains/synchronizes on close.
- No shared-package changes are currently justified.
- Harvester already has suitable application boundaries: bootstrap lifecycle, the Conservative trading engine, order submission, sequential user-data processing, canonical Fill accounting, and Portfolio/RecoveryLedger transitions.
- Harvester has an application EventBus boundary, stable lifecycle event names/DTO mappings, an optional asynchronously started Journal service, and process/configuration/broker lifecycle publication.
- Initial lifecycle DTOs contain no financial amounts, so exact decimal-string preservation applies to later order/execution event mappings.
- The former separate application is removed and is not a supported architecture or implementation reference. Preserve only independently documented behavioral requirements, re-specify them within Harvester's own domain boundaries, and never copy a legacy runtime. Harvester's Journal startup and durability rules are defined by this roadmap and `TRADING_FIRST.md`.

See [Architecture — operational event journal](./architecture.md#operational-event-journal) and the [AI implementation task](./tasks/AI_TASK_JOURNAL_INTEGRATION.md).

## Hard constraints

1. No trading, TESTNET, exchange credentials, orders, or fills are prerequisites for this roadmap. Use offline tests and a read-only/fake broker where useful.
2. Journal initialization is optional only when no broker is connected. Every broker-connected startup requires a ready Journal and durable PREFLIGHT account audit; a query, publication, or durability failure must stop startup before market subscriptions. Ordinary Journal write failures after the PREFLIGHT gate must not synchronously block trading workflows.
3. Never await Journal I/O from market-price evaluation, strategy policy, or fill-accounting processing. The explicit startup PREFLIGHT and trading-enabled CLOSING audits, plus the pre-side-effect order/cancel intent barriers, are the only approved durability waits.
4. Do not put Journal calls in awaited order lifecycle callbacks. Startup PREFLIGHT capture is serialized with early user-data delivery so events cannot race ahead of the account/order baseline; keep this exception confined to startup. The CLOSING audit runs after accepted user-data work has drained.
5. Event publication is best-effort. Catch both synchronous publication exceptions and failed `toResult` outcomes at the application boundary.
6. Keep domain policies pure and broker-independent. Domain code must not import EventBus or Journal.
7. Use object-shaped inputs and object-shaped results for functions. Use `toResult` for fallible workflows where appropriate.
8. Map application facts to small, plain, serializable DTOs. Never publish class instances, SDK objects, secrets, or whole account snapshots.
9. Do not journal every market-price update. Persist meaningful decisions, order transitions, executions, broker acknowledgements, and errors; keep high-frequency market ticks out of the Journal.
10. Keep live trading disabled by default. Default tests remain offline and credential-free.
11. Do not modify shared Journal/EventBus packages unless implementation reveals a reproducible, Harvester-blocking defect. Any such change needs a separate, explicitly justified cross-package task.
12. Every implementation PR must be small, independently testable, and update the relevant documentation and this roadmap in the same PR.

## Proposed event contract

All events use the existing EventBus envelope: generated event ID and timestamp, event name, source, and plain-object data. Use Harvester-owned names and stable business identifiers. Exact field names must be verified against the current source contracts before implementation; examples below are conceptual, not existing APIs.

| Event | Owner / publication point | Minimum useful data | Initial scope |
|---|---|---|---|
| `harvester.started` | Process entry point, after runtime startup | broker, mode, enabled markets, trading-enabled flag | Include |
| `harvester.startup_failed` | Process entry point, when startup fails | safe error name/message, startup stage | Include |
| `harvester.stopped` | Process entry point, after shutdown attempt | reason, shutdown outcome | Include |
| `config.validated` | Bootstrap, after validation | non-secret effective settings and enabled markets | Include |
| `broker.connected` / `broker.connection_failed` | Bootstrap around broker connection | broker identifier, outcome, safe error | Include |
| `broker.disconnected` | Bootstrap after disconnect attempt | broker identifier, outcome | Include |
| `broker.status_changed` | Broker/application boundary on meaningful stream transition | stream kind, status, safe reason | Include if source exposes transitions |
| `broker.subscription_established` / `broker.subscription_failed` | Bootstrap around subscriptions | market or stream kind, outcome | Include |
| `market.price_invalid` | Market-data boundary on rejected external data | market, validation reason, safe timestamp | Include |
| `strategy.decision` | Trading engine after meaningful policy result | strategy, market, reference price, reason, allowlisted decision inputs, action summary | Include |
| `strategy.paused` / `strategy.resumed` | Trading engine on actual state transition | market, reason | Include if transition exists |
| `order.submission_requested` | Order use case after local pending registration, before broker call | client order ID, market, side, type, price, quantity | Include |
| `order.submitted` | Order use case after verified canonical acknowledgement | client/exchange order IDs, status | Include |
| `order.updated` | Trading engine after an applied canonical order-state transition | client/exchange order IDs, status, original/executed quantities, cumulative quote quantity where supplied | Include |
| `broker.execution_report` | User-data boundary for each Binance executionReport | versioned allowlisted broker facts, event/transaction times, identifiers, per-event and cumulative quantities, commissions, liquidity flag | Include |
| `order.submission_failed` | Order use case on rejected/unknown outcome | identifiers, classified outcome, safe error | Include |
| `order.cancelled` / `order.cancel_failed` | Cancellation workflow after confirmed outcome | order IDs, final status, reason | Include |
| `execution.fill_applied` | Accounting workflow after successful Fill application | stable fill ID, order ID, market, side, actual price/quantity/fees | Include |
| `execution.rejected` / `execution.accounting_failed` | User-data/accounting boundary | safe identifiers and failure reason | Include |
| `execution.duplicate_ignored` | Fill deduplication boundary | fill ID, order ID | Optional |
| `portfolio.updated` / `position.opened` / `position.closed` | Portfolio transition boundary | market and compact resulting quantities/state | Defer unless a concrete operational question needs them |
| `recovery.cycle_completed` | Conservative recovery completion boundary | market, cycle identifiers, actual realized figures | Include only if a stable transition is exposed |
| `market.price_received` | Market-data boundary | price and market | Do not publish for every update; decision events already carry relevant price |

### Payload rules

- Preserve financial precision. Use canonical decimal strings for prices, quantities, fees, and monetary values.
- Include stable exchange/client order IDs and execution IDs where available.
- Distinguish requested, acknowledged, unknown, rejected, partially filled, and fully filled outcomes.
- An order acknowledgement is not a Fill; only actual normalized Fill facts change Portfolio.
- Do not serialize `Portfolio`, `Position`, `CanonicalOrder`, `Fill`, broker SDK objects, or raw exchange messages directly. Map the minimum required facts into plain DTOs.
- Never include credentials, signed requests, environment variables, or unnecessary account data.
- Avoid duplicate semantic events. If both an order-status transition and a fill are emitted, document their distinct meanings.

## Delivery model: one small PR per step

Do not combine the steps into one large PR. Each PR must contain only its milestone, focused tests, and the documentation/roadmap updates needed to describe the behavior that actually exists.

### Step 1 — Add an application EventBus boundary

**Status:** [x] Implemented, tested in CI, and merged into `develop` by [PR #453](https://github.com/45s/coinzilla/pull/453).

**Goal:** Introduce EventBus without changing trading decisions or broker behavior.

**Likely files:** `apps/harvester/package.json`; a focused application event publisher module; bootstrap composition; focused tests; this roadmap.

**Work:**

- Add `@coinzilla/event-bus` as a direct Harvester dependency.
- Construct exactly one EventBus in application composition and inject it explicitly.
- Implement a best-effort publisher that accepts one object argument and returns one object result.
- Catch synchronous publish exceptions and handle failed `toResult` results.
- Log publication failure once through the injected/default shared logger; logger failure must not escape into trading.
- Do not yet add Journal or publish high-volume events.

**Tests:** Accepted event; rejected result; synchronous throw; logger throw; malformed event; publisher never throws into its caller.

**Acceptance:** EventBus is composed once; no global singleton; no domain dependency; no trading behavior change; all publication failure cases are isolated.

**PR boundary:** EventBus dependency + publisher boundary + tests + minimal architecture/roadmap documentation only.

### Step 2 — Define stable Harvester event names and DTO mappings

**Status:** [x] Merged into `develop` by [PR #455](https://github.com/45s/coinzilla/pull/455). Current event names and allowlisted payloads are documented in [Journal Operations](./JOURNAL_OPERATIONS.md).

**Goal:** Define the application-owned event contract independently of Journal.

**Likely files:** `src/application/events/`; mapping helpers near the relevant application boundary; contract tests; architecture documentation; roadmap.

**Work:**

- Define stable event-name constants and focused DTO mapping functions for the initial process/configuration/broker lifecycle contract.
- Verify current Harvester startup/configuration fields and broker identifier before selecting payload fields; no SDK or domain objects are required for these lifecycle DTOs.
- Use one object input and one object result (`toResult({ data })`).
- Keep deterministic mapping and validation as pure application functions.
- Rely on the existing EventBus publisher boundary for plain-payload validation; EventBus rejects class instances and unsupported built-ins.
- Include safe identifiers; failure DTOs omit stack/cause and redact common labelled secret/token/authorization values.
- No financial amounts occur in these lifecycle DTOs; later financial DTOs must preserve exact decimal strings.
- Do not add event schemas for speculative events.

**Tests:** Every selected event payload; missing identifiers; invalid values; class-instance/unsupported-built-in rejection; secret omission/redaction; JSON serialization. Financial decimal precision is not applicable to this lifecycle-only contract and is required for later financial DTOs.

**Acceptance:** Contract names and payload examples are documented and tested; no EventBus/Journal imports in domain policy modules.

**PR boundary:** Event contract + DTO mapping + tests + documentation. No Journal lifecycle.

### Step 3 — Add optional, non-blocking Journal composition

**Status:** [x] Initial Journal service composition and lifecycle merged into `develop` by [PR #456](https://github.com/45s/coinzilla/pull/456). Current broker-connected PREFLIGHT durability requirements and configuration-only/no-broker optionality are defined in [Trading First](./TRADING_FIRST.md) and [Journal Operations](./JOURNAL_OPERATIONS.md).

**Goal:** Connect the existing Journal to EventBus while keeping trading startup independent.

**Likely files:** `apps/harvester/package.json`; focused Journal preparation/lifecycle helper; `src/index.js` or bootstrap composition; tests; README/operations docs; roadmap.

**Work:**

- Add `@coinzilla/journal` as a direct dependency.
- Construct Journal with the shared EventBus, configured directory, and logger in `prepareOptionalJournal`.
- Start Journal asynchronously during process composition. Configuration-only/no-broker startup may proceed without it; broker-connected startup must complete the PREFLIGHT audit's durable flush before market subscriptions or engine activation.
- Expose `ready`, `status`, and an explicit `close()` operation; report startup/write/close outcomes without allowing logger failures to escape.
- The Journal subscribes only after its directory/session file is ready. Events published before that point are not captured; Steps 1–3 publish no application lifecycle events yet.
- Journal initialization failure must fail any broker-connected startup because the mandatory PREFLIGHT audit cannot be made durable; it must not affect configuration-only/no-broker startup.
- Do not await ordinary Journal record delivery from trading callbacks. Explicit PREFLIGHT/CLOSING account-audit flushes and the separate pre-side-effect order/cancel intent barriers are the only approved durability waits. Coordinated process shutdown draining remains Step 7.

**Tests:** Journal ready/close; invalid directory; pending initialization; construction exception with failing logger; disabled mode; write failure reflected in health status; Harvester startup proceeds while Journal readiness is pending.

**Acceptance:** With Journal unavailable, configuration-only/no-broker startup may proceed. Broker-connected startup must fail before market subscriptions if the PREFLIGHT audit cannot be durably recorded. After successful PREFLIGHT, ordinary trading callbacks do not await Journal writes.

**PR boundary:** Journal construction and optional lifecycle only; no broad event instrumentation.

### Step 4 — Publish configuration, process, and broker lifecycle events

**Status:** [x] Merged into `develop` by [PR #458](https://github.com/45s/coinzilla/pull/458). The current event inventory and payload allowlists are maintained in [Journal Operations](./JOURNAL_OPERATIONS.md).

**Goal:** Make application startup and connectivity observable.

**Likely files:** `src/index.js`; `src/bootstrap/start-harvester.js`; event contract/mapping modules; tests; README/operations docs; roadmap.

**Work:**

- Publish validated non-secret configuration facts after trading configuration validation.
- Publish process startup/startup failure/shutdown outcomes from the process entry point.
- Publish broker connect/disconnect and user-data/market-price subscription outcomes from bootstrap.
- Publish only the broker user-data transitions exposed by the current broker callback: connectionClosed, recovering, recoveryFailed, recovered, reconciled, terminated, and rpcError. A recovered stream still requires Harvester's separate authoritative account/order reconciliation.
- Keep lifecycle ownership in the process/bootstrap layer; avoid duplicate started/stopped events. Never publish market-price updates.

**Tests:** Validated configuration; successful read-only startup without broker; startup failure; broker connect failure/success; user-data and market-price subscription success/failure; connectionClosed/recovered status filtering; normal/failed shutdown; publication failure containment.

**Acceptance:** One owner per lifecycle event; payloads contain no credentials, raw exchange messages, SDK/domain objects, or account snapshots; trading behavior is unchanged when publication fails. Journal capture gaps before subscription activation are explicit.

**PR boundary:** Lifecycle events only.

### Step 5 — Publish meaningful strategy and order lifecycle events

This step is split into small independently reviewable PRs to keep instrumentation narrow.

#### Step 5a — Actionable decisions and order submission

**Status:** Merged into `develop` by PR #460; all CI checks passed.

- Publish only actionable Conservative decisions after balance filtering; omit repeated NO_ACTION evaluations.
- Publish `order.submission_requested` after local PENDING registration and immediately before broker I/O.
- Publish `order.submitted` only after canonical acknowledgement validation and local registry update.
- Publish `order.submission_failed` for rejected/unknown outcomes with sanitized error details.
- Keep all payloads allowlisted and preserve exact decimal strings.
- Event publication remains synchronous best-effort admission only; never await subscriber or Journal work.

**Tests:** DTO allowlisting/redaction and exact decimal preservation; malformed decimal rejection; event ordering around broker I/O; no-action filtering; rejected and unknown outcomes; publisher throw and never-resolving promise do not block broker submission.

**PR boundary:** Actionable strategy decision + submission request/acknowledgement/failure only. No pause/resume, cancellation, execution, or accounting events.

#### Step 5b — Pause and trailing BUY cancellation transitions

**Status:** Merged into `develop` by PR #461; all CI checks passed.

- Publish the first actual pair-pause transition only; the current engine has no pair-resume transition, so do not invent one or emit a synthetic resume event.
- Publish confirmed trailing BUY cancellation only after canonical broker confirmation and registry update.
- Publish trailing BUY cancellation failure/unknown outcome with safe identifiers and bounded error details.
- Keep recovery SELL cancellation instrumentation separate as Step 5c.
- Preserve current cancellation/fill reconciliation and pause behavior exactly.

**PR boundary:** First pause transition and trailing BUY cancellation outcomes only. Recovery SELL cancellation is Step 5c. Resume events remain deferred until a real resume transition exists; do not include execution/accounting events.

### Step 6 — Publish execution and accounting facts

Split this work into two independently reviewable PRs; Step 6a must merge before Step 6b begins.

#### Step 6a — Successful Fill application

**Status:** Merged into `develop` by PR #465; all CI checks passed.

**Goal:** Record actual executions without changing accounting authority.

**Likely files:** `src/bootstrap/start-harvester.js`; `src/use-cases/update-trading-accounting.js`; focused DTO mappers; tests; event documentation; roadmap.

**Work:**

- Publish `execution.fill_applied` only when `updateTradingAccounting` reports `applied: true`, after the existing wrapper has committed both Portfolio and RecoveryLedger.
- Use a small allowlisted DTO containing stable fill/trade/order identifiers, symbol, side, exact price/quantity/quote-quantity strings, liquidity role, execution time when present, exact commission amount plus asset ID/code for each commission, and commission status.
- Do not publish repeated duplicate fills in this PR; duplicate suppression is Step 6c.
- Keep the sequential user-data queue and all current accounting invariants unchanged.
- Do not await EventBus delivery or Journal in the user-data queue.

**Tests:** Partial Fill; full Fill boundary where already covered; event only after accounting commit; duplicate Fill does not emit applied; malformed DTO; canonical decimal values remain unchanged; publisher failure while Portfolio/RecoveryLedger still update correctly.

**Acceptance:** Only newly applied canonical fills produce `execution.fill_applied`; Journal failure cannot block valid execution processing or strategy reevaluation.

**PR boundary:** Successful Fill application only.

#### Step 6b — Invalid execution and accounting failure diagnostics

**Status:** Merged into `develop` by PR #467; all CI checks passed.

- Publish invalid/missing Fill and unowned-order execution facts with safe identifiers.
- Publish accounting failures after the existing accounting workflow returns failure.
- Preserve existing pause behavior, serialized user-data ordering, and accounting authority.
- Do not publish duplicate-fill or recovery-completion events in this PR; those are Step 6c.

**Tests:** Missing/invalid Fill; fill/order identity mismatch after a distinct order update; unowned order; unsupported commission; accounting failure; publisher failure isolation.

**PR boundary:** Invalid/unowned execution and accounting failures only.

#### Step 6c — Duplicate and recovery-cycle diagnostics

**Status:** Merged into `develop` by PR #468; all CI checks passed.

- Optionally publish idempotent duplicate-fill suppression when the accounting result explicitly reports `duplicate: true`.
- Publish recovery completion only after the existing domain/application transition reports it eligible and commits the new cycle.
- Preserve existing accounting and strategy behavior.

**Tests:** Duplicate Fill; successful recovery completion; ineligible/failed completion; publisher failure isolation.

**PR boundary:** Duplicate and recovery-cycle transitions only.

### Step 7 — Complete shutdown draining and end-to-end failure isolation

Split this work into three independently reviewable PRs; each must merge before the next begins.

#### Step 7a — Stop intake, drain user-data, disconnect broker

**Status:** Merged into `develop` by PR #470; all CI checks passed.

- Close the trading gate and stop market-price plus user-data intake before draining.
- Ignore late callbacks after shutdown begins.
- Await the already-accepted serialized user-data queue.
- Disconnect the broker only after the queue drains.
- Preserve startup-failure cleanup behavior.

**Tests:** Pending user-data observer; both subscriptions removed before queue completion; broker remains connected while queue drains; broker disconnect occurs after drain; late user-data callbacks are ignored.

**PR boundary:** Broker intake and user-data queue shutdown ordering only.

#### Step 7b — Flush and close Journal/EventBus

**Status:** Merged into `develop` by PR #471; all CI checks passed.

- Publish the final `harvester.stopped` event while Journal and EventBus are still available.
- Close Journal after the final event so it can unsubscribe, drain accepted writes, and sync.
- Close EventBus after Journal.
- Do not await Journal during trading or user-data processing.

**Tests:** Final event captured before Journal close; pending Journal write drained; Journal closed before EventBus.

**PR boundary:** Normal observability shutdown ordering only.

#### Step 7c — Cleanup failure isolation and bounded shutdown

**Status:** Merged into `develop` by PR #472; all CI checks passed.

- Isolate runtime stop, Journal close, and EventBus close failures so later cleanup still runs.
- Coalesce repeated SIGINT/SIGTERM shutdown requests.
- Clean up observability after startup failure.
- Use the EventBus timeout contract; never report timeout as successful flush.
- Set non-zero process exit status when shutdown is incomplete.

**Tests:** Runtime stop failure; thrown/returned Journal close failure; EventBus close timeout; repeated shutdown; startup failure cleanup; no unhandled rejection.

**PR boundary:** Failure isolation, timeout reporting, and shutdown idempotency only.

### Step 8 — Final documentation and operational verification

**Status:** PR #473 merged into `develop` on 2026-11-03 and wired `HARVESTER_JOURNAL_ENABLED` / `HARVESTER_JOURNAL_DIRECTORY` into the default process composition. Step 8 remains open for its remaining documentation and operational verification items below; the merged environment-wiring PR alone did not complete the full closeout.

**Goal:** Close the feature with accurate docs and evidence.

**Likely files:** Harvester README, architecture, operations/journal documentation, roadmap, AI task closeout.

**Work:**

- Document event inventory and actual payloads.
- Document journal path/configuration, file naming/session behavior, permissions, disk-full behavior, and retention/rotation limitations based on the actual Journal package.
- Document how to diagnose Journal health and missing capture windows.
- Verify no secrets are recorded.
- Run the full Harvester suite, coverage, relevant shared-package tests, and repository CI.
- Inspect actual JSONL records from an offline integration run.

**Acceptance:** Documentation describes only shipped behavior; CI is green; tests prove failure isolation; no live credentials/network are needed for default tests.

**PR boundary:** Documentation and final verification only, unless a specific defect is found (fix that in a separate focused PR).

## Cross-step definition of done

Every implementation PR must:

- Be one small milestone; do not bundle future steps.
- Update this roadmap and relevant docs in the same PR.
- Add deterministic offline tests for success, failure, boundaries, and lifecycle behavior relevant to that step.
- Preserve all existing Harvester tests and trading behavior.
- Demonstrate that Journal is never awaited by the trading workflow.
- Use existing `@coinzilla/utils` helpers and logger; do not duplicate generic helpers.
- Use `toResult` for fallible workflows where appropriate.
- Keep pure calculations, decisions, and deterministic mappings as plain pure functions.
- Use one object argument and one object result for functions.
- Keep strategy policies broker-independent.
- Avoid global `console` usage.
- Keep TESTNET tests opt-in and live trading disabled by default.
- State exact tests/checks run; never claim unrun checks passed.

## Explicit non-goals for this integration

- Durable Portfolio/RecoveryLedger persistence or restart recovery within this observability integration.
- Journal replay as a source of trading state within this observability integration.

A separate Harvester P0 recovery track may consume the Journal as validated recovery evidence; that work must define its own idempotency, ownership, checkpoint, and exchange-reconciliation guarantees. The operational Journal integration remains an observer and does not independently authorize trading.

- Exactly-once delivery.
- Database/outbox infrastructure.
- Every-tick market data capture.
- Notifications, dashboards, or operator control panels.
- Refactoring working strategy/order/accounting code solely to make instrumentation cleaner.
- Changes to shared Journal/EventBus packages without a separately justified defect.

## Current cross-domain serialization status

- Journal-owned recursive serialization and durability propagation merged in [PR #920](https://github.com/45s/coinzilla/pull/920).
- Harvester consumer hardening was implemented in [PR #925](https://github.com/45s/coinzilla/pull/925) and [issue #923](https://github.com/45s/coinzilla/issues/923) is closed. Exact PR head `9329fe2dc2fb1af785548261f23dff4757e0282b` passed 875/875 Harvester tests and all six required checks.
- Keep [#889](https://github.com/45s/coinzilla/issues/889) open until the Journal README/roadmap contract closeout in [PR #934](https://github.com/45s/coinzilla/pull/934) is merged.
- **Telegram notification serialization regression — merged fix in [PR #1084](https://github.com/45s/coinzilla/pull/1084) (`2238e3f8e64544be7952bd8bce5301336128279e`):** account-wide BLOCKED open-order alerts spanning multiple symbols and user-data subscription-failure alerts without a market must omit the optional `symbol` property. A real EventBus + Journal regression verifies both safety alerts remain published/delivered and the startup flush reaches `durable: true`; EventBus and Journal contracts remain unchanged. Exact head `d61f7cce52bf5a46a89ad47019d18edf1b02805a` passed 1,444/1,444 Harvester tests, coverage, targeted tests, workspace tests, Utils tests, syntax, dependency audit, and external documentation links.

## Status

- [x] Read-only source audit completed.
- [x] Step 1: EventBus boundary (PR #453).
- [x] Step 2: event contracts and DTOs (PR #455).
- [x] Step 3: optional Journal composition (PR #456).
- [x] Step 4: lifecycle events (PR #458).
- [x] Step 5a: actionable strategy decisions and order submission (merged PR #460).
- [x] Step 5b: pause and trailing BUY cancellation transitions (merged PR #461).
- [x] Step 5c: recovery SELL cancellation transitions (merged PR #463).
- [x] Step 5: strategy/order events (PRs #460, #461, #463).
- [x] Step 6a: successful Fill application event (merged PR #465).
- [x] Step 6b: invalid execution and accounting failure diagnostics (merged PR #467).
- [x] Step 6c: duplicate and recovery-cycle diagnostics (merged PR #468).
- [x] Step 6: execution/accounting events (PRs #465, #467, #468).
- [x] Step 7a: stop intake, drain user-data, disconnect broker (PR #470).
- [x] Step 7b: flush and close Journal/EventBus (PR #471).
- [x] Step 7c: cleanup failure isolation and bounded shutdown (PR #472).
- [x] Step 7: shutdown and failure isolation (PRs #470–#472).
- [ ] Step 8: final documentation and verification.

