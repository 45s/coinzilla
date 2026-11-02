# Notifiers agent instructions

This package owns notification transports, event-to-message formatting, and notification event-bus adapters. Read the repository-root AGENTS.md, ENGINEERING_STANDARDS.md, and mandatory AI_AGENT_WORKFLOW.md before any task, then read this file, README.md, and ROADMAP.md.

## Ownership

Owned paths: packages/notifiers/**.

Keep notification delivery independent from trading strategy, broker execution, entity modeling, and event-bus internals. Consumers integrate this package from their own application domain; do not modify consumer code or another package's roadmap as part of a notifiers-only task. Coordinate cross-domain work through the repository workflow.

## Source layout

- src/index.js is the stable package entry point. Keep it to intentional public re-exports.
- Each transport owns a dedicated folder: src/telegram/, src/email/, src/discord/, etc.
- A transport folder owns its client/adapter, provider-specific formatting, event integration (if needed), local exports, and tests.
- Do not put provider-specific logic directly under src/.
- Do not create empty folders or placeholder implementations for future transports. Add a provider folder when implementation work begins.
- Do not create a generic cross-provider interface until multiple implemented transports demonstrate a concrete shared contract.
- Preserve existing public exports when restructuring unless a breaking API change is explicitly planned and all consumers are migrated.

## Engineering rules

- Prefer Node.js built-ins and injected side-effect boundaries; do not add dependencies without a documented concrete need.
- Validate configuration and external API responses at boundaries, including malformed success responses.
- Never log or include bot tokens, credentials, raw exchange payloads, stack traces, or unrelated event fields in outbound notifications or transport error messages.
- Use explicit event allowlists. Do not subscribe to every event by default.
- Normalize and bound untrusted dynamic message fields; validate provider-specific payload limits before network I/O.
- Notification failures must not alter trading state or interrupt event publication. Preserve an observable error path through the subscriber logger or event-bus error reporter.
- Bound network requests and pending work. Document timeout, ordering, overload, retry, cleanup, and durability guarantees accurately.
- Cleanup must be idempotent and attempt every resource release even when one cleanup operation fails.
- Tests must be deterministic, credential-free, network-free, and cover success, invalid input, boundary conditions, malformed API responses, transport failures, queue limits, concurrency, cleanup, and error reporting.
- Do not claim coverage or quality checks passed unless they were actually executed.
- Update ROADMAP.md and README.md whenever public behavior, package structure, or operational guarantees change.

## Required checks

    pnpm --filter @coinzilla/notifiers test
    pnpm --filter @coinzilla/notifiers test:coverage
    pnpm test
    pnpm run check:syntax
    pnpm run quality

Run focused package checks first, then applicable workspace checks. Report any command that could not be run and why.


## Repository-wide modularity rule (mandatory)

The pure-function extraction and file-size requirements in the root `ENGINEERING_STANDARDS.md` and `AGENTS.md` apply to every change in this package. They are mandatory, not optional style suggestions.

- **Extract meaningful, non-trivial pure functions into focused separate modules, even when there is only one caller.** A function is a pure extraction candidate when its result depends only on explicit inputs and it does not read or mutate instance state, shared mutable state, globals, or external systems.
- Keep validation, parsing, serialization, formatting, normalization, mapping, calculations, predicates, and business-rule decisions outside large classes/services whenever they can be expressed as pure functions. Classes/services should own state and coordinate side effects, not become containers for unrelated implementation details.
- Group related pure functions by domain and responsibility. Use package/feature-local helpers for internal logic; use shared `utils` only for genuinely generic behavior. Do not create a miscellaneous catch-all module.
- Keep pure logic independently testable. Add focused unit tests where they add confidence, and test orchestration through observable behavior. Keep I/O, network, filesystem, database, clock, randomness, logging, and process-environment access at explicit boundaries.
- Avoid god files. Review files approaching 300 lines for cohesive extraction opportunities. Files exceeding 500 lines require a refactoring plan or a concrete technical justification in the PR. These are review triggers, not arbitrary limits.
- Do not fragment trivial expressions, tiny context-dependent callbacks, or tightly coupled logic merely to reduce line count. The goal is cohesion, low coupling, readability, and independent testability—not the maximum number of files.

When modifying an existing large file, improve its structure as part of the task when the extraction is relevant and safe. Do not expand an already fragmented architecture or undertake unrelated mass refactoring.
