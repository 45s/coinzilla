import { access, appendFile, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  assertFileMissing,
  createFixture,
} from "./test-support.js"

test("retains newest verified pairs and preserves corrupt, unrelated, and orphan files", async (t) => {
  const dates = [
    new Date("2026-11-20T01:00:00.000Z"),
    new Date("2026-11-20T02:00:00.000Z"),
    new Date("2026-11-20T03:00:00.000Z"),
    new Date("2026-11-20T04:00:00.000Z"),
  ]
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
  ]
  const fixture = await createFixture({ testContext: t,
    now: () => dates.shift(),
    createId: () => ids.shift(),
  })
  const first = await fixture.service.createBackup()
  await appendFile(first.backupFilename, "tampered")
  const second = await fixture.service.createBackup()
  const notesFilename = path.join(fixture.backupDirectory, "operator-notes.txt")
  const orphanFilename = path.join(fixture.backupDirectory, "orphan.sqlite")
  await writeFile(notesFilename, "keep")
  await writeFile(orphanFilename, "not a managed backup pair")
  const third = await fixture.service.createBackup()
  const fourth = await fixture.service.createBackup({
    keep: 2,
  })

  await access(first.backupFilename)
  await access(first.manifestFilename)
  await assertFileMissing(second.backupFilename)
  await assertFileMissing(second.manifestFilename)
  await access(third.backupFilename)
  await access(third.manifestFilename)
  await access(fourth.backupFilename)
  await access(fourth.manifestFilename)
  await access(notesFilename)
  await access(orphanFilename)
})
