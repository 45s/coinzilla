import path from "node:path"

export function createHistoryError({ code, message, details, cause }) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) { error.details = details }
  if (cause !== undefined) { error.cause = cause }
  return error
}

export function normalizeHistoryReadError({ error, directory }) {
  if (error?.code !== "ENOENT") {
    return error
  }
  const absoluteDirectory = path.resolve(directory)
  return createHistoryError({
    code: "JOURNAL_DIRECTORY_NOT_FOUND",
    message: `Journal history directory does not exist: ${absoluteDirectory}`,
    details: { directory: absoluteDirectory },
    cause: error,
  })
}
