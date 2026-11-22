# Harvester local development archive

> **Status: complete and operator-verified (2026-11-22).** The existing `pnpm run archive:push` command created a compact evidence snapshot, verified it locally, published it to the private `45s/coinzilla-archive` repository, and verified all 14 remote files.
>
> Tracking issue: [#1742](https://github.com/45s/coinzilla/issues/1742)  
> Implementation branch: `feat/harvester-local-dev-reset-archive`  
> Private destination: `https://github.com/45s/coinzilla-archive.git`

## Current archive contract

Run the existing command from `apps/harvester`:

```bash
pnpm run archive:push
```

The command requires `TRADING_MODE=testnet` and publishes only to the configured private archive repository. It does not start or stop Harvester, call exchange APIs, change trading configuration, or reset/clean operational state.

Each uniquely named `archives/<archive-id>/` snapshot contains:

- `logs/cumulative/**`: final 5% of each regular file, retained as tail bytes.
- `logs/sessions/**`: only the lexicographically newest timestamp-named session directory; every regular file in that session is gzip-compressed with a `.gz` suffix.
- Other top-level entries under `logs/`: copied unchanged.
- `data/**`: copied completely, including database files and any SQLite WAL/SHM sidecars present.
- `recovery-facts/**`: copied completely.
- `data_commit_hash`: derived from and validated against the latest committed recovery-facts checkpoint.
- `manifest.json`: archive metadata and file inventory, sizes, and SHA-256 checksums.

The archive is intentionally selective for logs: older session directories are excluded, and cumulative logs are truncated to their final 5% in the archive copy. The original source directories are not modified. The local archive is written under `apps/harvester/archive-output/`, outside the source trees.

The snapshot is a raw folder copy, not a transactional SQLite backup. File checksums establish the bytes copied; they do not establish SQLite transactional consistency or classify every file under `data/` as TESTNET. Run against a stopped process where practical.

## Safety and publication behavior

- Reject symlinks and unsupported filesystem entries; do not follow them.
- Never serialize environment variables or credentials into the manifest.
- Never write operational data to the source `45s/coinzilla` repository.
- Publish a unique archive directory without force-push or overwrite.
- Verify local inventory and checksums before publishing.
- Verify the remote commit and each archived file blob after pushing.
- Preserve the local snapshot if publication fails; do not delete or rewrite source evidence.
- No reset, source cleanup, migration, process control, exchange request, or order/account mutation is part of this workflow.

## Verified operator run — 2026-11-22

Focused test command, run from `apps/harvester`:

```bash
node --test scripts/archive-testnet-session.test.js
```

Result: **5 passed, 0 failed**.

Archive command:

```bash
pnpm run archive:push
```

Result: **published and remotely verified**.

| Item | Verified result |
|---|---|
| Archive path | `archives/2026-11-22T17-35-17Z_77213df6` |
| Local copy | `apps/harvester/archive-output/2026-11-22T17-35-17Z_77213df6` |
| Remote commit | `f283c90db9143c74683ae5bf9c7bb52e09590d56` |
| Files verified remotely | 14 |
| Evidence copied | 189.4 MB |
| Cumulative logs | Final 5% retained |
| Session logs | Newest session only, gzip-compressed |
| Data and recovery facts | Complete |
| Local checksum verification | Passed |
| Remote commit/blob verification | Passed |

GitHub emitted its recommended-size warning for two cumulative log files (approximately 91.85 MB and 92.56 MB). Both are below GitHub's 100 MB ordinary Git file limit; the push succeeded and remote verification passed.

The earlier failed 7.3 GB local archive was not reused, overwritten, or deleted. It remains at its original local path. The successful compact snapshot is a separate archive.

## Historical decisions

The initial design explored process identity/completion markers, exact-process session selection, and a WAL-aware SQLite backup. The operator later explicitly changed scope to archive the already-existing local folders without starting another Harvester process. Those earlier process-scoped requirements are superseded by the current contract above.

The issue title originally mentioned resetting local operational state. **Reset is explicitly out of scope**: this workflow archives evidence only and never deletes or resets local state.
