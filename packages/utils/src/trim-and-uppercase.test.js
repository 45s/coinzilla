import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trimAndUppercase } from './trim-and-uppercase.js'

describe('trimAndUppercase', () => {
  it('converts lowercase text to uppercase', () => {
    assert.equal(trimAndUppercase('abc'), 'ABC')
  })

  it('trims leading and trailing whitespace', () => {
    assert.equal(trimAndUppercase('  hello world  '), 'HELLO WORLD')
  })

  it('handles already-uppercase and mixed-case text', () => {
    assert.equal(trimAndUppercase('COINZILLA'), 'COINZILLA')
    assert.equal(trimAndUppercase('CoInZilla'), 'COINZILLA')
  })

  it('uppercases Latin Unicode text while preserving emoji', () => {
    assert.equal(trimAndUppercase('  café 🚀  '), 'CAFÉ 🚀')
  })

  it('returns an empty string for empty input', () => {
    assert.equal(trimAndUppercase(''), '')
  })

  it('returns an empty string for whitespace-only input', () => {
    assert.equal(trimAndUppercase(' \t\n '), '')
  })
})
