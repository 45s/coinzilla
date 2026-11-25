function exitAfterGracePeriod({ keepAlive }) {
  clearInterval(keepAlive)
  setTimeout(() => process.exit(0), 500)
}

process.on("message", (request) => {
  const keepAlive = setInterval(() => {}, 1000)
  process.once("SIGTERM", () => exitAfterGracePeriod({ keepAlive }))
  process.send?.({
    runId: request.runId,
    ok: true,
    output: {
      received: true,
    },
  })
})
