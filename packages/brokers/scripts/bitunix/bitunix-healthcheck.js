import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.development")

try {
  loadEnvFile(envPath)
} catch {
  process.stderr.write("Bitunix health check requires packages/brokers/.env.development. Create it with BITUNIX_API_KEY and BITUNIX_API_SECRET.\n")
  process.exitCode = 1
}

if (process.exitCode !== 1) {
  const { runBitunixHealthCheck } = await import("./workflows/publish-bitunix-diagnostics.js")
  await runBitunixHealthCheck()
}
