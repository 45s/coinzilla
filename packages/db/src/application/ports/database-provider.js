/**
 * Provider-neutral record operations available inside a transaction.
 *
 * @typedef {object} DatabaseTransaction
 * @property {(input: {collection: string, record: object}) => object|Promise<object>} create
 * @property {(input: {collection: string, id: string}) => object|null|Promise<object|null>} readOne
 * @property {(input: {collection: string, query?: object}) => object[]|Promise<object[]>} readMany
 * @property {(input: {collection: string, id: string, changes: object}) => object|null|Promise<object|null>} update
 * @property {(input: {collection: string, id: string}) => boolean|Promise<boolean>} delete
 *
 * @typedef {object} DatabaseAdapter
 * @property {() => Promise<void>|void} connect
 * @property {() => Promise<void>|void} close
 * @property {(work: (transaction: unknown) => unknown) => Promise<unknown>|unknown} withTransaction
 *
 * @typedef {object} DatabaseCapabilities
 * @property {{callbackMode: "synchronous"|"asynchronous", nestedTransactions: boolean}} transactions
 * @property {{equalityFilters: boolean, sorting: boolean, pagination: boolean}} queries
 * @property {{modes: Array<"file"|"memory"|"server">}} storage
 *
 * @typedef {DatabaseAdapter & {
 *   capabilities: DatabaseCapabilities,
 *   withTransaction: (work: (transaction: DatabaseTransaction) => unknown) => Promise<unknown>|unknown
 * }} DatabaseProvider
 */
export {}
