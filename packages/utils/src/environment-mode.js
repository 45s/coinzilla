const { NODE_ENV } = process.env

export const isDevMode = NODE_ENV === 'development'
export const isProdMode = NODE_ENV === 'production'
export const isTestingMode = NODE_ENV === 'testing'
