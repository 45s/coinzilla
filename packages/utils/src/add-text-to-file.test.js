import assert from 'node:assert'
import { describe, it } from 'node:test'
import { addTextToFile } from './add-text-to-file.js'

describe('utils/addTextToFile', () => {
  it('should be a function', () => {
    assert(typeof addTextToFile === 'function')
  })

  it.skip('should throw an error with invalid file name', () => {
    /**
     * @link https://nodejs.org/api/assert.html#assertrejectsasyncfn-error-message
     */
    assert.rejects(
      async () => {
        addTextToFile({ fileName: '', text: '' })
      },
      { error: 'Error appending data to file' },
    )
  })
})
