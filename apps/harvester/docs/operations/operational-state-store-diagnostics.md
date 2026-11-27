# Operational State Store diagnostics and incident investigation

> **Purpose:** This is the durable starting point for the next Operational State Store diagnostic/investigation session. Read this before re-running commands or trying to reconstruct the previous investigation. Current incident tracking: [#1743](https://github.com/45s/coinzilla/issues/1743).

> **Current disposition — 2026-11-23:** The Conservative durable submission-intent callback wiring defect was fixed in merged [PR #1750](https://github.com/45s/coinzilla/pull/1750). The original 49-record ledger remains immutable and semantically incomplete: missing intent/outcome facts were not backfilled, and the projector's strict ownership checks were not relaxed. A diagnostic against that unchanged ledger may still report projection failure; this does not mean the source fix failed.

## 1. What this tool is

The read-only diagnostic CLI is:

- **Script:** `apps/harvester/scripts/diagnose-operational-state.js`
- **Package command:** `operational-state:diagnose`
- **Package:** `@coinzilla/harvester`
- **Implementation:** reuses the production file-store reader and verifier, then runs the offline Harvester recovery projector.
- **It is not** a repair, restore, initialization, exchange reconciliation, or trading command.

The diagnostic answers two separate questions:

1. Are the existing Operational State Store files structurally and cryptographically valid?
2. Can the verified facts be projected into the offline recovery candidate under the current projector invariants?

A verified store can still fail projection. Do not call that file corruption unless the integrity check itself fails.

## 2. Where the data is stored

The default directory is anchored to the Harvester source module, not the shell's current working directory:

```text
apps/harvester/recovery-facts/
├── facts.jsonl
└── manifest.jsonl
```

| File | Purpose |
| --- | --- |
| `facts.jsonl` | Append-only sequence of committed operational facts. Each record carries its sequence, fact identity/type, payload, and integrity metadata. |
| `manifest.jsonl` | Append-only committed-head checkpoints. The store uses it to establish which fact sequence/digest is committed. |

The store implementation is in `apps/harvester/src/infrastructure/operational-state/create-file-store.js`. File names are `facts.jsonl` and `manifest.jsonl`.

### Directory override

The same resolver is used by the diagnostic and the runtime:

- Variable: `OPERATIONAL_STATE_DIRECTORY`
- Must be a non-empty absolute local filesystem path.
- If unset, the default above is used.
- If set, both files are expected in that directory.

Resolver: `apps/harvester/src/infrastructure/operational-state/resolve-directory.js`.

**Important:** before inspecting or copying data, confirm which directory was actually selected. Do not assume the default if the environment may override it.

### First startup: automatic directory and file creation

When the Operational State Store is required (Conservative restart recovery is enabled, or Recovery Seller is enabled with at least one enabled market), normal Harvester startup calls `initializeIfEmpty()` before full verification:

- If `apps/harvester/recovery-facts/` (or the configured override) does not exist, startup creates the directory, `facts.jsonl`, `manifest.jsonl`, and the sequence-0 `LEDGER_INITIALIZED` genesis record.
- If the directory exists and is empty, startup creates the same two files and genesis record.
- Startup then verifies both streams, their sequence/digest/checkpoint linkage, filesystem types/permissions, and required durability barriers before continuing.

No manual initialization command is required for a genuinely new installation. This is first-start genesis only; it does not reconstruct or restore orders, fills, balances, Portfolio, RecoveryLedger, OrderRegistry, or operator state. Telegram-only startup does not create the store because it does not require it.

### Existing directory with a missing file: do not auto-repair

If the directory exists but contains only one stream (for example, `manifest.jsonl` exists and `facts.jsonl` is missing), startup must fail closed. It must **not** create an empty counterpart: the remaining file may be evidence of an interrupted or previously populated ledger. Unexpected files, malformed streams, digest/checkpoint mismatches, and durability failures are also preserved and rejected.

For this case:

1. Stop retrying startup; do not run `operational-state:init`, reset scripts, or manually create either JSONL file.
2. Confirm the actual resolved directory and `OPERATIONAL_STATE_DIRECTORY` override.
3. Preserve the entire directory and relevant process logs. Record file names, sizes, and SHA-256 hashes before any recovery work.
4. Restore `facts.jsonl` and `manifest.jsonl` together from the **same verified backup/snapshot**, after confirming that the backup belongs to this installation and is internally consistent.
5. If no verified matching backup exists, keep the process stopped and escalate for evidence-based operator recovery. Never invent a genesis record for a directory that already contains ledger evidence.

The directory is intentionally excluded from Git. A repository checkout or `git pull` cannot restore it; maintain a separate protected backup. See [ADR-0007](../architecture/decisions/0007-initialize-empty-operational-state-ledger.md) for the authoritative initialization decision.

## 3. How to run the diagnostic

From the repository root:

```bash
pnpm --filter @coinzilla/harvester operational-state:diagnose
```

Or from `apps/harvester`:

```bash
pnpm run operational-state:diagnose
```

CLI information (does not open the store):

```bash
pnpm --filter @coinzilla/harvester operational-state:diagnose -- --help
pnpm --filter @coinzilla/harvester operational-state:diagnose -- --version
```

### Output and exit codes

The script writes a one-line source identity to stdout, then a JSON report to stdout. Errors/CLI failures are written to stderr. **It does not create a report file.** Save a copy explicitly when needed, for example:

```bash
pnpm --filter @coinzilla/harvester operational-state:diagnose > operational-state-diagnostic.txt 2>&1
```

That redirection creates `operational-state-diagnostic.txt` in the shell's current directory; it is not written into `recovery-facts/`. Keep diagnostic reports outside the ledger directory.

| Exit code | Meaning |
| --- | --- |
| `0` | Store integrity verified and candidate projection succeeded. This does not enable or perform restoration. |
| `1` | CLI/configuration/source-identity/store-setup error. |
| `2` | Store integrity verification failed; projection is skipped. |
| `3` | Store integrity verified, but candidate projection failed. |

The JSON report separates `storeIntegrity` from `projection`. It reports source identity, record/sequence/checkpoint summary and fact-type counts, plus candidate counts or projection errors.

## 4. What the diagnostic does and does not do

The diagnostic:

- reads the configured existing store using the production `readAll()` path;
- runs the offline `projectHarvesterOperationalState({ records })` function against verified records;
- prints a safe summary and actionable errors;
- prints the source commit/worktree identity when available.

It does **not**:

- initialize or create a ledger;
- append facts or checkpoints;
- repair, rewrite, truncate, delete, or re-sequence records;
- connect to Binance or read Binance API credentials;
- start Harvester or subscribe to exchange streams;
- submit, replace, or cancel orders;
- enable process-restart restoration or turn the candidate projection into live state.

The diagnostic uses a fixed synthetic diagnostic session ID; it does not create a process-started fact. Do not run an initialization command as a way to clear a diagnostic failure.

## 5. Incident snapshot: 2026-11-22 (#1743)

The user's diagnostic was run against source commit `516c3669e76e1b7927a143a433144b8f1e77cbe1`, Node `v26.13.0`, with a clean working tree.

Observed report:

- Store integrity: `VERIFIED`
- Committed records: 49, sequence 0–48
- Projection: `FAILED`
- Exit code: `3`
- Full-ledger fact counts: 13 `EXECUTION_FILL_APPLIED`, 0 `ORDER_SUBMISSION_INTENT`, 0 `ORDER_SUBMISSION_OUTCOME`, 10 `ORDER_CANCELLATION_INTENT`, 10 `ORDER_CANCELLATION_OUTCOME`.

First projection error:

```text
Provider-attributed execution fill has no preceding submission intent:
h-dff68008c72c47a59368ad-2
```

The reported sequence-5 fact is a provider-attributed ZROUSDT BUY fill:

| Field | Value |
| --- | --- |
| Sequence | `5` |
| Client order ID | `h-dff68008c72c47a59368ad-2` |
| Provider | `binanceTestnet` |
| Binance order ID | `1001129` |
| Fill ID | `binance:ZROUSDT:15735` |
| Price / quantity | `1.17 / 5` |
| Quote quantity | `5.85` |
| Runtime session | `ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c` |
| Fill timestamp | `1795337545805` |

Sequence 4 is an account open-orders preflight snapshot at timestamp `1795337539543`, around 6.262 seconds before the fill. It reports 14 open orders, all SELL orders; it does not show this ZROUSDT BUY. That snapshot alone cannot establish whether the BUY was submitted after the snapshot, already closed, or missed by a stream/reconciliation path.

Other reported evidence:

- Sequence 45: `STRATEGY_MARKET_PAUSED` for ADAUSDT with reason `REST_STREAM_RECONCILIATION_FAILED`.
- Runtime logs included `Binance market stream error`.
- The user suspects a temporary internet interruption may have occurred while Binance continued executing an already-submitted order.

**The internet-disconnection explanation is plausible, not proven.** The stream error and later reconciliation failure have not been time-correlated to the sequence-5 fill. Do not record the hypothesis as the confirmed root cause.

### Follow-up: source-confirmed submission callback defect and fix — 2026-11-23

The initial runbook draft's projector registration/order hypothesis was superseded by the source investigation and merged [PR #1750](https://github.com/45s/coinzilla/pull/1750).

- **Confirmed runtime cause:** before the fix, `conservative-trading-engine.js` supplied `onOperationalStateSubmissionIntent` / `onOperationalStateSubmissionOutcome` to `makeExecuteStrategyDecision()`, while `execute-strategy-decision.js` consumes `onDurableSubmissionIntent` / `onDurableSubmissionOutcome`. The optional callbacks could therefore be absent on the Conservative submit path even with the Operational State Store configured.
- **Fix now on develop:** the engine maps the application callbacks to the executor's canonical durable callback names, production composition requires the callback pair when the store is configured, and the executor independently rejects a missing required pair. The durable intent must be acknowledged before broker placement; write failure prevents submission.
- **Projector disposition:** current `project-harvester.js` registers `ORDER_SUBMISSION_INTENT` facts in the `orderIntents` map and requires the matching intent for provider-attributed fills. No projector registration defect was confirmed by this investigation. Preserve this fail-closed ownership invariant; do not infer an intent from a fill or client-order-ID pattern.
- **Archived ledger disposition:** the original 49 facts still contain zero submission-intent and zero submission-outcome records. PR #1750 fixes the producer/composition path for future submissions; it does not backfill or repair the original ledger. The unchanged ledger can continue to fail semantic projection and must remain preserved.
- **Verification:** PR #1750 reports 30 applicable exact-head checks passed, including targeted regressions, Harvester/workspace tests and coverage. The read-only TESTNET check was skipped. No exchange operations were performed.

The stream error / possible network interruption remains a hypothesis, not the demonstrated cause of the missing durable submission facts.

## 6. Safe next-session procedure

1. Read this document and [issue #1743](https://github.com/45s/coinzilla/issues/1743), including its latest comments.
2. Verify the checked-out branch and commit. Confirm the diagnostic's reported source identity matches the code being investigated.
3. Confirm the actual `OPERATIONAL_STATE_DIRECTORY`; identify the exact `facts.jsonl` and `manifest.jsonl` being read.
4. Preserve the original files. Make a separate read-only copy only if local parsing/testing requires it; never edit the user's original ledger.
5. Locate the exact sequence-5 record and search the entire stream for the exact client order ID. Record any matching intent, cancellation, acknowledgement, fill, and session facts in sequence order.
6. Correlate the fill timestamp with stream disconnect/reconnect, REST reconciliation, order submission and acknowledgement logs. Search by exact client order ID and Binance order ID where available.
7. The Conservative submission callback contract is fixed in PR #1750. For any new gap, trace the exact strategy composition and verify the durable intent append is acknowledged before broker I/O whenever the Operational State Store is configured.
8. Reproduce any remaining projection gap using a verified fixture or copied ledger. Preserve the current projector ownership checks and add a focused regression for the newly demonstrated failure before changing behavior.
9. Re-run targeted tests and the read-only diagnostic. Compare original ledger file hashes before/after to prove the investigation did not mutate it.

### Non-negotiable safety rules

- Never delete, truncate, rewrite, repair, or reinitialize the incident ledger during diagnosis.
- Never fabricate an `ORDER_SUBMISSION_INTENT` from an execution fill.
- Never infer ownership from a client order ID pattern alone.
- Never weaken provider/account attribution or order ownership invariants to make projection pass.
- Never enable automatic restoration or trading as a side effect of a diagnostic/projection fix.
- No Binance connectivity or order operation is required for this investigation.

## 7. Relevant source files

| Path | Responsibility |
| --- | --- |
| `apps/harvester/scripts/diagnose-operational-state.js` | CLI entry point and safe diagnostic report/exit codes. |
| `apps/harvester/src/infrastructure/operational-state/resolve-directory.js` | Default and environment override for store directory. |
| `apps/harvester/src/infrastructure/operational-state/create-file-store.js` | JSONL files, committed checkpoints, integrity verification/read path. |
| `apps/harvester/src/infrastructure/operational-state/project-harvester.js` | Offline operational facts-to-recovery projection and invariants. |
| `apps/harvester/src/use-cases/record-order-submission-intent.js` | Durable order submission-intent fact producer. |
| `apps/harvester/src/use-cases/record-execution-fill.js` | Durable execution-fill fact producer. |
| `apps/harvester/src/use-cases/execute-strategy-decision.js` | Common order execution flow; intent must precede broker placement and missing required callbacks fail closed. |
| `apps/harvester/src/use-cases/conservative-trading-engine.js` | Conservative callback composition; maps Operational State callbacks to the executor's durable callback contract. |
| `apps/harvester/src/bootstrap/harvester-runtime-setup.js` | Runtime operational-state callback composition/wiring. |

Related documentation: [Journal Operations](../JOURNAL_OPERATIONS.md), [Harvester operations index](README.md), and [Harvester roadmap](../../ROADMAP.md).
