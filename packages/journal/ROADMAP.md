# Journal roadmap

**Owner:** `@coinzilla/journal`
**Last reviewed:** 2026-11-26

> The previous roadmap, including detailed phased delivery, completed work, test-first evidence and validation checkpoints, is preserved in [Journal roadmap history](../../docs/archive/roadmap-history-2026-11-26.md#journal-roadmap).

## Current position

The Journal package's core record contract, filesystem adapter, lifecycle ownership, locking, flush/close coordination, and failure-cleanup work are documented as implemented in the historical delivery record. Journal remains an evidence store, not the authority for trading state.

## Active follow-up

- Preserve lossless JSONL serialization and mandatory durability propagation at the consumer boundary. The cross-package persistence constraint is tracked in [issue #889](https://github.com/45s/coinzilla/issues/889).
- Only reopen completed lifecycle or filesystem work when a reproducible defect or a concrete consumer requirement is recorded.
- Any future durability/API change must update the package's canonical contract and regression tests in the same change.

## Source of truth

- Public API and usage: [Journal README](./README.md)
- Runtime contract: package source and tests
- Task status: GitHub issue/PR linked to the specific change

Do not keep completed PR narratives, historical RED/green logs, or old phased checklists in this active roadmap.
