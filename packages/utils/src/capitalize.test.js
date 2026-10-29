import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capitalize } from './capitalize.js'

describe('capitalize', () => {
  it('converts lowercase text to uppercase', () => {
    assert.equal(capitalize('abc'), 'ABC')
  })

  it('trims leading and trailing whitespace', () => {
    assert.equal(capitalize('  hello world  '), 'HELLO WORLD')
  })

  it('handles already-uppercase and mixed-case text', () => {
    assert.equal(capitalize('COINZILLA'), 'COINZILLA')
    assert.equal(capitalize('CoInZilla'), 'COINZILLA')
  })

  it('uppercases Latin Unicode text while preserving emoji', () => {
    assert.equal(capitalize('  café 🚀  '), 'CAFÉ 🚀')
  })

  it('returns an empty string for empty input', () => {
    assert.equal(capitalize(''), '')
  })

  it('returns an empty string for whitespace-only input', () => {
    assert.equal(capitalize(' \t\n '), '')
  })
})
