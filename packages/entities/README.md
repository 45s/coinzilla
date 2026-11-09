# @coinzilla/entities

Exchange-neutral domain entities and value objects shared across Coinzilla applications and infrastructure packages.

## Public contracts

The package entry point is `src/index.js`. It exports:

- **Core identity and market concepts:** `Asset`, `Market`
- **Canonical financial values:** `Money`, `Quantity`
- **Canonical order lifecycle:** `CanonicalOrder`
- **Execution/accounting facts:** `Fill`, `Commission`, `Balance`
- **Trading constraints:** `TradingRules`
- **Broker-neutral capabilities and outcomes:** `BrokerCapabilities`, `BrokerResult`
- **Legacy compatibility contracts:** `Coin`, `Order`, `ExecutedOrder`
- Associated error messages, status values and enumerations explicitly exported by the entry point.

`Coin.quantity` and the `Order`/`ExecutedOrder` price and quantity fields retain JavaScript `Number` representations for compatibility. They are not the canonical exact-decimal accounting contracts. New domain work should use `Asset`, `Market`, `Money`, `Quantity`, and `CanonicalOrder` (with `Fill`, `Commission`, and `Balance` for execution/accounting facts). Do not silently change the legacy contracts; migrate consumers deliberately through an explicitly reviewed compatibility plan.

Use the package's public entry point rather than importing private implementation paths:

```js
import { Money, Quantity, Fill, Commission, CanonicalOrder } from '@coinzilla/entities'
```

## Domain boundaries

- Keep contracts exchange-neutral; do not expose Binance SDK types.
- For canonical financial/accounting contracts, represent amounts with exact decimal strings/value objects; do not route them through JavaScript `Number`.
- Treat `Coin`, `Order`, and `ExecutedOrder` as legacy Number-based compatibility contracts, not as the canonical exact-decimal model. Preserve their existing behavior until consumers are migrated deliberately.
- Preserve explicit unknown/incomplete states and commission asset identity.
- Keep domain entities independent of application orchestration and infrastructure adapters.
- Public API changes require consumer inspection, deterministic tests and a documented migration impact.

## Development

```sh
pnpm --filter @coinzilla/entities test
```

## Ownership and planning

- [Agent instructions](./AGENTS.md) — mandatory package-specific engineering constraints.
- [Roadmap](./ROADMAP.md) — current priorities and deferred work.
- [Domain ownership](../../docs/engineering/DOMAIN_OWNERSHIP.md) — repository-wide ownership boundaries.
- [Engineering standards](../../ENGINEERING_STANDARDS.md) — canonical TDD, design and documentation requirements.
