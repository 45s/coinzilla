# Database architecture documentation

This is the local index for durable Database Infrastructure decisions and design notes.

## Accepted decisions

- [ADR-0001: Provider-neutral record CRUD API](./decisions/0001-provider-neutral-record-crud-api.md) — defines the generic record model, provider boundary, SQLite-first implementation and portability limits.

## Current implementation guidance

- [Package README](../README.md) — public API, CRUD/query semantics, composition examples, SQLite behavior and provider conformance usage.
- [Package instructions](../AGENTS.md) — ownership, dependency direction, provider rules and required verification.
- [Database roadmap](../ROADMAP.md) — implementation phases and deferred evidence-driven work.

GitHub Issues and Pull Requests are the live task status and discussion source. This index links to maintained architecture sources; it is not a duplicate task log.
