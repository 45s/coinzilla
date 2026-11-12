/** Attach stable recovery classification metadata to an application failure. */
export function recoveryFailureError(error, category, stage, retryable) {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error })
  normalized.recoveryFailure = normalized.recoveryFailure ?? { category, stage, retryable }
  return normalized
}
