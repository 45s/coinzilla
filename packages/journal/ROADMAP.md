# Journal roadmap

## Priority execution plan — current develop direction (2026-11-08)

This section supersedes stale checkboxes below where they conflict with merged work. Journal is an evidence store, not the authority for trading state. Preserve the existing mandatory Harvester durability barriers; additional diagnostics remain best-effort.

### IMPORTANT — finish the DDD and persistence boundary in order

1. **J-1 and J-2 — source vocabulary and record contract (COMPLETE).**
   - **Why:** persisted records need stable identity and an unambiguous distinction between source events, on-disk records and recovered records. A source-provided serialization hook must not be able to replace Journal-owned metadata.
   - **Do:** retain the vocabulary and explicit schema-v1 contract from PR #746, plus the lightweight JournalRecord validation/serialization boundary from PR #747. Preserve legacy raw-line compatibility and the current public Journal API.
   - **Verify:** maintain tests for stable ID, reserved metadata, root `toJSON` rejection, identity agreement, source non-mutation, schema round-trip and legacy record recovery. Both PRs are merged to develop.

2. **J-3 — isolate filesystem persistence behind an internal adapter.**
   - **Why:** current orchestration tests must replace instance/file-handle methods directly in places. This couples lifecycle logic to Node filesystem details and makes partial acquisition/append/sync/close failures difficult to exercise consistently.
   - **Do:** introduce a narrow internal adapter for directory ownership, session creation, append, sync, close and lock release. Inject it only into the internal orchestration path; preserve `new Journal({ eventBus, directory, logger })` and public behavior.
   - **Verify:** use a fake adapter for deterministic orchestration/failure tests and real temporary directories/child processes for filesystem, locking and crash-safety guarantees. Prove cleanup only releases resources owned by the failed attempt.

   - **TDD evidence:** PR #748 test-first commit `4f541bf9a06420509fefbce8f31f0916bfa59496` produced the expected RED on Node 24.22.2: 54 passed, 1 failed at `src/journal.test.js:903`; Journal returned the physical temporary-directory path instead of the injected store's virtual session path. The failure was an assertion, not a setup or syntax failure.

   - **Compatibility constraint:** The workspace test failure showed that Harvester has an existing test seam that assigns `journal.fileHandle` to simulate a disk write failure. Preserve this as a deprecated internal forwarding accessor to the store-owned session handle; do not edit Harvester or make the adapter public.

3. **J-4 — make orchestration state ownership explicit.**
   - **Why:** session lifecycle, subscription state, pending writes and close state must have one clear owner; otherwise races can accept writes after close or lose an uncertain append.
   - **Do:** map each lifecycle state and transition, define when an event is admitted, persisted, synced and acknowledged, and keep retry semantics explicit. Preserve exclusive directory ownership and write-failure behavior.
   - **Verify:** test concurrent close/publish, logger failures, append/sync failures, partial startup rollback and retry after uncertain sync. Do not deduplicate uncertain records by business meaning.

4. **J-5 — contract conformance and operational documentation.**
   - **Why:** consumers need to know which facts are durable, when flush completes, what failure means and how to inspect/restore a session.
   - **Do:** document file format/versioning, size limits, locking, durability boundaries, error/result semantics, backup/restore and unit-versus-filesystem test commands.
   - **Verify:** docs match executable behavior; package tests and the 85% line / 80% branch gate pass on the exact PR head.

### CRITICAL consumer constraint

5. **Preserve Harvester's mandatory durability gates without making optional evidence a trading dependency.**
   - **Why:** PREFLIGHT/CLOSING account audits and pre-side-effect order/cancel intent flushes protect against unrecorded exchange mutations. Weakening them risks losing the evidence needed to reconcile an order. Conversely, optional diagnostic writes must not block ordinary trading transitions.
   - **Do:** keep mandatory flush failures fail-closed at their existing boundaries; keep extra event evidence asynchronous/best-effort and visibly report gaps. Never claim Journal records override broker facts.
   - **Verify:** Harvester tests prove no corresponding broker side effect occurs when a required flush fails, and optional evidence failures do not change Portfolio, RecoveryLedger, order execution or readiness.



**Owner:** `packages/journal/`  
**Purpose:** provide reliable, auditable journal records and persistence behavior for application and operational history.

Read [the journal agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Architectural direction

Journal is a **bounded infrastructure context**. It owns the durable representation of events, record identity and schema compatibility, append/read/replay mechanics, storage lifecycle, writer ownership, and journal-specific failure behavior. It does not own the business meaning of an order, fill, position, strategy decision, or application recovery workflow.

The target is a small, explicit domain contract with infrastructure behind a testable boundary—not a pattern-heavy DDD framework.

### DDD and design principles

- **Bounded context:** keep Journal's public contract and implementation inside this package. Consumers publish events and decide what replayed facts mean; Journal persists and returns them.
- **Ubiquitous language:** use *source event* for the EventBus input, *journal record* for the durable journal-owned representation, *session* for a JSONL file, *recovered record* for the read result with source position, and *replay handler* for a consumer callback. Avoid using these terms interchangeably.
- **Record contract:** make stable identity, schema version, payload, and validation rules explicit in a small cohesive domain module. Prefer pure factory/validation/serialization functions (or an equivalently lightweight value-object representation) over classes, inheritance, or a generic entity framework.
- **Dependency direction:** Journal orchestration should depend on narrow EventBus and persistence contracts. Node filesystem APIs, JSONL details, lock files, and file handles belong behind the filesystem implementation. Keep these contracts package-private unless a real consumer requirement justifies a public API.
- **Side-effect boundaries:** keep validation, normalization, ordering, and policy decisions deterministic and independently testable. Keep filesystem operations, process identity, clocks, and EventBus subscription/flush at explicit boundaries.
- **Cohesion over fragmentation:** extract modules only when they have one meaningful responsibility and the extraction improves comprehension, independent testing, or change isolation. Do not create one-function files, generic repositories, speculative backends, or abstractions solely to satisfy DDD terminology.
- **Compatibility:** preserve the existing public `Journal` API and persisted JSONL format unless a separately reviewed migration is unavoidable. Legacy records remain readable; unknown or malformed records continue to fail closed.
- **Evidence preservation:** never silently truncate, rewrite, deduplicate, reorder, or discard historical records. Replay remains sequential and at-least-once; consumers remain responsible for idempotent effects keyed by stable record identity.

### Event and record semantics

These concepts are related but are not interchangeable:

1. **Domain event:** a business fact expressed in the language of the domain that owns it (for example, an order being filled). Its meaning and production belong to that domain/application.
2. **Integration/event-bus message:** a message published for subscribers. EventBus owns delivery and subscription behavior; Journal consumes the event stream through its injected EventBus dependency.
3. **Journal record:** Journal's durable representation of a source event. It carries the source event fields plus Journal-owned identity/schema metadata in the current on-disk format. A recovered record additionally carries reader-derived file/line position.

Journal must not classify an event as a domain or integration event based on its name, infer business meaning from payload fields, manufacture business events during replay, or turn replay into a command/order-submission mechanism. The README and JSDoc must explain that persistence/replay preserves facts; application consumers own interpretation and idempotent restoration.

## Current implementation audit

**Audit checkpoint:** `develop` at `efe2e9a7a0cde66487de386b2ea323c7a217d91c` (2026-11-09; includes merged Journal PR #748 and subsequent integration changes).

| Area | Current state | Assessment / planned disposition |
| --- | --- | --- |
| Bounded context and ownership | Dedicated `@coinzilla/journal` package with package-local instructions, roadmap, README, tests, and one public `Journal` export. | Strong boundary. Keep application strategy and domain decisions out of this package. |
| Public API and orchestration | `Journal` owns start/record/flush/close/read/replay and coordinates EventBus delivery, queued writes, durability, and lock lifecycle. | Responsibilities are cohesive but the class directly coordinates filesystem details. Separate orchestration from storage mechanics in a focused slice, without changing the public facade. |
| Record identity/schema | `helpers/journal-record.js` contains pure serialization and session parsing; stable IDs and schema-v1 metadata are enforced; legacy raw records are supported. | Good foundation. Formalize the distinction between source event, persisted record representation, and recovered record result; keep the contract lightweight and backward compatible. |
| Persistence boundary | `journal.js` and `read-journal-records.js` directly call Node filesystem APIs; lock/session creation and read/parse concerns are spread across orchestration and reader modules. | Main architectural improvement. Introduce one internal filesystem adapter/port only where it isolates I/O and allows service-level tests. Do not publish a backend plugin API or add another backend without a concrete use case. |
| EventBus dependency | Constructor injection exists; Journal consumes `subscribeAll` and `flush`. | Dependency injection is already present. Document and validate the narrow consumed contract; do not wrap EventBus in an unnecessary adapter or modify the EventBus package. |
| Recovery and replay | Complete sessions are validated before replay; duplicate IDs, malformed/incomplete data, unsupported schema, invalid encoding, and configured limits fail closed. Replay stops at the first handler failure and reports progress. | Preserve. Improve contract clarity and test isolation, not semantics. |
| Concurrency and durability | Exclusive process lock, queued appends, file-content sync acknowledgement, cleanup/rollback, and explicit stale-lock operator handling. | Safety-critical behavior. Preserve lock ownership, fsync meaning, ordering, rollback, and close semantics with adapter-level integration tests. Directory-entry fsync is not currently promised. |
| Tests | Native `node:test`; filesystem integration tests plus lifecycle, failure, recovery, and child-process lock coverage. Some lifecycle tests replace instance methods/file-handle methods directly. | Strong behavioral base. Add a narrow adapter seam so orchestration tests can control I/O deterministically while retaining real temporary-directory and child-process tests for filesystem guarantees. |
| Coverage | Journal-owned source coverage is scoped and enforced at 85% lines / 80% branches by the package coverage command. | Keep thresholds; do not game coverage or weaken failure-path assertions. |
| Documentation | README explains persistence, durability, replay, compatibility, and operator lock handling. | Add explicit language for event-vs-record semantics, internal dependency boundaries, and the stable public contract as each slice lands. |

### Existing behavior and invariants to preserve

- `record({ event })` acknowledges completion of the JSONL write, not durable storage; it does not claim fsync.
- `flush()` waits for EventBus delivery and queued writes, then syncs the active file. Only a successful sync reports `durable: true`.
- A transient file-content sync failure does not poison the writer; a later successful flush can make earlier completed writes durable. A write failure poisons the active writer.
- `close()` drains queued writes, attempts final sync and file close, then releases the directory lock. A failed durability outcome remains failed on repeated close.
- A writer acquires `.coinzilla-journal.lock` exclusively before creating its session file. Existing locks are never stolen or removed automatically. Startup rollback releases a lock acquired by that attempt.
- Session ordering is timestamp then numeric collision suffix; record order within a session is line order.
- Read validates the full snapshot before returning it. Replay validates the full snapshot before invoking the first handler, then invokes handlers sequentially.
- Replay is at-least-once across crashes. Journal does not provide exactly-once external effects, application checkpoints, business-level deduplication, or transaction coordination.
- Legacy raw event JSONL remains readable. Current writes preserve source event fields at the top level and add reserved schema-v1 metadata.
- Partial final lines and malformed/unsupported history remain unchanged on disk and cause an explicit failure; recovery never silently repairs or truncates evidence.
- Read/replay is only supported while this Journal instance is stopped and does not acquire a cross-process reader lock. Callers must not overlap a writer.

## Delivery strategy: small, independently reviewable PRs

Each numbered slice below is a separate task PR targeting `develop`, with one primary Journal concern. Do not combine slices merely to reduce PR count. A slice is complete only after its tests and documentation are merged and required CI passes on the exact final head.

### J-1 — Define the record vocabulary and contract

**Status:** [ ] planned  
**Intent:** make the existing contract explicit before changing its structure.

Scope:
- Document the source-event → persisted-record → recovered-record distinction in the README, including ownership of event meaning and replay effects.
- Specify the runtime shapes for source events, the current on-disk JSONL representation, and recovered records (`id`, `schemaVersion`, `payload`, `position`).
- Clarify which fields are Journal-owned, which are copied from the source event, and which are derived during reading.
- Document stable-ID requirements, reserved metadata, legacy compatibility, schema-version rejection, and at-least-once replay semantics.
- Review public JSDoc for `Journal` methods and add only accurate descriptions of observable behavior and failure results.

Acceptance criteria:
- A consumer can understand the three concepts without inferring semantics from implementation details.
- No event is renamed, reclassified, wrapped differently on disk, or otherwise changed.
- README examples continue to match the current public API and runtime behavior.
- No new dependency, public export, or runtime behavior is introduced.

Tests and verification:
- Documentation-only unless an executable example or clarified contract exposes a mismatch; if it does, stop and create a separate test-first behavior slice rather than silently changing semantics.
- Manually verify every example, path, default, and error claim against implementation and tests.
- Run the documentation-only checks required by the repository workflow; no unrelated broad test suite is required for prose-only edits.

### J-2 — Establish a lightweight JournalRecord domain contract

**Status:** [ ] planned  
**Depends on:** J-1  
**Intent:** give record identity and schema rules one explicit owner without introducing a heavyweight domain model.

Scope:
- Refine the existing pure functions in `src/helpers/journal-record.js` into a cohesive internal record contract (factory/validator plus explicit persisted and recovered representations where useful).
- Keep serialization and parsing at the format boundary; keep record invariants in the record contract.
- Keep source event payload fields compatible with the existing top-level JSONL representation and retain the reserved `__coinzillaJournal` metadata format.
- Make validation results/errors and schema-version handling consistent and explicit.
- Reject an own enumerable root-level `toJSON` hook on source events so JSON serialization cannot replace Journal's persisted record envelope.
- Keep the current public `Journal` API and recovered-record shape unless tests demonstrate a necessary compatibility-preserving clarification.

Acceptance criteria:
- Record identity and schema invariants have one authoritative implementation; serialization/parsing do not duplicate those rules.
- Inputs are not unexpectedly mutated; returned values do not expose mutable internal state through accidental aliasing.
- Legacy raw records and current schema-v1 records round-trip with equivalent source payloads.
- Unsupported versions, invalid metadata, missing/blank IDs, reserved-field collisions, malformed JSON, and invalid record shapes fail explicitly.
- No inheritance hierarchy, generic entity base class, shared-utils extraction, or speculative version registry is added.

Required test matrix:
- Valid schema-v1 serialize/parse round trip preserving all source event fields and stable ID.
- Legacy raw record parse compatibility and equivalence to current recovered-record contract.
- Missing, blank, non-string, and malformed IDs; reserved metadata collision; invalid metadata shape; payload/metadata ID mismatch.
- Unsupported schema versions and malformed/non-object JSON values.
- CRLF/newline handling, empty lines, incomplete final records, byte limits, and source positions.
- Non-mutation/aliasing behavior for caller input and returned record values, if immutability is adopted as part of the contract.

TDD and documentation:
- Test-first commit `a1c0807962008ee981e1caff31fe96d2e53c66af` added focused tests and the README contract. On Node 24.22.2, `pnpm --filter @coinzilla/journal test` produced the expected RED: 51 passed, 1 failed because the source event's root `toJSON` hook was not rejected (`src/journal-record.test.js:61`).
- Implementation commit makes the smallest change that turns those tests GREEN and updates JSDoc/README to the actual behavior.
- Refactor only after GREEN; keep tests passing and update affected docs in that same commit.
- Do not bundle filesystem adapter work into this PR.

### J-3 — Isolate filesystem persistence behind an internal adapter

**Status:** [ ] planned  
**Depends on:** J-2  
**Intent:** separate Journal lifecycle/orchestration from Node filesystem mechanics and provide deterministic control of I/O in service tests.

Scope:
- Define a small package-private persistence contract for the operations Journal actually needs: exclusive writer ownership, session creation/append, file-content sync, session close, bounded session discovery/read, and ownership release.
- Move Node filesystem calls, JSONL session file mechanics, lock-file creation/metadata, and lock cleanup into one filesystem implementation with cohesive responsibilities.
- Inject the adapter into the internal Journal orchestration path while preserving the existing `new Journal({ eventBus, directory, logger })` public construction contract. If a test-only/internal factory is needed, keep it non-public.
- Keep EventBus as an injected dependency and describe only the narrow methods Journal consumes (`subscribeAll`, `flush`); do not change EventBus or add an EventBus wrapper.
- Preserve read limits, deterministic session sorting, error codes/details, file permissions, lock acquisition order, and cleanup behavior.

Design guardrails:
- This is one internal filesystem adapter, not a public plugin system or a commitment to multiple storage backends.
- Do not add a database adapter, memory production adapter, repository abstraction, dependency-injection framework, or new package.
- Keep actual filesystem semantics tested against temporary directories; a fake adapter is for orchestration/failure tests, not a substitute for filesystem integration coverage.
- Keep locks owned by the adapter that acquired them; a contender must never release another process's lock.
- Do not claim directory-entry durability or change the existing file-content fsync contract.

Acceptance criteria:
- Journal orchestration no longer imports Node filesystem APIs directly.
- Filesystem adapter owns all storage-specific side effects and lock/session resource lifecycle.
- Public API, JSONL bytes, file naming/order, stable errors, durability acknowledgements, and recovery behavior remain compatible.
- A failure during each acquisition/create/append/sync/close/release phase returns an explicit failure and cleans up only resources owned by that attempt.
- Adapter contract is narrow, package-private, and documented where it is declared.

Required test matrix:
- Adapter contract tests for acquire/create/append/sync/read/close/release success and representative failures.
- Journal orchestration tests with a deterministic adapter for start/record/flush/close sequencing, EventBus subscription and flush ordering, rejected operations, and startup/close races.
- Real temporary-directory integration tests for JSONL bytes, timestamp/suffix ordering, bounded reads, malformed data preservation, permissions where supported, and lock behavior.
- Child-process test still proves a second writer cannot start until the owner has durably closed; stale locks remain untouched.
- Resource-leak assertions for open handles, subscriptions, and acquired locks after every failed lifecycle path.

TDD and documentation:
- Each behavior increment follows RED → GREEN → REFACTOR. Add the failing adapter/orchestration test before changing production code and record the expected failure.
- Update the README architecture/operational sections and relevant JSDoc in the same commit as each changed behavior.
- Keep each commit focused; do not combine extraction, behavior fixes, and API changes.

### J-4 — Make orchestration state ownership explicit

**Status:** [~] in progress  
**Depends on:** J-3 (merged in PR #748)  
**Intent:** ensure the Journal service owns lifecycle policy while the adapter owns resource mechanics.

Scope:
- Review the lifecycle state machine (`starting`, `started`, `closing`, `closed`, write-failure and close-durability state) for one clear owner and explicit legal transitions.
- Keep sequencing decisions in the Journal service and file-handle/lock ownership in the adapter.
- Replace direct tests of private adapter internals with observable service outcomes where possible; retain focused adapter tests for resource-specific guarantees.
- Extract pure transition/decision logic only where it has a meaningful contract and materially improves testability.
- Keep error reporting contextual and ensure logging failures cannot mask original persistence failures or interrupt cleanup.

Acceptance criteria:
- Every lifecycle transition has a documented precondition, observable result, and tested failure/cleanup behavior.
- No duplicate lifecycle state is maintained in both service and adapter without a documented reason.
- Concurrent start/close, overlapping operations, write failure, sync failure, repeated close, and startup rollback retain existing outcomes.
- No boolean-mode API or generic state-machine framework is introduced without a concrete need.
- The public `Journal` facade remains backward compatible.

Required test matrix:
- Valid and invalid lifecycle transitions, concurrent start, close-during-start, close-while-active, and repeated close.
- EventBus subscribe/flush/unsubscribe success and failure, including logger failure.
- Append queue ordering, write failure poisoning, transient sync retry, durable close and failed durability.
- Cleanup assertions for every acquired resource and all relevant races using deterministic barriers/deferred promises rather than arbitrary sleeps.

TDD and documentation:
- Add each missing state-transition regression test first and verify RED for the expected reason.
- Implement one state transition or duplicated ownership concern per PR/commit; avoid broad lifecycle rewrites.
- Update lifecycle/state documentation and JSDoc in each implementation commit.

### J-5 — Contract conformance and operational documentation

**Status:** [ ] planned  
**Depends on:** J-2 through J-4  
**Intent:** make the final architecture easy for package consumers and maintainers to use correctly.

Scope:
- Consolidate the README's public API, record semantics, compatibility, replay guarantees, durability acknowledgement, writer ownership, and read/write concurrency limitations.
- Document the internal dependency direction and adapter responsibility without promising unsupported extension points.
- Add a concise package-maintainer test guide describing unit vs filesystem integration coverage and the package coverage gate.
- Review exported API and JSDoc for accuracy against implementation and tests; avoid generating API docs or adding tooling without a concrete publication requirement.

Acceptance criteria:
- README and JSDoc agree with actual runtime behavior and tests.
- Every public method's success/failure and durability/replay guarantee is described accurately.
- Examples do not imply exactly-once replay, business-level deduplication, automatic stale-lock cleanup, or directory-entry fsync.
- No root-level or other-package documentation is needed; all changes remain under `packages/journal/**`.

Tests and verification:
- Verify README examples and all documented defaults/error codes against executable tests.
- Run Journal package unit tests and package coverage; confirm the 85% line / 80% branch thresholds remain enforced.
- Run applicable syntax/policy checks and repository-required CI on the exact final PR head.

## Per-PR and per-commit engineering contract

These requirements apply to every implementation slice above. A roadmap item is not permission to skip the normal repository workflow.

1. **One concern per PR.** Create a short-lived branch from the latest `develop`; target `develop`; change only `packages/journal/**`. Keep the diff reviewable and split independent concerns.
2. **Strict TDD.** For every behavior change, write the smallest meaningful test first, run it against the current implementation, and record the expected RED failure. Then implement the smallest GREEN change, and refactor only while tests remain green. A test that passed before implementation is not RED evidence.
3. **Every commit is self-explanatory and documented.** Each commit must include the relevant test change and the corresponding Journal documentation/roadmap update for the behavior or contract it changes. A test-only RED commit must document the intended observable contract; a production commit must update docs to match the implemented behavior. Do not leave README/JSDoc/roadmap updates as a later cleanup commit.
4. **No test weakening.** Preserve assertions and failure guarantees. Every assertion in new or materially edited tests has a detailed plain-English failure message. Cover success, invalid input, boundaries, failure paths, concurrency/races, cleanup, and compatibility as relevant.
5. **Use the right test boundary.** Pure record rules use direct unit tests; orchestration uses a deterministic internal adapter; filesystem and process-lock guarantees use real temporary directories and child processes. Do not mock away the behavior under test.
6. **Preserve coverage.** Run `pnpm --filter @coinzilla/journal test` and `pnpm --filter @coinzilla/journal test:coverage`. Keep the enforced minimum at 85% lines / 80% branches or deliberately raise it with evidence; never lower it to accommodate a refactor.
7. **Document contracts, not implementation trivia.** Update the README, JSDoc, and roadmap in the same commit when their described behavior/contracts change. Do not add root docs, cross-domain edits, generated docs, or new dependencies for this work.
8. **Verify before PR and merge.** Run relevant syntax/policy checks and all required CI. Report exact commands, outcomes, and tested head SHA. A skip is not a pass. Follow the canonical branch freshness, merge, and cleanup requirements in [AI_AGENT_WORKFLOW.md](../../AI_AGENT_WORKFLOW.md).

## Explicit non-goals

- No strategy, portfolio, broker, exchange, order-submission, account, or application-recovery policy in Journal.
- No classification or interpretation of business event names/payloads by Journal.
- No exactly-once replay promise, business-level deduplication, command dispatch, external side-effect transaction, or application checkpoint store.
- No automatic truncation, repair, compaction, rewrite, deletion, or stale-lock takeover.
- No change to stable record identity, legacy compatibility, persisted JSONL layout, session ordering, public API, or durability meaning without a separately tested migration decision.
- No directory-entry fsync guarantee in this roadmap.
- No generic repository framework, domain entity inheritance tree, aggregate root for every record, public storage plugin API, alternate production backend, dependency-injection framework, or new third-party dependency.
- No edits outside `packages/journal/**`.

## Completed work

- [x] Document the current journal record schema and public API. Versioned schema-v1 metadata is additive; legacy raw event records remain readable. See [README](./README.md).
- [x] Verify append/read ordering and behavior after partial write failures.
- [x] [PR #714](https://github.com/45s/coinzilla/pull/714) merged: a transient file-content sync failure is reported as non-durable; a later flush on the same Journal instance succeeds and durably preserves both the original completed write and the retry record in append order. Journal tests passed 43/43 on exact head `a52630cf4b2db0b5b317db4dd0e103789b64ed90`; all six required offline CI contexts passed. No source change, deduplication, record rewrite, or deletion.
- [x] Define and test duplicate/replay handling and stable record identity. Stable IDs are required, duplicates fail recovery, and replay is sequential/idempotency-aware.
- [x] Define serialization compatibility and schema evolution policy. Schema v1 is written additively; legacy raw records are supported; unknown versions fail explicitly.
- [x] Verify recovery behavior after process interruption and malformed records. Restart read/replay, invalid UTF-8, malformed/incomplete data, unsupported versions, and missing-directory failures are covered. No automatic truncation is performed.
- [x] Verify resource cleanup and bounded memory/disk behavior where applicable. Recovery enforces session, record, total-byte, and per-record limits.
- [x] [PR #741](https://github.com/45s/coinzilla/pull/741) merged: exclusive directory ownership is acquired before session creation, competing/stale locks are preserved, and startup rollback/durable close release the owned lock. Cross-process, stale-lock, and rollback regressions were confirmed RED before implementation; all required CI passed on exact PR head `74ad5a7369aee444940b5d7feb009ee0d17ffc7d`.
- [x] [PR #742](https://github.com/45s/coinzilla/pull/742) merged: package-scoped Journal coverage is enforced at 85% lines / 80% branches. Exact PR head `86a63d3d9dfb0acdf30bcf77aa92937e324f5491` measured 88.24% lines / 83.50% branches / 100% functions; all six required offline CI workflows passed.
- [x] [J-1 / PR #746](https://github.com/45s/coinzilla/pull/746) — Defined source-event, persisted-record, and recovered-record vocabulary; documented public contracts and JSDoc. Merged to `develop` as `7d2d8b05a5dcc223a3f434b1f6a4357e87126eae`; all six required checks passed on exact PR head `2631c3b14dd46270ff0a2919851ccc700b95fa6a`.
- [x] [J-2 / PR #747](https://github.com/45s/coinzilla/pull/747) — Centralized stable record-ID validation, rejected root-level enumerable `toJSON` hooks, and added serialization/recovery contract tests. Merged to `develop` as `5d38c1659d1fca187386ebe7c737b97540279419`; all six required checks passed on exact PR head `89f01ebde410d705e88bc48647557c5b36f6c201`.
- [x] [J-3 / PR #748](https://github.com/45s/coinzilla/pull/748) — Isolated filesystem persistence and resource ownership behind the package-private `FileSystemJournalStore`; retained the deprecated internal `fileHandle` test seam without leaking the original descriptor. Merged to `develop` as `9ec03aaf7df3f49f7dbc42187baf9a099de7fe79`; all required CI checks passed on exact PR head `e550803eb47100aa23123aa8f6e42f2b0d1eedb6`.
- [~] J-4 startup/close race: test-first commit `318df35b7d41d76cda25f96565ba5e9e2b9b961b` added a deterministic deferred-session-creation regression. On the exact RED head, Journal unit tests reported 59 passed / 1 failed; the failure was the expected assertion that `close()` must remain pending until startup cleanup releases its lock (actual `closeSettled: true`).
- [~] J-4 — Make orchestration state ownership explicit (in progress on `feature/journal/lifecycle-state-ownership`).
- [ ] J-5 — Contract conformance and operational documentation.

## Current contract

The authoritative current behavior is described in [README](./README.md). In summary:

- `record({ event })` resolves after the JSONL write completes, but does not claim durability.
- `flush()` waits for EventBus delivery and queued writes, then confirms file-content sync on success.
- A transient file sync failure may be retried by a later flush; a write failure poisons the active writer.
- `close()` drains, syncs, closes the session file, and releases the exclusive directory lock; failure remains visible.
- `read()` validates all sessions in deterministic filename/line order and applies configured recovery limits.
- `replay()` validates the full history before sequential handler execution; effects are at-least-once and consumers must be idempotent.
- Malformed, incomplete, duplicate, unsupported, invalidly encoded, or oversized history fails closed and is never silently rewritten.
- Only one writer may own a journal directory. Existing/stale locks are not automatically removed.
- Read/replay requires the Journal instance to be stopped and must not overlap another process's writer; no reader lock is currently acquired.

## Historical verification record

### 2026-11-08 transient file-sync retry characterization

PR [#714](https://github.com/45s/coinzilla/pull/714) merged into `develop` as `0638c8bbc51607805bd95299fc8b4e69363c774e`. Exact tested head: `a52630cf4b2db0b5b317db4dd0e103789b64ed90`.

- Journal package tests: 43/43 passed, including transient sync failure/retry.
- All six required offline CI contexts passed.
- Later successful sync preserves both distinct event IDs in append order.
- `writeFile()` failure poisoning remains unchanged; no Journal production source changed.

**Current `develop` checkpoint:** `efe2e9a7a0cde66487de386b2ea323c7a217d91c`.
