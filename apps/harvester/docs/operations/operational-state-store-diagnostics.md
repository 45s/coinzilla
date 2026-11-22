# Operational State Store diagnostics and incident investigation

> **Purpose:** This is the durable starting point for the next Operational State Store diagnostic/investigation session. Read this before re-running commands or trying to reconstruct the previous investigation. Current incident tracking: [#1743](https://github.com/45s/coinzilla/issues/1743).

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

### Keep two technical findings separate

1. **Projector registration/order defect:** source inspection found that non-Recovery-Seller submission intents are not registered in the first-pass projector state before fills are processed. This is a separate projector defect requiring a regression test and focused fix.
2. **This ledger's provenance gap:** the diagnostic reports zero `ORDER_SUBMISSION_INTENT` records across all 49 facts. Fixing the projector registration defect alone cannot explain or resolve a ledger that contains no submission-intent fact. Determine why the intent is absent before proposing a ledger-level interpretation.

The 10 cancellation-intent/outcome facts occur later in the full stream. Their presence alongside zero submission-intent counts is not itself proof of a projector bug: the projection aborts at sequence 5, while the diagnostic counts all 49 committed records.

## 6. Safe next-session procedure

1. Read this document and [issue #1743](https://github.com/45s/coinzilla/issues/1743), including its latest comments.
2. Verify the checked-out branch and commit. Confirm the diagnostic's reported source identity matches the code being investigated.
3. Confirm the actual `OPERATIONAL_STATE_DIRECTORY`; identify the exact `facts.jsonl` and `manifest.jsonl` being read.
4. Preserve the original files. Make a separate read-only copy only if local parsing/testing requires it; never edit the user's original ledger.
5. Locate the exact sequence-5 record and search the entire stream for the exact client order ID. Record any matching intent, cancellation, acknowledgement, fill, and session facts in sequence order.
6. Correlate the fill timestamp with stream disconnect/reconnect, REST reconciliation, order submission and acknowledgement logs. Search by exact client order ID and Binance order ID where available.
7. Trace every production broker placement path and its durable-intent callback wiring. Confirm the intent append is durably acknowledged before broker I/O whenever the operational-state store is configured.
8. Reproduce projector behavior using test fixtures or a copied ledger. Add tests for the confirmed defect before changing production behavior.
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
| `apps/harvester/src/use-cases/execute-strategy-decision.js` | Common order execution flow; intent must precede broker placement. |
| `apps/harvester/src/bootstrap/harvester-runtime-setup.js` | Runtime operational-state callback composition/wiring. |

Related documentation: [Journal Operations](../JOURNAL_OPERATIONS.md), [Harvester operations index](README.md), and [Harvester roadmap](../../ROADMAP.md).
