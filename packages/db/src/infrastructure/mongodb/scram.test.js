import assert from "node:assert/strict"
import test from "node:test"

import { authenticateMongoScram } from "./scram.js"

const FIXED_SCRAM_VECTORS = Object.freeze({
  "SCRAM-SHA-256|alice|correct horse battery staple": {
    serverFirst: "r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,s=dGVzdC1zYWx0,i=4096",
    clientFinal: "c=biws,r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,p=P5ErDGWXmsDz+WitTmuy1O9e2f7v+QUO2tjbkaz9NpI=",
    serverFinal: "v=/gNgGg7rTgEt51krIftpS6hcX8/+092GBE1H5xvT7TE=",
  },
  "SCRAM-SHA-1|alice|legacy-password": {
    serverFirst: "r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,s=dGVzdC1zYWx0,i=4096",
    clientFinal: "c=biws,r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,p=HFZvnCnOfWt4b+grVpTd5ST1bVg=",
    serverFinal: "v=TJkKtX74yxwzn+Uc0nsyLLqaE+M=",
  },
  "SCRAM-SHA-256|alice|secret": {
    serverFirst: "r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,s=dGVzdC1zYWx0,i=4096",
    clientFinal: "c=biws,r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,p=0T0GsHvgoRiQVAWxqWbffMznTXk/zF/hc3iYuNfd7SE=",
    serverFinal: "v=vuyUxdJEsyClsL++705LZ6hefdvDaUXlTUO9p8Qr7Is=",
  },
  "SCRAM-SHA-256|alice,admin=1|secret": {
    serverFirst: "r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,s=dGVzdC1zYWx0,i=4096",
    clientFinal: "c=biws,r=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBservernonce,p=jdvE4XINB2vb0QqXU0B5MxtW+EMcKjVW6xtqp/mGvEc=",
    serverFinal: "v=mUGy8AwFRrcksyCRkQ7CwuPUWL1rsTTZdE+nK0ArByU=",
  },
})

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
  const vector = FIXED_SCRAM_VECTORS[`${mechanism}|${username}|${password}`]
  const conversationId = 7

  return {
    async command({ body }) {
      if (body.saslStart === 1) {
        assert.ok(vector, "the SCRAM test server requires an independently generated protocol vector")
        return {
          ok: 1,
          conversationId,
          done: false,
          payload: Buffer.from(serverFirst ?? vector.serverFirst),
          ...startResponse,
        }
      }

      if (body.saslContinue === 1) {
        const clientFinal = body.payload.toString("utf8")
        assert.equal(clientFinal, vector.clientFinal, "client proof must match the independent SCRAM protocol vector")
        const signature = vector.serverFinal.slice(2)
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

test("SCRAM rejects missing callbacks, credentials, and authentication sources", async () => {
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
})

test("SCRAM rejects malformed server conversation response fields", async () => {
  const missingConversation = {
    async command() {
      return {
        ok: 1,
        done: false,
        payload: Buffer.alloc(0),
      }
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
      return {
        ok: 1,
        conversationId: 1,
        done: false,
        payload: "not-binary",
      }
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
      return {
        ok: 1,
        conversationId: 1,
        done: true,
        payload: Buffer.alloc(0),
      }
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
