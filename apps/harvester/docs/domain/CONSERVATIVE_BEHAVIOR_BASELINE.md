# Conservative Behavior Baseline — superseded

**Status:** Historical pointer only; this document is not an active behavior contract.

The sole authoritative definition of Harvester Conservative Strategy behavior is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

This file previously duplicated BUY/SELL lifecycle, fee, commission, inventory, and recovery-completion rules. Those definitions have been removed because they could diverge from the canonical contract. Any historical copy of this file must not be used to determine current behavior.

- Implementation evidence and regression coverage: source and tests under apps/harvester/src/.
- Current implementation blockers and verification status: [Harvester Roadmap](../../ROADMAP.md).
- Process-restart reconciliation: separate deferred scope [#654](https://github.com/45s/coinzilla/issues/654).

Do not add Conservative rule definitions here. Update the canonical specification only after an explicit owner decision.
