import {
  readOption,
  readOptions,
  requireArray,
  requireNonEmptyArray,
  requireStrings,
  requireUnique,
} from "./ensure-core.js"

/**
 * Build a fluent chain whose operations return new chain instances.
 * Array transforms create new arrays and do not mutate the source.
 * @param {{ value: unknown, name: string, ensure: object }} options
 * @returns {object}
 */
export function createEnsureChain({ value, name, ensure }) {
  const next = ({ value: nextValue }) => createEnsureChain({ value: nextValue, name, ensure })
  return Object.freeze({
    array() {
      requireArray({ value, name })
      return next({ value })
    },
    string() {
      ensure.string({ value, name })
      return next({ value })
    },
    nonEmpty() {
      if (typeof value === "string") {
        ensure.nonEmptyString({ value, name })
      } else {
        requireNonEmptyArray({ value, name })
      }
      return next({ value })
    },
    strings() {
      requireStrings({ value, name })
      return next({ value })
    },
    nonEmptyStrings() {
      requireStrings({ value, name, nonEmpty: true })
      return next({ value })
    },
    integers() {
      requireArray({ value, name })
      for (let index = 0; index < value.length; index += 1) {
        ensure.integer({ value: value[index], name: `${name}[${index}]` })
      }
      return next({ value })
    },
    map({ transform }) {
      const options = readOptions({ options: { transform } })
      const mapper = readOption({ record: options, key: "transform" })
      requireArray({ value, name })
      ensure.function({ value: mapper, name: "transform" })
      return next({ value: value.map(mapper) })
    },
    filter({ predicate }) {
      const options = readOptions({ options: { predicate } })
      const filterFunction = readOption({ record: options, key: "predicate" })
      requireArray({ value, name })
      ensure.function({ value: filterFunction, name: "predicate" })
      return next({ value: value.filter(filterFunction) })
    },
    unique() {
      requireUnique({ value, name })
      return next({ value })
    },
    between({ min, max }) {
      ensure.numberInRange({ value, min, max, name })
      return next({ value })
    },
    trim() {
      ensure.string({ value, name })
      return next({ value: value.trim() })
    },
    uppercase() {
      ensure.string({ value, name })
      return next({ value: value.toUpperCase() })
    },
    lowercase() {
      ensure.string({ value, name })
      return next({ value: value.toLowerCase() })
    },
    get value() {
      return value
    },
  })
}
