import { defaultLogger } from './logger.js'

export const handleErr = ({ logger = defaultLogger, where, error }) => {
  logger.error({
    where,
    error,
    message: error?.message,
  })
}
