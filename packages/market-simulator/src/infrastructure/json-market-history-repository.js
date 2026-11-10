import { readFile } from "node:fs/promises"
import { validateMarketHistory } from "../domain/market-history.js"

/** Infrastructure adapter implementing the market-history repository port. */
export class JsonMarketHistoryRepository {
  constructor({ filePath, history } = {}) {
    if (!history && !filePath) throw new TypeError("filePath or history is required")
    this.filePath = filePath
    this.historyInput = history
  }

  async load() {
    if (this.historyInput) return validateMarketHistory(this.historyInput)
    const content = await readFile(this.filePath, "utf8")
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (cause) {
      throw new SyntaxError(`Market history is not valid JSON: ${cause.message}`, { cause })
    }
    return validateMarketHistory(parsed)
  }
}
