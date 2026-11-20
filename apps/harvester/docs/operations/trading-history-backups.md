# Harvester relational trading-history backups

**Owner:** Harvester application persistence.
**Tracking:** [#1564](https://github.com/45s/coinzilla/issues/1564) / [PR #1567](https://github.com/45s/coinzilla/pull/1567).

This runbook covers routine backups of the Harvester relational trading-history SQLite database and restore verification. It is separate from the one-time pre-relational migration backup described in the [persistence contract](../persistence/README.md#backup-and-rollback).

## Scope and safety

- The command backs up the existing environment-specific Harvester SQLite file. It does not create an empty database if the source file is missing.
- It uses SQLite's online backup API, so committed WAL contents are included in the snapshot. Harvester does not need to be stopped.
- It is a separate maintenance CLI. It is not called from startup, order submission, user-data handling, fill application, accounting, Journal, readiness, or strategy paths.
- It performs no broker or exchange requests and does not need Binance credentials.
- It backs up only the Harvester database file. Journal JSONL, Operational State Store files, application configuration, and credentials are not included.
- Set **TRADING_MODE** explicitly to **testnet** or **live**. **NODE_ENV** never selects the database or exchange environment.

## Database and backup locations

The default database root is apps/harvester/data. If HARVESTER_DATABASE_DIRECTORY is set, that directory becomes the root.

| Environment | Source database | Routine backup directory |
| --- | --- | --- |
| TESTNET (TRADING_MODE=testnet) | data/testnet/harvester.db | data/backups/testnet/ |
| LIVE (TRADING_MODE=live) | data/production/harvester.db | data/backups/production/ |

Backup names contain the environment, UTC timestamp, and a UUID. Each SQLite file has a matching .manifest.json sidecar. The manifest records format version, environment, creation time, filename, schema version, and SHA-256 digest. It contains no absolute source path or credentials.

## Create a backup

PowerShell:

    $env:TRADING_MODE = "testnet"
    pnpm --filter @coinzilla/harvester run persistence:backup

Bash:

    TRADING_MODE=testnet pnpm --filter @coinzilla/harvester run persistence:backup

For LIVE, set TRADING_MODE=live explicitly. Do not infer it from NODE_ENV.

The default retention count is 30 verified backup/manifest pairs. To retain a different count:

    pnpm --filter @coinzilla/harvester run persistence:backup -- --keep 45

The count is a number of backup pairs, not a number of days. Choose a schedule and retention count that satisfy the deployment's recovery-point objective. Do not run overlapping backup jobs.

A successful command:

1. Validates the explicit environment and source database identity.
2. Checks that the current relational schema is applied.
3. Takes an online SQLite backup into a private temporary directory.
4. Writes the manifest and checks the SHA-256 digest.
5. Restores the temporary backup to a separate temporary candidate, applies current Harvester migrations to that candidate, and checks SQLite integrity, foreign keys, and environment consistency.
6. Publishes the backup and manifest without overwriting an existing filename.
7. Applies retention only after restore verification succeeds.

The command reports the backup filename, copied page count, and retained pair count. If the source database is absent, it fails without creating a replacement database.

## Restore verification

A restore check validates the backup against the explicitly selected environment, verifies the manifest and digest, restores it to a temporary candidate on the same filesystem, applies the current Harvester relational migrations to that candidate, checks integrity and foreign keys, reports table row counts, and removes the temporary candidate.

The backup must be in the selected environment's backup directory.

PowerShell:

    $env:TRADING_MODE = "testnet"
    pnpm --filter @coinzilla/harvester run persistence:restore-check -- "C:\path\to\coinzilla\apps\harvester\data\backups\testnet\harvester-testnet-<timestamp>-<uuid>.sqlite"

Bash:

    TRADING_MODE=testnet pnpm --filter @coinzilla/harvester run persistence:restore-check -- /path/to/coinzilla/apps/harvester/data/backups/testnet/harvester-testnet-<timestamp>-<uuid>.sqlite

Use TRADING_MODE=live and the production backup directory for a LIVE backup. A TESTNET backup is rejected when LIVE is selected, and vice versa.

**Restore verification is not a database cutover.** It does not replace the configured database, adopt orders, restore process state, or replay Journal. For an actual recovery, follow a separately approved stopped-process procedure: stop all Harvester processes using the destination, preserve the current database, restore to a new staging filename, validate it, and only then perform a controlled configuration/filesystem switch. Never overwrite an open database.

## Retention and permissions

- The default retention is 30 verified pairs; --keep accepts 1–3650.
- Only recognized backup/manifest pairs with valid metadata and matching digests are eligible for pruning. Unrelated files, orphan files, and invalid/corrupt pairs are left untouched for investigation.
- Retention runs only after the newly created backup has passed its temporary restore check.
- On POSIX systems, the backup root and environment directory are restricted to mode 0700; backup and manifest files are restricted to 0600.
- Node's POSIX mode handling does not configure Windows NTFS ACLs. On Windows, run the task under a dedicated service account and restrict the ACLs on the database root and backups directory to that account and authorized operators. The command does not rewrite NTFS ACLs.
- The SHA-256 digest detects accidental corruption or incomplete copies. It is not a signature and does not prove authenticity if an attacker can replace both the backup and its manifest.

## Scheduling

The repository does not install or own an in-process scheduler. Configure a host-level scheduler under the Harvester service account, with an explicit environment and working directory.

Example daily LIVE cron entry (adjust the time, paths, user, and log destination to the deployment):

    0 2 * * * cd /srv/coinzilla && TRADING_MODE=live pnpm --filter @coinzilla/harvester run persistence:backup >> /var/log/coinzilla-history-backup.log 2>&1

For Windows Task Scheduler, use powershell.exe as the program and a command similar to the following as arguments; set **Start in** to the repository root:

    -NoProfile -Command "& { $env:TRADING_MODE='live'; Set-Location 'C:\path\to\coinzilla'; pnpm --filter @coinzilla/harvester run persistence:backup }"

Create separate tasks for TESTNET and LIVE, each with its own explicit TRADING_MODE. Monitor task exit codes and logs. The selected schedule determines the maximum time window in which an execution may not yet be represented in a backup.

## Operational limitations

This work does not configure off-host replication, encryption-at-rest, disk/WAL monitoring, disk-full alerts, corruption response, or an automated in-place restore. Keep a protected off-host copy of both the SQLite file and its manifest using the deployment's approved encrypted backup system. Verify copied pairs after transfer. Retention on the local host is not a substitute for off-host disaster recovery.
