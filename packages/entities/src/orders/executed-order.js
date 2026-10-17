import { Order } from './order.js'

export class ExecutedOrder extends Order {
  #commission
  #commissionAsset
  #status

  get value() {
    return {
      ...super.value,
      status: this.#status,
      commission: this.#commission,
      commissionAsset: this.#commissionAsset,
    }
  }

  constructor(input = {}) {
    super(input)
    const { commission, commissionAsset, status } = input
    this.#commission = commission
    this.#commissionAsset = commissionAsset
    this.#status = status
  }
}
