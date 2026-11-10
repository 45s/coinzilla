# Harvester error vocabulary

- Status: active
- Type: Operational reference
- Owner: harvester
- Scope: stable operator-facing diagnostic identifiers emitted by Harvester

This document maps machine-readable error codes to symptoms, likely causes, and safe recovery procedures. The error code does not replace the original error or cause.

## Journal errors

### Journal directory is locked

**Underlying error code:** `JOURNAL_DIRECTORY_LOCKED`

**Meaning:** Journal could not acquire exclusive writer ownership because `<journal-directory>/.coinzilla-journal.lock` already exists. The default Harvester path is `apps/harvester/logs/sessions/<timestamp>-<runtime-session-id>/`; use the exact directory reported by the error because custom Journal directories are supported. The existing lock is deliberately preserved; Journal does not automatically decide whether its owner is stale. This Journal writer lock is separate from Harvester process-ownership locks under `~/.coinzilla/harvester/process-locks/`.

**Possible cause:** A previous Harvester/Journal process was terminated before its normal close completed, leaving the lock file behind. An active second writer using the same directory is another possibility.

**Safe recovery on Windows from Git Bash:**

1. Do not delete the lock while any process may still be writing to that Journal directory.
2. Read the recorded PID from the lock file:

   ```bash
   cat -- "<journal-directory>/.coinzilla-journal.lock"
   ```

3. Check whether the recorded PID currently exists. This command reads the PID from the lock file automatically:

   ```bash
   powershell.exe -NoProfile -Command '$journalDirectory = "<journal-directory-from-error>"; $lockPath = Join-Path $journalDirectory ".coinzilla-journal.lock"; $lock = Get-Content $lockPath -Raw | ConvertFrom-Json; Get-Process -Id $lock.pid -ErrorAction SilentlyContinue | Select-Object Id,ProcessName'
   ```

4. If the process exists, do not remove the lock. Identify whether it owns this Journal directory and allow it to shut down normally. If process inspection is inconclusive, stop and investigate rather than deleting the lock.
5. If the recorded PID is absent, independently confirm that no other Harvester/Journal process is using this directory. The PID and timestamp in the lock are diagnostic hints, not proof by themselves; PIDs can be reused.
6. Only after confirming there is no active writer, remove the lock from the repository root:

   ```bash
   rm -- "<journal-directory>/.coinzilla-journal.lock"
   ```

7. Retry startup:

   ```bash
   cd apps/harvester && pnpm run dev
   ```

**Do not remove:** Journal `.jsonl` session files or diagnostic log files as part of this recovery. The lock is `.coinzilla-journal.lock`; it is not `.coinzilla.log`.

**Safety invariant:** The lock is acquired using exclusive file creation. Normal Journal close releases the lock after the session is synced and closed. Abrupt process termination can leave it behind. Automatic stale-lock takeover is intentionally not supported because a contender cannot safely distinguish a crashed owner from a live writer. See the [Journal package locking contract](../../../packages/journal/README.md) for the package-owned behavior.

**If the error persists:** Preserve the lock and original error details. Check the actual Journal directory reported in the error; do not assume every caller uses `apps/harvester/logs/`. Confirm all writers of that exact directory have stopped before considering manual lock removal.
