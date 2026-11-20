import assert from "node:assert/strict"
import test from "node:test"
import { assertWithDomainError } from "./assert-with-domain-error.js"

test("does not throw when the supplied validation succeeds", () => {
  assert.doesNotThrow(() => assertWithDomainError({
    validate: () => true,
    errorMessage: "Domain validation failed",
  }))
})

test("wraps validation failures in the domain-owned error message and preserves cause", () => {
  const cause = new TypeError("invalid value")

  assert.throws(
    () => assertWithDomainError({
      validate: () => {
        throw cause
      },
      errorMessage: "Domain validation failed",
    }),
    (error) => error.message === "Domain validation failed" && error.cause === cause,
  )
})
