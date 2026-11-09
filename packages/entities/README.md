# @coinzilla/entities

Exchange-neutral domain entities and value objects shared across Coinzilla applications and infrastructure packages.

## Public contracts

The package entry point is `src/index.js`. It exports:

- **Core identity and market concepts:** `Coin`, `Asset`, `Market`
- **Financial values:** `Money`, `Quantity`
- **Orders:** `Order`, `ExecutedOrder`, `CanonicalOrder`
- **Execution/accounting facts:** `Fill`, `Commission`, `Balance`
- **Trading constraints:** `TradingRules`
- **Broker-neutral capabilities and outcomes:** `BrokerCapabilities`, `BrokerResult`
- Associated error messages, status values and enumerations explicitly exported by the entry point.

Use the package's public entry point rather than importing private implementation paths:

```js
import { Money, Quantity, Fill, Commission, CanonicalOrder } from '@coinzilla/entities'
```

## Domain boundaries

- Keep contracts exchange-neutral; do not expose Binance SDK types.
- Represent financial amounts with exact decimal strings/value objects; do not route financial values through JavaScript `Number`.
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