# Modularity standard

This document is the canonical decision standard for module boundaries. Apply it to new code and to code materially changed by a PR.

## Default

Prefer cohesive modules, explicit side-effect boundaries, and deterministic logic that can be tested from explicit inputs. Classes and services should own state and coordinate effects; pure functions should express calculations, validation, normalization, mapping, and policy decisions when that separation makes the behavior easier to understand and verify.

## When a pure function should be extracted

Extract a function into a focused module when one or more of these are true:

- It expresses a meaningful business/domain rule or calculation with a distinct name and contract.
- It can be tested independently without constructing a service or mocking infrastructure.
- It separates deterministic decision-making from I/O, mutable state, clocks, randomness, or orchestration.
- It has multiple consumers or is likely to be reused within the owning domain.
- Its extraction materially improves cohesion, readability, or change isolation.

A single caller is not a reason to keep meaningful logic embedded in a large service. Conversely, purity alone is not a reason to extract every expression.

Keep logic local when it is trivial, tightly coupled to a single callback/context, or clearer beside the orchestration that uses it. Do not create one-function files solely to satisfy a rule or reduce a line count.

## Feature-module layout

Organize each feature around its domain boundary. Keep the feature's primary runtime components and public entry point directly inside the feature directory; use a local `helpers/` directory only for cohesive, pure supporting functions.

Example:

```text
src/
  telegram/
    event-subscriber.js
    notifier.js
    index.js
    helpers/
      validate-telegram-inputs.js
      validate-telegram-api-response.js
      sanitize-error-message.js
```

Rules:

- Keep primary services, clients, adapters, event subscribers, handlers, and orchestration at the feature root. Do not bury primary components in `helpers/` or create extra directory layers without a demonstrated domain boundary.
- Reserve `helpers/` for cohesive pure supporting functions: explicit inputs, deterministic outputs, validation/normalization, calculations, predicates, mapping and serialization. Helpers may return new objects, arrays, or errors, but must not mutate inputs, external/shared/module state, or own mutable lifecycle state.
- Prohibited helper responsibilities include domain lifecycle logic/orchestration, filesystem/database/network/event-bus/broker I/O, environment/clock/random access, resource start/stop/subscribe/management, and stateful classes/services/repositories. Dependencies must not hide side effects; effectful dependencies are not permitted.
- Every production helper module must have a directly associated colocated `.test.js` unit test. `.spec.js` is not the workspace convention; introduce it only if a package has an explicit existing local convention. Tests should cover applicable normal, edge, invalid, boundary, deterministic, immutability, and output cases. Pure helper tests should not need infrastructure mocks.
- The automated guard is `pnpm run check:helper-policy`, which runs in the required JavaScript quality workflow. It detects common violations and missing test files; static analysis is a guardrail, not proof of purity. Review must still inspect indirect dependencies and behavior.
- Use concise, action-oriented filenames that communicate the helper's purpose. The parent feature directory already supplies domain context, so do not repeat it unnecessarily in every filename.
- Do not add redundant suffixes such as `-helper` or `-utils`, or vague catch-all files such as `utils.js`, `common.js`, or `helpers.js`.
- Do not mechanically extract every pure expression. Keep trivial or tightly coupled logic local when extraction would increase indirection without improving cohesion, reuse, or independent testability.
- Keep feature-local tests close to the modules they exercise; tests are not production helpers.
- Keep `index.js` as a thin public export facade. Export only supported feature contracts; keep internal helpers private.

This is a repository-wide default, not a rigid naming template. Choose precise names that describe actual behavior; the example filenames are illustrative rather than mandatory.

## Directory responsibility and placement

Choose directories from real domain, layer, feature, or capability boundaries. There is no mandatory repository-wide folder template: Harvester, Brokers and DB use layered structures where their boundaries are meaningful; Entities groups by domain concept; Indicators keeps focused calculation modules flat; Event Bus, Journal, Notifiers and Utils use smaller package-specific layouts. Follow the owning package's `AGENTS.md` and the [domain ownership map](DOMAIN_OWNERSHIP.md), not a neighboring package's tree.

Placement rules:

- Start with the simplest cohesive feature folder. Keep its primary runtime components, use cases, handlers, clients, adapters and orchestration at the feature root unless a real boundary or a coherent group of related modules justifies a subdirectory.
- Use `domain/` for provider-independent domain models, invariants, policies and domain services; `application/` for use-case orchestration and required ports; `infrastructure/` for concrete I/O, persistence, transports and external-provider integration. Add only the layers the feature actually needs.
- Use `ports/` for dependency contracts and `adapters/` for explicit translation/composition at a boundary. Keep provider-specific adapters under the provider/feature they implement; do not create a repository-wide adapter bucket.
- Use `helpers/` only for the pure supporting functions defined above. Use `services/` only when a cohesive domain/application service boundary exists; it is not a generic home for unrelated orchestration.
- Use `errors/` or `constants/` when several related definitions form a coherent group. A narrowly scoped `constants.js` may live beside its owning feature; prefer a responsibility-specific filename when the constants span multiple concerns or the parent folder does not make their scope clear.
- Use `utils/` only for genuinely generic utilities reused within a clearly bounded scope. Do not put primary clients, transports, protocol implementations, lifecycle owners or unrelated helpers in a catch-all `utils/` directory. Cross-domain reusable behavior belongs in `packages/utils` only after following the [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md).
- Keep direct unit tests beside the module they exercise. Use a package's `test/` tree for cross-module integration, architecture, contract or lifecycle tests that do not belong to one source file. Do not introduce a second test-folder convention just for uniformity.
- Keep `index.js` thin: use it for a supported public export facade or a meaningful feature composition boundary, not as a pass-through wrapper around one file.
- Do not create empty directories, speculative future layers, one-file folder hierarchies, or generic `common/` and `misc/` buckets. Do not move files merely to make two packages look alike.

Existing broad legacy directories are not templates. Do not expand them; move responsibilities only through a focused, owner-reviewed refactor with import tracing, colocated tests, package documentation and roadmap updates. The S-7 audit records known exceptions and deferred cleanup rather than forcing a repository-wide tree migration.

## Naming standard

Names must communicate behavior and responsibility without requiring implementation inspection. Naming expectations depend on architectural context:

- **Helper files and helper functions:** use fully self-descriptive names that identify the specific operation, transformation, calculation, validation, extraction, parsing, serialization, or predicate. Include meaningful constraints or domain qualifiers when they distinguish the contract (for example, net of commissions, available inventory, exchange protocol, or lifecycle scope).
- **Core/domain functions:** describe the business behavior explicitly. Context from the containing module may make names shorter; do not redundantly repeat the module or domain name in every function.
- **Orchestration functions:** name the coordinated action or lifecycle transition, including important trigger/target context when ambiguity exists. Avoid generic orchestration verbs without an explicit object and outcome.
- **Modules, files, services and classes:** use concise names that communicate the responsibility or domain boundary. The directory and parent module supply context; do not encode the entire path or feature name into every identifier.
- **Variables and parameters:** name the represented value, state, or role. Avoid generic names when a more precise name improves understanding.

Prefer established behavior-oriented prefixes where applicable: `calculate-`, `validate-`, `normalize-`, `convert-`, `extract-`, `serialize-`, `parse-`, `is-`, `has-`, `can-`, and `should-`. These are examples, not a rigid vocabulary.

Avoid vague names such as `process`, `handle`, `execute`, `update`, `check`, `get`, `prepare`, `data`, `helper`, `utils`, `common`, `normalize`, `validate`, or `calculate` when they do not communicate the specific behavior. Such names may be acceptable only when their meaning is genuinely unambiguous from the local contract and context; do not use that exception to hide unclear responsibilities.

Examples:

| Context | Avoid | Prefer |
| --- | --- | --- |
| Helper | `normalize.js` | `normalize-binance-symbol.js` |
| Helper | `check-status.js` | `is-order-terminal.js` |
| Helper | `process-order.js` | `calculate-order-execution-quantity.js` |
| Domain core | `process()` | `startCycle()` inside `recovery-cycle.js` |
| Domain core | `update()` | `reconcileFilledBuyWithRecoverySell()` when that is the actual operation |
| Orchestration | `handle()` | `cancelExistingSellAndRecalculateReplacement()` |
| Service/module | `recovery-seller-strategy-recovery-cycle-orchestration-service.js` | `recovery-cycle-orchestrator.js` |

Before adding a function or module, search for an existing implementation of the same behavior. Do not create duplicate behavior under a different name. When creating, refactoring, or moving code, review the filename, exported/public identifiers, internal functions and important variables together. If a name is intentionally short because the containing module supplies context, verify that the function's behavior remains clear from that module and its contract.

AI agents must explicitly perform this naming review during task preflight and completion. The heuristic scan is available as `pnpm run check:helper-names`; it flags context-free helper filenames and exported function declarations across the existing helper tree for baseline auditing. The PR CI gate runs `pnpm run check:helper-names:changed -- <base-sha>` and blocks vague filenames/exported names in changed helper files. This avoids unrelated legacy violations blocking a PR while enforcing the standard on touched helper code. The scanner cannot prove semantic clarity; reviewers must still inspect names and context. Any exception must be justified in the task/PR.

## File, identifier and boundary-artifact naming

- Use lower kebab-case word segments for JavaScript filenames. A dot-separated role/scope qualifier is acceptable when it clarifies a module or test boundary (for example, `broker.port.js` or `rpc-client.lifecycle.test.js`). A direct unit test mirrors its source basename and ends in `.test.js`; use descriptive test names for behavior and boundary conditions, not for the implementation detail being asserted.
- JavaScript functions, variables and object properties use `camelCase`; classes use `PascalCase`. Use `UPPER_SNAKE_CASE` for stable enum-like, configuration and protocol constants; do not capitalize every local `const` binding.
- Boolean predicates should read as a question, normally with `is`, `has`, `can` or `should`. Functions should name an action and its subject/outcome. Classes should name the concept or stateful role they own.
- Keep established acronyms such as API, HTTP, ID, RPC, URL and DTO when they are part of the domain vocabulary. Do not invent shortened forms such as `msg`, `cfg` or `acc` when the full word is clearer. Preserve wire-protocol field names only at the protocol boundary.
- Use artifact words precisely:
  - An **event** is a fact that happened; a **command** is an intent/request to do something. Do not name an intent as an event or an observed fact as a command.
  - A **use case** names an action in verb-object form. An operator/transport `commands.js` module may parse user commands, but that does not make those commands domain events.
  - A **DTO** is a data-only shape crossing an application, persistence or integration boundary; do not suffix domain entities/value objects with DTO.
  - **Request/params** and **response** identify protocol-boundary input/output; include the provider or operation when the local context is insufficient.
  - **Record** identifies a persisted representation, **snapshot** a point-in-time capture, **result** an operation outcome, and **error** a failure contract/type. Typed error classes follow the [Structured Error Handling Standard](structured-error-handling.md).
- Repository examples demonstrate the distinctions: `record-order-submission-intent.js` versus `record-order-submission-outcome.js`; `lifecycle-event-dtos.js`; `order-request-params.js`; `order-history-record.js`; `account-snapshot.js`; and `broker-result.js`. Use these as examples of clear vocabulary, not mandatory suffixes for every module.

## Module and file size review

- Organize by responsibility and domain, not a rigid folder template.
- Keep public entry points thin and avoid circular dependencies.
- Use package-local helpers for cohesive internal behavior; use packages/utils only for domain-neutral contracts.
- Review files approaching 300 lines for cohesion and extraction opportunities.
- Files exceeding 500 lines require a concrete technical justification or a scoped refactoring plan in the PR.
- These are review triggers, not automatic extraction targets.

## Review questions

1. Does each module have one cohesive reason to change?
2. Are domain decisions independent of infrastructure and exchange protocols?
3. Are side effects explicit and dependencies injected where useful?
4. Does an extraction improve independent testing or comprehension?
5. Is a shared helper truly domain-neutral, and has packages/utils been searched first?
6. Does the resulting structure reduce coupling rather than merely increase file count?

The repository root AGENTS.md and ENGINEERING_STANDARDS.md link to this standard. Domain-specific constraints may be stricter where required for financial correctness or protocol isolation, but should not force mechanical fragmentation.
