# Harvester audit reports

This index groups substantial historical audit reports and findings registers. These records preserve conclusions at their stated observation time; they are not current implementation authority.

- [Conservative Strategy audit](AUDIT.md) — primary historical audit narrative and closure decision.
- [Audit findings register](AUDIT_FINDINGS.md) — finding-by-finding evidence, confidence and disposition.
- [Audit execution history](AUDIT_EXECUTION_HISTORY.md) — detailed order, fill and session chronology.
- [Process-restart recovery audit — 2026-11-10](2026-11-10_18-44-49_restart-recovery-audit.md) — current source findings, safety blockers and proposed implementation gates; no code changes or runtime verification.
- [Source and domain-correctness audit — 2026-11-13](2026-11-13_source-domain-correctness-audit.md) — test-first accounting/recovery fixes, canonical timestamp validation, symbol-configuration generator corrections, expanded regression coverage, and exact scope/verification notes for PR #1094.
- [2026-11-13 LIVE trading-session audit](../sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md) — runtime evidence assessment, exact balance/keepQuantity reconciliation, notification and Journal deferral evidence gaps.

- [2026-11-14/15 TESTNET session audit](../sessions/AUDIT_SESSION_2026-11-14_23-41-12Z.md) — full artifact hashes/parse counts, order/fill evidence, exact account deltas, confirmed order-event defect and unresolved shutdown replacement failure.

Related current authorities:
- [Conservative domain specification](../../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md)
- [Harvester roadmap](../../../ROADMAP.md)
- [Audit process index](../README.md)

Preserve each report's baseline SHA, evidence provenance, limitations and unknowns. Add dated follow-ups rather than silently rewriting historical conclusions.
