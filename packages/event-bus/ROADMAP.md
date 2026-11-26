# Event Bus roadmap

**Owner:** `@coinzilla/event-bus`  
**Last reviewed:** 2026-11-26

> The previous detailed roadmap, including reliability matrix, engineering instructions, decision log, and validation history, is preserved in [Event Bus roadmap history](../../docs/archive/roadmap-history-2026-11-26.md#event-bus-roadmap).

## Current position

Core hardening is complete. No critical defect was established in the prior implementation audit. Preserve the existing explicit delivery, failure-isolation, bounded-resource, immutability, and lifecycle guarantees.

## Active priorities

1. Keep publish/delivery/shutdown semantics documented and regression-tested.
2. Keep diagnostics bounded and semantically precise.
3. Do not add retries, sequential delivery, AbortSignal cancellation, dead-letter handling, persistence, or distributed-messaging behavior without a concrete consumer requirement and an accepted compatibility contract.

## Source of truth

- Public behavior: [Event Bus README](./README.md), source, and tests
- Cross-package durability: application-owned durable log/outbox; Event Bus is in-process and does not promise crash durability or exactly-once side effects
- Task status: GitHub issue/PR for a demonstrated defect or consumer requirement

This roadmap is not a generic feature backlog. Keep completed validation logs and duplicate contributor instructions in the archived history; current contributor policy belongs in `AGENTS.md`.
