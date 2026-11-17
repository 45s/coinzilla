import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { discoverHarvesterJournalSessions } from "./discover-harvester-journal-sessions.js"

async function createRoot(t, suffix) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), `harvester-journal-discovery-${suffix}-`))
  t.after(() => rm(rootDirectory, { recursive: true, force: true }))
  return rootDirectory
}

async function createSession(directory, fileName = "events.jsonl") {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, fileName), "{}\n")
}

async function assertDiscoveryError(promise, code, message) {
  await assert.rejects(
    promise,
    (error) => error.code === code,
    message,
  )
}

test("discovers flat root files and recursively nested sessions with deterministic order", async (t) => {
  const rootDirectory = await createRoot(t, "flat-and-nested")
  const sessionsRoot = path.join(rootDirectory, "sessions")
  await writeFile(path.join(rootDirectory, "flat.jsonl"), "{}\n")
  await createSession(sessionsRoot, "root.jsonl")
  await createSession(path.join(sessionsRoot, "nested-z"))
  await createSession(path.join(sessionsRoot, "nested-a"))

  const result = await discoverHarvesterJournalSessions({
    rootDirectory,
    maxDirectories: 10,
    maxSessions: 10,
  })

  assert.deepEqual(
    result.sessionDirectories.map(({ directory, fileNames }) => ({
      directory,
      fileNames,
    })),
    [
      {
        directory: rootDirectory,
        fileNames: ["flat.jsonl"],
      },
      {
        directory: sessionsRoot,
        fileNames: ["root.jsonl"],
      },
      {
        directory: path.join(sessionsRoot, "nested-a"),
        fileNames: ["events.jsonl"],
      },
      {
        directory: path.join(sessionsRoot, "nested-z"),
        fileNames: ["events.jsonl"],
      },
    ],
    "Flat and nested Journal sessions must be returned in deterministic directory order.",
  )
  assert.equal(
    result.directoriesVisited,
    3,
    "The bounded walk must count the sessions root and both nested session directories.",
  )
})

test("discovers a sessions root directly and sorts sibling session directories", async (t) => {
  const rootDirectory = path.join(await createRoot(t, "direct-sessions"), "sessions")
  await createSession(path.join(rootDirectory, "z-session"))
  await createSession(path.join(rootDirectory, "a-session"))
  await createSession(path.join(rootDirectory, "m-session"))

  const result = await discoverHarvesterJournalSessions({
    rootDirectory,
    maxDirectories: 10,
    maxSessions: 10,
  })

  assert.deepEqual(
    result.sessionDirectories.map(({ directory }) => path.basename(directory)),
    ["a-session", "m-session", "z-session"],
    "Direct sessions-root traversal must sort sibling directories before descending.",
  )
  assert.equal(result.directoriesVisited, 4, "The traversal count must include the root and each session directory.")
})

test("rejects symbolic links instead of silently omitting session evidence", async (t) => {
  const rootDirectory = await createRoot(t, "symlink")
  const targetDirectory = path.join(rootDirectory, "target")
  const sessionsRoot = path.join(rootDirectory, "sessions")
  await mkdir(targetDirectory)
  await mkdir(sessionsRoot)
  try {
    await symlink(targetDirectory, path.join(sessionsRoot, "linked-session"), "dir")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`Symbolic links are unavailable in this environment: ${error.code}`)
      return
    }
    throw error
  }

  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: sessionsRoot,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "A symbolic link inside the Journal session tree must fail closed.",
  )
})

test("rejects directories masquerading as JSONL files", async (t) => {
  const rootDirectory = await createRoot(t, "invalid-jsonl-entry")
  await mkdir(path.join(rootDirectory, "not-a-file.jsonl"))

  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "A .jsonl directory must not be accepted as a regular Journal file.",
  )
})

test("rejects empty process-session directories and file-bearing session containers", async (t) => {
  const emptyRoot = path.join(await createRoot(t, "empty-session"), "sessions")
  await mkdir(emptyRoot, { recursive: true })
  await mkdir(path.join(emptyRoot, "empty-session"))
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: emptyRoot,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_SESSION_MISSING",
    "A discovered process-session directory without a JSONL record must be reported as missing.",
  )

  const containerRoot = path.join(await createRoot(t, "session-container"), "sessions")
  const containerDirectory = path.join(containerRoot, "container")
  await mkdir(path.join(containerDirectory, "nested"), { recursive: true })
  await writeFile(path.join(containerDirectory, "README.txt"), "not a session record")
  await createSession(path.join(containerDirectory, "nested"))
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: containerRoot,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "A nested session container with unrelated files must not be mistaken for a process session.",
  )
})

test("rejects unexpected files in the sessions root and non-directory sessions paths", async (t) => {
  const sessionsRoot = path.join(await createRoot(t, "unexpected-root-file"), "sessions")
  await mkdir(sessionsRoot)
  await writeFile(path.join(sessionsRoot, "README.txt"), "unexpected")
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: sessionsRoot,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "Unexpected non-JSONL files in the sessions root must make discovery incomplete.",
  )

  const parentRoot = await createRoot(t, "sessions-not-directory")
  await writeFile(path.join(parentRoot, "sessions"), "not a directory")
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: parentRoot,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "A root-level sessions entry must be a real directory, not a regular file.",
  )
})

test("enforces maxDirectories and maxSessions during recursive discovery", async (t) => {
  const directoryRoot = path.join(await createRoot(t, "directory-limit"), "sessions")
  await createSession(path.join(directoryRoot, "child"))
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: directoryRoot,
      maxDirectories: 1,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_LIMIT_EXCEEDED",
    "Recursive discovery must stop before visiting more than maxDirectories.",
  )

  const sessionRoot = path.join(await createRoot(t, "session-limit"), "sessions")
  await createSession(sessionRoot, "first.jsonl")
  await createSession(sessionRoot, "second.jsonl")
  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory: sessionRoot,
      maxDirectories: 10,
      maxSessions: 1,
    }),
    "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
    "Recursive discovery must stop as soon as maxSessions is exceeded.",
  )
})

test("enforces maxSessions for flat root-level history files", async (t) => {
  const rootDirectory = await createRoot(t, "flat-session-limit")
  await writeFile(path.join(rootDirectory, "first.jsonl"), "{}\n")
  await writeFile(path.join(rootDirectory, "second.jsonl"), "{}\n")

  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory,
      maxDirectories: 10,
      maxSessions: 1,
    }),
    "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
    "Flat root-level Journal files must be counted against the same maxSessions bound.",
  )
})

test("rejects root-level directories masquerading as Journal files", async (t) => {
  const rootDirectory = await createRoot(t, "root-invalid-jsonl")
  await mkdir(path.join(rootDirectory, "session.jsonl"))

  await assertDiscoveryError(
    discoverHarvesterJournalSessions({
      rootDirectory,
      maxDirectories: 10,
      maxSessions: 10,
    }),
    "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
    "A root-level .jsonl entry must be a regular file.",
  )
})
