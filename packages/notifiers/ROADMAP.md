# Notifiers roadmap

**Owner:** Notifiers domain
**Scope:** `packages/notifiers/`

## Current position

Telegram transport, provider-oriented layout, reliability hardening, EventBus integration coverage, delivery diagnostics, supported Node CI, operator-controlled smoke tooling, and validation hardening are recorded as merged in the prior delivery history.

## Active maintenance

- Preserve safe best-effort notification behavior; notification failures must not block or alter trading decisions.
- Keep message formatting and transport boundaries isolated from trading logic.
- Keep malformed-input, async failure, logger/callback failure, and event integration regression coverage.
- Live Telegram smoke tests remain operator-controlled; never send real notifications automatically in CI.
- Add another transport or stronger delivery guarantees only for a concrete consumer requirement.

## Canonical sources

- Package usage and supported behavior: [README](./README.md)
- Implementation and tests: package source
- CLI source identity rollout: [#1631](https://github.com/45s/coinzilla/issues/1631) and [repository inventory](../../docs/engineering/CLI_SOURCE_IDENTITY.md)
- Task status: GitHub Issues/PRs

Detailed phases, decisions, validation records, and historical delivery notes are preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#notifiers-roadmap).
