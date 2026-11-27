import assert from "node:assert/strict"
import test from "node:test"
import {
  authenticateLocalOperator,
  hasControlCharacters,
  isAuthenticatedLocalOperatorIdentity,
} from "./local-operator-identity.js"

test("authenticates only the exact current operating-system account", () => {
  const identity = authenticateLocalOperator({
    operatorId: "operator-7",
    getUserInfo: () => ({ username: "operator-7" }),
  })

  assert.equal(identity.operatorId, "operator-7")
  assert.equal(identity.authMethod, "OS_ACCOUNT")
  assert.equal(isAuthenticatedLocalOperatorIdentity(identity), true)
})

test("rejects invalid identities, OS lookup failures, and account mismatches", () => {
  assert.throws(() => authenticateLocalOperator({
    operatorId: "x",
    getUserInfo: () => ({ username: "x" }),
  }), /canonical 3-128 character/)

  assert.throws(() => authenticateLocalOperator({
    operatorId: "operator-7",
    getUserInfo: () => {
      throw new Error("OS lookup failed")
    },
  }), (error) => error.cause?.message === "OS lookup failed")

  assert.throws(() => authenticateLocalOperator({
    operatorId: "operator-7",
    getUserInfo: () => ({ username: "different-user" }),
  }), /exactly match/)

  assert.throws(() => authenticateLocalOperator({
    operatorId: "operator-7",
    getUserInfo: () => ({ username: null }),
  }), /exactly match/)
})

test("does not trust copied, caller-created, or primitive identity values", () => {
  const identity = authenticateLocalOperator({
    operatorId: "operator-7",
    getUserInfo: () => ({ username: "operator-7" }),
  })

  assert.equal(isAuthenticatedLocalOperatorIdentity(identity), true)
  assert.equal(isAuthenticatedLocalOperatorIdentity(Object.freeze({ ...identity })), false)
  assert.equal(isAuthenticatedLocalOperatorIdentity(null), false)
  assert.equal(isAuthenticatedLocalOperatorIdentity("operator-7"), false)
})

test("detects C0 and DEL control characters without rejecting printable text", () => {
  assert.equal(hasControlCharacters("reviewed account evidence"), false)
  assert.equal(hasControlCharacters("line\nbreak"), true)
  assert.equal(hasControlCharacters("delete\u007f"), true)
  assert.equal(hasControlCharacters(""), false)
  assert.equal(hasControlCharacters(null), false)
})
