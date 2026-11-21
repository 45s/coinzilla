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

## Current implementation map

This map records the actual top-level source layout at the S-1 audit baseline. It describes the current code, not a mandate to reorganize packages into identical templates.

| Domain | Current source layout | Representative production entry/file |
| --- | --- | --- |
| Harvester | `apps/harvester/src` | `src/use-cases/execute-strategy-decision.js`; `src/domain/strategies/recovery-seller/evaluate-buy-decision.js` |
| Brokers | `packages/brokers/src` plus public facade | `src/application/user-data-session.js`; `src/infrastructure/binance/spot/user-data-client-adapter.js`; `src/index.js` |
| DB | `packages/db/src` plus provider entrypoints | `src/application/ports/database-provider.js`; `src/infrastructure/` adapters |
| Entities | Feature folders under `packages/entities/src` (`assets`, `balances`, `canonical-orders`, `fills`, `markets`, `money`, `orders`, `quantity`, `trading-rules`, `values`) | `src/canonical-orders/`, `src/money/`, `src/index.js` |
| Event Bus | Flat public event-bus module plus `src/helpers/` | `src/event-bus.js`; `src/helpers/delivery-capacity.js` |
| Indicators | Flat pure calculation/validation modules | `src/calculate-atr-series.js`; `src/calculate-natr-series.js`; `src/validate-candles.js` |
| Journal | `src/adapters/`, `src/helpers/`, journal/replay modules | `src/adapters/filesystem-journal-store.js`; `src/replay-journal-records.js` |
| Notifiers | `src/telegram/` transport/subscriber and public facade | `src/telegram/event-subscriber.js`; `src/architecture.test.js` |
| Utils | Domain-neutral helper modules, `src/ensure/`, logging and error helpers | `src/index.js`; `src/default-logger.js`; `src/system-custom-error.js` |

Harvester and Brokers have explicit layered structures. DB also separates domain/application/infrastructure. Entities, Event Bus, Indicators, Journal, Notifiers and Utils use package-specific layouts; apply their local ownership and purity rules rather than imposing unused layers. The [workspace dependency policy](#workspace-package-dependency-policy) governs package-to-package edges, while the [internal module matrix](#internal-module-dependency-direction) governs layers where they exist.

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

This table governs package-to-package dependencies; it does **not** prove internal source-file boundaries. The required CI command `pnpm run check:workspace-dependency-policy` parses this canonical allowlist and compares it with every workspace package manifest, including runtime, development, optional and peer dependencies. It enforces workspace protocol declarations and detects forbidden edges, missing/unknown policy rows, unresolved workspace targets, and dependency cycles. It runs within the existing required JavaScript Syntax quality aggregator; it adds no new required status context. This check validates the package-manifest graph only.

A separate AST-based source graph runs report-only in the same quality workflow across production JavaScript under `apps/`, `packages/`, and `scripts/`, including Harvester. It captures statically analyzable relative imports/re-exports, literal dynamic imports and literal `require` calls, resolves supported JavaScript paths, and reports strongly connected components without blocking on existing cycles. Computed imports and non-literal `require` calls are not included. Neither check proves internal layer-direction compliance; package-local architecture tests and the [Modularity Standard](./MODULARITY_STANDARD.md) remain authoritative for those boundaries. See [ADR-0001](../architecture/decisions/ADR-0001-clean-hexagonal-architecture.md) for module-level direction and review requirements.

## Internal module dependency direction

Apply this matrix only to packages that already use the relevant layers. It describes dependency direction; it does not require every package to create every folder.

| Module type | May depend on | Must not depend on / own |
| --- | --- | --- |
| Pure helper | Primitive/immutable input, value contracts, other pure helpers | I/O, mutable global state, runtime services, process/environment, filesystem, network, database, exchange clients, notification transports |
| Domain policy/value | Domain entities, value objects, domain contracts, pure helpers and domain-neutral shared utilities | Concrete infrastructure adapters, external SDKs, database clients, notification transports, filesystem/network/process/environment |
| Application/use case | Domain policies/contracts, application-owned ports, public shared package contracts | Concrete infrastructure implementations, provider SDKs, database drivers, direct environment/process access |
| Infrastructure adapter/repository | Contracts/ports it implements, domain/application contracts, public package APIs, external SDKs and database drivers | Owning strategy/business policy or reaching into another package's private source tree |
| Composition/bootstrap/runtime | Application use cases, concrete infrastructure adapters, validated configuration | Becoming the owner of domain policy or duplicating domain decisions |
| Public package facade | Stable public contracts and supported implementations/adapters required by the package API | Business orchestration or private cross-package source imports |

A package may use a simpler structure when it has no meaningful application/infrastructure split. Do not create layers or wrappers solely to match this table. The existing [Brokers architecture guide](../../packages/brokers/ARCHITECTURE.md), [Harvester architecture guide](../../apps/harvester/docs/architecture.md), and [ADR-0001](../architecture/decisions/ADR-0001-clean-hexagonal-architecture.md) provide package-specific context.

## Architecture exceptions and approval

- An edge absent from the workspace allowlist or a violation of the internal direction matrix is not an implicit exception because it already exists in legacy code.
- Propose a new edge or exception through the [cross-domain request process](./CROSS_DOMAIN_REQUESTS.md). The owning domain and affected consumer owner must agree on the capability, reason, scope, compatibility/safety impact and migration plan before implementation.
- Record the accepted exception in the issue and owning roadmap, including its owner and removal/follow-up condition. Update this standard and the package manifest in the same PR when the exception changes the allowed dependency policy.
- Temporary workarounds must be narrow, explicitly coordinated, time-bounded and linked to a removal task. Do not create private copies or speculative abstractions to bypass ownership.
- The user reviews and merges the implementation PR after required checks pass; agent or domain-owner agreement is not merge authorization.

## Static enforcement and review checklist

The blocking workspace package policy checks every workspace manifest against this allowlist and validates statically extractable production imports of `@coinzilla/*` packages. Consumers may import a package root or a subpath declared by that package's `exports` map; unknown workspace package names and unexported subpaths fail the existing required JavaScript Syntax workflow. This check reuses the repository's ESLint AST import extractor and production-module discovery. It covers literal ESM imports/re-exports, literal dynamic imports, and literal CommonJS `require` specifiers in production `.js` files under `apps/`, `packages/`, and `scripts/`. It does not resolve computed/non-literal imports or enforce internal layer direction. The separate relative-import graph/cycle report remains report-only. Brokers and Notifiers retain their package-specific internal boundary tests; these are not a universal layer policy.

For every dependency or module-boundary change, review:

1. Identify the source and target owners; confirm the workspace edge is allowed or the exception is accepted and recorded.
2. Use the target package's public entry point or an application-owned port; do not deep-import another package's private source.
3. Inspect production imports separately from test/fixture imports.
4. Verify the dependency direction and confirm the workspace graph remains acyclic.
5. Add behavior/contract tests at the owning boundary and consumer tests where observable behavior changes.
6. Update the owning roadmap, this policy if an allowed edge changes, and all affected documentation in the same PR.
7. Verify required checks on the exact PR head and leave the PR open for user review and merge.

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
