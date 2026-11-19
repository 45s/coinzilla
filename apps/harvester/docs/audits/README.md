# Harvester audit and investigation records

This index is for Harvester-specific historical evidence. The [Harvester documentation index](../README.md) links to current application guides and migration plans. Repository-wide evidence rules are defined in [Documentation Governance](../../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Current audit process

- [Harvester audit working rules](../AUDIT_WORKING_RULES.md) — current pointer to the repository-wide agent workflow and Harvester-specific audit boundaries.

## Roadmap history

- [Historical Harvester roadmap](ROADMAP_HISTORY.md) — dated implementation, incident and audit chronology extracted from the living roadmap; original section anchors remain in `apps/harvester/ROADMAP.md` for compatibility.

## Archived README material

- [Historical README notes](README_HISTORY.md) — preserved 2026-11-04 incident notes and superseded operational detail removed from the application entry point.

## Main audit records

- [Audit reports index](reports/README.md) — primary audit narrative, findings register and execution chronology.
- [DDD and Clean Architecture audit](../DDD_CLEAN_ARCHITECTURE_AUDIT.md) — historical architecture assessment, not current architecture authority.

## Session and supporting evidence

- [2026-11-17 Binance TESTNET Conservative session audit](sessions/AUDIT_SESSION_2026-11-17_08-48-56Z.md) — 753 Journal records, 42 applied fills, four ZRO recovery completions, ADA dust-evidence pause, and unresolved shutdown reconciliation; no CLOSING audit supplied.
- [2026-11-14/15 TESTNET session audit](sessions/AUDIT_SESSION_2026-11-14_23-41-12Z.md) — confirmed stale order-event failure and incomplete shutdown recovery evidence.
- [F-055 shutdown recovery SELL safety remediation](reports/2026-11-15_f055-shutdown-recovery.md) — freshness-before-cancellation correction, shutdown race regressions and corrected interpretation of supplied trade-history rows.
- [Session audits index](sessions/README.md) — distinct dated session records and their evidence boundaries.
- [Supporting evidence index](evidence/README.md) — read-only exchange exports and log-integrity evidence.
- [Conservative session audit checklist](../CONSERVATIVE_SESSION_AUDIT.md) — reusable procedure, not an evidence snapshot.
- [Incident audit playbook](../INCIDENT_AUDIT_PLAYBOOK.md) — reusable evidence workflow.
- [Investigation template](INVESTIGATION_TEMPLATE.md) — provenance, baseline, scope, findings, unknowns and verification boundary.

Do not assume similarly named records are duplicates. Preserve raw evidence, source commit SHAs, timestamps, confidence and limitations. A correction must be a dated addendum or successor assessment, not a silent rewrite.
