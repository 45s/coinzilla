import { defaultLogger } from './index.js'

export const handleErr = ({ logger = defaultLogger, where, error }) => {
  logger.error({
    where,
    error,
    message: error?.message,
  })
}
