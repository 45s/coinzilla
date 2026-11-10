# AI Task — Diagnose and Fix Harvester User-Data Stream Recovery

**Repository:** `45s/coinzilla`  
**Application:** `apps/harvester`  
**Target branch:** `develop`  
**Tracking issue:** [#626](https://github.com/45s/coinzilla/issues/626)  
**Incident evidence:** [2026-11-05 user-data stream recovery incident](../incidents/2026-11-05-user-data-stream-recovery.md)

## Mission

Autonomously investigate, implement, test, and document the user-data stream recovery defect demonstrated by the 2026-11-05 TESTNET Journal.

The stream repeatedly reports `recovered` while `recoveryRequired` remains true. The Journal has five empty-message `TypeError` RPC errors, five abnormal close events (code 1006), and 254 repeated `recovered` events over more than two hours. No post-disconnect account/open-order snapshot or explicit terminal recovery result is present in the Journal.

**This is an immediate trading-safety blocker.** Keep the recovery gate fail-closed. Do not treat a successful WebSocket reconnect as successful application recovery.

## Non-negotiable constraints

- Do not force `recoveryRequired=false` to make readiness pass.
- Do not bypass or weaken canonical order history, complete fill history, Journal parity, account balance/open-order audit, or stream-drain barriers.
- Do not submit, cancel, replace, or retry orders while recovery is unresolved.
- Do not make TESTNET order submissions or ask the operator to restart the app as part of diagnosis.
- Do not introduce unrelated refactors, persistence projects, or broad infrastructure changes.
- Keep the patch limited to the demonstrated recovery safety blocker.
- Follow repository and Harvester implementation instructions, including `apps/harvester/docs/TRADING_FIRST.md`, `apps/harvester/AGENTS.md`, and existing architecture/test conventions.

## Investigation plan

### 1. Reproduce and map the current lifecycle

Trace the actual code path from:

1. Binance user-data WebSocket error/close callbacks.
2. Broker adapter reconnect and retry handling.
3. Broker status events (`rpcError`, `connectionClosed`, `recovering`, `recovered`).
4. Harvester's broker-status consumer and recovery orchestration.
5. REST reconciliation of owned orders, canonical order status/history, complete paginated fills, account/open orders/balances, and queued WebSocket events.
6. The final recovery result and broker/trading readiness gates.

Do not assume method names or that REST reconciliation runs merely because the adapter reports `recovered`. Verify the real call graph.

### 2. Diagnose the empty TypeError

- Find the exact throw/rejection site.
- Inspect SDK callback signatures and error normalization.
- Determine whether the TypeError is caused by the network interruption, reconnect callback handling, stale socket state, or another defect.
- Preserve `name`, `message`, `cause`, stack, close code/reason, and reconnect attempt context where available.
- If the upstream error truly has no message, emit a useful bounded diagnostic identifying the failing operation and available cause/stack. Do not fabricate an error message.

### 3. Diagnose the stuck recovery state

- Determine the intended semantics of `recovered` and `recoveryRequired`.
- Identify why `recovered` is emitted every ~30 seconds while the requirement remains true.
- Check whether the repeated records are heartbeat/status polling, retry scheduling, repeated callback delivery, or a state-machine defect.
- Determine whether reconciliation is never started, is stuck awaiting a promise, is repeatedly failing, or succeeds without updating the state consumed by readiness.
- Inspect concurrency and idempotency: only one recovery operation should own a recovery generation at a time; stale completions must not clear a newer disconnect's recovery requirement.
- Ensure failures become explicit blocked/failed states with actionable reasons, not endless ambiguous `recovered` reports.

### 4. Correct the state model and behavior

Make transport connectivity distinct from application reconciliation. The exact API/event shape should follow the existing architecture, but it must be impossible to interpret “socket connected” as “safe to trade.”

A successful recovery may be declared only after all required gates have passed, including:
- User-data stream is connected and stable according to the existing contract.
- All owned orders are resolved canonically against Binance.
- Complete REST fill history is retrieved and matches durable Journal execution facts.
- Account-wide open orders and free/locked balances pass the existing audit.
- Events accepted during reconciliation are drained/applied in the required order.
- No unresolved UNKNOWN submission/cancel outcome, missing execution, contradiction, or durable pause remains.
- The final readiness state is recalculated from the reconciled state.

On any timeout, missing data, ambiguity, mismatch, or exception, remain blocked and expose the specific blocker.

Avoid emitting unchanged `recovered` status every 30 seconds. Publish meaningful state transitions and bounded attempt/stage diagnostics.

## Required tests

Add deterministic tests at the narrowest appropriate layers. At minimum:

1. Close code 1006 after a transient network interruption.
2. Empty-message TypeError preserves cause/stack/operation context.
3. Socket reconnects but REST reconciliation fails: recovery remains required and trading remains blocked.
4. REST reconciliation times out or returns missing/contradictory order/fill/account facts: blocked, with an actionable reason.
5. Full reconciliation succeeds and queued stream events drain: one terminal recovery-success transition; readiness advances only after all barriers pass.
6. Repeated `recovered` callbacks/status ticks do not start duplicate reconciliation or publish repeated unchanged events.
7. A second disconnect during active reconciliation invalidates the stale generation; stale success cannot clear the newer recovery requirement.
8. Disconnect/reconnect while a submission or cancellation has an ambiguous outcome never causes blind resubmission/cancellation.
9. No order submit/cancel/replace action occurs while recovery is unresolved.
10. Existing broker adapter, Harvester recovery, startup/restart, order lifecycle, and Journal parity suites remain green.

Use fake broker/REST ports and controlled promises/clocks where appropriate. Tests must assert both state and side effects, not only emitted log text.

## Documentation

- Document the corrected broker status contract and recovery state machine.
- Explain transport reconnect versus completed application reconciliation.
- Document failure states, blockers, retry behavior, and what makes readiness safe.
- Update the incident report with the source-confirmed root cause and exact fix after investigation; clearly separate observed Journal facts from code-derived conclusions.

## Verification and delivery

- Run focused tests first, then all required Harvester tests and repository CI workflows.
- Verify CI on the exact final PR head after the last push.
- Keep the PR focused and link issue #626.
- Report the source-confirmed root cause, changed files, state-machine behavior, regression cases, exact checks and outcomes, and any remaining blockers.
- Do not claim TESTNET acceptance based on offline tests. Any controlled TESTNET validation remains a separate operator-authorized step.

## Definition of done

- Root cause is identified with file/function-level evidence.
- Recovery lifecycle is corrected and transport/reconciliation state cannot be confused.
- The supplied stuck-state sequence has deterministic regression coverage.
- Safety gates remain fail-closed under all tested incomplete/ambiguous paths.
- No duplicate recovery work or repeated unchanged status spam.
- Documentation reflects actual implemented behavior.
- Exact-head CI passes.


## Implementation update — PR #627

**Source-confirmed root cause:** the broker emitted `recovered` with reconciliation still required and waited for subscriber acknowledgement before emitting `reconciled`; Harvester only began reconciliation after `reconciled`. This circular wait prevented the acknowledgement from ever being reached and caused the broker's 30-second recovery reminders to repeat.

**Implemented in this PR:**

- Start application recovery on the broker's `recovered` transport status.
- Reconcile owned orders/fills and drain the serialized user-data event queue.
- Capture a fresh account snapshot and durably journal only configured enabled-market assets.
- Capture and durably journal account-wide open orders against the live engine registry after ownership reconciliation.
- If user-data events arrive during REST reads or audit flushes, drain them and repeat both snapshots until the event sequence is stable.
- Acknowledge broker recovery only after the reconciliation and durable audits succeed.
- Invalidate stale in-flight work when a newer disconnect/recovery/error status arrives.
- Ignore duplicate reminders for an already acknowledged recovery generation.
- Log RPC/recovery errors with the error name, explicit empty-message marker, stack, and Error cause details when available.
- Keep the app readiness gate closed on any failure.

**Regression tests added:** successful recovery with durable account/open-order audits; failed account snapshot does not acknowledge; a newer disconnect invalidates stale completion; duplicate reminders do not repeat completed work.

**Verification status:** GitHub Actions is running on the PR head. No TESTNET acceptance is claimed. The empty-message TypeError cause remains unproven and is not represented as fixed.
