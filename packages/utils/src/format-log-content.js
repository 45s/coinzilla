/**
 * Convert log data to a printable value without allowing hostile objects to
 * make the logging path throw.
 */
export function formatLogContent(data) {
  if (['string', 'number', 'boolean'].some((type) => typeof data === type)) {
    return data
  }

  try {
    const serialized = JSON.stringify(data, null, 2)
    if (serialized !== undefined) {
      return serialized
    }
  } catch {
    // Fall back to a safe string representation below.
  }

  try {
    return String(data)
  } catch {
    return '[Unserializable log data]'
  }
}
