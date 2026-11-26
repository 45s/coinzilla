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

**Status: Implementation complete for the verified support envelope.** PR [#1868](https://github.com/45s/coinzilla/pull/1868) is open against `develop` and ready for owner review; [issue #1865](https://github.com/45s/coinzilla/issues/1865) retains the detailed acceptance record.

The infrastructure adapter uses Node.js built-ins only and includes native BSON encoding/decoding, OP_MSG framing and correlation, TCP/TLS transport, hello/topology negotiation, SCRAM-SHA-1/SHA-256, provider-neutral CRUD/query mapping, cursor cleanup, and replica-set transaction sessions. Standalone MongoDB supports CRUD but rejects multi-document transactions. Sharded/mongos deployments are rejected during handshake. An isolated experimental recovery-token path remains in source for protocol research but is not reachable through the supported connection path.

**Supported topology envelope:** single-seed `mongodb://` standalone and replica-set deployments. Replica-set multi-document transactions are verified. Sharded/mongos deployments, SRV, multi-seed discovery, pooling, topology monitoring/failover, retryable writes, compression, change streams, GridFS, client-side encryption and legacy wire opcodes are not supported guarantees. Supported wire-version overlap is 13–25. SCRAM usernames and SHA-256 passwords are restricted to printable ASCII because full SASLprep is not implemented. The public record contract is JSON-oriented, not arbitrary BSON. Client session pooling and explicit `endSessions` cleanup remain deferred.

**Latest exact-head verification on `25dffc84f6438347c4c77df7411d6d924ced392b` (2026-11-26):**

- DB unit suite: 400 tests, 379 passed, 0 failed, 21 skipped. Line coverage 98.68%, branch coverage 96.76%, function coverage 100%.
- Full workspace Unit Tests workflow: passed, including `@coinzilla/db` and existing providers/packages.
- Test Coverage workflow: passed for all packages and workspace coverage.
- Repository Quality: passed, including zero-warning workspace ESLint, strict changed-file ESLint, JavaScript syntax, actionlint and maintained-Markdown checks.
- Dependency Audit, External Documentation Links and Harvester Targeted Tests: passed.
- Real MongoDB 8.0 authenticated standalone (SCRAM): 20 integration tests, 13 passed, 0 failed, 7 skipped because standalone does not support multi-document transactions.
- Real MongoDB 8.0 replica set: 20 integration tests, 15 passed, 0 failed, 5 skipped. Atomic transaction rollback and commit passed. Concurrent CRUD request correlation passed on both topologies.
- The standalone server exposed a real delete-command wire-format defect: collation was incorrectly placed at command level. The implementation and regression test were corrected before both real-server jobs passed.
- The feature branch was synchronized with `develop` by a normal merge commit and was 0 commits behind at verification.

**Explicitly unverified follow-ups:** live TLS certificate integration and remote server-process interruption. Sharded/mongos topology is explicitly rejected during handshake rather than treated as an unverified supported mode. Deterministic transport tests cover partial frames, concurrent request correlation, pending-request rejection and interrupted writes. These follow-ups are not represented as supported guarantees. No test assertions or coverage thresholds were weakened.

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
