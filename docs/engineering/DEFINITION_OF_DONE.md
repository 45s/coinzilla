# Definition of Done

A task is complete only when all applicable items below are satisfied.

- [ ] The requested behavior or defect is addressed with the smallest cohesive change.
- [ ] The owning domain and roadmap item are identified.
- [ ] Every changed behavior has meaningful automated tests.
- [ ] Bug fixes include a regression test whenever practical.
- [ ] Pure decision logic is separated from I/O where practical and tested deterministically.
- [ ] Boundary, invalid-input, failure, cleanup, and relevant concurrency cases are covered.
- [ ] No tests, assertions, CI gates, or security checks were weakened to obtain a pass.
- [ ] The affected package tests and coverage checks pass.
- [ ] Applicable workspace tests, syntax checks, coverage and dependency/security checks pass.
- [ ] The final diff contains no secrets, generated noise, unrelated edits, or unexplained TODOs.
- [ ] Public APIs, consumer impact, configuration and documentation are updated.
- [ ] The owning domain roadmap is updated only after the task is merged into `develop`.
- [ ] The task PR targets `develop`, contains the latest target commit, and all required checks pass on its exact final head SHA.
- [ ] The task PR is merged into `develop`; otherwise it is not complete.
- [ ] The completion report states exact commands, results, final SHA, and remaining uncertainty.

A release milestone additionally requires a clean, reviewed `develop` → `main` diff, full release validation, migration/compatibility notes, known risks, and the user's approval.
