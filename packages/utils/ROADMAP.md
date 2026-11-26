# Utilities roadmap

**Owner:** `@coinzilla/utils`  
**Last reviewed:** 2026-11-26

> The previous roadmap, including completed API migrations, detailed reuse inventory, audit notes, and validation logs, is preserved in [Utils roadmap history](../../ROADMAP_HISTORY_2026-11-26.md).

## Current position

The shared validation API and logger fallback-redaction work are complete. Workspace lint/quality gates provide ongoing enforcement; do not reopen completed package cleanup tasks without new evidence.

## Active priorities

1. **Shared utility reuse inventory:** complete evidence-based dispositions for candidate decimal, queue, validation, and logging helpers. Reuse only genuinely domain-neutral behavior; keep domain invariants in their owning package.
2. **Exact decimal implementation:** adopt or extend a shared implementation only when a concrete consumer contract and compatibility tests demonstrate the need.
3. **Safe diagnostics:** preserve redaction and bounded error reporting at logger/transport boundaries.

## Source of truth

- Public utility APIs: [Utils README](./README.md), source, and tests
- Cross-package reuse policy: [shared utilities policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md)
- Task status: GitHub issue/PR with consumer evidence

Do not copy completed issue histories, test transcripts, or full reuse audits into this active roadmap.
