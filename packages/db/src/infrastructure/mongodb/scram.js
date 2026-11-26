import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes as nativeRandomBytes,
  timingSafeEqual,
} from "node:crypto"

const SUPPORTED_MECHANISMS = Object.freeze(["SCRAM-SHA-256", "SCRAM-SHA-1"])
const MINIMUM_ITERATIONS = 4_096
const MAXIMUM_ITERATIONS = 1_000_000

function parseAttributes(message) {
  const attributes = new Map()
  for (const part of message.split(",")) {
    const separator = part.indexOf("=")
    if (separator !== 1) {
      throw new Error("MongoDB SCRAM server sent a malformed attribute")
    }
    const key = part.slice(0, separator)
    if (attributes.has(key)) {
      throw new Error("MongoDB SCRAM server sent a duplicate attribute")
    }
    attributes.set(key, part.slice(separator + 1))
  }
  return attributes
}

function escapeUsername(username) {
  return username.replace(/=/g, "=3D").replace(/,/g, "=2C")
}

function prepareSha256Password(password) {
  if (!/^[\x20-\x7e]*$/.test(password)) {
    throw new TypeError("MongoDB SCRAM-SHA-256 passwords must contain printable ASCII only")
  }
  return password
}

function createPasswordDigest({ username, password, mechanism }) {
  if (mechanism === "SCRAM-SHA-1") {
    return createHash("md5")
      .update(`${username}:mongo:${password}`, "utf8")
      .digest("hex")
  }
  return prepareSha256Password(password)
}

function deriveScramMaterial({ passwordDigest, salt, iterations, mechanism }) {
  const hash = mechanism === "SCRAM-SHA-1" ? "sha1" : "sha256"
  const length = mechanism === "SCRAM-SHA-1" ? 20 : 32
  const saltedPassword = pbkdf2Sync(passwordDigest, salt, iterations, length, hash)
  const clientKey = createHmac(hash, saltedPassword).update("Client Key").digest()
  const storedKey = createHash(hash).update(clientKey).digest()
  const serverKey = createHmac(hash, saltedPassword).update("Server Key").digest()
  return { hash,
clientKey,
storedKey,
serverKey }
}

function assertCommandSucceeded(response, stage) {
  if (!response || Number(response.ok) !== 1) {
    const message = response?.errmsg ?? "MongoDB authentication command failed"
    throw new Error(`MongoDB SCRAM ${stage} failed: ${message}`, {
      cause: response?.code === undefined ? undefined : { code: response.code },
    })
  }
  if (!Number.isInteger(response.conversationId)) {
    throw new Error("MongoDB SCRAM response omitted its conversation identifier")
  }
  if (typeof response.done !== "boolean") {
    throw new Error("MongoDB SCRAM response omitted its completion flag")
  }
  if (!Buffer.isBuffer(response.payload)) {
    throw new Error("MongoDB SCRAM response payload must be binary")
  }
}

function decodeBase64(value) {
  if (typeof value !== "string") {
    throw new TypeError("MongoDB SCRAM server signature must be base64 text")
  }
  const unpadded = value.replace(/=+$/u, "")
  const padding = value.length - unpadded.length
  if (!/^[A-Za-z0-9+/]*$/u.test(unpadded)
    || padding > 2
    || (padding > 0 && value.length % 4 !== 0)
    || (padding === 1 && unpadded.length % 4 !== 3)
    || (padding === 2 && unpadded.length % 4 !== 2)
    || unpadded.length % 4 === 1) {
    throw new TypeError("MongoDB SCRAM server signature is not valid base64")
  }
  const decoded = Buffer.from(value, "base64")
  if (decoded.toString("base64").replace(/=+$/u, "") !== unpadded) {
    throw new TypeError("MongoDB SCRAM server signature is not canonical base64")
  }
  return decoded
}

function verifyServerSignature({ payload, expectedSignature }) {
  const attributes = parseAttributes(payload.toString("utf8"))
  if (attributes.has("e")) {
    throw new Error(`MongoDB SCRAM server rejected authentication: ${attributes.get("e")}`)
  }
  if (!attributes.has("v")) {
    throw new Error("MongoDB SCRAM server final message omitted its signature")
  }
  const actualSignature = decodeBase64(attributes.get("v"))
  if (actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error("MongoDB SCRAM server signature verification failed")
  }
}

/**
 * Authenticate a MongoDB connection using SCRAM-SHA-256 or SCRAM-SHA-1.
 * The command callback accepts the provider's ordinary command input object.
 */
export async function authenticateMongoScram({
  command,
  username,
  password,
  authSource = "admin",
  mechanism = "SCRAM-SHA-256",
  randomBytes = nativeRandomBytes,
} = {}) {
  if (typeof command !== "function") {
    throw new TypeError("MongoDB SCRAM command callback is required")
  }
  if (typeof username !== "string" || username.length === 0
    || !/^[\x20-\x7e]+$/.test(username)
    || typeof password !== "string") {
    throw new TypeError("MongoDB SCRAM requires a non-empty username and string password")
  }
  if (!SUPPORTED_MECHANISMS.includes(mechanism)) {
    throw new TypeError(`Unsupported MongoDB SCRAM mechanism: ${mechanism}`)
  }
  if (typeof authSource !== "string" || authSource.trim() === "") {
    throw new TypeError("MongoDB authentication source must be a non-empty string")
  }

  const nonceBytes = randomBytes(24)
  if (!Buffer.isBuffer(nonceBytes) || nonceBytes.length !== 24) {
    throw new TypeError("MongoDB SCRAM random source must return the requested number of bytes")
  }
  const nonce = nonceBytes.toString("base64")
  const clientFirstBare = `n=${escapeUsername(username)},r=${nonce}`
  const clientFirst = `n,,${clientFirstBare}`
  const startResponse = await command({
    body: {
      saslStart: 1,
      mechanism,
      payload: Buffer.from(clientFirst, "utf8"),
      autoAuthorize: 1,
      options: { skipEmptyExchange: true },
      $db: authSource,
    },
  })
  assertCommandSucceeded(startResponse, "start")
  if (startResponse.done) {
    throw new Error("MongoDB SCRAM server completed authentication before client proof")
  }

  const serverFirst = startResponse.payload.toString("utf8")
  const serverAttributes = parseAttributes(serverFirst)
  if (serverAttributes.has("m")) {
    throw new Error("MongoDB SCRAM server requested an unsupported mandatory extension")
  }
  const serverNonce = serverAttributes.get("r")
  if (typeof serverNonce !== "string" || !serverNonce.startsWith(nonce) || serverNonce.length <= nonce.length) {
    throw new Error("MongoDB SCRAM server nonce does not extend the client nonce")
  }
  const saltValue = serverAttributes.get("s")
  const salt = Buffer.from(saltValue ?? "", "base64")
  const canonicalSalt = salt.toString("base64").replace(/=+$/, "")
  if (!saltValue || salt.length === 0 || salt.length > 1024 || canonicalSalt !== saltValue.replace(/=+$/, "")) {
    throw new Error("MongoDB SCRAM server supplied an invalid salt")
  }
  const iterations = Number(serverAttributes.get("i"))
  if (!Number.isSafeInteger(iterations)
    || iterations < MINIMUM_ITERATIONS
    || iterations > MAXIMUM_ITERATIONS) {
    throw new Error("MongoDB SCRAM iteration count is outside the supported safe range")
  }

  const passwordDigest = createPasswordDigest({
    username,
    password,
    mechanism,
  })
  const material = deriveScramMaterial({
    passwordDigest,
    salt,
    iterations,
    mechanism,
  })
  const clientFinalWithoutProof = `c=biws,r=${serverNonce}`
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`
  const clientSignature = createHmac(material.hash, material.storedKey)
    .update(authMessage, "utf8")
    .digest()
  const proof = Buffer.allocUnsafe(material.clientKey.length)
  for (let index = 0; index < material.clientKey.length; index += 1) {
    proof[index] = material.clientKey[index] ^ clientSignature[index]
  }
  const serverSignature = createHmac(material.hash, material.serverKey)
    .update(authMessage, "utf8")
    .digest()
  const clientFinal = `${clientFinalWithoutProof},p=${proof.toString("base64")}`

  let continueResponse = await command({
    body: {
      saslContinue: 1,
      conversationId: startResponse.conversationId,
      payload: Buffer.from(clientFinal, "utf8"),
      $db: authSource,
    },
  })
  assertCommandSucceeded(continueResponse, "continue")
  if (continueResponse.conversationId !== startResponse.conversationId) {
    throw new Error("MongoDB SCRAM conversation identifier changed during authentication")
  }
  let finalRounds = 0
  while (!continueResponse.done) {
    finalRounds += 1
    if (finalRounds > 2) {
      throw new Error("MongoDB SCRAM server exceeded the supported continuation rounds")
    }
    continueResponse = await command({
      body: {
        saslContinue: 1,
        conversationId: startResponse.conversationId,
        payload: Buffer.alloc(0),
        $db: authSource,
      },
    })
    assertCommandSucceeded(continueResponse, "finalize")
    if (continueResponse.conversationId !== startResponse.conversationId) {
      throw new Error("MongoDB SCRAM conversation identifier changed during authentication")
    }
  }
  verifyServerSignature({
    payload: continueResponse.payload,
    expectedSignature: serverSignature,
  })
}
