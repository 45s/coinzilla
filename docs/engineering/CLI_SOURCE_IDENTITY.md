# CLI source identity rollout

The canonical policy is defined in [Engineering Standards](../../ENGINEERING_STANDARDS.md#executable-cli-identity--mandatory). Every maintained user-invoked executable CLI must expose a side-effect-free `--version` (or equivalent) and print its package, command, package version, full Git commit (or explicit `unknown`), worktree state, and runtime version before operational work.

## Shared implementation

`scripts/cli-identity.js` resolves package metadata and Git identity, formats the banner, and prints it. It reports unavailable Git metadata as `unknown` and never invents a version. Entry points must print identity before loading credentials, contacting services, changing branches, writing reports, or performing mutations. Keep operational imports lazy when module initialization could cause work before the banner.

## Migrated entrypoints in this increment

| Package | Command | Entrypoint | Version-path guarantee |
| --- | --- | --- | --- |
| `@coinzilla/brokers` | `bitunix:healthcheck` | `packages/brokers/scripts/bitunix/run-healthcheck.js` | Prints identity before mode parsing or environment-file loading; `--version` does not load credentials or contact Bitunix. |
| `@coinzilla/notifiers` | `test:telegram-smoke` | `packages/notifiers/scripts/telegram-smoke.js` | Prints identity before lazy-loading the Telegram adapter; `--version` does not require credentials or send a message. |

## Inventory boundary and remaining work

This is an incremental inventory, not a claim that every repository script is a user-facing CLI. Harvester operational commands and root developer-maintenance commands still require entrypoint-by-entrypoint classification and migration under [issue #1631](https://github.com/45s/coinzilla/issues/1631). Test files, helper modules, generated files, and non-user-invoked tooling are not treated as independent operational CLIs. Record each justified exception before declaring the repository-wide inventory complete.

## Verification

- Shared helper: `node --test scripts/cli-identity.test.js`.
- Notifiers: `pnpm --filter @coinzilla/notifiers test`.
- Brokers: `pnpm --filter @coinzilla/brokers test`.
- Repository JavaScript syntax and strict ESLint checks are required on the exact PR head.
- Automated verification must not perform LIVE exchange calls, order mutations, or real Telegram delivery.
