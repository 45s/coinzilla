import { createHash, randomUUID as randomUUIDNative } from "node:crypto"
import { execFileSync as execFileSyncNative, spawn as spawnNative } from "node:child_process"
import {
  accessSync as accessSyncNative,
  constants as fsConstants,
  existsSync as existsSyncNative,
  mkdirSync as mkdirSyncNative,
  readFileSync as readFileSyncNative,
  realpathSync as realpathSyncNative,
  rmdirSync as rmdirSyncNative,
  statSync as statSyncNative,
  writeFileSync as writeFileSyncNative,
} from "node:fs"
import { basename, dirname, join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const SANDBOX_ROOT = "/workspace/coinzilla"
const CGROUP_ROOT = "/sys/fs/cgroup"
const MEMORY_ADDRESS_SPACE_LIMIT_BYTES = 8_589_934_592
const CPU_QUOTA_MICROSECONDS = 100_000
const CPU_PERIOD_MICROSECONDS = 100_000
const SANDBOX_PROCESS_LIMIT = 64
const REQUIRED_SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
})
const ERRNO_PERMISSION_DENIED = 0x00050001
const SECCOMP_ALLOW = 0x7fff0000
const SECCOMP_KILL_PROCESS = 0x80000000
const CLONE_THREAD = 0x00010000

function syscallNumbers({ arch }) {
  if (arch === "x64") {
    return {
      auditArch: 0xc000003e,
      clone: 56,
      denied: [57, 58, 41, 53, 42, 43, 288, 49, 50, 44, 45, 48, 54, 55, 165, 166, 101, 272, 308, 321, 298, 250, 304, 323, 311, 425, 426, 427, 322],
    }
  }
  if (arch === "arm64") {
    return {
      auditArch: 0xc00000b7,
      clone: 220,
      denied: [198, 199, 203, 202, 242, 200, 201, 206, 207, 210, 208, 209, 40, 39, 117, 97, 268, 280, 241, 219, 265, 282, 271, 425, 426, 427, 281],
    }
  }
  throw new TypeError(`Unsupported Linux seccomp architecture: ${arch}`)
}

function encodeInstruction({ code, jt = 0, jf = 0, k = 0 }) {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt16LE(code, 0)
  buffer.writeUInt8(jt, 2)
  buffer.writeUInt8(jf, 3)
  buffer.writeUInt32LE(k >>> 0, 4)
  return buffer
}

function buildFilterInstructions({ auditArch, clone, denied }) {
  const instructions = [
    encodeInstruction({
      code: 0x20,
      k: 4,
    }),
    encodeInstruction({
      code: 0x15,
      jt: 1,
      k: auditArch,
    }),
    encodeInstruction({
      code: 0x06,
      k: SECCOMP_KILL_PROCESS,
    }),
    encodeInstruction({
      code: 0x20,
      k: 0,
    }),
    encodeInstruction({
      code: 0x15,
      jf: 4,
      k: clone,
    }),
    encodeInstruction({
      code: 0x20,
      k: 16,
    }),
    encodeInstruction({
      code: 0x45,
      jt: 1,
      k: CLONE_THREAD,
    }),
    encodeInstruction({
      code: 0x06,
      k: ERRNO_PERMISSION_DENIED,
    }),
    encodeInstruction({
      code: 0x06,
      k: SECCOMP_ALLOW,
    }),
  ]
  for (const syscall of denied) {
    instructions.push(encodeInstruction({
      code: 0x15,
      jf: 1,
      k: syscall,
    }))
    instructions.push(encodeInstruction({
      code: 0x06,
      k: ERRNO_PERMISSION_DENIED,
    }))
  }
  instructions.push(encodeInstruction({
    code: 0x06,
    k: SECCOMP_ALLOW,
  }))
  return instructions
}

export function buildScenarioSeccompFilter({ arch = process.arch } = {}) {
  const syscalls = syscallNumbers({ arch })
  return Buffer.concat(buildFilterInstructions(syscalls))
}

function verifyTrustedExecutableDirectories({ path, statSync }) {
  let directory = dirname(path)
  while (directory !== "/") {
    const stat = statSync(directory)
    if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error(`Sandbox executable parent directory is not trusted: ${directory}`)
    }
    directory = dirname(directory)
  }
}

function verifyTrustedExecutable({ path, realpathSync, statSync, readFileSync }) {
  const canonicalPath = realpathSync(path)
  verifyTrustedExecutableDirectories({
    path: canonicalPath,
    statSync,
  })
  const stat = statSync(canonicalPath)
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error(`Sandbox executable is not a trusted root-owned, non-writable file: ${path}`)
  }
  return {
    path: canonicalPath,
    sha256: createHash("sha256").update(readFileSync(canonicalPath)).digest("hex"),
  }
}


function resolveDelegatedCgroupParent({ readFileSync, realpathSync, accessSync }) {
  const unified = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"))
  if (!unified) {
    throw new Error("Scenario sandbox requires a unified cgroup v2 hierarchy")
  }
  const relativePath = unified.slice(3).replace(/^\/+/, "")
  if (relativePath.split("/").includes("..")) {
    throw new Error("Invalid current cgroup path")
  }
  const parentPath = realpathSync(resolve(CGROUP_ROOT, relativePath))
  if (parentPath !== CGROUP_ROOT && !parentPath.startsWith(`${CGROUP_ROOT}/`)) {
    throw new Error("Current cgroup path escapes the cgroup v2 root")
  }
  const controllers = readFileSync(join(parentPath, "cgroup.controllers"), "utf8")
    .trim()
    .split(/\s+/)
  const enabled = readFileSync(join(parentPath, "cgroup.subtree_control"), "utf8")
    .trim()
    .split(/\s+/)
    .map((controller) => controller.replace(/^\+/, ""))
  for (const controller of ["memory", "cpu", "pids"]) {
    if (!controllers.includes(controller) || !enabled.includes(controller)) {
      throw new Error(`Scenario cgroup controller is not delegated and enabled: ${controller}`)
    }
  }
  accessSync(parentPath, fsConstants.W_OK)
  return parentPath
}

function createCgroupSettings({ memoryLimitBytes }) {
  return [
    ["memory.max", String(memoryLimitBytes)],
    ["memory.swap.max", "0"],
    ["cpu.max", `${CPU_QUOTA_MICROSECONDS} ${CPU_PERIOD_MICROSECONDS}`],
    ["pids.max", String(SANDBOX_PROCESS_LIMIT)],
    ["memory.oom.group", "1"],
  ]
}

function writeAndVerifyCgroupSettings({ path, settings, writeFileSync, readFileSync }) {
  for (const [name, value] of settings) {
    const filePath = join(path, name)
    writeFileSync(filePath, `${value}\n`, "utf8")
    const actual = readFileSync(filePath, "utf8").trim()
    if (actual !== value) {
      throw new Error(`Scenario cgroup did not apply required setting: ${name}`)
    }
  }
}

function cleanupScenarioCgroup({ path, existsSync, writeFileSync, rmdirSync }) {
  if (!existsSync(path)) {
    return true
  }
  const killPath = join(path, "cgroup.kill")
  let killError = null
  if (existsSync(killPath)) {
    try {
      writeFileSync(killPath, "1\n", "utf8")
    } catch (error) {
      killError = error
    }
  }
  try {
    rmdirSync(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") {
      return true
    }
    if (killError) {
      throw new AggregateError([killError, error], `Scenario cgroup cleanup failed: ${path}`)
    }
    throw new Error(`Scenario cgroup cleanup could not be confirmed: ${path}`, {
      cause: error,
    })
  }
}

function createScenarioCgroup({
  parentPath,
  memoryLimitBytes,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmdirSync,
  randomUUID,
}) {
  const path = join(parentPath, `scenario-runner-${process.pid}-${randomUUID()}`)
  mkdirSync(path, { mode: 0o755 })
  let removed = false
  const cleanup = () => {
    if (removed) {
      return true
    }
    removed = cleanupScenarioCgroup({
      path,
      existsSync,
      writeFileSync,
      rmdirSync,
    })
    return removed
  }
  try {
    writeAndVerifyCgroupSettings({
      path,
      settings: createCgroupSettings({ memoryLimitBytes }),
      writeFileSync,
      readFileSync,
    })
    return Object.freeze({
      cgroupProcsPath: join(path, "cgroup.procs"),
      cleanup,
    })
  } catch (error) {
    try {
      cleanup()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Scenario cgroup setup and cleanup failed")
    }
    throw error
  }
}

function createLinuxCgroupController({
  readFileSync = readFileSyncNative,
  realpathSync = realpathSyncNative,
  accessSync = accessSyncNative,
  mkdirSync = mkdirSyncNative,
  writeFileSync = writeFileSyncNative,
  existsSync = existsSyncNative,
  rmdirSync = rmdirSyncNative,
  randomUUID = randomUUIDNative,
  memoryLimitBytes = REQUIRED_SANDBOX_PROFILE.memoryLimitBytes,
}) {
  const parentPath = resolveDelegatedCgroupParent({
    readFileSync,
    realpathSync,
    accessSync,
  })
  const create = () => createScenarioCgroup({
    parentPath,
    memoryLimitBytes,
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
    rmdirSync,
    randomUUID,
  })
  return Object.freeze({
    verify: () => {
      const probe = create()
      probe.cleanup()
    },
    create,
  })
}

function resolveTrustedExecutable({ candidates, existsSync, verifyExecutable }) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return verifyExecutable({ path: candidate })
    }
  }
  throw new Error(`Required OS sandbox executable is unavailable: ${candidates[0]}`)
}

function verifySandboxTools({
  bwrap,
  prlimit,
  execFileSync,
}) {
  const bwrapVersion = execFileSync(bwrap.path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  })
  const prlimitVersion = execFileSync(prlimit.path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  })
  const bwrapHelp = execFileSync(bwrap.path, ["--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  })
  if (typeof bwrapVersion !== "string" || !bwrapVersion.toLowerCase().includes("bubblewrap") ||
      typeof bwrapHelp !== "string" || !bwrapHelp.includes("--seccomp") || !bwrapHelp.includes("--preserve-fds") ||
      typeof prlimitVersion !== "string" || !prlimitVersion.trim()) {
    throw new Error("Bubblewrap or prlimit version verification failed")
  }
}

function verifySandboxCapabilities({
  bwrap,
  prlimit,
  execFileSync,
}) {
  execFileSync(prlimit.path, [
    String.raw`--as=${MEMORY_ADDRESS_SPACE_LIMIT_BYTES}:${MEMORY_ADDRESS_SPACE_LIMIT_BYTES}`,
    "--cpu=30:30",
    "--",
    bwrap.path,
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
    "--uid", "0",
    "--gid", "0",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--", "/usr/bin/true",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  })
}

function assertIsolationProfile({ profile, maxOutputBytes }) {
  const expected = {
    ...REQUIRED_SANDBOX_PROFILE,
    maxOutputBytes,
  }
  if (!profile || Object.entries(expected).some(([key, value]) => profile[key] !== value)) {
    throw new TypeError("Linux sandbox isolation profile does not match the required profile")
  }
}

function addReadOnlyBind({
      args,
      source,
      target,
    }) {
  args.push("--ro-bind", source, target)
}

function addDirectory({ args, directory, seen }) {
  if (seen?.has(directory)) {
    return
  }
  seen?.add(directory)
  args.push("--dir", directory)
}

function addParentDirectories({ args, target, seen }) {
  const segments = target.split("/").filter(Boolean)
  let current = ""
  for (const segment of segments) {
    current += `/${segment}`
    addDirectory({
      args,
      directory: current,
      seen,
    })
  }
}

function addSystemRuntimeBinds({
    args,
    existsSync,
    realpathSync,
  }) {
  const createdDirectories = new Set()
  for (const source of ["/usr", "/bin", "/lib", "/lib64"]) {
    if (existsSync(source)) {
      addDirectory({
        args,
        directory: source,
        seen: createdDirectories,
      })
      addReadOnlyBind({
        args,
        source: realpathSync(source),
        target: source,
      })
    }
  }
  addDirectory({
    args,
    directory: "/etc",
    seen: createdDirectories,
  })
  for (const source of [
    "/etc/ld.so.cache",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
    "/etc/localtime",
  ]) {
    if (existsSync(source)) {
      addReadOnlyBind({
        args,
        source: realpathSync(source),
        target: source,
      })
    }
  }
  if (existsSync("/etc/ssl/certs")) {
    addDirectory({
      args,
      directory: "/etc/ssl",
      seen: createdDirectories,
    })
    addDirectory({
      args,
      directory: "/etc/ssl/certs",
      seen: createdDirectories,
    })
    addReadOnlyBind({
      args,
      source: realpathSync("/etc/ssl/certs"),
      target: "/etc/ssl/certs",
    })
  }
}

function addWorkspaceBinds({
    args,
    repositoryRoot,
    existsSync,
  }) {
  const createdDirectories = new Set()
  const sources = [
    ["apps/harvester/src", "apps/harvester/src"],
    ["apps/harvester/node_modules", "apps/harvester/node_modules"],
    ["node_modules", "node_modules"],
    ["packages", "packages"],
  ]
  for (const [sourcePath, targetPath] of sources) {
    const source = join(repositoryRoot, sourcePath)
    const target = join(SANDBOX_ROOT, targetPath)
    if (!existsSync(source)) {
      if (sourcePath.endsWith("node_modules")) {
        throw new Error(`Scenario sandbox runtime dependency directory is unavailable: ${sourcePath}`)
      }
      continue
    }
    addParentDirectories({
      args,
      target,
      seen: createdDirectories,
    })
    addReadOnlyBind({
      args,
      source,
      target,
    })
  }
}

function resolveSandboxWorkerPath({ workerPath, repositoryRoot }) {
  const relativeWorkerPath = relative(repositoryRoot, workerPath)
  if (!relativeWorkerPath || relativeWorkerPath.startsWith("..") || relativeWorkerPath.includes(":")) {
    throw new TypeError("Scenario worker path must be inside the trusted repository runtime")
  }
  return posix.join(SANDBOX_ROOT, relativeWorkerPath.split("\\").join("/"))
}

function nodeRuntimeBindDirectory({ nodeExecutable }) {
  const executableDirectory = dirname(nodeExecutable)
  return basename(executableDirectory) === "bin"
    ? dirname(executableDirectory)
    : executableDirectory
}

function addNodeRuntimeBind({ args, nodeExecutable }) {
  if (nodeExecutable.startsWith("/usr/")) {
    return
  }
  const runtimeDirectory = nodeRuntimeBindDirectory({ nodeExecutable })
  addParentDirectories({
    args,
    target: runtimeDirectory,
    seen: new Set(),
  })
  addReadOnlyBind({
    args,
    source: runtimeDirectory,
    target: runtimeDirectory,
  })
}

function createBubblewrapArguments({ workerPath, repositoryRoot, nodeExecutable, existsSync, realpathSync }) {
  const sandboxWorkerPath = resolveSandboxWorkerPath({
    workerPath,
    repositoryRoot,
  })
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
    "--uid", "0",
    "--gid", "0",
  ]
  addSystemRuntimeBinds({
    args,
    existsSync,
    realpathSync,
  })
  addNodeRuntimeBind({
    args,
    nodeExecutable,
  })
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp")
  addWorkspaceBinds({
    args,
    repositoryRoot,
    existsSync,
  })
  args.push(
    "--chdir", join(SANDBOX_ROOT, "apps/harvester"),
    "--seccomp", "4",
    "--preserve-fds", "1",
    "--",
    nodeExecutable,
    "--max-old-space-size=96",
    sandboxWorkerPath,
  )
  return args
}

function createSandboxEnvironment() {
  return Object.freeze({
    PATH: "/usr/bin:/bin",
    NODE_ENV: "test",
    NODE_OPTIONS: "--max-old-space-size=96",
    NODE_CHANNEL_FD: "3",
    NODE_CHANNEL_SERIALIZATION_MODE: "json",
    HOME: "/tmp",
    TMPDIR: "/tmp",
    SCENARIO_RUN_WORKER: "1",
  })
}

function createSandboxSpawnOptions({ stdio }) {
  return {
    env: createSandboxEnvironment(),
    stdio: [...stdio, "pipe"],
    windowsHide: true,
  }
}

function writeSeccompFilter({ child, filter }) {
  const filterPipe = child.stdio?.[4]
  if (!filterPipe || typeof filterPipe.end !== "function") {
    child.kill?.("SIGKILL")
    throw new Error("Sandbox launcher could not pass the seccomp filter to bubblewrap")
  }
  filterPipe.once("error", () => {
    child.kill?.("SIGKILL")
  })
  filterPipe.end(filter)
}

function createCgroupExecArguments({ cgroupProcsPath, prlimitPath, resourceArguments }) {
  const script = 'printf "%s\\n" "$$" > "$1" || exit 125; shift; exec "$@"'
  return [
    "-c",
    script,
    "scenario-cgroup-exec",
    cgroupProcsPath,
    prlimitPath,
    ...resourceArguments,
  ]
}

function createSandboxResourceArguments({
  bwrap,
  workerPath,
  repositoryRoot,
  nodeExecutable,
  existsSync,
  realpathSync,
}) {
  const addressSpaceArgument = `--as=${MEMORY_ADDRESS_SPACE_LIMIT_BYTES}:${MEMORY_ADDRESS_SPACE_LIMIT_BYTES}`
  return [
    addressSpaceArgument,
    "--cpu=30:30",
    "--",
    bwrap.path,
    ...createBubblewrapArguments({
      workerPath,
      repositoryRoot,
      nodeExecutable,
      existsSync,
      realpathSync,
    }),
  ]
}

function killSandboxChild({ child }) {
  if (!child) {
    return null
  }
  try {
    child.kill("SIGKILL")
    return null
  } catch (error) {
    return error
  }
}

function cleanupSandboxCgroupAfterChildExit({ child, cgroup }) {
  try {
    cgroup.cleanup()
    delete child.sandboxCleanupError
  } catch (error) {
    child.sandboxCleanupError = error
  }
}

function spawnCgroupSandboxProcess({
  spawn,
  shell,
  prlimit,
  cgroupController,
  workerPath,
  stdio,
  bwrap,
  repositoryRoot,
  nodeExecutable,
  existsSync,
  realpathSync,
}) {
  const cgroup = cgroupController.create()
  let child
  try {
    const resourceArguments = createSandboxResourceArguments({
      bwrap,
      workerPath,
      repositoryRoot,
      nodeExecutable,
      existsSync,
      realpathSync,
    })
    child = spawn(shell.path, createCgroupExecArguments({
      cgroupProcsPath: cgroup.cgroupProcsPath,
      prlimitPath: prlimit.path,
      resourceArguments,
    }), createSandboxSpawnOptions({ stdio }))
    child.sandboxCleanup = cgroup.cleanup
    const cleanup = () => cleanupSandboxCgroupAfterChildExit({ child, cgroup })
    child.once("close", cleanup)
    child.once("error", cleanup)
    writeSeccompFilter({
      child,
      filter: buildScenarioSeccompFilter(),
    })
    return child
  } catch (error) {
    const childKillError = killSandboxChild({ child })
    let cleanupError = null
    try {
      cgroup.cleanup()
    } catch (failure) {
      cleanupError = failure
    }
    if (cleanupError) {
      const failures = [error]
      if (childKillError) {
        failures.push(childKillError)
      }
      failures.push(cleanupError)
      throw new Error("Sandbox setup failed and cgroup cleanup could not be confirmed", {
        cause: new AggregateError(failures, "Sandbox setup and cleanup failed"),
      })
    }
    if (childKillError) {
      throw new Error("Sandbox setup failed and child termination could not be confirmed", {
        cause: new AggregateError([error, childKillError], "Sandbox setup and termination failed"),
      })
    }
    throw error
  }
}

function createLinuxLauncher({
  bwrap,
  prlimit,
  shell,
  cgroupController,
  repositoryRoot,
  nodeExecutable,
  nodeRuntimeSha256,
  spawn,
  existsSync,
  realpathSync,
  maxOutputBytes,
}) {
  const launcher = ({ workerPath, stdio, sandboxProfile }) => {
    assertIsolationProfile({
      profile: sandboxProfile,
      maxOutputBytes,
    })
    return spawnCgroupSandboxProcess({
      spawn,
      shell,
      prlimit,
      cgroupController,
      workerPath,
      stdio,
      bwrap,
      repositoryRoot,
      nodeExecutable,
      existsSync,
      realpathSync,
    })
  }
  launcher.isolationAttestation = Object.freeze({
    level: "os",
    ...REQUIRED_SANDBOX_PROFILE,
    maxOutputBytes,
    bwrapSha256: bwrap.sha256,
    prlimitSha256: prlimit.sha256,
    shellSha256: shell.sha256,
    nodeRuntimeSha256,
    cgroupV2Verified: true,
  })
  return Object.freeze(launcher)
}

function assertMaxOutputBytes({ maxOutputBytes }) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("Sandbox maximum output bytes must be a positive safe integer")
  }
}

function resolveExecutableVerifier({ verifyExecutable, realpathSync, statSync, readFileSync }) {
  return verifyExecutable ?? (({ path }) => verifyTrustedExecutable({
    path,
    realpathSync,
    statSync,
    readFileSync,
  }))
}

function resolveSandboxTools({
    bwrapPath,
    prlimitPath,
    shellPath,
    existsSync,
    verifyExecutable,
  }) {
  const bwrap = resolveTrustedExecutable({
    candidates: [bwrapPath, "/bin/bwrap"],
    existsSync,
    verifyExecutable,
  })
  const prlimit = resolveTrustedExecutable({
    candidates: [prlimitPath, "/bin/prlimit"],
    existsSync,
    verifyExecutable,
  })
  const shell = resolveTrustedExecutable({
    candidates: [shellPath, "/usr/bin/sh"],
    existsSync,
    verifyExecutable,
  })
  return {
    bwrap,
    prlimit,
    shell,
  }
}

function resolveTrustedNodeRuntime({ nodeExecutable, realpathSync, verifyExecutable }) {
  const path = realpathSync(nodeExecutable)
  const runtime = verifyExecutable({ path })
  if (runtime.path !== path || !/^[a-f0-9]{64}$/i.test(runtime.sha256)) {
    throw new Error("The scenario Node runtime failed trusted executable verification")
  }
  return runtime
}

function verifyLinuxSandboxRuntime({ bwrap, prlimit, execFileSync, arch }) {
  verifySandboxTools({
    bwrap,
    prlimit,
    execFileSync,
  })
  verifySandboxCapabilities({
    bwrap,
    prlimit,
    execFileSync,
  })
  syscallNumbers({ arch })
}

function createVerifiedSandboxTools({ options, verify }) {
  return resolveSandboxTools({
    bwrapPath: options.bwrapPath,
    prlimitPath: options.prlimitPath,
    shellPath: options.shellPath,
    existsSync: options.existsSync,
    verifyExecutable: verify,
  })
}

function createVerifiedCgroupController({ options }) {
  const controller = options.cgroupController ?? createLinuxCgroupController({
    readFileSync: options.readFileSync,
    realpathSync: options.realpathSync,
    accessSync: options.accessSync,
    mkdirSync: options.mkdirSync,
    writeFileSync: options.writeFileSync,
    existsSync: options.existsSync,
    rmdirSync: options.rmdirSync,
    randomUUID: options.randomUUID,
  })
  controller.verify()
  return controller
}

function createVerifiedNodeRuntime({ options, verify }) {
  const repositoryRoot = options.realpathSync(resolve(options.repositoryRoot))
  const nodeRuntime = resolveTrustedNodeRuntime({
    nodeExecutable: options.nodeExecutable,
    realpathSync: options.realpathSync,
    verifyExecutable: verify,
  })
  return {
    repositoryRoot,
    nodeRuntime,
  }
}

function createLinuxBubblewrapSandboxLauncherInternal(options) {
  if (options.platform !== "linux") {
    throw new Error("The trusted Bubblewrap scenario sandbox is supported only on Linux")
  }
  assertMaxOutputBytes({ maxOutputBytes: options.maxOutputBytes })
  const verify = resolveExecutableVerifier({
    verifyExecutable: options.verifyExecutable,
    realpathSync: options.realpathSync,
    statSync: options.statSync,
    readFileSync: options.readFileSync,
  })
  const { bwrap, prlimit, shell } = createVerifiedSandboxTools({
    options,
    verify,
  })
  const cgroupController = createVerifiedCgroupController({ options })
  verifyLinuxSandboxRuntime({
    bwrap,
    prlimit,
    execFileSync: options.execFileSync,
    arch: options.arch,
  })
  const { repositoryRoot, nodeRuntime } = createVerifiedNodeRuntime({
    options,
    verify,
  })
  return createLinuxLauncher({
    bwrap,
    prlimit,
    shell,
    cgroupController,
    repositoryRoot,
    nodeExecutable: nodeRuntime.path,
    nodeRuntimeSha256: nodeRuntime.sha256,
    spawn: options.spawn,
    existsSync: options.existsSync,
    realpathSync: options.realpathSync,
    maxOutputBytes: options.maxOutputBytes,
  })
}

export function createLinuxBubblewrapSandboxLauncher(options = {}) {
  return createLinuxBubblewrapSandboxLauncherInternal({
    platform: process.platform,
    arch: process.arch,
    repositoryRoot: fileURLToPath(new URL("../../../../..", import.meta.url)),
    nodeExecutable: process.execPath,
    bwrapPath: "/usr/bin/bwrap",
    prlimitPath: "/usr/bin/prlimit",
    shellPath: "/bin/sh",
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    spawn: spawnNative,
    execFileSync: execFileSyncNative,
    existsSync: existsSyncNative,
    realpathSync: realpathSyncNative,
    statSync: statSyncNative,
    readFileSync: readFileSyncNative,
    accessSync: accessSyncNative,
    mkdirSync: mkdirSyncNative,
    writeFileSync: writeFileSyncNative,
    rmdirSync: rmdirSyncNative,
    randomUUID: randomUUIDNative,
    ...options,
  })
}
