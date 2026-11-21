import assert from "node:assert/strict"
import test from "node:test"
import { createGitEnvironment } from "./create-git-environment.js"

test("Git child environment excludes Bitunix credentials but preserves GitHub authentication", () => {
  const gitEnvironment = createGitEnvironment({
    env: {
      PATH: "/usr/bin",
      BITUNIX_API_KEY: "private-bitunix-key",
      BITUNIX_API_SECRET: "private-bitunix-secret",
      GH_TOKEN: "github-auth-token",
    },
  })

  assert.equal(Object.hasOwn(gitEnvironment, "BITUNIX_API_KEY"), false)
  assert.equal(Object.hasOwn(gitEnvironment, "BITUNIX_API_SECRET"), false)
  assert.equal(gitEnvironment.PATH, "/usr/bin")
  assert.equal(gitEnvironment.GH_TOKEN, "github-auth-token")
})
