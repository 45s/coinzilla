import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { addTextToFile } from './add-text-to-file.js'

describe('addTextToFile', () => {
  let directory
  let fileName

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'coinzilla-utils-'))
    fileName = path.join(directory, 'output.txt')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('appends text to a file', async () => {
    await addTextToFile({ fileName, text: 'first line\n' })
    await addTextToFile({ fileName, text: 'second line\n' })

    assert.equal(await readFile(fileName, 'utf8'), 'first line\nsecond line\n')
  })

  it('rejects when the file name is missing', async () => {
    await assert.rejects(
      addTextToFile({ fileName: '', text: '' }),
      { message: 'Error appending data to file' },
    )
  })

  it('wraps file-system errors in a stable error message', async () => {
    await assert.rejects(
      addTextToFile({ fileName: path.join(directory, 'missing', 'output.txt'), text: 'data' }),
      { message: 'Error appending data to file' },
    )
  })
})
