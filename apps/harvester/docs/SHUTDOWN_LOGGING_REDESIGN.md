# Shutdown terminal logging redesign

## Status

Design proposal only. This document records the intended change before implementation.
It does not change shutdown behavior, trading behavior, reconciliation, order
handling, broker lifecycle, or process-exit semantics.

## Problem observed

The terminal currently renders several distinct shutdown transitions with the
same generic message:

`Harvester shutdown phase started` and
`Harvester shutdown phase completed`.

The structured shutdown logger supplies the phase identity as
`shutdownPhase` and its state as `phaseStatus`. The compact console formatter
uses an explicit detail-field allowlist, and those two fields are not currently
included. The console therefore loses the information that distinguishes one
shutdown stage from another.

The console transport fingerprints the compact summary for consecutive-record
suppression. Once phase identity and status have been discarded, different
shutdown transitions can have the same fingerprint. The output can consequently
show a repeat-count line for distinct phases, making a normal multi-stage
shutdown look like repeated shutdown execution.

The structured DEBUG/TRACE records retain the original fields and remain the
diagnostic source of truth. This proposal is specifically about making the
operator-facing terminal summary useful and unambiguous.

## Desired terminal format

Use one short, stable line for each shutdown phase transition:

```text
21:25:57 shutdown phase MARKET_INTAKE_STOP STARTED
21:25:57 shutdown phase MARKET_INTAKE_STOP COMPLETED
21:25:57 shutdown phase EVENT_DRAIN STARTED
21:25:57 shutdown phase EVENT_DRAIN COMPLETED
```

The timestamp remains the existing local terminal timestamp. The phase name
and status are uppercase machine-readable tokens. Do not print the redundant
`Harvester` prefix, a JSON object, or additional prose on these lines.

For a failed phase, use the same shape:

```text
21:25:57 shutdown phase BROKER_DISCONNECT FAILED
```

The concise terminal line should not contain an error stack or long failure
message. The full structured DEBUG/TRACE record must retain the safe
failure-reason fields already emitted by the shutdown logger.

## Proposed implementation

1. **Define one terminal representation for shutdown phase records.**
   Add a dedicated formatter path in
   `src/infrastructure/logging/configure-harvester-logging.js` for shutdown
   phase records. It should render the phase identifier and phase status in
   the exact order shown above. Prefer a narrow, explicit record contract over
   adding generic fields to every console log.

2. **Keep the structured event contract intact.**
   Continue writing the complete structured shutdown record to DEBUG/TRACE
   JSONL, including timestamp, severity/method, runtime-session correlation,
   phase identity, status, elapsed/duration data, and safe failure reason.
   Terminal simplification must not delete or weaken diagnostic evidence.

3. **Make phase identity available to console formatting.**
   The formatter must consume the actual structured phase fields
   (`shutdownPhase` and `phaseStatus`) rather than relying on the generic
   message text. Validate and normalize values before rendering; do not emit
   `undefined`, `null`, object dumps, or arbitrary error text as phase names.

4. **Make duplicate suppression phase-aware.**
   Build the console fingerprint from the final meaningful representation,
   including phase name and status. Different phases must never collapse into
   one another. Preserve suppression only for genuinely consecutive identical
   phase/status records (if such duplicates are intentionally emitted).
   Do not disable deduplication globally.

5. **Clarify instantaneous shutdown facts.**
   Review records such as `SHUTDOWN_REQUESTED` and
   `STOP_STATE_ESTABLISHED`. They are instantaneous milestones, not
   necessarily work phases with a STARTED/COMPLETED pair. Keep them as concise,
   separately named lifecycle messages (for example, `shutdown requested`
   and `shutdown state established`) rather than misleadingly presenting
   them as completed work phases. Preserve their structured records.

6. **Cover both shutdown logging layers.**
   Verify the outer process-stop orchestration in
   `src/bootstrap/create-harvester-stop.js` and the runtime cleanup
   orchestration in `src/bootstrap/create-shutdown-handler.js`. They may
   report different phases, but must use the same terminal presentation
   contract. Do not remove valid phase transitions merely to reduce line count.

7. **Document the operator-facing format.**
   Update `docs/LOGGING.md` with the exact format, the distinction between
   terminal summaries and structured DEBUG/TRACE evidence, and the duplicate
   suppression rule.

## Required regression tests

Add focused tests for the console formatter and shutdown orchestration:

- A STARTED phase renders exactly
  `<time> shutdown phase <PHASE> STARTED`.
- A COMPLETED phase renders exactly
  `<time> shutdown phase <PHASE> COMPLETED`.
- A FAILED phase renders exactly
  `<time> shutdown phase <PHASE> FAILED`.
- Two different phase names with the same status both appear; neither is
  suppressed as an identical record.
- STARTED and COMPLETED for the same phase both appear.
- A genuinely repeated identical phase/status record follows the documented
  consecutive-duplicate policy.
- Structured DEBUG/TRACE output still contains the complete original phase
  fields and diagnostic timing/failure context.
- The outer stop lifecycle and runtime shutdown lifecycle both use the same
  terminal format.
- Existing order lifecycle formatting, ordinary INFO/SYSTEM summaries,
  line-length bounds, and color behavior remain unchanged.

Tests must assert exact terminal lines (apart from a controlled timestamp),
not merely check that the phase name appears somewhere in output.

## Safety and scope boundaries

This is a presentation-only change.

- Do not change shutdown ordering or phase ownership.
- Do not change idempotency guards or shutdown-promise reuse.
- Do not change market-intake stopping, event draining, order reconciliation,
  owned-order cancellation, CLOSING audits, Journal flushing, EventBus
  draining, broker disconnection, log transport closure, or process locks.
- Do not change success/failure criteria, retry behavior, error aggregation,
  or process exit codes.
- Do not add new environment variables, feature flags, or configuration.
- Do not remove structured diagnostic fields to make terminal output shorter.

## Acceptance criteria

- Every actual shutdown phase transition is immediately identifiable from
  its terminal line.
- The requested compact format is used consistently by both shutdown layers.
- Distinct phases and statuses are never hidden by duplicate suppression.
- Detailed structured diagnostics remain available in the session and
  cumulative DEBUG/TRACE files.
- Existing shutdown behavior is unchanged and the focused logging tests plus
  required repository CI checks pass on the exact PR head.
