# Harvester pre-launch component configuration matrix

**Scope:** startup-time application configuration in `apps/harvester/config/index.js`, validated by `validateAppConfig()` before runtime composition. Changes take effect on the next process launch. This is not a runtime toggle or kill-switch registry.

The first newly explicit component selector is `components.tradingHistoryApi.enabled`, introduced in [PR #1966](https://github.com/45s/coinzilla/pull/1966). The `components` namespace is intentionally allow-listed: adding a component requires typed validation, a startup-composition guard, regression coverage, and a safety/dependency review.

## Configuration matrix

| Component / capability | Existing configuration | Default / current contract | Classification and safe boundary |
| --- | --- | --- | --- |
| Local Trading-history HTTP/WebSocket API | `components.tradingHistoryApi.enabled` | `true` | Optional local observer/API. `false` skips API and listener initialization. It does not disable the relational database, order/fill accounting, trading, reconciliation, or other runtime services. |
| Outbound Telegram notifications | `notifications.telegram.enabled` | `true` | Optional outbound observer. Bot token/chat ID remain environment-only. Disabling outbound notifications does not disable inbound operator control or internal safety gates. |
| Inbound Telegram Command Center | `operatorControl.telegram.enabled` | `true` | Optional authenticated operator interface. Requires a valid private-chat allowlist and environment-only bot token; bootstrap fails closed when enabled but not correctly configured. Independent from outbound notifications. |
| Conservative Coin Grabber strategy | `strategies.CG_coinGrabber.enabled`; `settings.conservative.enabled` | Both `true` | Mandatory executable strategy in the current release. Validation rejects `false`; this PR does not make it optional. |
| Aggressive strategy mode | `settings.aggressive.enabled` | `false` | Deferred. Validation rejects enabling it; do not expose as an available component. |
| CG process-restart recovery | `settings.recovery.enabled` | `false` | Deferred. Validation rejects enabling it until complete history discovery, authoritative reconciliation, readiness, and crash/restart acceptance exist. |
| Per-market CG / RS participation | `strategies.<id>.pairs.<symbol>.enabled` | Explicit per pair | Existing market-selection control, not a global strategy/component switch. Disabling a market does not prove its owned orders, inventory, or recovery obligations are settled. |
| Recovery Seller strategy | `strategies.RS_recoverySeller.enabled` | `true` in the shipped config | Existing safety-sensitive trading-mode setting. Although the schema accepts `false`, do not treat it as an ordinary optional worker or disable it while RS-owned positions/orders/obligations may remain. Any broader disablement needs dedicated inventory, order, and reconciliation acceptance. |
| Logging transports / diagnostic categories | No user-facing `appConfig` switch | Console INFO, DEBUG/TRACE file transports, and runtime-error buffer are composed by `configureHarvesterLogging()` | Required operational evidence. No generic disable flag is introduced. Diagnostic verbosity/category selection must never suppress mandatory WARN/ERROR, security, or audit records. |
| Journal | No user-facing `appConfig` switch; lower-level `prepareOptionalJournal({ enabled })` is a programmatic helper | Enabled by default composition | Broker-connected startup requires Journal readiness and durable flush capability. Its helper-level optional mode is not an operator-facing trading switch; do not disable it for trading. |
| Operational State Store | No generic component switch | Constructed when enabled Recovery Seller / restart-recovery requirements need it | Authoritative durable safety facts and blockers. Not interchangeable with Journal or relational history; failures must remain fail-closed. |
| Relational trading-history persistence | No global component-disable switch | Prepared independently from the local API | Optional history/API degradation is explicit (persisted-history routes return HTTP 503 when unavailable). Disabling the local API does not disable persistence or change accounting ownership. |
| Broker/provider instances | `brokers.instances[]`, `required`, and `executionRouting.routes` | Provider identity/routes are explicit when configured; `required` defaults to required | Provider selection and startup-failure policy, not a generic feature flag. An optional provider failure must not silently reroute execution or make an uncovered market appear ready. |

## Validation and composition rules

1. Validate the complete named `appConfig` before acquiring runtime resources or starting providers.
2. Unknown component names, unknown component fields, and non-boolean `enabled` values fail with a path-specific `ConfigValidationError`.
3. Missing `components` remains backward-compatible for injected/legacy configurations; the shipped config explicitly sets the API default to `true`.
4. A disabled optional component is not constructed or started. Its shared dependencies are not disabled unless they have their own independently audited lifecycle and safety contract.
5. Trading, order/fill accounting, authoritative reconciliation, readiness gates, account STOPs, durable blockers, required Journal barriers, Operational State Store integrity, and mandatory logs are not controlled by this optional-component namespace.
6. Never infer safety from a disabled UI/observer/API, a missing provider, an unavailable history database, or an empty in-memory strategy registry.

## Source contracts

- [Application config validator](../../src/domain/app-config.js)
- [Shipped application config](../../config/index.js)
- [Trading-history API lifecycle](../../src/index.js)
- [Journal operations and durability contract](../JOURNAL_OPERATIONS.md)
- [Telegram Command Center operator contract](../operations/telegram-command-center.md)
- [Harvester roadmap](../../ROADMAP.md)
