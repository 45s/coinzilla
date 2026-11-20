import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const operatorConfigUrl = new URL("./operator-control.js", import.meta.url).href

test("does not capture TELEGRAM_USER_ID while importing static operator configuration", () => {
  const source = [
    `import { OPERATOR_CONTROL_CONFIG } from ${JSON.stringify(operatorConfigUrl)}`,
    "process.stdout.write(JSON.stringify(OPERATOR_CONTROL_CONFIG.telegram.allowedUserIds))",
  ].join(";")
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      TELEGRAM_USER_ID: "123456789",
    },
  })
  assert.equal(result.status, 0, `The isolated config import must succeed: ${result.stderr}`)
  assert.deepEqual(
    JSON.parse(result.stdout),
    [],
    "Ambient TELEGRAM_USER_ID must not change the static configuration module at import time.",
  )
})
