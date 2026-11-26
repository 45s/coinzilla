import { userInfo } from "node:os"

export const LOCAL_OPERATOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,127}$/

const authenticatedLocalOperatorIdentities = new WeakSet()

/**
 * Authenticate an operator against the operating-system account running this
 * offline recovery command. A plain CLI-supplied identifier is never trusted.
 */
export function authenticateLocalOperator({
  operatorId,
  getUserInfo = userInfo,
} = {}) {
  if (typeof operatorId !== "string" || !LOCAL_OPERATOR_ID_PATTERN.test(operatorId)) {
    throw new TypeError("Authenticated operator identity must be a canonical 3-128 character OS account name")
  }
  let account
  try {
    account = getUserInfo()
  } catch (cause) {
    throw new Error("Unable to authenticate the current operating-system account", { cause })
  }
  if (typeof account?.username !== "string" || account.username !== operatorId) {
    throw new Error("Operator ID must exactly match the authenticated operating-system account")
  }
  const identity = Object.freeze({
    operatorId,
    authMethod: "OS_ACCOUNT",
  })
  authenticatedLocalOperatorIdentities.add(identity)
  return identity
}

export function isAuthenticatedLocalOperatorIdentity(identity) {
  return Boolean(
    identity &&
    typeof identity === "object" &&
    authenticatedLocalOperatorIdentities.has(identity),
  )
}

export function hasControlCharacters(value) {
  if (typeof value !== "string") {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) {
      return true
    }
  }
  return false
}
