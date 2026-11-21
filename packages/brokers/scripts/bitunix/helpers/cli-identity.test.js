import assert from "node:assert/strict"
import test from "node:test"
import { formatCliIdentity } from "./cli-identity.js"

test("CLI identity prints package version, full source commit, worktree state, and Node version", () => {
  const identity = formatCliIdentity({
    packageName: "@coinzilla/brokers",
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    commitSha: "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1",
    worktree: "clean",
    nodeVersion: "v26.13.0",
  })

  assert.equal(
    identity,
    "@coinzilla/brokers bitunix:healthcheck v1.0.0 | commit d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1 | worktree clean | Node v26.13.0",
  )
})

test("CLI identity reports unavailable Git metadata explicitly", () => {
  const identity = formatCliIdentity({
    packageName: "@coinzilla/brokers",
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    commitSha: null,
    worktree: "unknown",
    nodeVersion: "v26.13.0",
  })

  assert.match(identity, /commit unknown/)
  assert.match(identity, /worktree unknown/)
})

test("CLI identity marks a dirty worktree", () => {
  const identity = formatCliIdentity({
    packageName: "@coinzilla/brokers",
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    commitSha: "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1",
    worktree: "dirty",
    nodeVersion: "v26.13.0",
  })

  assert.match(identity, /worktree dirty/)
})
