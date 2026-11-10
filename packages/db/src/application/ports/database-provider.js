/**
 * Provider port consumed by the database lifecycle aggregate.
 *
 * Providers own connection and transaction mechanics; the database entity
 * owns lifecycle state and transaction draining.
 *
 * @typedef {object} DatabaseProvider
 * @property {() => Promise<void>|void} connect
 * @property {() => Promise<void>|void} close
 * @property {(work: (transaction: unknown) => unknown) => Promise<unknown>|unknown} withTransaction
 */
export {}
