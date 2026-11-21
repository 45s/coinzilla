import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"
import {
  createDiagnosticReport,
  createDiagnosticResult,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
} from "../helpers/diagnostics.js"
import {
  REQUIRED_HEALTH_OPERATIONS, createGitEnvironment, createPublishedReport, createReportPaths,
  createTimestamp, evaluateHealthCheck, getRelativePath, getSecrets, throwWorkflowErrors,
  validateDiagnosticReport, validatePrivateCredentials, withholdFreeFormErrorMessages,
} from "../helpers/health-report.js"
export { createGitEnvironment }

const execFileAsync = promisify(execFile)
const REPORT_COMMIT_MESSAGE = "chore(brokers): publish sanitized Bitunix health report"






export 
async function executeGitCommand({ repositoryRoot, args }) {
  const gitEnv = createGitEnvironment({ env: process.env })
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitEnv,
  })
  return stdout.trim()
}

async function validateStartingState({ repositoryRoot, runGit }) {
  const actualRoot = await runGit({
    repositoryRoot,
    args: ["rev-parse", "--show-toplevel"],
  })
  if (resolve(actualRoot) !== repositoryRoot) {
    throw new Error("Run the Bitunix health command from inside the Coinzilla repository")
  }
  const status = await runGit({
    repositoryRoot,
    args: ["status", "--porcelain", "--untracked-files=all"],
  })
  if (status) {
    throw new Error("Bitunix health publishing requires a clean working tree; commit or move your changes first")
  }
  const branch = await runGit({
    repositoryRoot,
    args: ["branch", "--show-current"],
  })
  if (branch !== "develop") {
    throw new Error("Bitunix health publishing must start on develop so the script can safely return there")
  }
  const origin = await runGit({
    repositoryRoot,
    args: ["remote", "get-url", "origin"],
  })
  if (!origin) {
    throw new Error("Bitunix health publishing requires a configured origin remote")
  }
}

function createRunnerFailureReport({ error, env, startedAt, now }) {
  const finishedAt = now()
  const secrets = getSecrets({ env })
  const result = createDiagnosticResult({
    operation: "diagnostic runner",
    status: "failed",
    error,
    secrets,
  })
  return createDiagnosticReport({
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    results: [result],
    events: [],
  })
}

async function runDiagnosticsSafely({ runDiagnostics, env, now, onProgress }) {
  const startedAt = now()
  try {
    return await runDiagnostics({
      env,
      onProgress,
    })
  } catch (error) {
    return createRunnerFailureReport({
      error,
      env,
      startedAt,
      now,
    })
  }
}


async function writeDiagnosticReport({ path, report }) {
  await mkdir(dirname(path), {
    recursive: true,
  })
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
}



async function writeReports({ paths, report, env }) {
  const sanitized = withholdFreeFormErrorMessages({
    value: sanitizeDiagnosticValue({
      value: report,
      secrets: getSecrets({ env }),
    }),
  })
  const published = createPublishedReport({
    report: sanitized,
  })
  await writeDiagnosticReport({
    path: paths.local,
    report: sanitized,
  })
  await writeDiagnosticReport({
    path: paths.published,
    report: published,
  })
  return {
    local: sanitized,
    published,
  }
}

async function publishReportBranch({ repositoryRoot, runGit, branch, reportPath, env, onProgress }) {
  onProgress?.({ message: "[5/5] Staging the sanitized report" })
  await runGit({
    repositoryRoot,
    args: ["add", "--", reportPath],
  })
  onProgress?.({ message: "[5/5] Committing the report-only change" })
  await runGit({
    repositoryRoot,
    args: ["commit", "--only", "-m", REPORT_COMMIT_MESSAGE, "--", reportPath],
  })
  const commitSha = await runGit({
    repositoryRoot,
    args: ["rev-parse", "HEAD"],
  })
  let pushError = null
  try {
    onProgress?.({ message: `[5/5] Pushing ${branch} to origin` })
    await runGit({
      repositoryRoot,
      args: ["push", "--set-upstream", "origin", branch],
    })
  } catch (error) {
    pushError = sanitizeDiagnosticError({
      error,
      secrets: getSecrets({ env }),
    }).message
  }
  return {
    commitSha,
    pushError,
  }
}

async function switchBackToDevelop({ repositoryRoot, runGit }) {
  await runGit({
    repositoryRoot,
    args: ["switch", "develop"],
  })
}


async function runOnReportBranch({ repositoryRoot, runGit, branch, paths, publishedReportPath, runDiagnostics, env, now, onProgress }) {
  onProgress?.({ message: "[3/5] Running Bitunix REST and authenticated WebSocket diagnostics" })
  const report = await runDiagnosticsSafely({
    runDiagnostics,
    env,
    now,
    onProgress,
  })
  validateDiagnosticReport({ report })
  const healthCheck = evaluateHealthCheck({ report })
  onProgress?.({ message: "[4/5] Writing sanitized local and publishable reports" })
  const reports = await writeReports({
    paths,
    report: {
      ...report,
      healthCheck,
    },
    env,
  })
  const publication = await publishReportBranch({
    repositoryRoot,
    runGit,
    branch,
    reportPath: publishedReportPath,
    env,
    onProgress,
  })
  return {
    report: reports.published,
    healthCheck,
    ...publication,
  }
}


async function executeReportBranchWorkflow({ repositoryRoot, runGit, branch, paths, publishedReportPath, runDiagnostics, env, now, onProgress }) {
  let branchCreated = false
  let operationError = null
  let cleanupError = null
  let result

  try {
    onProgress?.({ message: "[2/5] Fetching the latest origin/develop" })
    await runGit({
      repositoryRoot,
      args: ["fetch", "origin", "refs/heads/develop:refs/remotes/origin/develop"],
    })
    onProgress?.({ message: "      Fetched origin/develop" })
    onProgress?.({ message: `Creating report branch ${branch}` })
    await runGit({
      repositoryRoot,
      args: ["switch", "--create", branch, "--track", "origin/develop"],
    })
    onProgress?.({ message: "      Report branch checked out" })
    branchCreated = true
    result = await runOnReportBranch({
      repositoryRoot,
      runGit,
      branch,
      paths,
      publishedReportPath,
      runDiagnostics,
      env,
      now,
      onProgress,
    })
  } catch (error) {
    operationError = error
  } finally {
    if (branchCreated) {
      try {
        onProgress?.({ message: "Returning the local checkout to develop" })
        await switchBackToDevelop({
          repositoryRoot,
          runGit,
        })
        onProgress?.({ message: "Local checkout is back on develop" })
      } catch (error) {
        cleanupError = error
      }
    }
  }

  throwWorkflowErrors({
    operationError,
    cleanupError,
  })
  return result
}

export async function publishBitunixDiagnostics({
  repositoryRoot,
  runDiagnostics,
  runGit = executeGitCommand,
  env = process.env,
  now = Date.now,
  onProgress = () => {},
} = {}) {
  if (typeof runDiagnostics !== "function") {
    throw new TypeError("A Bitunix diagnostic runner must be provided")
  }
  const root = resolve(repositoryRoot)
  onProgress({ message: "[1/5] Validating credentials and clean develop checkout" })
  await validateStartingState({
    repositoryRoot: root,
    runGit,
  })
  validatePrivateCredentials({ env })
  onProgress({ message: "      Credentials and repository state verified" })
  const timestamp = createTimestamp({ timestamp: now() })
  const branch = `diagnostics/bitunix-health-${timestamp}`
  const paths = createReportPaths({
    repositoryRoot: root,
    timestamp,
  })
  const publishedReportPath = getRelativePath({
    repositoryRoot: root,
    path: paths.published,
  })
  const execution = await executeReportBranchWorkflow({
    repositoryRoot: root,
    runGit,
    branch,
    paths,
    publishedReportPath,
    runDiagnostics,
    env,
    now,
    onProgress,
  })
  return {
    branch,
    commitSha: execution.commitSha,
    report: execution.report,
    healthCheck: execution.healthCheck,
    reportPath: publishedReportPath,
    localReportPath: getRelativePath({
      repositoryRoot: root,
      path: paths.local,
    }),
    pushError: execution.pushError,
    exitCode: !execution.healthCheck.healthy || execution.pushError ? 1 : 0,
  }
}
