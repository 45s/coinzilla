/**
 * Convert log data to a printable value without allowing hostile objects to
 * make the logging path throw.
 */
export function formatLogContent(data) {
  if (['string', 'number', 'boolean'].some((type) => typeof data === type)) {
    return data
  }

  try {
    // Preserve JSON.stringify's existing undefined result for unsupported
    // top-level values such as undefined and symbols.
    return JSON.stringify(data, null, 2)
  } catch {
    try {
      return String(data)
    } catch {
      return '[Unserializable log data]'
    }
  }
}
