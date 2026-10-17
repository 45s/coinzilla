import { defaultLogger, handleErr } from '../../../../_utils/index.js'
import { createWebSocket } from '../../../../_libs/index.js'

const url = 'wss://stream.binance.com:9443/ws'
const where = 'brokers/binance/.../subscribeForPrices'

export const subscribeForPrices = ({ symbols, onMessage, logger = defaultLogger }) => {
  try {
    const { socket } = createWebSocket({ url })
    const events = [
      [
        'open',
        function onOpenEvent() {
          socket.send(
            JSON.stringify({
              method: 'SUBSCRIBE',
              params: symbols.map((s) => `${s.toLowerCase()}@aggTrade`),
              id: 1,
            }),
          )
          logger.info(`BINANCE_PRICE_SOCKET_OPEN ${symbols.join()}`)
        },
      ],
      [
        'message',
        function onMsgEvent(m) {
          const { s, p } = JSON.parse(m.data)
          onMessage?.({ symbol: s, price: p })
        },
      ],
      ['error', (e) => logger.error(e)],
    ]

    for (const [eventName, cb] of events) {
      socket.addEventListener(eventName, cb)
    }

    return {
      socket,
    }
  } catch (error) {
    handleErr({ where, error })
  }
}
