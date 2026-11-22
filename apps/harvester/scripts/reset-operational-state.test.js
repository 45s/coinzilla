import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runHarvesterOperationalStateReset } from "./reset-operational-state.js"

async function createResetFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-reset-test-"))
  const recoveryFactsDirectory = path.join(root, "recovery-facts")
  const logsDirectory = path.join(root, "logs")
  const dataDirectory = path.join(root, "data")
  const journalFile = path.join(logsDirectory, "sessions", "session-1", "journal.jsonl")
  const archiveFile = path.join(root, "archive-output", "published", "manifest.json")
  const lockDirectory = path.join(root, "process-locks")
  await Promise.all([
    mkdir(recoveryFactsDirectory, { recursive: true }),
    mkdir(logsDirectory, { recursive: true }),
    mkdir(dataDirectory, { recursive: true }),
    mkdir(path.dirname(journalFile), { recursive: true }),
    mkdir(path.dirname(archiveFile), { recursive: true }),
    mkdir(lockDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(recoveryFactsDirectory, "facts.jsonl"), "old facts"),
    writeFile(path.join(logsDirectory, "terminal.log"), "keep logs"),
    writeFile(path.join(dataDirectory, "harvester.db"), "keep database"),
    writeFile(journalFile, "keep journal"),
    writeFile(archiveFile, "keep archive"),
  ])
  return {
    root,
    recoveryFactsDirectory,
    logsDirectory,
    dataDirectory,
    journalFile,
    archiveFile,
    lockDirectory,
  }
}

function createResetArguments({ fixture, overrides = {} } = {}) {
  return {
    args: ["--confirm"],
    env: {
      TRADING_MODE: "testnet",
      OPERATIONAL_STATE_DIRECTORY: fixture.recoveryFactsDirectory,
    },
    lockDirectory: fixture.lockDirectory,
    ...overrides,
  }
}

test("resets only the configured recovery-facts directory", async (t) => {
  const fixture = await createResetFixture()
  t.after(() => rm(fixture.root, {
      recursive: true,
      force: true,
    }))

  const result = await runHarvesterOperationalStateReset(createResetArguments({ fixture }))

  assert.equal(result.removed, true, "The confirmed reset must remove the configured recovery-facts directory.")
  await assert.rejects(
    readdir(fixture.recoveryFactsDirectory),
    { code: "ENOENT" },
    "The old recovery-facts directory must be absent after reset.",
  )
  assert.equal(
    await readFile(path.join(fixture.logsDirectory, "terminal.log"), "utf8"),
    "keep logs",
    "Reset must preserve all existing logs.",
  )
  assert.equal(
    await readFile(path.join(fixture.dataDirectory, "harvester.db"), "utf8"),
    "keep database",
    "Reset must preserve the database and all data.",
  )
})

test("refuses reset while any Harvester process lock exists", async (t) => {
  const fixture = await createResetFixture()
  t.after(() => rm(fixture.root, {
    recursive: true,
    force: true,
  }))
  await writeFile(path.join(fixture.lockDirectory, ".harvester-trading-test.lock"), "active process")

  await assert.rejects(
    runHarvesterOperationalStateReset(createResetArguments({ fixture })),
    /process lock exists/i,
    "The reset must fail closed while a Harvester process lock is present.",
  )
  assert.equal(
    await readFile(path.join(fixture.recoveryFactsDirectory, "facts.jsonl"), "utf8"),
    "old facts",
    "A refused reset must leave recovery facts untouched.",
  )
})

test("requires explicit confirmation and TESTNET mode before deleting anything", async (t) => {
  const fixture = await createResetFixture()
  t.after(() => rm(fixture.root, {
    recursive: true,
    force: true,
  }))

  await assert.rejects(
    runHarvesterOperationalStateReset(createResetArguments({ fixture, overrides: { args: [] } })),
    /--confirm/,
    "The reset command must require an explicit destructive-operation confirmation.",
  )
  await assert.rejects(
    runHarvesterOperationalStateReset(createResetArguments({
      fixture,
      overrides: {
        env: {
          ...createResetArguments({ fixture }).env,
          TRADING_MODE: "live",
        },
      },
    })),
    /TRADING_MODE=testnet/,
    "The reset command must reject LIVE mode.",
  )
  assert.equal(
    await readFile(path.join(fixture.recoveryFactsDirectory, "facts.jsonl"), "utf8"),
    "old facts",
    "Invalid or unconfirmed reset requests must not change the recovery-facts directory.",
  )
})


test("refuses to reset when the configured recovery-facts directory is missing", async (t) => {
  const fixture = await createResetFixture()
  t.after(() => rm(fixture.root, {
    recursive: true,
    force: true,
  }))
  await rm(fixture.recoveryFactsDirectory, { recursive: true })

  await assert.rejects(
    runHarvesterOperationalStateReset(createResetArguments({ fixture })),
    /does not exist/i,
  )
  assert.equal(
    await readFile(path.join(fixture.logsDirectory, "terminal.log"), "utf8"),
    "keep logs",
  )
  assert.equal(
    await readFile(path.join(fixture.dataDirectory, "harvester.db"), "utf8"),
    "keep database",
  )
})

test("refuses a symlink as the recovery-facts reset target", async (t) => {
  const fixture = await createResetFixture()
  t.after(() => rm(fixture.root, {
    recursive: true,
    force: true,
  }))
  const actualDirectory = path.join(fixture.root, "actual-recovery-facts")
  await mkdir(actualDirectory)
  await writeFile(path.join(actualDirectory, "facts.jsonl"), "protected facts")
  await rm(fixture.recoveryFactsDirectory, { recursive: true })
  await symlink(actualDirectory, fixture.recoveryFactsDirectory, "junction")

  await assert.rejects(
    runHarvesterOperationalStateReset(createResetArguments({ fixture })),
    /symbolic link/i,
    "The reset must not follow a symbolic link to another directory.",
  )
  assert.equal(
    await readFile(path.join(actualDirectory, "facts.jsonl"), "utf8"),
    "protected facts",
    "A symlink refusal must preserve the real target directory.",
  )
})
