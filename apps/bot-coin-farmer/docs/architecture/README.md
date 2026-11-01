# Coin Farmer Architecture Documentation

This directory is the app-level design reference for `apps/bot-coin-farmer`.

## Read in this order

1. [Application architecture](./COIN_FARMER_ARCHITECTURE.md) — system context, dependencies, domain/application/adapters/runtime, strategy and safety.
2. [Module catalog](./MODULE_CATALOG.md) — concrete folder/file structure and responsibility boundaries.
3. [Workflows](./WORKFLOWS.md) — runtime, BUY, SELL, fills, recovery, notifications and shutdown.
4. [V1-to-CF behavior map](./V1_TO_V2_BEHAVIOR_PLAN.md) — what is preserved, redesigned or left open.
5. [Implementation roadmap](../../ROADMAP.md) — phased implementation, PR-sized work and acceptance gates.

## Diagrams

The `.mmd` files are editable Mermaid source. The application README embeds the system context diagram; the architecture/workflow documents link to the other diagrams.

- [System context](./diagrams/system-context.mmd)
- [Component architecture](./diagrams/component-architecture.mmd)
- [Per-market lifecycle](./diagrams/market-lifecycle.mmd)
- [Standing BUY flow](./diagrams/buy-order-flow.mmd)
- [Recovery SELL flow](./diagrams/sell-recovery-sequence.mmd)
- [Execution accounting](./diagrams/execution-accounting-flow.mmd)
- [Reconnect/restart recovery](./diagrams/recovery-sequence.mmd)
- [Telegram notifications](./diagrams/notification-flow.mmd)
- [Persistence evolution](./diagrams/persistence-evolution.mmd)

## Design status

The separate-app boundary, Node.js/JavaScript runtime, CEX-agnostic strategy boundary, first Binance WebSocket adapter, first Telegram notifier, and persistence-port/future-database direction are the current design baseline. Exact method signatures, DB technology, and unresolved strategy policy are deliberately left for the roadmap phases that have evidence to decide them.

No document here implies that a source module exists or that trading is safe to enable.
