import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { publishHealthReport } from "./publish-health-report.js"
import { createGitEnvironment } from "../helpers/create-git-environment.js"

const execFileAsync = promisify(execFile)
const fixedTimestamp = Date.parse("2026-11-19T08:30:00.000Z")
const apiKey = "private-test-api-key"
const apiSecret = "private-test-api-secret"

async function executeGit({ cwd, args }) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  })
  return stdout.trim()
}

function createFakeGit({ repositoryRoot, failPush = false } = {}) {
  const calls = []
  const runGit = async ({ args }) => {
    calls.push(args)
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return repositoryRoot
    }
    if (args[0] === "status") {
      return ""
    }
    if (args[0] === "branch") {
      return "develop"
    }
    if (args[0] === "remote") {
      return "https://github.com/45s/coinzilla.git"
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return "report-commit-sha"
    }
    if (args[0] === "push" && failPush) {
      throw new Error(`simulated push failure ${apiSecret}`)
    }
    return ""
  }
  return {
    calls,
    runGit,
  }
}

const requiredOperations = [
  "diagnostic safety confirmation",
  "diagnostic configuration",
  "REST private account balances",
  "WebSocket connection",
  "ping",
  "user.account",
  "user.info",
]

function createDiagnosticReport({ failed = 0, omitOperation } = {}) {
  const results = requiredOperations
    .filter((operation) => operation !== omitOperation)
    .map((operation) => {
      const result = {
        operation,
        status: failed > 0 && operation === "user.account" ? "failed" : "passed",
      }
      if (operation === "user.account") {
        result.request = {
          apiKey,
          sign: "private-signature",
        }
        result.response = {
          uid: "private-uid",
          balance: "123.456",
        }
        if (failed > 0) {
          result.error = {
            name: "BitunixApiError",
            message: "private-uid balance 123.456",
            exchangeCode: "ACCOUNT_READ_FAILED",
            cause: {
              name: "Error",
              message: "private-uid nested balance 123.456",
            },
          }
        }
      }
      return result
    })
  return {
    schemaVersion: 1,
    startedAt: "2026-11-19T08:29:00.000Z",
    finishedAt: "2026-11-19T08:30:00.000Z",
    runtime: {
      node: "v24.0.0",
    },
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === "passed").length,
      failed,
      skipped: 0,
    },
    results,
    events: [{
      type: "transport_error",
      error: {
        name: "Error",
        message: "private-uid balance 123.456",
      },
    }],
  }
}

function assertFailedHealthReport({ result, calls }) {
  assert.equal(result.exitCode, 1, "an API diagnostic failure must make the command fail")
  assert.equal(result.report.summary.failed, 1, "the pushed report must preserve the failed Bitunix operation")
  assert.equal(result.healthCheck.healthy, false, "a failed required Bitunix probe must fail the overall health check")
  const publicError = result.report.results.find((item) => item.operation === "user.account").error
  assert.equal(publicError.message, undefined, "the public allowlist must omit free-form private error text")
  assert.equal(publicError.cause, undefined, "the public allowlist must omit nested error details")
  assert.equal(publicError.exchangeCode, "ACCOUNT_READ_FAILED", "the public allowlist must retain structured exchange error codes")
  assert.equal(JSON.stringify(result.report).includes("private-uid"), false, "public reports must not leak account identifiers")
  assert.equal(JSON.stringify(result.report).includes("123.456"), false, "public reports must not leak balances")
  assert.equal(calls.some((args) => args[0] === "push"), true, "a sanitized failure report must still be pushed")
  assert.deepEqual(calls.at(-1), ["switch", "develop"], "failed API diagnostics must return the checkout to develop")
}

async function createRepositoryDirectory() {
  return mkdtemp(join(tmpdir(), "bitunix-health-publisher-"))
}

function assertReportBranchPublished({ result, calls }) {
  assert.equal(result.branch, "diagnostics/bitunix-health-20261119T083000000Z", "the report branch must have a unique UTC timestamped name")
  assert.equal(result.commitSha, "report-commit-sha", "the pushed report commit SHA must be returned for inspection")
  assert.equal(result.exitCode, 0, "a fully successful read-only health check must return a successful exit code")
  assert.equal(result.healthCheck.healthy, true, "all required authenticated account and WebSocket probes must pass")
  assert.equal(calls.some((args) => args[0] === "fetch" && args[1] === "origin" && args[2] === "refs/heads/develop:refs/remotes/origin/develop"), true, "the report branch must start from the latest fetched origin/develop")
  assert.equal(calls.some((args) => args[0] === "switch" && args[1] === "--create" && args[3] === "--track" && args[4] === "origin/develop"), true, "the script must create a dedicated branch tracking the fetched develop tip")
  assert.deepEqual(calls.find((args) => args[0] === "add"), ["add", "--", result.reportPath], "only the generated sanitized report may be staged")
  assert.equal(calls.some((args) => args[0] === "push" && args[1] === "--set-upstream" && args[2] === "origin"), true, "the report branch must be pushed without force")
  assert.deepEqual(calls.find((args) => args[0] === "commit"), ["commit", "--only", "-m", "chore(brokers): publish sanitized Bitunix health report", "--", result.reportPath], "the commit must include only the generated sanitized report")
  assert.deepEqual(calls.at(-1), ["switch", "develop"], "the script must return to develop after publishing the report")
}

async function assertReportFilesAreSanitized({ result, repositoryRoot }) {
  const report = await readFile(join(repositoryRoot, result.reportPath), "utf8")
  const localReport = await readFile(join(repositoryRoot, result.localReportPath), "utf8")
  for (const privateValue of [apiKey, apiSecret, "private-signature", "private-uid", "123.456", "private error message"]) {
    assert.equal(report.includes(privateValue), false, "the public report must not contain credentials, account values, or private error text")
    assert.equal(localReport.includes(privateValue), false, "the local report must apply the same credential and account-value redaction")
  }
  assert.equal(Object.hasOwn(result.report, "events"), false, "the public allowlist must exclude raw diagnostic events")
  const publicAccountResult = result.report.results.find((item) => item.operation === "user.account")
  assert.equal(Object.hasOwn(publicAccountResult, "request"), false, "the public allowlist must omit request payloads")
  assert.equal(Object.hasOwn(publicAccountResult, "response"), false, "the public allowlist must omit response payloads")
  assert.equal(result.reportPath.endsWith("bitunix-health-20261119T083000000Z.json"), true, "the result must identify the report path to inspect")
}

test("does not pass Bitunix API credentials to Git child processes", () => {
  const gitEnvironment = createGitEnvironment({
    env: {
      PATH: "/usr/bin",
      BITUNIX_API_KEY: apiKey,
      BITUNIX_API_SECRET: apiSecret,
      GH_TOKEN: "github-auth-token",
    },
  })

  assert.equal(Object.hasOwn(gitEnvironment, "BITUNIX_API_KEY"), false, "Git child processes must not inherit the Bitunix API key")
  assert.equal(Object.hasOwn(gitEnvironment, "BITUNIX_API_SECRET"), false, "Git child processes must not inherit the Bitunix API secret")
  assert.equal(gitEnvironment.PATH, "/usr/bin", "Git child processes must retain the executable search path")
  assert.equal(gitEnvironment.GH_TOKEN, "github-auth-token", "GitHub authentication must remain available for report push")
})

test("publishes only a sanitized report from a fresh diagnostics branch and returns to develop", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishHealthReport({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport(),
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })
    assertReportBranchPublished({
      result,
      calls,
    })
    await assertReportFilesAreSanitized({
      result,
      repositoryRoot,
    })
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects a dirty worktree before fetching, creating a branch or contacting Bitunix", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit: baseRunGit } = createFakeGit({ repositoryRoot })
  const runGit = async ({ args }) => {
    if (args[0] === "status") {
      calls.push(args)
      return " M packages/brokers/src/index.js"
    }
    return baseRunGit({ args })
  }
  try {
    await assert.rejects(
      publishHealthReport({
        repositoryRoot,
        runGit,
        runDiagnostics: async () => {
          throw new Error("Bitunix must not be contacted when the worktree is dirty")
        },
        now: () => fixedTimestamp,
      }),
      /clean working tree/,
      "the command must refuse to risk switching away from uncommitted user work",
    )
    assert.equal(calls.some((args) => args[0] === "fetch"), false, "a dirty worktree must be rejected before network or branch operations")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects a starting branch other than develop before contacting Bitunix", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit: baseRunGit } = createFakeGit({ repositoryRoot })
  const runGit = async ({ args }) => {
    if (args[0] === "branch") {
      calls.push(args)
      return "feature/user-work"
    }
    return baseRunGit({ args })
  }
  try {
    await assert.rejects(
      publishHealthReport({
        repositoryRoot,
        runGit,
        runDiagnostics: async () => {
          throw new Error("Bitunix must not be contacted outside develop")
        },
        now: () => fixedTimestamp,
      }),
      /must start on develop/,
      "the command must require develop as its known return destination",
    )
    assert.equal(calls.some((args) => args[0] === "fetch"), false, "a non-develop starting branch must be rejected before any remote operation")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

test("push failure still switches the local checkout back to develop", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({
    repositoryRoot,
    failPush: true,
  })
  try {
    const result = await publishHealthReport({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport(),
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "a failed report push must make the command fail rather than claiming publication")
    assert.equal(result.pushError, "[error message withheld]", "Git failure output must not expose free-form remote error text")
    assert.equal(result.pushError.includes(apiSecret), false, "Git error text must not leak configured credentials into terminal output")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "a failed push must not leave the user's checkout on the report branch")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

test("publishes failed API diagnostics and returns a failing exit code after cleanup", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishHealthReport({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport({ failed: 1 }),
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })
    assertFailedHealthReport({
      result,
      calls,
    })
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})


test("publishes a sanitized failure report when the diagnostic runner throws", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishHealthReport({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => {
        throw new Error(`Bitunix request failed for ${apiSecret}`)
      },
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "an unexpected diagnostic exception must produce a failing health-check exit code")
    assert.equal(result.report.summary.failed, 1, "an unexpected diagnostic exception must be represented as a failed report operation")
    assert.equal(JSON.stringify(result.report).includes(apiSecret), false, "the generated failure report must redact credential values from exception messages")
    assert.equal(calls.some((args) => args[0] === "push"), true, "a sanitized failure report must still be pushed when Git operations succeed")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "a thrown diagnostic exception must still return the checkout to develop")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})


test("requires both private API credentials before fetching or contacting Bitunix", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    await assert.rejects(
      publishHealthReport({
        repositoryRoot,
        runGit,
        runDiagnostics: async () => {
          throw new Error("Bitunix must not be contacted without both private credentials")
        },
        env: {},
        now: () => fixedTimestamp,
      }),
      /requires both read-only credentials/,
      "the published health check must never report a healthy public-only run as an authenticated account check",
    )
    assert.equal(calls.some((args) => args[0] === "fetch"), false, "missing private credentials must be rejected before a report branch is created")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})


test("blocks the operator preflight gate when diagnostic configuration is skipped", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishHealthReport({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport({ omitOperation: "diagnostic configuration" }),
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "skipping a required authenticated operation must not produce a healthy result")
    assert.deepEqual(result.healthCheck.missingRequiredOperations, ["diagnostic configuration"], "the report must identify the exact safety/configuration prerequisite that did not pass")
    assert.equal(calls.some((args) => args[0] === "push"), true, "the incomplete health report must still be pushed for diagnosis")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "an incomplete health report must still return the checkout to develop")
  } finally {
    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})


async function createGitFixture({ temporaryDirectory }) {
  const repositoryRoot = join(temporaryDirectory, "working")
  const remotePath = join(temporaryDirectory, "origin.git")
  await executeGit({
    cwd: temporaryDirectory,
    args: ["init", "--bare", "--initial-branch=develop", remotePath],
  })
  await executeGit({
    cwd: temporaryDirectory,
    args: ["init", "--initial-branch=develop", repositoryRoot],
  })
  await executeGit({
    cwd: repositoryRoot,
    args: ["config", "user.name", "Bitunix Health Test"],
  })
  await executeGit({
    cwd: repositoryRoot,
    args: ["config", "user.email", "bitunix-health@example.invalid"],
  })
  await writeFile(join(repositoryRoot, ".gitignore"), "packages/brokers/.diagnostics/\n")
  await writeFile(join(repositoryRoot, "seed.txt"), "initial develop content\n")
  await executeGit({
    cwd: repositoryRoot,
    args: ["add", ".gitignore", "seed.txt"],
  })
  await executeGit({
    cwd: repositoryRoot,
    args: ["commit", "-m", "initial develop commit"],
  })
  await executeGit({
    cwd: repositoryRoot,
    args: ["remote", "add", "origin", remotePath],
  })
  await executeGit({
    cwd: repositoryRoot,
    args: ["push", "--set-upstream", "origin", "develop"],
  })
  return {
    repositoryRoot,
    remotePath,
  }
}

async function verifyGitPublication({ repositoryRoot, remotePath, temporaryDirectory, result }) {
  const currentBranch = await executeGit({
    cwd: repositoryRoot,
    args: ["branch", "--show-current"],
  })
  const remoteBranches = await executeGit({
    cwd: temporaryDirectory,
    args: ["--git-dir", remotePath, "branch", "--list", result.branch],
  })
  const committedFiles = await executeGit({
    cwd: repositoryRoot,
    args: ["diff-tree", "--no-commit-id", "--name-only", "-r", result.commitSha],
  })
  const status = await executeGit({
    cwd: repositoryRoot,
    args: ["status", "--porcelain", "--untracked-files=all"],
  })

  assert.equal(currentBranch, "develop", "the actual Git workflow must return the user's checkout to develop")
  assert.equal(remoteBranches, result.branch, "the report branch must exist on the configured remote")
  assert.equal(committedFiles, result.reportPath, "the pushed commit must contain exactly the sanitized report")
  assert.equal(status, "", "the ignored local diagnostic report must not dirty the returned develop worktree")
  assert.equal(result.exitCode, 0, "a complete successful report must return a zero exit code")
}

test("runs the real Git branch, report-only commit, push and return workflow", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "bitunix-health-git-"))
  try {
    const fixture = await createGitFixture({ temporaryDirectory })
    const result = await publishHealthReport({
      repositoryRoot: fixture.repositoryRoot,
      runDiagnostics: async () => createDiagnosticReport(),
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })
    await verifyGitPublication({
      ...fixture,
      temporaryDirectory,
      result,
    })
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    })
  }
})
