# Utilities roadmap

**Owner:** `@coinzilla/utils`
**Last reviewed:** 2026-11-26

> The previous roadmap, including completed API migrations, detailed reuse inventory, audit notes, and validation logs, is preserved in [Utils roadmap history](../../docs/archive/roadmap-history-2026-11-26.md#utils-roadmap).

## Current position

The shared validation API and logger fallback-redaction work are complete. Workspace lint/quality gates provide ongoing enforcement; do not reopen completed package cleanup tasks without new evidence.

## Active priorities\n\n- Coordinate the `capitalize` to `trimAndUppercase` public API rename with the Entities consumer migration tracked by [issue #1598](https://github.com/45s/coinzilla/issues/1598); preserve trim-and-uppercase behavior without a compatibility alias.

1. **Shared utility reuse inventory:** complete evidence-based dispositions for candidate decimal, queue, validation, and logging helpers. Reuse only genuinely domain-neutral behavior; keep domain invariants in their owning package.
2. **Exact decimal implementation:** adopt or extend a shared implementation only when a concrete consumer contract and compatibility tests demonstrate the need.
3. **Safe diagnostics:** preserve redaction and bounded error reporting at logger/transport boundaries.

## Source of truth

- Public utility APIs: [Utils README](./README.md), source, and tests
- Cross-package reuse policy: [shared utilities policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md)
- Task status: GitHub issue/PR with consumer evidence

Do not copy completed issue histories, test transcripts, or full reuse audits into this active roadmap.
