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

**Status: In progress.** Implementation PR [#1868](https://github.com/45s/coinzilla/pull/1868) targets `develop`; [issue #1865](https://github.com/45s/coinzilla/issues/1865) owns detailed acceptance and evidence.

The infrastructure adapter uses Node.js built-ins only and currently includes native BSON encoding/decoding, OP_MSG framing and correlation, TCP/TLS transport, hello/topology negotiation, SCRAM-SHA-1/SHA-256, provider-neutral CRUD/query mapping, cursor cleanup, and replica-set/sharded transaction sessions. Standalone servers support CRUD but reject multi-document transactions. The shared provider-conformance suite and deterministic protocol/authentication/transport tests are included; opt-in live-server tests use `MONGODB_URI`.

**Explicit limits:** single-seed `mongodb://` only; no SRV/multi-seed discovery, pooling, topology monitoring/failover, retryable writes or compression; supported wire-version overlap 13–25; printable-ASCII SCRAM usernames and SHA-256 passwords (full SASLprep is not implemented); JSON record contract rather than arbitrary BSON; no change streams, GridFS, client-side encryption or legacy wire opcodes. Client session pooling and `endSessions` cleanup remain deferred.

**Verification:** on the previous head `40c6e5d830232f86ebe05b595a09dfa12bf207f0`, Dependency Audit and External Documentation Links passed. DB unit/coverage jobs were cancelled after the workspace run failed in Harvester transaction consumers. Those failures exposed a provider-facade callback argument bug; a regression test and correction are now committed on the feature branch, but have not yet been re-run. Repository Quality and strict changed-file ESLint failed on that head (the changed-file report contained 418 problems); lint cleanup remains outstanding. No live MongoDB server result is claimed.

**Remaining acceptance work:** verify the transaction callback regression fix and all DB package tests/coverage on the exact current head; resolve all applicable workspace and strict changed-file lint findings without weakening rules; complete adversarial protocol/authentication/lifecycle review; and obtain real standalone plus replica-set/sharded integration evidence where infrastructure is available. Keep topology, authentication and transaction claims aligned with actual tests.

See [MongoDB support and limitations](./docs/mongodb.md) for the operational configuration and behavior contract.

## Active maintenance

- Keep schema ownership with consuming applications; this package supplies infrastructure, not application-specific schema or trading policy.
- Maintain lifecycle, transaction, concurrency, backup/restore, and filesystem error regression coverage when behavior changes.
- Add provider capabilities only for a concrete consumer contract; do not expand abstractions speculatively.

## Canonical sources

- Package contract and usage: [README](./README.md)
- Public API and implementation: package source and tests
- Task status: GitHub Issues/PRs

The previous detailed delivery record and contract notes are preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#database-roadmap).
