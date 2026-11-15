import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unglueNumber } from '../src/main/chapterText.ts'

test('an age glued onto the chapter number is taken off using the link', () => {
  assert.equal(unglueNumber('5916', ' months ago', '59'), '59')
  assert.equal(unglueNumber('4819', 'h ago', '48'), '48')
  assert.equal(unglueNumber('481', ' day ago', '48'), '48')
})

test('a real number is left alone', () => {
  assert.equal(unglueNumber('59', ' 16 months ago', '59'), '59')
  assert.equal(unglueNumber('123', '', '12'), '123') // nothing that looks like an age follows
  assert.equal(unglueNumber('123', ' The Return', '12'), '123')
  assert.equal(unglueNumber('5916', ' months ago', null), '5916') // no number in the link to go by
  assert.equal(unglueNumber('75', ' hours ago', '12'), '75') // the link's number isn't its start
})
