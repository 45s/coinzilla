import { Asset } from "../assets/asset.js"

export const marketErrMsgs = {
  venue: "Market.venue should be a non-empty string",
  symbol: "Market.symbol should be a non-empty string",
  baseAsset: "Market.baseAsset should be an Asset",
  quoteAsset: "Market.quoteAsset should be an Asset",
  sameAssets: "Market baseAsset and quoteAsset should be different assets",
}

const normalizeRequiredString = (value) =>
  typeof value === "string" ? value.trim() : ""

export class Market {
  #venue
  #symbol
  #baseAsset
  #quoteAsset

  constructor({ venue, symbol, baseAsset, quoteAsset } = {}) {
    const normalizedVenue = normalizeRequiredString(venue)
    if (!normalizedVenue || normalizedVenue.includes(":")) {
      throw new Error(marketErrMsgs.venue)
    }

    const normalizedSymbol = normalizeRequiredString(symbol)
    if (!normalizedSymbol || normalizedSymbol.includes(":")) {
      throw new Error(marketErrMsgs.symbol)
    }

    if (!(baseAsset instanceof Asset)) {
      throw new Error(marketErrMsgs.baseAsset)
    }

    if (!(quoteAsset instanceof Asset)) {
      throw new Error(marketErrMsgs.quoteAsset)
    }

    if (baseAsset.id === quoteAsset.id) {
      throw new Error(marketErrMsgs.sameAssets)
    }

    this.#venue = normalizedVenue.toLowerCase()
    this.#symbol = normalizedSymbol
    this.#baseAsset = baseAsset
    this.#quoteAsset = quoteAsset

    Object.freeze(this)
  }

  get id() {
    return `${this.#venue}:${this.#symbol}`
  }

  get venue() {
    return this.#venue
  }

  get symbol() {
    return this.#symbol
  }

  get baseAsset() {
    return this.#baseAsset
  }

  get quoteAsset() {
    return this.#quoteAsset
  }

  get value() {
    return {
      id: this.id,
      venue: this.#venue,
      symbol: this.#symbol,
      baseAsset: this.#baseAsset.value,
      quoteAsset: this.#quoteAsset.value,
    }
  }
}
