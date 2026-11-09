import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"
import { readHarvesterJournalHistory } from "./read-harvester-journal-history.js"

async function writeJournalSession({ directory, startedAt, runtimeSessionId, eventName }) {
  await mkdir(directory, { recursive: true })
  const eventBus = new EventBus()
  const journal = new Journal({
    eventBus,
    directory,
    sessionIdentity: { startedAt, runtimeSessionId },
  })
  try {
    const started = await journal.start()
    assert.equal(started.ok, true, "Each fixture Journal must acquire its own directory and create a session before publishing")
    const published = eventBus.publish({
      name: eventName,
      source: "harvester",
      data: { runtimeSessionId },
    })
    assert.equal(published.ok, true, "Each fixture lifecycle event must be accepted before the Journal is closed")
    const closed = await journal.close()
    assert.equal(closed.ok, true, "Each fixture Journal must durably close before history is read")
  } finally {
    await journal.close()
    await eventBus.close()
  }
}

test("reads legacy flat Journal sessions and new per-process folders in chronological group order", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-history-"))
  const legacyIdentity = {
    startedAt: "2026-11-08T12:00:00.000Z",
    runtimeSessionId: "legacy-run",
  }
  const currentIdentity = {
    startedAt: "2026-11-09T12:00:00.000Z",
    runtimeSessionId: "current-run",
  }
  const currentSessionDirectory = path.join(rootDirectory, "sessions", "2026-11-09_12-00-00-current-run")

  try {
    await writeJournalSession({
      directory: rootDirectory,
      ...legacyIdentity,
      eventName: "harvester.legacy_session",
    })
    await writeJournalSession({
      directory: currentSessionDirectory,
      ...currentIdentity,
      eventName: "harvester.current_session",
    })

    const result = await readHarvesterJournalHistory({ directory: rootDirectory })
    assert.equal(result.ok, true, "The Harvester history reader must validate legacy and nested Journal sessions together")
    assert.deepEqual(
      result.records.map((record) => record.payload.name),
      ["harvester.legacy_session", "harvester.current_session"],
      "Legacy flat history must remain readable before newer per-process session directories",
    )
    assert.equal(result.count, 2, "The combined history count must include every validated record from both layouts")
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("reports a missing Journal history root without silently returning empty history", async () => {
  const missingDirectory = path.join(os.tmpdir(), "harvester-journal-history-missing")
  const result = await readHarvesterJournalHistory({ directory: missingDirectory })

  assert.equal(result.ok, false, "A missing history root must remain an explicit read failure rather than appear as an empty Journal")
  assert.equal(result.errors[0].code, "JOURNAL_DIRECTORY_NOT_FOUND", "The history reader must preserve the Journal's stable missing-directory diagnostic")
})
