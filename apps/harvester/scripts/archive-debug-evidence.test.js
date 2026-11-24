import assert from "node:assert/strict"
import test from "node:test"
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  decryptDebugBundle,
  encryptDebugBundle,
} from "./archive-debug-evidence.js"

async function createTestDirectory() {
  return mkdtemp(path.join(tmpdir(), "harvester-debug-archive-test-"))
}

test("encrypts and decrypts a debug bundle without exposing plaintext in the archive", async (t) => {
  const directory = await createTestDirectory()
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const source = path.join(directory, "source.tar.gz")
  const encrypted = path.join(directory, "source.tar.gz.enc")
  const decrypted = path.join(directory, "decrypted.tar.gz")
  const original = Buffer.from("journal and recovery-facts forensic fixture")
  await writeFile(source, original)

  await encryptDebugBundle({
    inputFile: source,
    outputFile: encrypted,
    passphrase: "test-only-archive-passphrase",
  })

  const ciphertext = await readFile(encrypted)
  assert.equal(
    ciphertext.includes(original),
    false,
    "encrypted archive must not contain the original plaintext bytes",
  )
  await decryptDebugBundle({
    inputFile: encrypted,
    outputFile: decrypted,
    passphrase: "test-only-archive-passphrase",
  })
  assert.deepEqual(
    await readFile(decrypted),
    original,
    "decryption must recover the exact original archive bytes",
  )
})

test("rejects an incorrect passphrase or modified encrypted archive", async (t) => {
  const directory = await createTestDirectory()
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const source = path.join(directory, "source.tar.gz")
  const encrypted = path.join(directory, "source.tar.gz.enc")
  const decrypted = path.join(directory, "decrypted.tar.gz")
  await writeFile(source, "sensitive evidence")
  await encryptDebugBundle({
    inputFile: source,
    outputFile: encrypted,
    passphrase: "test-only-archive-passphrase",
  })

  await assert.rejects(
    decryptDebugBundle({
      inputFile: encrypted,
      outputFile: decrypted,
      passphrase: "incorrect-test-passphrase",
    }),
    /authenticate|Unsupported state|unable to authenticate/i,
    "a wrong passphrase must fail AES-GCM authentication",
  )
})

test("requires a sufficiently long encryption passphrase", async (t) => {
  const directory = await createTestDirectory()
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const source = path.join(directory, "source.tar.gz")
  const encrypted = path.join(directory, "source.tar.gz.enc")
  await writeFile(source, "evidence")
  await assert.rejects(
    encryptDebugBundle({
      inputFile: source,
      outputFile: encrypted,
      passphrase: "short",
    }),
    /at least 16 characters/,
    "weak archive passphrases must be rejected before encryption",
  )
})
