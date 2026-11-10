const rtf = new Intl.RelativeTimeFormat('en', {
  style: 'long',
  numeric: 'always',
})

/**
 * Format a numeric offset as an English relative-time phrase.
 * Uses Intl.RelativeTimeFormat's singular/plural unit values and rounding.
 * @param {{ value: number, unit?: Intl.RelativeTimeFormatUnit }} options
 * @returns {string}
 */
export const formatTimeRelatively = ({ value, unit = 'hour' } = {}) => rtf.format(value, unit)
