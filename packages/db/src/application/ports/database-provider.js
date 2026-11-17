/**
 * Provider port for the provider-neutral record database.
 *
 * A transaction callback receives only the generic record operations. Provider
 * connections, statements, SQL and driver-native records remain private.
 *
 * @typedef {object} DatabaseTransaction
 * @property {(input: {collection: string, record: object}) => object} create
 * @property {(input: {collection: string, id: string}) => object|null} readOne
 * @property {(input: {collection: string, query?: object}) => object[]} readMany
 * @property {(input: {collection: string, id: string, changes: object}) => object|null} update
 * @property {(input: {collection: string, id: string}) => boolean} delete
 *
 * @typedef {object} DatabaseCapabilities
 * @property {{callbackMode: "synchronous"|"asynchronous", nestedTransactions: boolean}} transactions
 * @property {{equalityFilters: boolean, sorting: boolean, pagination: boolean}} queries
 * @property {{modes: Array<"file"|"memory"|"server">}} storage
 *
 * @typedef {object} DatabaseProvider
 * @property {DatabaseCapabilities} capabilities
 * @property {() => Promise<void>|void} connect
 * @property {() => Promise<void>|void} close
 * @property {(work: (transaction: DatabaseTransaction) => unknown) => Promise<unknown>|unknown} withTransaction
 */
export {}
