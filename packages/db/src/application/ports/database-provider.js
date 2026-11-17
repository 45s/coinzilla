/**
 * Provider port for the provider-neutral record database.
 *
 * A transaction callback receives only the generic record operations. Provider
 * connections, statements, SQL and driver-native records remain private.
 *
 * @typedef {object} DatabaseTransaction
 * @property {(collection: string, record: object) => object} create
 * @property {(collection: string, identifier: string) => object|null} readOne
 * @property {(collection: string, query?: object) => object[]} readMany
 * @property {(collection: string, identifier: string, changes: object) => object|null} update
 * @property {(collection: string, identifier: string) => boolean} delete
 *
 * @typedef {object} DatabaseCapabilities
 * @property {object} transactions - Declares transaction callback behavior.
 * @property {object} queries - Declares supported filtering, sorting and pagination.
 * @property {object} storage - Declares supported storage modes.
 *
 * @typedef {object} DatabaseProvider
 * @property {DatabaseCapabilities} capabilities
 * @property {() => Promise<void>|void} connect
 * @property {() => Promise<void>|void} close
 * @property {(work: (transaction: DatabaseTransaction) => unknown) => Promise<unknown>|unknown} withTransaction
 */
export {}
