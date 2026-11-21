import assert from "node:assert/strict"
import test from "node:test"
import { formatCliIdentity, resolveCliIdentity } from "./cli-identity.js"

test("CLI identity prints package version, full source commit, worktree state, and Node version", () => {
  const identity = formatCliIdentity({
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    commitSha: "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1",
    worktree: "clean",
    nodeVersion: "v26.13.0",
  })

  assert.equal(
    identity,
    "bitunix:healthcheck v1.0.0 | commit d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1 | worktree clean | Node v26.13.0",
  )
})

test("CLI identity reports unavailable Git metadata explicitly", () => {
  const identity = formatCliIdentity({
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
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    commitSha: "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1",
    worktree: "dirty",
    nodeVersion: "v26.13.0",
  })

  assert.match(identity, /worktree dirty/)
})

test("CLI identity resolves the exact Git HEAD and worktree state without a shell", () => {
  const calls = []
  const identity = resolveCliIdentity({
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    repositoryRoot: "/repo",
    nodeVersion: "v26.13.0",
    runGit: (...gitCall) => {
      const [command, args, options] = gitCall
      calls.push({
        command,
        args,
        options,
      })
      return args[0] === "rev-parse"
        ? "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1\n"
        : ""
    },
  })

  assert.match(identity, /commit d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1/)
  assert.match(identity, /worktree clean/)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].command, "git")
  assert.deepEqual(calls[0].args, ["rev-parse", "HEAD"])
  assert.equal(calls[0].options.cwd, "/repo")
})

test("CLI identity marks a failed Git lookup as unknown instead of inventing a version", () => {
  const identity = resolveCliIdentity({
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    repositoryRoot: "/not-a-repository",
    nodeVersion: "v26.13.0",
    runGit: () => {
      throw new Error("git unavailable")
    },
  })

  assert.match(identity, /commit unknown/)
  assert.match(identity, /worktree unknown/)
})

test("CLI identity marks modified or untracked files as a dirty worktree", () => {
  const identity = resolveCliIdentity({
    scriptName: "bitunix:healthcheck",
    packageVersion: "1.0.0",
    repositoryRoot: "/repo",
    nodeVersion: "v26.13.0",
    runGit: (_command, args) => args[0] === "rev-parse" ? "abc123\n" : "?? new-file.js\n",
  })

  assert.match(identity, /worktree dirty/)
})
