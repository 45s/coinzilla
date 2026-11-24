# Harvester debug evidence archive

This is a forensic export for debugging only. It is not a recovery backup and must never be used to restore trading state.

## Create an archive

Stop the Harvester process first. The command requires an explicit confirmation because it snapshots files that would otherwise be changing.

Set `TRADING_MODE=testnet` in `.env.development`. No archive passphrase or encryption configuration is required.

From the repository root:

```sh
pnpm --filter @coinzilla/harvester archive:debug -- --confirm-stopped
```

The command copies the complete `apps/harvester/logs/` tree (including incomplete/crashed sessions, Journal files, structured logs, TRACE/DEBUG files, and cumulative terminal capture) and the configured Operational State Store directory (`recovery-facts/`, or absolute `OPERATIONAL_STATE_DIRECTORY` when set). A missing recovery-facts directory is explicitly recorded rather than initialized.

It deliberately does not copy databases, configuration files, `.env` files, credentials, or exchange state. It does not modify source evidence, initialize or repair recovery facts, contact Binance, or place/cancel orders. The output is a plain `.tar.gz` file pushed to the private `45s/coinzilla-archive` repository. A local copy remains under `apps/harvester/archive-output/debug/`.

Git must be authenticated for the private archive repository (for example, through Git Credential Manager). No GitHub token is embedded in the script.

## Inspect the archive

Download the `.tar.gz` file from the private archive repository and extract it directly:

```sh
tar -xzf "<path-to-archive.tar.gz>" -C "<empty-output-directory>"
```

The bundle contains `ARCHIVE-MANIFEST.json` with creation time, source commit/worktree metadata, included/missing source directories, and SHA-256 hashes for the copied files. Treat logs and Journal records as sensitive operational data.

## Safety and limitations

- TESTNET only. LIVE and an unspecified trading mode are rejected.
- The operator must stop Harvester and pass `--confirm-stopped`. This is an explicit operator assertion, not proof that no orphan process exists.
- The export is a best-effort filesystem snapshot, not a transactionally consistent database backup.
- Symlinks and non-regular filesystem entries are rejected.
- All session directories are retained; the exporter does not select only the newest completed session. This is intentional so crash evidence is not silently omitted.
- The archive is intentionally unencrypted because this workflow is restricted to TESTNET debugging. The private archive repository still contains raw logs and recovery facts; keep repository access restricted and do not put credentials or `.env` files in the export.
