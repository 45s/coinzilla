import test from "node:test"
import assert from "node:assert/strict"

import { EventBus } from "./index.js"

test("public input methods return failures instead of throwing for null and non-object inputs", async () => {
  const bus = new EventBus({ logger: {} })

  for (const input of [null, [], "invalid", 42, true]) {
    const published = bus.publish(input)
    assert.equal(published.ok, false)
    assert.match(published.errors[0].message, /Event publish input must be an object/)

    const subscribed = bus.subscribe(input)
    assert.equal(subscribed.ok, false)
    assert.match(subscribed.errors[0].message, /Event subscription input must be an object/)

    const allSubscribed = bus.subscribeAll(input)
    assert.equal(allSubscribed.ok, false)
    assert.match(allSubscribed.errors[0].message, /Event subscribeAll input must be an object/)
  }

  assert.equal((await bus.close()).ok, true)
})

test("public input methods convert throwing property accessors into failure results", async () => {
  const bus = new EventBus({ logger: {} })
  const throwingInput = (property) => Object.defineProperty({}, property, {
    enumerable: true,
    get() {
      throw new Error(`blocked ${property}`)
    },
  })

  const publishResult = bus.publish(throwingInput("name"))
  assert.equal(publishResult.ok, false)
  assert.match(publishResult.errors[0].message, /blocked name/)

  const subscribeResult = bus.subscribe(throwingInput("name"))
  assert.equal(subscribeResult.ok, false)
  assert.match(subscribeResult.errors[0].message, /blocked name/)

  const subscribeAllResult = bus.subscribeAll(throwingInput("handler"))
  assert.equal(subscribeAllResult.ok, false)
  assert.match(subscribeAllResult.errors[0].message, /blocked handler/)

  await bus.close()
})
