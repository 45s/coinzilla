import assert from "node:assert/strict"
import test from "node:test"
import {
  initializePrivateArchiveRepository,
  validateArchiveRemote,
} from "./initialize-private-archive-repository.js"

test("accepts HTTPS and SSH GitHub remotes without embedded credentials", () => {
  assert.equal(
    validateArchiveRemote("https://github.com/45s/harvester-archives.git"),
    "https://github.com/45s/harvester-archives.git",
  )
  assert.equal(
    validateArchiveRemote("git@github.com:45s/harvester-archives.git"),
    "git@github.com:45s/harvester-archives.git",
  )
  assert.equal(
    validateArchiveRemote("ssh://git@github.com/45s/harvester-archives.git"),
    "ssh://git@github.com/45s/harvester-archives.git",
  )
})

test("rejects missing, non-GitHub, malformed, and credential-bearing remotes", () => {
  for (const remote of [
    undefined,
    "",
    " https://github.com/45s/harvester-archives.git",
    "https://user:token@github.com/45s/harvester-archives.git",
    "https://example.com/45s/harvester-archives.git",
    "https://github.com/45s",
  ]) {
    assert.throws(() => validateArchiveRemote(remote), /HARVESTER_ARCHIVE_REMOTE/)
  }
})

test("initializes an empty remote with a tracked archives placeholder and pushes main", async () => {
  const calls = []
  const writes = []
  const directories = []
  const removed = []
  const result = await initializePrivateArchiveRepository({
    env: { HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/harvester-archives.git" },
    createTemporaryDirectory: async () => "/tmp/archive-init-test",
    removeTemporaryDirectory: async (directory) => removed.push(directory),
    createDirectory: async (directory, options) => directories.push({ directory, options }),
    write: async (...args) => writes.push(args),
    runCommand: async (args, options) => {
      calls.push({ args, options })
      return ""
    },
  })

  assert.deepEqual(result, {
    remote: "https://github.com/45s/harvester-archives.git",
    branch: "main",
    initialized: true,
  })
  assert.deepEqual(calls.map(({ args }) => args[0]), [
    "ls-remote", "init", "remote", "add", "-c", "push",
  ])
  assert.deepEqual(calls.at(-1).args, ["push", "--set-upstream", "origin", "main"])
  assert.equal(writes.length, 2)
  assert.ok(writes.some(([filename]) => filename.endsWith("archives/.gitkeep")))
  assert.ok(directories.some(({ directory }) => directory.endsWith("/archives")))
  assert.deepEqual(removed, ["/tmp/archive-init-test"])
})

test("recognizes an existing main branch without modifying the archive repository", async () => {
  const calls = []
  let writeCount = 0
  const removed = []
  const result = await initializePrivateArchiveRepository({
    env: { HARVESTER_ARCHIVE_REMOTE: "git@github.com:45s/coinzilla-archive.git" },
    createTemporaryDirectory: async () => "/tmp/archive-init-test",
    removeTemporaryDirectory: async (directory) => removed.push(directory),
    write: async () => { writeCount += 1 },
    runCommand: async (args) => {
      calls.push(args)
      return "abc123 refs/heads/main"
    },
  })

  assert.deepEqual(result, {
    remote: "git@github.com:45s/coinzilla-archive.git",
    branch: "main",
    initialized: false,
    alreadyInitialized: true,
  })
  assert.deepEqual(calls, [["ls-remote", "--heads", "git@github.com:45s/coinzilla-archive.git"]])
  assert.equal(writeCount, 0)
  assert.deepEqual(removed, ["/tmp/archive-init-test"])
})

test("refuses a remote with refs but no main branch", async () => {
  const calls = []
  let writeCount = 0
  await assert.rejects(
    initializePrivateArchiveRepository({
      env: { HARVESTER_ARCHIVE_REMOTE: "git@github.com:45s/coinzilla-archive.git" },
      createTemporaryDirectory: async () => "/tmp/archive-init-test",
      removeTemporaryDirectory: async () => {},
      write: async () => { writeCount += 1 },
      runCommand: async (args) => {
        calls.push(args)
        return "abc123 refs/heads/develop"
      },
    }),
    /contains unexpected branches/,
  )
  assert.equal(calls.length, 1)
  assert.equal(writeCount, 0)
})

test("cleans its temporary working directory when the push fails", async () => {
  const removed = []
  await assert.rejects(
    initializePrivateArchiveRepository({
      env: { HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/harvester-archives.git" },
      createTemporaryDirectory: async () => "/tmp/archive-init-test",
      removeTemporaryDirectory: async (directory) => removed.push(directory),
      runCommand: async (args) => {
        if (args[0] === "push") {
          throw new Error("permission denied")
        }
        return ""
      },
    }),
    /permission denied/,
  )
  assert.deepEqual(removed, ["/tmp/archive-init-test"])
})
