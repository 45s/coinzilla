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

  it('normalizes null and non-object options into the documented error result', async () => {
    for (const options of [null, [], 'invalid']) {
      await assert.rejects(addTextToFile(options), (error) => {
        assert.equal(error.message, 'Error appending data to file')
        assert.equal(error.cause.message, 'Invalid "options" parameter')
        return true
      })
    }
  })

  it('rejects when the file name is missing', async () => {
    await assert.rejects(
      addTextToFile({ fileName: '', text: '' }),
      (error) => {
        assert.equal(error.message, 'Error appending data to file')
        assert.equal(error.cause.message, 'Invalid "fileName" parameter')
        return true
      },
    )
  })

  it('preserves the original filesystem error as the cause', async () => {
    await assert.rejects(
      addTextToFile({ fileName: path.join(directory, 'missing', 'output.txt'), text: 'data' }),
      (error) => {
        assert.equal(error.message, 'Error appending data to file')
        assert.equal(error.cause.code, 'ENOENT')
        return true
      },
    )
  })
})

it('appends Latin Unicode text without changing Unicode characters', async () => {
  const localDirectory = await mkdtemp(path.join(os.tmpdir(), 'coinzilla-unicode-'))
  const localFile = path.join(localDirectory, 'unicode.txt')
  try {
    await addTextToFile({ fileName: localFile, text: 'café 🚀\n' })
    assert.equal(await readFile(localFile, 'utf8'), 'café 🚀\n')
  } finally {
    await rm(localDirectory, { recursive: true, force: true })
  }
})
