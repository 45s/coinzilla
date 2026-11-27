/**
 * Allow browser access only from a local HTTP Dashboard origin.
 *
 * Angular CLI may select another port when its default port is occupied.
 * The Harvester API remains loopback-bound; this predicate only controls
 * which local browser origins receive CORS permission or may issue commands.
 */
export function isLocalDashboardOrigin(origin) {
  if (typeof origin !== "string" || origin.length > 256) {
    return false
  }
  try {
    const parsedOrigin = new URL(origin)
    return parsedOrigin.protocol === "http:"
      && (parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "localhost")
      && parsedOrigin.origin === origin
      && parsedOrigin.username === ""
      && parsedOrigin.password === ""
      && parsedOrigin.pathname === "/"
      && parsedOrigin.search === ""
      && parsedOrigin.hash === ""
  } catch {
    return false
  }
}
