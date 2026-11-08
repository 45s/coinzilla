import { execFileSync as defaultExecFileSync } from "node:child_process"

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/i
const GIT_EXECUTION_OPTIONS = Object.freeze({
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  timeout: 3000,
  windowsHide: true,
})

const requireNonEmptyString = ({ value, field }) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value.trim()
}

const requireEnvironment = (environment) => {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("env must be an object")
  }
  return environment
}

const readEnvironmentString = ({ environment, name }) => {
  const value = environment[name]
  if (typeof value !== "string" || value.trim() === "") {
    return null
  }
  return value.trim()
}

const readEnvironmentCommit = ({ environment }) => {
  const commit = readEnvironmentString({
    environment,
    name: "COINZILLA_BUILD_COMMIT",
  })
  if (!commit || !COMMIT_SHA_PATTERN.test(commit)) {
    return null
  }
  return commit.toLowerCase()
}

const readEnvironmentWorkingTree = ({ environment }) => {
  const workingTree = readEnvironmentString({
    environment,
    name: "COINZILLA_BUILD_WORKING_TREE",
  })
  if (workingTree === "clean" || workingTree === "dirty") {
    return workingTree
  }
  return "unknown"
}

const runGit = ({ args, cwd, execFileSync }) => {
  const output = execFileSync("git", args, {
    ...GIT_EXECUTION_OPTIONS,
    cwd,
  })
  if (typeof output === "string") {
    return output.trim()
  }
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8").trim()
  }
  throw new TypeError("Git command output must be text")
}

const readGitMetadata = ({ cwd, execFileSync }) => {
  try {
    const repositoryRoot = runGit({
      args: ["rev-parse", "--show-toplevel"],
      cwd,
      execFileSync,
    })
    if (repositoryRoot === "") {
      return null
    }

    const commit = runGit({
      args: ["rev-parse", "HEAD"],
      cwd,
      execFileSync,
    }).toLowerCase()
    if (!COMMIT_SHA_PATTERN.test(commit)) {
      return null
    }

    const branch = runGit({
      args: ["branch", "--show-current"],
      cwd,
      execFileSync,
    })
    const commitMessage = runGit({
      args: ["log", "-1", "--format=%s"],
      cwd,
      execFileSync,
    })
    const commitDate = runGit({
      args: ["log", "-1", "--format=%cI"],
      cwd,
      execFileSync,
    })
    const workingTreeChanges = runGit({
      args: ["status", "--porcelain", "--untracked-files=all"],
      cwd,
      execFileSync,
    })

    return {
      branch: branch || null,
      commit,
      commitMessage: commitMessage || null,
      commitDate: commitDate || null,
      workingTree: workingTreeChanges === "" ? "clean" : "dirty",
    }
  } catch {
    // Missing Git, a non-repository working directory, or an unreadable Git
    // worktree must not prevent the application from starting.
    return null
  }
}

const readEnvironmentMetadata = ({ environment }) => ({
  branch: readEnvironmentString({
    environment,
    name: "COINZILLA_BUILD_BRANCH",
  }),
  commit: readEnvironmentCommit({ environment }),
  commitMessage: readEnvironmentString({
    environment,
    name: "COINZILLA_BUILD_COMMIT_MESSAGE",
  }),
  commitDate: readEnvironmentString({
    environment,
    name: "COINZILLA_BUILD_COMMIT_DATE",
  }),
  workingTree: readEnvironmentWorkingTree({ environment }),
})

const hasEnvironmentMetadata = (metadata) =>
  metadata.branch !== null ||
  metadata.commit !== null ||
  metadata.commitMessage !== null ||
  metadata.commitDate !== null ||
  metadata.workingTree !== "unknown"

/**
 * Capture an allowlisted application build identity from Git or explicit build
 * environment variables. Call once at process startup and reuse the snapshot.
 *
 * Git is preferred when the supplied working directory is a readable
 * repository. If Git is unavailable, only COINZILLA_BUILD_* values are read.
 * No environment files, changed file names, or arbitrary environment values
 * are returned.
 *
 * @param {object} options
 * @param {string} options.application Non-empty application identifier.
 * @param {string} options.version Non-empty application package version.
 * @param {string} options.cwd Working directory from which Git is queried.
 * @param {Record<string, unknown>} [options.env={}] Explicit environment source.
 * @param {(file: string, args: string[], options: object) => (string|Buffer)} [options.execFileSync] Injectable Git command boundary.
 * @returns {{
 *   application: string,
 *   version: string,
 *   source: {
 *     branch: string|null,
 *     commit: string|null,
 *     shortCommit: string|null,
 *     commitMessage: string|null,
 *     commitDate: string|null,
 *     workingTree: 'clean'|'dirty'|'unknown',
 *     metadataSource: 'git'|'environment'|'unavailable'
 *   }
 * }}
 * @throws {TypeError} If required identity fields or injected dependencies are invalid.
 */
export function captureBuildMetadata({
  application,
  version,
  cwd,
  env = {},
  execFileSync = defaultExecFileSync,
} = {}) {
  const normalizedApplication = requireNonEmptyString({
    value: application,
    field: "application",
  })
  const normalizedVersion = requireNonEmptyString({
    value: version,
    field: "version",
  })
  const workingDirectory = requireNonEmptyString({
    value: cwd,
    field: "cwd",
  })
  const environment = requireEnvironment(env)
  if (typeof execFileSync !== "function") {
    throw new TypeError("execFileSync must be a function")
  }

  const gitMetadata = readGitMetadata({
    cwd: workingDirectory,
    execFileSync,
  })
  const environmentMetadata = readEnvironmentMetadata({ environment })
  const selectedMetadata = gitMetadata ?? environmentMetadata
  let metadataSource = "unavailable"
  if (gitMetadata) {
    metadataSource = "git"
  } else if (hasEnvironmentMetadata(environmentMetadata)) {
    metadataSource = "environment"
  }
  const commit = selectedMetadata.commit

  return Object.freeze({
    application: normalizedApplication,
    version: normalizedVersion,
    source: Object.freeze({
      branch: selectedMetadata.branch,
      commit,
      shortCommit: commit ? commit.slice(0, 8) : null,
      commitMessage: selectedMetadata.commitMessage,
      commitDate: selectedMetadata.commitDate,
      workingTree: selectedMetadata.workingTree,
      metadataSource,
    }),
  })
}
