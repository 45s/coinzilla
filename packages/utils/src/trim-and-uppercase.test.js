import assert from 'node:assert/strict'
import test from 'node:test'
import { trimAndUppercase } from './trim-and-uppercase.js'

test('converts lowercase text to uppercase', () => {
  assert.equal(trimAndUppercase('abc'), 'ABC')
})

test('trims leading and trailing whitespace', () => {
  assert.equal(trimAndUppercase('  hello world  '), 'HELLO WORLD')
})

test('uppercases already-uppercase and mixed-case text', () => {
  assert.equal(trimAndUppercase('COINZILLA'), 'COINZILLA')
  assert.equal(trimAndUppercase('CoInZilla'), 'COINZILLA')
})

test('uppercases Latin Unicode text while preserving emoji', () => {
  assert.equal(trimAndUppercase('  café 🚀  '), 'CAFÉ 🚀')
})

test('returns an empty string for empty input', () => {
  assert.equal(trimAndUppercase(''), '')
})

test('returns an empty string for whitespace-only input', () => {
  assert.equal(trimAndUppercase(' \t\n '), '')
})
