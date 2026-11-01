# Event Bus Agent Instructions

Before making any change anywhere in this package:

1. Read ROADMAP.md completely and follow the repository-level AGENTS.md and ENGINEERING_STANDARDS.md.
2. Inspect the complete implementation, package metadata/scripts, existing tests, and all relevant consumers before changing behavior.
3. Treat comprehensive deterministic testing as mandatory. Every behavior change needs tests; every bug fix needs a regression test that reproduces the defect. Cover boundary values, malformed inputs, error/rejection paths, re-entrancy, concurrency, lifecycle, and cleanup where relevant.
4. Run pnpm --filter @coinzilla/event-bus test and pnpm --filter @coinzilla/event-bus test:coverage. Review uncovered lines and branches; do not rely on the percentage alone. Run relevant repository checks too.
5. Never claim a test or check passed unless it was actually executed and passed. Report commands, outcomes, and any checks not run.
6. Design for failure and diagnosis: preserve error context, use structured logs at meaningful boundaries, test error-reporting behavior, avoid noisy duplicate logs, and never log secrets or sensitive payloads.
7. Keep modules responsibility-focused. src/index.js is the public export boundary; event-bus.js coordinates the feature; focused internal behavior belongs in cohesive modules under appropriately named folders such as helpers/, constants/, or errors/. Reserve utils/ for generic functionality reused by multiple modules. Do not create catch-all files or fragment code without a clear benefit.
8. Follow the package's functional-core/imperative-shell guidance: use pure functions for deterministic validation, transformations, and policy decisions wherever practical; isolate I/O, time, randomness, scheduling, logging, and mutable lifecycle state.
9. Update ROADMAP.md when implementation status, guarantees, test coverage, or architectural decisions change.

Do not create GitHub issues as a substitute for tracking this package's work. Keep the roadmap and focused pull requests as the source of truth.


## Repository-wide modularity rule (mandatory)

The pure-function extraction and file-size requirements in the root `ENGINEERING_STANDARDS.md` and `AGENTS.md` apply to every change in this package. They are mandatory, not optional style suggestions.

- **Extract meaningful, non-trivial pure functions into focused separate modules, even when there is only one caller.** A function is a pure extraction candidate when its result depends only on explicit inputs and it does not read or mutate instance state, shared mutable state, globals, or external systems.
- Keep validation, parsing, serialization, formatting, normalization, mapping, calculations, predicates, and business-rule decisions outside large classes/services whenever they can be expressed as pure functions. Classes/services should own state and coordinate side effects, not become containers for unrelated implementation details.
- Group related pure functions by domain and responsibility. Use package/feature-local helpers for internal logic; use shared `utils` only for genuinely generic behavior. Do not create a miscellaneous catch-all module.
- Keep pure logic independently testable. Add focused unit tests where they add confidence, and test orchestration through observable behavior. Keep I/O, network, filesystem, database, clock, randomness, logging, and process-environment access at explicit boundaries.
- Avoid god files. Review files approaching 300 lines for cohesive extraction opportunities. Files exceeding 500 lines require a refactoring plan or a concrete technical justification in the PR. These are review triggers, not arbitrary limits.
- Do not fragment trivial expressions, tiny context-dependent callbacks, or tightly coupled logic merely to reduce line count. The goal is cohesion, low coupling, readability, and independent testability—not the maximum number of files.

When modifying an existing large file, improve its structure as part of the task when the extraction is relevant and safe. Do not expand an already fragmented architecture or undertake unrelated mass refactoring.
