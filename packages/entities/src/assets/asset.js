export const assetErrMsgs = {
  id: "Asset.id should be a non-empty string",
  code: "Asset.code should be a non-empty string",
}

const normalizeRequiredString = (value) =>
  typeof value === "string" ? value.trim() : ""

export class Asset {
  #id
  #code

  constructor({ id, code } = {}) {
    const normalizedId = normalizeRequiredString(id)
    if (!normalizedId) {
      throw new Error(assetErrMsgs.id)
    }

    const normalizedCode = normalizeRequiredString(code)
    if (!normalizedCode) {
      throw new Error(assetErrMsgs.code)
    }

    this.#id = normalizedId
    this.#code = normalizedCode.toUpperCase()

    Object.freeze(this)
  }

  get id() {
    return this.#id
  }

  get code() {
    return this.#code
  }

  get value() {
    return {
      id: this.#id,
      code: this.#code,
    }
  }
}
