import { defaultLogger as logger } from '../../../../_utils/index.js'
import { generateSignQuery, send, generateSignature } from '../../shared/index.js'
import { adaptOrder } from '../adapters/index.js'

/**
 * @see {@link https://binance-docs.github.io/apidocs/spot/en/#current-open-orders-user_data}
 */
export async function getOpenOrders() {
  const fullQuery = generateSignQuery()
  const path = `openOrders?${fullQuery}&signature=${generateSignature(fullQuery)}`
  const r = await send({ path })
  if ('msg' in r) {
    logger.error(r)
    throw r
  }
  return r.map(adaptOrder)
}
