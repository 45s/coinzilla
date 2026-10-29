# Release and rollback checklist

This repository does not define an automated deployment workflow. Use the deployment process configured for the target environment; do not assume that merging a pull request deploys the application.

## Before release

- [ ] Confirm the intended commit is on `main` and the working tree is clean.
- [ ] Review the pull request diff and verify all required CI checks completed successfully. Do not treat pending or skipped checks as passing.
- [ ] Run the workspace unit tests and coverage workflow against the release commit.
- [ ] Review the production dependency audit results and resolve or explicitly assess high/critical findings before release.
- [ ] Run broker integration tests only in an environment intended for exchange connectivity, using test credentials where supported. Never put live credentials in source control or logs.
- [ ] Confirm required environment variables and exchange endpoints for the target environment without copying secrets into tickets, commits, or release notes.
- [ ] Record the commit SHA and the known-good release that can be restored.

## Release

- [ ] Follow the environment's established deployment procedure.
- [ ] Verify startup and health signals after deployment.
- [ ] Check application logs for configuration, exchange connectivity, and unexpected error spikes.
- [ ] Confirm critical broker operations in an approved test or staging environment before relying on the release in production.

## Rollback

- [ ] If the release causes a regression, stop further rollout using the environment's deployment controls.
- [ ] Restore the last known-good release using the deployment system's supported rollback mechanism.
- [ ] If rollback requires a code change, prefer a focused revert of the offending commit over editing release artifacts manually.
- [ ] Re-run the relevant health checks and inspect logs to confirm the previous version is operating normally.
- [ ] Preserve the failed release's commit SHA, relevant logs, and reproduction steps for follow-up.
- [ ] Open a regression-fix pull request with a test where practical; do not re-release until the failure is understood and the relevant checks pass.

## Safety notes

- Do not commit secrets, production account data, or private logs.
- Do not bypass failing checks just to complete a release.
- This checklist does not replace environment-specific deployment, backup, incident-response, or exchange-risk procedures. Document those separately where they apply.
