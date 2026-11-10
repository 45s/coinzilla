const { NODE_ENV } = process.env

/**
 * Environment flags captured once when this module is evaluated.
 * Changing process.env.NODE_ENV afterward does not update these exports.
 * @type {boolean}
 */
export const isDevMode = NODE_ENV === 'development'

/** @type {boolean} True only when NODE_ENV was 'production' at module load. */
export const isProdMode = NODE_ENV === 'production'

/** @type {boolean} True only when NODE_ENV was 'testing' at module load. */
export const isTestingMode = NODE_ENV === 'testing'
