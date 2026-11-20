# Domain ownership

Coinzilla is a monorepo with independently maintained application and package domains. Ownership is defined by repository paths and local instructions, not by permanent Git branches.

| Domain | Owned path | Responsibility |
| --- | --- | --- |
| Harvester | `apps/harvester/` | Portfolio/position workflows, strategies, use cases and application composition |
| Entities | `packages/entities/` | Exchange-neutral domain entities, identity, exact value contracts, lifecycle/value semantics |
| Brokers | `packages/brokers/` | Broker contracts/adapters, exchange API integration, normalization, market/account/order I/O |
| Indicators | `packages/indicators/` | Exchange-neutral technical-indicator calculations over normalized caller-supplied market data |
| Utils | `packages/utils/` | Domain-neutral reusable helpers, logging and generic utilities |
| Event bus | `packages/event-bus/` | Event publication, subscription, delivery and event-bus reliability |
| Journal | `packages/journal/` | Journal records, persistence boundaries and journal-specific behavior |
| Database Infrastructure | `packages/db/` | Provider-neutral record CRUD/query contracts, database lifecycle/transactions, and concrete database infrastructure adapters |
| Notifiers | `packages/notifiers/` | Telegram notification formatting, delivery and lifecycle safety |

## Indicators domain

`@coinzilla/indicators` owns pure, deterministic, exchange-neutral technical-indicator calculations over normalized caller-supplied market data. It owns its public API, tests, documentation and roadmap. The first consumer is Harvester high-volatility protection (#1016); adaptive price-step planning (#1013) is a later consumer. Harvester retains strategy/risk policy; Brokers retains exchange-specific candle retrieval and normalization. See the [Indicators README](../../packages/indicators/README.md) and [Indicators roadmap](../../packages/indicators/ROADMAP.md).

## Workspace package dependency policy

The workspace dependency graph is intentionally one-way: the Harvester application composes shared packages; shared packages depend only on the packages listed below. This is the canonical allowlist for direct **workspace-package** dependencies. It is derived from the current package manifests and must be updated in the same PR as an approved dependency change.

| Consumer | Allowed direct workspace dependencies |
| --- | --- |
| `@coinzilla/harvester` | `@coinzilla/brokers`, `@coinzilla/db`, `@coinzilla/entities`, `@coinzilla/event-bus`, `@coinzilla/indicators`, `@coinzilla/journal`, `@coinzilla/notifiers`, `@coinzilla/utils` |
| `@coinzilla/brokers` | `@coinzilla/entities`, `@coinzilla/utils` |
| `@coinzilla/db` | `@coinzilla/utils` |
| `@coinzilla/entities` | `@coinzilla/utils` |
| `@coinzilla/event-bus` | `@coinzilla/utils` |
| `@coinzilla/indicators` | `@coinzilla/utils` |
| `@coinzilla/journal` | `@coinzilla/event-bus`, `@coinzilla/utils` |
| `@coinzilla/notifiers` | None |
| `@coinzilla/utils` | None |

Rules:

- A workspace package must not depend on an application, on a consumer package, or on another workspace package absent from its row above. Do not create reverse dependencies or cycles.
- Consumers import another package through its supported public package entry point. Do not reach into another package's private `src/` paths.
- The Harvester application is the composition boundary and may depend on the shared packages listed for it; shared packages must not import Harvester or application-specific policy.
- Keep business rules in the owning domain. In particular, Brokers owns exchange integration, Entities owns exchange-neutral value contracts, DB owns generic persistence infrastructure, Event Bus owns delivery semantics, Journal owns journal records/persistence, Indicators owns exchange-neutral calculations, Notifiers owns notification transport, and Utils owns domain-neutral helpers.
- Before adding an edge, explain the required capability, why the existing public contracts or an application-owned port are insufficient, all affected consumers, and the impact on dependency direction. Coordinate cross-domain changes using the [cross-domain request process](./CROSS_DOMAIN_REQUESTS.md).
- Update the affected package manifest, this table, package documentation/roadmap, and consumer tests in the same PR. Verify the resulting manifest graph remains acyclic.

This table governs package-to-package dependencies; it does **not** prove internal source-file boundaries. Each package's local architecture instructions and tests remain authoritative for its internal layers. The current repository has package-scoped architecture checks, not a complete repository-wide source-import checker. See the [Modularity Standard](./MODULARITY_STANDARD.md) and [ADR-0001](../architecture/decisions/ADR-0001-clean-hexagonal-architecture.md) for module-level direction and review requirements.

## Representative internal import boundaries

The following examples were checked against the current source tree. They show the intended direction; they are representative, not an exhaustive import graph.

| Layer | Source example | Observed dependency direction |
| --- | --- | --- |
| Harvester Domain | `apps/harvester/src/domain/strategies/recovery-seller/evaluate-buy-decision.js` | Imports domain siblings and domain-neutral decimal helpers from `@coinzilla/utils`; does not import Brokers, DB, Telegram, or infrastructure adapters. |
| Harvester Application | `apps/harvester/src/use-cases/execute-strategy-decision.js` | Imports canonical `@coinzilla/entities` values, `@coinzilla/utils`, and Harvester domain policies; broker operations arrive through injected options. |
| Harvester Infrastructure | `apps/harvester/src/infrastructure/persistence/order-history-repository.js` | Imports the public `@coinzilla/db` contract and Harvester-owned domain errors/transitions; persistence-specific coordination stays in Infrastructure. |
| Brokers Domain | `packages/brokers/src/domain/user-data-recovery-policy.js` | Owns a pure recovery-completion decision and has no imports. |
| Brokers Application | `packages/brokers/src/application/user-data-session.js` | Imports the Domain policy and its own Application port contract; it does not import Binance protocol code. |
| Brokers Infrastructure | `packages/brokers/src/infrastructure/binance/spot/user-data-client-adapter.js` | Imports Binance-specific protocol adapters and adapts them to the Brokers Application port. |
| Brokers public facade | `packages/brokers/src/index.js` | Exposes the supported broker contract and concrete provider adapters; it contains exports, not business orchestration. |

Examples of the actual imports:

```js
// Harvester Domain
import { addDecimal, assertDecimalString } from "@coinzilla/utils"
import { calculateInitialBuyPrice } from "../conservative/initial-buy-price.js"

// Harvester Application
import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createPendingCanonicalOrder } from "../domain/orders/create-pending-canonical-order.js"

// Harvester Infrastructure
import { DatabaseConflictError } from "@coinzilla/db"
import { OrderHistoryIntegrityError } from "../../domain/order-history/order-history-errors.js"

// Brokers Application
import { canCompleteUserDataRecovery } from "../domain/user-data-recovery-policy.js"
import { assertUserDataClientPort } from "./ports/user-data-client-port.js"

// Brokers Infrastructure
import { adaptMsg } from "./broker-websocket/helpers/adapters/adapt-msg.js"
import { getUserDataEventIdentity } from "./broker-websocket/helpers/user-data-event-identity.js"
```

Test files may deliberately import infrastructure to exercise integration boundaries; do not classify test-only imports as production dependency violations. A source-level audit must distinguish production files from tests and fixtures. These examples do not prove every module follows the rule; the current automated checks remain package-scoped.


## Shared infrastructure

The following are cross-domain and must be treated as shared ownership: root package manifests and lockfile, CI workflows, GitHub rules, root engineering documentation, workspace scripts, and dependency policy.

An agent changing shared infrastructure must:

- Explain why the change is needed and which domains it affects.
- Check all affected package/app consumers.
- Add or update integration-level tests where appropriate.
- Update central documentation and the relevant domain instructions.
- Keep the change narrowly scoped.

## Boundary rules

- A domain owns its public API, implementation, tests, roadmap, and local agent instructions.
- Consumers may open issues or cross-domain requests; they do not directly implement another domain's internal changes.
- Shared entities and broker contracts must remain exchange-neutral. Exchange-specific details belong in broker adapters.
- Generic utilities must not become a dumping ground for domain logic.
- Cross-domain contract changes require explicit consumer impact analysis and coordinated migration.
- A task PR should have one primary owning domain. Split coordinated work into multiple PRs when practical.

See [the mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for request, branch, merge, and release procedures.
