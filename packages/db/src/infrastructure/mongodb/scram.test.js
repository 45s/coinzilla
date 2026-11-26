import assert from "node:assert/strict"
import { createHash, createHmac, pbkdf2Sync } from "node:crypto"
import test from "node:test"

import { authenticateMongoScram } from "./scram.js"

function parseAttributes(value) {
  return Object.fromEntries(value.split(",").map((item) => {
    const separator = item.indexOf("=")
    return [item.slice(0, separator), item.slice(separator + 1)]
  }))
}

function createServerFinal({ password, username, authMessage, salt, iterations, mechanism }) {
  const passwordDigest = mechanism === "SCRAM-SHA-1"
    ? createHash("md5").update(`${username}:mongo:${password}`).digest("hex")
    : password.normalize("NFKC")
  const hash = mechanism === "SCRAM-SHA-1" ? "sha1" : "sha256"
  const length = mechanism === "SCRAM-SHA-1" ? 20 : 32
  const saltedPassword = pbkdf2Sync(passwordDigest, salt, iterations, length, hash)
  const serverKey = createHmac(hash, saltedPassword).update("Server Key").digest()
  return createHmac(hash, serverKey).update(authMessage).digest("base64")
}

function createScramServer({ password, username, mechanism = "SCRAM-SHA-256", tamperSignature = false }) {
  let clientFirstBare
  let serverFirst
  let authMessage
  const salt = Buffer.from("test-salt")
  const iterations = 4096

  return {
    async command({ body }) {
      if (body.saslStart === 1) {
        const clientFirst = body.payload.toString("utf8")
        clientFirstBare = clientFirst.slice(3)
        const attributes = parseAttributes(clientFirstBare)
        serverFirst = `r=${attributes.r}servernonce,s=${salt.toString("base64")},i=${iterations}`
        return {
          ok: 1,
          conversationId: 7,
          done: false,
          payload: Buffer.from(serverFirst),
        }
      }

      if (body.saslContinue === 1) {
        const clientFinal = body.payload.toString("utf8")
        const proofSeparator = clientFinal.lastIndexOf(",p=")
        const clientFinalWithoutProof = clientFinal.slice(0, proofSeparator)
        authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`
        const signature = createServerFinal({
          password,
          username,
          authMessage,
          salt,
          iterations,
          mechanism,
        })
        return {
          ok: 1,
          conversationId: 7,
          done: true,
          payload: Buffer.from(`v=${tamperSignature ? "AAAA" : signature}`),
        }
      }

      throw new Error("Unexpected SCRAM command")
    },
  }
}

test("SCRAM-SHA-256 authenticates and verifies the server signature", async () => {
  const command = createScramServer({
    username: "alice",
    password: "correct horse battery staple",
  })

  await authenticateMongoScram({
    command: command.command,
    username: "alice",
    password: "correct horse battery staple",
    authSource: "admin",
    mechanism: "SCRAM-SHA-256",
    randomBytes: () => Buffer.from("client-nonce"),
  })
})

test("SCRAM-SHA-1 uses MongoDB's legacy password digest", async () => {
  const command = createScramServer({
    username: "alice",
    password: "legacy-password",
    mechanism: "SCRAM-SHA-1",
  })

  await authenticateMongoScram({
    command: command.command,
    username: "alice",
    password: "legacy-password",
    authSource: "admin",
    mechanism: "SCRAM-SHA-1",
    randomBytes: () => Buffer.from("client-nonce"),
  })
})

test("SCRAM rejects an invalid server signature and malformed nonce", async () => {
  const invalidSignature = createScramServer({
    username: "alice",
    password: "secret",
    tamperSignature: true,
  })
  await assert.rejects(
    authenticateMongoScram({
      command: invalidSignature.command,
      username: "alice",
      password: "secret",
      randomBytes: () => Buffer.from("nonce"),
    }),
    /server signature/i,
  )

  const malformedNonce = {
    async command() {
      return {
        ok: 1,
        conversationId: 1,
        done: false,
        payload: Buffer.from("r=wrong,s=c2FsdA==,i=4096"),
      }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: malformedNonce.command,
      username: "alice",
      password: "secret",
      randomBytes: () => Buffer.from("nonce"),
    }),
    /nonce/i,
  )
})

test("SCRAM rejects unsupported mechanisms and unsafe iteration counts", async () => {
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alice",
      password: "secret",
      mechanism: "PLAIN",
    }),
    /unsupported.*mechanism/i,
  )

  const weakIterations = {
    async command() {
      return {
        ok: 1,
        conversationId: 1,
        done: false,
        payload: Buffer.from("r=nonce-server,s=c2FsdA==,i=1"),
      }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: weakIterations.command,
      username: "alice",
      password: "secret",
      randomBytes: () => Buffer.from("nonce"),
    }),
    /iteration/i,
  )
})


test("SCRAM-SHA-256 rejects passwords outside the explicitly supported SASLprep subset", async () => {
  for (const password of ["pässword", "password\u0001"]) {
    const server = createScramServer({ username: "alice", password })
    await assert.rejects(
      authenticateMongoScram({
        command: server.command,
        username: "alice",
        password,
        mechanism: "SCRAM-SHA-256",
        randomBytes: () => Buffer.from("nonce"),
      }),
      /ASCII|SASLprep|prohibited/i,
    )
  }
})
