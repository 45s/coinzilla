# Harvester Journal integration

**Owner:** Harvester  
**Scope:** Event publication and optional Journal composition in `apps/harvester/`

## Current position

The staged integration through lifecycle/event publication, execution/accounting facts, shutdown draining, and environment configuration is merged. The historical roadmap explicitly leaves Step 8 closeout open; do not mark the whole integration complete based only on the merged environment-wiring PR.

## Remaining closeout

- Reconcile the remaining Step 8 documentation and operational verification checklist against current behavior.
- Verify the canonical event inventory, payload allowlists, and broker-connected PREFLIGHT durability requirements in [Journal Operations](./JOURNAL_OPERATIONS.md).
- Preserve configuration-only/no-broker optionality and non-blocking failure isolation where specified by [Trading First](./TRADING_FIRST.md).
- Close the remaining checklist through the linked task/PR; do not duplicate event inventories or contract definitions here.

## Canonical sources

- Event names and payload allowlists: [Journal Operations](./JOURNAL_OPERATIONS.md)
- Safety and composition requirements: [Trading First](./TRADING_FIRST.md)
- Journal record contract: [Journal package README](../../../packages/journal/README.md)
- Task status: GitHub Issues/PRs

The full staged implementation plan and PR-by-PR evidence are preserved in [JOURNAL_INTEGRATION_ROADMAP_HISTORY_2026-11-26.md](../../../docs/archive/roadmap-history-2026-11-26.md#harvester-journal-integration).