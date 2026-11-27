import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runTelegramSmokeTest } from "./telegram-smoke.js"

const scriptPath = fileURLToPath(new URL("./telegram-smoke.js", import.meta.url))
const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..")
const timestamp = new Date("2026-10-31T12:00:00.000Z")

test("the --version path prints source identity without Telegram credentials or delivery", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
    },
  })
  assert.equal(result.status, 0, "the version command must succeed without Telegram credentials")
  assert.match(result.stdout, /@coinzilla\/notifiers telegram:smoke v1\.0\.0/, "the version output must identify the package and command")
  assert.match(result.stdout, /commit (?:[0-9a-f]{40}|unknown)/, "the version output must show the full commit SHA or explicit unknown")
  assert.match(result.stdout, /worktree (?:clean|dirty|unknown)/, "the version output must disclose worktree state")
  assert.match(result.stdout, /Node v\d+\./, "the version output must identify the Node runtime")
  assert.equal(result.stderr, "", "the credential-free version path must not emit operational errors")
})

test("sends one clearly labeled message using injected credentials and clock", async () => {
  const created = []
  const sent = []
  const result = await runTelegramSmokeTest({
    env: {
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "-100123",
    },
    now: () => timestamp,
    createNotifier(options) {
      created.push(options)
      return {
        async sendMessage(message) {
          sent.push(message)
          return { message_id: 42 }
        },
      }
    },
  })

  assert.deepEqual(created, [{
    token: "test-token",
    chatId: "-100123",
  }], "the notifier must receive only the validated injected Telegram credentials")
  assert.equal(sent.length, 1, "one smoke-test invocation must send exactly one message")
  assert.match(sent[0], /COINZILLA TELEGRAM SMOKE TEST/, "the outbound message must be clearly labeled as a smoke test")
  assert.match(sent[0], /2026-10-31T12:00:00.000Z/, "the message must use the injected deterministic timestamp")
  assert.deepEqual(result, { messageId: 42 }, "the result must expose the accepted Telegram message ID")
  assert.equal(Object.isFrozen(result), true, "the returned result must be immutable")
})

test("rejects invalid environment before creating a notifier", async () => {
  let created = false
  for (const env of [
    undefined,
    null,
    [],
    {},
    { TELEGRAM_BOT_TOKEN: "test-token" },
    { TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: " ",
      TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: [] },
  ]) {
    await assert.rejects(
      runTelegramSmokeTest({
        env,
        createNotifier() {
          created = true
          return { async sendMessage() { return { message_id: 1 } } }
        },
      }),
      /env|must both be configured/,
      "invalid Telegram configuration must be rejected before notifier construction",
    )
  }
  assert.equal(created, false, "invalid Telegram configuration must never construct a notifier")
})

test("validates the clock and notifier boundary", async () => {
  const env = {
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "-100123",
  }

  await assert.rejects(
    runTelegramSmokeTest({ env,
      now: () => "not a date" }),
    /valid Date/,
    "an invalid clock value must be rejected before delivery",
  )
  await assert.rejects(
    runTelegramSmokeTest({ env,
      createNotifier: () => ({}) }),
    /sendMessage/,
    "a notifier without sendMessage must be rejected before delivery",
  )
})

test("propagates transport failures without retrying", async () => {
  let calls = 0
  await assert.rejects(
    runTelegramSmokeTest({
      env: {
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "-100123",
      },
      createNotifier: () => ({
        async sendMessage() {
          calls += 1
          throw new Error("network unavailable")
        },
      }),
    }),
    /network unavailable/,
    "transport errors must propagate to the smoke-test command",
  )
  assert.equal(calls, 1, "a failed Telegram delivery must not be retried implicitly")
})

test("rejects malformed success results", async () => {
  for (const result of [null, {}, { message_id: 0 }, { message_id: "42" }]) {
    await assert.rejects(
      runTelegramSmokeTest({
        env: {
          TELEGRAM_BOT_TOKEN: "test-token",
          TELEGRAM_CHAT_ID: "-100123",
        },
        createNotifier: () => ({
          async sendMessage() { return result },
        }),
      }),
      /invalid message_id/,
      "malformed Telegram success responses must be rejected",
    )
  }
})
