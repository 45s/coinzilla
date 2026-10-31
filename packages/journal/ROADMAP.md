# Journal roadmap

**Owner:** `packages/journal/`  
**Purpose:** provide reliable journal records and persistence behavior for application and operational history.

Read [the journal agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Preserve historical facts; do not silently rewrite or discard records.
- Make record identity, serialization, schema evolution, and replay behavior explicit.
- Keep persistence I/O at clear boundaries.
- Keep journal contracts independent of strategy-specific decisions.
- Handle partial failures and restart/recovery safely.

## Roadmap

- [ ] Document the current journal record schema and public API.
- [ ] Verify append/read ordering and behavior after partial write failures.
- [ ] Define and test duplicate/replay handling and stable record identity.
- [ ] Define serialization compatibility and schema evolution policy.
- [ ] Verify recovery behavior after process interruption and malformed records.
- [ ] Verify resource cleanup and bounded memory/disk behavior where applicable.

## Completion policy

A journal capability is complete only when its behavior is documented, failure/recovery paths are tested, and the change is merged into `develop`.
