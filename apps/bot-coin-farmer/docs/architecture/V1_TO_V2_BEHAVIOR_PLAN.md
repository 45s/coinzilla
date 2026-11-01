# V1-to-successor Behavior Plan

**Source application:** `apps/bot-free-roll`  
**Successor application:** `apps/bot-coin-farmer`  
**Status:** Initial mapping policy; detailed inventory pending

## 1. Purpose

This document defines how to learn from V1 without coupling the successor to V1 implementation details.

V1 is the reference for current documented strategy intent, existing scenarios, and operational lessons. It is not automatically the specification for every implementation detail: source code may contain defects, incomplete work, or behavior that conflicts with the approved strategy documents.

Coin Farmer must own its behavior specification and tests.

## 2. Source-of-truth order

For understanding V1:

1. `apps/bot-free-roll/README.md` — documented strategy behavior and explicit rules.
2. `apps/bot-free-roll/ROADMAP.md` — engineering invariants, safety requirements, and backlog.
3. `apps/bot-free-roll/CURRENT_STATE.md` — dated source audit; findings must be rechecked against the audited ref.
4. V1 source and tests — evidence of current implementation and regression scenarios, not automatic approval of every behavior.
5. Repository engineering standards and AI-agent workflow — mandatory across both apps.

If these sources conflict, record the conflict and ask for a focused decision. Do not resolve it by copying whichever implementation is easiest.

## 3. Classification for every discovered behavior

Each V1 behavior or rule must be classified before it is implemented in Coin Farmer:

| Classification | Meaning | Successor treatment |
|---|---|---|
| Preserve | Explicitly documented and still approved | Reimplement independently and add successor tests |
| Preserve with a new implementation | Required outcome is approved, but V1 mechanism is unsuitable | Design a new contract/workflow that preserves the outcome |
| Correct after approval | Evidence shows a defect or unsafe behavior | Document defect, proposed correction, and approval before changing semantics |
| Review | Ambiguous, contradictory, or dependent on unresolved accounting/product policy | Do not implement until resolved |
| Do not carry forward | Accidental behavior, obsolete mechanism, or known unsafe shortcut | Exclude and record why |

A defect fix must not be disguised as a harmless refactor. A strategy change must not be hidden inside an architecture task.

## 4. Initial behavior areas to inventory

The detailed rows below are discovery work, not an exhaustive final specification.

| Area | V1 evidence to inspect | Coin Farmer design output |
|---|---|---|
| Configuration | Strategy settings, pair settings, validation, startup checks | Approved config schema, exact units, validation and migration policy |
| Market data | Price source, subscription lifecycle, freshness and gaps | Canonical market observation contract and stale-data policy |
| BUY workflow | Initial entry, standing buy order, buy-step calculation, order type | Explicit buy decision rules and order lifecycle |
| SELL workflow | Recovery threshold, fee coverage, minimum net profit, retained free quantity | Pure profitability policy and refusal reasons |
| Executions | Order acknowledgements, partial/full fills, trade IDs, duplicate events | Canonical fill identity and idempotent application |
| Commissions | Quote/base fees, zero fees, multiple fees, third-asset behavior | Per-fill fee facts and supported-fee policy |
| Inventory | Active, free, reserved, external, locked balances | Inventory ledger and reservation invariants |
| Pair lifecycle | Start, active, paused, reconciling, stop and resume behavior | Explicit pair state machine and allowed transitions |
| Recovery | Disconnect, reconnect, ambiguous requests, restart | Reconciliation contract and operator resume rules |
| Notifications | User-facing status, failure and recovery messages | Stable diagnostic and notification events |
| Persistence | What state is stored, when and how it is restored | Versioned state model and durability/replay contract |

## 5. Reuse policy

### Reuse by shared public contract

Prefer existing Coinzilla packages when their public API already expresses the needed stable contract and satisfies successor requirements. Audit the contract first; package names alone do not prove suitability.

### Reimplement application-owned behavior

Strategy policy, application workflows, and app-specific orchestration belong to Coin Farmer. They may be informed by V1 algorithms and tests but must not import V1 modules.

### Request shared-package changes through the owner

If a reusable entity or broker capability is missing or inadequate, describe the consumer need and ask the owning package to design and implement its contract. Do not change another domain's source or duplicate its model locally as a shortcut.

### Do not copy defects

The current-state audit identifies incomplete exact-decimal integration, Number-based financial paths, and missing fill/commission reconciliation capabilities at its audited ref. Recheck the source before relying on a finding. Do not reproduce a known unsafe shortcut simply to match V1 runtime behavior.

## 6. Required behavior mapping artifact

Before the first Coin Farmer trading workflow is implemented, maintain a table with at least:

- Behavior ID.
- V1 source document/module/test reference.
- Current documented rule.
- Actual observed V1 implementation behavior.
- Classification from section 3.
- Coin Farmer requirement and owner.
- Acceptance tests.
- Open question / decision reference.

A behavior is not considered mapped merely because a source file has been read. The outcome and testable acceptance condition must be explicit.

## 7. Acceptance principles

- Coin Farmer has independent tests for every preserved strategy rule.
- Safety invariants are tested at domain and workflow boundaries.
- Financial calculations use exact values and boundary-focused tests.
- Fill and commission accounting is tested with partial fills, duplicate/late events, explicit zero fees, and supported fee assets.
- Recovery is tested with incomplete history, unknown mutation outcomes, reconnects, and restart replay.
- No V1 import is required to run, test, build, or start Coin Farmer.
- No live-trading cutover occurs until the user explicitly approves the acceptance evidence and release plan.
