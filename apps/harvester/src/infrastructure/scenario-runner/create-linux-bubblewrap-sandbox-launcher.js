import { createHash } from "node:crypto"
import { execFileSync as execFileSyncNative, spawn as spawnNative } from "node:child_process"
import { existsSync as existsSyncNative, readFileSync as readFileSyncNative, realpathSync as realpathSyncNative, statSync as statSyncNative } from "node:fs"
import { dirname, join, posix, relative, resolve } from "node:path"

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const SANDBOX_ROOT = "/workspace/coinzilla"
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
      denied: [57, 58, 41, 53, 42, 43, 288, 49, 50, 44, 45, 48, 54, 55, 165, 166, 101, 272, 308, 321, 298, 250, 304, 323, 311, 425, 426, 427, 59, 322],
    }
  }
  if (arch === "arm64") {
    return {
      auditArch: 0xc00000b7,
      clone: 220,
      denied: [198, 199, 203, 202, 242, 200, 201, 206, 207, 210, 208, 209, 40, 39, 117, 97, 268, 280, 241, 219, 265, 282, 271, 425, 426, 427, 221, 281],
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
    encodeInstruction({ code: 0x20, k: 4 }),
    encodeInstruction({ code: 0x15, jt: 1, k: auditArch }),
    encodeInstruction({ code: 0x06, k: SECCOMP_KILL_PROCESS }),
    encodeInstruction({ code: 0x20, k: 0 }),
    encodeInstruction({ code: 0x15, jf: 4, k: clone }),
    encodeInstruction({ code: 0x20, k: 16 }),
    encodeInstruction({ code: 0x45, jt: 1, k: CLONE_THREAD }),
    encodeInstruction({ code: 0x06, k: ERRNO_PERMISSION_DENIED }),
    encodeInstruction({ code: 0x06, k: SECCOMP_ALLOW }),
  ]
  for (const syscall of denied) {
    instructions.push(encodeInstruction({ code: 0x15, jf: 1, k: syscall }))
    instructions.push(encodeInstruction({ code: 0x06, k: ERRNO_PERMISSION_DENIED }))
  }
  instructions.push(encodeInstruction({ code: 0x06, k: SECCOMP_ALLOW }))
  return instructions
}

export function buildScenarioSeccompFilter({ arch = process.arch } = {}) {
  const syscalls = syscallNumbers({ arch })
  return Buffer.concat(buildFilterInstructions(syscalls))
}

function verifyTrustedExecutable({ path, realpathSync, statSync, readFileSync }) {
  const canonicalPath = realpathSync(path)
  const stat = statSync(canonicalPath)
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error(`Sandbox executable is not a trusted root-owned, non-writable file: ${path}`)
  }
  return {
    path: canonicalPath,
    sha256: createHash("sha256").update(readFileSync(canonicalPath)).digest("hex"),
  }
}

function resolveTrustedExecutable({ candidates, existsSync, verifyExecutable }) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return verifyExecutable({ path: candidate })
    }
  }
  throw new Error(`Required OS sandbox executable is unavailable: ${candidates[0]}`)
}

function verifySandboxTools({ bwrap, prlimit, execFileSync }) {
  const bwrapVersion = execFileSync(bwrap.path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  const prlimitVersion = execFileSync(prlimit.path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (typeof bwrapVersion !== "string" || !bwrapVersion.toLowerCase().includes("bubblewrap") ||
      typeof prlimitVersion !== "string" || !prlimitVersion.trim()) {
    throw new Error("Bubblewrap or prlimit version verification failed")
  }
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

function addReadOnlyBind({ args, source, target }) {
  args.push("--ro-bind", source, target)
}

function addDirectory({ args, directory }) {
  args.push("--dir", directory)
}

function addParentDirectories({ args, target }) {
  const segments = target.split("/").filter(Boolean)
  let current = ""
  for (const segment of segments.slice(0, -1)) {
    current += `/${segment}`
    addDirectory({ args, directory: current })
  }
}

function addSystemRuntimeBinds({ args, existsSync, realpathSync }) {
  for (const source of ["/usr", "/bin", "/lib", "/lib64"]) {
    if (existsSync(source)) {
      addReadOnlyBind({
        args,
        source: realpathSync(source),
        target: source,
      })
    }
  }
  addDirectory({ args, directory: "/etc" })
  for (const source of [
    "/etc/ld.so.cache",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
    "/etc/localtime",
  ]) {
    if (existsSync(source)) {
      addReadOnlyBind({ args, source: realpathSync(source), target: source })
    }
  }
  if (existsSync("/etc/ssl/certs")) {
    addReadOnlyBind({
      args,
      source: realpathSync("/etc/ssl/certs"),
      target: "/etc/ssl/certs",
    })
  }
}

function addWorkspaceBinds({ args, repositoryRoot, existsSync }) {
  const workspaceDirectories = [
    "/workspace",
    SANDBOX_ROOT,
    join(SANDBOX_ROOT, "apps"),
    join(SANDBOX_ROOT, "apps/harvester"),
    join(SANDBOX_ROOT, "packages"),
  ]
  for (const directory of workspaceDirectories) {
    addDirectory({ args, directory })
  }
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
    addParentDirectories({ args, target })
    addReadOnlyBind({ args, source, target })
  }
}

function resolveSandboxWorkerPath({ workerPath, repositoryRoot }) {
  const relativeWorkerPath = relative(repositoryRoot, workerPath)
  if (!relativeWorkerPath || relativeWorkerPath.startsWith("..") || relativeWorkerPath.includes(":")) {
    throw new TypeError("Scenario worker path must be inside the trusted repository runtime")
  }
  return posix.join(SANDBOX_ROOT, relativeWorkerPath.split("\\").join("/"))
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
    "--ro-bind", realpathSync("/usr"), "/usr",
  ]
  addSystemRuntimeBinds({ args, existsSync, realpathSync })
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp")
  addWorkspaceBinds({ args, repositoryRoot, existsSync })
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

function createLinuxLauncher({ bwrap, prlimit, repositoryRoot, nodeExecutable, spawn, existsSync, realpathSync, maxOutputBytes }) {
  const launcher = ({ workerPath, stdio, sandboxProfile }) => {
    assertIsolationProfile({ profile: sandboxProfile, maxOutputBytes })
    const args = [
      "--as=268435456:268435456",
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
    const child = spawn(prlimit.path, args, createSandboxSpawnOptions({ stdio }))
    writeSeccompFilter({
      child,
      filter: buildScenarioSeccompFilter(),
    })
    return child
  }
  launcher.isolationAttestation = Object.freeze({
    level: "os",
    ...REQUIRED_SANDBOX_PROFILE,
    maxOutputBytes,
    bwrapSha256: bwrap.sha256,
    prlimitSha256: prlimit.sha256,
  })
  return launcher
}

export function createLinuxBubblewrapSandboxLauncher({
  platform = process.platform,
  arch = process.arch,
  repositoryRoot = fileURLToPath(new URL("../../../../..", import.meta.url)),
  nodeExecutable = process.execPath,
  bwrapPath = "/usr/bin/bwrap",
  prlimitPath = "/usr/bin/prlimit",
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  spawn = spawnNative,
  execFileSync = execFileSyncNative,
  existsSync = existsSyncNative,
  realpathSync = realpathSyncNative,
  statSync = statSyncNative,
  readFileSync = readFileSyncNative,
  verifyExecutable,
} = {}) {
  if (platform !== "linux") {
    throw new Error("The trusted Bubblewrap scenario sandbox is supported only on Linux")
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("Sandbox maximum output bytes must be a positive safe integer")
  }
  const verify = verifyExecutable ?? (({ path }) => verifyTrustedExecutable({
    path,
    realpathSync,
    statSync,
    readFileSync,
  }))
  const bwrap = resolveTrustedExecutable({
    candidates: [bwrapPath, "/bin/bwrap"],
    existsSync,
    verifyExecutable: verify,
  })
  const prlimit = resolveTrustedExecutable({
    candidates: [prlimitPath, "/bin/prlimit"],
    existsSync,
    verifyExecutable: verify,
  })
  verifySandboxTools({ bwrap, prlimit, execFileSync })
  syscallNumbers({ arch })
  const resolvedRepositoryRoot = realpathSync(resolve(repositoryRoot))
  const resolvedNodeExecutable = realpathSync(nodeExecutable)
  return createLinuxLauncher({
    bwrap,
    prlimit,
    repositoryRoot: resolvedRepositoryRoot,
    nodeExecutable: resolvedNodeExecutable,
    spawn,
    existsSync,
    realpathSync,
    maxOutputBytes,
  })
}
