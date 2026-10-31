# Notifiers agent instructions

This package owns notification transports, event-to-message formatting, and event-bus notification adapters. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and mandatory `AI_AGENT_WORKFLOW.md` before any task, then read this file and `ROADMAP.md`.

## Ownership

Owned paths: `packages/notifiers/**`.

Keep notification delivery independent from trading strategy, broker execution, entity modeling, and event-bus internals. Consumers integrate this package from their own application domain; do not modify consumer code or another package's roadmap as part of a notifiers-only task. Coordinate cross-domain work through the repository workflow.

## Engineering rules

- Keep the public `src/index.js` limited to intentional exports.
- Prefer Node.js built-ins and injected side-effect boundaries; do not add dependencies without a documented concrete need.
- Validate configuration and external API responses at boundaries.
- Never log or include bot tokens, credentials, raw exchange payloads, stack traces, or unrelated event fields in outbound notifications.
- Use explicit event allowlists. Do not subscribe to every event by default.
- Notification failures must not alter trading state or interrupt event publication; return rejected handler promises so the event bus can report them through its normal error path.
- Bound network requests with timeouts and document retry, ordering, overload, and durability guarantees accurately.
- Tests must be deterministic, credential-free, network-free, and cover success, invalid input, boundary conditions, transport/API failures, serialization, cleanup, and error reporting.
- Do not claim coverage or quality checks passed unless they were actually executed.
- Update `ROADMAP.md` and `README.md` whenever public behavior or operational guarantees change.

## Required checks

```sh
pnpm --filter @coinzilla/notifiers test
pnpm --filter @coinzilla/notifiers test:coverage
pnpm test
pnpm run check:syntax
pnpm run quality
```

Run the focused package checks first, then applicable workspace checks. Report any command that could not be run and why.
