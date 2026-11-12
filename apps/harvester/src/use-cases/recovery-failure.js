import { toResult } from "@coinzilla/utils"

/** Attach stable recovery classification metadata to an application failure. */
export function recoveryFailureError(error, category, stage, retryable) {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error })
  normalized.recoveryFailure = normalized.recoveryFailure ?? { category, stage, retryable }
  return normalized
}

export function failureResult({ error, errors, category, stage, retryable }) {
  const result = {
    failure: { category, stage, retryable },
  }
  if (errors !== undefined) {
    result.errors = errors
  } else {
    result.error = error
  }
  return toResult(result)
}

export function withFailure(result, failure) {
  if (result?.failure) {
    return result
  }
  return toResult({ ...result, failure })
}
