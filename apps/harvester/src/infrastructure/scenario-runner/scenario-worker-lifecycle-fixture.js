process.on("message", (request) => {
  const keepAlive = setInterval(() => {}, 1000)
  process.send?.({
    runId: request.runId,
    ok: true,
    output: {
      received: true,
    },
  })
  process.once("SIGTERM", () => {
    clearInterval(keepAlive)
    setTimeout(() => process.exit(0), 30)
  })
})
