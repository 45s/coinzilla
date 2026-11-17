# Notifiers agent instructions

This package owns notification transports, event-to-message formatting, and notification event-bus adapters. Read the repository-root AGENTS.md, ENGINEERING_STANDARDS.md, and mandatory AI_AGENT_WORKFLOW.md before any task, then read this file, README.md, and ROADMAP.md.

## Ownership

Owned paths: packages/notifiers/**.

Keep notification delivery independent from trading strategy, broker execution, entity modeling, and event-bus internals. Consumers integrate this package from their own application domain; do not modify consumer code or another package's roadmap as part of a notifiers-only task. Coordinate cross-domain work through the repository workflow.

## Source layout

- src/index.js is the stable package entry point. Keep it to intentional public re-exports.
- Each transport owns a dedicated feature folder: src/telegram/, src/email/, src/discord/, etc. Follow the repository-wide [feature-module layout rule](../../docs/engineering/MODULARITY_STANDARD.md#feature-module-layout): primary components stay at the transport root and `helpers/` is reserved for pure supporting functions.
- A transport folder owns its client/adapter, provider-specific formatting, event integration (if needed), local exports, and tests.
- Do not put provider-specific logic directly under src/.
- Do not create empty folders or placeholder implementations for future transports. Add a provider folder when implementation work begins.
- Do not create a generic cross-provider interface until multiple implemented transports demonstrate a concrete shared contract.
- Preserve existing public exports when restructuring unless a breaking API change is explicitly planned and all consumers are migrated.

## Domain boundaries

Use lightweight DDD boundaries without introducing ceremonial aggregates, repositories, or folders that do not represent real responsibilities.

- **Notification policy:** the provider-local formatter and validation functions own deterministic event selection, field allowlisting, normalization, and message rules. Keep these functions independent of network I/O, application configuration, and mutable infrastructure.
- **Application integration:** the event subscriber coordinates the injected event-bus and notifier ports. It owns subscription lifecycle, admission limits, ordering, failure reporting, and delivery diagnostics; it must not construct either dependency.
- **Infrastructure:** the Telegram notifier owns Telegram HTTP requests, credential handling, provider response validation, and timeout behavior. Inject fetch so network effects remain replaceable in tests.
- **Composition:** consuming applications own environment/configuration loading and instantiate the EventBus and Telegram adapter. The notifier package must not import application, trading, broker, entity, or concrete event-bus implementations.
- **Public API:** src/index.js and the provider-local index.js are intentional export facades, not implementation modules.

Keep these responsibilities inside the owning transport folder as specified above. Do not add a cross-provider contract until a second real transport demonstrates a stable shared need.

## Engineering rules

- Prefer Node.js built-ins and injected side-effect boundaries; do not add dependencies without a documented concrete need.
- Validate configuration and external API responses at boundaries, including malformed success responses.
- Never log or include bot tokens, credentials, raw exchange payloads, stack traces, or unrelated event fields in outbound notifications or transport error messages.
- The formatter allowlists field names but cannot determine whether free-form `message`/`reason` text embeds a secret. Consuming applications must sanitize and bound those strings before publishing; never forward raw `Error.message`, stack traces, credentials, or raw payloads.
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
