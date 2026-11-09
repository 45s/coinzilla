---
title: "ADR-0002: Dual local process-ownership locks"
status: accepted
type: architecture-decision
owner: harvester
date: 2026-11-09
---

# ADR-0002: Dual local process-ownership locks

## Context

A Journal-directory lock prevents two processes from writing the same recovery-history directory. It does not prevent two Harvester processes from trading through the same broker/account when they use different Journal directories.

That is an unacceptable ownership gap: separate Journal directories must not permit two same-user Harvester processes to submit orders through the same broker concurrently.

The lock is a local same-host/same-OS-user guard. It is not a distributed coordination mechanism.

## Decision

Trading-enabled startup acquires two exclusive locks, in this order:

1. **Broker-wide host lock** under `~/.coinzilla/harvester/process-locks/`, with a filename scoped by broker (for Binance, `.binance-harvester-trading.lock`). It is independent of the configured Journal directory and prevents a second process under the same OS user's home directory from trading through the same broker.
2. **Journal-directory lock** named `.harvester-trading.lock` inside the configured Journal directory. It prevents concurrent Journal writers for that directory.

Shutdown releases the Journal-directory lock first. The host lock is released only after Journal-lock release is confirmed. If Journal-lock release is uncertain, retain the host lock. Both locks remain held unless runtime shutdown and Journal close are confirmed.

A stale lock may be reclaimed automatically only when its recorded hostname matches the current host, its PID is confirmed absent, and an immediate reread confirms that PID, hostname and ownership token have not changed. Remote-host, live/ambiguous, unreadable or permission-denied ownership fails closed.

## Alternatives considered

### Journal-directory lock only

Rejected. Two processes can select different Journal directories and still trade through the same broker/account.

### One machine-wide lock independent of broker

Rejected. It would unnecessarily prevent independent brokers from being used by separate Harvester processes under the same OS user.

### Distributed lock service

Rejected for the current local-process ownership requirement. It would introduce an external dependency and operational failure mode without providing a needed cross-machine trading deployment contract.

### No process lock

Rejected. Duplicate same-user processes could submit conflicting orders and corrupt local ownership assumptions.

## Consequences

- One Harvester trading process per broker per OS user on a host, even if Journal directories differ.
- Different OS users and different machines are not coordinated; this is not a distributed lock.
- The Journal lock still protects the selected Journal directory against concurrent writers.
- Lock acquisition/release order is part of the safety contract.
- Ambiguous ownership or uncertain release fails closed and may retain the host lock for manual investigation.
- Automatic stale-lock reclamation is deliberately narrow and token-checked.

## Verification and references

- [Journal Operations — Trading process ownership locks](../JOURNAL_OPERATIONS.md#trading-process-ownership-locks)
- Source: `apps/harvester/src/index.js`
- Source: `apps/harvester/src/infrastructure/process-lock/acquire-harvester-process-lock.js`
- Source: `apps/harvester/src/infrastructure/process-lock/acquire-harvester-process-locks.js`
- Tests: `acquire-harvester-process-lock.test.js` and `acquire-harvester-process-locks.test.js`
