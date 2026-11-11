import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"
import { mapHarvesterProcessStartedData } from "../../application/events/lifecycle-event-dtos.js"
import { readHarvesterJournalHistory } from "./read-harvester-journal-history.js"

function processStartedData({ startedAt, runtimeSessionId, processId }) {
  const result = mapHarvesterProcessStartedData({
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId,
    processId,
    startedAt,
    source: {
      branch: null,
      commit: null,
      shortCommit: null,
      commitMessage: null,
      commitDate: null,
      workingTree: "unknown",
      metadataSource: "unavailable",
    },
  })
  assert.equal(result.ok, true, "The process-start fixture must use the production DTO contract")
  return result.data
}

async function writeJournalSession({
  directory,
  startedAt,
  runtimeSessionId,
  processId,
  eventName,
}) {
  await mkdir(directory, { recursive: true })
  const eventBus = new EventBus()
  const journal = new Journal({
    eventBus,
    directory,
    sessionIdentity: { startedAt, runtimeSessionId },
  })
  try {
    const started = await journal.start()
    assert.equal(started.ok, true, "Each fixture Journal must acquire its own directory and create a session")
    const processStarted = eventBus.publish({
      name: "harvester.process_started",
      source: "harvester",
      data: processStartedData({ startedAt, runtimeSessionId, processId }),
    })
    assert.equal(processStarted.ok, true, "The canonical process-start fact must be accepted")
    const marker = eventBus.publish({
      name: eventName,
      source: "harvester",
      data: { runtimeSessionId },
    })
    assert.equal(marker.ok, true, "Each fixture lifecycle event must be accepted")
    const closed = await journal.close()
    assert.equal(closed.ok, true, "Each fixture Journal must durably close before history is read")
  } finally {
    await journal.close()
    await eventBus.close()
  }
}

async function writeLegacyFlatSession({ directory, fileName, id, timestamp, eventName = "harvester.legacy_session" }) {
  await mkdir(directory, { recursive: true })
  const event = {
    id,
    timestamp,
    source: "harvester",
    name: eventName,
    data: {},
  }
  await writeFile(path.join(directory, fileName), JSON.stringify(event) + "\n")
}

test("recursively discovers nested process sessions together with legacy flat files", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-nested-"))
  const nestedSessionDirectory = path.join(
    rootDirectory,
    "sessions",
    "archive",
    "2026-11-09_12-00-00-current-run",
  )

  try {
    await writeJournalSession({
      directory: rootDirectory,
      startedAt: "2026-11-08T12:00:00.000Z",
      runtimeSessionId: "legacy-run",
      processId: 1000,
      eventName: "harvester.legacy_session",
    })
    await writeJournalSession({
      directory: nestedSessionDirectory,
      startedAt: "2026-11-09T12:00:00.500Z",
      runtimeSessionId: "current-run",
      processId: 1001,
      eventName: "harvester.current_session",
    })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, true, "The root scan must discover every nested process directory and legacy flat file")
    assert.deepEqual(
      result.records.map((record) => record.payload.name),
      [
        "harvester.process_started",
        "harvester.legacy_session",
        "harvester.process_started",
        "harvester.current_session",
      ],
      "Legacy flat history and nested process history must be returned in validated chronological order",
    )
    assert.equal(result.count, 4)
    assert.equal(result.sessions.length, 2)
    assert.deepEqual(
      result.sessions.map((session) => session.chronologySource),
      ["PROCESS_STARTED", "PROCESS_STARTED"],
    )
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("orders same-second process sessions by millisecond process-start evidence, never by runtime session ID", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-same-second-"))

  try {
    await writeJournalSession({
      directory: path.join(rootDirectory, "sessions", "2026-11-09_12-00-00-z-session"),
      startedAt: "2026-11-09T12:00:00.100Z",
      runtimeSessionId: "z-session",
      processId: 1002,
      eventName: "harvester.earlier_session",
    })
    await writeJournalSession({
      directory: path.join(rootDirectory, "sessions", "2026-11-09_12-00-00-a-session"),
      startedAt: "2026-11-09T12:00:00.900Z",
      runtimeSessionId: "a-session",
      processId: 1003,
      eventName: "harvester.later_session",
    })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, true, "Unique process-start evidence must establish chronology for same-second folders")
    assert.deepEqual(
      result.records
        .filter((record) => record.payload.name.endsWith("_session"))
        .map((record) => record.payload.name),
      ["harvester.earlier_session", "harvester.later_session"],
      "The later process must not move earlier merely because its random session ID sorts first",
    )
    assert.deepEqual(
      result.sessions.map((session) => session.runtimeSessionId),
      ["z-session", "a-session"],
    )
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("rejects multiple legacy sessions when their durable event chronology is ambiguous", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-ambiguous-"))

  try {
    await writeLegacyFlatSession({
      directory: rootDirectory,
      fileName: "2026-11-08_12-00-00.jsonl",
      id: "legacy-one",
      timestamp: "2026-11-08T12:00:00.000Z",
    })
    await writeLegacyFlatSession({
      directory: rootDirectory,
      fileName: "2026-11-09_12-00-00.jsonl",
      id: "legacy-two",
      timestamp: "2026-11-08T12:00:00.000Z",
    })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, false, "Second-resolution filenames must not resolve an equal event-time tie")
    assert.equal(result.errors[0].code, "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("preserves compatibility for a single legacy flat session without process-start metadata", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-legacy-single-"))

  try {
    await writeLegacyFlatSession({
      directory: rootDirectory,
      fileName: "2026-11-08_12-00-00.jsonl",
      id: "legacy-only",
      timestamp: "2026-11-08T12:00:00.000Z",
    })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, true)
    assert.deepEqual(result.records.map((record) => record.id), ["legacy-only"])
    assert.equal(result.sessions.length, 1)
    assert.equal(result.sessions[0].chronologySource, "SINGLE_SESSION")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("rejects duplicate record identities across separate session directories", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-duplicate-"))

  try {
    await writeLegacyFlatSession({
      directory: rootDirectory,
      fileName: "2026-11-08_12-00-00.jsonl",
      id: "shared-record-id",
      timestamp: "2026-11-08T12:00:00.000Z",
    })
    await writeJournalSession({
      directory: path.join(rootDirectory, "sessions", "2026-11-09_12-00-00-current-run"),
      startedAt: "2026-11-09T12:00:00.500Z",
      runtimeSessionId: "current-run",
      processId: 1004,
      eventName: "harvester.current_session",
    })

    const nestedJournalFile = path.join(
      rootDirectory,
      "sessions",
      "2026-11-09_12-00-00-current-run",
      "2026-11-09_12-00-00-current-run.jsonl",
    )
    const duplicateEvent = {
      id: "shared-record-id",
      timestamp: "2026-11-09T12:00:00.600Z",
      source: "harvester",
      name: "harvester.duplicate",
      data: {},
    }
    await writeFile(nestedJournalFile, JSON.stringify(duplicateEvent) + "\n", { flag: "a" })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "JOURNAL_DUPLICATE_RECORD_ID")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("rejects a discovered process directory with no Journal session file", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-missing-session-"))
  const missingSessionDirectory = path.join(rootDirectory, "sessions", "2026-11-09_12-00-00-missing-run")

  try {
    await mkdir(missingSessionDirectory, { recursive: true })
    await writeFile(path.join(missingSessionDirectory, "harvester.log"), "process log without journal evidence\n")

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, false, "A discovered process folder without its expected Journal file must not vanish from the scan")
    assert.equal(result.errors[0].code, "HARVESTER_JOURNAL_SESSION_MISSING")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("rejects symbolic links in the session tree instead of silently skipping unreadable history", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-symlink-"))
  const targetDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-target-"))

  try {
    await symlink(targetDirectory, path.join(rootDirectory, "sessions-link"), "dir")
    await mkdir(path.join(rootDirectory, "sessions"), { recursive: true })
    await symlink(targetDirectory, path.join(rootDirectory, "sessions", "linked-session"), "dir")

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
    await rm(targetDirectory, { recursive: true, force: true })
  }
})

test("accepts the sessions directory itself as a scan root and does not return a false empty history", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-sessions-root-"))
  const sessionsDirectory = path.join(rootDirectory, "sessions")

  try {
    await writeJournalSession({
      directory: path.join(sessionsDirectory, "2026-11-09_12-00-00-session-root"),
      startedAt: "2026-11-09T12:00:00.500Z",
      runtimeSessionId: "session-root",
      processId: 1005,
      eventName: "harvester.session_root",
    })

    const result = await readHarvesterJournalHistory({ directory: sessionsDirectory })
    assert.equal(result.ok, true)
    assert.equal(result.count, 2)
    assert.deepEqual(
      result.records.map((record) => record.payload.name),
      ["harvester.process_started", "harvester.session_root"],
    )
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})
