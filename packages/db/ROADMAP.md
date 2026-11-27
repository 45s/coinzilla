# Database roadmap

**Owner:** Database Infrastructure
**Scope:** `packages/db/`

## Current position

- Application-owned relational schema infrastructure ([#1486](https://github.com/45s/coinzilla/issues/1486), [PR #1489](https://github.com/45s/coinzilla/pull/1489)) is merged.
- SQLite infrastructure audit and hardening ([#1395](https://github.com/45s/coinzilla/issues/1395), [PR #1396](https://github.com/45s/coinzilla/pull/1396)) is merged.
- Provider-neutral CRUD and SQLite backup/restore primitives are implemented; preserve their public contracts and existing failure semantics.

## Official MongoDB driver reference strategy — #1865

**Decision:** use the official MongoDB Node.js driver as a pinned source-level reference and selectively adapt only small, proven implementation units when a concrete correctness gap and regression test justify it. Do not vendor the complete driver or its public API.

- Reference: `mongodb@7.9.1`, upstream commit [`2ed780df2a57884c3fa597da9ebbb6256ae0a5ea`](https://github.com/mongodb/node-mongodb-native/commit/2ed780df2a57884c3fa597da9ebbb6256ae0a5ea), Apache-2.0.
- Its runtime dependencies include `bson`, `@mongodb-js/saslprep` and `mongodb-connection-string-url`; none may be added to this package.
- Source mapping, exact dependency/license research, adaptation workflow and attribution ledger: [official-driver reference strategy](./docs/mongodb-driver-reference-strategy.md).
- No upstream implementation code has been copied yet. The attribution ledger remains empty; any future adaptation must retain required notices and record exact provenance and local modifications.

## Dependency-free MongoDB provider — #1865

**Status: Merged and verified for the documented support envelope.** PR [#1868](https://github.com/45s/coinzilla/pull/1868) was merged into `develop` on 2026-11-26 (merge commit `5c1f44780c88199d24de44a186c436d7f81b4400`). [Issue #1865](https://github.com/45s/coinzilla/issues/1865) retains the implementation scope and acceptance evidence.

The infrastructure adapter uses Node.js built-ins only and includes native BSON encoding/decoding, OP_MSG framing and correlation, TCP/TLS transport, hello/topology negotiation, SCRAM-SHA-1/SHA-256, provider-neutral CRUD/query mapping, cursor cleanup, and replica-set transaction sessions. Standalone MongoDB supports CRUD but rejects multi-document transactions. Sharded/mongos deployments are rejected during handshake. An isolated experimental recovery-token path remains in source for protocol research but is not reachable through the supported connection path.

**Supported topology envelope:** single-seed `mongodb://` standalone and replica-set deployments. Replica-set multi-document transactions are verified. Sharded/mongos deployments, SRV, multi-seed discovery, pooling, topology monitoring/failover, retryable writes, compression, change streams, GridFS, client-side encryption and legacy wire opcodes are not supported guarantees. Supported wire-version overlap is 13–25. SCRAM usernames and SHA-256 passwords are restricted to printable ASCII because full SASLprep is not implemented. The public record contract is JSON-oriented, not arbitrary BSON. Client session pooling and explicit `endSessions` cleanup remain deferred.

**Final exact-PR-head verification on `32d8fb0a5a59f57368ded7e7de80249de8965188` (2026-11-26; merged by `5c1f44780c88199d24de44a186c436d7f81b4400`):**

- DB unit suite: **402 tests, 381 passed, 0 failed, 21 skipped**.
- DB coverage: **98.74% lines, 96.76% branches, 100% functions**; package coverage thresholds passed.
- Full workspace Unit Tests and Test Coverage workflows passed.
- Repository Quality passed, including zero-warning workspace ESLint, strict changed-file ESLint, JavaScript syntax and actionlint.
- Dependency Audit, External Documentation Links and Harvester Targeted Tests passed.
- MongoDB provider integration passed against MongoDB 8.0 in both CI topologies.
- Authenticated standalone (SCRAM): **20 integration tests, 13 passed, 0 failed, 7 skipped** because standalone does not support multi-document transactions.
- Replica set: **20 integration tests, 15 passed, 0 failed, 5 skipped**. Atomic transaction rollback/commit and concurrent CRUD request correlation passed.
- A test-first transport correction now accepts a TCP data chunk containing multiple individually valid OP_MSG frames whose aggregate exceeds 48 MiB. Each individual frame remains bounded by the 48 MiB protocol limit. The regression was observed failing on the test-only commit before the transport fix.
- A test-first topology correction now rejects mongos/sharded servers during handshake. Transaction capability is explicitly limited to replica sets; standalone reports no multi-document transaction support. The mongos regression was observed failing before the handshake guard.
- README, MongoDB support guide and this roadmap describe the same topology boundary. The isolated sharded recovery-token code is experimental and unreachable through the supported handshake.
- The feature branch was synchronized with `develop` before merge. PR #1868 is **merged**; its merge commit is `5c1f44780c88199d24de44a186c436d7f81b4400`.

**Explicitly unverified follow-ups:** live TLS certificate integration and remote server-process interruption. SRV/multi-seed discovery, connection pooling/topology monitoring, retryable writes, compression, arbitrary BSON APIs and sharded/mongos deployments remain intentionally outside the supported contract. Deterministic transport tests cover partial frames, coalesced frames, concurrent request correlation, pending-request rejection and interrupted writes. No test assertions or coverage thresholds were weakened.

All seven required exact-head workflows passed: Unit Tests, Test Coverage, Repository Quality, MongoDB provider integration, Dependency Audit, External Documentation Links and Harvester Targeted Tests. The optional Binance TESTNET integration job was skipped because credentials were not configured.

See [MongoDB support and limitations](./docs/mongodb.md) for the operational configuration, tested behavior and limitations.
## Active maintenance

- Keep schema ownership with consuming applications; this package supplies infrastructure, not application-specific schema or trading policy.
- Maintain lifecycle, transaction, concurrency, backup/restore, and filesystem error regression coverage when behavior changes.
- Add provider capabilities only for a concrete consumer contract; do not expand abstractions speculatively.

## Canonical sources

- Package contract and usage: [README](./README.md)
- Public API and implementation: package source and tests
- Task status: GitHub Issues/PRs

The previous detailed delivery record and contract notes are preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#database-roadmap).
