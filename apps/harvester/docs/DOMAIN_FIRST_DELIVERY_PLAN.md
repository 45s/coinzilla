# Harvester Conservative Domain Delivery Plan

---
status: superseded
type: historical-plan
owner: harvester
---

> **Superseded — 2026-11-09:** This staged D0–D3 plan is retained as delivery history, not as a current task tracker or implementation gate. The sole Conservative behavior authority is [the canonical domain specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md); current Harvester priorities and implementation status live in [ROADMAP.md](../ROADMAP.md), and repository-wide documentation work is tracked by [#795](https://github.com/45s/coinzilla/issues/795). Do not use the historical checklist below to infer current completion or authorize work.

> **Canonical authority:** all Conservative Strategy rules are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). This plan tracks documentation, implementation, and verification work; it is not a second behavior baseline.


**Status:** Active  
**Owner:** Harvester  
**Strategy:** Conservative standing-order accumulation and capital recovery

## Direction

Conservative is the strategy Harvester is intended to execute. Preserve its established behavior and express the rules in Harvester's own domain language. Documentation, implementation, and tests must not depend on a separate application remaining in the repository.

A difference in current Harvester code is an implementation gap by default—not a reason to redesign the strategy. Discuss only a concrete ambiguity that cannot be resolved from the behavior contract or would materially change financial exposure.

## Current state

- **D0 — Domain documentation:** one canonical specification is authoritative. The glossary, accounting matrix, Portfolio notes, and strategy guide are reference/evidence documents only; the old behavior baseline is superseded.
- **Existing domain:** Portfolio, RecoveryLedger, fill identity, recovery planning, and completion logic already exist.
- **Integration:** existing Harvester engine/application/broker work is preserved; do not rebuild it.
- **TESTNET:** verify only after the specific strategy lifecycle is implemented and covered by offline tests.

## Delivery steps

### D0 — Establish one authoritative specification

- [x] Establish the sole Conservative rule definition in the canonical domain specification.
- [~] Convert every other relevant document into a reference or implementation/test evidence record; remove duplicate rule definitions and mark historical conflicts superseded.
- [ ] Pass the repository-wide documentation consistency audit before runtime implementation.

### D1 — Align one behavior at a time

For each selected gap:
1. State the current Harvester behavior.
2. State the required Conservative behavior in plain language.
3. Explain the practical consequence with a small example.
4. Ask for confirmation only if the rule is genuinely ambiguous or materially changes risk/capital use.
5. Implement the smallest change with focused tests.
6. Update the domain docs if the approved rule changes.

Do not bundle unrelated behavior changes into one PR.

### D2 — Prove the lifecycle

- Test actual fill accounting, partial fills, duplicate/conflicting fills, commissions, and rounding.
- Test initial BUY trailing and safe cancel/reconcile/replace.
- Test BUY completion → recovery SELL submission → next standing BUY.
- Test partial recovery SELL, replacement, completion, minimum profit, retained inventory, and reset.
- Test failures and uncertain outcomes fail closed without losing accounting state.
- Keep tests deterministic and offline by default.

### D3 — Integrate and verify

- Preserve Harvester's existing DDD boundaries and infrastructure.
- Keep broker I/O and order lifecycle orchestration outside pure domain policy.
- Verify the full BUY → fill → recovery SELL → fill → next BUY cycle on TESTNET only after offline tests and CI pass.
- Do not claim end-to-end acceptance from mocks, startup, connectivity, or order submission alone.

## Working rules

- One behavior per discussion and preferably one behavior per PR.
- No endless questionnaires or speculative redesign.
- No copying broker/runtime code into the domain.
- No feature expansion, persistence, Journal, dashboards, or Aggressive work unless it is the explicit next task.
- Update this plan after each completed step.
