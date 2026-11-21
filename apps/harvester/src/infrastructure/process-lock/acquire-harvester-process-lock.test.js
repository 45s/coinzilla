import test from "node:test"
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"

const createTempDirectory = () => mkdtemp(path.join(os.tmpdir(), "harvester-process-lock-"))

function createInvalidPathInputs({ directory }) {
  return [
    {
      name: "empty directory",
      input: {
        directory: " ",
      },
      expectedMessage: /non-empty directory/,
    },
    {
      name: "dot lock file name",
      input: {
        directory,
        lockFileName: ".",
      },
      expectedMessage: /file name/,
    },
    {
      name: "dot-dot lock file name",
      input: {
        directory,
        lockFileName: "..",
      },
      expectedMessage: /file name/,
    },
    {
      name: "path traversal lock file name",
      input: {
        directory,
        lockFileName: "../outside.lock",
      },
      expectedMessage: /file name/,
    },
  ]
}

function createInvalidOwnerInputs({ directory }) {
  return [
    {
      name: "invalid process id",
      input: {
        directory,
        pid: 0,
      },
      expectedMessage: /positive safe integer/,
    },
    {
      name: "empty hostname",
      input: {
        directory,
        hostname: " ",
      },
      expectedMessage: /hostname/,
    },
    {
      name: "empty start time",
      input: {
        directory,
        startedAt: " ",
      },
      expectedMessage: /startedAt/,
    },
    {
      name: "empty ownership token",
      input: {
        directory,
        token: " ",
      },
      expectedMessage: /token/,
    },
    {
      name: "invalid process liveness probe",
      input: {
        directory,
        isProcessAlive: null,
      },
      expectedMessage: /isProcessAlive/,
    },
  ]
}

async function assertInvalidProcessLockInput({ invalidInput }) {
  const result = await acquireHarvesterProcessLock(invalidInput.input)
  assert.equal(result.ok, false, `${invalidInput.name} must fail before lock acquisition.`)
  assert.match(
    result.errors[0].message,
    invalidInput.expectedMessage,
    `${invalidInput.name} must report the specific invalid input.`,
  )
}


test("acquires an exclusive lock and releases it idempotently", async () => {
  const directory = await createTempDirectory()
  try {
    const acquired = await acquireHarvesterProcessLock({
      directory,
      pid: 101,
      hostname: "test-host",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "owner-token",
    })
    assert.equal(acquired.ok, true, "Process-lock safety regression: expected acquired.ok to equal true.")
    const owner = JSON.parse(await readFile(acquired.lockPath, "utf8"))
    assert.deepEqual(owner, {
      pid: 101,
      hostname: "test-host",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "owner-token",
    }, "Process-lock safety regression: expected owner to deeply equal {\n      pid: 101,\n      hostname: \"test-host\",\n      startedAt: \"2026-11-05T00:00:00.000Z\",\n      token: \"owner-token\",\n    }.")

    assert.deepEqual(await acquired.release(), { ok: true,
released: true }, "Process-lock safety regression: expected await acquired.release() to deeply equal { ok: true,\nreleased: true }.")
    assert.deepEqual(await acquired.release(), { ok: true,
released: false,
alreadyReleased: true }, "Process-lock safety regression: expected await acquired.release() to deeply equal { ok: true,\nreleased: false,\nalreadyReleased: true }.")
    await assert.rejects(readFile(acquired.lockPath, "utf8"), { code: "ENOENT" }, "Process-lock safety regression: expected readFile(acquired.lockPath, \"utf8\") to reject or throw with { code: \"ENOENT\" }.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects a second trading process without reclaiming the existing lock", async () => {
  const directory = await createTempDirectory()
  try {
    const first = await acquireHarvesterProcessLock({
      directory,
      pid: 111,
      hostname: "test-host",
      token: "first-token",
    })
    const second = await acquireHarvesterProcessLock({
      directory,
      pid: 222,
      hostname: "test-host",
      token: "second-token",
      isProcessAlive: () => true,
    })

    assert.equal(first.ok, true, "Process-lock safety regression: expected first.ok to equal true.")
    assert.equal(second.ok, false, "Process-lock safety regression: expected second.ok to equal false.")
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected second.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.equal(second.errors[0].details.existingOwner.pid, 111, "Process-lock safety regression: expected second.errors[0].details.existingOwner.pid to equal 111.")
    assert.equal(JSON.parse(await readFile(first.lockPath, "utf8")).token, "first-token", "Process-lock safety regression: expected JSON.parse(await readFile(first.lockPath, \"utf8\")).token to equal \"first-token\".")
    assert.equal((await first.release()).ok, true, "Process-lock safety regression: expected (await first.release()).ok to equal true.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("refuses to remove a lock whose ownership token changed", async () => {
  const directory = await createTempDirectory()
  try {
    const acquired = await acquireHarvesterProcessLock({ directory,
token: "original-token" })
    await unlink(acquired.lockPath)
    await writeFile(acquired.lockPath, JSON.stringify({
      pid: 999,
      hostname: "replacement",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "replacement-token",
    }))

    const released = await acquired.release()
    assert.equal(released.ok, false, "Process-lock safety regression: expected released.ok to equal false.")
    assert.equal(released.errors[0].code, "HARVESTER_PROCESS_LOCK_OWNERSHIP_MISMATCH", "Process-lock safety regression: expected released.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_OWNERSHIP_MISMATCH\".")
    assert.equal(JSON.parse(await readFile(acquired.lockPath, "utf8")).token, "replacement-token", "Process-lock safety regression: expected JSON.parse(await readFile(acquired.lockPath, \"utf8\")).token to equal \"replacement-token\".")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("does not reclaim locks owned by another host or unreadable locks", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 1,
      hostname: "old-host",
      startedAt: "2020-01-01T00:00:00.000Z",
      token: "stale-token",
    }))
    const result = await acquireHarvesterProcessLock({ directory })
    assert.equal(result.ok, false, "Process-lock safety regression: expected result.ok to equal false.")
    assert.equal(result.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected result.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "stale-token", "Process-lock safety regression: expected JSON.parse(await readFile(lockPath, \"utf8\")).token to equal \"stale-token\".")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("reclaims a same-host lock only when its recorded process is confirmed dead", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 456789,
      hostname: os.hostname(),
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "dead-owner-token",
    }))

    const result = await acquireHarvesterProcessLock({
      directory,
      pid: 987,
      hostname: os.hostname(),
      token: "new-owner-token",
      isProcessAlive: () => false,
    })

    assert.equal(result.ok, true, "Process-lock safety regression: expected result.ok to equal true.")
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "new-owner-token", "Process-lock safety regression: expected JSON.parse(await readFile(lockPath, \"utf8\")).token to equal \"new-owner-token\".")
    assert.equal((await result.release()).ok, true, "Process-lock safety regression: expected (await result.release()).ok to equal true.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("retains a same-host lock when its recorded process may still be alive", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 456,
      hostname: os.hostname(),
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "live-owner-token",
    }))

    const result = await acquireHarvesterProcessLock({
      directory,
      pid: 987,
      hostname: os.hostname(),
      isProcessAlive: () => true,
    })

    assert.equal(result.ok, false, "Process-lock safety regression: expected result.ok to equal false.")
    assert.equal(result.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected result.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "live-owner-token", "Process-lock safety regression: expected JSON.parse(await readFile(lockPath, \"utf8\")).token to equal \"live-owner-token\".")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects invalid process lock inputs", async () => {
  const directory = await createTempDirectory()
  try {
    for (const invalidInput of [
      ...createInvalidPathInputs({ directory }),
      ...createInvalidOwnerInputs({ directory }),
    ]) {
      await assertInvalidProcessLockInput({
        invalidInput,
      })
    }
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("allows exactly one owner when two processes race to acquire the same lock", async () => {
  const directory = await createTempDirectory()
  try {
    const results = await Promise.all([
      acquireHarvesterProcessLock({ directory,
pid: 301,
hostname: "race-host",
token: "race-token-a",
isProcessAlive: () => true }),
      acquireHarvesterProcessLock({ directory,
pid: 302,
hostname: "race-host",
token: "race-token-b",
isProcessAlive: () => true }),
    ])
    const owners = results.filter((result) => result.ok)
    const conflicts = results.filter((result) => !result.ok)

    assert.equal(owners.length, 1, "Process-lock safety regression: expected owners.length to equal 1.")
    assert.equal(conflicts.length, 1, "Process-lock safety regression: expected conflicts.length to equal 1.")
    assert.equal(conflicts[0].errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected conflicts[0].errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.equal(JSON.parse(await readFile(owners[0].lockPath, "utf8")).token, owners[0].owner.token, "Process-lock safety regression: expected JSON.parse(await readFile(owners[0].lockPath, \"utf8\")).token to equal owners[0].owner.token.")
    assert.equal((await owners[0].release()).ok, true, "Process-lock safety regression: expected (await owners[0].release()).ok to equal true.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("does not reclaim a malformed lock file", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  try {
    await writeFile(lockPath, "{malformed")
    const result = await acquireHarvesterProcessLock({
      directory,
      pid: 987,
      hostname: os.hostname(),
      token: "new-owner-token",
      isProcessAlive: () => false,
    })

    assert.equal(result.ok, false, "An unreadable lock must remain a hard ownership conflict.")
    assert.equal(result.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected result.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.equal(await readFile(lockPath, "utf8"), "{malformed", "The unreadable lock must not be deleted or replaced.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("treats a missing lock file as an idempotent release", async () => {
  const directory = await createTempDirectory()
  try {
    const acquired = await acquireHarvesterProcessLock({
      directory,
      token: "released-owner-token",
    })
    await unlink(acquired.lockPath)

    const released = await acquired.release()
    assert.deepEqual(
      released,
      {
        ok: true,
        released: false,
        alreadyReleased: true,
      },
      "A lock already removed by the operating system must be reported as already released.",
    )
    assert.deepEqual(await acquired.release(), released, "Repeated release after external removal must remain idempotent.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("does not remove a replacement lock after a stale-owner race", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  const replacementOwner = {
    pid: 999,
    hostname: "replacement-host",
    startedAt: "2026-11-05T00:00:00.000Z",
    token: "replacement-token",
  }
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 456,
      hostname: os.hostname(),
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "stale-owner-token",
    }))

    const result = await acquireHarvesterProcessLock({
      directory,
      pid: 987,
      hostname: os.hostname(),
      token: "new-owner-token",
      isProcessAlive: () => {
        writeFileSync(lockPath, JSON.stringify(replacementOwner))
        return false
      },
    })

    assert.equal(result.ok, false, "A replacement owner discovered by the pre-unlink re-read must keep the lock.")
    assert.equal(result.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Process-lock safety regression: expected result.errors[0].code to equal \"HARVESTER_PROCESS_LOCK_EXISTS\".")
    assert.deepEqual(
      JSON.parse(await readFile(lockPath, "utf8")),
      replacementOwner,
      "The lock contents changed by the racing owner must be preserved byte-for-byte as the current owner.",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
