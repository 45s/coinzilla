import crypto from "node:crypto"
import { defaultLogger } from "@coinzilla/utils"
import { send } from "../shared/index.js"
import { WS } from "./WS.js"
import {
  validateRequiredParameters,
  isEmptyValue,
  removeEmptyValue,
  buildQueryString,
} from "./helpers.js"
import { adaptMsg } from "./adapters/index.js"

const PrivateKeyAlgo = {
  RSA: "RSA",
  ED25519: "Ed25519",
}

// // unsubscribe the stream above
// setTimeout(() => client.unsubscribe(aggTrade), 3000)

// // support combined stream
// const combinedStreams = client.combinedStreams(['btcusdt@miniTicker', 'ethusdt@tikcer'], callbacks)

export class BinanceStreamClient extends WS {
  constructor({
    apiKey,
    apiSecretKey,
    baseURL,
    wsURL,
    logger,
    timeout,
    proxy,
    httpsAgent,
    privateKey,
    privateKeyPassphrase,
    privateKeyAlgo,
    callbacks,
    combinedStreams,
    reconnectDelay,
  } = {}) {
    super({
      logger: logger || defaultLogger,
      callbacks: {
        ...callbacks,
        message: (msg) => {
          const formattedMsg = adaptMsg(JSON.parse(msg))
          callbacks?.message?.(formattedMsg)
        },
      },
      reconnectDelay,
      wsURL: wsURL || "wss://stream.binance.com:9443",
    })

    this.apiKey = apiKey
    this.apiSecret = apiSecretKey
    this.baseURL = baseURL
    // default is 0 (no timeout)
    this.timeout = timeout || 0
    this.proxy = proxy || false
    this.httpsAgent = httpsAgent
    this.privateKey = privateKey || ""
    this.privateKeyPassphrase = privateKeyPassphrase || ""
    this.privateKeyAlgo = privateKeyAlgo || PrivateKeyAlgo.RSA
    this.combinedStreams = combinedStreams || false
    this.listenKey = ""
  }

  #sendRequest = send

  #publicRequest(method, path, params = {}) {
    params = removeEmptyValue(params)
    params = buildQueryString(params)
    if (params !== "") {
      path = `${path}?${params}`
    }
    // return createRequest({
    //   method,
    //   baseURL: this.baseURL,
    //   url: path,
    //   apiKey: this.apiKey,
    //   timeout: this.timeout,
    //   proxy: this.proxy,
    //   httpsAgent: this.httpsAgent,
    // })
  }

  #signRequest(method, path, params = {}) {
    params = removeEmptyValue(params)
    const timestamp = Date.now()
    const queryString = buildQueryString({ ...params, timestamp })
    let signature

    if (!this.privateKey) {
      signature = crypto
        .createHmac("sha256", this.apiSecret)
        .update(queryString)
        .digest("hex")
    } else {
      if (this.privateKeyAlgo === PrivateKeyAlgo.RSA) {
        signature = crypto
          .sign("RSA-SHA256", Buffer.from(queryString), {
            key: this.privateKey,
            passphrase: this.privateKeyPassphrase,
          })
          .toString("base64")
      } else if (this.privateKeyAlgo === PrivateKeyAlgo.ED25519) {
        signature = crypto
          .sign(null, Buffer.from(queryString), {
            key: this.privateKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          })
          .toString("base64")
      } else {
        // eslint-disable-next-line quotes
        throw new Error("privateKeyAlgo must be either 'RSA' or 'ED25519'")
      }
      signature = encodeURIComponent(signature)
    }

    // return createRequest({
    //   method,
    //   baseURL: this.baseURL,
    //   url: `${path}?${queryString}&signature=${signature}`,
    //   apiKey: this.apiKey,
    //   timeout: this.timeout,
    //   proxy: this.proxy,
    //   httpsAgent: this.httpsAgent,
    // })
  }

  async #manageListenKey({ action = "create" } = {}) {
    if (action === "create") {
      const every30mins = 1_000 * 60 * 30
      setInterval(() => {
        this.#manageListenKey({ action: "update" })
      }, every30mins)
    }
    const actionsMap = {
      create: "POST",
      update: "PUT",
      delete: "DELETE",
    }
    return this.#sendRequest({
      path: "userDataStream",
      method: actionsMap[action],
    }).then((r) => {
      this.listenKey = r.listenKey
      return r
    })
  }

  #subscribe(stream) {
    if (this.isConnected()) {
      if (!Array.isArray(stream)) {
        stream = [stream]
      }
      const payload = JSON.stringify({
        method: "SUBSCRIBE",
        params: stream,
        id: Date.now(),
      })
      this.logger.info(`SUBSCRIBE ${payload}`)
      this.send(payload)
      return
    }
    if (Array.isArray(stream)) {
      stream = stream.join("/")
    }
    const url = this.combinedStreams
      ? `${this.wsURL}/stream?streams=${stream}`
      : `${this.wsURL}/ws/${stream}`
    return this.initConnect(url)
  }

  #unsubscribe(stream) {
    if (!this.isConnected()) {
      this.logger.warn("Not connected")
      return
    }
    if (!Array.isArray(stream)) {
      stream = [stream]
    }
    const payload = {
      method: "UNSUBSCRIBE",
      params: stream,
      id: Date.now(),
    }
    this.logger.info("UNSUBSCRIBE", payload)
    this.send(JSON.stringify(payload))
  }

  /**
   * The Trade Streams push raw trade information; each trade has a unique buyer and seller.
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#trade-streams}
   *
   * @param {string} symbol
   */
  trade({ tickets }) {
    const [symbol] = tickets
    validateRequiredParameters({ symbol })
    this.#subscribe(`${symbol.toLowerCase()}@trade`)
  }

  /**
   * The Kline/Candlestick Stream push updates to the current klines/candlestick every second.
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#klinecandlestick-streams-for-utc}
   *
   * @param {string} symbol
   * @param {string} interval - m -> minutes; h -> hours; d -> days; w -> weeks; M -> months:
   *     1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
   */
  kline({ tickets, interval }) {
    const [symbol] = tickets
    validateRequiredParameters({ symbol, interval })
    this.#subscribe(`${symbol.toLowerCase()}@kline_${interval}`)
  }

  /**
   * Individual symbol or all symbols mini ticker
   *
   * 24hr rolling window mini-ticker statistics.
   * These are NOT the statistics of the UTC day, but a 24hr rolling window for the previous 24hrs
   *
   * Update Speed: 1000ms
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#individual-symbol-mini-ticker-stream}
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#all-market-mini-tickers-stream}
   *
   * @param {string} [symbol]
   */
  miniTicker({ symbol = null }) {
    let stream = "!miniTicker@arr"
    if (!isEmptyValue(symbol)) {
      stream = `${symbol.toLowerCase()}@miniTicker`
    }
    this.#subscribe(stream)
  }

  /**
   * Individual symbol or all symbols ticker
   *
   * 24hr rolling window ticker statistics for a single symbol.
   * These are NOT the statistics of the UTC day, but a 24hr rolling window for the previous 24hrs.
   *
   * Update Speed: 1000ms
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#individual-symbol-ticker-streams}
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#all-market-tickers-stream}
   *
   * @param {string} [symbol]
   *
   */
  ticker({ symbol = null }) {
    let stream = "!ticker@arr"
    if (!isEmptyValue(symbol)) {
      stream = `${symbol.toLowerCase()}@ticker`
    }
    this.#subscribe(stream)
  }

  /**
   * Individual symbol or all rolling window statistics ticker
   *
   * Rolling window ticker statistics, computed over multiple windows.
   *
   * Stream Name: &lt;symbol&gt;@ticker_&lt;window_size&gt; or !ticker_&lt;window_size&gt;@arr
   * Window Sizes: 1h,4h
   * Update Speed: 1000ms
   *
   * Note: This stream is different from the &lt;symbol&gt;@ticker stream. The open time O always starts on a minute, while the closing time C is the current time of the update.
   *
   * As such, the effective window might be up to 59999ms wider that &lt;window_size&gt;.
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#individual-symbol-rolling-window-statistics-streams}
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#all-market-rolling-window-statistics-streams}
   *
   * @param {string} [windowSize]
   * @param {string} [symbol]
   *
   */
  rollingWindowTicker({ windowSize, symbol = null }) {
    let stream = `!ticker_${windowSize.toLowerCase()}@arr`
    if (!isEmptyValue(symbol)) {
      stream = `${symbol.toLowerCase()}@ticker_${windowSize.toLowerCase()}`
    }
    this.#subscribe(stream)
  }

  /**
   * Individual symbol or all symbols book ticker
   *
   * Pushes any update to the best bid or ask's price or quantity in real-time.
   *
   * Stream Name: &lt;symbol&gt;@bookTicker or !bookTicker
   * Update Speed: Real-time
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#individual-symbol-book-ticker-streams}
   *
   * @param {string} [symbol]
   */
  bookTicker({ symbol }) {
    validateRequiredParameters({ symbol })
    this.#subscribe(`${symbol.toLowerCase()}@bookTicker`)
  }

  /**
   * Partial Book Depth Streams
   * Top bids and asks, Valid are 5, 10, or 20.
   * Update Speed: 1000ms or 100ms<br>
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#partial-book-depth-streams}
   *
   * @param {string} symbol
   * @param {string} levels - 5, 10, or 20
   * @param {string} speed - 1000ms or 100ms
   *
   */
  partialBookDepth({ symbol, levels, speed }) {
    validateRequiredParameters({ symbol, levels, speed })
    this.#subscribe(`${symbol.toLowerCase()}@depth${levels}@${speed}`)
  }

  /**
   * Diff. Depth Stream
   * Order book price and quantity depth updates used to locally manage an order book.
   * Update Speed: 1000ms or 100ms
   *
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#diff-depth-stream}
   *
   * @param {string} symbol
   * @param {string} speed - 1000ms or 100ms
   *
   */
  diffBookDepth({ symbol, speed }) {
    validateRequiredParameters({ symbol, speed })
    this.#subscribe(`${symbol.toLowerCase()}@depth@${speed}`)
  }

  /**
   * The Aggregate Trade Streams push trade information that is aggregated for a single taker order
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#aggregate-trade-streams}
   */
  aggTrade({ tickets }) {
    const [symbol] = tickets
    validateRequiredParameters({ symbol })
    this.#subscribe(`${symbol.toLowerCase()}@aggTrade`)
  }

  /**
   * Listen to User data stream
   * {@link https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream}
   * @param {string} listenKey
   */
  async userData() {
    const listenKey =
      this.listenKey ||
      (await this.#manageListenKey({ action: "create" }).then(
        (r) => r.listenKey,
      ))
    this.logger.debug(`binance listen key: ${listenKey}`)
    validateRequiredParameters({ listenKey })
    this.#subscribe(listenKey)
    this.logger.success("WebSocket user data stream connected!")
  }
}
