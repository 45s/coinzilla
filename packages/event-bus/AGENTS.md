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
