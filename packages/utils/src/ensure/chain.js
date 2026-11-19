import { readOption, readOptions } from "./helpers/options.js"
import {
  requireArray,
  requireNonEmptyArray,
  requireStrings,
  requireUnique,
} from "./helpers/collections.js"

/**
 * Immutable fluent chain. Transformations produce new chains and arrays.
 */
class EnsureChain {
  #value
  #name
  #errMsg
  #ensure

  /**
   * @param {{ value: unknown, name: string, errMsg?: string, ensure: object }} options
   */
  constructor({ value, name, errMsg, ensure }) {
    this.#value = value
    this.#name = name
    this.#errMsg = errMsg
    this.#ensure = ensure
    Object.freeze(this)
  }

  #next({ value }) {
    return new EnsureChain({
      value,
      name: this.#name,
      errMsg: this.#errMsg,
      ensure: this.#ensure,
    })
  }

  array() {
    requireArray({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  string() {
    this.#ensure.string({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  integer() {
    this.#ensure.integer({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  nonEmpty() {
    if (typeof this.#value === "string") {
      this.#ensure.nonEmptyString({
        value: this.#value,
        name: this.#name,
        errMsg: this.#errMsg,
      })
    } else {
      requireNonEmptyArray({
        value: this.#value,
        name: this.#name,
        errMsg: this.#errMsg,
      })
    }
    return this.#next({ value: this.#value })
  }

  strings() {
    requireStrings({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  nonEmptyStrings() {
    requireStrings({
      value: this.#value,
      name: this.#name,
      nonEmpty: true,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  integers() {
    requireArray({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    for (let index = 0; index < this.#value.length; index += 1) {
      this.#ensure.integer({
        value: this.#value[index],
        name: `${this.#name}[${index}]`,
        errMsg: this.#errMsg,
      })
    }
    return this.#next({ value: this.#value })
  }

  map(options) {
    const record = readOptions({ options })
    const transform = readOption({
      record,
      key: "transform",
    })
    requireArray({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    this.#ensure.function({
      value: transform,
      name: "transform",
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value.map(transform) })
  }

  filter(options) {
    const record = readOptions({ options })
    const predicate = readOption({
      record,
      key: "predicate",
    })
    requireArray({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    this.#ensure.function({
      value: predicate,
      name: "predicate",
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value.filter(predicate) })
  }

  unique() {
    requireUnique({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  between(options) {
    const record = readOptions({ options })
    const min = readOption({
      record,
      key: "min",
    })
    const max = readOption({
      record,
      key: "max",
    })
    this.#ensure.numberInRange({
      value: this.#value,
      min,
      max,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value })
  }

  trim() {
    this.#ensure.string({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value.trim() })
  }

  uppercase() {
    this.#ensure.string({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value.toUpperCase() })
  }

  lowercase() {
    this.#ensure.string({
      value: this.#value,
      name: this.#name,
      errMsg: this.#errMsg,
    })
    return this.#next({ value: this.#value.toLowerCase() })
  }

  get value() {
    return this.#value
  }
}

/**
 * Create a new chain wrapper around the input value.
 * @param {{ value: unknown, name: string, errMsg?: string, ensure: object }} options
 * @returns {EnsureChain}
 */
export function createEnsureChain(options) {
  return new EnsureChain(options)
}
