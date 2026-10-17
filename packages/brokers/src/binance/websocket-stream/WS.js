import { Console } from 'console'
import { createWebSocket, WebSocket } from '../../../_libs/index.js'

export class WS {
  constructor({ logger, wsURL, callbacks = {}, reconnectDelay } = {}) {
    this.logger =
      logger ||
      new Console({
        stdout: process.stdout,
        stderr: process.stderr,
      })
    this.wsURL = wsURL
    this.reconnectDelay = reconnectDelay || 5000
    this.wsConnection = {}

    this.callbacks = {
      open: () => this.logger.debug('Connected with Websocket server'),
      close: () => this.logger.debug('Disconnected with Websocket server'),
      message: (msg) => {
        const data = JSON.parse(msg)
        this.logger.info(data)
      },
      ...callbacks,
    }
  }

  isConnected() {
    return !(!this.wsConnection.ws || this.wsConnection.ws.readyState !== WebSocket.OPEN)
  }

  disconnect() {
    if (this.isConnected()) {
      this.wsConnection.closeInitiated = true
      this.wsConnection.ws.close()
      this.logger.info('Disconnected with Binance Websocket Server')
      return
    }
    this.logger.warn('No connection to close.')
  }

  initConnect(url) {
    const { socket: ws } = createWebSocket({ url })
    this.logger.info(`Sending Websocket connection to: ${url}`)
    this.wsConnection.ws = ws
    this.wsConnection.closeInitiated = false

    const onOpen = () => {
      this.logger.success(`Connected to the Websocket Server: ${url}`)
      this.callbacks?.open(this)
    }

    // handle data message. Pass the data to the call back method from user
    // It could be useful to store the original messages from server for debug
    const onMessage = (data) => {
      this.callbacks?.message(data.toString())
    }

    const onPing = () => {
      // As ping pong is very important for maintaining the connection, log them as INFO level
      this.logger.system('Received PING from server')
      this.callbacks.ping && this.callbacks.ping()
      ws.pong()
      // eslint-disable-next-line quotes
      this.logger.system("Responded PONG to server's PING message")
    }

    const onPong = () => {
      this.logger.system('Received PONG from server')
      this.callbacks?.pong()
    }

    const onError = (err) => {
      this.logger.error('Received error from server')
      this.callbacks?.error()
      this.logger.error(err)
    }

    const onClose = (closeEventCode, reason) => {
      if (!this.wsConnection.closeInitiated) {
        this.callbacks.close && this.callbacks.close()
        this.logger.warn(`Connection close due to ${closeEventCode}: ${reason}.`)
        setTimeout(() => {
          this.logger.debug('Reconnect to the server.')
          this.initConnect(url)
        }, this.reconnectDelay)
      } else {
        this.wsConnection.closeInitiated = false
      }
    }

    ws.on('open', onOpen)
    ws.on('message', onMessage)
    ws.on('ping', onPing)
    ws.on('pong', onPong)
    ws.on('error', onError)
    ws.on('close', onClose)
  }

  pingServer() {
    if (this.isConnected()) {
      this.logger.info('Send PING to the Websocket Server')
      this.wsConnection.ws.ping()
      return
    }
    this.logger.warn('Ping only can be sent when connection is ready.')
  }

  send(payload) {
    if (this.isConnected()) {
      this.logger.warn('Send only can be sent when connection is ready.')
    }
    this.wsConnection.ws.send(payload)
  }
}
