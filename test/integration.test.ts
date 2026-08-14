// Runs the real dcg binary. Skipped unless dcg is on PATH, so CI and any
// checkout without dcg installed still pass — but on a machine that has it,
// this is the only test that can catch dcg changing its robot-mode contract.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { evaluate } from '../src/dcg.ts'

function dcgAvailable(): boolean {
  try {
    execFileSync('dcg', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const skip = dcgAvailable() ? false : 'dcg is not on PATH'

test('the real dcg denies rm -rf /', { skip }, async () => {
  const outcome = await evaluate('rm -rf /', { binary: 'dcg', timeoutMs: 10_000 })

  assert.equal(outcome.kind, 'verdict', `dcg answered unusably: ${JSON.stringify(outcome)}`)
  assert.equal(outcome.kind === 'verdict' && outcome.blocked, true)
})

test('the real dcg allows a harmless command', { skip }, async () => {
  const outcome = await evaluate('ls -la', { binary: 'dcg', timeoutMs: 10_000 })

  assert.equal(outcome.kind, 'verdict', `dcg answered unusably: ${JSON.stringify(outcome)}`)
  assert.equal(outcome.kind === 'verdict' && outcome.blocked, false)
})

// A command starting with a dash is parsed as dcg's own flags unless the
// option list is closed first: dcg answers "error: unexpected argument '-r'
// found" on stderr with no JSON, which is an unparseable failure — and under
// the default fail-open the command runs unchecked. Only the real binary can
// keep this honest, since it is dcg's argument parser that decides.
test('the real dcg reads a dashed command as a command, not as flags', { skip }, async () => {
  const outcome = await evaluate('-rf /tmp/does-not-exist', { binary: 'dcg', timeoutMs: 10_000 })

  assert.equal(outcome.kind, 'verdict', `dcg answered unusably: ${JSON.stringify(outcome)}`)
})

test('a binary that does not exist is reported as missing', async () => {
  const outcome = await evaluate('ls', { binary: 'dcg-does-not-exist-xyz', timeoutMs: 5000 })

  assert.equal(outcome.kind, 'failure')
  assert.equal(outcome.kind === 'failure' && outcome.reason, 'missing-binary')
})
