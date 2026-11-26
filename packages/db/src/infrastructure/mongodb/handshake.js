import { authenticateMongoScram } from "./scram.js"

const MIN_SUPPORTED_WIRE_VERSION = 13
const MAX_SUPPORTED_WIRE_VERSION = 25
const SUPPORTED_AUTH_MECHANISMS = Object.freeze(["SCRAM-SHA-256", "SCRAM-SHA-1"])

function parseBooleanOption(value, name) {
  if (value === null) {
    return false
  }
  if (value === "true" || value === "1") {
    return true
  }
  if (value === "false" || value === "0") {
    return false
  }
  throw new TypeError(`MongoDB URI option ${name} must be true or false`)
}

function parsePositiveInteger(value, name, fallback) {
  if (value === null) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`MongoDB URI option ${name} must be a positive safe integer`)
  }
  return parsed
}

/** Parse the deliberately supported single-seed mongodb:// URI form. */
export function parseMongoConnectionString(connectionString) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new TypeError("MongoDB connection string must be a non-empty string")
  }
  const normalizedConnectionString = connectionString.toLowerCase()
  if (normalizedConnectionString.startsWith("mongodb+srv://")) {
    throw new TypeError("MongoDB SRV discovery is not supported; provide a mongodb:// seed URI")
  }
  if (!normalizedConnectionString.startsWith("mongodb://")) {
    throw new TypeError("MongoDB connection string must use mongodb://")
  }
  const authority = connectionString.slice("mongodb://".length).split(/[/?#]/, 1)[0]
  const hostList = authority.slice(authority.lastIndexOf("@") + 1)
  if (hostList.includes(",")) {
    throw new TypeError("MongoDB URI must specify a single seed host")
  }

  let url
  try {
    url = new URL(connectionString)
  } catch (error) {
    throw new TypeError("MongoDB connection string is invalid", { cause: error })
  }
  if (url.hash !== "") {
    throw new TypeError("MongoDB URI fragments are not supported")
  }
  if (url.username === "" && url.password !== "") {
    throw new TypeError("MongoDB URI password requires a username")
  }
  const supportedOptions = new Set([
    "authSource",
    "tls",
    "ssl",
    "authMechanism",
    "replicaSet",
    "connectTimeoutMS",
    "socketTimeoutMS",
    "loadBalanced",
    "compressors",
    "readPreference",
    "retryWrites",
    "directConnection",
  ])
  if (url.searchParams.has("tls") && url.searchParams.has("ssl")) {
    throw new TypeError("MongoDB URI must use tls or ssl, not both")
  }
  const seenOptions = new Set()
  for (const key of url.searchParams.keys()) {
    if (!supportedOptions.has(key)) {
      throw new TypeError(`MongoDB URI option ${key} is not supported`)
    }
    if (seenOptions.has(key)) {
      throw new TypeError(`MongoDB URI option ${key} must not be repeated`)
    }
    seenOptions.add(key)
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1)) || "admin"
  if (/[\\/\\\\."$*<>:|?]/u.test(databaseName)) {
    throw new TypeError("MongoDB database name contains an unsupported character")
  }
  if (parseBooleanOption(url.searchParams.get("loadBalanced"), "loadBalanced")) {
    throw new TypeError("MongoDB load-balanced topology is not supported")
  }
  if (url.searchParams.has("compressors") && url.searchParams.get("compressors") !== "") {
    throw new TypeError("MongoDB wire compression is not supported")
  }
  if (url.searchParams.has("readPreference") && url.searchParams.get("readPreference") !== "primary") {
    throw new TypeError("MongoDB provider supports primary read preference only")
  }
  if (parseBooleanOption(url.searchParams.get("retryWrites"), "retryWrites")) {
    throw new TypeError("MongoDB retryable writes are not supported")
  }
  const authSource = url.searchParams.get("authSource") ?? databaseName
  if (url.searchParams.has("tls") && url.searchParams.has("ssl")) {
    throw new TypeError("MongoDB URI must not specify both tls and ssl")
  }
  const tlsValue = url.searchParams.get("tls") ?? url.searchParams.get("ssl")
  const userInfo = authority.includes("@") ? authority.slice(0, authority.lastIndexOf("@")) : null
  const username = url.username === "" ? undefined : decodeURIComponent(url.username)
  const hasPasswordSeparator = userInfo?.includes(":") ?? false
  const password = hasPasswordSeparator ? decodeURIComponent(url.password) : undefined
  if (userInfo !== null && username === undefined) {
    throw new TypeError("MongoDB URI password requires a username")
  }
  if (username !== undefined && password === undefined) {
    throw new TypeError("MongoDB URI username requires a password")
  }
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
  if (host === "") {
    throw new TypeError("MongoDB URI requires a host")
  }
  return {
    host,
    port: url.port === "" ? 27017 : Number(url.port),
    username,
    password,
    databaseName,
    authSource,
    authMechanism: url.searchParams.get("authMechanism") ?? undefined,
    tls: parseBooleanOption(tlsValue, "tls"),
    replicaSet: url.searchParams.get("replicaSet") ?? undefined,
    directConnection: parseBooleanOption(url.searchParams.get("directConnection"), "directConnection"),
    connectTimeoutMS: parsePositiveInteger(
      url.searchParams.get("connectTimeoutMS"),
      "connectTimeoutMS",
      10_000,
    ),
    socketTimeoutMS: parsePositiveInteger(
      url.searchParams.get("socketTimeoutMS"),
      "socketTimeoutMS",
      30_000,
    ),
  }
}

function assertCommandSucceeded(response, commandName) {
  if (!response || Number(response.ok) !== 1) {
    throw new Error(
      `MongoDB ${commandName} command failed: ${response?.errmsg ?? "unknown server error"}`,
      {
        cause: response?.code === undefined ? undefined : { code: response.code },
      },
    )
  }
}

function detectTopology(hello) {
  if (hello.msg === "isdbgrid") {
    return "sharded"
  }
  if (typeof hello.setName === "string" && hello.setName !== "") {
    return "replicaSet"
  }
  return "standalone"
}

function selectAuthenticationMechanism({ requested, supported }) {
  if (requested !== undefined) {
    if (!SUPPORTED_AUTH_MECHANISMS.includes(requested)) {
      throw new TypeError(`Unsupported MongoDB authentication mechanism: ${requested}`)
    }
    if (supported.length > 0 && !supported.includes(requested)) {
      throw new Error(`MongoDB server does not support authentication mechanism ${requested}`)
    }
    return requested
  }
  if (supported.includes("SCRAM-SHA-256")) {
    return "SCRAM-SHA-256"
  }
  if (supported.includes("SCRAM-SHA-1")) {
    return "SCRAM-SHA-1"
  }
  return "SCRAM-SHA-256"
}

/** Run hello negotiation, topology detection and optional SCRAM authentication. */
export async function performMongoHandshake({
  transport,
  databaseName = "admin",
  username,
  password,
  authSource = "admin",
  authMechanism,
  replicaSet,
  randomBytes,
} = {}) {
  if (!transport || typeof transport.command !== "function") {
    throw new TypeError("MongoDB handshake requires a connected command transport")
  }
  if (typeof databaseName !== "string" || databaseName.trim() === "") {
    throw new TypeError("MongoDB database name must be a non-empty string")
  }
  const helloCommand = {
    hello: 1,
    helloOk: true,
    client: {
      driver: {
        name: "coinzilla-db-native",
        version: "1.0.0",
      },
      os: {
        type: process.platform,
      },
      platform: `Node.js ${process.version}`,
    },
    $db: "admin",
  }
  if (username !== undefined) {
    helloCommand.saslSupportedMechs = `${authSource}.${username}`
  }
  const hello = await transport.command({
    body: helloCommand,
  })
  assertCommandSucceeded(hello, "hello")
  if (hello.serviceId !== undefined) {
    throw new Error("MongoDB load-balanced topology is not supported")
  }

  const minWireVersion = Number(hello.minWireVersion ?? 0)
  const maxWireVersion = Number(hello.maxWireVersion ?? 0)
  if (!Number.isSafeInteger(minWireVersion)
    || !Number.isSafeInteger(maxWireVersion)
    || minWireVersion < 0
    || maxWireVersion < 0
    || maxWireVersion < MIN_SUPPORTED_WIRE_VERSION
    || minWireVersion > MAX_SUPPORTED_WIRE_VERSION
    || maxWireVersion < minWireVersion) {
    throw new Error(
      `MongoDB wire protocol version range ${minWireVersion}-${maxWireVersion} is not supported; supported range is ${MIN_SUPPORTED_WIRE_VERSION}-${MAX_SUPPORTED_WIRE_VERSION}`,
    )
  }

  const topology = detectTopology(hello)
  if (replicaSet && hello.setName !== replicaSet) {
    throw new Error(`MongoDB server belongs to replica set ${hello.setName ?? "unknown"}, expected ${replicaSet}`)
  }
  const writablePrimary = typeof hello.isWritablePrimary === "boolean"
    ? hello.isWritablePrimary
    : hello.ismaster === true
  if (!writablePrimary && typeof hello.primary !== "string") {
    throw new Error("MongoDB topology did not identify a writable primary")
  }

  let mechanism
  if (username !== undefined) {
    if (typeof password !== "string") {
      throw new TypeError("MongoDB password must be a string when a username is configured")
    }
    const supported = Array.isArray(hello.saslSupportedMechs)
      ? hello.saslSupportedMechs
      : []
    mechanism = selectAuthenticationMechanism({
      requested: authMechanism,
      supported,
    })
    await authenticateMongoScram({
      command: (input) => transport.command(input),
      username,
      password,
      authSource,
      mechanism,
      randomBytes,
    })
  }

  return Object.freeze({
    topology,
    hello,
    minWireVersion,
    maxWireVersion,
    primary: writablePrimary ? null : hello.primary,
    sessionsSupported: Number.isFinite(hello.logicalSessionTimeoutMinutes)
      && hello.logicalSessionTimeoutMinutes > 0,
    transactionSupported: topology !== "standalone"
      && Number.isFinite(hello.logicalSessionTimeoutMinutes)
      && hello.logicalSessionTimeoutMinutes > 0,
    authenticationMechanism: mechanism ?? null,
  })
}
