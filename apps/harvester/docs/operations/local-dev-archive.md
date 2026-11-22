# Local Harvester DEV archive — decisions and implementation record

> Status: archive command implemented on the task branch; local execution and end-to-end private-remote verification remain pending.
> Tracking issue: [#1742](https://github.com/45s/coinzilla/issues/1742).
> Task branch: `feat/harvester-local-dev-reset-archive`.
> Private destination: `45s/coinzilla-archive` (private repository).

This document is the durable handoff for this work. A future contributor must continue from this record and the linked issue, not rediscover decisions from chat history.

## 1. Confirmed scope (latest operator decision)

The first deliverable is only:

1. Copy the Harvester DEV/TESTNET database into an archive.
2. Copy the logs belonging to the process being archived.
3. Verify the local archive.
4. Push the archive artifact to the private `45s/coinzilla-archive` repository.

Explicitly out of scope for this iteration:

- No encryption. The operator explicitly said: “skip encryption part”.
- No reset, truncation, deletion, cleanup, or reinitialization of active data.
- No facts-store migration or facts archival.
- No PROD/LIVE database or logs.
- No exchange API calls, order/account mutations, or trading-process control.
- No upload to the public `45s/coinzilla` source repository.

The archive is intentionally a plain, unencrypted artifact in a private repository. This is an explicit operator decision, not a claim that the artifact is encrypted or safe for public distribution.

## 2. Archive identity: process start, not archive-command time

The archive must identify the Harvester process that produced the data.

- Timestamp: UTC process-start timestamp, captured once by the dev launcher.
- Source revision: full Coinzilla Git commit SHA captured for that process at startup.
- Worktree state: capture clean/dirty state at process startup when available.
- Archive directory name: `<UTC-process-start-timestamp>_<short-commit-sha>`, for example `2026-11-22T14-43-00Z_a1b2c3d`. The full commit SHA remains in the manifest.
- The archive command must read the persisted process identity. It must **not** run `git rev-parse HEAD` at archive time and substitute the current checkout's commit.
- If the process-start timestamp or source commit is unavailable/invalid, fail closed. Never silently fall back to current time or current HEAD.

### Existing source facts inspected

`apps/harvester/scripts/run-dev-with-log.js` currently captures `sessionStartedAt` and `runtimeSessionId` before spawning `src/index.js`, and passes them as `COINZILLA_PROCESS_STARTED_AT` and `COINZILLA_RUNTIME_SESSION_ID`. It creates the per-process session directory using those values.

The Journal process-start event schema already records allowlisted Git source metadata (branch, full/short commit, subject/date, working-tree state and metadata source). Reuse the canonical process identity/provenance path; do not create a competing provenance format.

**Implemented startup identity slice:**

- `run-dev-with-log.js` captures `captureBuildMetadata()` once before spawning Harvester and stores the allowlisted source snapshot with the process-start timestamp, runtime session UUID and `TRADING_MODE`.
- The launcher writes `logs/sessions/<timestamp>-<runtime-session-id>/process-identity.json` using exclusive creation (`wx`) and restrictive file mode (`0600`). An existing identity is never overwritten.
- The child receives the exact captured source snapshot through the internal `COINZILLA_PROCESS_SOURCE_METADATA` environment value. `createHarvesterProcessIdentity()` reuses that snapshot for the Journal process-start event and does not perform a second Git lookup.
- If startup Git provenance is unavailable, the identity records explicit null/unknown values. The later archive command must reject missing/invalid commit provenance; it must not substitute the current checkout's HEAD.
- The persisted identity contains only allowlisted build metadata and process facts. It does not serialize the environment or credentials.

The archive command is implemented as `pnpm run archive:push`. It selects the newest eligible TESTNET session (or accepts `--session <runtime-session-id>`), uses the persisted process identity, creates a verified snapshot through the existing SQLite backup service, copies only that session directory and the backup pair, writes a SHA-256 manifest, and pushes a non-overwriting directory to the private remote. The operator must run it after the Harvester process has stopped so session files are stable.

## 3. Data selection

### Database

- Include only the TESTNET database resolved by the existing database resolver: `data/testnet/harvester.db` under the configured database root.
- Require `TRADING_MODE=testnet`; reject missing, invalid, or LIVE mode.
- Use the existing SQLite WAL-aware online backup service/API. Do not copy a live SQLite main file directly while ignoring WAL/SHM state.
- Verify SQLite integrity and the backup checksum before packaging/publishing.
- Never read or include `data/production/` or a LIVE database.

### Logs

- Include the per-process session directory associated with the captured runtime session ID and process-start timestamp. It contains structured diagnostic output and terminal evidence; the Journal file is colocated with that session.
- Preserve source files. Archiving is copy-only.
- The current `logs/cumulative/terminal.log` is shared/append-only across runs and may mix DEV and PROD. Exclude it until environment ownership can be proven; do not archive the entire shared `logs/` tree.
- Do not guess that a legacy/root-level log or Journal session belongs to DEV.

### Facts and Journal

The Journal file inside the selected process session is included as part of that session's logs/evidence. The separate Operational State Store facts (`facts.jsonl` and `manifest.jsonl`) are excluded in this narrowed milestone. Do not modify or migrate them.

## 4. Local artifact and remote publication

- Produce one uniquely named archive artifact per process/session.
- Keep archive storage flat: no nested archive folders per session.
- Include a manifest inside the artifact recording format version, environment, process-start timestamp, full source commit, worktree state, runtime session ID, source paths, file sizes and checksums.
- Verify the completed artifact and manifest before any remote write.
- Publish only to the configured private remote `https://github.com/45s/coinzilla-archive.git`, branch `main`, under its `archives/` directory.
- Do not force-push, rewrite history, overwrite an existing artifact, or commit operational data to the source repository.
- Remote publication must verify the exact artifact bytes were committed. A failed push must leave the local artifact intact for retry.
- The existing `archive:repo:init` command only initializes the private repository and creates its README plus `archives/.gitkeep`; it does not archive or upload operational data.

The private remote was initialized successfully by the operator with:

```bash
pnpm run archive:repo:init

After stopping the Harvester DEV process, publish its TESTNET DB snapshot and matching session evidence with:

```bash
pnpm run archive:push
```

To select a specific prior TESTNET session rather than the newest one:

```bash
pnpm run archive:push -- --session <runtime-session-id>
```

The local archive is retained under `apps/harvester/data/archives/<timestamp>_<short-commit>/`. The remote receives the same directory under `archives/`. A failed push leaves the local directory in place; retry is safe only after confirming the remote directory was not created.
```

Configured local environment value:

```env
HARVESTER_ARCHIVE_REMOTE=https://github.com/45s/coinzilla-archive.git
```

This bootstrap success verifies the operator's local HTTPS Git push access. It does not verify that the archive copy/publish workflow exists.

## 5. Safety invariants

- Copy only; never reset or delete source files.
- Require explicit TESTNET mode.
- Refuse if the process/session identity cannot be established.
- Refuse symlinks, path aliases, missing files, partial sessions, corrupt SQLite backups, checksum mismatch, archive-name collision, or incomplete artifact.
- Do not terminate Harvester or bypass its process lock.
- Do not read or alter PROD data.
- Do not expose credentials, API keys, environment-file contents, or secrets in archive metadata.
- Keep the local archive if remote publication fails.
- No exchange requests or order/account mutations.

## 6. Implementation sequence

1. Inspect and reuse the existing startup process identity and Git provenance implementation.
2. Capture the immutable full source commit and worktree state in the dev launcher at process start; pass it to the child using explicit, non-secret process metadata.
3. Use the persisted process identity to select the exact session; the command defaults to the newest eligible TESTNET session and supports an explicit runtime session ID.
4. Create the TESTNET SQLite snapshot through the existing online backup service.
5. Copy the snapshot/backup manifest and exact session directory, including colocated Journal evidence.
6. Build the timestamp/short-commit directory with an internal manifest and SHA-256 checksums.
7. Verify all local files and SQLite backup before publication.
8. Push a new, non-overwriting directory to the private remote and verify remote blob IDs.
9. Run the focused archive tests and full package tests locally; perform the first real archive push only under the operator's local control.

Do not add reset behavior as an incidental extension. Any later reset request requires a separately scoped, explicitly reviewed change.

## 7. Existing implementation inspected

- `scripts/initialize-private-archive-repository.js`: validates an HTTPS/SSH remote, refuses a non-empty remote, creates an initial `main` commit and pushes it without force. This is bootstrap only.
- `scripts/run-dev-with-log.js`: captures process start time and runtime session ID before child spawn; writes per-session terminal output and a shared cumulative terminal log.
- `src/infrastructure/logging/create-harvester-log-session-paths.js`: canonical per-session path resolver.
- `src/infrastructure/persistence/trading-history-backups/create-backup.js`: existing WAL-aware SQLite backup, checksum manifest, integrity verification and retention service. Reuse its online backup/verification primitives; do not make a raw DB copy.
- `src/infrastructure/persistence/resolve-harvester-database-filename.js`: explicit isolated TESTNET/LIVE database path resolver.

## 8. Current completion status

Completed:
- Task branch exists: `feat/harvester-local-dev-reset-archive`.
- Private archive repository exists and was initialized by the operator.
- `HARVESTER_ARCHIVE_REMOTE` configuration is documented in the Harvester environment template.
- `archive:repo:init` bootstrap script and its tests were committed.
- Existing process-session logging, Journal co-location, database isolation and online SQLite backup implementations were inspected.
- Operator narrowed the milestone to copy + push logs/database only, explicitly without encryption and without reset.

Not completed:
- Startup commit/worktree snapshot is not yet captured by the launcher as an immutable archive identity.
- `archive:push` now implements TESTNET-only session selection, WAL-aware DB snapshot, session-log/Journal copy, manifest/checksum verification, non-overwriting remote push and remote blob verification.
- Archive naming uses the persisted process-start timestamp and startup source commit; missing provenance fails closed.
- Regression tests cover archive naming and fail-closed identity validation.
- End-to-end execution, package tests and a real private-remote publication have not been run from this assistant environment. The operator must run the command locally after pulling the branch.

## 9. Resume checklist

A new contributor should:

- Read repository `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, Harvester `AGENTS.md`, `TRADING_FIRST.md`, `ROADMAP.md`, and the Harvester persistence/logging/Journal operations docs.
- Read issue [#1742](https://github.com/45s/coinzilla/issues/1742) and this document.
- Start from the task branch and latest `develop` per repository workflow; preserve the single-branch/single-PR task contract.
- Continue at implementation sequence step 1. Do not reopen settled scope decisions unless the operator changes them.
- Record every implementation decision, command, test/CI result, commit, PR and remaining limitation in this document and the issue so the work is never dependent on chat history.
