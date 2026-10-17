const rtf = new Intl.RelativeTimeFormat('en', {
  style: 'long',
  numeric: 'always',
})

export const formatTimeRelatively = ({ value, unit = 'hour' } = {}) => rtf.format(value, unit)
