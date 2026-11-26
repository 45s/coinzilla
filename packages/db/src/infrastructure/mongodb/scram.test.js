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

function createServerFinal({
  password,
  username,
  authMessage,
  salt,
  iterations,
  mechanism,
  clientProof,
}) {
  const passwordDigest = mechanism === "SCRAM-SHA-1"
    ? createHash("md5").update(`${username}:mongo:${password}`).digest("hex")
    : password
  const hash = mechanism === "SCRAM-SHA-1" ? "sha1" : "sha256"
  const length = mechanism === "SCRAM-SHA-1" ? 20 : 32
  const saltedPassword = pbkdf2Sync(passwordDigest, salt, iterations, length, hash)
  const clientKey = createHmac(hash, saltedPassword).update("Client Key").digest()
  const storedKey = createHash(hash).update(clientKey).digest()
  const clientSignature = createHmac(hash, storedKey).update(authMessage).digest()
  const recoveredClientKey = Buffer.alloc(clientProof.length)
  for (let index = 0; index < clientProof.length; index += 1) {
    recoveredClientKey[index] = clientProof[index] ^ clientSignature[index]
  }
  assert.deepEqual(recoveredClientKey, clientKey, "SCRAM client proof must be valid")

  const serverKey = createHmac(hash, saltedPassword).update("Server Key").digest()
  return createHmac(hash, serverKey).update(authMessage).digest("base64")
}

function createScramServer({
  password,
  username,
  mechanism = "SCRAM-SHA-256",
  tamperSignature = false,
  appendInvalidSignatureCharacters = false,
  startResponse = {},
  continueResponse = {},
  serverFirst = null,
}) {
  let clientFirstBare
  let challenge
  const salt = Buffer.from("test-salt")
  const iterations = 4096
  const conversationId = 7

  return {
    async command({ body }) {
      if (body.saslStart === 1) {
        clientFirstBare = body.payload.toString("utf8").slice(3)
        const attributes = parseAttributes(clientFirstBare)
        challenge = serverFirst
          ?? `r=${attributes.r}servernonce,s=${salt.toString("base64")},i=${iterations}`
        return {
          ok: 1,
          conversationId,
          done: false,
          payload: Buffer.from(challenge),
          ...startResponse,
        }
      }

      if (body.saslContinue === 1) {
        const clientFinal = body.payload.toString("utf8")
        const proofSeparator = clientFinal.lastIndexOf(",p=")
        const clientFinalWithoutProof = clientFinal.slice(0, proofSeparator)
        const proof = Buffer.from(clientFinal.slice(proofSeparator + 3), "base64")
        const authMessage = `${clientFirstBare},${challenge},${clientFinalWithoutProof}`
        const signature = createServerFinal({
          password,
          username,
          authMessage,
          salt,
          iterations,
          mechanism,
          clientProof: proof,
        })
        return {
          ok: 1,
          conversationId,
          done: true,
          payload: Buffer.from(`v=${tamperSignature ? "AAAA" : `${signature}${appendInvalidSignatureCharacters ? "!!!!" : ""}`}`),
          ...continueResponse,
        }
      }

      throw new Error("Unexpected SCRAM command")
    },
  }
}

test("SCRAM-SHA-256 validates the client proof and server signature", async () => {
  const server = createScramServer({
    username: "alice",
    password: "correct horse battery staple",
  })
  const command = server.command.bind(server)

  await authenticateMongoScram({
    command,
    username: "alice",
    password: "correct horse battery staple",
    authSource: "admin",
    mechanism: "SCRAM-SHA-256",
    randomBytes: (length) => Buffer.alloc(length, 1),
  })
})

test("SCRAM-SHA-1 uses MongoDB's legacy password digest and proof", async () => {
  const server = createScramServer({
    username: "alice",
    password: "legacy-password",
    mechanism: "SCRAM-SHA-1",
  })

  await authenticateMongoScram({
    command: server.command,
    username: "alice",
    password: "legacy-password",
    authSource: "admin",
    mechanism: "SCRAM-SHA-1",
    randomBytes: (length) => Buffer.alloc(length, 1),
  })
})

test("SCRAM escapes username separators and uses the selected authentication database", async () => {
  const server = createScramServer({
    username: "alice,admin=1",
    password: "secret",
  })
  const originalCommand = server.command.bind(server)
  let firstMessage

  await authenticateMongoScram({
    command: async (input) => {
      assert.equal(input.body.$db, "security")
      if (input.body.saslStart === 1) {
        firstMessage = input.body.payload.toString("utf8")
      }
      return originalCommand(input)
    },
    username: "alice,admin=1",
    password: "secret",
    authSource: "security",
    randomBytes: (length) => Buffer.alloc(length, 1),
  })

  assert.match(firstMessage, /^n,,n=alice=2Cadmin=3D1,r=/)
})

test("SCRAM rejects server errors, invalid signatures, and malformed nonces", async () => {
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
      randomBytes: (length) => Buffer.alloc(length, 1),
    }),
    /server signature/i,
  )

  const malformedSignatureEncoding = createScramServer({
    username: "alice",
    password: "secret",
    appendInvalidSignatureCharacters: true,
  })
  await assert.rejects(
    authenticateMongoScram({
      command: malformedSignatureEncoding.command,
      username: "alice",
      password: "secret",
      randomBytes: (length) => Buffer.alloc(length, 1),
    }),
    /server signature/i,
  )

  const malformedNonce = createScramServer({
    username: "alice",
    password: "secret",
    serverFirst: "r=wrong,s=c2FsdA==,i=4096",
  })
  await assert.rejects(
    authenticateMongoScram({
      command: malformedNonce.command,
      username: "alice",
      password: "secret",
      randomBytes: (length) => Buffer.alloc(length, 1),
    }),
    /nonce/i,
  )

})

test("SCRAM propagates server authentication errors", async () => {
  const serverError = {
    async command() {
      return {
        ok: 0,
        errmsg: "authentication failed",
        code: 18,
      }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: serverError.command,
      username: "alice",
      password: "secret",
    }),
    /authentication failed/,
  )
})

test("SCRAM rejects missing callbacks, credentials, authentication sources, and malformed response fields", async () => {
  await assert.rejects(
    authenticateMongoScram({
      command: null,
      username: "alice",
      password: "secret",
    }),
    /command callback is required/,
  )
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "",
      password: "secret",
    }),
    /non-empty username/,
  )
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alice",
      password: 42,
    }),
    /string password/,
  )
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alice",
      password: "secret",
      authSource: "",
    }),
    /authentication source/,
  )

  const missingConversation = {
    async command() {
      return { ok: 1, done: false, payload: Buffer.alloc(0) }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: missingConversation.command,
      username: "alice",
      password: "secret",
    }),
    /conversation identifier/,
  )

  const nonBinaryPayload = {
    async command() {
      return { ok: 1, conversationId: 1, done: false, payload: "not-binary" }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: nonBinaryPayload.command,
      username: "alice",
      password: "secret",
    }),
    /payload must be binary/,
  )

  const completedAtStart = {
    async command() {
      return { ok: 1, conversationId: 1, done: true, payload: Buffer.alloc(0) }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: completedAtStart.command,
      username: "alice",
      password: "secret",
    }),
    /before client proof/,
  )
})

test("SCRAM rejects unsupported mechanisms, malformed salt, and unsafe iteration counts", async () => {
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alice",
      password: "secret",
      mechanism: "PLAIN",
    }),
    /unsupported.*mechanism/i,
  )

  const nonce = Buffer.alloc(24, 1).toString("base64")
  for (const serverFirst of [
    `r=${nonce}servernonce,s=not-base64!,i=4096`,
    `r=${nonce}servernonce,s=c2FsdA==,i=1`,
    `r=${nonce}servernonce,s=c2FsdA==,i=1000001`,
  ]) {
    const server = createScramServer({
      username: "alice",
      password: "secret",
      serverFirst,
    })
    await assert.rejects(
      authenticateMongoScram({
        command: server.command,
        username: "alice",
        password: "secret",
        randomBytes: (length) => Buffer.alloc(length, 1),
      }),
      /salt|iteration/i,
    )
  }
})

test("SCRAM rejects non-ASCII/control credentials and invalid random sources", async () => {
  for (const password of ["pässword", "password\u0001"]) {
    const server = createScramServer({ username: "alice",
password })
    await assert.rejects(
      authenticateMongoScram({
        command: server.command,
        username: "alice",
        password,
        mechanism: "SCRAM-SHA-256",
        randomBytes: (length) => Buffer.alloc(length, 1),
      }),
      /printable ASCII only/,
    )
  }

  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alíce",
      password: "secret",
    }),
    /non-empty username/,
  )
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1 }),
      username: "alice",
      password: "secret",
      randomBytes: () => Buffer.from("short"),
    }),
    /random source/,
  )
})

test("SCRAM rejects malformed server attributes, mandatory extensions, and changed conversation IDs", async () => {
  const nonce = Buffer.alloc(24, 1).toString("base64")
  for (const serverFirst of [
    "malformed",
    `r=${nonce}servernonce,s=c2FsdA==,i=4096,m=unsupported`,
    `r=${nonce}servernonce,r=again,s=c2FsdA==,i=4096`,
    `r=${nonce}servernonce,s=,i=4096`,
  ]) {
    const server = createScramServer({
      username: "alice",
      password: "secret",
      serverFirst,
    })
    await assert.rejects(
      authenticateMongoScram({
        command: server.command,
        username: "alice",
        password: "secret",
        randomBytes: (length) => Buffer.alloc(length, 1),
      }),
      /malformed attribute|mandatory extension|duplicate attribute|invalid salt/i,
    )
  }

  const changedConversation = createScramServer({
    username: "alice",
    password: "secret",
    continueResponse: { conversationId: 8 },
  })
  await assert.rejects(
    authenticateMongoScram({
      command: changedConversation.command,
      username: "alice",
      password: "secret",
      randomBytes: (length) => Buffer.alloc(length, 1),
    }),
    /conversation identifier changed/,
  )
})

test("SCRAM validates response shape and bounds server continuation rounds", async () => {
  await assert.rejects(
    authenticateMongoScram({
      command: async () => ({ ok: 1,
conversationId: 1,
payload: Buffer.alloc(0) }),
      username: "alice",
      password: "secret",
    }),
    /completion flag/,
  )

  let rounds = 0
  const endlessServer = {
    async command({ body }) {
      if (body.saslStart === 1) {
        return {
          ok: 1,
          conversationId: 1,
          done: false,
          payload: Buffer.from(`r=${Buffer.alloc(24, 1).toString("base64")}servernonce,s=c2FsdA==,i=4096`),
        }
      }
      rounds += 1
      return {
        ok: 1,
        conversationId: 1,
        done: false,
        payload: Buffer.alloc(0),
      }
    },
  }
  await assert.rejects(
    authenticateMongoScram({
      command: endlessServer.command,
      username: "alice",
      password: "secret",
      randomBytes: (length) => Buffer.alloc(length, 1),
    }),
    /continuation rounds/,
  )
  assert.equal(rounds, 3)
})
